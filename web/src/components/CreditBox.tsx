/**
 * กล่องเครดิต (spec 6.2): ผู้แต่ง · ต้นฉบับ (ลิงก์ไปเว็บต้นฉบับ เปิดแท็บใหม่) · ป้าย "แปลโดย AI" · บันทึกสิทธิ์ถ้ามี · ลิงก์ "แจ้งลบเนื้อหา"
 * ทุกช่องที่เจ้าของกรอกแสดงเป็นข้อความล้วน; ต้นฉบับเป็นลิงก์เฉพาะ http/https (ดู `sourceOf`)
 */
import { Bot, ExternalLink } from "lucide-react"
import { Link } from "react-router"
import { sourceOf } from "../lib/source"

export const AI_BADGE = "แปลโดย AI (Claude) — อาจมีข้อผิดพลาด"

const HEADING_ID = "credit-title"
const NOT_SPECIFIED = "ไม่ระบุ"

export function CreditBox({ author, sourceUrl, licenseNote }: { author: string; sourceUrl: string; licenseNote: string }) {
  const source = sourceOf(sourceUrl)
  const license = licenseNote.trim()
  return (
    <section className="nv-sec credit" aria-labelledby={HEADING_ID}>
      <h2 className="nv-h" id={HEADING_ID}>
        เครดิตและที่มา
      </h2>
      <dl className="credit-list">
        <div className="credit-row">
          <dt>ผู้แต่ง</dt>
          <dd>{author.trim() || NOT_SPECIFIED}</dd>
        </div>
        <div className="credit-row">
          <dt>ต้นฉบับ</dt>
          <dd>
            {source.kind === "link" ? (
              <a href={source.href} title={source.href} target="_blank" rel="noopener noreferrer nofollow">
                {source.label}
                <ExternalLink aria-hidden="true" size={14} />
                <span className="sr-only"> (เปิดในแท็บใหม่)</span>
              </a>
            ) : source.kind === "text" ? (
              source.text
            ) : (
              NOT_SPECIFIED
            )}
          </dd>
        </div>
        {license !== "" ? (
          <div className="credit-row">
            <dt>บันทึกสิทธิ์</dt>
            <dd className="credit-license">{license}</dd>
          </div>
        ) : null}
      </dl>
      <p className="ai-badge">
        <Bot aria-hidden="true" size={16} />
        {AI_BADGE}
      </p>
      <Link to="/contact" className="credit-report">
        แจ้งลบเนื้อหา
      </Link>
    </section>
  )
}
