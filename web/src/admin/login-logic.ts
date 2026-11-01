/** การล็อกอินหลังบ้าน: เรียกเซิร์ฟเวอร์ แล้วแปลผลเป็นข้อความที่ผู้ใช้เห็น (หน้าจอ `Login.tsx` แค่แสดง) */
import { ApiError } from "../lib/api"
import { admin } from "./adminApi"
import { retryWaitPhrase } from "./format"

export type LoginResult = { ok: true } | { ok: false; message: string }

function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return "เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง"
  if (error.status === 401) return "รหัสผ่านไม่ถูกต้อง"
  if (error.status === 429) {
    const seconds = (error.data as { retryAfterSec?: unknown } | undefined)?.retryAfterSec
    return `ลองรหัสผ่านผิดหลายครั้งเกินไป ${retryWaitPhrase(seconds)} แล้วลองใหม่`
  }
  return error.message
}

/** รหัสว่างไม่ส่งไปเซิร์ฟเวอร์ (ไม่เปลืองโควตาลองผิด); รหัสที่เป็นช่องว่างล้วนส่งตามจริง เพราะรหัสผ่านจริงมีช่องว่างได้ */
export async function attemptLogin(password: string): Promise<LoginResult> {
  if (password === "") return { ok: false, message: "กรอกรหัสผ่านก่อน" }
  try {
    await admin.login(password)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: messageOf(error) }
  }
}
