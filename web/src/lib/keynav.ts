/**
 * ปุ่มลูกศรในเมนู (รายการเรียงต่อกัน): ลง/ขึ้นวนรอบ, Home/End ไปหัว/ท้าย
 * คืนดัชนีรายการที่ควรโฟกัสต่อ หรือ `null` เมื่อไม่ใช่ปุ่มที่เมนูจัดการ (ผู้เรียกปล่อยให้เบราว์เซอร์ทำงานต่อ)
 * `current` นอกช่วง (เช่น -1 = ยังไม่ได้โฟกัสรายการใด) นับเหมือนยังไม่ได้โฟกัส: ลง → รายการแรก, ขึ้น → รายการสุดท้าย
 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (!(count > 0)) return null
  const focused = Number.isInteger(current) && current >= 0 && current < count ? current : -1
  switch (key) {
    case "ArrowDown":
      return (focused + 1) % count
    case "ArrowUp":
      return focused === -1 ? count - 1 : (focused - 1 + count) % count
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}

export type MenuKeyAction = { type: "open" } | { type: "close" } | { type: "focus"; index: number }

/**
 * ปุ่มบนเมนูที่เปิด/ปิดได้ แยกตามสถานะ: ปิดอยู่ → ลูกศรลง/ขึ้นเปิดเมนู · เปิดอยู่ → Escape ปิด, ลูกศร/Home/End ย้ายโฟกัส (ดู `nextMenuIndex`)
 * ปุ่มอื่น (Tab, Enter, Space ฯลฯ) → `null` ผู้เรียกปล่อยให้เบราว์เซอร์ทำงานต่อ (Tab พาโฟกัสออก, Enter/Space กดรายการที่โฟกัสอยู่)
 * `current` = ดัชนีรายการที่โฟกัสอยู่ (-1 = ไม่ได้อยู่ที่รายการใด) · `count` = จำนวนรายการ (ปิดอยู่ไม่ใช้)
 */
export function menuKeyAction(open: boolean, key: string, current: number, count: number): MenuKeyAction | null {
  if (!open) return key === "ArrowDown" || key === "ArrowUp" ? { type: "open" } : null
  if (key === "Escape") return { type: "close" }
  const index = nextMenuIndex(key, current, count)
  return index === null ? null : { type: "focus", index }
}
