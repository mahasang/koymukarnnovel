import { Eye } from "lucide-react"
import { useI18n } from "../i18n/I18nProvider"

/** ป้ายตาม spec 6.8: เรื่อง/ตอนที่ยังไม่เผยแพร่ที่ผู้ดูแลเห็นขณะล็อกอินอยู่ (ข้อความอยู่ใน `m.draft`) */

/** `compact` = แบบย่อบนมุมปก: เห็นแค่ "ร่าง" แต่โปรแกรมอ่านหน้าจอและคำอธิบายตอนวางเมาส์ได้ข้อความเต็ม */
export function DraftBadge({ compact = false }: { compact?: boolean }) {
  const { m } = useI18n()
  const label = m.draft.label
  if (compact) {
    return (
      <span className="draft draft-compact" title={label}>
        <span aria-hidden="true">{m.draft.short}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  return (
    <span className="draft">
      <Eye aria-hidden="true" size={13} />
      {label}
    </span>
  )
}
