/**
 * รายการตอนบนหน้าเรื่อง (spec 6.2) + ปุ่มหลัก "เริ่มอ่าน"/"อ่านต่อ ตอนที่ N" — ตรรกะล้วน ไม่ผูกกับ React
 * ลำดับตอนไม่เชื่อที่เซิร์ฟเวอร์ส่งมา: เรียงตามเลขตอนเองเสมอ · ตอนที่ 0 เป็นตอนจริง (ใช้ `=== null` ไม่ใช่ตรวจว่าเป็นเท็จ)
 */
import { resumeTarget, FINISHED_PCT, type Progress } from "./progress"
import type { ChapterItemDto } from "./types"

/** จำนวนตอนต่อหน้าของรายการตอน (spec 6.2) */
export const CHAPTERS_PER_PAGE = 50

export type ChapterOrder = "desc" | "asc"

/** ค่าเริ่มต้น: ตอนใหม่อยู่บน (ผู้อ่านที่ตามเรื่องอยู่เห็นตอนล่าสุดทันที ส่วนคนอ่านใหม่มีปุ่ม "เริ่มอ่าน") */
export const DEFAULT_ORDER: ChapterOrder = "desc"

export const ORDER_OPTIONS: readonly { key: ChapterOrder; label: string }[] = [
  { key: "desc", label: "ใหม่ → เก่า" },
  { key: "asc", label: "เก่า → ใหม่" },
]

/** สำเนาของรายการที่เรียงตามเลขตอน (ไม่แก้อาร์เรย์เดิม) */
export function orderedChapters(chapters: readonly ChapterItemDto[], order: ChapterOrder): ChapterItemDto[] {
  const ascending = [...chapters].sort((a, b) => a.number - b.number)
  return order === "asc" ? ascending : ascending.reverse()
}

/** จำนวนหน้าทั้งหมด — ไม่มีตอนเลยก็ยังมี 1 หน้า (หน้าว่าง) */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / CHAPTERS_PER_PAGE))
}

/** ตรึงเลขหน้าในช่วง 1..จำนวนหน้า; ค่าที่ไม่ใช่จำนวนเต็ม (NaN, ทศนิยม, อนันต์) → 1 */
export function clampPage(page: number, total: number): number {
  return Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount(total)) : 1
}

/** ตอนในหน้านั้นตามแบบเรียง (หน้าเกินช่วงถูกตรึง ไม่คืนว่างทั้งที่มีตอน) */
export function pageSlice(chapters: readonly ChapterItemDto[], order: ChapterOrder, page: number): ChapterItemDto[] {
  const ordered = orderedChapters(chapters, order)
  const start = (clampPage(page, ordered.length) - 1) * CHAPTERS_PER_PAGE
  return ordered.slice(start, start + CHAPTERS_PER_PAGE)
}

/** หน้าที่มีตอนเลขนั้นตามแบบเรียง — ไม่มีตอนนั้นในรายการ → null (นับตามลำดับในรายการ ไม่ใช่ตามเลขตอน เผื่อมีเลขข้าม) */
export function pageOf(chapters: readonly ChapterItemDto[], order: ChapterOrder, number: number): number | null {
  const index = orderedChapters(chapters, order).findIndex((chapter) => chapter.number === number)
  return index === -1 ? null : Math.floor(index / CHAPTERS_PER_PAGE) + 1
}

/** เลขตอนน้อยสุด (ตอนแรก) — ไม่มีตอน → null */
export function firstChapter(chapters: readonly ChapterItemDto[]): number | null {
  return chapters.length === 0 ? null : chapters.reduce((min, chapter) => Math.min(min, chapter.number), Number.POSITIVE_INFINITY)
}

/** เลขตอนมากสุด (ตอนล่าสุด) — ไม่มีตอน → null */
export function latestChapter(chapters: readonly ChapterItemDto[]): number | null {
  return chapters.length === 0 ? null : chapters.reduce((max, chapter) => Math.max(max, chapter.number), Number.NEGATIVE_INFINITY)
}

/** เลขตอนที่ผู้อ่านพิมพ์: ตัดช่องว่างและอักขระกว้างศูนย์ที่ติดมาตอนคัดลอก แปลงเลขไทย */
function cleanInput(raw: string): string {
  return raw.replace(/[\u{200b}-\u{200d}\u{feff}]/gu, "").trim()
}

/** เลขอารบิก 1–9 หลัก: ยาวกว่านี้ไม่ใช่เลขตอนที่เป็นไปได้ (ไม่ปัดเป็นเลขเพี้ยน) */
const CHAPTER_NUMBER = /^\d{1,9}$/

/** ข้อความ → เลขตอน (จำนวนเต็มไม่ติดลบ รับเลขไทยด้วย); ไม่ใช่ → null */
export function parseChapterNumber(raw: string): number | null {
  const ascii = cleanInput(raw).replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - "๐".charCodeAt(0)))
  return CHAPTER_NUMBER.test(ascii) ? Number(ascii) : null
}

export type JumpResult = { ok: true; number: number; page: number } | { ok: false; message: string }

