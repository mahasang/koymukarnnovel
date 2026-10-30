/** หน้าอ่าน (ชั่วคราว — งาน 26 แทนที่ด้วยหน้าอ่านจริง) อยู่นอก Layout: ไม่มีแถบบน/ท้ายเว็บ ให้อ่านเต็มจอ */
import { Link, useParams } from "react-router"
import { EmptyState } from "../components/EmptyState"

export function Reader() {
  const { id, number } = useParams()
  return (
    <main className="wrap main">
      <EmptyState
        title="หน้าอ่านกำลังสร้าง"
        hint={`นิยายเลขที่ ${id ?? ""} ตอนที่ ${number ?? ""}`}
        action={
          <Link to={`/novel/${id ?? ""}`} className="btn ghost">
            กลับหน้านิยาย
          </Link>
        }
      />
    </main>
  )
}
