/**
 * ท้ายเว็บ (spec 6.1): ชื่อเว็บ · ข้อความสถานะเนื้อหา "นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม" · ลิงก์เกี่ยวกับ/ติดต่อและแจ้งลบ
 * `FooterView` ไม่ดึงข้อมูลเอง (ทดสอบง่าย) · `Footer` อ่านข้อมูลเว็บแล้วส่งให้
 */
import { Link } from "react-router"
import { useSite } from "../lib/SiteContext"
import { shownSiteName } from "../lib/title"

export const CONTENT_NOTE = "นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม"

export interface FooterViewProps {
  /** ชื่อเว็บ — null = ยังโหลดอยู่ ไม่เขียนชื่อ */
  siteName: string | null
  year: number
}

export function FooterView({ siteName, year }: FooterViewProps) {
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
            <p className="foot-note">{CONTENT_NOTE}</p>
          </div>
          <nav className="foot-nav" aria-label="ลิงก์ท้ายเว็บ">
            <div>
              <h2 className="foot-h">เมนู</h2>
              <ul>
                <li>
                  <Link to="/">หน้าแรก</Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="foot-h">ข้อมูล</h2>
              <ul>
                <li>
                  <Link to="/about">เกี่ยวกับเว็บไซต์</Link>
                </li>
                <li>
                  <Link to="/contact">ติดต่อ / แจ้งลบเนื้อหา</Link>
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
