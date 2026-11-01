/**
 * ตัวช่วยแสดงผลที่ใช้ร่วมกันทุกหน้า
 * เวลาจากเซิร์ฟเวอร์เป็นข้อความ `YYYY-MM-DD HH:MM:SS` เวลา UTC เสมอ — อ่านเองด้วยมือ (ไม่ใช้ `Date.parse` ที่ตีความเป็นเวลาของเครื่องและยอมรับวันที่เกินจริง)
 */
import { MONTHS, YEAR_OFFSET } from "../i18n/dates"
import type { Messages } from "../i18n/messages"
import type { Locale } from "../i18n/types"

const SQL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const HOUR = 60 * 60 * 1000
const NEW_WINDOW = 72 * HOUR
/** แสดงวันที่เป็นเวลาไทย (UTC+7) เสมอ ไม่ว่าเครื่องผู้อ่านอยู่เขตเวลาไหน */
const THAI_OFFSET = 7 * HOUR

/** เวลา SQL (UTC) → มิลลิวินาทีจาก epoch; รูปแบบผิดหรือวันที่ไม่มีจริง (30 ก.พ., 24:00:00, เดือน 13) → null */
export function parseSqlTime(sql: string): number | null {
  const match = SQL_TIME.exec(sql)
  if (match === null) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  // วันที่ที่ไม่มีจริง (30 ก.พ., 24:00:00, เดือน 13) ถูก Date.UTC ปัดไปวันอื่น และปี 0000–0099 ถูกเลื่อนเป็น 19xx — แปลงกลับเป็นข้อความแล้วต้องได้ตัวเดิมเป๊ะ
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") === sql ? ms : null
}

/** ป้าย "ใหม่": ปรับปรุงภายใน 3 วัน (72 ชั่วโมงเต็ม นับรวมขอบ) — เวลาในอนาคต (นาฬิกาเครื่องช้ากว่าเซิร์ฟเวอร์) ก็นับว่าใหม่; รูปแบบผิด → false */
export function isNew(updatedAt: string, now: number = Date.now()): boolean {
  const time = parseSqlTime(updatedAt)
  return time !== null && now - time <= NEW_WINDOW
}

/** อ่านถึงตอนที่ `number` จากตอนล่าสุด `latestNumber` คิดเป็นกี่เปอร์เซ็นต์ (ปัดเศษ ตรึง 0–100; ยังไม่มีตอนเลยหรือค่าไร้เหตุผล → 0) */
export function resumePercent(number: number, latestNumber: number): number {
  const pct = Math.round((number / latestNumber) * 100)
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
}

/**
 * วันที่ตามภาษา จากเวลา SQL (UTC) เป็นวันที่ตามเวลาไทย/ลาว (UTC+7): ไทย "22 ต.ค. 2569" (พ.ศ.) · English "22 Oct 2026" · ລາວ "22 ຕຸລາ 2026" (ทั้งสองใช้ ค.ศ.)
 * รูปแบบผิด → สตริงว่าง (ไม่แสดงอะไรดีกว่าแสดงข้อความมั่ว)
 */
export function formatDate(sql: string, locale: Locale): string {
  const time = parseSqlTime(sql)
  if (time === null) return ""
  const local = new Date(time + THAI_OFFSET)
  return `${local.getUTCDate()} ${MONTHS[locale][local.getUTCMonth()]} ${local.getUTCFullYear() + YEAR_OFFSET[locale]}`
}

/** วันที่แบบไทย (พ.ศ.) — หลังบ้านใช้ตรงๆ เพราะเป็นไทยเสมอ */
export function thaiDate(sql: string): string {
  return formatDate(sql, "th")
}

const MINUTE = 60 * 1000
const DAY = 24 * HOUR
const WEEK_DAYS = 7
/** ตั้งแต่กี่วันขึ้นไปที่บอกเป็นวันที่ตรงๆ แทน "N สัปดาห์ที่แล้ว" */
const DATE_AFTER_DAYS = 30

/** วันที่ตามปฏิทินไทย (UTC+7) นับเป็นลำดับวันจาก epoch — ใช้เทียบว่า "เมื่อวาน" คือวันก่อนหน้าจริงตามปฏิทิน ไม่ใช่แค่ห่างกัน 24 ชั่วโมง */
const thaiDayIndex = (ms: number) => Math.floor((ms + THAI_OFFSET) / DAY)

/**
 * เวลาที่ผ่านมาแบบอ่านง่าย (ป้ายใต้ปกนิยาย) จากเวลา SQL (UTC):
 * ไม่ถึง 1 นาที "เมื่อสักครู่" → "N นาทีที่แล้ว" → "N ชั่วโมงที่แล้ว" (ถึง 24 ชั่วโมงเต็ม นับตามเวลาจริง)
 * → "เมื่อวาน" / "N วันที่แล้ว" (นับตามปฏิทินไทย) → "N สัปดาห์ที่แล้ว" (ตั้งแต่ 7 วัน) → วันที่แบบไทย (ตั้งแต่ 30 วัน)
 * เวลาในอนาคต (นาฬิกาเครื่องผู้อ่านช้ากว่าเซิร์ฟเวอร์) นับเป็น "เมื่อสักครู่" · รูปแบบผิด → สตริงว่าง
 */
export function timeAgo(sql: string, m: Messages, now: number = Date.now()): string {
  const time = parseSqlTime(sql)
  if (time === null) return ""
  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE) return m.time.justNow
  if (elapsed < HOUR) return m.time.minutesAgo(Math.floor(elapsed / MINUTE))
  if (elapsed < DAY) return m.time.hoursAgo(Math.floor(elapsed / HOUR))
  const days = thaiDayIndex(now) - thaiDayIndex(time)
  if (days === 1) return m.time.yesterday
  if (days < WEEK_DAYS) return m.time.daysAgo(days)
  if (days < DATE_AFTER_DAYS) return m.time.weeksAgo(Math.floor(days / WEEK_DAYS))
  return formatDate(sql, m.locale)
}
