import { Router, type RequestHandler, type Response } from "express"
import type { AppDeps } from "../app.js"
import { VISIBLE_SQL } from "../chapters.js"
import { clientIp, createRateLimiter } from "../security.js"
import { HttpError, notFound } from "../util/errors.js"
import { isAdminRequest } from "./admin/auth.js"
import {
  toPublicChapterPageDto,
  toPublicNovelCardDto,
  toPublicNovelDto,
  type PublicChapterItemRow,
  type PublicChapterRow,
  type PublicNovelRow,
} from "./dto.js"
import { idParam } from "./validate.js"

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 120

const NOVEL = "นิยายเรื่องนี้"
const CHAPTER = "ตอนนี้"

/**
 * ขอบเขตของสิ่งที่คำขอนี้มองเห็น (spec 4.2 / 6.8): ผู้อ่านทั่วไปเห็นเฉพาะที่ `VISIBLE_SQL` นิยามไว้
 * ผู้ดูแลเห็นร่างด้วย ขอแค่ตอนนั้นมีคำแปลแล้ว (เรื่องไหนก็ได้ แม้ยังไม่เผยแพร่หรือยังไม่มีตอนเลย)
 * `chapter` ใช้กับตาราง chapters ชื่อ `c` ที่ JOIN novels ชื่อ `n` · `novel` ใช้กับ novels ชื่อ `n`
 */
interface Scope {
  chapter: string
  novel: string
}

const READER: Scope = { chapter: VISIBLE_SQL, novel: "n.published = 1" }
const ADMIN: Scope = { chapter: "c.translation <> ''", novel: "1 = 1" }
const scopeOf = (admin: boolean): Scope => (admin ? ADMIN : READER)

/** ตอนที่ผู้อ่านทั่วไปเห็นหรือไม่ — ไว้ให้หน้าเว็บขึ้นป้ายร่างให้ผู้ดูแล (เรื่องที่ซ่อนทำให้ทุกตอนของมันไม่เห็น) */
const IS_PUBLIC = "(c.published = 1 AND n.published = 1)"

/**
 * การ์ดนิยาย (ไม่ดึงรูปปก ดึงแค่เวลาแก้ปก): นับตอนที่เห็นด้วย LEFT JOIN ที่เงื่อนไขอยู่ใน ON เพื่อให้เรื่องที่ไม่มีตอนที่เห็นยังออกมาเป็น 0 ตอน
 * `updatedAt` = เวลาเผยแพร่ล่าสุดของตอนที่เห็น ไม่มี (ไม่มีตอน หรือตอนที่เห็นไม่มีเวลาเผยแพร่) ใช้เวลาแก้ของเรื่อง
 */
const cardSql = (scope: Scope, byId: boolean): string => `
  SELECT n.id, n.title, n.title_th, n.author, n.synopsis, n.tags, n.status, n.source_url, n.license_note, n.featured, n.published,
         (SELECT cv.updated_at FROM covers cv WHERE cv.novel_id = n.id) AS cover_updated_at,
         COUNT(c.id) AS chapter_count,
         MAX(c.number) AS latest_number,
         COALESCE(MAX(c.published_at), n.updated_at) AS last_update
  FROM novels n
  LEFT JOIN chapters c ON c.novel_id = n.id AND ${scope.chapter}
  WHERE ${scope.novel}${byId ? " AND n.id = ?" : ""}
  GROUP BY n.id${byId ? "" : "\n  ORDER BY last_update DESC, n.id DESC"}`

const chaptersSql = (scope: Scope): string => `
  SELECT c.number, c.title, c.title_th, c.published_at, ${IS_PUBLIC} AS is_public
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE c.novel_id = ? AND ${scope.chapter}
  ORDER BY c.number`

const chapterSql = (scope: Scope): string => `
  SELECT n.id AS novel_id, n.title AS novel_title, n.title_th AS novel_title_th,
         c.id AS chapter_id, c.number, c.title, c.title_th, c.translation, ${IS_PUBLIC} AS is_public
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE c.novel_id = ? AND c.number = ? AND ${scope.chapter}`

/** เลขตอนข้างเคียงที่ผู้ขอมองเห็น (พารามิเตอร์: novelId, number, novelId, number) */
const neighborsSql = (scope: Scope): string => `
  SELECT (SELECT MAX(c.number) FROM chapters c JOIN novels n ON n.id = c.novel_id
          WHERE c.novel_id = ? AND c.number < ? AND ${scope.chapter}) AS prev,
         (SELECT MIN(c.number) FROM chapters c JOIN novels n ON n.id = c.novel_id
          WHERE c.novel_id = ? AND c.number > ? AND ${scope.chapter}) AS next`

const CHAPTER_NUMBER = /^(?:0|[1-9]\d*)$/

