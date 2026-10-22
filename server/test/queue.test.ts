import { test } from "node:test"
import assert from "node:assert/strict"
import { openDb, type Db } from "../src/db.js"
import { migrate } from "../src/migrate.js"
import { createSettings } from "../src/settings.js"
import { createQueue, type Queue } from "../src/queue.js"
import { AiError, abortError, type Ai } from "../src/ai.js"
import { buildContext } from "../src/context.js"
import { memoryLogger } from "../src/util/log.js"
import { createFakeAi, type FakeAi, type FakeCall, type FakeScript } from "./helpers/fake-ai.js"
import { getChapter, seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"

const NOW = new Date("2026-10-22T05:00:00Z") // วันที่ 2026-10-22 ตามเวลา UTC+7
const NOW_SQL = "2026-10-22 05:00:00"
const CFG = { translateModel: "m-translate", recapModel: "m-recap" }
const PAUSE_KEY = "queue_paused_reason"

function setup(script: FakeScript = {}, wrap?: (base: FakeAi) => Ai) {
  const db = openDb(":memory:")
  migrate(db)
  const settings = createSettings(db, CFG)
  const fake = createFakeAi(script)
  const { logger, lines } = memoryLogger()
  const queue = createQueue({ db, settings, ai: wrap ? wrap(fake) : fake, now: () => NOW, log: logger })
  const novelId = seedNovel(db, { title: "Dungeon Hermit", titleTh: "ฤๅษีดันเจี้ยน" })
  return { db, settings, fake, queue, logs: lines, novelId }
}

const translateCalls = (ai: FakeAi) => ai.calls.filter((c): c is Extract<FakeCall, { method: "translateChunk" }> => c.method === "translateChunk")
const notesCalls = (ai: FakeAi) => ai.calls.filter((c): c is Extract<FakeCall, { method: "chapterNotes" }> => c.method === "chapterNotes")

function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: หมดเวลา")
    await new Promise((r) => setTimeout(r, 5))
  }
}

/**
 * ครอบ `translateChunk` ให้ส่งข้อความบางส่วนแล้วหยุดรอ `release()` (หรือถูกยกเลิกด้วย signal) — ควบคุมจังหวะกลางสตรีมได้แน่นอน
 * `onlyCall` = หยุดเฉพาะการเรียกครั้งที่ n (นับจาก 1) ครั้งอื่นผ่านไปที่ AI ปลอมตามปกติ
 */
function gated(base: FakeAi, o: { partial: string | string[]; onlyCall?: number }) {
  const entered = deferred()
  const release = deferred()
  let n = 0
  const ai: Ai = {
    hasKey: () => base.hasKey(),
    chapterNotes: (p) => base.chapterNotes(p),
    fillNovel: (p) => base.fillNovel(p),
    ping: (m) => base.ping(m),
    async translateChunk(p) {
      n++
      if (o.onlyCall !== undefined && n !== o.onlyCall) return base.translateChunk(p)
      if (p.signal?.aborted) throw abortError()
      for (const piece of [o.partial].flat()) p.onText(piece)
      entered.resolve()
      await new Promise<void>((resolve, reject) => {
        void release.promise.then(resolve)
        p.signal?.addEventListener("abort", () => reject(abortError()), { once: true })
      })
      return base.translateChunk(p)
    },
  }
  return { ai, entered: entered.promise, release: release.resolve }
}

/** `setup` ที่ครอบ AI ปลอมด้วย `gated` (ใช้ `fake` ตัวเดียวกันบันทึกการเรียก) */
function setupGated(o: { partial: string | string[]; onlyCall?: number }, script: FakeScript = {}) {
  let g!: ReturnType<typeof gated>
  const ctx = setup(script, (base) => ((g = gated(base, o)), g.ai))
  return { ...ctx, entered: g.entered, release: g.release }
}

const usageRows = (db: Db) => db.all<{ model: string; tokens_in: number; tokens_out: number; calls: number }>("SELECT model, tokens_in, tokens_out, calls FROM usage ORDER BY model")

// ───────────────────────── ลำดับและการเขียนผล ─────────────────────────

