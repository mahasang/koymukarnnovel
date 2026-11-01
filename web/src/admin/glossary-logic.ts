/**
 * ตรรกะล้วนของอภิธานศัพท์ (spec 7.8): ตรวจช่อง · ส่งเฉพาะช่องที่แก้ · ตัวกรอง "เฉพาะที่ AI เพิ่ม" · ข้อความ
 * ขีดจำกัดตรงกับเซิร์ฟเวอร์ (`server/src/http/admin/glossary.ts`) · `Glossary.tsx` ต่อกับ API และหน้าจอ
 */
import { formatCount } from "./format"
import type { GlossaryDto, TermInput } from "./types"

export interface TermDraft {
  source: string
  thai: string
  note: string
}

export const EMPTY_TERM: TermDraft = { source: "", thai: "", note: "" }

const MAX = { source: 200, thai: 200, note: 300 } as const

export const draftOfTerm = (term: GlossaryDto): TermDraft => ({ source: term.source, thai: term.thai, note: term.note })

export type TermErrors = Partial<Record<keyof TermDraft, string>>

/** ช่องที่ผิด → ข้อความไทย (คำต้นฉบับกับคำไทยห้ามว่าง · หมายเหตุว่างได้) */
export function validateTerm(draft: TermDraft): TermErrors {
  const errors: TermErrors = {}
  const source = draft.source.trim()
  const thai = draft.thai.trim()
  const note = draft.note.trim()
  if (source === "") errors.source = "กรอกคำต้นฉบับ"
  else if (source.length > MAX.source) errors.source = `คำต้นฉบับยาวเกิน ${MAX.source} ตัวอักษร`
  if (thai === "") errors.thai = "กรอกคำไทย"
  else if (thai.length > MAX.thai) errors.thai = `คำไทยยาวเกิน ${MAX.thai} ตัวอักษร`
  if (note.length > MAX.note) errors.note = `หมายเหตุยาวเกิน ${MAX.note} ตัวอักษร`
  return errors
}

/** เฉพาะช่องที่ต่างจากแถวเดิม (เทียบหลังตัดช่องว่างหัวท้าย) — ไม่มีอะไรเปลี่ยน → {} (ไม่ต้องยิงคำขอ) */
export function termChanges(term: GlossaryDto, draft: TermDraft): Partial<TermInput> {
  const patch: Partial<TermInput> = {}
  for (const key of ["source", "thai", "note"] as const) {
    const value = draft[key].trim()
    if (value !== term[key]) patch[key] = value
  }
  return patch
}

export const filterTerms = (rows: readonly GlossaryDto[], autoOnly: boolean): GlossaryDto[] => (autoOnly ? rows.filter((row) => row.auto) : [...rows])

export const aiCount = (rows: readonly GlossaryDto[]): number => rows.filter((row) => row.auto).length

export const summaryLine = (rows: readonly GlossaryDto[]): string => `ทั้งหมด ${formatCount(rows.length)} คำ · AI เพิ่ม ${formatCount(aiCount(rows))} คำ`

export function deleteTermMessage(term: GlossaryDto): string {
  const base = `ลบคำ “${term.source}” → “${term.thai}” ออกจากอภิธาน? AI จะไม่ใช้คำนี้ในการแปลครั้งต่อไป`
  return term.auto ? `${base} (AI อาจเสนอคำนี้กลับมาอีกถ้าเจอในตอนที่แปลต่อไป)` : base
}
