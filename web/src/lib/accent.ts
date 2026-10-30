/**
 * สีเน้นของเว็บ (เจ้าของเลือกในหน้าตั้งค่า): เซิร์ฟเวอร์ใส่ `data-accent` บน `<html>` มาให้แล้วตอนส่งหน้า (`server/src/http/shell.ts`)
 * ฝั่งหน้าเว็บตั้งซ้ำจากข้อมูลเว็บเฉพาะเมื่อต่างจากที่ใส่มา — จำเป็นตอนพัฒนาด้วย Vite ที่ไม่มีเซิร์ฟเวอร์ใส่ให้ และเมื่อเจ้าของเปลี่ยนสีแล้วโหลดใหม่
 */
import type { AccentId } from "./types"

/** ทุกชุดสี (ตรงกับ `html[data-accent=…]` ใน `styles/tokens.css` — มีเทสต์ตรวจ) `default` = ไม่ใส่ `data-accent` ใช้สีของแต่ละธีมตาม spec */
export const ACCENT_IDS = ["default", "violet", "pink", "teal", "amber", "blue"] as const satisfies readonly AccentId[]

/** ถ้า `AccentId` มีชุดสีที่ไม่อยู่ในรายการข้างบน บรรทัดนี้จะไม่ผ่าน typecheck */
export type AccentListIsComplete = Exclude<AccentId, (typeof ACCENT_IDS)[number]> extends never ? true : never

/** ส่วนของ `<html>` ที่ใช้ (แยกเป็นอินเทอร์เฟซเพื่อเทสต์ได้โดยไม่ต้องมี DOM) */
export interface AccentRoot {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

const ATTRIBUTE = "data-accent"

const isAccent = (value: string): value is AccentId => (ACCENT_IDS as readonly string[]).includes(value)

/**
 * ทำให้ `data-accent` ตรงกับ `accent` ของเว็บ: ชุดสีทั่วไป → ตั้งค่า (ถ้ายังไม่ตรง) · `default` → ลบออก
 * ชื่อที่ไม่รู้จัก (หน้าเว็บกับเซิร์ฟเวอร์คนละเวอร์ชัน) → ไม่แตะอะไร คงค่าที่เซิร์ฟเวอร์ใส่มา · ไม่เขียนซ้ำเมื่อตรงอยู่แล้ว
 */
export function syncAccent(root: AccentRoot, accent: string): void {
  if (!isAccent(accent)) return
  const current = root.getAttribute(ATTRIBUTE)
  if (accent === "default") {
    if (current !== null) root.removeAttribute(ATTRIBUTE)
  } else if (current !== accent) {
    root.setAttribute(ATTRIBUTE, accent)
  }
}
