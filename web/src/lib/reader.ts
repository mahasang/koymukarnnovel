/**
 * ตรรกะล้วนของหน้าอ่าน (ไม่แตะ DOM จึงทดสอบได้): แถบบนซ่อน/โผล่ตามทิศเลื่อน, เปอร์เซ็นต์ที่อ่านแล้วกับการคืนตำแหน่ง,
 * ปุ่มลูกศรเปลี่ยนตอน, ชื่อตอน/ชื่อแท็บ, ย่อหน้าที่เห็นอยู่ (จุดเริ่มอ่านออกเสียง)
 */
import type { Messages } from "../i18n/messages"
import { displayTitle } from "./novel"
import { FINISHED_PCT, type Progress } from "./progress"

/** อยู่ห่างขอบบนไม่เกินนี้ (พิกเซล) แถบบนเห็นเสมอ */
export const BAR_TOP_ZONE = 80
/** เลื่อนลงสะสมเท่านี้จึงซ่อนแถบ / เลื่อนขึ้นสะสมเท่านี้จึงโผล่ — กันกะพริบจากการขยับนิดเดียว */
export const BAR_HIDE_AFTER = 24
export const BAR_SHOW_AFTER = 12

export interface BarState {
  visible: boolean
  /** ตำแหน่งเลื่อนที่นับระยะสะสมจากมัน: ตอนเห็นแถบ = จุดที่สูงสุดที่ผ่านมาตั้งแต่โผล่, ตอนซ่อน = จุดที่ต่ำสุด */
  anchor: number
}

export const INITIAL_BAR: BarState = { visible: true, anchor: 0 }

/**
 * สถานะแถบบนหลังเลื่อนมาที่ `y` (พิกเซลจากบนสุดของหน้า): ใกล้บนสุดหรือปักหมุดอยู่ (กำลังฟังเสียง/เปิดแผงตั้งค่า) เห็นเสมอ
 * ไม่งั้นเห็นอยู่แล้วเลื่อนลงสะสมครบก็ซ่อน, ซ่อนอยู่แล้วเลื่อนขึ้นสะสมครบก็โผล่
 */
export function nextBarState(state: BarState, y: number, pinned: boolean): BarState {
  if (!Number.isFinite(y)) return state
  if (pinned || y <= BAR_TOP_ZONE) return { visible: true, anchor: y }
  if (state.visible) {
    const anchor = Math.min(state.anchor, y)
    return y - anchor >= BAR_HIDE_AFTER ? { visible: false, anchor: y } : { visible: true, anchor }
  }
  const anchor = Math.max(state.anchor, y)
  return anchor - y >= BAR_SHOW_AFTER ? { visible: true, anchor: y } : { visible: false, anchor }
}

/**
 * เปอร์เซ็นต์ที่เลื่อนไปของช่วงที่เลื่อนได้ (สูงเอกสาร − สูงจอ) ตรึง 0–100 (float; `saveProgress` ปัดเองตอนเก็บ)
 * เอกสารสั้นจนไม่ต้องเลื่อน = เห็นครบแล้ว → 100 · ค่าที่ไม่ใช่จำนวน → 0 (ไม่รู้ ไม่ถือว่าอ่านจบ)
 */
export function scrollPct(top: number, height: number, view: number): number {
  const range = height - view
  if (Number.isNaN(range) || Number.isNaN(top)) return 0
  if (range <= 0) return 100
  return Math.min(100, Math.max(0, (top / range) * 100))
}

/** ตำแหน่งเลื่อน (พิกเซล จำนวนเต็ม) ที่ตรงกับเปอร์เซ็นต์ — ขั้นกลับของ `scrollPct`; ไม่ต้องเลื่อน/ค่าไม่ใช่จำนวน → 0 */
export function restoreTop(pct: number, height: number, view: number): number {
  const range = height - view
  if (Number.isNaN(range) || Number.isNaN(pct) || range <= 0) return 0
  return Math.round((Math.min(100, Math.max(0, pct)) / 100) * range)
}

