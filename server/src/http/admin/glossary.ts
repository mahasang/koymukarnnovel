import { Router } from "express"
import type { AppDeps } from "../../app.js"
import type { Db } from "../../db.js"
import type { GlossaryRow } from "../../types.js"
import { conflict, notFound } from "../../util/errors.js"
import { toGlossaryDto } from "../dto.js"
import { idParam, invalidField, obj, str } from "../validate.js"
import { existingNovelId } from "./lookup.js"

/** ขีดจำกัดตามสเปก (ความยาวนับหลังล้างข้อความด้วย `normalizeText`) */
const MAX = { source: 200, thai: 200, note: 300 } as const

/** ชื่อฟิลด์ที่ผู้ดูแลเห็นในข้อความผิดพลาด (ชื่อไทย + ชื่อฟิลด์ในคำขอ) */
const LABEL = {
  source: "คำต้นฉบับ (source)",
  thai: "คำไทย (thai)",
  note: "หมายเหตุ (note)",
  auto: "ตัวกรอง (auto)",
} as const

/** ชื่อที่ผู้ดูแลเห็นในข้อความ "ไม่พบ…" */
const TERM = "คำศัพท์ที่ระบุ"

/** ตัวอ่านของแต่ละฟิลด์: `source` กับ `thai` ห้ามว่าง ส่วน `note` ว่างได้ (= ไม่มีหมายเหตุ) */
const READ = {
  source: (v: unknown) => str(v, LABEL.source, { max: MAX.source, min: 1 }),
  thai: (v: unknown) => str(v, LABEL.thai, { max: MAX.thai, min: 1 }),
  note: (v: unknown) => str(v, LABEL.note, { max: MAX.note }),
} as const

type EditField = keyof typeof READ
type Edit = { [K in EditField]?: string }

/** ชื่อฟิลด์ตรงกับชื่อคอลัมน์ในตาราง `glossary` และเป็นรายการตายตัว จึงต่อเข้าคำสั่ง SQL ได้ (ไม่เคยใช้ชื่อที่มาจากคำขอ) */
const EDIT_FIELDS = Object.keys(READ) as EditField[]

/** อ่านเฉพาะฟิลด์ที่ส่งมา (ผิดข้อเดียว = ไม่เขียนอะไรเลย) ฟิลด์อื่นในคำขอถูกเมิน — โดยเฉพาะ `auto` ที่ผู้ใช้ตั้งเองไม่ได้ */
function readEdit(body: Record<string, unknown>): Edit {
  const edit: Edit = {}
  for (const field of EDIT_FIELDS) if (Object.hasOwn(body, field)) edit[field] = READ[field](body[field])
  return edit
}

/** `?auto=1` = เฉพาะคำที่ AI เพิ่ม · ไม่ใส่ = ทั้งหมด · ค่าอื่นทั้งหมดผิด (ไม่เดาว่า `auto=0` หมายถึงอะไร) */
function readAutoFilter(v: unknown): boolean {
  if (v === undefined) return false
  if (v === "1") return true
  throw invalidField(`${LABEL.auto} ใส่ได้เฉพาะ 1 (แสดงเฉพาะคำที่ AI เพิ่ม) หรือไม่ใส่เลย`)
}

function termRow(db: Db, id: number): GlossaryRow {
  const row = db.get<GlossaryRow>("SELECT * FROM glossary WHERE id = ?", id)
  if (row === undefined) throw notFound(`ไม่พบ${TERM}`)
  return row
}

/** มีคำต้นฉบับนี้ในเรื่องแล้วหรือยัง (รวมคำที่ AI เพิ่ม) เทียบตรงตัวเหมือน UNIQUE(novel_id, source) · `exceptId` = แถวที่กำลังแก้อยู่ ไม่นับว่าซ้ำกับตัวเอง */
function sourceTaken(db: Db, novelId: number, source: string, exceptId = 0): boolean {
  return db.get("SELECT 1 AS found FROM glossary WHERE novel_id = ? AND source = ? AND id <> ?", novelId, source, exceptId) !== undefined
}

const duplicate = (source: string) =>
  conflict(`คำต้นฉบับ "${source}" มีอยู่ในอภิธานของเรื่องนี้แล้ว (รวมคำที่ AI เพิ่มให้) — แก้คำเดิมแทนการเพิ่มซ้ำ`, "duplicate")

/** `/api/admin/…glossary…` (ผ่านด่านล็อกอินและตัวอ่าน JSON มาแล้ว) */
export function createGlossaryRouter(deps: AppDeps): Router {
  const { db } = deps
  const router = Router()

  router.get("/novels/:id/glossary", (req, res) => {
    const novelId = existingNovelId(db, req.params.id)
    const autoOnly = readAutoFilter(req.query.auto)
    const rows = db.all<GlossaryRow>(
      `SELECT * FROM glossary WHERE novel_id = ?${autoOnly ? " AND auto = 1" : ""} ORDER BY source COLLATE NOCASE, id`,
      novelId,
    )
    res.json(rows.map(toGlossaryDto))
  })

  router.post("/novels/:id/glossary", (req, res) => {
    const novelId = existingNovelId(db, req.params.id)
    const body = obj(req.body)
    const source = READ.source(body.source)
    const thai = READ.thai(body.thai)
    const note = body.note === undefined ? "" : READ.note(body.note)
    if (sourceTaken(db, novelId, source)) throw duplicate(source)

    // เจ้าของเพิ่มเองเป็น auto=0 เสมอ (ไม่อ่าน `auto` จากคำขอ)
    const id = db.run("INSERT INTO glossary (novel_id, source, thai, note, auto) VALUES (?, ?, ?, ?, 0)", novelId, source, thai, note).lastInsertRowid
    res.status(201).json(toGlossaryDto(termRow(db, id)))
  })

  router.patch("/glossary/:id", (req, res) => {
    const row = termRow(db, idParam(req.params.id, TERM))
    const edit = readEdit(obj(req.body))
    const fields = EDIT_FIELDS.filter((field) => edit[field] !== undefined)

    if (edit.source !== undefined && sourceTaken(db, row.novel_id, edit.source, row.id)) throw duplicate(edit.source)
    // แก้อะไรก็ตามถือว่าเจ้าของตรวจแล้ว: คำที่ AI เสนอมาจึงเลิกเป็น auto (ส่ง {} มาเฉยๆ ไม่นับ)
    if (fields.length > 0) {
      db.run(`UPDATE glossary SET ${fields.map((field) => `${field} = ?`).join(", ")}, auto = 0 WHERE id = ?`, ...fields.map((field) => edit[field]), row.id)
    }
    res.json(toGlossaryDto(termRow(db, row.id)))
  })

  router.delete("/glossary/:id", (req, res) => {
    const id = idParam(req.params.id, TERM)
    if (db.run("DELETE FROM glossary WHERE id = ?", id).changes === 0) throw notFound(`ไม่พบ${TERM}`)
    res.json({ ok: true })
  })

  return router
}
