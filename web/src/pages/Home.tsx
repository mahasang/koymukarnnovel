/**
 * หน้าแรก (ชั่วคราว — งาน 24 แทนที่ด้วย Hero / อ่านต่อ / อัปเดตล่าสุด / นิยายทั้งหมด พร้อมค้นหา-กรอง)
 * ตอนนี้แสดงตารางการ์ดนิยายตามลำดับที่เซิร์ฟเวอร์ให้ เพื่อใช้ตรวจโครงหน้าและการ์ดกับข้อมูลจริง
 */
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { NovelCard } from "../components/NovelCard"
import { Skeleton } from "../components/Skeleton"
import { publicApi } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"

export function Home() {
  useDocumentTitle(null)
  const { data, error, reload } = useFetch("novels", (signal) => publicApi.novels(signal))

  let body
  if (error !== null) body = <ErrorState error={error} onRetry={reload} />
  else if (data === null) body = <Skeleton variant="grid" />
  else if (data.length === 0) body = <EmptyState title="ยังไม่มีนิยายให้อ่าน" hint="กลับมาใหม่เร็วๆ นี้" />
  else
    body = (
      <div className="grid">
        {data.map((novel) => (
          <NovelCard key={novel.id} novel={novel} />
        ))}
      </div>
    )

  return (
    <section className="sec">
      <h1 className="sec-h">นิยายทั้งหมด</h1>
      {body}
    </section>
  )
}
