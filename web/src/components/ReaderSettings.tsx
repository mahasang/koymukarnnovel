/**
 * แผงตั้งค่าการอ่าน (spec 6.3): ธีม 4 แบบ · ขนาดตัวอักษร 16–26 (ขั้นละ 2) · ฟอนต์ (Sarabun / Noto Serif Thai)
 * จอแคบเป็นแผ่นล่าง (bottom sheet) จอกว้างเป็นป๊อปโอเวอร์ใต้แถบบน — ต่างกันที่ CSS อย่างเดียว
 * `ReaderSettingsView` ไม่มี state/effect · `ReaderSettings` ใส่พฤติกรรมของเบราว์เซอร์: เปิดแล้วโฟกัสธีมปัจจุบัน, Escape ปิดแล้วโฟกัสกลับที่ปุ่ม Aa,
 * คลิก/แตะนอกแผง (ไม่นับปุ่ม Aa เอง — ปุ่มจัดการสลับเปิด/ปิดเอง) ปิด
 */
import { X } from "lucide-react"
import { useEffect, useRef, type Ref, type RefObject } from "react"
import { FONTS, clampFontSize, type FontId } from "../lib/reader-prefs"
import { MESSAGES, type Messages } from "../i18n/messages"
import { THEMES, type ThemeId } from "../lib/theme"

export const FONT_LABELS: Record<FontId, string> = { sarabun: "Sarabun", serif: "Noto Serif Thai" }

export interface ReaderSettingsViewProps {
  id: string
  theme: ThemeId
  fontSize: number
  font: FontId
  /** ฟังเสียงอ่านไม่ได้บนเครื่องนี้ (เบราว์เซอร์ไม่รองรับ หรือไม่มีเสียงไทย) → อธิบายว่าทำไมไม่มีปุ่มฟัง */
  voiceMissing: boolean
  onTheme: (theme: ThemeId) => void
  onFontSize: (size: number) => void
  onFont: (font: FontId) => void
  onClose: () => void
  panelRef?: Ref<HTMLElement>
  /** ชุดข้อความ — ไม่ส่ง = ภาษาไทย (ไม่ใช้ hook เพื่อให้เทสต์เรียกเป็นฟังก์ชันตรงๆ ได้; หน้าอ่านส่งให้) */
  m?: Messages
}

export function ReaderSettingsView({ id, theme, fontSize, font, voiceMissing, onTheme, onFontSize, onFont, onClose, panelRef, m = MESSAGES.th }: ReaderSettingsViewProps) {
  const t = m.settings
  const sizeId = `${id}-size`
  return (
    <>
      <div className="rs-scrim" aria-hidden="true" />
      <section id={id} className="rs" role="dialog" aria-label={t.title} ref={panelRef}>
        <div className="rs-head">
          <h2 className="rs-title">{t.title}</h2>
          <button type="button" className="iconbtn" aria-label={t.close} onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="rs-row" role="group" aria-labelledby={`${id}-theme`}>
          <span className="rs-label" id={`${id}-theme`}>
            {t.theme}
          </span>
          <div className="rs-options">
            {THEMES.map((option) => (
              <button key={option} type="button" className={option === theme ? "rs-opt rs-theme on" : "rs-opt rs-theme"} data-t={option} aria-pressed={option === theme} onClick={() => onTheme(option)}>
                <span className="rs-swatch" aria-hidden="true" />
                {m.theme.labels[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="rs-row">
          <label className="rs-label" htmlFor={sizeId}>
            {t.fontSize}
          </label>
          <div className="rs-size">
            <span className="rs-size-small" aria-hidden="true">
              {t.sizeGlyph}
            </span>
            <input
              id={sizeId}
              type="range"
              className="rs-range"
              min={16}
              max={26}
              step={2}
              value={fontSize}
              aria-valuetext={t.sizeValue(fontSize)}
              onChange={(event) => onFontSize(clampFontSize(Number(event.currentTarget.value)))}
            />
            <span className="rs-size-big" aria-hidden="true">
              {t.sizeGlyph}
            </span>
            <output className="rs-value" htmlFor={sizeId}>
              {fontSize}
            </output>
          </div>
        </div>

        <div className="rs-row" role="group" aria-labelledby={`${id}-font`}>
          <span className="rs-label" id={`${id}-font`}>
            {t.font}
          </span>
          <div className="rs-options">
            {FONTS.map((option) => (
              <button key={option} type="button" className={option === font ? "rs-opt rs-font on" : "rs-opt rs-font"} data-f={option} aria-pressed={option === font} onClick={() => onFont(option)}>
                {FONT_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        {voiceMissing ? <p className="rs-note">{t.voiceMissing}</p> : null}
      </section>
    </>
  )
}

export interface ReaderSettingsProps extends Omit<ReaderSettingsViewProps, "panelRef"> {
  open: boolean
  /** ปุ่ม Aa — คลิกที่ปุ่มนี้ไม่นับเป็น "คลิกนอกแผง" และ Escape ส่งโฟกัสกลับไปที่ปุ่มนี้ */
  toggleRef: RefObject<HTMLElement | null>
}

export function ReaderSettings({ open, toggleRef, ...view }: ReaderSettingsProps) {
  const panelRef = useRef<HTMLElement>(null)
  const { onClose } = view

  // เปิดแผง → โฟกัสธีมที่ใช้อยู่ (ผู้ใช้คีย์บอร์ดเริ่มปรับได้ทันที; ผู้ใช้เมาส์ไม่เห็นกรอบโฟกัสเพราะเบราว์เซอร์ซ่อนให้หลังคลิก)
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('.rs-theme[aria-pressed="true"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: Event) => {
      const panel = panelRef.current
      const target = event.target
      if (panel === null || !(target instanceof Node)) return
      if (panel.contains(target) || toggleRef.current?.contains(target) === true) return
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      onClose()
      toggleRef.current?.focus()
    }
    document.addEventListener("pointerdown", closeWhenOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open, onClose, toggleRef])

  return open ? <ReaderSettingsView {...view} panelRef={panelRef} /> : null
}
