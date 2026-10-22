import { Router } from "express"
import type { AppDeps } from "../../app.js"
import { applyTranslation, setPublished } from "../../chapters.js"
import type { Db } from "../../db.js"
import { HttpError, conflict, noApiKey } from "../../util/errors.js"
import { nowSql } from "../../util/time.js"
import { toAdminChapterDto, toAdminChapterListDto, type AdminChapterListRow } from "../dto.js"
import { bool, idParam, int, invalidField, obj, oneOf, str } from "../validate.js"
import { CHAPTER, chapterRow, existingChapterId, existingNovelId, requireNovel } from "./lookup.js"

/** ขีดจำกัดตามสเปก (ความยาวนับหลังล้างข้อความด้วย `normalizeText`) */
const MAX = { title: 300, source: 200_000, translation: 400_000, recap: 2000, perPaste: 100, bulkIds: 500 } as const

/** ชื่อฟิลด์ที่ผู้ดูแลเห็นในข้อความผิดพลาด (ชื่อไทย + ชื่อฟิลด์ในคำขอ) */
const LABEL = {
  chapters: "รายการตอน (chapters)",
  number: "เลขตอน (number)",
  text: "ต้นฉบับของตอน (text)",
  translate: "สั่งแปลทันที (translate)",
  publish: "เผยแพร่เมื่อแปลเสร็จ (publish)",
  title: "ชื่อตอน (title)",
  titleTh: "ชื่อตอนภาษาไทย (titleTh)",
  sourceText: "ต้นฉบับ (sourceText)",
  translation: "คำแปล (translation)",
  recap: "เรื่องย่อของตอน (recap)",
  action: "การกระทำ (action)",
  ids: "รหัสตอน (ids)",
  where: "เงื่อนไข (where)",
  novelId: "รหัสเรื่อง (novelId)",
  autoPublish: "เผยแพร่เมื่อแปลเสร็จ (autoPublish)",
} as const

// ───────────────────────── สร้างตอนเป็นชุด ─────────────────────────

interface NewChapter {
  number: number
  title: string
  text: string
}

/** หนึ่งรายการของ `chapters` · ข้อความผิดพลาดขึ้นต้นด้วยลำดับรายการ (นับจาก 1) เพื่อให้ผู้ดูแลหาตอนที่ผิดเจอในชุดยาวๆ */
function readNewChapter(raw: unknown, index: number): NewChapter {
  const at = `รายการที่ ${index + 1}`
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidField(`${at} ต้องเป็นออบเจ็กต์ที่มี number, title และ text`)
  const item = raw as Record<string, unknown>
  return {
    number: int(item.number, `${at}: ${LABEL.number}`, { min: 0 }),
    title: str(item.title, `${at}: ${LABEL.title}`, { max: MAX.title, optional: true }),
    text: str(item.text, `${at}: ${LABEL.text}`, { max: MAX.source, min: 1 }),
  }
}

function readNewChapters(raw: unknown): NewChapter[] {
  if (!Array.isArray(raw)) throw invalidField(`${LABEL.chapters} ต้องเป็นรายการ (อาร์เรย์) ของตอน`)
  if (raw.length === 0) throw invalidField(`${LABEL.chapters} ต้องมีอย่างน้อย 1 ตอน`)
  if (raw.length > MAX.perPaste) throw invalidField(`${LABEL.chapters} ใส่ได้ครั้งละไม่เกิน ${MAX.perPaste} ตอน`)
  return raw.map(readNewChapter)
}

/** ฟิลด์ที่ไม่ได้ส่งมา = false · ถ้าส่งมาต้องเป็น true/false เท่านั้น */
const optionalBool = (v: unknown, field: string): boolean => (v === undefined ? false : bool(v, field))

