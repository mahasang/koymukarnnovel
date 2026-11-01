/**
 * ชื่อแท็บของแต่ละหน้า — รูปแบบเดียวกับที่เซิร์ฟเวอร์ใส่ให้ใน `<title>` ตอนส่งหน้า (`server/src/http/shell.ts`)
 * เพื่อให้ชื่อแท็บไม่เปลี่ยนไปมาตอนเปิดหน้าครั้งแรก: "ชื่อหน้า | ชื่อเว็บ" ส่วนหน้าแรก (ไม่มีชื่อหน้า) เป็น "ชื่อเว็บ — สโลแกน"
 */

/** ชื่อเว็บสำรองเมื่อยังโหลดข้อมูลเว็บไม่ได้หรือเจ้าของยังไม่ตั้งชื่อ */
export const FALLBACK_SITE_NAME = "koymukarnnovel"

export function formatTitle(page: string | null | undefined, site: { siteName: string; tagline: string } | null): string {
  const siteName = site?.siteName.trim() || FALLBACK_SITE_NAME
  const pageTitle = page?.trim() ?? ""
  if (pageTitle !== "") return `${pageTitle} | ${siteName}`
  const tagline = site?.tagline.trim() ?? ""
  return tagline === "" ? siteName : `${siteName} — ${tagline}`
}

/** สถานะข้อมูลเว็บแบบเดียวกับ `useSite()`: `site` เป็น null ได้ทั้งตอนกำลังโหลดครั้งแรกและตอนโหลดไม่สำเร็จ */
export interface SiteStatus {
  site: { siteName: string; tagline: string } | null
  loading: boolean
}

/**
 * ชื่อเว็บที่เขียนในหัว/ท้ายหน้า · กำลังโหลดครั้งแรก → null (ไม่เขียนอะไร ดีกว่าโชว์ชื่อสำรองแล้วเปลี่ยนเป็นชื่อจริงจนเห็นเป็นภาพวาบ)
 * โหลดไม่สำเร็จ → ชื่อสำรอง (เว็บยังใช้ได้ ไม่เว้นช่องว่างถาวร)
 */
export function shownSiteName({ site, loading }: SiteStatus): string | null {
  if (site !== null) return site.siteName.trim() || FALLBACK_SITE_NAME
  return loading ? null : FALLBACK_SITE_NAME
}

/**
 * ชื่อแท็บของหน้า — `null` = ยังไม่ควรเปลี่ยนชื่อแท็บ (คงชื่อเดิมที่เซิร์ฟเวอร์ใส่มาไว้ ไม่เปลี่ยนไปมาตอนโหลด)
 * · `page` เป็น undefined = หน้ายังไม่พร้อม (เช่น กำลังโหลดชื่อเรื่อง) · `page` เป็น null = ไม่มีชื่อหน้า (หน้าแรก: "ชื่อเว็บ — สโลแกน")
 * · ข้อมูลเว็บกำลังโหลดครั้งแรก (ยังไม่รู้ชื่อเว็บ) ก็ยังไม่เปลี่ยน
 */
export function titleFor(page: string | null | undefined, { site, loading }: SiteStatus): string | null {
  if (page === undefined) return null
  if (site === null && loading) return null
  return formatTitle(page, site)
}
