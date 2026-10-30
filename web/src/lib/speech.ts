/**
 * ส่วนที่เป็นตรรกะล้วนของเสียงอ่าน: แบ่งข้อความเป็นท่อนสั้น, จัดคิวท่อนตามย่อหน้า, เลือกเสียงไทย
 * (ตัวเล่นเสียงอยู่ที่ `speech-player.ts`, hook อยู่ที่ `useSpeech.ts`)
 *
 * แบ่งท่อนเพราะบางเบราว์เซอร์อ่านข้อความยาวๆ ไม่ได้หรือหยุดกลางทาง · ภาษาไทยไม่เว้นวรรคระหว่างคำ
 * ย่อหน้าเดียวจึงอาจยาวเป็นพันตัวอักษรโดยไม่มีช่องว่างเลย → ตัดที่ขอบเขตคำ ไม่ตัดกลางคำ
 */
import { isSceneBreak } from "./text"

/** ความยาวท่อนสูงสุดโดยปริยาย (ตัวอักษร) */
export const SPEECH_MAX = 180

let wordSegmenter: Intl.Segmenter | null | undefined
/** ตัวแบ่งคำภาษาไทยของเบราว์เซอร์ (`null` = เบราว์เซอร์นี้ไม่มี `Intl.Segmenter`) */
export function defaultSegmenter(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("th", { granularity: "word" }) : null
    } catch {
      wordSegmenter = null
    }
  }
  return wordSegmenter
}

const ASCII_ENDS = ".!?"
const WIDE_ENDS = "。！？"
/** เครื่องหมายปิดที่ติดอยู่หลังจุดจบประโยค เช่น  ."  .)  ?」 */
const CLOSERS = "\"'”’)]」』"

/**
 * ตัดหลังจุดจบประโยค — `.!?` ต้องตามด้วยช่องว่างหรือจบข้อความ (กัน 3.14), `。！？` ตัดได้เลย
 * ช่องว่างที่ตามหลังติดไปกับประโยคเดิม ท่อนต่อกันได้ข้อความเดิม
 */
function sentenceParts(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    if (!ASCII_ENDS.includes(text[i]) && !WIDE_ENDS.includes(text[i])) {
      i++
      continue
    }
    let end = i + 1
    while (end < text.length && (ASCII_ENDS.includes(text[end]) || WIDE_ENDS.includes(text[end]))) end++
    const wide = /[。！？]/.test(text.slice(i, end))
    while (end < text.length && CLOSERS.includes(text[end])) end++
    if (wide || end >= text.length || /\s/.test(text[end])) {
      while (end < text.length && /\s/.test(text[end])) end++
      parts.push(text.slice(start, end))
      start = end
    }
    i = end
  }
  if (start < text.length) parts.push(text.slice(start))
  return parts
}

/** คำคั่นช่องว่าง: ตัวที่ไม่ใช่ช่องว่างหนึ่งช่วง + ช่องว่างที่ตามหลัง (ช่องว่างนำหน้าข้อความเป็นชิ้นของมันเอง) */
function spaceParts(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? []
}

function wordParts(text: string, segmenter: Intl.Segmenter): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment)
}

const NO_START = /^[\p{M}\u{200D}ะาำๆฯ]/u // อักษรประกอบ (สระบน-ล่าง วรรณยุกต์) และตัวที่ขึ้นต้นคำไม่ได้
const NO_END = /[เแโใไ\u{200D}]$/u // สระนำต้องอยู่กับพยัญชนะที่ตามมา

/** ตัดระหว่าง `text[i-1]` กับ `text[i]` ได้โดยไม่ผ่าคู่ surrogate / อักษรประกอบ / สระนำ */
function canCutAt(text: string, i: number): boolean {
  const before = text.charCodeAt(i - 1)
  const after = text.charCodeAt(i)
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return false
  return !NO_START.test(text.slice(i, i + 2)) && !NO_END.test(text[i - 1])
}

/** ตัดแข็งทุก `limit` ตัว (ทางสุดท้ายเมื่อไม่มีช่องว่าง/ขอบเขตคำให้ตัด) — ถอยหาจุดที่ผ่ากลางอักขระไม่ได้ก่อน; ไม่มีเลยก็ขยับไปข้างหน้า */
function hardCut(text: string, limit: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let cut = Math.min(text.length, start + limit)
    if (cut < text.length) {
      let back = cut
      while (back > start + 1 && !canCutAt(text, back)) back--
      if (canCutAt(text, back)) {
        cut = back
      } else {
        while (cut < text.length && !canCutAt(text, cut)) cut++
      }
    }
    chunks.push(text.slice(start, cut))
    start = cut
  }
  return chunks
}

type Splitter = (text: string) => string[]

