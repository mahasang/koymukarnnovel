/** ข้อความภาษาไทยที่หลังบ้านใช้ซ้ำหลายหน้า */
import type { ChapterStatus, QueueState } from "./types"

export const STATUS_LABEL: Record<ChapterStatus, string> = {
  draft: "ร่าง",
  queued: "รอคิว",
  translating: "กำลังแปล",
  done: "แปลเสร็จ",
  error: "ผิดพลาด",
}

/** วลี "รอ …" จาก `retryAfterSec` ของ 429: ปัดขึ้นเสมอ (ไม่บอกน้อยกว่าที่ต้องรอจริง) · ค่าที่ใช้ไม่ได้ → "รอสักครู่" */
export function retryWaitPhrase(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "รอสักครู่"
  if (seconds < 60) return `รอ ${Math.ceil(seconds)} วินาที`
  return `รอ ${Math.ceil(seconds / 60)} นาที`
}

/** บรรทัดสถานะคิวสั้นๆ ใต้เมนูข้าง · `offline` = ดึงครั้งล่าสุดไม่สำเร็จ (สถานะที่เห็นอาจเก่า จึงไม่แสดงแทน) */
export function queueSummary(state: QueueState | null, offline = false): string {
  if (offline) return "เชื่อมต่อไม่ได้ · กำลังลองใหม่"
  if (state === null) return "กำลังตรวจคิว…"
  if (state.paused) return state.waitingTotal > 0 ? `คิวหยุดอยู่ · ค้าง ${state.waitingTotal} ตอน` : "คิวหยุดอยู่"
  if (state.current !== null) {
    const now = `กำลังแปลตอนที่ ${state.current.number}`
    return state.waitingTotal > 0 ? `${now} · รอ ${state.waitingTotal} ตอน` : now
  }
  return state.waitingTotal > 0 ? `รอคิว ${state.waitingTotal} ตอน` : "คิวว่าง"
}

const COUNT_FORMAT = new Intl.NumberFormat("en-US")

/** จำนวนเต็มแบ่งหลักพันด้วยจุลภาค "12,345" (ตายตัว ไม่ขึ้นกับภาษาของเครื่อง) · ค่าที่ใช้ไม่ได้ (NaN, อินฟินิตี้) → "0" */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? COUNT_FORMAT.format(Math.round(value)) : "0"
}
