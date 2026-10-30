import { Inbox } from "lucide-react"
import type { ReactNode } from "react"

/** สถานะ "ว่างเปล่า" ที่เป็นมิตร (ยังไม่มีนิยาย ไม่พบผลค้นหา ฯลฯ) — `action` คือปุ่มหรือลิงก์ที่พาไปต่อ */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="state state-empty">
      <div className="state-icon" aria-hidden="true">
        <Inbox size={26} />
      </div>
      <h2 className="state-title">{title}</h2>
      {hint ? <p className="state-hint">{hint}</p> : null}
      {action ? <div className="state-actions">{action}</div> : null}
    </div>
  )
}
