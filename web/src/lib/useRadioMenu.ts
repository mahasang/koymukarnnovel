/**
 * พฤติกรรมเมนูตัวเลือกแบบ radio ที่ใช้ร่วมกัน (เมนูธีม / เมนูภาษา): เปิดแล้วโฟกัสรายการปัจจุบัน, ลูกศร/Home/End ย้ายโฟกัส,
 * Escape ปิดแล้วโฟกัสกลับที่ปุ่ม, คลิกหรือโฟกัสนอกเมนูปิด — ตัวแสดงผลของแต่ละเมนูเป็นคอมโพเนนต์ล้วนที่รับค่าจากที่นี่
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { menuKeyAction } from "./keynav"

const CHECKED_ITEM = '[role="menuitemradio"][aria-checked="true"]'
const ALL_ITEMS = '[role="menuitemradio"]'
const TOGGLE_BUTTON = "button[aria-haspopup]"

export function useRadioMenu() {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // เปิดเมนู → โฟกัสรายการที่ใช้อยู่ (ผู้ใช้คีย์บอร์ดเริ่มเลือกได้ทันที; ผู้ใช้เมาส์ไม่เห็นกรอบโฟกัสเพราะเบราว์เซอร์ซ่อนให้หลังคลิก)
  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>(CHECKED_ITEM)?.focus()
  }, [open])

  // เมนูเปิดอยู่: คลิก/แตะ หรือโฟกัสไปที่อื่นนอกเมนู (เช่น กด Tab ออก) → ปิด
  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: Event) => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) setOpen(false)
    }
    document.addEventListener("pointerdown", closeWhenOutside)
    document.addEventListener("focusin", closeWhenOutside)
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside)
      document.removeEventListener("focusin", closeWhenOutside)
    }
  }, [open])

  const focusToggle = () => rootRef.current?.querySelector<HTMLElement>(TOGGLE_BUTTON)?.focus()

  /** เลือกรายการแล้ว: ปิดเมนูและคืนโฟกัสให้ปุ่ม */
  const close = () => {
    setOpen(false)
    focusToggle()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const items = open ? Array.from(rootRef.current?.querySelectorAll<HTMLElement>(ALL_ITEMS) ?? []) : []
    const action = menuKeyAction(open, event.key, items.indexOf(document.activeElement as HTMLElement), items.length)
    if (action === null) return
    event.preventDefault()
    if (action.type === "open") {
      setOpen(true)
    } else if (action.type === "close") {
      close()
    } else {
      items[action.index]?.focus()
    }
  }

  return { open, menuId, rootRef, onKeyDown, onToggle: () => setOpen((value) => !value), close }
}
