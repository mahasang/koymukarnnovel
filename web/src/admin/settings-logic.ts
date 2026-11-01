/**
 * ตรรกะล้วนของหน้าตั้งค่า (spec 7.9): ร่างค่าที่แก้ · ตรวจช่อง (ขีดจำกัดตรงกับ `server/src/settings.ts`) · ส่งเฉพาะช่องที่เปลี่ยน ·
 * ข้อผิดพลาดตรวจค่าจากเซิร์ฟเวอร์ต่อช่อง · ข้อความและตัวอย่างคำสั่งของช่องทางนำเข้า · `Settings.tsx` ต่อกับ API และหน้าจอ
 */
import { ACCENT_IDS } from "../lib/accent"
import { ApiError } from "../lib/api"
import type { AccentId } from "../lib/types"
import { formatCount } from "./format"
import type { SettingsDto, SiteSettingsInput } from "./types"

export interface PriceDraft {
  in: string
  out: string
}

/** ค่าที่ผู้ดูแลแก้ในฟอร์ม: ข้อความทั้งหมด (ราคาเป็นข้อความจนกว่าจะบันทึก) */
export interface SettingsDraft {
  siteName: string
  tagline: string
  aboutText: string
  contactText: string
  accent: AccentId
  indexable: boolean
  translateModel: string
  recapModel: string
  /** ราคาต่อ 1 ล้านโทเคน (ดอลลาร์) ตามชื่อโมเดล */
  prices: Record<string, PriceDraft>
}

/** ช่องที่เซิร์ฟเวอร์ระบุได้ใน `invalid_field` */
export type SettingsField = keyof SettingsDraft

export const MAX = { siteName: 80, tagline: 160, aboutText: 5000, contactText: 2000, model: 100 } as const

export const MODEL_SUGGESTIONS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"] as const

export const ACCENT_LABEL: Record<AccentId, string> = {
  default: "ตามธีม",
  violet: "ม่วง",
  pink: "ชมพู",
  teal: "เขียวน้ำทะเล",
  amber: "เหลืองอำพัน",
  blue: "น้ำเงิน",
}

export const BACKUP_HREF = "/api/admin/backup"

export const TOKEN_COMMAND = `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`

const MODEL_NAME = /^[\w.\-]+$/
const PRICE_NUMBER = /^\d+(\.\d+)?$/

export function draftOfSettings(s: SettingsDto): SettingsDraft {
  const prices: SettingsDraft["prices"] = {}
  for (const [model, price] of Object.entries(s.prices)) prices[model] = { in: String(price.in), out: String(price.out) }
  return {
    siteName: s.siteName,
    tagline: s.tagline,
    aboutText: s.aboutText,
    contactText: s.contactText,
    accent: s.accent,
    indexable: s.indexable,
    translateModel: s.translateModel,
    recapModel: s.recapModel,
    prices,
  }
}