test("ทำทีละตอนตามลำดับ queue_seq (ตอนที่สั่งทีหลังได้คิวหลัง แม้เลขน้อยกว่า) และสองตอนไม่ทับซ้อนกัน", async () => {
  const { db, queue, novelId, fake } = setup()
  const c9 = seedChapter(db, novelId, 9, { source: "ต้นฉบับ-9" }) // id น้อยสุดแต่ได้คิวหลังสุด: ลำดับคิวไม่ใช่ลำดับ id
  const c2 = seedChapter(db, novelId, 2, { source: "ต้นฉบับ-2" })
  const c5 = seedChapter(db, novelId, 5, { source: "ต้นฉบับ-5" })
  const translating: number[] = []
  fake.script.translate = () => void translating.push(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM chapters WHERE status = 'translating'")!.c)
  assert.deepEqual(queue.enqueue([c5], { autoPublish: false }), { queued: 1, skipped: 0 })
  assert.deepEqual(queue.enqueue([c9, c2], { autoPublish: false }), { queued: 2, skipped: 0 }) // ชุดเดียวกันเรียงตามเลขตอน: 2 ก่อน 9
  assert.equal(getChapter(db, c5).updated_at, NOW_SQL)
  assert.deepEqual([await queue.tick(), await queue.tick(), await queue.tick(), await queue.tick()], ["done", "done", "done", "idle"])
  const order = translateCalls(fake).map((c) => /ต้นฉบับ-(\d)/.exec(c.user)![1])
  assert.deepEqual(order, ["5", "2", "9"])
  assert.deepEqual(translating, [1, 1, 1], "ระหว่างแปล มีตอนเดียวที่เป็น translating")
  for (const id of [c5, c2, c9]) assert.equal(getChapter(db, id).status, "done")
})

test("แปลเสร็จหนึ่งตอน: เขียนคำแปล เรื่องย่อ ชื่อไทย (เฉพาะที่ว่าง) คำศัพท์ (ไม่ทับของเดิม) และ usage แยกตามโมเดล", async () => {
  const { db, queue, novelId, fake } = setup({
    translate: () => ({ text: "  คำแปลของตอนนี้ \n", usage: { inputTokens: 1000, outputTokens: 400 } }),
    notes: () => ({
      recap: "สรุปตอน",
      titleTh: "ชื่อจาก AI",
      terms: [
        { source: "Ayla", thai: "อายล่า" },
        { source: "Rook", thai: "รุก", note: "เมือง" },
      ],
      usage: { inputTokens: 300, outputTokens: 60 },
    }),
  })
  seedGlossary(db, novelId, [{ source: "Ayla", thai: "ไอร่า", note: "เจ้าของตั้ง" }])
  const empty = seedChapter(db, novelId, 1, { title: "Chapter One", source: "Once upon a time." })
  const owned = seedChapter(db, novelId, 2, { titleTh: "ชื่อที่เจ้าของตั้ง" })
  queue.enqueue([empty, owned], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  assert.equal(await queue.tick(), "done")

  const a = getChapter(db, empty)
  assert.equal(a.status, "done")
  assert.equal(a.translation, "คำแปลของตอนนี้")
  assert.equal(a.recap, "สรุปตอน")
  assert.equal(a.title_th, "ชื่อจาก AI")
  assert.equal(a.error, "")
  assert.equal(a.queue_seq, null)
  assert.equal(a.translated_at, NOW_SQL)
  assert.equal(getChapter(db, owned).title_th, "ชื่อที่เจ้าของตั้ง")
  assert.deepEqual(
    db.all("SELECT source, thai, note, auto FROM glossary WHERE novel_id = ? ORDER BY source", novelId),
    [
      { source: "Ayla", thai: "ไอร่า", note: "เจ้าของตั้ง", auto: 0 },
      { source: "Rook", thai: "รุก", note: "เมือง", auto: 1 },
    ],
  )
  assert.deepEqual(db.all("SELECT day, model, tokens_in, tokens_out, calls FROM usage ORDER BY model"), [
    { day: "2026-10-22", model: "m-recap", tokens_in: 600, tokens_out: 120, calls: 2 },
    { day: "2026-10-22", model: "m-translate", tokens_in: 2000, tokens_out: 800, calls: 2 },
  ])

  const [t1] = translateCalls(fake)
  assert.equal(t1!.model, "m-translate")
  assert.equal(t1!.maxTokens, 8000)
  const [n1, n2] = notesCalls(fake)
  assert.deepEqual(
    { ...n1, method: undefined },
    { method: undefined, model: "m-recap", thaiText: "คำแปลของตอนนี้", sourceTitle: "Chapter One", sourceText: "Once upon a time.", knownTerms: ["Ayla"] },
  )
  assert.deepEqual(n2!.knownTerms, ["Ayla", "Rook"], "อภิธานอ่านใหม่ทุกตอน จึงเห็นศัพท์ที่ตอนก่อนเพิ่งเพิ่ม")
})

test("ตอนยาว 3 ชิ้น: translateChunk 3 ครั้ง ชิ้นถัดไปได้ท้าย 800 ตัวอักษรของชิ้นก่อน และ state().current บอกลำดับชิ้น", async () => {
  const { db, queue, novelId, fake } = setup()
  const outputs = ["Z".repeat(100) + "ก".repeat(900), "ข".repeat(50), "ค".repeat(50)]
  const snapshots: unknown[] = []
  fake.script.translate = ({ n }) => {
    const cur = queue.state().current
    snapshots.push(cur && [cur.chunkIndex, cur.chunkTotal])
    return outputs[n - 1]
  }
  const id = seedChapter(db, novelId, 7, { source: ["A", "B", "C"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "done")

  const calls = translateCalls(fake)
  assert.equal(calls.length, 3)
  assert.ok(calls[0]!.user.includes("A".repeat(4000)) && !calls[0]!.user.includes("B"))
  assert.ok(!calls[0]!.user.includes("previous_output_tail"), "ชิ้นแรกไม่มีท้ายของชิ้นก่อน")
  calls.forEach((c, i) => assert.ok(c.user.startsWith(`ชิ้นที่ ${i + 1}/3 ของตอนนี้`), `ชิ้นที่ ${i + 1}: ${c.user.slice(0, 30)}`))
  assert.ok(calls[1]!.user.includes("ก".repeat(800)) && !calls[1]!.user.includes("ก".repeat(801)), "ท้าย 800 ตัวอักษรพอดี")
  assert.ok(!calls[1]!.user.includes("Z"), "ส่วนต้นของชิ้นก่อนไม่ถูกส่งซ้ำ")
  assert.ok(calls[2]!.user.includes("ข".repeat(50)) && !calls[2]!.user.includes("ก".repeat(20)), "ชิ้นที่ 3 ได้ท้ายของชิ้นที่ 2 เท่านั้น")
  assert.deepEqual(snapshots, [
    [0, 3],
    [1, 3],
    [2, 3],
  ])
  assert.equal(getChapter(db, id).translation, outputs.join("\n\n"))
  assert.equal(queue.state().current, null)
})

test("system ที่ส่งให้ Claude คือ buildContext ของตอนนั้น: มีเรื่องย่อไม่เกิน 5 ตอนก่อนหน้า ไม่มีของตอนหลัง", async () => {
  const { db, queue, novelId, fake } = setup()
  seedGlossary(db, novelId, [{ source: "Ayla", thai: "ไอร่า" }])
  for (let n = 1; n <= 7; n++) seedChapter(db, novelId, n, { status: "done", translation: "แปล", recap: `เรื่องย่อของตอน ${n}` })
  const current = seedChapter(db, novelId, 8)
  seedChapter(db, novelId, 9, { status: "done", translation: "แปล", recap: "เรื่องย่อของตอน 9" })
  const expected = buildContext(db, current)!.system
  queue.enqueue([current], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  const system = translateCalls(fake)[0]!.system
  assert.equal(system, expected)
  for (const n of [3, 4, 5, 6, 7]) assert.ok(system.includes(`ตอนที่ ${n}: เรื่องย่อของตอน ${n}`), `ตอน ${n}`)
  for (const n of [1, 2, 9]) assert.ok(!system.includes(`เรื่องย่อของตอน ${n}`), `ตอน ${n}`)
  assert.ok(system.includes("Ayla → ไอร่า"))
})

test("auto_publish: สั่งแปลแบบเผยแพร่เอง → เผยแพร่ ตั้ง published_at; ไม่สั่ง → ไม่เผยแพร่", async () => {
  const { db, queue, novelId } = setup()
  const pub = seedChapter(db, novelId, 1)
  const hide = seedChapter(db, novelId, 2)
  queue.enqueue([pub], { autoPublish: true })
  queue.enqueue([hide], { autoPublish: false })
  await queue.tick()
  await queue.tick()
  const a = getChapter(db, pub)
  assert.equal(a.published, 1)
  assert.equal(a.published_at, NOW_SQL)
  const b = getChapter(db, hide)
  assert.equal(b.published, 0)
  assert.equal(b.published_at, null)
})

test("ต้นฉบับว่างเปล่า (ไม่มีชิ้นให้แปล): ตอนเป็น error ข้อความบอกชัด และไม่เรียก Claude", async () => {
  const { db, queue, novelId, fake, logs } = setup()
  const id = seedChapter(db, novelId, 1, { source: "  \n\n " })
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "error")
  const c = getChapter(db, id)
  assert.equal(c.status, "error")
  assert.equal(c.error, "ไม่มีต้นฉบับให้แปล")
  assert.equal(fake.calls.length, 0)
  assert.ok(logs.some((l) => l.startsWith("warn:") && l.includes("ไม่มีต้นฉบับให้แปล")) && !logs.some((l) => l.startsWith("error:")), logs.join("\n"))
})

test("ตอนที่ถูกเปลี่ยนเป็น done ระหว่างรอคิว (นำเข้า) ไม่ถูกหยิบไปแปล", async () => {
  const { db, queue, novelId, fake } = setup()
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  db.run("UPDATE chapters SET status = 'done', translation = 'นำเข้า', queue_seq = NULL WHERE id = ?", id)
  assert.equal(await queue.tick(), "idle")
  assert.equal(fake.calls.length, 0)
  assert.equal(getChapter(db, id).translation, "นำเข้า")
})

test("ชิงหยิบตอนไม่สำเร็จ (ถูกเปลี่ยนสถานะตัดหน้า): ข้ามไปตอนถัดไปในคิว", async () => {
  const { db, queue, novelId, fake } = setup()
  const a = seedChapter(db, novelId, 1, { source: "ต้นฉบับ-a" })
  const b = seedChapter(db, novelId, 2, { source: "ต้นฉบับ-b" })
  queue.enqueue([a, b], { autoPublish: false })
  let lostOnce = false
  const racing: Db = {
    ...db,
    run(sql, ...p) {
      if (!lostOnce && sql.includes("SET status = 'translating'")) {
        lostOnce = true
        db.run("UPDATE chapters SET status = 'done', translation = 'นำเข้า', queue_seq = NULL WHERE id = ?", a) // นำเข้าแทรกเข้ามาก่อนคำสั่งหยิบ
      }
      return db.run(sql, ...p)
    },
  }
  const race = createQueue({ db: racing, settings: createSettings(db, CFG), ai: fake, now: () => NOW })
  assert.equal(await race.tick(), "done")
  assert.equal(lostOnce, true)
  assert.deepEqual(
    translateCalls(fake).map((c) => /ต้นฉบับ-(\w)/.exec(c.user)![1]),
    ["b"],
  )
  assert.equal(getChapter(db, a).translation, "นำเข้า")
  assert.equal(getChapter(db, b).status, "done")
})

// ───────────────────────── ข้อผิดพลาด ─────────────────────────

test("ผิดพลาดชั่วคราว: ตอนเป็น error พร้อมข้อความ คิวทำตอนถัดไปต่อ ตอนเดิมไม่เหลือคิว", async () => {
  const boom = new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
  const { db, queue, novelId, logs } = setup({
    translate: ({ n }) => {
      if (n === 1) throw boom
    },
  })
  const first = seedChapter(db, novelId, 1)
  const second = seedChapter(db, novelId, 2)
  queue.enqueue([first, second], { autoPublish: false })
  assert.equal(await queue.tick(), "error")
  const c = getChapter(db, first)
  assert.equal(c.status, "error")
  assert.equal(c.error, boom.message)
  assert.equal(c.queue_seq, null)
  assert.equal(c.updated_at, NOW_SQL)
  assert.ok(logs.some((l) => l.startsWith("warn:") && l.includes("ตอนที่ 1") && l.includes(boom.message)), logs.join("\n"))
  assert.ok(!logs.some((l) => l.startsWith("error:")), "ข้อผิดพลาดของ API ที่คาดไว้แล้วเป็นระดับเตือน ไม่ใช่ error")
  assert.equal(queue.state().paused, false)
  assert.equal(await queue.tick(), "done")
  assert.equal(getChapter(db, second).status, "done")
})

test("ข้อผิดพลาดที่ไม่ใช่ของ API (บั๊กหรือฐานข้อมูล) ก็ทำให้ตอนเป็น error พร้อมข้อความไทย และบันทึก log error", async () => {
  const { db, queue, novelId, logs } = setup({
    translate: () => {
      throw new TypeError("kaboom")
    },
  })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "error")
  const c = getChapter(db, id)
  assert.equal(c.status, "error")
  assert.match(c.error, /^เกิดข้อผิดพลาดที่ไม่คาดคิด: kaboom/)
  assert.ok(logs.some((l) => l.startsWith("error:") && l.includes("kaboom")))
})

test("ข้อความ error ยาวเกินถูกตัดไม่ให้ล้นช่อง", async () => {
  const { db, queue, novelId } = setup({
    translate: () => {
      throw new AiError("ย".repeat(2000), { fatal: false })
    },
  })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  await queue.tick()
  const { error } = getChapter(db, id)
  assert.equal([...error].length, 501, "ตัดที่ 500 ตัวอักษร แล้วต่อ …")
  assert.ok(error.startsWith("ย".repeat(500)) && error.endsWith("…"))
})

test("ผิดพลาดชั่วคราวติดกัน 3 ตอน → คิวหยุดเองพร้อมข้อความ เก็บเหตุผลไว้ใน settings และไม่แตะตอนที่เหลือ", async () => {
  const boom = new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
  const { db, queue, novelId, fake, settings, logs } = setup({
    translate: () => {
      throw boom
    },
  })
  const ids = [1, 2, 3, 4].map((n) => seedChapter(db, novelId, n))
  queue.enqueue(ids, { autoPublish: false })
  assert.equal(await queue.tick(), "error")
  assert.equal(await queue.tick(), "error")
  assert.equal(queue.state().consecutiveErrors, 2)
  assert.equal(queue.state().paused, false)
  assert.equal(await queue.tick(), "paused")
  const s = queue.state()
  assert.equal(s.consecutiveErrors, 3)
  assert.equal(s.paused, true)
  assert.equal(s.pausedReason, "พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API")
  assert.equal(settings.getInternal(PAUSE_KEY), s.pausedReason)
  assert.ok(logs.some((l) => l.startsWith("warn:") && l.includes("คิวแปลหยุด") && l.includes(s.pausedReason)), logs.join("\n"))
  assert.equal(getChapter(db, ids[2]!).status, "error")
  assert.equal(getChapter(db, ids[3]!).status, "queued")
  const callsBefore = fake.calls.length
  assert.equal(await queue.tick(), "paused")
  assert.equal(fake.calls.length, callsBefore, "หยุดอยู่แล้วไม่เรียก Claude")
  assert.equal(getChapter(db, ids[3]!).status, "queued")
})

test("ตอนที่สำเร็จหนึ่งตอนรีเซ็ตตัวนับ: error, error, สำเร็จ, error, error ยังไม่หยุด", async () => {
  const boom = new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
  const { db, queue, novelId } = setup({
    translate: ({ n }) => {
      if (n !== 3) throw boom
    },
  })
  const ids = [1, 2, 3, 4, 5].map((n) => seedChapter(db, novelId, n))
  queue.enqueue(ids, { autoPublish: false })
  const results = []
  for (let i = 0; i < 5; i++) results.push(await queue.tick())
  assert.deepEqual(results, ["error", "error", "done", "error", "error"])
  assert.equal(queue.state().consecutiveErrors, 2)
  assert.equal(queue.state().paused, false)
})

test("ข้อผิดพลาดร้ายแรง (401): ตอนกลับเป็น queued ยังมีเลขคิว คิวหยุด เก็บเหตุผลใน settings; resume() แล้วทำต่อได้", async () => {
  const fatal = new AiError("API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)", { fatal: true, status: 401 })
  let broken = true
  const { db, queue, novelId, fake, settings } = setup({
    translate: () => {
      if (broken) throw fatal
      return "แปลได้แล้ว"
    },
  })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const seq = getChapter(db, id).queue_seq
  assert.ok(seq !== null)
  assert.equal(await queue.tick(), "paused")
  const c = getChapter(db, id)
  assert.equal(c.status, "queued")
  assert.equal(c.queue_seq, seq)
  assert.equal(c.error, "")
  assert.equal(c.updated_at, NOW_SQL)
  const s = queue.state()
  assert.equal(s.paused, true)
  assert.equal(s.pausedReason, fatal.message)
  assert.equal(s.consecutiveErrors, 0, "ข้อผิดพลาดร้ายแรงไม่นับรวมกับตัวนับ 3 ตอน")
  assert.equal(settings.getInternal(PAUSE_KEY), fatal.message)
  assert.equal(s.waitingTotal, 1)

  const callsBefore = fake.calls.length
  assert.equal(await queue.tick(), "paused")
  assert.equal(fake.calls.length, callsBefore)

  broken = false
  queue.resume()
  assert.equal(settings.getInternal(PAUSE_KEY), "")
  assert.equal(queue.state().paused, false)
  assert.equal(await queue.tick(), "done")
  assert.equal(getChapter(db, id).translation, "แปลได้แล้ว")
})

test("ข้อผิดพลาดร้ายแรงในชิ้นที่ 2: ตอนกลับเป็น queued, usage ของชิ้นแรกที่แปลไปแล้วยังนับ, ผลครึ่งๆ กลางๆ ไม่ถูกเขียน", async () => {
  const fatal = new AiError("เครดิต API หมดหรือบัญชีมีปัญหา", { fatal: true, status: 402 })
  const { db, queue, novelId } = setup({
    translate: ({ n }) => {
      if (n === 2) throw fatal
      return "ชิ้นแรก"
    },
  })
  const id = seedChapter(db, novelId, 1, { source: ["A", "B"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "paused")
  const c = getChapter(db, id)
  assert.equal(c.status, "queued")
  assert.equal(c.translation, "")
  assert.deepEqual(usageRows(db), [{ model: "m-translate", tokens_in: 100, tokens_out: 50, calls: 1 }])
})

test("ไม่มี API key: มีงานค้างแล้วคิวหยุดด้วยข้อความที่มี ANTHROPIC_API_KEY, ไม่เรียก ai, ตอนยังเป็น queued", async () => {
  const { db, queue, novelId, fake } = setup({ hasKey: false })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "paused")
  assert.match(queue.state().pausedReason, /ANTHROPIC_API_KEY/)
  assert.equal(fake.calls.length, 0)
  const c = getChapter(db, id)
  assert.equal(c.status, "queued")
  assert.ok(c.queue_seq !== null)
})

test("ไม่มี API key แต่ไม่มีงานในคิว: ว่างเฉยๆ ไม่หยุดคิว (ใช้ช่องทางนำเข้าอย่างเดียวได้โดยไม่ต้องมี key)", async () => {
  const { queue } = setup({ hasKey: false })
  assert.equal(await queue.tick(), "idle")
  assert.equal(queue.state().paused, false)
})

test("แปลใหม่ของตอนที่เผยแพร่แล้วล้มเหลว: status เป็น error แต่คำแปลเดิมและ published ยังอยู่", async () => {
  const { db, queue, novelId } = setup({
    translate: () => {
      throw new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
    },
  })
  const id = seedChapter(db, novelId, 1, { status: "done", translation: "คำแปลเดิม", published: true, publishedAt: "2026-02-01 08:00:00", recap: "เรื่องย่อเดิม" })
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "error")
  const c = getChapter(db, id)
  assert.equal(c.status, "error")
  assert.equal(c.translation, "คำแปลเดิม")
  assert.equal(c.published, 1)
  assert.equal(c.published_at, "2026-02-01 08:00:00")
  assert.equal(c.recap, "เรื่องย่อเดิม")
})

test("สรุปตอนล้มเหลว: ตอนยังเป็น done ไม่มีเรื่องย่อ (เรื่องย่อเก่าของคำแปลเดิมถูกล้าง) ไม่มีคำศัพท์ใหม่ และมี log เตือน", async () => {
  const { db, queue, novelId, logs } = setup({
    notes: () => {
      throw new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
    },
  })
  const id = seedChapter(db, novelId, 1, { recap: "เรื่องย่อเดิม" })
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  const c = getChapter(db, id)
  assert.equal(c.status, "done")
  assert.ok(c.translation.length > 0)
  assert.equal(c.recap, null)
  assert.equal(c.title_th, "")
  assert.equal(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM glossary")!.c, 0)
  assert.ok(logs.some((l) => l.startsWith("warn:") && l.includes("สรุปตอน")), logs.join("\n"))
  assert.deepEqual(usageRows(db).map((r) => r.model), ["m-translate"])
  assert.equal(queue.state().consecutiveErrors, 0, "สรุปตอนล้มเหลวไม่นับเป็นความผิดพลาดของตอน")
})

test("บันทึก usage ไม่สำเร็จ (ฐานข้อมูลมีปัญหา) ต้องไม่ทำให้ตอนที่แปลเสร็จแล้วกลายเป็น error", async () => {
  const { db, queue, novelId, logs } = setup()
  db.exec("DROP TABLE usage")
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  assert.equal(getChapter(db, id).status, "done")
  assert.ok(logs.some((l) => l.startsWith("warn:") && l.includes("usage")), logs.join("\n"))
})

// ───────────────────────── หยุด / ทำต่อ / กู้คืน ─────────────────────────

test("pause(): ไม่หยิบตอนถัดไป ไม่เรียก ai เก็บเหตุผลไว้ (รีสตาร์ทแล้วยังหยุดอยู่) ; เหตุผลว่างใช้ข้อความมาตรฐาน; resume() ล้างเหตุผลและตัวนับ", async () => {
  const boom = new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
  const { db, queue, novelId, fake, settings } = setup({
    translate: ({ n }) => {
      if (n === 1) throw boom
    },
  })
  const [a, b] = [1, 2].map((n) => seedChapter(db, novelId, n))
  queue.enqueue([a!, b!], { autoPublish: false })
  await queue.tick() // error → consecutiveErrors = 1
  assert.equal(queue.state().consecutiveErrors, 1)

  queue.pause("หยุดเพื่อตรวจสอบ")
  assert.deepEqual([queue.state().paused, queue.state().pausedReason], [true, "หยุดเพื่อตรวจสอบ"])
  const calls = fake.calls.length
  assert.equal(await queue.tick(), "paused")
  assert.equal(fake.calls.length, calls)
  assert.equal(getChapter(db, b!).status, "queued")

  const restarted = createQueue({ db, settings, ai: fake, now: () => NOW })
  assert.equal(restarted.state().paused, true)
  assert.equal(await restarted.tick(), "paused")

  queue.pause("   ")
  assert.equal(queue.state().pausedReason, "หยุดโดยผู้ดูแล")

  queue.resume()
  assert.equal(settings.getInternal(PAUSE_KEY), "")
  assert.equal(queue.state().paused, false)
  assert.equal(queue.state().consecutiveErrors, 0)
  assert.equal(await queue.tick(), "done")
})

test("pause() ระหว่างแปล: ตอนที่กำลังทำจนจบ แต่ไม่หยิบตอนถัดไป", async () => {
  const { db, queue, novelId, entered, release } = setupGated({ partial: "เริ่ม" })
  const [a, b] = [1, 2].map((n) => seedChapter(db, novelId, n))
  queue.enqueue([a!, b!], { autoPublish: false })
  const first = queue.tick()
  await entered
  queue.pause("หยุดโดยผู้ดูแล")
  release()
  assert.equal(await first, "done")
  assert.equal(getChapter(db, a!).status, "done")
  assert.equal(await queue.tick(), "paused")
  assert.equal(getChapter(db, b!).status, "queued")
})

test("recoverOnStart: translating → queued (เลขคิวเดิม) ส่วนสถานะอื่นไม่ถูกแตะ และตัวนับความผิดพลาดเริ่มใหม่", async () => {
  const { db, queue, novelId } = setup({
    translate: () => {
      throw new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
    },
  })
  const bump = seedChapter(db, novelId, 9)
  queue.enqueue([bump], { autoPublish: false })
  assert.equal(await queue.tick(), "error") // ให้ตัวนับความผิดพลาดไม่เป็น 0 ก่อนกู้คืน
  assert.equal(queue.state().consecutiveErrors, 1)
  const stuck = seedChapter(db, novelId, 1, { status: "translating", queueSeq: 4 })
  const waiting = seedChapter(db, novelId, 2, { status: "queued", queueSeq: 5 })
  const done = seedChapter(db, novelId, 3, { status: "done", translation: "แปล" })
  const failed = seedChapter(db, novelId, 4, { status: "error", error: "เก่า" })

  queue.recoverOnStart()
  const s = getChapter(db, stuck)
  assert.equal(s.status, "queued")
  assert.equal(s.queue_seq, 4)
  assert.equal(s.updated_at, NOW_SQL)
  assert.equal(getChapter(db, waiting).status, "queued")
  assert.equal(getChapter(db, done).status, "done")
  assert.equal(getChapter(db, failed).status, "error")
  assert.equal(getChapter(db, failed).error, "เก่า")
  assert.equal(queue.state().consecutiveErrors, 0)
})

// ───────────────────────── ยกเลิก / ปิดเครื่อง (Review Focus 2) ─────────────────────────

test("cancelIfCurrent กลางสตรีม + ลบแถว: ไม่มีแถวกลับมา ไม่เขียน usage/คำศัพท์/สรุป tick จบ และตอนถัดไปถูกทำต่อ", async () => {
  const { db, queue, novelId, fake, entered, release } = setupGated({ partial: "กำลังแปล..." })
  const doomed = seedChapter(db, novelId, 1)
  const next = seedChapter(db, novelId, 2)
  queue.enqueue([doomed, next], { autoPublish: false })
  const p = queue.tick()
  await entered
  assert.equal(queue.state().current?.chapterId, doomed)
  assert.equal(queue.cancelIfCurrent([9999]), false, "ตอนอื่นไม่ถูกยกเลิก")
  assert.equal(queue.cancelIfCurrent([doomed]), true)
  db.run("DELETE FROM chapters WHERE id = ?", doomed) // เหมือนเส้นทางลบ: cancel แล้วลบทันที
  assert.equal(await p, "done")

  assert.equal(db.get("SELECT id FROM chapters WHERE id = ?", doomed), undefined, "แถวที่ลบไม่ถูกสร้างกลับมา")
  assert.deepEqual(usageRows(db), [])
  assert.equal(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM glossary")!.c, 0)
  assert.equal(notesCalls(fake).length, 0)
  assert.equal(queue.state().current, null)
  assert.equal(queue.state().consecutiveErrors, 0)
  assert.equal(queue.state().paused, false)

  release() // ปล่อยให้ตอนถัดไปผ่านเกต (เกตตัวนี้หยุดเฉพาะครั้งแรกที่ยังไม่ถูกปล่อย)
  assert.equal(await queue.tick(), "done")
  assert.equal(getChapter(db, next).status, "done")
})

test("cancelIfCurrent กลางชิ้นที่ 2 ของ 3: usage ของชิ้นแรกยังอยู่ แต่ไม่มีการเขียนเพิ่มหลังยกเลิก และไม่เรียกสรุปตอน", async () => {
  const { db, queue, novelId, fake, entered } = setupGated({ partial: "ชิ้นสอง...", onlyCall: 2 })
  const id = seedChapter(db, novelId, 1, { source: ["A", "B", "C"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  assert.equal(queue.state().current?.chunkIndex, 1)
  queue.cancelIfCurrent([id])
  db.run("DELETE FROM chapters WHERE id = ?", id)
  assert.equal(await p, "done")
  assert.deepEqual(usageRows(db), [{ model: "m-translate", tokens_in: 100, tokens_out: 50, calls: 1 }])
  assert.equal(notesCalls(fake).length, 0)
  assert.equal(db.get("SELECT id FROM chapters WHERE id = ?", id), undefined)
})

test("stop() ระหว่างสตรีม: ยกเลิกสตรีม ตอนกลับเป็น queued (เลขคิวเดิม) ไม่เป็น error ไม่เขียน usage และ stop() จบเอง", async () => {
  const { db, queue, novelId, entered } = setupGated({ partial: "กำลังแปล..." })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const seq = getChapter(db, id).queue_seq
  queue.start()
  await entered
  assert.equal(getChapter(db, id).status, "translating")
  await queue.stop()
  const c = getChapter(db, id)
  assert.equal(c.status, "queued")
  assert.equal(c.queue_seq, seq)
  assert.equal(c.error, "")
  assert.deepEqual(usageRows(db), [])
  assert.equal(queue.state().current, null)
  assert.equal(queue.state().paused, false)
  assert.equal(queue.state().consecutiveErrors, 0)
  await queue.stop() // เรียกซ้ำได้
})

test("stop() ระหว่าง tick() ที่เรียกเอง (ไม่ได้ start): รอ tick นั้นจบและคืนตอนเข้าคิว", async () => {
  const { db, queue, novelId, entered, release } = setupDeaf() // Claude ตอบช้ากว่าที่ stop() จะกลับ ถ้า stop() ไม่รอ tick สถานะจะยังเป็น translating
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  const stopping = queue.stop()
  release()
  await stopping
  assert.equal(getChapter(db, id).status, "queued")
  assert.equal(await p, "idle")
})

// ───────────────────────── สถานะสด ─────────────────────────

test("state(): ตอนที่กำลังแปล (ชื่อเรื่องไทย เลขตอน ชิ้น) และ textTail ไม่เกิน 2000 ตัวอักษร ต่อเนื่องข้ามชิ้น", async () => {
  const { db, queue, novelId, entered, release } = setupGated({ partial: ["ข".repeat(4), "ข".repeat(6)], onlyCall: 2 }, { translate: ({ n }) => (n === 1 ? "ก".repeat(100) : "ถ") })
  const id = seedChapter(db, novelId, 7, { source: ["A", "B"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  const cur = queue.state().current!
  assert.equal(getChapter(db, id).updated_at, NOW_SQL, "ตอนที่หยิบมาแปลถูกแตะเวลา")
  assert.equal(queue.state().waitingTotal, 0, "ตอนที่กำลังแปลไม่นับเป็นรอคิว")
  assert.deepEqual(queue.state().waiting, [])
  assert.equal(cur.chapterId, id)
  assert.equal(cur.novelId, novelId)
  assert.equal(cur.novelTitle, "ฤๅษีดันเจี้ยน")
  assert.equal(cur.number, 7)
  assert.deepEqual([cur.chunkIndex, cur.chunkTotal], [1, 2])
  assert.equal(cur.textTail, "ก".repeat(100) + "\n\n" + "ข".repeat(10))
  release()
  await p
  assert.equal(queue.state().current, null)
})

test("state().current.textTail ตัดเหลือท้าย 2000 ตัวอักษรพอดี (นับตัวอักษรจริง ไม่ผ่าผ่านกลาง emoji)", async () => {
  // ความยาวรวม 4000 หน่วย UTF-16: ตัดท้าย 2000 หน่วยแบบเดิมจะผ่ากลาง emoji พอดี
  const streamed = "ก".repeat(1499) + "😀".repeat(1000) + "ข".repeat(501)
  const { db, queue, novelId, entered, release } = setupGated({ partial: streamed })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  const tail = queue.state().current!.textTail
  assert.equal(Array.from(tail).length, 2000)
  assert.equal(tail, Array.from(streamed).slice(-2000).join(""))
  assert.ok(!/^[\udc00-\udfff]/.test(tail), "ไม่ขึ้นต้นด้วยครึ่งหลังของ emoji")
  release()
  await p
})

test("state(): รอคิวไม่เกิน 50 รายการเรียงตาม queue_seq พร้อมชื่อเรื่อง (ชื่อไทยถ้ามี ไม่มีใช้ชื่อเดิม) และ waitingTotal นับทั้งหมด", () => {
  const { db, queue, novelId } = setup()
  const plain = seedNovel(db, { title: "Plain Title" })
  seedChapter(db, novelId, 100, { status: "done", translation: "แปล" }) // ให้ id ของตอนที่รอคิวไม่ซ้ำกับ id ของเรื่อง
  const ids: number[] = []
  for (let n = 1; n <= 55; n++) ids.push(seedChapter(db, n % 2 ? novelId : plain, n))
  queue.enqueue(ids, { autoPublish: false })
  const s = queue.state()
  assert.equal(s.waitingTotal, 55)
  assert.equal(s.waiting.length, 50)
  // enqueueChapters เรียงตาม (novel_id, number): เรื่องแรกก่อน (เลขคี่ 1,3,5,…) แล้วเรื่องที่สอง (เลขคู่)
  assert.notEqual(ids[0], novelId)
  assert.deepEqual(s.waiting[0], { id: ids[0]!, novelId, novelTitle: "ฤๅษีดันเจี้ยน", number: 1 })
  assert.deepEqual(s.waiting.slice(0, 3).map((w) => w.number), [1, 3, 5])
  const firstOfSecond = s.waiting.find((w) => w.novelId === plain)!
  assert.equal(firstOfSecond.novelTitle, "Plain Title")
  assert.equal(firstOfSecond.number, 2)
  assert.equal(s.current, null)
})

// ───────────────────────── start / wake ─────────────────────────

test("start(): วนทำงานเอง และ enqueue() ปลุกให้ทำทันที (ไม่ต้องรอรอบ 5 วินาที); stop() แล้วหยุดจริง", async () => {
  const { db, queue, novelId } = setup()
  queue.start()
  queue.start() // เรียกซ้ำไม่เปิดลูปที่สอง
  await new Promise((r) => setTimeout(r, 30)) // ให้ลูปทำ tick แรก (ว่าง) แล้วเข้าสู่การรอ
  const a = seedChapter(db, novelId, 1)
  const b = seedChapter(db, novelId, 2)
  queue.enqueue([a, b], { autoPublish: false })
  await until(() => getChapter(db, a).status === "done" && getChapter(db, b).status === "done", 1500)
  await new Promise((r) => setTimeout(r, 30)) // ให้ลูปกลับไปรอรอบถัดไป
  const t0 = Date.now()
  await queue.stop()
  assert.ok(Date.now() - t0 < 1000, `stop() ต้องปลุกลูปที่กำลังรอ ใช้เวลา ${Date.now() - t0} ms`)
  const c = seedChapter(db, novelId, 3)
  queue.enqueue([c], { autoPublish: false })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(getChapter(db, c).status, "queued", "หลัง stop() ไม่มีใครหยิบงาน")
})

test("start() แล้วคิวหยุดอยู่: ลูปไม่เรียก ai แต่ resume() ปลุกให้ทำต่อทันที", async () => {
  const { db, queue, novelId, fake } = setup()
  const id = seedChapter(db, novelId, 1)
  queue.pause("หยุดโดยผู้ดูแล")
  queue.enqueue([id], { autoPublish: false })
  queue.start()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(fake.calls.length, 0)
  queue.resume()
  await until(() => getChapter(db, id).status === "done", 1500)
  await queue.stop()
})

// ───────────────────────── แถวเปลี่ยนมือระหว่างแปล (Review Focus 2) ─────────────────────────

/** ตอนถูกนำเข้าระหว่างที่คิวกำลังแปล: เหมือนเส้นทางนำเข้า (done + มีคำแปล + ไม่มีเลขคิว) */
const importMeanwhile = (db: Db, id: number) => db.run("UPDATE chapters SET status = 'done', translation = 'นำเข้า', queue_seq = NULL WHERE id = ?", id)

/** `translateChunk` ที่ไม่สนใจ signal: ส่งข้อความบางส่วนแล้วรอ `release()` จึงคืนผลปกติ (ผลมาถึงหลังถูกสั่งยกเลิกไปแล้ว) */
function setupDeaf(script: FakeScript = {}) {
  const entered = deferred()
  const release = deferred()
  const ctx = setup(script, (base) => ({
    hasKey: () => base.hasKey(),
    chapterNotes: (p) => base.chapterNotes(p),
    fillNovel: (p) => base.fillNovel(p),
    ping: (m) => base.ping(m),
    async translateChunk(p) {
      p.onText("กำลังแปล...")
      entered.resolve()
      await release.promise
      return base.translateChunk({ ...p, signal: undefined })
    },
  }))
  return { ...ctx, entered: entered.promise, release: release.resolve }
}

/** `chapterNotes` ที่หยุดรอ `release()` (ไม่มี signal ให้ยกเลิก ต้องรอให้การเรียกนั้นจบเอง) */
function setupNotesGated(script: FakeScript = {}, onEnter?: () => void) {
  const entered = deferred()
  const release = deferred()
  const ctx = setup(script, (base) => ({
    hasKey: () => base.hasKey(),
    translateChunk: (p) => base.translateChunk(p),
    fillNovel: (p) => base.fillNovel(p),
    ping: (m) => base.ping(m),
    async chapterNotes(p) {
      onEnter?.()
      entered.resolve()
      await release.promise
      return base.chapterNotes(p)
    },
  }))
  return { ...ctx, entered: entered.promise, release: release.resolve }
}

const flush = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r))
}

const glossaryCount = (db: Db) => db.get<{ c: number }>("SELECT COUNT(*) AS c FROM glossary")!.c

test("ตอนถูกนำเข้าระหว่างแปล: ทิ้งผลของ Claude ไม่ทับของที่นำเข้า ไม่เผยแพร่ ไม่เรียกสรุปตอน ไม่เขียน usage/คำศัพท์", async () => {
  const { db, queue, novelId, fake, entered, release } = setupGated({ partial: "กำลังแปล..." }, { notes: () => ({ terms: [{ source: "Ayla", thai: "อายล่า" }] }) })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: true })
  const p = queue.tick()
  await entered
  importMeanwhile(db, id)
  release()
  assert.equal(await p, "done")
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation, c.published], ["done", "นำเข้า", 0])
  assert.equal(notesCalls(fake).length, 0)
  assert.deepEqual(usageRows(db), [])
  assert.equal(glossaryCount(db), 0)
  assert.equal(queue.state().current, null)
  assert.equal(queue.state().consecutiveErrors, 0)
})

test("ตอนถูกนำเข้าระหว่างชิ้นแรกของ 3: ไม่เสียเงินแปลชิ้นที่เหลือ", async () => {
  const { db, queue, novelId, fake, entered, release } = setupGated({ partial: "ชิ้นแรก...", onlyCall: 1 })
  const id = seedChapter(db, novelId, 1, { source: ["A", "B", "C"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  importMeanwhile(db, id)
  release()
  assert.equal(await p, "done")
  assert.equal(translateCalls(fake).length, 1)
  assert.equal(getChapter(db, id).translation, "นำเข้า")
})

test("ตอนถูกนำเข้าระหว่างสรุปตอน: ไม่ทับ ไม่เขียน usage ของการสรุป ไม่เพิ่มคำศัพท์", async () => {
  const { db, queue, novelId, entered, release } = setupNotesGated({ notes: () => ({ terms: [{ source: "Ayla", thai: "อายล่า" }] }) })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: true })
  const p = queue.tick()
  await entered
  importMeanwhile(db, id)
  release()
  assert.equal(await p, "done")
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation, c.published], ["done", "นำเข้า", 0])
  assert.deepEqual(usageRows(db).map((r) => r.model), ["m-translate"], "ชิ้นที่แปลเสร็จก่อนถูกนำเข้ายังนับ แต่การสรุปที่ถูกทิ้งไม่นับ")
  assert.equal(glossaryCount(db), 0)
})

test("ตอนถูกลบกลางทางโดยไม่ได้สั่งยกเลิก: ทิ้งผล ไม่มีแถวกลับมา ไม่เรียกสรุปตอน", async () => {
  const { db, queue, novelId, fake, entered, release } = setupGated({ partial: "กำลังแปล..." })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  db.run("DELETE FROM chapters WHERE id = ?", id)
  release()
  assert.equal(await p, "done")
  assert.equal(db.get("SELECT id FROM chapters WHERE id = ?", id), undefined)
  assert.equal(notesCalls(fake).length, 0)
  assert.deepEqual(usageRows(db), [])
})

test("stop() ระหว่างสตรีมของตอนที่ถูกนำเข้าไปแล้ว: ไม่ดึงกลับเป็น queued", async () => {
  const { db, queue, novelId, entered } = setupGated({ partial: "กำลังแปล..." })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  queue.start()
  await entered
  importMeanwhile(db, id)
  await queue.stop()
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation], ["done", "นำเข้า"])
})

test("ผิดพลาดชั่วคราวหลังตอนถูกนำเข้าไปแล้ว: ไม่ทับสถานะ done ของที่นำเข้าเป็น error (แต่ความผิดพลาดของ API ยังนับ)", async () => {
  const { db, queue, novelId, entered, release } = setupGated(
    { partial: "กำลังแปล..." },
    {
      translate: () => {
        throw new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
      },
    },
  )
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  importMeanwhile(db, id)
  release()
  assert.equal(await p, "error")
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation, c.error], ["done", "นำเข้า", ""])
  assert.equal(queue.state().consecutiveErrors, 1)
})

