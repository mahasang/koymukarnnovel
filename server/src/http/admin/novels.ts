import { Router } from "express"
import type { AppDeps } from "../../app.js"
import { AiError } from "../../ai.js"
import { MAX_COVER_BYTES, detectImage } from "../../covers.js"
import { MODES, NOVEL_STATUSES } from "../../types.js"
import { recordUsage } from "../../usage.js"
import { HttpError, noApiKey, notFound } from "../../util/errors.js"
import { dayKey, nowSql } from "../../util/time.js"
import { coverVersion, toAdminNovelDto, type AdminNovelRow } from "../dto.js"
import { bool, httpUrl, idParam, invalidField, obj, oneOf, str, tags } from "../validate.js"

/** ชื่อฟิลด์ที่ผู้ดูแลเห็นในข้อความผิดพลาด (ชื่อไทย + ชื่อฟิลด์ในคำขอ) */
const LABEL = {
  title: "ชื่อเรื่อง (title)",
  titleTh: "ชื่อภาษาไทย (titleTh)",
  author: "ผู้แต่ง (author)",
  synopsis: "เรื่องย่อภาษาไทย (synopsis)",
  synopsisSrc: "เรื่องย่อต้นฉบับ (synopsisSrc)",
  status: "สถานะเรื่อง (status)",
  sourceUrl: "ลิงก์ต้นฉบับ (sourceUrl)",
  licenseNote: "หมายเหตุสิทธิ์ (licenseNote)",
  styleNote: "บันทึกสไตล์การแปล (styleNote)",
  mode: "โหมด (mode)",
  published: "เผยแพร่ (published)",
  featured: "เรื่องแนะนำ (featured)",
} as const

const MAX = { title: 300, author: 200, synopsis: 10_000, licenseNote: 2000, styleNote: 3000 } as const

/**
 * ตัวอ่านของแต่ละฟิลด์ที่แก้ได้: รับค่าดิบจากคำขอ คืนค่าที่ตรวจและล้างแล้ว
 * ค่า `undefined` (ไม่ได้ส่งมา) ได้ค่าเริ่มต้นของการสร้างเรื่องใหม่ · PATCH อ่านเฉพาะฟิลด์ที่ส่งมา จึงไม่เคยเห็น undefined
 */
const READ = {
  title: (v: unknown) => str(v, LABEL.title, { max: MAX.title, min: 1 }),
  titleTh: (v: unknown) => str(v, LABEL.titleTh, { max: MAX.title, optional: true }),
  author: (v: unknown) => str(v, LABEL.author, { max: MAX.author, optional: true }),
  synopsis: (v: unknown) => str(v, LABEL.synopsis, { max: MAX.synopsis, optional: true }),
  synopsisSrc: (v: unknown) => str(v, LABEL.synopsisSrc, { max: MAX.synopsis, optional: true }),
  tags: (v: unknown) => (v === undefined ? [] : tags(v)),
  status: (v: unknown) => (v === undefined ? "ongoing" : oneOf(v, LABEL.status, NOVEL_STATUSES)),
  sourceUrl: (v: unknown) => (v === undefined ? "" : httpUrl(v, LABEL.sourceUrl)),
  licenseNote: (v: unknown) => str(v, LABEL.licenseNote, { max: MAX.licenseNote, optional: true }),
  styleNote: (v: unknown) => str(v, LABEL.styleNote, { max: MAX.styleNote, optional: true }),
  mode: (v: unknown) => (v === undefined ? "translate" : oneOf(v, LABEL.mode, MODES)),
  published: (v: unknown) => (v === undefined ? false : bool(v, LABEL.published)),
  featured: (v: unknown) => (v === undefined ? false : bool(v, LABEL.featured)),
} as const

type Field = keyof typeof READ
type NovelInput = { [K in Field]: ReturnType<(typeof READ)[K]> }

const FIELDS = Object.keys(READ) as Field[]