/** โมเดลที่มีแถวราคา: โมเดลแปล → โมเดลสรุป → โมเดลอื่นที่เคยมีราคา (เรียงชื่อ) · ไม่ซ้ำ ไม่เอาชื่อว่าง */
export function priceModels(d: SettingsDraft): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of [d.translateModel.trim(), d.recapModel.trim(), ...Object.keys(d.prices).sort()]) {
    if (name === "" || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export interface SettingsErrors {
  siteName?: string
  tagline?: string
  aboutText?: string
  contactText?: string
  translateModel?: string
  recapModel?: string
  /** ตามชื่อโมเดล */
  prices?: Record<string, string>
}

const blank = (p: PriceDraft): boolean => p.in.trim() === "" && p.out.trim() === ""

function modelError(label: string, value: string): string | undefined {
  const v = value.trim()
  if (v === "") return `กรอกชื่อ${label}`
  if (v.length > MAX.model) return `ชื่อ${label}ยาวเกิน ${MAX.model} ตัวอักษร`
  if (!MODEL_NAME.test(v)) return `ชื่อ${label}ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีด และขีดล่าง`
  return undefined
}

/** ช่องที่ผิด → ข้อความไทย (ว่าง = ใช้ได้) · ตรวจเท่าที่เซิร์ฟเวอร์ตรวจ เพื่อไม่ต้องรอคำตอบ 400 */
export function validateSettings(d: SettingsDraft): SettingsErrors {
  const errors: SettingsErrors = {}
  const name = d.siteName.trim()
  if (name === "") errors.siteName = "กรอกชื่อเว็บ"
  else if (name.length > MAX.siteName) errors.siteName = `ชื่อเว็บยาวเกิน ${MAX.siteName} ตัวอักษร`
  if (d.tagline.trim().length > MAX.tagline) errors.tagline = `สโลแกนยาวเกิน ${MAX.tagline} ตัวอักษร`
  if (d.aboutText.length > MAX.aboutText) errors.aboutText = `ข้อความหน้าเกี่ยวกับยาวเกิน ${formatCount(MAX.aboutText)} ตัวอักษร`
  if (d.contactText.length > MAX.contactText) errors.contactText = `ข้อความหน้าติดต่อยาวเกิน ${formatCount(MAX.contactText)} ตัวอักษร`
  const translate = modelError("โมเดลแปล", d.translateModel)
  if (translate !== undefined) errors.translateModel = translate
  const recap = modelError("โมเดลสรุป", d.recapModel)
  if (recap !== undefined) errors.recapModel = recap
  const prices: Record<string, string> = {}
  for (const [model, p] of Object.entries(d.prices)) {
    if (blank(p)) continue
    const a = p.in.trim()
    const b = p.out.trim()
    if (a === "" || b === "") prices[model] = "กรอกให้ครบทั้งราคาเข้าและออก หรือเว้นว่างทั้งคู่"
    else if (!PRICE_NUMBER.test(a) || !PRICE_NUMBER.test(b)) prices[model] = "ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป เช่น 3 หรือ 0.8"
  }
  if (Object.keys(prices).length > 0) errors.prices = prices
  return errors
}

/** ราคาที่ใช้ได้ทุกแถว (ตัวเลขแล้ว) · แถวว่างล้วนและแถวที่ยังไม่ครบ/ไม่ใช่ตัวเลขถูกข้าม */
function parsedPrices(prices: SettingsDraft["prices"]): SettingsDto["prices"] {
  const out: SettingsDto["prices"] = {}
  for (const [model, p] of Object.entries(prices)) {
    const a = p.in.trim()
    const b = p.out.trim()
    if (PRICE_NUMBER.test(a) && PRICE_NUMBER.test(b)) out[model] = { in: Number(a), out: Number(b) }
  }
  return out
}

const sameNumbers = (a: SettingsDto["prices"], b: SettingsDto["prices"]): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] !== undefined && a[k].in === b[k].in && a[k].out === b[k].out)
}

/** เฉพาะช่องที่ต่างจากค่าที่บันทึกไว้ (ข้อความสั้นเทียบหลังตัดช่องว่างหัวท้าย) — ไม่มีอะไรเปลี่ยน → {} · เรียกหลังตรวจผ่านแล้ว */
export function settingsChanges(saved: SettingsDto, d: SettingsDraft): SiteSettingsInput {
  const patch: SiteSettingsInput = {}
  const siteName = d.siteName.trim()
  if (siteName !== saved.siteName) patch.siteName = siteName
  const tagline = d.tagline.trim()
  if (tagline !== saved.tagline) patch.tagline = tagline
  if (d.aboutText !== saved.aboutText) patch.aboutText = d.aboutText
  if (d.contactText !== saved.contactText) patch.contactText = d.contactText
  if (d.accent !== saved.accent) patch.accent = d.accent
  if (d.indexable !== saved.indexable) patch.indexable = d.indexable
  const translateModel = d.translateModel.trim()
  if (translateModel !== saved.translateModel) patch.translateModel = translateModel
  const recapModel = d.recapModel.trim()
  if (recapModel !== saved.recapModel) patch.recapModel = recapModel
  const prices = parsedPrices(d.prices)
  if (!sameNumbers(prices, saved.prices)) patch.prices = prices
  return patch
}

/** ราคาแบบเทียบกันได้: ตัดแถวว่างล้วน · เลขที่ถูกต้องเทียบเป็นตัวเลข (3 = 3.0) · ที่ยังไม่ครบ/ผิดเทียบเป็นข้อความ */
function comparablePrices(prices: SettingsDraft["prices"]): string {
  const out: [string, unknown, unknown][] = []
  for (const model of Object.keys(prices).sort()) {
    const p = prices[model]
    if (blank(p)) continue
    const norm = (s: string): string | number => (PRICE_NUMBER.test(s.trim()) ? Number(s.trim()) : s.trim())
    out.push([model, norm(p.in), norm(p.out)])
  }
  return JSON.stringify(out)
}