test("cancelIfCurrent แล้ว Claude ส่งผลมาหลังยกเลิก: ทิ้งเงียบๆ ไม่แตะแถว ไม่เขียน usage ไม่เรียกสรุปตอน", async () => {
  const { db, queue, novelId, fake, entered, release } = setupDeaf()
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: true })
  const p = queue.tick()
  await entered
  assert.equal(queue.cancelIfCurrent([id]), true)
  release()
  assert.equal(await p, "done")
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation, c.published, c.error], ["translating", "", 0, ""], "ผู้สั่งยกเลิกเป็นคนจัดการแถวเอง คิวไม่แตะ")
  assert.deepEqual(usageRows(db), [])
  assert.equal(notesCalls(fake).length, 0)
  assert.equal(queue.state().current, null)
  assert.equal(queue.state().consecutiveErrors, 0)
})

test("stop() แล้ว Claude ส่งผลมาหลังถูกสั่งหยุด: ตอนกลับเป็น queued ไม่เขียนคำแปลและ usage", async () => {
  const { db, queue, novelId, fake, entered, release } = setupDeaf()
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const seq = getChapter(db, id).queue_seq
  queue.start()
  await entered
  const stopping = queue.stop()
  release()
  await stopping
  const c = getChapter(db, id)
  assert.deepEqual([c.status, c.translation, c.queue_seq], ["queued", "", seq])
  assert.deepEqual(usageRows(db), [])
  assert.equal(notesCalls(fake).length, 0)
})