const COLUMN: Record<Field, string> = {
  title: "title",
  titleTh: "title_th",
  author: "author",
  synopsis: "synopsis",
  synopsisSrc: "synopsis_src",
  tags: "tags",
  status: "status",
  sourceUrl: "source_url",
  licenseNote: "license_note",
  styleNote: "style_note",
  mode: "mode",
  published: "published",
  featured: "featured",
}

/** ตรวจทุกฟิลด์ที่ขอก่อนเขียนอะไร (ผิดข้อใดข้อหนึ่ง = ไม่แตะข้อมูลเลย) ตามลำดับเดียวกับ `READ` */
function readFields(body: Record<string, unknown>, fields: readonly Field[]): Partial<NovelInput> {
  const out: Record<string, unknown> = {}
  for (const field of fields) out[field] = READ[field](body[field])
  return out as Partial<NovelInput>
}

const NOVEL = "นิยายเรื่องนี้"

/** นิยายพร้อมปก (เฉพาะเวลาแก้ปก ไม่ดึงรูป) และจำนวนตอนแต่ละแบบ · ต่อท้ายด้วย `WHERE`/`ORDER BY` */
const SELECT_NOVEL = `
  SELECT n.*, cv.updated_at AS cover_updated_at,
         (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count,
         (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id AND c.translation <> '') AS translated_count,
         (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id AND c.published = 1) AS published_count
  FROM novels n LEFT JOIN covers cv ON cv.novel_id = n.id`

