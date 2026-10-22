import { AiError, abortError, noKeyError, type Ai, type Usage } from "./ai.js"
import { applyTranslation, enqueueChapters } from "./chapters.js"
import { CHUNK_SIZE, splitChunks } from "./chunks.js"
import { buildContext, type ChapterContext } from "./context.js"
import type { Db } from "./db.js"
import { buildUserChunk } from "./prompts.js"
import { recordUsage } from "./usage.js"
import type { Settings } from "./settings.js"
import type { Logger } from "./util/log.js"
import { truncate } from "./util/text.js"
import { dayKey, nowSql } from "./util/time.js"

/**
 * Worker คิวแปล (spec 8.2–8.5): ทำทีละตอนตามลำดับ `queue_seq` ในโปรเซสเดียว
 * หยุดแล้วทำต่อได้ (เหตุผลที่หยุดเก็บใน settings `queue_paused_reason` จึงอยู่รอดเมื่อรีสตาร์ท) ยกเลิกตอนที่ถูกลบกลางสตรีมได้
 * และคืนตอนเข้าคิวเมื่อถูกขัดจังหวะ (ปิดเครื่อง/ข้อผิดพลาดร้ายแรง) โดยไม่เขียนผลครึ่งๆ กลางๆ ลง DB
 */

export interface QueueState {
  paused: boolean
  pausedReason: string
  /** ตอนที่ผิดพลาดติดกัน (สำเร็จหนึ่งตอน/ทำต่อ/เริ่มระบบใหม่ ล้างเป็น 0) ครบ 3 คิวหยุดเอง */
  consecutiveErrors: number
  /** จำนวนตอนที่รออยู่ทั้งหมด (`waiting` แสดงแค่ 50 ตอนแรก) */
  waitingTotal: number
  /** ตอนที่กำลังแปล `chunkIndex` นับจาก 0 (ชิ้นที่ `chunkIndex + 1` จาก `chunkTotal`) `textTail` = ท้าย ~2000 ตัวอักษรของผลที่ไหลอยู่ */
  current: null | {
    chapterId: number
    novelId: number
    novelTitle: string
    number: number
    chunkIndex: number
    chunkTotal: number
    textTail: string
  }
  waiting: { id: number; novelId: number; novelTitle: string; number: number }[]
}

/** `done` รวมตอนที่ถูกลบกลางทาง (ไปทำตอนถัดไปได้เลย); `paused` = คิวหยุดอยู่หลังรอบนี้ */
export type TickResult = "idle" | "done" | "error" | "paused"

export interface Queue {
  /** ส่งตอนเข้าคิวแล้วปลุกลูป (ที่ข้ามคือตอนที่ queued/translating อยู่แล้วหรือ id ที่ไม่มี) */
  enqueue(ids: number[], o: { autoPublish: boolean }): { queued: number; skipped: number }
  /** ทำหนึ่งตอน (เรียกซ้อนกันไม่ได้ — เรียกจาก `start()` หรือจากเทสต์เท่านั้น) */
  tick(): Promise<TickResult>
  start(): void
  /** ยกเลิกสตรีมที่กำลังรัน (ตอนกลับเป็น queued) แล้วรอให้ลูปและรอบที่ค้างอยู่จบ */
  stop(): Promise<void>
  wake(): void
  /** ไม่หยิบตอนถัดไป ตอนที่กำลังทำอยู่ทำจนจบ */
  pause(reason: string): void
  resume(): void
  /** เรียกก่อนลบตอน/เรื่อง: ถ้าตอนที่กำลังแปลอยู่ในรายการ ยกเลิกสตรีมและทิ้งผลโดยไม่แตะ DB คืน true */
  cancelIfCurrent(chapterIds: number[]): boolean
  /** เริ่มระบบใหม่: ตอนที่ค้าง `translating` (โปรเซสดับกลางคัน) กลับเป็น `queued` */
  recoverOnStart(): void
  state(): QueueState
}

const PAUSE_KEY = "queue_paused_reason"
const DEFAULT_PAUSE_REASON = "หยุดโดยผู้ดูแล"
const CONSECUTIVE_ERRORS_REASON = "พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API"
const MAX_CONSECUTIVE_ERRORS = 3
const MAX_TOKENS = 8000
const NEXT_CHUNK_TAIL = 800
const DISPLAY_TAIL = 2000
const MAX_WAITING_LISTED = 50
const MAX_ERROR_LENGTH = 500
const IDLE_MS = 5000

/** ปัญหาของตอนที่คาดไว้แล้วและมีข้อความไทยพร้อมแสดงเจ้าของ (ต่างจากบั๊กที่ต้องบันทึกเป็น error ใน log) */
class ChapterProblem extends Error {}

