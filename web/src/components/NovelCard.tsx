/**
 * การ์ดนิยายในรายการ (หน้าแรก ผลค้นหา) — ลิงก์ทั้งใบไปหน้านิยาย
 * มุมซ้ายบน = `badge` (เช่น "ใหม่") · ขวาบน = `chip` (เช่น "ตอน 87") — สองอย่างนี้อยู่ในแถบ `.b-top` เดียวกัน ปกแคบไม่พอวางข้างกันชิปจะห่อลงบรรทัดที่สอง
 * ซ้ายล่าง = "จบแล้ว" ถ้าเรื่องจบ · ขวาล่าง = ป้ายร่างถ้ายังไม่เผยแพร่ (เห็นเฉพาะผู้ดูแล)
 */
import { Clock, User } from "lucide-react"
import { Link } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { CONTENT_LANG } from "../i18n/types"
import { timeAgo } from "../lib/format"
import { displayTitle } from "../lib/novel"
import type { NovelCardDto } from "../lib/types"
import { Cover } from "./Cover"
import { DraftBadge } from "./DraftBadge"

export interface NovelCardProps {
  novel: NovelCardDto
  badge?: string | null
  chip?: string | null
  /** เวลาอ้างอิงของ "กี่นาที/ชั่วโมงที่แล้ว" (มิลลิวินาที) — ไม่ส่ง = เวลาปัจจุบัน (ส่งเฉพาะตอนทดสอบ) */
  now?: number
}

export function NovelCard({ novel, badge = null, chip = null, now }: NovelCardProps) {
  const title = displayTitle(novel)
  const author = novel.author.trim()
  const { m } = useI18n()
  const updated = timeAgo(novel.updatedAt, m, now)
  return (
    <Link to={`/novel/${novel.id}`} className="card">
      <div className="box">
        <Cover novel={{ id: novel.id, title, hasCover: novel.hasCover, coverV: novel.coverV }} />
        {badge || chip ? (
          <div className="b-top">
            {badge ? <span className="b-new">{badge}</span> : null}
            {chip ? <span className="b-ep">{chip}</span> : null}
          </div>
        ) : null}
        {novel.status === "completed" ? <span className="b-done">{m.card.completed}</span> : null}
        {novel.published ? null : (
          <span className="b-draft">
            <DraftBadge compact />
          </span>
        )}
      </div>
      <h3 lang={CONTENT_LANG}>{title}</h3>
      {author !== "" ? (
        <div className="meta">
          <User aria-hidden="true" size={13} />
          <span lang={CONTENT_LANG}>{author}</span>
        </div>
      ) : null}
      {updated !== "" ? (
        <div className="meta">
          <Clock aria-hidden="true" size={13} />
          {updated}
        </div>
      ) : null}
    </Link>
  )
}
