/**
 * การตั้งค่าหน้าอ่านของผู้อ่าน (ขนาดตัวอักษร ฟอนต์ ความเร็วเสียงอ่าน) เก็บในเครื่องที่ `koymukarnnovel.reader` เป็น JSON สามช่อง
 * ธีมแยกเก็บต่างหาก (`theme.ts`) — ข้อมูลที่อ่านมาถูกตรวจและปรับเข้าช่วยทีละช่อง: ช่องที่เสียใช้ค่าเริ่มต้น ช่องที่ดียังอยู่
 */
import { KEYS, readJson, writeJson } from "./storage"

export const FONTS = ["sarabun", "serif"] as const
export type FontId = (typeof FONTS)[number]

export interface ReaderPrefs {
  /** 16–26 ขั้นละ 2 */
  fontSize: number
  font: FontId
  /** ความเร็วเสียงอ่าน `RATE_MIN`–`RATE_MAX` (1 = ปกติ) */
  rate: number
}

/** ช่วงความเร็วเสียงอ่านที่ให้ผู้อ่านเลือก (ตัวอ่านออกเสียงของหน้าอ่านใช้ช่วงเดียวกัน) */
export const RATE_MIN = 0.8
export const RATE_MAX = 1.4

const DEFAULTS: ReaderPrefs = { fontSize: 18, font: "sarabun", rate: 1 }

/** ปัดเป็นเลขคู่ใกล้สุด (เลขคี่ปัดขึ้น) แล้วตรึงในช่วง 16–26; NaN → ขนาดเริ่มต้น */
export function clampFontSize(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.fontSize
  return Math.min(26, Math.max(16, Math.round(n / 2) * 2))
}

/** ตรึงในช่วง `RATE_MIN`–`RATE_MAX`; NaN → ความเร็วปกติ */
export function clampRate(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.rate
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n))
}

const isFont = (value: unknown): value is FontId => FONTS.some((font) => font === value)

/** ข้อมูลอะไรก็ได้ → การตั้งค่าที่ใช้ได้ครบสามช่อง (วัตถุใหม่ทุกครั้ง ไม่มีช่องเกิน) */
function sanitize(raw: unknown): ReaderPrefs {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    fontSize: typeof o.fontSize === "number" ? clampFontSize(o.fontSize) : DEFAULTS.fontSize,
    font: isFont(o.font) ? o.font : DEFAULTS.font,
    rate: typeof o.rate === "number" ? clampRate(o.rate) : DEFAULTS.rate,
  }
}

/** การตั้งค่าที่จำไว้ (ยังไม่เคยตั้ง/เก็บไว้เสีย/localStorage ใช้ไม่ได้ → ค่าเริ่มต้น 18 / sarabun / 1) */
export function getReaderPrefs(): ReaderPrefs {
  return sanitize(readJson<unknown>(KEYS.reader, null))
}

/** จำการตั้งค่าไว้ในเครื่อง (ปรับเข้าช่วยก่อนเก็บ; เก็บไม่ได้ก็เงียบ — ใช้ค่าที่ตั้งได้จนปิดหน้า) */
export function saveReaderPrefs(prefs: ReaderPrefs): void {
  writeJson(KEYS.reader, sanitize(prefs))
}
