/**
 * ปกนิยาย: ครอบกึ่งกลางเป็นอัตราส่วน 2:3 แล้วย่อเป็น 400×600 JPEG ในเบราว์เซอร์ก่อนส่ง (spec 7.4)
 * ฟังก์ชันคำนวณ/ตรวจ (`coverCropRect`, `encodeUnderLimit`, `base64Bytes`, `stripDataUrl`, `checkCoverFile`) ไม่แตะ DOM จึงเทสต์ตรงๆ ได้
 * ส่วนที่ต้องมีเบราว์เซอร์ (`cropToCoverBase64`, `cropFileToCoverBase64`) เป็นแค่ตัวเชื่อม canvas — ตรวจในเบราว์เซอร์จริง
 */

export const COVER_WIDTH = 400
export const COVER_HEIGHT = 600
/** เพดานขนาดไฟล์หลังถอดฐานสอง — ตรงกับ `MAX_COVER_BYTES` ของเซิร์ฟเวอร์ (server/src/covers.ts) */
export const COVER_MAX_BYTES = 500 * 1024
/** ไฟล์ต้นฉบับใหญ่กว่านี้ไม่ถอดรหัส (กันแท็บค้างกับรูปหลายร้อยล้านพิกเซล) */
export const COVER_MAX_SOURCE_BYTES = 25 * 1024 * 1024
/** คุณภาพ JPEG ที่ลองตามลำดับ (สูง → ต่ำ) */
export const COVER_QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2] as const

export interface CropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * กรอบที่ตัดจากรูปต้นฉบับ `w × h` ให้เป็น 2:3 อยู่กึ่งกลาง ใช้ภาพเต็มอย่างน้อยหนึ่งด้าน
 * กว้างกว่าหรือเท่า 2:3 → ใช้ความสูงเต็ม ตัดสองข้าง · แคบกว่า → ใช้ความกว้างเต็ม ตัดบนล่าง
 * ขนาดที่ใช้ไม่ได้ (0, ลบ, NaN, อินฟินิตี้) → กรอบว่างทุกค่า 0 (ผู้เรียกต้องเช็กเอง ไม่ให้ NaN หลุดไปถึง canvas)
 */
export function coverCropRect(w: number, h: number): CropRect {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 }
  if (w * 3 >= h * 2) {
    const sw = Math.round((h * 2) / 3)
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h }
  }
  const sh = Math.round((w * 3) / 2)
  return { sx: 0, sy: Math.round((h - sh) / 2), sw: w, sh }
}

/** ขนาดหลังถอดรหัสฐานสอง (ไบต์) โดยไม่ต้องถอดจริง */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

const JPEG_PREFIX = "data:image/jpeg;base64,"

/** ตัดส่วนหัว `data:image/jpeg;base64,` เหลือแต่ฐานสอง · เบราว์เซอร์ที่เข้ารหัส JPEG ไม่ได้จะคืน PNG แทน → ไม่ใช้ */
export function stripDataUrl(url: string): string {
  if (!url.startsWith(JPEG_PREFIX)) throw new Error("เบราว์เซอร์นี้สร้างไฟล์ JPEG ไม่ได้ — ลองใช้เบราว์เซอร์อื่น")
  return url.slice(JPEG_PREFIX.length)
}

/** ลดคุณภาพทีละขั้น (`COVER_QUALITIES`) จนผลถอดฐานสองแล้วไม่เกิน `limit` ไบต์ · ลดสุดแล้วยังเกิน → throw */
export function encodeUnderLimit(encode: (quality: number) => string, limit: number): string {
  for (const quality of COVER_QUALITIES) {
    const b64 = encode(quality)
    if (base64Bytes(b64) <= limit) return b64
  }
  throw new Error("รูปนี้ใหญ่เกินไปแม้ลดคุณภาพที่สุดแล้ว — ลองใช้รูปอื่น")
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

/** ตรวจไฟล์ที่เลือกก่อนถอดรหัส: ผ่าน → null · ไม่ผ่าน → ข้อความไทย (SVG ไม่รับ: ขนาดตั้งต้นของมันไม่แน่นอนในแต่ละเบราว์เซอร์) */
export function checkCoverFile(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "ไฟล์ปกต้องเป็นรูป JPEG, PNG หรือ WebP"
  if (file.size > COVER_MAX_SOURCE_BYTES) return `ไฟล์รูปใหญ่เกิน ${COVER_MAX_SOURCE_BYTES / 1024 / 1024}MB — ย่อรูปก่อนแล้วลองใหม่`
  return null
}

/** ครอบ + ย่อรูปที่ถอดรหัสแล้ว (`img.decode()` เสร็จ) เป็น JPEG 400×600 คืนฐานสองไม่มี prefix `data:` */
export async function cropToCoverBase64(img: HTMLImageElement): Promise<string> {
  const { sx, sy, sw, sh } = coverCropRect(img.naturalWidth, img.naturalHeight)
  if (sw === 0 || sh === 0) throw new Error("อ่านขนาดรูปไม่ได้ — ไฟล์อาจเสียหรือไม่ใช่รูป")
  const canvas = document.createElement("canvas")
  canvas.width = COVER_WIDTH
  canvas.height = COVER_HEIGHT
  const ctx = canvas.getContext("2d")
  if (ctx === null) throw new Error("เบราว์เซอร์นี้วาดรูปไม่ได้ — ลองใช้เบราว์เซอร์อื่น")
  // JPEG ไม่มีความโปร่งใส: รูป PNG ที่โปร่งใสจะกลายเป็นสีดำถ้าไม่ลงพื้นขาวก่อน
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COVER_WIDTH, COVER_HEIGHT)
  return encodeUnderLimit((quality) => stripDataUrl(canvas.toDataURL("image/jpeg", quality)), COVER_MAX_BYTES)
}

/** ไฟล์ที่ผู้ใช้เลือก → ปก JPEG ฐานสอง (ตรวจไฟล์ ถอดรหัส ครอบ ย่อ) · ไฟล์เสีย/ใหญ่/ไม่ใช่รูป → throw ข้อความไทย */
export async function cropFileToCoverBase64(file: File): Promise<string> {
  const problem = checkCoverFile(file)
  if (problem !== null) throw new Error(problem)
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error("เปิดรูปนี้ไม่ได้ — ไฟล์อาจเสียหรือไม่ใช่รูป")
    }
    return await cropToCoverBase64(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}
