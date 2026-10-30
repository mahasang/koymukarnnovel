/** หน้า "ไม่พบหน้านี้" (ชั่วคราว — งาน 27 ปรับให้สมบูรณ์) */
import { Link } from "react-router"
import { EmptyState } from "../components/EmptyState"
import { useDocumentTitle } from "../lib/useDocumentTitle"

export function NotFound() {
  useDocumentTitle("ไม่พบหน้านี้")
  return (
    <EmptyState
      title="ไม่พบหน้านี้"
      hint="ลิงก์อาจเปลี่ยนไป หรือหน้านี้ยังไม่เปิดให้อ่าน"
      action={
        <Link to="/" className="btn primary">
          กลับหน้าแรก
        </Link>
      }
    />
  )
}
