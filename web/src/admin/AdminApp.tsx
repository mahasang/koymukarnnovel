/** หลังบ้าน (ชั่วคราว — งาน 28 แทนที่ด้วยโครงหลังบ้านจริง ต้องคง `export default` ไว้เพราะ App โหลดแบบ lazy) */
import { EmptyState } from "../components/EmptyState"
import { useDocumentTitle } from "../lib/useDocumentTitle"

export default function AdminApp() {
  useDocumentTitle("หลังบ้าน")
  return (
    <main className="wrap main">
      <EmptyState title="หลังบ้านกำลังสร้าง" hint="ส่วนจัดการเนื้อหาจะมาในขั้นถัดไป" />
    </main>
  )
}
