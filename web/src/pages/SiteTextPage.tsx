/** หน้าข้อความของเจ้าของ (เกี่ยวกับ / ติดต่อ) — แสดงเป็นข้อความล้วนตามที่เจ้าของพิมพ์ (React escape ให้ · ขึ้นบรรทัดใหม่ตามเดิมด้วย white-space: pre-wrap · ไม่แปลงเป็นลิงก์) */
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { CONTENT_LANG } from "../i18n/types"
import { useSite } from "../lib/SiteContext"
import type { SiteDto } from "../lib/types"
import { useDocumentTitle } from "../lib/useDocumentTitle"

export function SiteTextPage({ title, pick, emptyTitle, emptyHint }: { title: string; pick: (site: SiteDto) => string; emptyTitle: string; emptyHint: string }) {
  useDocumentTitle(title)
  const { site, error } = useSite()

  let body
  if (site === null) body = error !== null ? <ErrorState error={error} /> : <Skeleton variant="lines" />
  else if (pick(site).trim() === "") body = <EmptyState title={emptyTitle} hint={emptyHint} />
  else body = <p className="prose-text" lang={CONTENT_LANG}>
        {pick(site)}
      </p>

  return (
    <article className="prose">
      <h1>{title}</h1>
      {body}
    </article>
  )
}