/** `/api/admin/novels…` (ผ่านด่านล็อกอินและตัวอ่าน JSON มาแล้ว) */
export function createNovelsRouter(deps: AppDeps): Router {
  const { db, ai, settings, queue, log } = deps
  const router = Router()

  const get = (id: number): AdminNovelRow => {
    const row = db.get<AdminNovelRow>(`${SELECT_NOVEL} WHERE n.id = ?`, id)
    if (row === undefined) throw notFound(`ไม่พบ${NOVEL}`)
    return row
  }
  /** รหัสในพาธที่ต้องมีเรื่องนั้นอยู่จริง (ตรวจก่อนตรวจ body เสมอ) */
  const novelId = (param: unknown): number => {
    const id = idParam(param, NOVEL)
    if (db.get("SELECT 1 AS found FROM novels WHERE id = ?", id) === undefined) throw notFound(`ไม่พบ${NOVEL}`)
    return id
  }

  /** เรื่องแนะนำมีได้เรื่องเดียว: เรียกในธุรกรรมเดียวกับที่ตั้ง `featured` ของ `id` */
  const unfeatureOthers = (id: number, now: string): void => {
    db.run("UPDATE novels SET featured = 0, updated_at = ? WHERE featured = 1 AND id <> ?", now, id)
  }
  const touch = (id: number, now: string): void => {
    db.run("UPDATE novels SET updated_at = ? WHERE id = ?", now, id)
  }
  const stored = (field: Field, value: unknown): unknown => (field === "tags" ? JSON.stringify(value) : value)

  router.get("/novels", (_req, res) => {
    res.json(db.all<AdminNovelRow>(`${SELECT_NOVEL} ORDER BY n.id DESC`).map(toAdminNovelDto))
  })

  router.post("/novels", (req, res) => {
    const input = readFields(obj(req.body), FIELDS) as NovelInput
    const now = nowSql(deps.now())
    const id = db.tx(() => {
      const columns = [...FIELDS.map((f) => COLUMN[f]), "created_at", "updated_at"]
      const { lastInsertRowid } = db.run(
        `INSERT INTO novels (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ...FIELDS.map((f) => stored(f, input[f])),
        now,
        now,
      )
      if (input.featured) unfeatureOthers(lastInsertRowid, now)
      return lastInsertRowid
    })
    res.status(201).json(toAdminNovelDto(get(id)))
  })

  // ลงทะเบียนก่อน `/novels/:id` (สเปก 7.10): "ai-fill" ต้องไม่ถูกอ่านเป็นรหัสเรื่อง
  router.post("/novels/ai-fill", async (req, res) => {
    const body = obj(req.body)
    const title = READ.title(body.title)
    const synopsisSrc = READ.synopsisSrc(body.synopsisSrc)
    const author = READ.author(body.author)
    if (!ai.hasKey()) throw noApiKey()

    const model = settings.get().translateModel
    let filled: Awaited<ReturnType<typeof ai.fillNovel>>
    try {
      filled = await ai.fillNovel({ model, title, synopsisSrc, author })
    } catch (e) {
      throw e instanceof AiError ? new HttpError(502, e.message, "ai_error") : e
    }
    try {
      recordUsage(db, dayKey(deps.now()), model, filled.usage)
    } catch (e) {
      // งานที่จ่ายเงินไปแล้วไม่ทิ้ง: ยอดใช้ไม่ถูกบันทึกก็ยังส่งผลให้ผู้ดูแล
      log.warn(`บันทึกยอดใช้ Claude (usage) ของ ai-fill ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    }
    res.json({ titleTh: filled.titleTh, synopsis: filled.synopsis, tags: filled.tags })
  })

  router.get("/novels/:id", (req, res) => {
    res.json(toAdminNovelDto(get(idParam(req.params.id, NOVEL))))
  })

  router.patch("/novels/:id", (req, res) => {
    const id = novelId(req.params.id)
    const body = obj(req.body)
    const changes = readFields(body, FIELDS.filter((f) => Object.hasOwn(body, f)))
    const fields = Object.keys(changes) as Field[]
    if (fields.length > 0) {
      const now = nowSql(deps.now())
      db.tx(() => {
        db.run(
          `UPDATE novels SET ${fields.map((f) => `${COLUMN[f]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          ...fields.map((f) => stored(f, changes[f])),
          now,
          id,
        )
        if (changes.featured) unfeatureOthers(id, now)
      })
    }
    res.json(toAdminNovelDto(get(id)))
  })

  router.delete("/novels/:id", (req, res) => {
    const id = novelId(req.params.id)
    // ตอนที่กำลังแปลอยู่ต้องถูกยกเลิกก่อนลบ ไม่งั้นสตรีมที่ค้างจะเขียนผลกลับมาให้ตอนที่ไม่มีแล้ว
    queue.cancelIfCurrent(db.all<{ id: number }>("SELECT id FROM chapters WHERE novel_id = ?", id).map((c) => c.id))
    db.run("DELETE FROM novels WHERE id = ?", id) // ตอน อภิธาน และปกตามไปด้วย (ON DELETE CASCADE) ยอดอ่านเก็บไว้
    res.json({ ok: true })
  })

  router.put("/novels/:id/cover", (req, res) => {
    const id = novelId(req.params.id)
    const { data } = obj(req.body)
    if (typeof data !== "string") throw invalidField("ฟิลด์ data ต้องเป็นข้อความ base64 ของไฟล์รูป")
    const bytes = Buffer.from(data, "base64")
    // ตรวจขนาดก่อนชนิด: ไฟล์ใหญ่เกินตอบ 413 เสมอ ไม่ว่าจะเป็นรูปหรือไม่
    if (bytes.length > MAX_COVER_BYTES) {
      throw new HttpError(413, `ไฟล์ปกใหญ่เกิน ${MAX_COVER_BYTES / 1024}KB — ย่อรูปแล้วลองใหม่`, "cover_too_large")
    }
    const mime = detectImage(bytes)
    if (mime === null) throw new HttpError(400, "ไฟล์ปกต้องเป็นรูป JPEG, PNG หรือ WebP", "invalid_image")

    const now = nowSql(deps.now())
    db.tx(() => {
      db.run(
        `INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (novel_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
        id,
        mime,
        bytes,
        now,
      )
      touch(id, now)
    })
    res.json({ coverV: coverVersion(now) })
  })

  router.delete("/novels/:id/cover", (req, res) => {
    const id = novelId(req.params.id)
    db.tx(() => {
      // ไม่มีปกให้ลบ → ไม่มีอะไรเปลี่ยน จึงไม่ขยับเวลาแก้ไขของเรื่อง
      if (db.run("DELETE FROM covers WHERE novel_id = ?", id).changes > 0) touch(id, nowSql(deps.now()))
    })
    res.json({ ok: true })
  })

  return router
}
