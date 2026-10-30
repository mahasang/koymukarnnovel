/**
 * ปุ่มเลือกธีม (มืด / กระดาษ / ซีเปีย / ดำสนิท) บนแถบบน — ปุ่มเปิดเมนูตัวเลือกแบบ radio
 * `ThemeMenuView` ไม่มี state/effect (ทดสอบโครงสร้างและการผูก handler ได้) · `ThemeMenu` ใส่พฤติกรรมของเบราว์เซอร์:
 * เปิดแล้วโฟกัสธีมปัจจุบัน, ลูกศร/Home/End ย้ายโฟกัส, Escape ปิดแล้วโฟกัสกลับที่ปุ่ม, คลิกหรือโฟกัสนอกเมนูปิด
 */
import { Check, Palette } from "lucide-react"
import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react"
import { menuKeyAction } from "../lib/keynav"
import { THEMES, THEME_LABELS, getTheme, setTheme, type ThemeId } from "../lib/theme"

export interface ThemeMenuViewProps {
  current: ThemeId
  open: boolean
  /** id ของเมนู — ปุ่มผูก `aria-controls` กับ id นี้ตอนเมนูเปิด */
  menuId: string
  onToggle: () => void
  onSelect: (theme: ThemeId) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  /** กรอบนอก — ผู้เรียกใช้หาปุ่ม/รายการเมนูเพื่อย้ายโฟกัส และเช็กว่าคลิกอยู่นอกเมนูหรือไม่ */
  rootRef?: Ref<HTMLDivElement>
}

export function ThemeMenuView({ current, open, menuId, onToggle, onSelect, onKeyDown, rootRef }: ThemeMenuViewProps) {
  return (
    <div className="theme-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" className="iconbtn" aria-label="เปลี่ยนธีม" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={onToggle}>
        <Palette aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="ธีม" className="theme-list">
          {THEMES.map((theme) => {
            const checked = theme === current
            return (
              // รายการที่ติ๊กอยู่รับ Tab (roving tabindex) ที่เหลือเลือกด้วยลูกศร
              <button key={theme} type="button" role="menuitemradio" aria-checked={checked} tabIndex={checked ? 0 : -1} className={checked ? "theme-item on" : "theme-item"} onClick={() => onSelect(theme)}>
                <span className="theme-check" aria-hidden="true">
                  {checked ? <Check size={16} /> : null}
                </span>
                <span>{THEME_LABELS[theme]}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

const CHECKED_ITEM = '[role="menuitemradio"][aria-checked="true"]'
const ALL_ITEMS = '[role="menuitemradio"]'
const TOGGLE_BUTTON = "button[aria-haspopup]"

export function ThemeMenu() {
  const [current, setCurrent] = useState<ThemeId>(getTheme)
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  // เปิดเมนู → โฟกัสธีมที่ใช้อยู่ (ผู้ใช้คีย์บอร์ดเริ่มเลือกได้ทันที; ผู้ใช้เมาส์ไม่เห็นกรอบโฟกัสเพราะเบราว์เซอร์ซ่อนให้หลังคลิก)
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

  const choose = (theme: ThemeId) => {
    setTheme(theme)
    setCurrent(theme)
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
      setOpen(false)
      focusToggle()
    } else {
      items[action.index]?.focus()
    }
  }

  return <ThemeMenuView current={current} open={open} menuId={menuId} onToggle={() => setOpen((value) => !value)} onSelect={choose} onKeyDown={onKeyDown} rootRef={rootRef} />
}
