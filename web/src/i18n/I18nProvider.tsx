/**
 * ภาษาของ UI หน้าบ้าน: `useI18n()` ให้ `{ locale, m, setLocale }` — `m` คือชุดข้อความของภาษานั้น (`m.header.search` ฯลฯ)
 * นอก provider (เทสต์คอมโพเนนต์เดิม) ได้ภาษาไทยและ `setLocale` ที่ไม่ทำอะไร
 * `fixedLocale` ตรึงภาษา (หลังบ้านเป็นไทยเสมอ): เลือกภาษาไม่ได้ ไม่เก็บ ไม่แตะ <html>
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { applyLocale, loadLocale, saveLocale } from "./apply"
import { MESSAGES, type Messages } from "./messages"
import { DEFAULT_LOCALE, type Locale } from "./types"

export interface I18nValue {
  locale: Locale
  m: Messages
  setLocale: (locale: Locale) => void
}

const FALLBACK: I18nValue = { locale: DEFAULT_LOCALE, m: MESSAGES[DEFAULT_LOCALE], setLocale: () => {} }
const I18nContext = createContext<I18nValue | null>(null)

export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? FALLBACK
}

export function I18nProvider({ children, fixedLocale }: { children: ReactNode; fixedLocale?: Locale }) {
  // ฝั่งเซิร์ฟเวอร์/เทสต์ที่ไม่มี document ใช้ไทย (ไม่ใช้ navigator ของ Node ที่ตอบ en-US)
  const [chosen, setChosen] = useState<Locale>(() => (typeof document === "undefined" ? DEFAULT_LOCALE : loadLocale()))
  const locale = fixedLocale ?? chosen

  useEffect(() => {
    if (fixedLocale === undefined) applyLocale(document, chosen)
  }, [chosen, fixedLocale])

  const setLocale = useCallback(
    (next: Locale) => {
      if (fixedLocale !== undefined) return
      setChosen(next)
      saveLocale(next)
    },
    [fixedLocale],
  )

  const value = useMemo<I18nValue>(() => ({ locale, m: MESSAGES[locale], setLocale }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
