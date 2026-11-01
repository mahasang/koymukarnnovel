/**
 * ปุ่มเลือกภาษาหน้าเว็บ (ไทย / English / ລາວ) บนแถบบน — หน้าตาและการใช้คีย์บอร์ดเหมือนเมนูธีม (เมนูตัวเลือกแบบ radio)
 * ชื่อภาษาเขียนด้วยภาษาของตัวเองและกำกับ `lang` เพื่อให้โปรแกรมอ่านหน้าจอออกเสียงถูก
 * `LanguageMenuView` ไม่มี state/effect · `LanguageMenu` เชื่อมกับ `useI18n` (เลือกแล้วจำไว้ในเครื่อง)
 */
import { Check, Languages } from "lucide-react"
import type { KeyboardEvent, Ref } from "react"
import { useI18n } from "../i18n/I18nProvider"
import { MESSAGES, type Messages } from "../i18n/messages"
import { LOCALES, LOCALE_NAMES, type Locale } from "../i18n/types"
import { useRadioMenu } from "../lib/useRadioMenu"

export interface LanguageMenuViewProps {
  locale: Locale
  open: boolean
  menuId: string
  onToggle: () => void
  onSelect: (locale: Locale) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  rootRef?: Ref<HTMLDivElement>
  /** ชุดข้อความ — ไม่ส่ง = ภาษาไทย */
  m?: Messages
}

export function LanguageMenuView({ locale, open, menuId, onToggle, onSelect, onKeyDown, rootRef, m = MESSAGES.th }: LanguageMenuViewProps) {
  return (
    <div className="lang-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" className="iconbtn lang-btn" aria-label={m.lang.menuLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={onToggle}>
        <Languages aria-hidden="true" size={18} />
        <span className="lang-code" aria-hidden="true">
          {locale.toUpperCase()}
        </span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={m.lang.menuLabel} className="theme-list">
          {LOCALES.map((option) => {
            const checked = option === locale
            return (
              <button key={option} type="button" role="menuitemradio" aria-checked={checked} tabIndex={checked ? 0 : -1} className={checked ? "theme-item on" : "theme-item"} onClick={() => onSelect(option)}>
                <span className="theme-check" aria-hidden="true">
                  {checked ? <Check size={16} /> : null}
                </span>
                <span lang={option}>{LOCALE_NAMES[option]}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function LanguageMenu() {
  const { locale, m, setLocale } = useI18n()
  const menu = useRadioMenu()
  const choose = (next: Locale) => {
    setLocale(next)
    menu.close()
  }
  return <LanguageMenuView locale={locale} open={menu.open} menuId={menu.menuId} onToggle={menu.onToggle} onSelect={choose} onKeyDown={menu.onKeyDown} rootRef={menu.rootRef} m={m} />
}