/**
 * ประกอบชิ้นของระดับ `depth` เข้าด้วยกันจนใกล้ `limit`; ชิ้นเดียวที่ยาวเกินถูกแบ่งต่อด้วยระดับถัดไป
 * (ท่อนสุดท้ายของชิ้นที่แบ่งแล้วยังรับชิ้นถัดไปต่อได้) · ระดับที่แบ่งไม่ได้ (ได้ชิ้นเดียว) ข้ามไประดับถัดไป · หมดระดับ → ตัดแข็ง
 */
function pack(text: string, limit: number, levels: readonly Splitter[], depth: number): string[] {
  if (text.length <= limit) return [text]
  if (depth >= levels.length) return hardCut(text, limit)
  const parts = levels[depth](text)
  if (parts.length < 2) return pack(text, limit, levels, depth + 1)
  const chunks: string[] = []
  let current = ""
  for (const part of parts) {
    if (current.length + part.length <= limit) {
      current += part
      continue
    }
    if (current !== "") {
      chunks.push(current)
      current = ""
    }
    if (part.length <= limit) {
      current = part
      continue
    }
    const pieces = pack(part, limit, levels, depth + 1)
    current = pieces.pop() ?? ""
    for (const piece of pieces) chunks.push(piece)
  }
  if (current !== "") chunks.push(current)
  return chunks
}

/**
 * แบ่งข้อความเป็นท่อนยาวไม่เกิน `max` ตัว สำหรับส่งให้เสียงอ่านทีละท่อน
 * ตัดตามลำดับ: จบประโยค (`.!?。！？`) → ช่องว่าง/ขึ้นบรรทัด → ขอบเขตคำจาก `segmenter` (ไทย) → ตัดแข็ง; สะสมจนใกล้ `max`
 * ท่อนต่อกันได้ข้อความเดิมทุกตัวอักษร (ไม่ตัดช่องว่างหัวท้ายท่อน) ยกเว้นท่อนที่มีแต่ช่องว่างซึ่งถูกทิ้ง
 * `max` ที่ไม่ใช่จำนวน ≥ 1 → 180 · `segmenter = null` = เบราว์เซอร์ที่ไม่มี `Intl.Segmenter` (ข้ามขั้นตัดที่คำ)
 * ท่อนยาวเกิน `max` ได้ก็ต่อเมื่อ `max` เล็กกว่าอักขระหนึ่งตัวที่ผ่าไม่ได้ (เช่น max 1 กับอีโมจิ)
 */
export function splitForSpeech(text: string, max: number = SPEECH_MAX, segmenter: Intl.Segmenter | null = defaultSegmenter()): string[] {
  if (!/\S/.test(text)) return []
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : SPEECH_MAX
  const levels: Splitter[] = [sentenceParts, spaceParts]
  if (segmenter !== null) levels.push((part) => wordParts(part, segmenter))
  return pack(text, limit, levels, 0).filter((chunk) => /\S/.test(chunk))
}

/** ท่อนหนึ่งในคิวเสียง: `para` = ลำดับย่อหน้าเดิม · `first` = ท่อนแรกของย่อหน้านั้น (เริ่มย่อหน้าใหม่) */
export interface SpeechItem {
  text: string
  para: number
  first: boolean
}

/** คิวท่อนเสียงของทั้งตอน เรียงตามย่อหน้า — เส้นคั่นฉากและย่อหน้าที่ไม่มีอะไรให้อ่านถูกข้าม (ลำดับ `para` ของที่เหลือไม่เลื่อน) */
export function buildQueue(paragraphs: readonly string[], max?: number, segmenter?: Intl.Segmenter | null): SpeechItem[] {
  const items: SpeechItem[] = []
  paragraphs.forEach((paragraph, para) => {
    if (isSceneBreak(paragraph)) return
    splitForSpeech(paragraph, max, segmenter).forEach((text, i) => items.push({ text, para, first: i === 0 }))
  })
  return items
}

/** เสียงภาษาไทย: `th`, `th-TH`, `th_TH` (Android เก่าใช้ขีดล่าง) ไม่สนตัวพิมพ์ */
export function isThaiVoice(voice: { lang: string }): boolean {
  return typeof voice.lang === "string" && /^th(?:[-_]|$)/i.test(voice.lang)
}

/** เสียงไทยที่ควรใช้: ตัวที่ระบบตั้งเป็นค่าเริ่มต้นก่อน ไม่งั้นตัวแรกที่พบ · ไม่มีเลย → `null` */
export function pickThaiVoice<T extends { lang: string; default?: boolean }>(voices: readonly T[]): T | null {
  const thai = voices.filter(isThaiVoice)
  return thai.find((voice) => voice.default === true) ?? thai[0] ?? null
}
