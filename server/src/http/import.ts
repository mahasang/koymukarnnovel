import express, { Router, type RequestHandler } from "express"
import type { AppDeps } from "../app.js"
import { passwordMatches } from "../auth.js"
import { applyTranslation } from "../chapters.js"
import { buildContext } from "../context.js"
import type { Db } from "../db.js"
import { clientIp, createFailureLimiter, createRateLimiter, jsonBodyOnly, noStore, rateLimited } from "../security.js"
import { CHAPTER_STATUSES, type ChapterStatus, type Term } from "../types.js"
import { HttpError, conflict, notFound } from "../util/errors.js"
import { nowSql } from "../util/time.js"
import { toImportBriefDto, toImportChapterItemDto, type ImportChapterItemRow } from "./dto.js"
import { NOVEL, requireNovel } from "./admin/lookup.js"
import { bool, idParam, invalidField, numberParam, obj, oneOf, str } from "./validate.js"

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 60
const FAILURE_WINDOW_MS = 15 * 60_000
const FAILURE_MAX = 10
const BODY_LIMIT = "2mb"

/** ขีดจำกัดตามสเปก 7.11 (ความยาวนับหลังล้างข้อความด้วย `normalizeText`) */
const MAX = { translation: 400_000, titleTh: 300, recap: 2000, terms: 30, termSource: 200, termThai: 200, termNote: 300 } as const

/** ชื่อที่ผู้เรียกเห็นในข้อความ "ไม่พบ…" */
const CHAPTER = "ตอนที่ระบุในนิยายเรื่องนี้"

/** ชื่อฟิลด์ที่ผู้เรียกเห็นในข้อความผิดพลาด (ชื่อไทย + ชื่อฟิลด์ในคำขอ) */
const LABEL = {
  translation: "คำแปล (translation)",
  titleTh: "ชื่อตอนภาษาไทย (titleTh)",
  recap: "เรื่องย่อของตอน (recap)",
  terms: "คำศัพท์ (terms)",
  source: "ต้นฉบับของคำศัพท์ (source)",
  thai: "คำแปลของคำศัพท์ (thai)",
  note: "หมายเหตุของคำศัพท์ (note)",
  overwrite: "ทับคำแปลเดิม (overwrite)",
  status: "สถานะ (status)",
} as const

// ───────────────────────── โทเค็น ─────────────────────────

const BEARER = /^Bearer\s+(\S+)$/i

/** โทเค็นจากหัว `Authorization: Bearer <โทเค็น>` (ชื่อ scheme ไม่สนตัวพิมพ์) ไม่ตรงรูปแบบ = null · ไม่รับจากที่อื่นเลย (query, cookie, body) */
function bearerToken(header: string | undefined): string | null {
  const match = BEARER.exec(header ?? "")
  return match === null ? null : (match[1] as string)
}

// ───────────────────────── ค้นหาตอน ─────────────────────────

interface Target {
  id: number
  number: number
  status: ChapterStatus
  published: number
  has_translation: number
  novel_title: string
  novel_title_th: string
}

const FIND_CHAPTER = `
  SELECT c.id, c.status, c.published, c.translation <> '' AS has_translation, n.title AS novel_title, n.title_th AS novel_title_th
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE c.novel_id = ? AND c.number = ?`

/**
 * ตอนตามพาธ `/novels/:novelId/chapters/:number` (ไม่ดึงต้นฉบับและคำแปลที่อาจยาวหลายแสนตัวอักษร)
 * ไม่พบ → 404 บอกว่าไม่พบเรื่องหรือไม่พบตอน (ผู้เรียกมีโทเค็นแล้ว บอกได้) · ช่องทางนี้สร้างตอนไม่ได้ จึงไม่มีทางอื่นนอกจาก 404
 */
function findChapter(db: Db, novelParam: unknown, numberValue: unknown): Target {
  const novelId = idParam(novelParam, NOVEL)
  const number = numberParam(numberValue, CHAPTER)
  const found = db.get<Omit<Target, "number">>(FIND_CHAPTER, novelId, number)
  if (found !== undefined) return { ...found, number }
  requireNovel(db, novelId) // ไม่มีเรื่อง → "ไม่พบนิยายเรื่องนี้"
  throw notFound(`ไม่พบ${CHAPTER}`)
}

// ───────────────────────── ตรวจ body ของ PUT ─────────────────────────

interface ImportInput {
  translation: string
  titleTh: string
  recap: string
  terms: Term[]
  overwrite: boolean
}