/** เลขตอนในพาธ: จำนวนเต็มไม่ติดลบรูปแบบมาตรฐาน (ตอนเลข 0 มีได้) รูปแบบอื่นตอบเหมือน "ไม่มีตอนนี้" · เลขยาวจนเกินที่ JS แทนได้ก็แค่ไม่ตรงตอนไหน (SQLite ไม่ throw) */
function chapterNumber(v: unknown): number {
  if (typeof v === "string" && CHAPTER_NUMBER.test(v)) return Number(v)
  throw notFound(`ไม่พบ${CHAPTER}`)
}

/**
 * `/api/public` (GET อย่างเดียว · ด่าน 405 อยู่ใน `createApp` ก่อนถึงที่นี่): จำกัดอัตรา → ดูว่าผู้ขอเป็นผู้ดูแลหรือไม่ → เส้นทางอ่านข้อมูล
 * ไม่มีเส้นทางใดเรียก Claude และไม่รับ body · ผู้ดูแลได้ `private, no-store` ทุกคำตอบ (ร่างต้องไม่ติดแคชของใคร) ผู้อ่านทั่วไปได้ `no-cache` + ETag
 * ของ Express: เบราว์เซอร์ถามซ้ำทุกครั้งแต่ได้ 304 ถ้าไม่เปลี่ยน
 * ของที่ผู้ขอมองไม่เห็นตอบ 404 ข้อความเดียวกับ "ไม่มีอยู่จริง" ผู้อ่านจึงเดาไม่ได้ว่ามีเรื่องซ่อนอยู่
 */
export function createPublicRouter(deps: AppDeps): Router {
  const { db, settings, views } = deps
  const router = Router()
  // นาฬิกาเดียวกับของแอป (เทสต์เลื่อนเวลาได้) · ตารางของตัวจำกัดกวาดรายการหมดอายุเองเป็นระยะ
  const limiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: RATE_MAX, now: () => deps.now().getTime() })

  const rateLimit: RequestHandler = (req, res, next) => {
    const hit = limiter.hit(clientIp(req))
    if (hit.allowed) {
      next()
      return
    }
    res.setHeader("Retry-After", String(hit.retryAfterSec))
    next(
      new HttpError(429, `มีคำขอเข้ามาถี่เกินไป รอสักครู่แล้วลองใหม่ได้ในอีก ${hit.retryAfterSec} วินาที`, "rate_limited", {
        retryAfterSec: hit.retryAfterSec,
      }),
    )
  }

  const identify: RequestHandler = (req, res, next) => {
    const admin = isAdminRequest(deps, req)
    res.locals.admin = admin
    res.setHeader("Cache-Control", admin ? "private, no-store" : "no-cache")
    next()
  }
  const adminOf = (res: Response): boolean => res.locals.admin === true

  router.use(rateLimit)
  router.use(identify)

  router.get("/site", (_req, res) => {
    const s = settings.get()
    res.json({
      siteName: s.siteName,
      tagline: s.tagline,
      aboutText: s.aboutText,
      contactText: s.contactText,
      accent: s.accent,
      indexable: s.indexable,
      isAdmin: adminOf(res),
    })
  })

  router.get("/novels", (_req, res) => {
    res.json(db.all<PublicNovelRow>(cardSql(scopeOf(adminOf(res)), false)).map(toPublicNovelCardDto))
  })

  router.get("/novels/:id", (req, res) => {
    const scope = scopeOf(adminOf(res))
    const id = idParam(req.params.id, NOVEL)
    const novel = db.get<PublicNovelRow>(cardSql(scope, true), id)
    if (novel === undefined) throw notFound(`ไม่พบ${NOVEL}`)
    res.json(toPublicNovelDto(novel, db.all<PublicChapterItemRow>(chaptersSql(scope), id)))
  })

  router.get("/novels/:id/chapters/:number", (req, res) => {
    const admin = adminOf(res)
    const scope = scopeOf(admin)
    const novelId = idParam(req.params.id, CHAPTER)
    const number = chapterNumber(req.params.number)
    const chapter = db.get<PublicChapterRow>(chapterSql(scope), novelId, number)
    if (chapter === undefined) throw notFound(`ไม่พบ${CHAPTER}`)
    const near = db.get<{ prev: number | null; next: number | null }>(neighborsSql(scope), novelId, number, novelId, number)

    // นับยอดอ่านเฉพาะการเปิดอ่านจริงของผู้อ่านทั่วไป: ไม่นับผู้ดูแล, HEAD (บอทเช็กลิงก์), และคำตอบ 404 (throw ไปแล้วข้างบน)
    // คำขอแบบมีเงื่อนไขที่ได้ 304 ก็ยังนับ — ผู้อ่านที่กลับมาเปิดตอนที่เบราว์เซอร์แคชไว้คือการอ่านจริง
    if (!admin && req.method === "GET") {
      views.record({ ip: clientIp(req), ua: req.get("user-agent") ?? "", novelId, chapterId: chapter.chapter_id })
    }
    res.json(toPublicChapterPageDto(chapter, near?.prev ?? null, near?.next ?? null))
  })

  return router
}