/** ผลที่แปลได้ไม่มีที่ลงแล้ว: แถวหายหรือไม่ใช่ `translating` ของเราอีก (ถูกลบ/นำเข้า/เปลี่ยนสถานะระหว่างแปล) ทิ้งโดยไม่แตะแถว */
class Discard extends Error {}

interface Live {
  chapterId: number
  controller: AbortController
  /** ใครสั่งยกเลิก: cancel = ตอนถูกลบ (ทิ้งเงียบๆ), shutdown = ปิดเครื่อง (คืนเข้าคิว) */
  reason: "cancel" | "shutdown" | null
  novelId: number
  novelTitle: string
  number: number
  chunkIndex: number
  chunkTotal: number
  /** ผลของชิ้นที่แปลเสร็จแล้ว (คั่นด้วยบรรทัดว่าง) */
  done: string
  /** ข้อความที่กำลังไหลของชิ้นปัจจุบัน */
  partial: string
}

/** ท้าย `n` ตัวอักษร นับตามตัวอักษรจริง (code point) จึงไม่ผ่า emoji ครึ่งตัว */
function tailChars(text: string, n: number): string {
  if (text.length <= n) return text
  const chars = Array.from(text)
  return chars.length <= n ? text : chars.slice(-n).join("")
}

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * รอ `p` แต่ออกทันทีเมื่อ `signal` ถูก abort (โยน abortError) — ใช้กับการเรียกที่รับ signal ไม่ได้ (`chapterNotes`)
 * เพื่อให้ `stop()`/ยกเลิกไม่ต้องรอ Claude ที่อาจค้าง; ผลที่มาทีหลังถูกทิ้ง (ไม่มี rejection ที่ไม่มีใครรับ)
 */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => (onAbort = () => reject(abortError())))
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) onAbort()
  return Promise.race([p, aborted]).finally(() => signal.removeEventListener("abort", onAbort))
}

