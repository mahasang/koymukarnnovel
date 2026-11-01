/**
 * โครงหลังบ้าน: จอกว้าง (≥ 900px) เมนูข้าง 248px · จอแคบเป็นแถบบน + ลิ้นชัก · เหนือเนื้อหามีแถบเตือนเมื่อคิวแปลหยุด
 * `AdminLayoutView` / `PausedBanner` เป็นส่วนแสดงผลล้วน (ไม่มี hook) · `AdminLayout` ถือสถานะ (ลิ้นชัก, ทำต่อ, ออกจากระบบ) และต่อกับคิวสด
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { BookOpen, CirclePause, Globe, LayoutDashboard, LogOut, Menu, Plus, SlidersHorizontal, X } from "lucide-react"
import { NavLink, useLocation, useNavigationType } from "react-router"
import { ApiError } from "../lib/api"
import { shouldResetScroll } from "../lib/scroll"
import { useSite } from "../lib/SiteContext"
import { AdminBrand } from "./AdminBrand"
import { admin } from "./adminApi"
import { queueSummary } from "./format"
import { useQueue } from "./QueueContext"
import type { QueueState } from "./types"

const SIDE_ID = "ad-side"
const MAIN_ID = "ad-main"
const ICON = 19

const itemClass = ({ isActive }: { isActive: boolean }) => (isActive ? "ad-it on" : "ad-it")

export interface PausedBannerProps {
  reason: string
  busy: boolean
  error: string | null
  onResume(): void
}

/** แถบเตือนเมื่อคิวหยุด: บอกสาเหตุ + ปุ่มทำต่อ */
export function PausedBanner({ reason, busy, error, onResume }: PausedBannerProps) {
  return (
    <div className="ad-banner" role="status">
      <CirclePause size={ICON} aria-hidden="true" />
      <p className="ad-banner-text">
        <strong>คิวแปลหยุดอยู่</strong>
        <span>{reason.trim() === "" ? "หยุดไว้ชั่วคราว" : reason}</span>
      </p>
      <button type="button" className="btn primary sm" disabled={busy} onClick={onResume}>
        {busy ? "กำลังทำต่อ…" : "ทำต่อ"}
      </button>
      {error !== null && (
        <p className="ad-banner-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export interface AdminLayoutViewProps {
  siteName: string
  /** ไม่ได้ตั้งรหัสผ่านที่เซิร์ฟเวอร์: ไม่มีเซสชันให้ออก จึงไม่มีปุ่มออกจากระบบ */
  passwordless: boolean
  queue: QueueState | null
  offline: boolean
  menuOpen: boolean
  loggingOut: boolean
  logoutError: string | null
  resume: { busy: boolean; error: string | null; onResume(): void }
  onToggleMenu(): void
  onCloseMenu(): void
  onLogout(): void
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void
  mainRef?: Ref<HTMLElement>
  menuButtonRef?: Ref<HTMLButtonElement>
  sideRef?: Ref<HTMLElement>
  children: ReactNode
}

export function AdminLayoutView(p: AdminLayoutViewProps) {
  return (
    <div className={p.menuOpen ? "ad-shell menu-open" : "ad-shell"} onKeyDown={p.onKeyDown}>
      <a className="skip-link" href={`#${MAIN_ID}`}>
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="ad-topbar">
        <button
          type="button"
          className="ad-menu-btn"
          aria-label={p.menuOpen ? "ปิดเมนู" : "เมนู"}
          aria-expanded={p.menuOpen}
          aria-controls={SIDE_ID}
          onClick={p.onToggleMenu}
          ref={p.menuButtonRef}
        >
          {p.menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <AdminBrand name={p.siteName} to="/admin" />
      </header>
      {p.menuOpen && <div className="ad-drawer-scrim" onClick={p.onCloseMenu} aria-hidden="true" />}
      <aside id={SIDE_ID} className="ad-side" ref={p.sideRef}>
        <AdminBrand name={p.siteName} to="/admin" />
        <div className="ad-side-label">จัดการ</div>
        <nav className="ad-nav" aria-label="เมนูหลังบ้าน">
          <NavLink to="/admin" end className={itemClass}>
            <LayoutDashboard size={ICON} aria-hidden="true" />
            <span>แดชบอร์ด</span>
          </NavLink>
          <NavLink to="/admin/novels" className={itemClass}>
            <BookOpen size={ICON} aria-hidden="true" />
            <span>นิยาย</span>
          </NavLink>
          <NavLink to="/admin/add" className="btn primary ad-add">
            <Plus size={ICON} aria-hidden="true" />
            <span>เพิ่มตอน</span>
          </NavLink>
          <NavLink to="/admin/settings" className={itemClass}>
            <SlidersHorizontal size={ICON} aria-hidden="true" />
            <span>ตั้งค่า</span>
          </NavLink>
        </nav>
        <div className="ad-grow" />
        <p className="ad-queue" role="status">
          {queueSummary(p.queue, p.offline)}
        </p>
        <a className="ad-it" href="/" target="_blank" rel="noopener">
          <Globe size={ICON} aria-hidden="true" />
          <span>ดูหน้าเว็บ ↗</span>
        </a>
        {!p.passwordless && (
          <>
            <button type="button" className="ad-it" disabled={p.loggingOut} onClick={p.onLogout}>
              <LogOut size={ICON} aria-hidden="true" />
              <span>ออกจากระบบ</span>
            </button>
            {p.logoutError !== null && (
              <p className="ad-side-error" role="alert">
                {p.logoutError}
              </p>
            )}
          </>
        )}
      </aside>
      <main id={MAIN_ID} className="ad-main" tabIndex={-1} ref={p.mainRef} inert={p.menuOpen}>
        {p.queue?.paused === true && <PausedBanner reason={p.queue.pausedReason} busy={p.resume.busy} error={p.resume.error} onResume={p.resume.onResume} />}
        {p.children}
      </main>
    </div>
  )
}

export interface AdminLayoutProps {
  passwordless: boolean
  /** ออกจากระบบสำเร็จแล้ว (ผู้ใช้พากลับหน้าล็อกอิน) */
  onLoggedOut(): void
  children: ReactNode
}

export function AdminLayout({ passwordless, onLoggedOut, children }: AdminLayoutProps) {
  const { site } = useSite()
  const { state, offline, reload } = useQueue()
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const previousPath = useRef(pathname)
  const mainRef = useRef<HTMLElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  // ไปหน้าใหม่: ปิดลิ้นชัก เลื่อนขึ้นบนสุดทันที ย้ายโฟกัสไปเนื้อหา (เหมือนหน้าบ้าน: เปลี่ยนแค่ ?tab= ไม่เลื่อน)
  useEffect(() => {
    const from = previousPath.current
    previousPath.current = pathname
    setMenuOpen(false)
    if (!shouldResetScroll(from, pathname, navigationType)) return
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }) // "instant" ชนะ scroll-behavior: smooth ใน CSS
    const main = mainRef.current
    if (main === null) return
    // เลือกลิงก์จากลิ้นชัก: ตอนนี้เนื้อหายังเป็น inert (setMenuOpen ข้างบนยังไม่เรนเดอร์) โฟกัสไม่ติด → โฟกัสหลุดไป body
    // ปลด inert ก่อนโฟกัส (เรนเดอร์ถัดไปตั้งค่าเดียวกันนี้อยู่แล้ว จึงไม่ขัดกัน)
    main.inert = false
    main.focus({ preventScroll: true })
  }, [pathname, navigationType])

  // จอกว้างขึ้นถึงโหมดเมนูข้าง (หมุนจอ/ขยายหน้าต่าง) → ลิ้นชักไม่มีความหมายแล้ว ปิดเสีย
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)")
    const onChange = () => {
      if (wide.matches) setMenuOpen(false)
    }
    wide.addEventListener("change", onChange)
    return () => wide.removeEventListener("change", onChange)
  }, [])

  // เปิดลิ้นชัก → โฟกัสไปรายการแรกของเมนู
  useEffect(() => {
    if (menuOpen) sideRef.current?.querySelector<HTMLElement>("nav a")?.focus()
  }, [menuOpen])

  function closeMenu(): void {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape" || !menuOpen) return
    event.preventDefault()
    closeMenu()
  }

  async function resume(): Promise<void> {
    if (resuming) return
    setResuming(true)
    setResumeError(null)
    try {
      await admin.resume()
      reload()
    } catch (e) {
      setResumeError(e instanceof ApiError ? e.message : "ทำต่อไม่สำเร็จ ลองอีกครั้ง")
    } finally {
      setResuming(false)
    }
  }

  async function logout(): Promise<void> {
    if (loggingOut) return
    setLoggingOut(true)
    setLogoutError(null)
    try {
      await admin.logout()
      onLoggedOut()
    } catch {
      setLogoutError("ออกจากระบบไม่สำเร็จ ลองอีกครั้ง")
      setLoggingOut(false)
    }
  }

  return (
    <AdminLayoutView
      siteName={site?.siteName ?? "koymukarnnovel"}
      passwordless={passwordless}
      queue={state}
      offline={offline}
      menuOpen={menuOpen}
      loggingOut={loggingOut}
      logoutError={logoutError}
      resume={{ busy: resuming, error: resumeError, onResume: () => void resume() }}
      onToggleMenu={() => setMenuOpen((open) => !open)}
      onCloseMenu={closeMenu}
      onLogout={() => void logout()}
      onKeyDown={onKeyDown}
      mainRef={mainRef}
      menuButtonRef={menuButtonRef}
      sideRef={sideRef}
    >
      {children}
    </AdminLayoutView>
  )
}
