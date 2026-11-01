import type { ReactNode } from "react"

/** ชิปกรอง (สถานะ/แท็ก) เป็นปุ่มสลับเปิด-ปิด: `aria-pressed` บอกโปรแกรมอ่านหน้าจอว่าเลือกอยู่หรือไม่ */
/** `lang` = ภาษาของข้อความบนชิป เมื่อต่างจากภาษาของหน้า (เช่น แท็กนิยายที่เป็นภาษาไทยในหน้าภาษาลาว) */
export function Chip({ selected = false, onClick, lang, children }: { selected?: boolean; onClick?: () => void; lang?: string; children: ReactNode }) {
  return (
    <button type="button" className={selected ? "fchip on" : "fchip"} aria-pressed={selected} lang={lang} onClick={onClick}>
      {children}
    </button>
  )
}