test("stop() ระหว่างสรุปตอน: ไม่รอ Claude ที่ค้าง คืนตอนเข้าคิว ไม่เขียนคำแปลที่ได้มา และผลสรุปที่มาทีหลังถูกทิ้ง", async () => {
  const { db, queue, novelId, entered, release, logs } = setupNotesGated()
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  queue.start()
  await entered
  await queue.stop() // การสรุปยังค้างอยู่ (ยังไม่ release) แต่ stop() ต้องกลับมาได้
  const before = getChapter(db, id)
  assert.deepEqual([before.status, before.translation, before.recap], ["queued", "", null])
  release() // การสรุปที่ค้างเสร็จทีหลัง: ต้องไม่มีผลใดๆ
  await flush()
  const after = getChapter(db, id)
  assert.deepEqual([after.status, after.translation, after.recap], ["queued", "", null])
  assert.deepEqual(usageRows(db), [{ model: "m-translate", tokens_in: 100, tokens_out: 50, calls: 1 }])
  assert.ok(!logs.some((l) => l.includes("สรุปตอนที่")), "การถูกสั่งหยุดไม่ใช่ความล้มเหลวของการสรุปตอน:\n" + logs.join("\n"))
})

test("cancelIfCurrent ระหว่างสรุปตอน + ลบแถว: ไม่มีแถวกลับมา ไม่เขียนคำศัพท์ ไม่นับ usage ของการสรุป", async () => {
  const { db, queue, novelId, entered, release } = setupNotesGated({ notes: () => ({ terms: [{ source: "Ayla", thai: "อายล่า" }] }) })
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  assert.equal(queue.cancelIfCurrent([id]), true)
  db.run("DELETE FROM chapters WHERE id = ?", id)
  assert.equal(await p, "done") // ไม่ต้องรอ Claude ที่ยังค้างอยู่
  release()
  await flush()
  assert.equal(db.get("SELECT id FROM chapters WHERE id = ?", id), undefined)
  assert.equal(glossaryCount(db), 0)
  assert.deepEqual(usageRows(db).map((r) => r.model), ["m-translate"])
})

