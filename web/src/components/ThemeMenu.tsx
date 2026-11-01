/**
 * ปุ่มเลือกธีม (มืด / กระดาษ / ซีเปีย / ดำสนิท) บนแถบบน — ปุ่มเปิดเมนูตัวเลือกแบบ radio
 * `ThemeMenuView` ไม่มี state/effect (ทดสอบโครงสร้างและการผูก handler ได้) · `ThemeMenu` ใส่พฤติกรรมของเบราว์เซอร์ผ่าน `useRadioMenu`
 */
import { Check, Palette } from "lucide-react"
import { useState, type KeyboardEvent, type Ref } from "react"
import { useI18n } from "../i18n/I18nProvider"
import { MESSAGES, type Messages } from "../i18n/messages"
import { THEMES, getTheme, setTheme, type ThemeId } from "../lib/theme"
import { useRadioMenu } from "../lib/useRadioMenu"

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
  /** ชุดข้อความ — ไม่ส่ง = ภาษาไทย (ไม่ใช้ hook เพื่อให้เทสต์เรียกเป็นฟังก์ชันตรงๆ ได้) */
  m?: Messages
}

export function ThemeMenuView({ current, open, menuId, onToggle, onSelect, onKeyDown, rootRef, m = MESSAGES.th }: ThemeMenuViewProps) {
  return (
    <div className="theme-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" className="iconbtn" aria-label={m.theme.change} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={onToggle}>
        <Palette aria-hidden="true" size={18} />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={m.theme.menu} className="theme-list">
          {THEMES.map((theme) => {
            const checked = theme === current
            return (
              // รายการที่ติ๊กอยู่รับ Tab (roving tabindex) ที่เหลือเลือกด้วยลูกศร
              <button key={theme} type="button" role="menuitemradio" aria-checked={checked} tabIndex={checked ? 0 : -1} className={checked ? "theme-item on" : "theme-item"} onClick={() => onSelect(theme)}>
                <span className="theme-check" aria-hidden="true">
                  {checked ? <Check size={16} /> : null}
                </span>
                <span>{m.theme.labels[theme]}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ThemeMenu() {
  const { m } = useI18n()
  const [current, setCurrent] = useState<ThemeId>(getTheme)
  const menu = useRadioMenu()

  const choose = (theme: ThemeId) => {
    setTheme(theme)
    setCurrent(theme)
    menu.close()
  }

  return <ThemeMenuView current={current} open={menu.open} menuId={menu.menuId} onToggle={menu.onToggle} onSelect={choose} onKeyDown={menu.onKeyDown} rootRef={menu.rootRef} m={m} />
}
