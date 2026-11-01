/**
 * ตัวช่วยเทสต์: เรนเดอร์คอมโพเนนต์เป็นต้นไม้ (`El`) พร้อมตัวนำทางและข้อมูลเว็บจำลอง — เรนเดอร์ฝั่งเซิร์ฟเวอร์ ไม่รัน effect
 * import เฉพาะจากไฟล์เทสต์ ไม่เป็นส่วนของหน้าเว็บ
 */
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { StaticRouter } from "react-router"
import { SiteContext, type SiteState } from "../lib/SiteContext"
import type { SiteDto } from "../lib/types"
import { parse, type El } from "./dom"

/** สถานะ "โหลดข้อมูลเว็บเสร็จแล้ว" (ปรับบางช่องได้) */
export function loadedSite(over: Partial<SiteDto> = {}): SiteState {
  return {
    site: { siteName: "koymukarnnovel", tagline: "", aboutText: "", contactText: "", accent: "default", indexable: true, isAdmin: false, ...over },
    loading: false,
    error: null,
  }
}

/** `path` = ที่อยู่ปัจจุบัน (รวม ?q=…) · `state` = ข้อมูลเว็บที่คอมโพเนนต์เห็น (ไม่ระบุ = โหลดเสร็จด้วยค่าเริ่มต้น) */
export function renderPage(node: ReactNode, options: { path?: string; state?: SiteState } = {}): El {
  const { path = "/", state = loadedSite() } = options
  return parse(
    renderToStaticMarkup(
      <StaticRouter location={path}>
        <SiteContext.Provider value={state}>{node}</SiteContext.Provider>
      </StaticRouter>,
    ),
  )
}
