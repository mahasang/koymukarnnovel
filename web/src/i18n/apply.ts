/** ส่วนที่แตะ DOM/ที่เก็บในเครื่อง แยกออกจาก React เพื่อทดสอบได้ตรงๆ — ทุกฟังก์ชันไม่โยน */
import { KEYS, readJson, writeJson } from "../lib/storage"
import { initialLocale } from "./detect"
import type { Locale } from "./types"

const browserLanguages = (): readonly string[] | undefined => (typeof navigator === "undefined" ? undefined : navigator.languages)

/** ตั้ง `lang` ของ <html> ให้ตรงกับภาษา UI (shell จากเซิร์ฟเวอร์เป็น `lang="th"` เสมอ) */
export function applyLocale(doc: { documentElement: { lang: string } }, locale: Locale): void {
  doc.documentElement.lang = locale
}

/** ภาษาเริ่มต้น: ที่ผู้อ่านเลือกไว้ → ภาษาเบราว์เซอร์ → ไทย (ใช้ไม่ได้/อ่านไม่ได้ = ข้ามไปขั้นถัดไป) */
export function loadLocale(languages: readonly string[] | undefined = browserLanguages()): Locale {
  return initialLocale(readJson<unknown>(KEYS.lang, null), languages)
}

/** จำภาษาที่ผู้อ่านเลือก (เก็บไม่ได้ก็ไม่เป็นไร) — เรียกเฉพาะเมื่อผู้อ่านเลือกเอง ภาษาที่ตรวจจับได้ไม่ถูกเก็บ */
export function saveLocale(locale: Locale): void {
  writeJson(KEYS.lang, locale)
}
