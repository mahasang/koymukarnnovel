import { MAX_TAG_LENGTH, MAX_TAGS } from "../prompts.js"
import { HttpError, notFound } from "../util/errors.js"
import { normalizeText } from "../util/text.js"

/**
 * ตัวตรวจข้อมูลที่ผู้ใช้ส่งมา (body และพารามิเตอร์ในพาธ) ของทุกเส้นทางหลังบ้าน: ผ่าน → คืนค่าที่ล้างแล้ว · ไม่ผ่าน → HttpError ข้อความไทย
 * `field` คือชื่อที่คนอ่านรู้เรื่อง เช่น "ชื่อเรื่อง (title)" ผู้เรียกเป็นคนตั้ง ข้อความผิดพลาดจึงบอกได้ทั้งชื่อไทยและชื่อฟิลด์ในคำขอ
 * ความยาวนับเป็นหน่วย UTF-16 แบบเดียวกับตัวตรวจอื่นของระบบ (ข้อความไทยหนึ่งตัวอักษรนับหนึ่ง)
 */

export const invalidField = (message: string): HttpError => new HttpError(400, message, "invalid_field")

/** body ต้องเป็นออบเจ็กต์ JSON (ไม่ใช่ null, อาร์เรย์, ข้อความ ฯลฯ หรือไม่ได้ส่งมาเลย) */
export function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "ข้อมูลที่ส่งมาต้องเป็นออบเจ็กต์ JSON", "bad_request")
  return v as Record<string, unknown>
}

/**
 * ข้อความ: ล้างด้วย `normalizeText` ก่อนนับความยาว (ค่าที่เก็บจริงคือค่าที่นับ)
 * `optional` = ไม่ได้ส่งมา (undefined) ได้ค่าว่าง แต่ถ้าส่งมาต้องเป็นข้อความ (null ไม่ผ่าน)
 */
export function str(v: unknown, field: string, o: { max: number; min?: number; optional?: boolean }): string {
  if (v === undefined) {
    if (o.optional) return ""
    throw invalidField(`${field} ต้องระบุ`)
  }
  if (typeof v !== "string") throw invalidField(`${field} ต้องเป็นข้อความ`)
  const s = normalizeText(v)
  const min = o.min ?? 0
  if (s.length < min) throw invalidField(min === 1 ? `${field} ต้องไม่ว่าง` : `${field} ต้องมีอย่างน้อย ${min} ตัวอักษร`)
  if (s.length > o.max) throw invalidField(`${field} ต้องยาวไม่เกิน ${o.max} ตัวอักษร`)
  return s
}

function rangeText({ min, max }: { min?: number; max?: number }): string {
  if (min !== undefined && max !== undefined) return ` ระหว่าง ${min} ถึง ${max}`
  return min !== undefined ? ` ตั้งแต่ ${min} ขึ้นไป` : ` ไม่เกิน ${max}`
}

/** จำนวนเต็มที่ JavaScript แทนได้เป๊ะ (ไม่รับข้อความ "5", ทศนิยม, NaN, Infinity) · ขอบ min/max รวมค่าขอบ */
export function int(v: unknown, field: string, o: { min?: number; max?: number } = {}): number {
  if (!Number.isSafeInteger(v)) throw invalidField(`${field} ต้องเป็นจำนวนเต็ม`)
  const n = v as number
  if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) throw invalidField(`${field} ต้องเป็นจำนวนเต็ม${rangeText(o)}`)
  return n
}

export function bool(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") throw invalidField(`${field} ต้องเป็น true หรือ false`)
  return v
}

/** ต้องตรงกับค่าในรายการเป๊ะ (ชนิดและตัวพิมพ์) · เทียบด้วยค่า ไม่ใช่ชื่อคุณสมบัติ จึงไม่หลงรับ "toString" หรือ "__proto__" */
export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  const found = allowed.find((a) => a === v)
  if (found === undefined) throw invalidField(`${field} ต้องเป็นหนึ่งใน: ${allowed.join(", ")}`)
  return found
}

