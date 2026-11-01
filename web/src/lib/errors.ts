/** ข้อความข้อผิดพลาดที่ผู้อ่านเห็น: ข้อความหลักตามภาษาจากรหัสข้อผิดพลาด + คำแนะนำว่าควรทำอะไรต่อ */
import type { Messages } from "../i18n/messages"

/** 0 = ไม่ได้คำตอบเลย (เครือข่ายล่ม) → ตรวจอินเทอร์เน็ต · 500–599 → ลองใหม่ภายหลัง · อย่างอื่น (เช่น 404, 429) ไม่มีคำแนะนำเพิ่ม */
export function errorHint(status: number, m: Messages): string | null {
  if (status === 0) return m.errors.networkHint
  if (status >= 500 && status <= 599) return m.errors.serverHint
  return null
}

/**
 * ข้อความหลักของข้อผิดพลาด — ภาษาไทยแสดงข้อความของเซิร์ฟเวอร์ตรงๆ (บางรหัสมีหลายข้อความ เช่น not_found แต่ละเส้นทางบอกคนละเรื่อง)
 * ภาษาอื่น: รหัสที่รู้จักได้ข้อความตามภาษา · ไม่รู้จัก/ไม่มีรหัส → ข้อความไทยของเซิร์ฟเวอร์ (ดีกว่าไม่มีข้อความ)
 */
export function errorText(error: { code?: string; message: string }, m: Messages): string {
  if (m.locale === "th") return error.message
  const table: Record<string, string> = m.errors.byCode
  return error.code !== undefined && Object.hasOwn(table, error.code) ? table[error.code]! : error.message
}
