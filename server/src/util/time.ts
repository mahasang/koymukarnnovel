const DAY_OFFSET_MS = 7 * 3600 * 1000 // "วัน" ของยอดอ่านและโทเคนนับตามเวลา UTC+7

/** เวลา UTC รูปแบบ YYYY-MM-DD HH:MM:SS (รูปแบบเดียวที่เก็บในฐานข้อมูล) */
export function nowSql(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", " ")
}

/** วันที่ (YYYY-MM-DD) ตามเวลา UTC+7 */
export function dayKey(d: Date): string {
  return new Date(d.getTime() + DAY_OFFSET_MS).toISOString().slice(0, 10)
}
