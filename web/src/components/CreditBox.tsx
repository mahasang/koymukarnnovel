/**
 * กล่องเครดิต (spec 6.2): ผู้แต่ง · ต้นฉบับ (ลิงก์ไปเว็บต้นฉบับ เปิดแท็บใหม่) · ป้าย "แปลโดย AI" · บันทึกสิทธิ์ถ้ามี · ลิงก์ "แจ้งลบเนื้อหา"
 * ทุกช่องที่เจ้าของกรอกแสดงเป็นข้อความล้วน; ต้นฉบับเป็นลิงก์เฉพาะ http/https (ดู `sourceOf`)
 */
import { Bot, ExternalLink } from "lucide-react"
import { Link } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { CONTENT_LANG } from "../i18n/types"
import { sourceOf } from "../lib/source"

const HEADING_ID = "credit-title"

export function CreditBox({ author, sourceUrl, licenseNote }: { author: string; sourceUrl: string; licenseNote: string }) {
  const { m } = useI18n()
  const source = sourceOf(sourceUrl)
  const license = licenseNote.trim()
  return (
    <section className="nv-sec credit" aria-labelledby={HEADING_ID}>
      <h2 className="nv-h" id={HEADING_ID}>
        {m.credit.title}
      </h2>
      <dl className="credit-list">
        <div className="credit-row">
          <dt>{m.credit.author}</dt>
          <dd>{author.trim() !== "" ? <span lang={CONTENT_LANG}>{author.trim()}</span> : m.credit.notSpecified}</dd>
        </div>
        <div className="credit-row">
          <dt>{m.credit.source}</dt>
          <dd>
            {source.kind === "link" ? (
              <a href={source.href} title={source.href} target="_blank" rel="noopener noreferrer nofollow">
                <span lang={CONTENT_LANG}>{source.label}</span>
                <ExternalLink aria-hidden="true" size={14} />
                <span className="sr-only"> {m.credit.newTab}</span>
              </a>
            ) : source.kind === "text" ? (
              <span lang={CONTENT_LANG}>{source.text}</span>
            ) : (
              m.credit.notSpecified
            )}
          </dd>
        </div>
        {license !== "" ? (
          <div className="credit-row">
            <dt>{m.credit.license}</dt>
            <dd className="credit-license" lang={CONTENT_LANG}>{license}</dd>
          </div>
        ) : null}
      </dl>
      <p className="ai-badge">
        <Bot aria-hidden="true" size={16} />
        {m.credit.aiBadge}
      </p>
      <Link to="/contact" className="credit-report">
        {m.credit.report}
      </Link>
    </section>
  )
}