test("ถูกยกเลิกก่อนเริ่มรอ Claude สรุปตอน (ยกเลิกระหว่างที่กำลังเรียก): ออกทันที ไม่รอการสรุปที่ค้าง", async () => {
  let q!: Queue
  let id!: number
  const { db, queue, novelId, release } = setupNotesGated({}, () => q.cancelIfCurrent([id]))
  q = queue
  id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  assert.equal(getChapter(db, id).translation, "", "ผลที่ได้ไม่ถูกเขียน")
  release()
  await flush()
})

test("ตอนเดียวในคิวถูกชิงไปก่อนหยิบ: ว่างเฉยๆ ไม่เรียก Claude ไม่เป็น error", async () => {
  const { db, queue, novelId, fake } = setup()
  const a = seedChapter(db, novelId, 1)
  queue.enqueue([a], { autoPublish: false })
  const racing: Db = {
    ...db,
    run(sql, ...p) {
      if (sql.includes("SET status = 'translating'")) db.run("UPDATE chapters SET status = 'done', translation = 'นำเข้า', queue_seq = NULL WHERE id = ?", a)
      return db.run(sql, ...p)
    },
  }
  const race = createQueue({ db: racing, settings: createSettings(db, CFG), ai: fake, now: () => NOW })
  assert.equal(await race.tick(), "idle")
  assert.equal(fake.calls.length, 0)
  assert.equal(getChapter(db, a).translation, "นำเข้า")
  assert.equal(race.state().consecutiveErrors, 0)
})