export function createQueue(d: { db: Db; settings: Settings; ai: Ai; now?: () => Date; log?: Logger }): Queue {
  const { db, settings, ai } = d
  const now = d.now ?? (() => new Date())
  const log: Logger = d.log ?? { info() {}, warn() {}, error() {} }

  let current: Live | null = null
  let consecutiveErrors = 0
  let stopping = false
  let loop: Promise<void> | undefined
  let inflight: Promise<TickResult> | undefined
  let waker: (() => void) | null = null
  let wakePending = false

  const peek = () => db.get<{ id: number }>("SELECT id FROM chapters WHERE status = 'queued' ORDER BY queue_seq, id LIMIT 1")

  /** หยิบตอนแรกในคิว; ถ้าถูกแย่งไปก่อน (เช่นนำเข้าเปลี่ยนเป็น done ตัดหน้า) ก็ลองตอนถัดไป */
  function claim(): number | null {
    for (;;) {
      const next = peek()
      if (!next) return null
      const claimed = db.run(
        "UPDATE chapters SET status = 'translating', updated_at = ? WHERE id = ? AND status = 'queued'",
        nowSql(now()),
        next.id,
      )
      if (claimed.changes === 1) return next.id
    }
  }

  /** ตอนหาย/ไม่ใช่ translating แล้ว (ถูกลบหรือถูกแก้ระหว่างทาง) UPDATE จะไม่โดนแถวใด จึงไม่มีทางสร้างแถวกลับมา */
  function requeue(id: number): void {
    db.run("UPDATE chapters SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'translating'", nowSql(now()), id)
  }

  function markError(id: number, message: string): void {
    db.run(
      "UPDATE chapters SET status = 'error', error = ?, queue_seq = NULL, updated_at = ? WHERE id = ? AND status = 'translating'",
      truncate(message, MAX_ERROR_LENGTH),
      nowSql(now()),
      id,
    )
  }

  /** สถิติโทเคนพังต้องไม่ทำให้ชิ้นที่แปลเสร็จแล้วกลายเป็นความผิดพลาด */
  function record(model: string, usage: Usage): void {
    try {
      recordUsage(db, dayKey(now()), model, usage)
    } catch (e) {
      log.warn(`บันทึกโทเคนลงตาราง usage ไม่สำเร็จ: ${describe(e)}`)
    }
  }

  /**
   * จุดตรวจก่อนจะเขียนอะไรลง DB: ถูกสั่งยกเลิกแล้วหรือยัง และแถวยังเป็นของเรา (`translating`) อยู่ไหม
   * (ถ้าถูกนำเข้า/ถูกลบไปแล้ว ผลของเราไปทับของเจ้าของไม่ได้ และชิ้นที่เหลือก็ไม่ต้องเสียเงินแปล)
   */
  function checkpoint(live: Live): void {
    if (live.controller.signal.aborted) throw abortError()
    const row = db.get<{ status: string }>("SELECT status FROM chapters WHERE id = ?", live.chapterId)
    if (row?.status !== "translating") throw new Discard()
  }

  async function translateAll(ctx: ChapterContext, live: Live): Promise<string> {
    const chunks = splitChunks(ctx.chapter.source_text, CHUNK_SIZE[ctx.novel.mode])
    if (chunks.length === 0) throw new ChapterProblem("ไม่มีต้นฉบับให้แปล")
    live.chunkTotal = chunks.length
    const results: string[] = []
    for (const [i, chunk] of chunks.entries()) {
      live.chunkIndex = i
      const { translateModel } = settings.get()
      const result = await ai.translateChunk({
        model: translateModel,
        system: ctx.system,
        user: buildUserChunk({ chunk, index: i, total: chunks.length, previousTail: tailChars(results[i - 1] ?? "", NEXT_CHUNK_TAIL) }),
        maxTokens: MAX_TOKENS,
        onText: (t) => void (live.partial += t),
        signal: live.controller.signal,
      })
      checkpoint(live) // ยกเลิกแล้วไม่เขียนอะไรเพิ่ม (รวมถึง usage)
      record(translateModel, result.usage)
      results.push(result.text.trim())
      live.done = results.join("\n\n")
      live.partial = ""
    }
    return live.done
  }

  /** สรุป + ชื่อตอน + ศัพท์ใหม่: ล้มเหลวไม่เป็นไร ตอนยังถือว่าแปลเสร็จ (spec 8.4); ถูกสั่งยกเลิก/หยุดระหว่างรอ → ออกทันที */
  async function summarize(ctx: ChapterContext, translation: string, model: string, signal: AbortSignal) {
    try {
      const notes = ai.chapterNotes({
        model,
        thaiText: translation,
        sourceTitle: ctx.chapter.title,
        sourceText: ctx.chapter.source_text,
        knownTerms: ctx.glossary.map((g) => g.source),
      })
      return await raceAbort(notes, signal)
    } catch (e) {
      if (signal.aborted) throw e
      log.warn(`สรุปตอนที่ ${ctx.chapter.number} ไม่สำเร็จ (ตอนนี้ยังถือว่าแปลเสร็จ แต่ไม่มีเรื่องย่อ): ${describe(e)}`)
      return null
    }
  }

  function settleFailure(live: Live, e: unknown): TickResult {
    const id = live.chapterId
    if (live.controller.signal.aborted) {
      if (live.reason === "cancel") return "done"
      requeue(id)
      return "idle"
    }
    if (e instanceof Discard) {
      log.info(`ทิ้งผลแปลตอนที่ ${live.number} ของ "${live.novelTitle}": ตอนนี้ไม่ได้อยู่ในสถานะกำลังแปลแล้ว (ถูกลบ/นำเข้า/เปลี่ยนสถานะระหว่างแปล)`)
      return "done"
    }
    if (e instanceof AiError && e.fatal) {
      requeue(id)
      pause(e.message)
      return "paused"
    }
    const expected = e instanceof AiError || e instanceof ChapterProblem
    if (expected) log.warn(`แปลตอนที่ ${live.number} ของ "${live.novelTitle}" ไม่สำเร็จ: ${e.message}`)
    else log.error(`แปลตอนที่ ${live.number} ของ "${live.novelTitle}" พังด้วยข้อผิดพลาดที่ไม่คาดคิด: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    markError(id, expected ? e.message : `เกิดข้อผิดพลาดที่ไม่คาดคิด: ${describe(e)}`)
    consecutiveErrors++
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      pause(CONSECUTIVE_ERRORS_REASON)
      return "paused"
    }
    return "error"
  }

  async function run(): Promise<TickResult> {
    if (settings.getInternal(PAUSE_KEY) !== "") return "paused"
    if (!peek()) return "idle" // ไม่มีงาน: ไม่ต้องบ่นเรื่อง key (ใช้ช่องทางนำเข้าอย่างเดียวได้)
    if (!ai.hasKey()) {
      pause(noKeyError().message)
      return "paused"
    }
    const id = claim()
    if (id === null) return "idle"

    const live: Live = {
      chapterId: id,
      controller: new AbortController(),
      reason: null,
      novelId: 0,
      novelTitle: "",
      number: 0,
      chunkIndex: 0,
      chunkTotal: 0,
      done: "",
      partial: "",
    }
    current = live
    try {
      const ctx = buildContext(db, id)
      if (!ctx) throw new Error("ไม่พบตอนที่เพิ่งหยิบจากคิว")
      live.novelId = ctx.novel.id
      live.novelTitle = ctx.novel.title_th || ctx.novel.title
      live.number = ctx.chapter.number

      const translation = await translateAll(ctx, live)
      const { recapModel } = settings.get()
      const notes = await summarize(ctx, translation, recapModel, live.controller.signal)
      checkpoint(live)
      if (notes) record(recapModel, notes.usage)
      applyTranslation(db, id, {
        translation,
        titleTh: notes?.titleTh,
        recap: notes?.recap ?? null,
        terms: notes?.terms,
        publish: ctx.chapter.auto_publish === 1,
        now: nowSql(now()),
      })
      consecutiveErrors = 0
      log.info(`แปลตอนที่ ${live.number} ของ "${live.novelTitle}" เสร็จ (${live.chunkTotal} ชิ้น)`)
      return "done"
    } catch (e) {
      return settleFailure(live, e)
    } finally {
      current = null
    }
  }

  function tick(): Promise<TickResult> {
    const p: Promise<TickResult> = run().finally(() => {
      if (inflight === p) inflight = undefined
    })
    inflight = p
    return p
  }

  function pause(reason: string): void {
    const text = reason.trim() || DEFAULT_PAUSE_REASON
    settings.setInternal(PAUSE_KEY, text)
    log.warn(`คิวแปลหยุด: ${text}`)
  }

  function wake(): void {
    if (waker) waker()
    else wakePending = true
  }

  function resume(): void {
    settings.setInternal(PAUSE_KEY, "")
    consecutiveErrors = 0
    wake()
  }

  /** รอ `ms` หรือจนถูก `wake()` (ถ้า wake มาก่อนเริ่มรอ จะไม่รอเลย) */
  function sleep(ms: number): Promise<void> {
    if (wakePending) {
      wakePending = false
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms)
      timer.unref()
      waker = finish
      function finish(): void {
        clearTimeout(timer)
        if (waker === finish) waker = null
        resolve()
      }
    })
  }

  function start(): void {
    if (loop) return
    stopping = false
    loop = (async () => {
      while (!stopping) {
        let result: TickResult = "idle"
        try {
          result = await tick()
        } catch (e) {
          log.error(`คิวแปลพังด้วยข้อผิดพลาดที่ไม่คาดคิด: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
        }
        if (stopping) break
        if (result === "idle" || result === "paused") await sleep(IDLE_MS)
      }
    })()
  }

  async function stop(): Promise<void> {
    stopping = true
    if (current) {
      current.reason ??= "shutdown"
      current.controller.abort()
    }
    wake()
    await Promise.allSettled([loop, inflight])
    loop = undefined
  }

  function cancelIfCurrent(chapterIds: number[]): boolean {
    if (!current || !chapterIds.includes(current.chapterId)) return false
    current.reason ??= "cancel"
    current.controller.abort()
    return true
  }

  function recoverOnStart(): void {
    const r = db.run("UPDATE chapters SET status = 'queued', updated_at = ? WHERE status = 'translating'", nowSql(now()))
    consecutiveErrors = 0
    if (r.changes > 0) log.info(`นำ ${r.changes} ตอนที่ค้างสถานะกำลังแปลกลับเข้าคิว`)
  }

  function state(): QueueState {
    const reason = settings.getInternal(PAUSE_KEY)
    const live = current
    const flowing = live ? (live.done && live.partial ? `${live.done}\n\n${live.partial}` : live.done + live.partial) : ""
    const waiting = db.all<{ id: number; novel_id: number; number: number; title: string; title_th: string }>(
      `SELECT c.id, c.novel_id, c.number, n.title, n.title_th FROM chapters c JOIN novels n ON n.id = c.novel_id
       WHERE c.status = 'queued' ORDER BY c.queue_seq, c.id LIMIT ?`,
      MAX_WAITING_LISTED,
    )
    return {
      paused: reason !== "",
      pausedReason: reason,
      consecutiveErrors,
      waitingTotal: db.get<{ c: number }>("SELECT COUNT(*) AS c FROM chapters WHERE status = 'queued'")!.c,
      current: live && {
        chapterId: live.chapterId,
        novelId: live.novelId,
        novelTitle: live.novelTitle,
        number: live.number,
        chunkIndex: live.chunkIndex,
        chunkTotal: live.chunkTotal,
        textTail: tailChars(flowing, DISPLAY_TAIL),
      },
      waiting: waiting.map((w) => ({ id: w.id, novelId: w.novel_id, novelTitle: w.title_th || w.title, number: w.number })),
    }
  }

  function enqueue(ids: number[], o: { autoPublish: boolean }): { queued: number; skipped: number } {
    const r = enqueueChapters(db, ids, { autoPublish: o.autoPublish, now: nowSql(now()) })
    if (r.queued.length > 0) wake()
    return { queued: r.queued.length, skipped: r.skipped.length }
  }

  return { enqueue, tick, start, stop, wake, pause, resume, cancelIfCurrent, recoverOnStart, state }
}
