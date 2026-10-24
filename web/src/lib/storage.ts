/**
 * ที่เก็บข้อมูลในเครื่องผู้อ่าน (localStorage) แบบที่ล้มแล้วไม่พังหน้าเว็บ
 * บางเบราว์เซอร์ปิดการเก็บข้อมูล (แค่เข้าถึง `localStorage` ก็โยน) หรือโควตาเต็ม — ทุกฟังก์ชันจึงห่อ try/catch:
 * อ่านไม่ได้ = ใช้ค่า fallback, เขียนไม่ได้ = คืน false (หน้าเว็บทำงานต่อได้ แค่จำค่าไว้ไม่ได้)
 */

/** ทุกคีย์ที่แอปใช้ (ธีมเก็บเป็นชื่อดิบ ไม่ใช่ JSON เพราะ `public/theme-init.js` อ่านตรงๆ ก่อนวาดหน้า) */
export const KEYS = {
  theme: "koymukarnnovel.theme",
  reader: "koymukarnnovel.reader",
  progress: "koymukarnnovel.progress",
  history: "koymukarnnovel.history",
} as const

/**
 * อ่านค่า JSON ที่เก็บไว้ใต้คีย์ — ไม่มี/อ่านไม่ได้/JSON เสีย → `fallback`
 * ไม่ตรวจรูปร่างข้อมูล (เครื่องผู้อ่านอาจมีของเสีย/ของแอปรุ่นเก่า): ผู้เรียกควรรับเป็น `unknown` แล้วตรวจเองก่อนใช้
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key)
    return text === null ? fallback : (JSON.parse(text) as T)
  } catch {
    return fallback
  }
}

/** เก็บค่าเป็น JSON ใต้คีย์ — สำเร็จคืน true; เก็บไม่ได้ (ปิดการเก็บ โควตาเต็ม ค่าแปลงเป็น JSON ไม่ได้) คืน false โดยไม่แตะของเดิม */
export function writeJson(key: string, value: unknown): boolean {
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return false
    localStorage.setItem(key, text)
    return true
  } catch {
    return false
  }
}
