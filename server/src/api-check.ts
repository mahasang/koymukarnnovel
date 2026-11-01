import type { Settings } from "./settings.js"
import { nowSql } from "./util/time.js"

/** ผลการกด "ทดสอบการเชื่อมต่อ API" ล่าสุด เก็บเป็นค่าภายในของระบบ (ไม่อยู่ในการตั้งค่าที่ผู้ดูแลแก้ได้) ให้ Dashboard แสดงสถานะ */
export interface ApiCheck {
  /** เวลา UTC รูปแบบฐานข้อมูล */
  at: string
  ok: boolean
  message: string
}

export const API_CHECK_KEY = "api_last_check"

/** ข้อความผลทดสอบที่เก็บยาวสุด (ข้อความมาจากการจัดประเภท error ของเราเอง แต่กันไว้ไม่ให้แถวพองหรือหน้าจอล้น) */
const MAX_MESSAGE = 500

/** ยังไม่เคยทดสอบ (ค่าว่าง) หรือค่าที่เก็บไว้เสียรูป (ถูกแก้นอกระบบ) → null */
export function readApiCheck(settings: Settings): ApiCheck | null {
  try {
    const { at, ok, message } = JSON.parse(settings.getInternal(API_CHECK_KEY)) as Record<string, unknown>
    return typeof at === "string" && typeof ok === "boolean" && typeof message === "string" ? { at, ok, message } : null
  } catch {
    return null
  }
}

/** เก็บผลล่าสุด (ทับของเดิม) คืนค่าที่เก็บจริง (ข้อความถูกตัดแล้ว) */
export function writeApiCheck(settings: Settings, ok: boolean, message: string, now: Date): ApiCheck {
  const check: ApiCheck = { at: nowSql(now), ok, message: message.slice(0, MAX_MESSAGE) }
  settings.setInternal(API_CHECK_KEY, JSON.stringify(check))
  return check
}