// ───────────────────────── ขนาดชิ้น / ชื่อเรื่องที่แสดง ─────────────────────────

test("ขนาดชิ้นตามโหมดของเรื่อง: ต้นฉบับ 5,904 ตัวอักษร โหมดแปลตรง 2 ชิ้น โหมดเล่าเรื่อง 1 ชิ้น", async () => {
  const { db, queue, novelId, fake } = setup()
  const story = seedNovel(db, { title: "Story Book", mode: "story" })
  const source = ["ก".repeat(2000), "ข".repeat(2000), "ค".repeat(1900)].join("\n\n")
  const literal = seedChapter(db, novelId, 1, { source })
  const told = seedChapter(db, story, 1, { source })
  queue.enqueue([literal], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  const afterLiteral = translateCalls(fake).length
  queue.enqueue([told], { autoPublish: false })
  assert.equal(await queue.tick(), "done")
  assert.deepEqual([afterLiteral, translateCalls(fake).length - afterLiteral], [2, 1])
})

test("state().current ใช้ชื่อเรื่องเดิมเมื่อไม่มีชื่อไทย", async () => {
  const { db, queue, entered, release } = setupGated({ partial: "..." })
  const plain = seedNovel(db, { title: "Plain Title" })
  const id = seedChapter(db, plain, 3)
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  assert.equal(queue.state().current?.novelTitle, "Plain Title")
  release()
  await p
})

// ───────────────────────── ลูป: ปลุก / หลับ / ทนข้อผิดพลาด ─────────────────────────

test("start() สองครั้งติดกันตอนมีงานค้าง: ยังทำทีละตอน (ไม่เปิดลูปที่สอง)", async () => {
  const { db, queue, novelId, fake } = setup()
  const seen: number[] = []
  fake.script.translate = () => {
    seen.push(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM chapters WHERE status = 'translating'")!.c)
    return { text: "แปล", delayMs: 20 }
  }
  const a = seedChapter(db, novelId, 1)
  const b = seedChapter(db, novelId, 2)
  queue.enqueue([a, b], { autoPublish: false })
  queue.start()
  queue.start()
  await until(() => getChapter(db, a).status === "done" && getChapter(db, b).status === "done", 1500)
  await queue.stop()
  assert.deepEqual(seen, [1, 1])
})

test("enqueue() ทันทีหลัง start() (ก่อนลูปเข้าสู่การรอ) ไม่พลาดการปลุก", async () => {
  const { db, queue, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  queue.start() // tick แรกเห็นคิวว่าง
  queue.enqueue([id], { autoPublish: false }) // ลูปยังไม่ได้เริ่มรอ จึงต้องจำการปลุกไว้
  await until(() => getChapter(db, id).status === "done", 1500)
  await queue.stop()
})

test("stop() แล้ว start() ใหม่ได้: ลูปใหม่ทำงานต่อ", async () => {
  const { db, queue, novelId } = setup()
  queue.start()
  await queue.stop()
  queue.start()
  const id = seedChapter(db, novelId, 1)
  queue.enqueue([id], { autoPublish: false })
  await until(() => getChapter(db, id).status === "done", 1500)
  await queue.stop()
})

test("ลูปไม่ตายเมื่อ tick() โยนข้อผิดพลาด (ฐานข้อมูลสะดุด): บันทึก log error แล้วทำงานต่อเมื่อถูกปลุก", async () => {
  const { db, novelId, fake } = setup()
  const { logger, lines } = memoryLogger()
  let failures = 1
  const flaky: Db = {
    ...db,
    get<T>(sql: string, ...p: unknown[]) {
      if (failures > 0 && sql.includes("FROM chapters WHERE status = 'queued'")) {
        failures--
        throw new Error("database is locked")
      }
      return db.get<T>(sql, ...p)
    },
  }
  const queue = createQueue({ db: flaky, settings: createSettings(db, CFG), ai: fake, now: () => NOW, log: logger })
  const id = seedChapter(db, novelId, 1)
  queue.start()
  await until(() => lines.some((l) => l.startsWith("error:") && l.includes("database is locked")))
  queue.enqueue([id], { autoPublish: false })
  await until(() => getChapter(db, id).status === "done", 1500)
  await queue.stop()
})

test("ลูปที่ว่างหรือหยุดอยู่หลับระหว่างรอบ ไม่วนถี่", async () => {
  const { db, fake } = setup()
  const settings = createSettings(db, CFG)
  let reads = 0
  const counting = { ...settings, getInternal: (key: string) => (reads++, settings.getInternal(key)) }
  const queue = createQueue({ db, settings: counting, ai: fake, now: () => NOW })
  queue.pause("หยุดโดยผู้ดูแล")
  queue.start()
  await new Promise((r) => setTimeout(r, 150))
  await queue.stop()
  assert.ok(reads <= 2, `ลูปอ่านสถานะหยุด ${reads} ครั้งใน 150 ms`)
})

test("ลูปที่ว่างตรวจคิวซ้ำเองทุก 5 วินาที (เผื่องานเข้ามาโดยไม่ผ่าน enqueue)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { db, queue, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  const flush = async (rounds = 30) => {
    for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r))
  }
  queue.start()
  await flush() // tick แรกว่าง → เข้าสู่การรอ 5 วินาที
  db.run("UPDATE chapters SET status = 'queued', queue_seq = 1 WHERE id = ?", id) // ไม่ผ่าน enqueue จึงไม่มีการปลุก
  t.mock.timers.tick(4999)
  await flush()
  assert.equal(getChapter(db, id).status, "queued", "ยังไม่ครบ 5 วินาที")
  t.mock.timers.tick(1)
  for (let i = 0; i < 200 && getChapter(db, id).status !== "done"; i++) await new Promise<void>((r) => setImmediate(r))
  assert.equal(getChapter(db, id).status, "done")
  await queue.stop()
})

