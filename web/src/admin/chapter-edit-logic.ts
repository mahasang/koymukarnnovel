/**
 * ตรรกะล้วนของหน้าแก้ตอน (spec 7.7): ร่างที่แก้ · ส่งเฉพาะฟิลด์ที่เปลี่ยน · ช่องที่ถูกล็อกตอนกำลังแปล · สถานะปุ่ม · ตอนก่อน/ถัดไป
 * ไม่มี DOM/React จึงเทสต์ตรงๆ ได้ — `ChapterEdit.tsx` ต่อกับ API และหน้าจอ
 */
import { formatCount } from "./format"
import type { ChapterPatch } from "./adminApi"
import type { AdminChapterDto, AdminChapterRow, ChapterStatus } from "./types"

export type ChapterDraft = Required<ChapterPatch>

export const DRAFT_FIELDS = ["title", "titleTh", "sourceText", "translation", "recap"] as const

export function draftOf(chapter: AdminChapterDto): ChapterDraft {
  return { title: chapter.title, titleTh: chapter.titleTh, sourceText: chapter.sourceText, translation: chapter.translation, recap: chapter.recap }
}

/** เฉพาะฟิลด์ที่ต่างจากค่าที่เซิร์ฟเวอร์เก็บ (ส่งทั้งก้อนจะเขียนทับสิ่งที่ไม่ได้แก้) */
export function changedFields(base: ChapterDraft, draft: ChapterDraft): ChapterPatch {
  const patch: ChapterPatch = {}
  for (const key of DRAFT_FIELDS) if (draft[key] !== base[key]) patch[key] = draft[key]
  return patch
}

export const isDirty = (base: ChapterDraft, draft: ChapterDraft): boolean => Object.keys(changedFields(base, draft)).length > 0

/**
 * ร่างหลังได้ค่าใหม่จากเซิร์ฟเวอร์ (ดึงซ้ำตอนกำลังแปล หรือหลังบันทึก): ช่องที่เจ้าของไม่ได้แตะนับจาก `oldBase` ตามค่าใหม่
 * ช่องที่แก้ค้างไว้คงของเจ้าของ ไม่ถูกทับ (และยังนับเป็นการแก้ไขที่ค้างอยู่เมื่อเทียบ `newBase`)
 */
export function rebase(current: ChapterDraft, oldBase: ChapterDraft, newBase: ChapterDraft): ChapterDraft {
  const out = { ...newBase }
  for (const key of DRAFT_FIELDS) if (current[key] !== oldBase[key]) out[key] = current[key]
  return out
}

/** ตอนที่กำลังแปลอยู่: เซิร์ฟเวอร์ปฏิเสธ (409) การแก้ต้นฉบับและคำแปล จึงล็อกสองช่องนี้ (ชื่อ ชื่อไทย เรื่องย่อแก้ได้) */
export function lockedFields(status: ChapterStatus): { sourceText: boolean; translation: boolean } {
  const locked = status === "translating"
  return { sourceText: locked, translation: locked }
}

/** คำอธิบายใต้ช่องคำแปล (null = ไม่ต้องมี) */
export function translationNote(chapter: AdminChapterDto): string | null {
  if (chapter.status === "translating") {
    return "ตอนนี้กำลังแปลอยู่ จึงแก้ต้นฉบับและคำแปลไม่ได้ — รอให้แปลเสร็จ หรือหยุดคิวที่แถบด้านข้างก่อน (แก้ชื่อและเรื่องย่อได้ตามปกติ)"
  }
  if (chapter.translation === "") {
    return "ยังไม่มีคำแปล — วางคำแปลที่คุณแปลเองลงช่องนี้แล้วกดบันทึกได้ ไม่เสียค่า API และจะไม่เผยแพร่ให้เอง (ตอนจะเป็น “แปลเสร็จ” รอคุณกดเผยแพร่)"
  }
  return null
}

export interface ActionState {
  canSave: boolean
  canTranslate: boolean
  translateLabel: string
  canToggle: boolean
  toggleLabel: string
  /** ค่าที่ปุ่มเผยแพร่/ซ่อนจะตั้ง */
  toggleTo: boolean
  /** เหตุผลที่ปุ่มบางปุ่มปิดอยู่ (null = ไม่มี) */
  reason: string | null
}

/**
 * ปุ่มของหน้าแก้ตอน · `dirty` = มีแก้ที่ยังไม่บันทึก → แปลใหม่/เผยแพร่/ซ่อนปิด (สองอย่างหลังทำกับค่าที่บันทึกแล้วบนเซิร์ฟเวอร์ ไม่ใช่ที่พิมพ์ค้าง)
 */
export function actionState(chapter: AdminChapterDto, dirty: boolean): ActionState {
  const has = chapter.translation !== ""
  const busy = chapter.status === "queued" || chapter.status === "translating"
  let reason: string | null = null
  let canToggle = !dirty
  if (dirty) reason = "บันทึกก่อน จึงจะแปลใหม่หรือเผยแพร่/ซ่อนได้ (คำสั่งเหล่านี้ใช้กับค่าที่บันทึกไว้แล้ว ไม่ใช่ที่พิมพ์ค้าง)"
  else if (!chapter.published && !has) {
    canToggle = false
    reason = "ยังไม่มีคำแปล จึงเผยแพร่ไม่ได้"
  }
  return {
    canSave: dirty,
    canTranslate: !dirty && !busy,
    translateLabel: has ? "แปลใหม่" : "แปล",
    canToggle,
    toggleLabel: chapter.published ? "ซ่อน" : "เผยแพร่",
    toggleTo: !chapter.published,
    reason,
  }
}

/** ตอนก่อนหน้า/ถัดไปตามเลขตอน (ไม่เชื่อลำดับที่ส่งมา) */
export function neighbors(rows: readonly AdminChapterRow[], id: number): { prev: AdminChapterRow | null; next: AdminChapterRow | null } {
  const sorted = [...rows].sort((a, b) => a.number - b.number)
  const at = sorted.findIndex((row) => row.id === id)
  if (at === -1) return { prev: null, next: null }
  return { prev: sorted[at - 1] ?? null, next: sorted[at + 1] ?? null }
}

/** ข้อความหลังบันทึกสำเร็จ: วางคำแปลในตอนที่ยังไม่มี → ตอนกลายเป็นแปลเสร็จ (ไม่เผยแพร่ให้เอง) */
export function saveNotice(patch: ChapterPatch, before: AdminChapterDto, after: AdminChapterDto): string {
  const pasted = patch.translation !== undefined && patch.translation !== "" && before.translation === "" && after.status === "done"
  if (!pasted) return "บันทึกแล้ว"
  return after.published ? "บันทึกแล้ว — ตอนนี้มีคำแปลและเป็น “แปลเสร็จ”" : "บันทึกแล้ว — ตอนนี้มีคำแปลและเป็น “แปลเสร็จ” (ยังไม่เผยแพร่ กดเผยแพร่เมื่อพร้อม)"
}

export const lengthLabel = (text: string): string => `${formatCount(text.length)} ตัวอักษร`

export const LEAVE_MESSAGE = "คุณมีการแก้ไขที่ยังไม่ได้บันทึก ถ้าไปตอนอื่นตอนนี้ สิ่งที่แก้จะหายไป"
