/**
 * ข้อมูลเว็บ (`/api/public/site`: ชื่อ สโลแกน ข้อความเกี่ยวกับ/ติดต่อ สีเน้น และว่าผู้เปิดเป็นผู้ดูแลหรือไม่) โหลดครั้งเดียวต่อการเปิดหน้า แจกให้ทุกหน้าผ่าน `useSite()`
 * โหลดล้มเหลวไม่ทำให้เว็บใช้ไม่ได้: `site` เป็น null แล้วแต่ละส่วนใช้ค่าสำรอง (ชื่อ koymukarnnovel, ไม่ใช่ผู้ดูแล)
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { syncAccent } from "./accent"
import { publicApi, type ApiError } from "./api"
import type { SiteDto } from "./types"
import { useFetch } from "./useFetch"

export interface SiteState {
  /** ยังไม่ได้ข้อมูล (กำลังโหลด หรือโหลดไม่สำเร็จ) = null */
  site: SiteDto | null
  /** กำลังโหลดครั้งแรก */
  loading: boolean
  error: ApiError | null
}

export const SiteContext = createContext<SiteState | null>(null)

export function useSite(): SiteState {
  const state = useContext(SiteContext)
  if (state === null) throw new Error("useSite ต้องใช้ภายใน <SiteProvider>")
  return state
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data, error, loading } = useFetch("site", (signal) => publicApi.site(signal))
  const accent = data?.accent

  // ตั้ง data-accent บน <html> เฉพาะเมื่อต่างจากที่เซิร์ฟเวอร์ใส่มา (ตอนพัฒนาด้วย Vite ไม่มีเซิร์ฟเวอร์ใส่ให้)
  useEffect(() => {
    if (accent !== undefined) syncAccent(document.documentElement, accent)
  }, [accent])

  const value = useMemo<SiteState>(() => ({ site: data, loading, error }), [data, loading, error])
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}
