/**
 * ตัวช่วยแสดงผลที่ใช้ร่วมกันทุกหน้า
 * เวลาจากเซิร์ฟเวอร์เป็นข้อความ `YYYY-MM-DD HH:MM:SS` เวลา UTC เสมอ — อ่านเองด้วยมือ (ไม่ใช้ `Date.parse` ที่ตีความเป็นเวลาของเครื่องและยอมรับวันที่เกินจริง)
 */

const SQL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const HOUR = 60 * 60 * 1000
const NEW_WINDOW = 72 * HOUR
/** แสดงวันที่เป็นเวลาไทย (UTC+7) เสมอ ไม่ว่าเครื่องผู้อ่านอยู่เขตเวลาไหน */
const THAI_OFFSET = 7 * HOUR
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/** เวลา SQL (UTC) → มิลลิวินาทีจาก epoch; รูปแบบผิดหรือวันที่ไม่มีจริง (30 ก.พ., 24:00:00, เดือน 13) → null */
function parseSqlTime(sql: string): number | null {
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

/** วันที่แบบไทย "22 ต.ค. 2569" (พ.ศ. เวลาไทย) จากเวลา SQL (UTC); รูปแบบผิด → สตริงว่าง (ไม่แสดงอะไรดีกว่าแสดงข้อความมั่ว) */
export function thaiDate(sql: string): string {
  const time = parseSqlTime(sql)
  if (time === null) return ""
  const thai = new Date(time + THAI_OFFSET)
  return `${thai.getUTCDate()} ${THAI_MONTHS[thai.getUTCMonth()]} ${thai.getUTCFullYear() + 543}`
}
