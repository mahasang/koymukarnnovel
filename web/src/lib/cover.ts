/**
 * ปกนิยาย: มีรูปปก → ใช้รูปจากเซิร์ฟเวอร์ · ไม่มี → ปกอัตโนมัติที่ได้จากชื่อเรื่อง (สีไล่ระดับ + ลายประกอบ + ชื่อเรื่อง)
 * ปกอัตโนมัติคงที่ต่อชื่อเรื่อง: ชื่อเดียวกันได้หน้าตาเดิมเสมอ ทุกเครื่อง ทุกครั้ง ทุกเวอร์ชันของโค้ด (เทสต์ตรึงค่าไว้)
 * โค้ดชุดนี้ไม่แตะ DOM — ส่วนที่วาด (SVG ลายประกอบ) อยู่ที่ `components/CoverArt.tsx`
 */

/** ลายประกอบของปกอัตโนมัติ — ลำดับมีผลต่อการเลือกลายของแต่ละชื่อ ห้ามสลับ (ถ้าจะเพิ่มลาย ต่อท้ายเท่านั้น) */
export const MOTIFS = ["lantern", "planet", "city", "waves", "mountain", "flower", "snow", "book"] as const
export type Motif = (typeof MOTIFS)[number]

/** ที่อยู่รูปปก (ต่อ `?v=` ให้เบราว์เซอร์เห็นปกใหม่ทันทีที่เปลี่ยน) — ไม่มีปก → `null` */
export function coverUrl(novel: { id: number; hasCover: boolean; coverV: number }): string | null {
  return novel.hasCover ? `/covers/${novel.id}?v=${novel.coverV}` : null
}

// ---- แฮชของชื่อเรื่อง: FNV-1a 32 บิตบนหน่วย UTF-16 (เรียบง่าย กระจายพอสำหรับเลือกสีกับลาย ไม่ใช่เพื่อความปลอดภัย) ----
const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

function hashTitle(title: string): number {
  const text = title.trim().normalize("NFC")
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash
}

// ---- สี: ทุกเฉดได้ความสว่างเท่ากัน (ปกทุกใบหนักเบาเท่ากัน) และตัวอักษรขาวบนสีกลางอ่านออกเสมอ ----
type Rgb = readonly [number, number, number]

/** HSL (เฉด 0–359, อิ่มตัวและสว่าง 0–1) → RGB ช่องละ 0–1 */
function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x] : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const m = lightness - chroma / 2
  return [r + m, g + m, b + m]
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/** ความสว่างเชิงสัมพัทธ์ตามนิยาม WCAG (0 = ดำ, 1 = ขาว) */
function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`

interface Tone {
  saturation: number
  /** ความสว่างเชิงสัมพัทธ์เป้าหมาย (ตัวอักษรขาวต่างจากสีนี้ได้ (1.05 ÷ (ค่านี้ + 0.05)):1) */
  luminance: number
}

/** ไฮไลต์มุมบนซ้าย · สีกลางของไล่สี (ขาวต่างจากสีนี้ ≈ 5:1) · สีปลายล่างใต้ชื่อเรื่อง (ขาวต่างจากสีนี้ ≈ 17:1) */
const HIGHLIGHT: Tone = { saturation: 0.9, luminance: 0.6 }
const MID: Tone = { saturation: 0.7, luminance: 0.16 }
const DARK: Tone = { saturation: 0.55, luminance: 0.012 }

/** หาสีของเฉดนี้ที่ความสว่างเชิงสัมพัทธ์ตรงเป้า (ความสว่างเพิ่มขึ้นตามค่า lightness ของ HSL เสมอ จึงค้นหาแบบแบ่งครึ่งได้) */
function colorAt(hue: number, tone: Tone): string {
  let low = 0
  let high = 1
  for (let step = 0; step < 30; step++) {
    const lightness = (low + high) / 2
    if (relativeLuminance(hslToRgb(hue, tone.saturation, lightness)) < tone.luminance) low = lightness
    else high = lightness
  }
  return toHex(hslToRgb(hue, tone.saturation, (low + high) / 2))
}

/** สีของปกเฉดนี้: `[ไฮไลต์, กลาง, ปลายล่าง]` เป็น `#rrggbb` */
export function coverColors(hue: number): [string, string, string] {
  return [colorAt(hue, HIGHLIGHT), colorAt(hue, MID), colorAt(hue, DARK)]
}

export interface PlaceholderCover {
  /** แฮชของชื่อเรื่อง (จำนวนเต็ม 32 บิตไม่ติดลบ) — ใช้แปรผันรายละเอียดของลาย */
  seed: number
  /** เฉดสี 0–359 */
  hue: number
  motif: Motif
  colors: [string, string, string]
}

/** ปกอัตโนมัติของชื่อเรื่องนี้ (ตัดช่องว่างหัวท้ายและทำ NFC ก่อน จึงพิมพ์เว้นวรรคเกินหรือประกอบตัวอักษรต่างรูปก็ได้ปกเดิม) */
export function placeholderCover(title: string): PlaceholderCover {
  const seed = hashTitle(title)
  const hue = seed % 360
  return { seed, hue, motif: MOTIFS[(seed >>> 16) % MOTIFS.length], colors: coverColors(hue) }
}

/** พื้นหลัง CSS ของปกอัตโนมัติ: ไฮไลต์วงรีมุมบนซ้าย (โปร่ง 73%) ทับไล่สีเฉียง 170° จากสีกลางไปสีปลายล่าง */
export function coverBackground([highlight, mid, dark]: readonly [string, string, string]): string {
  return `radial-gradient(90% 60% at 28% 8%, ${highlight}bb, transparent 70%), linear-gradient(170deg, ${mid}, ${dark})`
}