/** ช่อง "ไปตอนที่ …": เจอตอน → เลขตอน + หน้าที่มีตอนนั้น · ไม่เจอ → ข้อความบอกสาเหตุ (ภาษาไทย) */
export function resolveJump(chapters: readonly ChapterItemDto[], order: ChapterOrder, raw: string): JumpResult {
  const first = firstChapter(chapters)
  const latest = latestChapter(chapters)
  if (first === null || latest === null) return { ok: false, message: "ยังไม่มีตอนให้ไป" }
  if (cleanInput(raw) === "") return { ok: false, message: "กรอกเลขตอนที่ต้องการ" }
  const number = parseChapterNumber(raw)
  if (number === null) return { ok: false, message: "กรอกเลขตอนเป็นตัวเลข เช่น 12" }
  const page = pageOf(chapters, order, number)
  if (page === null) return { ok: false, message: `ไม่พบตอนที่ ${number} (มีตั้งแต่ตอนที่ ${first} ถึง ${latest})` }
  return { ok: true, number, page }
}

export interface ReadAction {
  /** start = ยังไม่เคยอ่าน · resume = อ่านต่อ · reread = อ่านทันตอนล่าสุดแล้ว ชวนอ่านซ้ำ */
  kind: "start" | "resume" | "reread"
  number: number
  label: string
}

/**
 * ปุ่มหลักของหน้าเรื่องควรพาไปไหน (ตัดสินจากรายการตอนที่มีอยู่จริงตอนนี้ ไม่ใช่ที่จำไว้ตอนบันทึก):
 * - ไม่มีตอนเลย → ไม่มีปุ่ม · ยังไม่เคยอ่าน → ตอนแรก
 * - ยังอ่านไม่จบ → ตอนเดิม · อ่านจบ → ตอนถัดไปที่จำไว้ (`resumeTarget`)
 * - ตอนเป้าหมายหายไป (ซ่อน/ลบ) หรืออ่านจบตอนที่ตอนนั้นเคยเป็นตอนสุดท้าย (จำไว้ว่าไม่มีตอนถัดไป) → ตอนแรกที่เลขมากกว่าตอนที่อ่านและยังมีอยู่
 *   (หน้าแรกบอก "มีตอนใหม่" แล้วพามาที่นี่ ปุ่มต้องไปตอนใหม่จริง ไม่ใช่ให้อ่านตอนเดิมซ้ำ)
 * - ไม่มีตอนไหนเลขมากกว่าอีกแล้ว → ชวนอ่านซ้ำตอนล่าสุดที่มี (ซึ่งคือตอนที่อ่านนั้นเอง ถ้ายังอยู่)
 */
export function readAction(chapters: readonly ChapterItemDto[], progress: Progress | null): ReadAction | null {
  const first = firstChapter(chapters)
  const latest = latestChapter(chapters)
  if (first === null || latest === null) return null
  if (progress === null) return { kind: "start", number: first, label: "เริ่มอ่าน" }

  const has = (number: number) => chapters.some((chapter) => chapter.number === number)
  const resume = (number: number): ReadAction => ({ kind: "resume", number, label: `อ่านต่อ ตอนที่ ${number}` })

  const target = resumeTarget(progress).number
  // อ่านจบแล้วและไม่มีตอนถัดไปในบันทึก: `resumeTarget` จะชี้ตอนเดิม แต่ตอนนี้อาจมีตอนใหม่แล้ว จึงต้องดูรายการจริง
  const repeatsFinished = progress.pct >= FINISHED_PCT && progress.next === null
  if (!repeatsFinished && has(target)) return resume(target)

  const after = chapters.reduce<number | null>((best, chapter) => (chapter.number > progress.number && (best === null || chapter.number < best) ? chapter.number : best), null)
  if (after !== null) return resume(after)

  // ไม่มีตอนไหนเลขมากกว่าตอนที่อ่านแล้ว → ตอนล่าสุดที่มีคือตอนที่อ่านนั้นเอง (ถ้ายังอยู่) หรือตอนท้ายสุดที่เหลือ (ถ้าตอนท้ายๆ ถูกลบไป)
  return { kind: "reread", number: latest, label: `อ่านซ้ำ ตอนที่ ${latest}` }
}

export interface ListState {
  order: ChapterOrder
  /** หน้าที่แสดง (เริ่มที่ 1) */
  page: number
  /** ตอนที่เพิ่งกระโดดไปหาด้วยช่อง "ไปตอนที่" (ไฮไลต์) — ยังไม่เคย = null */
  jump: number | null
  /** นับจำนวนครั้งที่กระโดด: กระโดดไปตอนเดิมซ้ำก็ต้องเลื่อน/โฟกัสอีกครั้ง */
  jumps: number
}

export const INITIAL_LIST: ListState = { order: DEFAULT_ORDER, page: 1, jump: null, jumps: 0 }

export type ListAction =
  | { type: "order"; order: ChapterOrder }
  /** `count` = จำนวนตอนทั้งหมด (ไว้ตรึงเลขหน้า) */
  | { type: "page"; page: number; count: number }
  /** `page` = หน้าที่มีตอนนั้น (คำนวณด้วย `resolveJump`) */
  | { type: "jump"; number: number; page: number }

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "order":
      return action.order === state.order ? state : { ...state, order: action.order, page: 1, jump: null }
    case "page":
      return { ...state, page: clampPage(action.page, action.count) }
    case "jump":
      return { ...state, page: action.page, jump: action.number, jumps: state.jumps + 1 }
  }
}