function readTerm(raw: unknown, index: number): Term {
  const at = `${LABEL.terms} รายการที่ ${index + 1}`
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidField(`${at} ต้องเป็นออบเจ็กต์ที่มี source และ thai`)
  const term = raw as Record<string, unknown>
  return {
    source: str(term.source, `${at}: ${LABEL.source}`, { max: MAX.termSource, min: 1 }),
    thai: str(term.thai, `${at}: ${LABEL.thai}`, { max: MAX.termThai, min: 1 }),
    note: str(term.note, `${at}: ${LABEL.note}`, { max: MAX.termNote, optional: true }),
  }
}

function readTerms(raw: unknown): Term[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw invalidField(`${LABEL.terms} ต้องเป็นรายการ (อาร์เรย์) ของ { source, thai, note }`)
  if (raw.length > MAX.terms) throw invalidField(`${LABEL.terms} ใส่ได้ไม่เกิน ${MAX.terms} รายการ`)
  return raw.map(readTerm)
}

/** ผิดข้อเดียว = ไม่เขียนอะไรเลย (ตรวจครบทุกฟิลด์ก่อนแตะฐานข้อมูล) */
function readImport(body: Record<string, unknown>): ImportInput {
  return {
    translation: str(body.translation, LABEL.translation, { max: MAX.translation, min: 1 }),
    titleTh: str(body.titleTh, LABEL.titleTh, { max: MAX.titleTh, optional: true }),
    recap: str(body.recap, LABEL.recap, { max: MAX.recap, optional: true }),
    terms: readTerms(body.terms),
    overwrite: body.overwrite === undefined ? false : bool(body.overwrite, LABEL.overwrite),
  }
}

/**
 * ตอนที่นำเข้าไม่ได้ (409 พร้อม `code`): กำลังแปลโดยคิว · เผยแพร่อยู่แล้ว (สองอย่างนี้ `overwrite` ไม่ช่วย) · มีคำแปลอยู่แล้วแต่ไม่ได้สั่งทับ
 * ตรวจตามลำดับนี้ ตอนที่ทั้งกำลังแปลและเผยแพร่อยู่ (แปลใหม่ทับตอนที่ขึ้นเว็บ) ได้ `translating`
 */
function refuseIfLocked(target: Target, overwrite: boolean): void {
  if (target.status === "translating") {
    throw conflict("ตอนนี้กำลังถูกแปลโดยคิวอยู่ จึงนำเข้าไม่ได้ — รอให้แปลเสร็จก่อน หรือยกเลิกการแปลในหลังบ้านแล้วค่อยนำเข้า", "translating")
  }
  if (target.published === 1) {
    throw conflict("ตอนนี้เผยแพร่อยู่แล้ว ช่องทางนำเข้าไม่แตะตอนที่ขึ้นเว็บ — ซ่อนตอนนี้ในหลังบ้านก่อน หรือแก้คำแปลในหลังบ้านโดยตรง", "published")
  }
  if (target.has_translation === 1 && !overwrite) {
    throw conflict('ตอนนี้มีคำแปลอยู่แล้ว — ถ้าต้องการแทนที่ให้ส่ง "overwrite": true มาด้วย', "has_translation")
  }
}

// ───────────────────────── เส้นทางอ่าน (ส่วนเสริม ตัดออกได้) ─────────────────────────

const LIST_CHAPTERS = `
  SELECT number, title, status, translation <> '' AS has_translation, LENGTH(source_text) AS chars, published
  FROM chapters WHERE novel_id = ?`

/**
 * `GET` สองเส้นทางที่ช่วยให้ผู้แปลภายนอกหาตอนที่ยังรอแปลและได้โจทย์ชุดเดียวกับที่คิวใช้ (spec 7.11)
 * ไม่เกี่ยวกับ `PUT` — ลบฟังก์ชันนี้กับบรรทัดที่เรียกมันออกได้โดยส่วนอื่นไม่กระทบ
 */
function mountReadRoutes(router: Router, db: Db): void {
  router.get("/novels/:novelId/chapters", (req, res) => {
    const novelId = requireNovel(db, idParam(req.params.novelId, NOVEL))
    const status = req.query.status === undefined ? null : oneOf(req.query.status, LABEL.status, CHAPTER_STATUSES)
    const rows =
      status === null
        ? db.all<ImportChapterItemRow>(`${LIST_CHAPTERS} ORDER BY number`, novelId)
        : db.all<ImportChapterItemRow>(`${LIST_CHAPTERS} AND status = ? ORDER BY number`, novelId, status)
    res.json(rows.map(toImportChapterItemDto))
  })

  router.get("/novels/:novelId/chapters/:number", (req, res) => {
    const { id } = findChapter(db, req.params.novelId, req.params.number)
    res.json(toImportBriefDto(buildContext(db, id)!))
  })
}

// ───────────────────────── router ─────────────────────────