test("state().current ระหว่างสรุปตอนเห็นคำแปลเต็มของตอน (ไม่ซ้ำท้ายชิ้นสุดท้าย)", async () => {
  const { db, queue, novelId, entered, release } = setupNotesGated({ translate: ({ n }) => ["ชิ้นหนึ่ง", "ชิ้นสอง"][n - 1] })
  const id = seedChapter(db, novelId, 1, { source: ["A", "B"].map((l) => l.repeat(4000)).join("\n\n") })
  queue.enqueue([id], { autoPublish: false })
  const p = queue.tick()
  await entered
  const cur = queue.state().current!
  assert.equal(cur.textTail, "ชิ้นหนึ่ง\n\nชิ้นสอง")
  assert.deepEqual([cur.chunkIndex, cur.chunkTotal], [1, 2])
  release()
  await p
})

test("ลูป: ตอนที่ผิดพลาดแล้วทำตอนถัดไปทันที ไม่หลับรอรอบ 5 วินาที", async () => {
  const { db, queue, novelId, fake } = setup()
  fake.script.translate = ({ n }) => {
    if (n === 1) throw new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })
  }
  const a = seedChapter(db, novelId, 1)
  const b = seedChapter(db, novelId, 2)
  queue.start()
  await new Promise((r) => setTimeout(r, 30)) // ให้ลูปว่างแล้วเข้าสู่การรอ (ไม่มีการปลุกค้างจาก enqueue มาช่วย)
  queue.enqueue([a, b], { autoPublish: false })
  await until(() => getChapter(db, b).status === "done", 1500)
  assert.equal(getChapter(db, a).status, "error")
  await queue.stop()
})