/** เลขตอนที่ซ้ำกันเองในชุดที่ส่งมา หรือซ้ำกับตอนที่มีอยู่แล้วของเรื่อง (เรียงน้อย→มาก ไม่มีซ้ำ) */
function conflictingNumbers(db: Db, novelId: number, chapters: NewChapter[]): number[] {
  const seen = new Set<number>()
  const conflicts = new Set<number>()
  for (const { number } of chapters) {
    const exists = db.get("SELECT 1 AS found FROM chapters WHERE novel_id = ? AND number = ?", novelId, number) !== undefined
    if (seen.has(number) || exists) conflicts.add(number)
    seen.add(number)
  }
  return [...conflicts].sort((a, b) => a - b)
}

const SHOWN_CONFLICTS = 10

// ───────────────────────── แก้ตอน ─────────────────────────

/** ตัวอ่านของแต่ละฟิลด์ที่ `PATCH /chapters/:id` แก้ได้: อ่านเฉพาะฟิลด์ที่ส่งมา (ผิดข้อเดียว = ไม่เขียนอะไรเลย) */
const READ_EDIT = {
  title: (v: unknown) => str(v, LABEL.title, { max: MAX.title }),
  titleTh: (v: unknown) => str(v, LABEL.titleTh, { max: MAX.title }),
  sourceText: (v: unknown) => str(v, LABEL.sourceText, { max: MAX.source, min: 1 }),
  translation: (v: unknown) => str(v, LABEL.translation, { max: MAX.translation }),
  recap: (v: unknown) => str(v, LABEL.recap, { max: MAX.recap }),
} as const

type EditField = keyof typeof READ_EDIT
type Edit = { [K in EditField]?: string }

const EDIT_FIELDS = Object.keys(READ_EDIT) as EditField[]

function readEdit(body: Record<string, unknown>): Edit {
  const edit: Edit = {}
  for (const field of EDIT_FIELDS) if (Object.hasOwn(body, field)) edit[field] = READ_EDIT[field](body[field])
  return edit
}

// ───────────────────────── สั่งหลายตอน ─────────────────────────

const ACTIONS = ["translate", "publish", "hide", "delete"] as const
type Action = (typeof ACTIONS)[number]

/** ตัวเลือก `where:"ready"` = ตอนที่แปลเสร็จแล้วแต่ยังไม่เผยแพร่ (ใช้กับ publish เท่านั้น) */
const READY_WHERE = ["ready"] as const

type Target = { ids: number[] } | { ready: true; novelId: number | null }

interface BulkRequest {
  action: Action
  target: Target
  autoPublish: boolean
}

function readBulk(body: Record<string, unknown>): BulkRequest {
  const action = oneOf(body.action, LABEL.action, ACTIONS)
  if ((body.ids === undefined) === (body.where === undefined)) {
    throw invalidField(`ต้องระบุอย่างใดอย่างหนึ่งเท่านั้น ระหว่าง ${LABEL.ids} กับ ${LABEL.where}`)
  }

  let target: Target
  if (body.ids !== undefined) {
    if (body.novelId !== undefined) throw invalidField(`${LABEL.novelId} ใช้ได้เฉพาะคู่กับ ${LABEL.where}`)
    target = { ids: readIds(body.ids) }
  } else {
    oneOf(body.where, LABEL.where, READY_WHERE)
    if (action !== "publish") throw invalidField(`${LABEL.where} ใช้ได้กับการเผยแพร่ (action: publish) เท่านั้น`)
    target = { ready: true, novelId: body.novelId === undefined ? null : int(body.novelId, LABEL.novelId, { min: 1 }) }
  }
  return { action, target, autoPublish: optionalBool(body.autoPublish, LABEL.autoPublish) }
}

/** รายการรหัสตอน: 1–500 รหัส จำนวนเต็มบวก · คืนแบบไม่ซ้ำตามลำดับที่ส่งมา */
function readIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw invalidField(`${LABEL.ids} ต้องเป็นรายการ (อาร์เรย์) ของรหัสตอน`)
  if (raw.length === 0) throw invalidField(`${LABEL.ids} ต้องมีอย่างน้อย 1 รหัส`)
  if (raw.length > MAX.bulkIds) throw invalidField(`${LABEL.ids} ใส่ได้ครั้งละไม่เกิน ${MAX.bulkIds} รหัส`)
  return [...new Set(raw.map((id) => int(id, LABEL.ids, { min: 1 })))]
}

