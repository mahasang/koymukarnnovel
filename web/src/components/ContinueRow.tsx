/** "อ่านต่อจากที่ค้างไว้" (spec 6.1): การ์ดแนวนอนพร้อมแถบความคืบหน้า มาจากประวัติในเครื่องผู้อ่าน — ไม่มีรายการ → ไม่แสดงทั้งส่วน */
import { ChevronRight } from "lucide-react"
import { useId } from "react"
import { Link } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { CONTENT_LANG } from "../i18n/types"
import type { ContinueItem } from "../lib/library"
import { displayTitle } from "../lib/novel"
import { Cover } from "./Cover"

export function ContinueRow({ items }: { items: ContinueItem[] }) {
  const headingId = useId()
  const { m } = useI18n()
  if (items.length === 0) return null
  return (
    <section aria-labelledby={headingId}>
      <h2 className="sec-h" id={headingId}>
        {m.continueRow.title}
      </h2>
      <div className="resume">
        {items.map(({ novel, info }) => {
          const title = displayTitle(novel)
          return (
            <Link key={novel.id} to={info.href} className="rcard">
              <div className="rcard-th">
                <Cover novel={{ id: novel.id, title, hasCover: novel.hasCover, coverV: novel.coverV }} />
              </div>
              <div className="rcard-tx">
                <h3 lang={CONTENT_LANG}>{title}</h3>
                <div className="rcard-meta">
                  {m.continueRow.meta(info.chapter, info.percent)}
                </div>
                <div className="bar" role="progressbar" aria-label={m.continueRow.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={info.percent}>
                  <i style={{ width: `${info.percent}%` }} />
                </div>
                <span className="go">
                  {info.label}
                  <ChevronRight aria-hidden="true" size={16} />
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
