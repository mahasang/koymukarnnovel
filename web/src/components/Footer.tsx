/**
 * ท้ายเว็บ (spec 6.1): ชื่อเว็บ · ข้อความสถานะเนื้อหา "นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม" · ลิงก์เกี่ยวกับ/ติดต่อและแจ้งลบ
 * `FooterView` ไม่ดึงข้อมูลเอง (ทดสอบง่าย) · `Footer` อ่านข้อมูลเว็บแล้วส่งให้
 */
import { Link } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { useSite } from "../lib/SiteContext"
import { shownSiteName } from "../lib/title"

export interface FooterViewProps {
  /** ชื่อเว็บ — null = ยังโหลดอยู่ ไม่เขียนชื่อ */
  siteName: string | null
  year: number
}

export function FooterView({ siteName, year }: FooterViewProps) {
  const { m } = useI18n()
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="cols">
          <div className="foot-brand">
            <div className="logo">
              <span className="mark" aria-hidden="true">
                K
              </span>
              {siteName !== null ? <span className="logo-name">{siteName}</span> : null}
            </div>
            <p className="foot-note">{m.footer.note}</p>
          </div>
          <nav className="foot-nav" aria-label={m.footer.linksLabel}>
            <div>
              <h2 className="foot-h">{m.footer.menu}</h2>
              <ul>
                <li>
                  <Link to="/">{m.footer.home}</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="foot-h">{m.footer.info}</h2>
              <ul>
                <li>
                  <Link to="/about">{m.footer.about}</Link>
                </li>
                <li>
                  <Link to="/contact">{m.footer.contact}</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="cr">{`© ${year}${siteName !== null ? ` ${siteName}` : ""}`}</div>
      </div>
    </footer>
  )
}

export function Footer() {
  return <FooterView siteName={shownSiteName(useSite())} year={new Date().getFullYear()} />
}