/** ตอนใหม่เป็นร่างเสมอ (ค่าเริ่มต้นของคอลัมน์ที่เหลือ: ยังไม่มีคำแปล ไม่เผยแพร่ ไม่อยู่ในคิว) */
const INSERT_CHAPTER = "INSERT INTO chapters (novel_id, number, title, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"

const SELECT_CHAPTER_LIST = `
  SELECT id, number, title, title_th, status, error, published, published_at, translated_at, queue_seq,
         translation <> '' AS has_translation, LENGTH(source_text) AS src_length
  FROM chapters WHERE novel_id = ? ORDER BY number`

/** `/api/admin/…chapters…` (ผ่านด่านล็อกอินและตัวอ่าน JSON มาแล้ว) */
export function createChaptersRouter(deps: AppDeps): Router {
  const { db, ai, queue } = deps
  const router = Router()

  /** ลบตอน (ยกเลิกสตรีมที่กำลังแปลตอนนั้นก่อน ไม่งั้นสตรีมที่ค้างจะเขียนผลกลับมาให้แถวที่ไม่มีแล้ว) คืนจำนวนที่ลบจริง */
  const remove = (ids: number[]): number => {
    queue.cancelIfCurrent(ids)
    return db.tx(() => ids.reduce((deleted, id) => deleted + db.run("DELETE FROM chapters WHERE id = ?", id).changes, 0))
  }

  router.get("/novels/:id/chapters", (req, res) => {
    const novelId = existingNovelId(db, req.params.id)
    res.json(db.all<AdminChapterListRow>(SELECT_CHAPTER_LIST, novelId).map(toAdminChapterListDto))
  })

  router.post("/novels/:id/chapters", (req, res) => {
    const novelId = existingNovelId(db, req.params.id)
    const body = obj(req.body)
    const chapters = readNewChapters(body.chapters)
    const translate = optionalBool(body.translate, LABEL.translate)
    const publish = optionalBool(body.publish, LABEL.publish)
    if (translate && !ai.hasKey()) throw noApiKey()

    const conflicts = conflictingNumbers(db, novelId, chapters)
    if (conflicts.length > 0) {
      const shown = conflicts.slice(0, SHOWN_CONFLICTS).join(", ")
      const more = conflicts.length > SHOWN_CONFLICTS ? ` และอีก ${conflicts.length - SHOWN_CONFLICTS} เลข` : ""
      throw conflict(`เลขตอนซ้ำกับตอนที่มีอยู่หรือซ้ำกันเองในชุดที่ส่งมา: ${shown}${more} — ยังไม่ได้สร้างตอนใดเลย แก้เลขตอนแล้วส่งใหม่`, "duplicate_numbers", {
        conflicts,
      })
    }

    const now = nowSql(deps.now())
    // สร้างตอนกับเข้าคิวเป็นก้อนเดียว: เข้าคิวไม่สำเร็จ = ไม่มีตอนที่สร้างค้างอยู่ครึ่งๆ กลางๆ
    const result = db.tx(() => {
      const created: number[] = []
      for (const c of chapters) created.push(db.run(INSERT_CHAPTER, novelId, c.number, c.title, c.text, now, now).lastInsertRowid)
      return { created, queued: translate ? queue.enqueue(created, { autoPublish: publish }).queued : 0 }
    })
    res.status(201).json(result)
  })

  // ลงทะเบียนก่อน `/chapters/:id`: "bulk" ต้องไม่ถูกอ่านเป็นรหัสตอน
  router.post("/chapters/bulk", (req, res) => {
    const { action, target, autoPublish } = readBulk(obj(req.body))
    const now = nowSql(deps.now())

    if ("ready" in target) {
      if (target.novelId !== null) requireNovel(db, target.novelId)
      const ids = db
        .all<{ id: number }>(
          `SELECT id FROM chapters WHERE status = 'done' AND published = 0 AND translation <> ''${target.novelId === null ? "" : " AND novel_id = ?"}`,
          ...(target.novelId === null ? [] : [target.novelId]),
        )
        .map((row) => row.id)
      res.json(setPublished(db, ids, true, now))
      return
    }

    const { ids } = target
    switch (action) {
      case "publish":
      case "hide":
        res.json(setPublished(db, ids, action === "publish", now))
        return
      case "translate": {
        if (!ai.hasKey()) throw noApiKey()
        const { queued, skipped } = queue.enqueue(ids, { autoPublish })
        res.json({ queued, skipped })
        return
      }
      case "delete":
        res.json({ deleted: remove(ids) })
    }
  })

  router.get("/chapters/:id", (req, res) => {
    res.json(toAdminChapterDto(chapterRow(db, idParam(req.params.id, CHAPTER))))
  })

  router.patch("/chapters/:id", (req, res) => {
    const row = chapterRow(db, idParam(req.params.id, CHAPTER))
    const edit = readEdit(obj(req.body))

    // ตอนที่กำลังแปลอยู่จะเขียนคำแปลทับเมื่อแปลเสร็จ และอ่านต้นฉบับ ณ ตอนนี้ไปแล้ว จึงแตะสองอย่างนี้ไม่ได้ (ชื่อ ชื่อไทย เรื่องย่อแก้ได้)
    if (row.status === "translating" && (edit.translation !== undefined || edit.sourceText !== undefined)) {
      throw conflict("ตอนนี้กำลังถูกแปลอยู่ จึงแก้ต้นฉบับหรือคำแปลไม่ได้ — รอให้แปลเสร็จก่อน (แก้ชื่อและเรื่องย่อได้)", "translating")
    }
    const clearsTranslation = edit.translation === "" && row.translation !== ""
    if (clearsTranslation && row.published === 1) {
      throw new HttpError(400, "ตอนนี้เผยแพร่อยู่ ล้างคำแปลไม่ได้ — ซ่อนตอนก่อนแล้วค่อยล้าง", "published")
    }

    const now = nowSql(deps.now())
    db.tx(() => {
      const sets: string[] = []
      const params: unknown[] = []
      const set = (column: string, value: unknown): void => {
        sets.push(`${column} = ?`)
        params.push(value)
      }
      if (edit.title !== undefined) set("title", edit.title)
      if (edit.titleTh !== undefined) set("title_th", edit.titleTh)
      if (edit.sourceText !== undefined) set("source_text", edit.sourceText)
      if (edit.recap !== undefined) set("recap", edit.recap === "" ? null : edit.recap)

      if (edit.translation !== undefined && edit.translation !== "") {
        // ตอนที่ยังไม่มีคำแปล = วางคำแปลเอง (done, ออกจากคิว, ไม่เผยแพร่เอง, ไม่เรียก AI) · มีแล้ว = แก้ข้อความอย่างเดียว สถานะเดิมอยู่
        if (row.translation === "") applyTranslation(db, row.id, { translation: edit.translation, now })
        else set("translation", edit.translation)
      } else if (clearsTranslation) {
        set("translation", "")
        set("translated_at", null)
        if (row.status === "done") set("status", "draft")
      }

      // รันหลัง applyTranslation: ชื่อไทยและเรื่องย่อที่เจ้าของส่งมาในคำขอเดียวกันชนะค่าที่ applyTranslation เก็บไว้เสมอ
      if (sets.length > 0) db.run(`UPDATE chapters SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, now, row.id)
    })
    res.json(toAdminChapterDto(chapterRow(db, row.id)))
  })

  router.delete("/chapters/:id", (req, res) => {
    remove([existingChapterId(db, req.params.id)])
    res.json({ ok: true })
  })

  return router
}
