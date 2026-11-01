/**
 * ความคืบหน้าการอ่านต่อเรื่อง + ประวัติเรื่องที่เพิ่งอ่าน — เก็บในเครื่องผู้อ่าน (ไม่มีบัญชี) ใช้ทำปุ่ม "อ่านต่อ" และแถว "อ่านล่าสุด" หน้าแรก
 * รูปแบบที่เก็บ: `koymukarnnovel.progress` = แผนที่ novelId → ความคืบหน้า, `koymukarnnovel.history` = อาร์เรย์ novelId (ล่าสุดก่อน)
 * ข้อมูลที่อ่านจากเครื่องถูกตรวจรูปร่างเสมอ (อาจเสีย/ถูกแก้มือ/มาจากแอปรุ่นเก่า) — ที่ใช้ไม่ได้ถูกมองเป็นไม่มี
 */
import { KEYS, readJson, writeJson } from "./storage"

export interface Progress {
  /** ตอนที่อ่านค้างไว้ */
  number: number
  /** อ่านไปแล้วกี่เปอร์เซ็นต์ของตอนนั้น (0–100) */
  pct: number
  /** ตอนถัดไปที่เห็น ณ ตอนที่บันทึก (`null` = ไม่มี) */
  next: number | null
  /** เวลาที่บันทึก (มิลลิวินาทีจาก epoch) */
  at: number
}

/** อ่านถึงเท่านี้ถือว่าจบตอน (หน้าอ่านใช้ค่าเดียวกันตัดสินว่าอ่านจบ) */
export const FINISHED_PCT = 95
const HISTORY_MAX = 10

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
/** id นิยาย: จำนวนเต็มบวก */
const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0
/** เลขตอน: จำนวนเต็มไม่ติดลบ (ตอนที่ 0 = บทนำ เป็นตอนจริง) */
const isChapterNumber = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0

function toProgress(value: unknown): Progress | null {
  if (!isRecord(value)) return null
  const { number, pct, next, at } = value
  if (!isChapterNumber(number)) return null
  if (typeof pct !== "number" || !(pct >= 0 && pct <= 100)) return null
  if (next !== null && !isChapterNumber(next)) return null
  if (typeof at !== "number" || !Number.isFinite(at)) return null
  return { number, pct, next, at }
}

/** แผนที่ทั้งก้อนที่เก็บไว้ เหลือเฉพาะรายการที่ใช้ได้ (คีย์ต้องเป็นเลข id ตรงตัว เช่น "7" ไม่ใช่ "07"/"abc") */
function readMap(): Record<string, Progress> {
  const raw = readJson<unknown>(KEYS.progress, null)
  const map: Record<string, Progress> = {}
  if (!isRecord(raw)) return map
  for (const [key, value] of Object.entries(raw)) {
    if (String(Number(key)) !== key || !isId(Number(key))) continue
    const entry = toProgress(value)
    if (entry !== null) map[key] = entry
  }
  return map
}

/** ความคืบหน้าล่าสุดของเรื่องนั้น (ยังไม่เคยอ่าน/ข้อมูลใช้ไม่ได้ → null) */
export function getProgress(novelId: number): Progress | null {
  if (!isId(novelId)) return null
  const raw = readJson<unknown>(KEYS.progress, null)
  return isRecord(raw) ? toProgress(raw[String(novelId)]) : null
}

/** pct ปัดเป็นจำนวนเต็มและตรึงในช่วง 0–100 (ค่าจากการเลื่อนหน้าจออาจเป็นทศนิยม เกิน 100 หรือ NaN) */
function clampPct(pct: number): number {
  return Number.isNaN(pct) ? 0 : Math.min(100, Math.max(0, Math.round(pct)))
}

/**
 * บันทึกว่าอ่านเรื่องนี้ถึงไหน และเลื่อนเรื่องนี้ขึ้นหน้าสุดของประวัติ (ไม่เกิน 10 เรื่อง ไม่ซ้ำ)
 * ใช้ไม่ได้ (novelId/เลขตอนผิด) → ไม่ทำอะไร; เก็บลงเครื่องไม่ได้ → เงียบ (บันทึกความคืบหน้าเป็นแค่ความสะดวก ไม่ควรขัดการอ่าน)
 */
export function saveProgress(novelId: number, p: { number: number; pct: number; next: number | null }, now: number = Date.now()): void {
  if (!isId(novelId) || !isChapterNumber(p.number)) return
  const map = readMap()
  map[String(novelId)] = { number: p.number, pct: clampPct(p.pct), next: isChapterNumber(p.next) ? p.next : null, at: now }
  writeJson(KEYS.progress, map)
  writeJson(KEYS.history, [novelId, ...getHistory().filter((id) => id !== novelId)].slice(0, HISTORY_MAX))
}

/** id นิยายที่เพิ่งอ่าน ล่าสุดก่อน ไม่ซ้ำ สูงสุด 10 เรื่อง */
export function getHistory(): number[] {
  const raw = readJson<unknown>(KEYS.history, null)
  const ids: number[] = []
  if (Array.isArray(raw)) {
    for (const id of raw) if (isId(id) && !ids.includes(id)) ids.push(id)
  }
  return ids.slice(0, HISTORY_MAX)
}

/**
 * ปุ่ม "อ่านต่อ" ควรพาไปไหน: ยังอ่านไม่จบ → ตอนเดิมที่ตำแหน่งเดิม;
 * อ่านจบแล้ว (≥ 95%) → ตอนถัดไปจากต้น ถ้าไม่มีตอนถัดไปก็ตอนเดิมจากต้น
 */
export function resumeTarget(p: Progress): { number: number; fromPct: number } {
  if (p.pct < FINISHED_PCT) return { number: p.number, fromPct: p.pct }
  return { number: p.next !== null ? p.next : p.number, fromPct: 0 }
}
