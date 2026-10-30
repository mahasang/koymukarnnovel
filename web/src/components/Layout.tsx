/**
 * โครงหน้าสาธารณะ: ลิงก์ข้ามไปเนื้อหา + แถบบน + เนื้อหาของหน้า (`<Outlet/>`) + ท้ายเว็บ
 * ไปหน้าใหม่ → เลื่อนขึ้นบนสุดทันทีและย้ายโฟกัสไปที่เนื้อหา (ผู้ใช้คีย์บอร์ดกด Tab ต่อจากเนื้อหาใหม่ ไม่ใช่จากลิงก์ที่หายไปแล้ว)
 * ย้อนกลับ/เดินหน้าและการเปลี่ยนแค่ `?q=` ไม่แตะ (ดู `shouldResetScroll`)
 */
import { useEffect, useRef } from "react"
import { Outlet, useLocation, useNavigationType } from "react-router"
import { shouldResetScroll } from "../lib/scroll"
import { Footer } from "./Footer"
import { Header } from "./Header"

export function Layout() {
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const previousPath = useRef(pathname)

  useEffect(() => {
    const from = previousPath.current
    previousPath.current = pathname
    if (!shouldResetScroll(from, pathname, navigationType)) return
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }) // "instant" ชนะ scroll-behavior: smooth ใน CSS
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname, navigationType])

  return (
    <>
      <a className="skip-link" href="#main">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <Header />
      <main id="main" className="wrap main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