/** ฟอร์มต่างจากค่าที่บันทึกไว้หรือไม่ (ใช้ตัดสินข้อความ "ยังไม่บันทึก" และคำเตือนก่อนออกจากหน้า) */
export function isDirty(base: SettingsDraft, d: SettingsDraft): boolean {
  const scalars = ["siteName", "tagline", "aboutText", "contactText", "accent", "indexable", "translateModel", "recapModel"] as const
  return scalars.some((key) => base[key] !== d[key]) || comparablePrices(base.prices) !== comparablePrices(d.prices)
}

const FIELDS: readonly string[] = ["siteName", "tagline", "aboutText", "contactText", "accent", "indexable", "translateModel", "recapModel", "prices"]

/** ข้อผิดพลาดตรวจค่าจากเซิร์ฟเวอร์ (400 `invalid_field` พร้อม `field`) → ช่องที่ผิดกับข้อความไทยของเซิร์ฟเวอร์ · อย่างอื่น → null */
export function fieldFromError(e: unknown): { field: SettingsField; message: string } | null {
  if (!(e instanceof ApiError) || e.code !== "invalid_field") return null
  const field = (e.data as { field?: unknown } | undefined)?.field
  return typeof field === "string" && FIELDS.includes(field) ? { field: field as SettingsField, message: e.message } : null
}

export const apiKeyNote = (set: boolean): string =>
  set
    ? "ตั้ง ANTHROPIC_API_KEY แล้ว (ไม่แสดงตัวคีย์)"
    : "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY — ใส่ในไฟล์ .env ของเซิร์ฟเวอร์แล้วรีสตาร์ท ระหว่างนี้เพิ่มตอนได้แต่จะเก็บเป็นร่าง (ยังสั่งแปลไม่ได้)"

/** การทดสอบใช้โมเดลสรุปที่ "บันทึกไว้" — ถ้าช่องที่กำลังแก้ต่างกัน เตือนให้บันทึกก่อน (ไม่ต่าง → null) */
export const testDiffersNote = (saved: string, typed: string): string | null =>
  saved === typed.trim() ? null : "ช่องโมเดลสรุปที่แก้อยู่ยังไม่ได้บันทึก — การทดสอบใช้โมเดลที่บันทึกไว้แล้ว"

export const importStatusNote = (set: boolean): string =>
  set ? "ตั้ง IMPORT_TOKEN แล้ว — ช่องทางนำเข้าเปิดใช้อยู่ (ไม่แสดงตัวโทเค็น)" : "ยังไม่ได้ตั้ง IMPORT_TOKEN — ช่องทางนำเข้าปิดอยู่ (ทุกเส้นทางตอบ 404)"

export interface ImportExample {
  label: string
  command: string
}

/** ตัวอย่างคำสั่งสำหรับผู้แปลภายนอก (ใช้ `YOUR_TOKEN` แทนค่าจริง) — เฉพาะดูรายการร่างกับส่งคำแปล ช่องทางนี้สร้าง/ลบ/เผยแพร่ตอนไม่ได้ */
export function importExamples(importUrl: string): ImportExample[] {
  const base = importUrl.replace(/\/+$/, "")
  return [
    { label: "ดูตอนที่ยังรอแปล", command: `curl "${base}/novels/1/chapters?status=draft" \\\n  -H "Authorization: Bearer YOUR_TOKEN"` },
    {
      label: "ส่งคำแปลเข้าตอนที่ 1",
      command: `curl -X PUT "${base}/novels/1/chapters/1/translation" \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"translation":"ข้อความแปลทั้งตอน","titleTh":"ชื่อตอน","recap":"เรื่องย่อ 2-3 ประโยค"}'`,
    },
  ]
}

/** ช่องแรกที่ผิดตามลำดับบนหน้า → id ขององค์ประกอบที่ควรโฟกัส (ไม่มีช่องผิด → null) */
export function firstInvalidId(errors: SettingsErrors, d: SettingsDraft): string | null {
  for (const key of ["siteName", "tagline", "aboutText", "contactText", "translateModel", "recapModel"] as const) {
    if (errors[key] !== undefined) return `st-${key}`
  }
  const prices = errors.prices
  if (prices !== undefined) {
    const model = priceModels(d).find((m) => prices[m] !== undefined)
    if (model !== undefined) return priceFieldId(model, "in")
  }
  return null
}

/** id ของช่องราคาของโมเดลหนึ่ง (`in` = ราคาเข้า, `out` = ราคาออก) */
export const priceFieldId = (model: string, kind: "in" | "out"): string => `st-price-${model}-${kind}`
