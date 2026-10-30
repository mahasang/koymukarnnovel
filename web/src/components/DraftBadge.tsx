import { Eye } from "lucide-react"

/** ข้อความตาม spec 6.8: เรื่อง/ตอนที่ยังไม่เผยแพร่ที่ผู้ดูแลเห็นขณะล็อกอินอยู่ */
export const DRAFT_LABEL = "ร่าง — เห็นเฉพาะผู้ดูแล"

/** `compact` = แบบย่อบนมุมปก: เห็นแค่ "ร่าง" แต่โปรแกรมอ่านหน้าจอและคำอธิบายตอนวางเมาส์ได้ข้อความเต็ม */
export function DraftBadge({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <span className="draft draft-compact" title={DRAFT_LABEL}>
        <span aria-hidden="true">ร่าง</span>
        <span className="sr-only">{DRAFT_LABEL}</span>
      </span>
    )
  }
  return (
    <span className="draft">
      <Eye aria-hidden="true" size={13} />
      {DRAFT_LABEL}
    </span>
  )
}
