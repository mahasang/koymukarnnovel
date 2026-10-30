/** วนโฟกัสในกล่องโต้ตอบ (focus trap): ส่วนตัดสินใจล้วน ไม่แตะ DOM เพื่อทดสอบได้ */

/** element ที่โฟกัสด้วยแป้น Tab ได้ (ผู้ใช้เรียกใช้ต้องกรองตัวที่มองไม่เห็นออกเอง) */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * กด Tab ในกล่อง: โฟกัสต้องย้ายไปไหน
 * `count` = จำนวน element ที่โฟกัสได้ในกล่อง · `active` = ตำแหน่งตัวที่โฟกัสอยู่ (-1 = ไม่ใช่ตัวในรายการ เช่น ตัวกล่องเอง)
 * คืน null = ปล่อยให้เบราว์เซอร์เลื่อนตามปกติ (ยังอยู่ในกล่องแน่นอน) · "dialog" = ไม่มีอะไรให้โฟกัส ค้างที่ตัวกล่อง
 */
export function trapTarget(count: number, active: number, shift: boolean): number | "dialog" | null {
  if (count === 0) return "dialog"
  if (active === -1) return shift ? count - 1 : 0
  if (shift && active === 0) return count - 1
  if (!shift && active === count - 1) return 0
  return null
}

export type DialogKeyAction = { type: "cancel" } | { type: "focus"; target: number | "dialog" } | null

/** แป้นที่กล่องโต้ตอบสนใจ: Esc = ยกเลิก (ยกเว้นกำลังทำงาน), Tab = วนในกล่อง */
export function dialogKeyAction(key: string, shift: boolean, o: { busy: boolean; count: number; active: number }): DialogKeyAction {
  if (key === "Escape") return o.busy ? null : { type: "cancel" }
  if (key === "Tab") {
    const target = trapTarget(o.count, o.active, shift)
    return target === null ? null : { type: "focus", target }
  }
  return null
}

/** element ที่ Tab โฟกัสได้ใน `root` ตามลำดับเอกสาร (ตัวที่ไม่ได้แสดงอยู่ เช่น display:none ไม่นับ) — ต้องมี DOM จริง ตรวจในเบราว์เซอร์ */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}
