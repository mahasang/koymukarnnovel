/**
 * แถบบน (ติดขอบบน พื้นเบลอ): โลโก้ + ชื่อเว็บ · เมนู · ช่องค้นหา · ลิงก์หลังบ้าน (เฉพาะผู้ดูแล) · ปุ่มภาษา · ปุ่มธีม
 * `HeaderView` ไม่ดึงข้อมูลเอง (ทดสอบง่าย) · `Header` อ่านข้อมูลเว็บกับที่อยู่ปัจจุบันแล้วส่งให้
 */
import { LayoutDashboard } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router"
import { useI18n } from "../i18n/I18nProvider"
import { queryOf } from "../lib/search"
import { useSite } from "../lib/SiteContext"
import { shownSiteName } from "../lib/title"
import { LanguageMenu } from "./LanguageMenu"
import { SearchBox } from "./SearchBox"
import { ThemeMenu } from "./ThemeMenu"

export interface HeaderViewProps {
  /** ชื่อเว็บ — null = ยังโหลดอยู่ ไม่เขียนชื่อ (กันชื่อสำรองวาบก่อนชื่อจริง) */
  siteName: string | null
  isAdmin: boolean
  /** คำค้นที่ช่องค้นหาแสดงตอนนี้ (มาจาก `?q=` ของหน้าแรก) */
  query: string
}

const MENU = [
  { to: "/", key: "home", end: true },
  { to: "/about", key: "about", end: false },
  { to: "/contact", key: "contact", end: false },
] as const

const menuClass = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : undefined)

export function HeaderView({ siteName, isAdmin, query }: HeaderViewProps) {
  const { m } = useI18n()
  return (
    <header className="top">
      <div className="wrap in">
        {/* ชื่อเว็บที่เห็นเป็นชื่อของลิงก์อยู่แล้ว; ตอนยังไม่มีชื่อให้ลิงก์มีชื่อสำรอง (ไม่เป็นลิงก์ที่ไม่มีชื่อ) */}
        <Link to="/" className="logo" aria-label={siteName === null ? m.header.home : undefined}>
          <span className="mark" aria-hidden="true">
            K
          </span>
          {siteName !== null ? <span className="logo-name">{siteName}</span> : null}
        </Link>
        <nav className="nav" aria-label={m.header.menuLabel}>
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={menuClass}>
              {m.header[item.key]}
            </NavLink>
          ))}
        </nav>
        {/* key = คำค้น: เปลี่ยนคำค้นจากภายนอก (ย้อนกลับ กดโลโก้) ช่องกรอกเริ่มใหม่ตามนั้น; พิมพ์เฉยๆ ที่อยู่ไม่เปลี่ยนจึงไม่ถูกล้าง */}
        <SearchBox key={query} initial={query} />
        {isAdmin ? (
          <Link to="/admin" className="admin-link">
            <LayoutDashboard aria-hidden="true" size={16} />
            <span>{m.header.admin}</span>
          </Link>
        ) : null}
        <LanguageMenu />
        <ThemeMenu />
      </div>
    </header>
  )
}

export function Header() {
  const site = useSite()
  const { pathname, search } = useLocation()
  return <HeaderView siteName={shownSiteName(site)} isAdmin={site.site?.isAdmin === true} query={queryOf(pathname, search)} />
}