/**
 * `/api/import` (spec 7.11, 9.6): ช่องทางเขียนคำแปลที่แปลนอกระบบเข้าตอนที่มีอยู่แล้ว ใช้โทเค็นของตัวเองแทน cookie หลังบ้าน
 * `createApp` mount ก็ต่อเมื่อตั้ง `IMPORT_TOKEN` ยาวพอ — ปิดอยู่ = ไม่มีเส้นทางนี้เลย ตกไป 404 ของ `/api` เหมือนไม่มีอยู่จริง
 * ลำดับด่าน: no-store → จำกัดอัตรา → โทเค็น (ผิด/ขาด 401, ผิดเกินกำหนด 429) → ต้องเป็น JSON (415) → อ่าน JSON ≤ 2MB (413/400) →
 * 404 ไม่พบตอน → 400 ตรวจฟิลด์ → 409 ตามสถานะตอน · ไม่ตั้งหัว CORS เบราว์เซอร์ของเว็บอื่นจึงเรียกไม่ได้
 * สิทธิ์แคบ: เขียนได้แค่คำแปล ชื่อไทย เรื่องย่อ คำศัพท์ใหม่ของตอนที่ยังไม่เผยแพร่ · สร้างตอน ลบ เผยแพร่ ไม่ได้ · ไม่เรียก Claude ไม่เขียน `usage`
 */
export function createImportRouter(deps: AppDeps): Router {
  const { importToken } = deps.config
  if (importToken === null) throw new Error("createImportRouter: ต้องตั้ง IMPORT_TOKEN ก่อน (createApp ไม่ mount ช่องทางนี้เมื่อปิดอยู่)")
  const { db, log } = deps
  const router = Router()
  // นาฬิกาเดียวกับของแอป (เทสต์เลื่อนเวลาได้) · ถังนับความผิดแยกจากของล็อกอินหลังบ้าน
  const clock = (): number => deps.now().getTime()
  const rateLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: RATE_MAX, now: clock })
  const failures = createFailureLimiter({ windowMs: FAILURE_WINDOW_MS, max: FAILURE_MAX, now: clock })

  /** ความผิดนับเฉพาะโทเค็นผิด/ขาด · ผู้ที่ถูกบล็อกอยู่โดนปฏิเสธแม้ส่งโทเค็นถูก (ไม่งั้นเดาต่อได้) */
  const requireToken: RequestHandler = (req, res, next) => {
    const ip = clientIp(req)
    const state = failures.check(ip)
    if (state.blocked) {
      res.setHeader("Retry-After", String(state.retryAfterSec))
      throw new HttpError(429, `ส่งโทเค็นผิดหลายครั้งเกินไป ลองใหม่ได้ในอีก ${Math.ceil(state.retryAfterSec / 60)} นาที`, "too_many_attempts", {
        retryAfterSec: state.retryAfterSec,
      })
    }
    const given = bearerToken(req.headers.authorization)
    if (given === null || !passwordMatches(given, importToken)) {
      failures.recordFailure(ip)
      res.setHeader("WWW-Authenticate", 'Bearer realm="koymukarnnovel-import"')
      throw new HttpError(401, "ต้องแนบโทเค็นนำเข้าในหัว Authorization: Bearer <IMPORT_TOKEN> (ไม่ได้ส่งมาหรือโทเค็นไม่ถูกต้อง)", "unauthorized")
    }
    next()
  }

  router.use(noStore)
  router.use(rateLimited(rateLimiter))
  router.use(requireToken)
  router.use(jsonBodyOnly)
  router.use(express.json({ limit: BODY_LIMIT }))

  mountReadRoutes(router, db)

  router.put("/novels/:novelId/chapters/:number/translation", (req, res) => {
    const target = findChapter(db, req.params.novelId, req.params.number)
    const input = readImport(obj(req.body))
    refuseIfLocked(target, input.overwrite)

    applyTranslation(db, target.id, {
      translation: input.translation,
      titleTh: input.titleTh,
      // ไม่ส่ง recap = ตอนนี้ไม่มีเรื่องย่อ (ของเดิมเขียนถึงคำแปลเก่า) ต่างจาก applyTranslation ที่ถือว่า undefined = ไม่แตะ — จึงส่งข้อความว่างเพื่อสั่งล้าง
      recap: input.recap,
      terms: input.terms,
      now: nowSql(deps.now()),
      // ไม่ส่ง publish: นำเข้าไม่เผยแพร่เอง แม้ตอนนั้นตั้ง auto_publish ไว้ (เจ้าของตรวจแล้วกดเผยแพร่เองในหลังบ้าน)
    })
    log.info(`นำเข้าคำแปลตอนที่ ${target.number} ของ "${target.novel_title_th || target.novel_title}" (${input.translation.length} ตัวอักษร)`)
    res.json({ ok: true, chapter: { number: target.number, status: "done", published: false } })
  })

  return router
}
