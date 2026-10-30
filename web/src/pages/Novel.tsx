/** หน้านิยาย (ชั่วคราว — งาน 25 แทนที่ด้วยหน้าจริง: ปก เรื่องย่อ รายการตอน) */
import { Link, useParams } from "react-router"
import { EmptyState } from "../components/EmptyState"

export function Novel() {
  const { id } = useParams()
  return (
    <EmptyState
      title="หน้านิยายกำลังสร้าง"
      hint={`นิยายเลขที่ ${id ?? ""}`}
      action={
        <Link to="/" className="btn ghost">
          กลับหน้าแรก
        </Link>
      }
    />
  )
}
