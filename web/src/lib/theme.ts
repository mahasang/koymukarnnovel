/**
 * ธีมของหน้าเว็บ (ค่าสีอยู่ใน styles/tokens.css เลือกด้วย `<html data-theme>`)
 * ธีมที่เลือกเก็บในเครื่องผู้อ่านเป็นชื่อดิบๆ (ไม่ใช่ JSON) ที่ `koymukarnnovel.theme` — `public/theme-init.js` อ่านค่านี้ตรงๆ ก่อนวาดหน้า
 * ทุกการเข้าถึง `document`/`localStorage` ห่อ try/catch: บางเบราว์เซอร์ปิดการเก็บข้อมูลแล้วแค่เข้าถึง `localStorage` ก็โยน
 */

export const THEMES = ["midnight", "paper", "sepia", "black"] as const
export type ThemeId = (typeof THEMES)[number]

const DEFAULT_THEME: ThemeId = "midnight"
const STORAGE_KEY = "koymukarnnovel.theme"
const ATTRIBUTE = "data-theme"

const isTheme = (value: unknown): value is ThemeId => THEMES.some((theme) => theme === value)

function fromDocument(): ThemeId | null {
  try {
    const value = document.documentElement.getAttribute(ATTRIBUTE) // ไม่มี document (นอกเบราว์เซอร์) → ReferenceError ถูกจับด้านล่าง
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

function fromStorage(): ThemeId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

/**
 * ธีมที่ใช้อยู่ตอนนี้: ดูจาก `data-theme` ที่หน้าแสดงอยู่จริงก่อน (เป็นความจริงเสมอ แม้เก็บลงเครื่องไม่ได้)
 * ไม่มีก็ใช้ค่าที่เก็บไว้ ไม่มีอีกก็ Midnight
 */
export function getTheme(): ThemeId {
  return fromDocument() ?? fromStorage() ?? DEFAULT_THEME
}

/** เปลี่ยนธีมที่แสดงทันทีและจำไว้ในเครื่อง (เก็บไม่ได้ก็ยังเปลี่ยนได้) ชื่อธีมที่ไม่ถูกต้องถูกเมิน */
export function setTheme(theme: ThemeId): void {
  if (!isTheme(theme)) return
  try {
    document.documentElement.setAttribute(ATTRIBUTE, theme)
  } catch {
    // ไม่มี document (นอกเบราว์เซอร์) หรือแก้ไม่ได้ — ยังไปจำธีมไว้ในเครื่องต่อ
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // เก็บลงเครื่องไม่ได้ ธีมที่เปลี่ยนแล้วใช้ได้จนปิดหน้านี้
  }
}
