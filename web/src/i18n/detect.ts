import { DEFAULT_LOCALE, LOCALES, type Locale } from "./types"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** รหัสภาษาเบราว์เซอร์ → ภาษาที่รองรับ: `th`, `th-TH`, `lo_LA` ได้ แต่ `thx`/`english` ไม่ใช่ (ไม่สนตัวพิมพ์) */
function localeOf(tag: string): Locale | null {
  const primary = tag.split(/[-_]/, 1)[0]?.toLowerCase()
  return isLocale(primary) ? primary : null
}

/** ตัวแรกในรายการภาษาของเบราว์เซอร์ (เรียงตามความชอบของผู้ใช้) ที่เป็นภาษาที่รองรับ · ไม่มี → null */
export function detectLocale(languages: readonly string[] | undefined): Locale | null {
  for (const tag of languages ?? []) {
    const found = typeof tag === "string" ? localeOf(tag) : null
    if (found !== null) return found
  }
  return null
}

/** ค่าที่ผู้อ่านเลือกไว้ (ถ้าใช้ได้) → ภาษาเบราว์เซอร์ → ไทย; `saved` มาจากที่เก็บในเครื่อง จึงไม่ไว้ใจรูปร่าง */
export function initialLocale(saved: unknown, languages: readonly string[] | undefined): Locale {
  return isLocale(saved) ? saved : (detectLocale(languages) ?? DEFAULT_LOCALE)
}
