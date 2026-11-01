/** หน้า "ไม่พบหน้านี้" — ที่อยู่ไหนที่ไม่ตรงเส้นทางใดในโครงหน้าสาธารณะ (เซิร์ฟเวอร์ตอบ 404 พร้อม noindex ให้เอง) */
import { Link } from "react-router"
import { EmptyState } from "../components/EmptyState"
import { useI18n } from "../i18n/I18nProvider"
import { useDocumentTitle } from "../lib/useDocumentTitle"

export function NotFound() {
  const { m } = useI18n()
  useDocumentTitle(m.notFound.title)
  return (
    <EmptyState
      title={m.notFound.title}
      hint={m.notFound.hint}
      action={
        <Link to="/" className="btn primary">
          {m.notFound.home}
        </Link>
      }
    />
  )
}
