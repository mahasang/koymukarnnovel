/**
 * แถวปกแนวนอนเลื่อนข้างได้ (หน้าแรก "อัปเดตล่าสุด"): การ์ดนิยายเรียงตามลำดับที่ให้มา
 * ป้าย "ใหม่" เมื่อเรื่องอัปเดตภายใน 3 วัน · ชิป "ตอน N" = ตอนล่าสุด (ยังไม่มีตอน = ไม่มีชิป; ตอนที่ 0 เป็นตอนจริง)
 */
import { useId } from "react"
import { isNew } from "../lib/format"
import type { NovelCardDto } from "../lib/types"
import { NovelCard } from "./NovelCard"

export function NovelRow({ title, novels, now }: { title: string; novels: NovelCardDto[]; now?: number }) {
  const headingId = useId()
  if (novels.length === 0) return null
  return (
    <section aria-labelledby={headingId}>
      <h2 className="sec-h" id={headingId}>
        {title}
      </h2>
      <div className="row">
        {novels.map((novel) => (
          <NovelCard key={novel.id} novel={novel} now={now} badge={isNew(novel.updatedAt, now) ? "ใหม่" : null} chip={novel.latestNumber !== null ? `ตอน ${novel.latestNumber}` : null} />
        ))}
      </div>
    </section>
  )
}
