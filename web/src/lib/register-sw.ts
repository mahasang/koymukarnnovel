/**
 * ลงทะเบียน service worker (`/sw.js`, นโยบายอยู่ใน public/sw.js) เฉพาะ build จริง — โหมดพัฒนาไม่ใช้ เพราะแคชของ SW จะบังโค้ดที่กำลังแก้
 * ลงทะเบียนหลังหน้าโหลดเสร็จ ไม่แย่งแบนด์วิดท์กับการวาดหน้าแรก · ล้มเหลวก็เงียบ (ผู้อ่านอ่านต่อได้ตามปกติ แค่ไม่มีโหมดออฟไลน์)
 */

/** ที่อยู่ที่เซิร์ฟเวอร์ส่ง sw.js โดยแทน `__BUILD_ID__` ให้ (server/src/http/shell.ts) */
export const SW_URL = "/sw.js"

/** ส่วนของ `window` ที่ใช้ (แยกไว้ให้เทสต์ส่งของปลอมได้) */
export interface SwHost {
  document: { readyState: string }
  navigator: { serviceWorker?: { register(url: string): Promise<unknown> } }
  addEventListener(type: "load", listener: () => void): void
}

export function registerServiceWorker(prod: boolean, host: SwHost = window): void {
  if (!prod) return
  const container = host.navigator.serviceWorker
  if (container === undefined) return
  const register = () => void container.register(SW_URL).catch(() => {})
  if (host.document.readyState === "complete") register()
  else host.addEventListener("load", register)
}
