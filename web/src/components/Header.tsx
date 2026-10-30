/**
 * แถบบน (ติดขอบบน พื้นเบลอ): โลโก้ + ชื่อเว็บ · เมนู · ช่องค้นหา · ลิงก์หลังบ้าน (เฉพาะผู้ดูแล) · ปุ่มธีม
 * `HeaderView` ไม่ดึงข้อมูลเอง (ทดสอบง่าย) · `Header` อ่านข้อมูลเว็บกับที่อยู่ปัจจุบันแล้วส่งให้
 */
import { LayoutDashboard } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router"
import { queryOf } from "../lib/search"
import { useSite } from "../lib/SiteContext"
import { shownSiteName } from "../lib/title"
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
  { to: "/", label: "หน้าแรก", end: true },
  { to: "/about", label: "เกี่ยวกับ", end: false },
  { to: "/contact", label: "ติดต่อ", end: false },
]

const menuClass = ({ isActive }: { isActive: boolean }) => (isActive ? "on" : undefined)

export function HeaderView({ siteName, isAdmin, query }: HeaderViewProps) {
  return (
    <header className="top">
      <div className="wrap in">
        {/* ชื่อเว็บที่เห็นเป็นชื่อของลิงก์อยู่แล้ว; ตอนยังไม่มีชื่อให้ลิงก์มีชื่อสำรอง (ไม่เป็นลิงก์ที่ไม่มีชื่อ) */}
        <Link to="/" className="logo" aria-label={siteName === null ? "หน้าแรก" : undefined}>
          <span className="mark" aria-hidden="true">
            K
          </span>
          {siteName !== null ? <span className="logo-name">{siteName}</span> : null}
        </Link>
        <nav className="nav" aria-label="เมนูหลัก">
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={menuClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {/* key = คำค้น: เปลี่ยนคำค้นจากภายนอก (ย้อนกลับ กดโลโก้) ช่องกรอกเริ่มใหม่ตามนั้น; พิมพ์เฉยๆ ที่อยู่ไม่เปลี่ยนจึงไม่ถูกล้าง */}
        <SearchBox key={query} initial={query} />
        {isAdmin ? (
          <Link to="/admin" className="admin-link">
            <LayoutDashboard aria-hidden="true" size={16} />
            <span>หลังบ้าน</span>
          </Link>
        ) : null}
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
