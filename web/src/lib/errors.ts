/** คำแนะนำใต้ข้อความข้อผิดพลาด (ข้อความหลักมาจากเซิร์ฟเวอร์เป็นภาษาไทยอยู่แล้ว — ที่นี่เพิ่มเฉพาะสิ่งที่ผู้อ่านควรทำต่อ) */

export const NETWORK_HINT = "ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง"
export const SERVER_HINT = "เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่"

/** 0 = ไม่ได้คำตอบเลย (เครือข่ายล่ม) → ตรวจอินเทอร์เน็ต · 500–599 → ลองใหม่ภายหลัง · อย่างอื่น (เช่น 404, 429) ไม่มีคำแนะนำเพิ่ม */
export function errorHint(status: number): string | null {
  if (status === 0) return NETWORK_HINT
  if (status >= 500 && status <= 599) return SERVER_HINT
  return null
}
