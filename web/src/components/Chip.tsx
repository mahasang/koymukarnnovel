import type { ReactNode } from "react"

/** ชิปกรอง (สถานะ/แท็ก) เป็นปุ่มสลับเปิด-ปิด: `aria-pressed` บอกโปรแกรมอ่านหน้าจอว่าเลือกอยู่หรือไม่ */
export function Chip({ selected = false, onClick, children }: { selected?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={selected ? "fchip on" : "fchip"} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  )
}
