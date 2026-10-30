/**
 * ตอนเปลี่ยนหน้าในเว็บ (ไม่โหลดหน้าใหม่) เบราว์เซอร์ไม่เลื่อนขึ้นบนสุดให้เอง — ผู้อ่านกดไปหน้าใหม่แล้วค้างอยู่กลางหน้า
 * แต่ตอนย้อนกลับ/เดินหน้า (POP) ต้องปล่อยให้เบราว์เซอร์คืนตำแหน่งที่ผู้อ่านเลื่อนค้างไว้เอง ไม่ดึงขึ้นบนสุด
 * ยังอยู่หน้าเดิม (เปลี่ยนแค่ `?q=` หรือ `#`) ก็ไม่เลื่อน — ผู้อ่านพิมพ์ค้นหาไปเรื่อยๆ ไม่ควรโดนดีดขึ้นบนสุดทุกครั้ง
 * `navigationType` เป็นข้อความ ("PUSH" | "REPLACE" | "POP") ตามที่ react-router ให้มา
 */
export function shouldResetScroll(fromPath: string, toPath: string, navigationType: string): boolean {
  return navigationType !== "POP" && fromPath !== toPath
}