/** เปิดตอนที่อ่านค้างไว้ (อ่านไปบ้างแล้วแต่ยังไม่ถึง `FINISHED_PCT`) → เลื่อนกลับไปที่เดิม; อย่างอื่นเริ่มที่บนสุด */
export function shouldRestore(progress: Progress | null, number: number): boolean {
  return progress !== null && progress.number === number && progress.pct > 0 && progress.pct < FINISHED_PCT
}

/** เลขตอนจาก URL (`/novel/:id/:number`): จำนวนเต็มไม่ติดลบไม่มีศูนย์นำหน้า 1–9 หลัก (ตอนที่ 0 = บทนำ เป็นตอนจริง); อย่างอื่น → null (ไม่ต้องยิงคำขอไปถาม) */
export function parseChapterParam(raw: string | undefined): number | null {
  return raw !== undefined && /^(?:0|[1-9]\d{0,8})$/.test(raw) ? Number(raw) : null
}

/** เหตุการณ์แป้นพิมพ์เท่าที่ต้องใช้ (`KeyboardEvent` จริงใช้ได้เลย) */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  isComposing?: boolean
  target: unknown
}

/** โฟกัสอยู่ที่ที่พิมพ์ข้อความได้ (input / textarea / select / contenteditable) — ลูกศรต้องเป็นของมัน */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false
  const { tagName, isContentEditable } = target as { tagName?: unknown; isContentEditable?: unknown }
  if (isContentEditable === true) return true
  return typeof tagName === "string" && ["INPUT", "TEXTAREA", "SELECT"].includes(tagName.toUpperCase())
}

/**
 * ← → เปลี่ยนตอน: `"prev"`/`"next"` เมื่อควรเปลี่ยน, `null` = ปล่อยให้เบราว์เซอร์ทำงานต่อ
 * ไม่ทำเมื่อ: มี Ctrl/Cmd/Alt/Shift (Alt+← คือย้อนกลับ, Shift+← ขยายการเลือกข้อความ), โฟกัสอยู่ที่ช่องกรอก, มีตัวอื่นจัดการปุ่มไปแล้ว,
 * กำลังพิมพ์ด้วย IME, `blocked` (แผงตั้งค่าเปิดอยู่), หรือไม่มีตอนทางนั้น
 */
export function chapterKeyAction(event: KeyEventLike, nav: { prev: number | null; next: number | null }, blocked = false): "prev" | "next" | null {
  if (blocked || event.defaultPrevented || event.isComposing === true) return null
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  if (isTypingTarget(event.target)) return null
  if (event.key === "ArrowRight") return nav.next === null ? null : "next"
  if (event.key === "ArrowLeft") return nav.prev === null ? null : "prev"
  return null
}

/** หัวตอน: "ตอนที่ N: ชื่อตอน" (ชื่อไทยก่อน ไม่มีใช้ชื่อต้นฉบับ) · ไม่มีชื่อ → "ตอนที่ N" — คำนำหน้าตามภาษา รูปแบบเดียวกับ `<title>` ฝั่งเซิร์ฟเวอร์ */
export function chapterHeading(chapter: { number: number; title: string; titleTh: string }, m: Messages): string {
  const name = displayTitle(chapter)
  return name === "" ? m.reader.headingBare(chapter.number) : m.reader.headingNamed(chapter.number, name)
}

/** ชื่อหน้าของแท็บ (ก่อนต่อท้ายชื่อเว็บ): "หัวตอน — ชื่อเรื่อง" */
export function chapterTitle(novel: { title: string; titleTh: string }, chapter: { number: number; title: string; titleTh: string }, m: Messages): string {
  return `${chapterHeading(chapter, m)} — ${displayTitle(novel)}`
}

/**
 * ย่อหน้าแรกที่ยังมีส่วนอยู่ในพื้นที่อ่าน = ย่อหน้าแรกที่ขอบล่างอยู่ใต้ `top` (ขอบล่างของแถบบน)
 * `bottoms` = ขอบล่างของทุกย่อหน้าเรียงตามลำดับ (พิกเซลในจอ) · ไม่มี/เลื่อนพ้นทุกย่อหน้าแล้ว (ท้ายตอน) → ย่อหน้าแรก
 */
export function firstVisibleParagraph(bottoms: readonly number[], top: number): number {
  const index = bottoms.findIndex((bottom) => bottom > top)
  return index < 0 ? 0 : index
}
