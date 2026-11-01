import { useEffect } from "react"
import { useSite } from "./SiteContext"
import { titleFor } from "./title"

/**
 * ตั้งชื่อแท็บของหน้า — `page` เป็น undefined = หน้ายังไม่พร้อม (ไม่เปลี่ยนชื่อแท็บ) · null = ไม่มีชื่อหน้า (หน้าแรก) · ข้อความ = "ชื่อหน้า | ชื่อเว็บ"
 * ชื่อแท็บแรกเข้าเซิร์ฟเวอร์ใส่ให้อยู่แล้ว (รูปแบบเดียวกัน ดู `titleFor`) ตรงนี้ดูแลตอนเปลี่ยนหน้าในเว็บ
 */
export function useDocumentTitle(page: string | null | undefined): void {
  const title = titleFor(page, useSite())
  useEffect(() => {
    if (title !== null) document.title = title
  }, [title])
}