/** แท็ก: ล้างข้อความ ทิ้งอันว่าง ตัดซ้ำโดยไม่สนตัวพิมพ์ (เก็บอันแรกตามที่สะกด) · อันละไม่เกิน `MAX_TAG_LENGTH` รวมไม่เกิน `MAX_TAGS` อันหลังตัดซ้ำ */
export function tags(v: unknown): string[] {
  if (!Array.isArray(v)) throw invalidField("แท็กต้องเป็นรายการ (อาร์เรย์) ของข้อความ")
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (typeof item !== "string") throw invalidField("แท็กทุกอันต้องเป็นข้อความ")
    const tag = normalizeText(item)
    if (tag === "") continue
    if (tag.length > MAX_TAG_LENGTH) throw invalidField(`แท็กแต่ละอันต้องยาวไม่เกิน ${MAX_TAG_LENGTH} ตัวอักษร`)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  if (out.length > MAX_TAGS) throw invalidField(`ใส่แท็กได้ไม่เกิน ${MAX_TAGS} อัน`)
  return out
}

const MAX_URL_LENGTH = 2000
const HTTP_PREFIX = /^https?:\/\//i
const SPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/

/**
 * ลิงก์ที่ใส่ในหน้าเว็บได้อย่างปลอดภัย: ว่าง (= ไม่มีลิงก์) หรือ http/https ที่อ่านได้และไม่มีช่องว่าง/อักขระควบคุม (กัน `javascript:` และ `data:`)
 * คืนข้อความตามที่กรอกหลังล้างช่องว่างหัวท้าย ไม่แก้ตัวพิมพ์และไม่เติม `/`
 */
export function httpUrl(v: unknown, field: string): string {
  if (typeof v !== "string") throw invalidField(`${field} ต้องเป็นข้อความ`)
  const url = normalizeText(v)
  if (url === "") return ""
  if (url.length > MAX_URL_LENGTH) throw invalidField(`${field} ต้องยาวไม่เกิน ${MAX_URL_LENGTH} ตัวอักษร`)
  if (!HTTP_PREFIX.test(url) || SPACE_OR_CONTROL.test(url) || !URL.canParse(url)) {
    throw invalidField(`${field} ต้องเป็นลิงก์ที่ขึ้นต้นด้วย http:// หรือ https:// และไม่มีช่องว่าง`)
  }
  return url
}

const ID_PARAM = /^[1-9]\d*$/

/** `idParam` แบบไม่ throw: รูปแบบผิด → null (หน้าเว็บที่ต้องตอบเป็น HTML แทน JSON ใช้ตัวนี้) */
export function parseIdParam(v: unknown): number | null {
  if (typeof v === "string" && ID_PARAM.test(v)) {
    const id = Number(v)
    if (Number.isSafeInteger(id)) return id
  }
  return null
}

/** รหัสในพาธ (`/novels/:id`): จำนวนเต็มบวกรูปแบบมาตรฐานเท่านั้น รูปแบบอื่นทั้งหมดตอบเหมือน "ไม่มีรหัสนั้น" (404) */
export function idParam(v: unknown, what: string): number {
  const id = parseIdParam(v)
  if (id === null) throw notFound(`ไม่พบ${what}`)
  return id
}

const NUMBER_PARAM = /^(?:0|[1-9]\d*)$/

/** `numberParam` แบบไม่ throw: รูปแบบผิด → null */
export function parseNumberParam(v: unknown): number | null {
  return typeof v === "string" && NUMBER_PARAM.test(v) ? Number(v) : null
}

/**
 * เลขตอนในพาธ (`/chapters/:number`): จำนวนเต็มไม่ติดลบรูปแบบมาตรฐานเท่านั้น (ตอนเลข 0 มีได้) รูปแบบอื่นทั้งหมดตอบเหมือน "ไม่มีตอนนั้น" (404)
 * เลขยาวจนเกินที่ JS แทนได้ไม่ต้องกันแยก: ตอนที่มีอยู่จริงเป็นจำนวนเต็มปลอดภัยเสมอ ค่าที่ใหญ่เกินจึงแค่ไม่ตรงตอนไหน (SQLite ผูกค่าแล้วไม่ throw)
 */
export function numberParam(v: unknown, what: string): number {
  const n = parseNumberParam(v)
  if (n === null) throw notFound(`ไม่พบ${what}`)
  return n
}
