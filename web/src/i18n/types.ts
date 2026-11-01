/** ภาษาของ UI หน้าบ้านที่รองรับ (ข้อความอยู่ในไฟล์ th.ts / en.ts / lo.ts) */
export const LOCALES = ["th", "en", "lo"] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "th"

/** ชื่อภาษาที่เขียนด้วยภาษาของตัวเอง (เมนูเลือกภาษาแสดงตามนี้เสมอ) */
export const LOCALE_NAMES: Record<Locale, string> = { th: "ไทย", en: "English", lo: "ລາວ" }

/** ภาษาของเนื้อหา (ชื่อเรื่อง คำแปลตอน ข้อความที่เจ้าของกรอก) — ยังเป็นไทยอย่างเดียว ใส่เป็น `lang` ของกรอบเนื้อหา */
export const CONTENT_LANG = "th"
