import type { Mode } from "./types.js"

/** ขนาดชิ้นต่อการเรียกหนึ่งครั้ง (จำนวนตัวอักษรของต้นฉบับ) ตาม spec 8.3 */
export const CHUNK_SIZE: Record<Mode, number> = {
  translate: 5000,
  story: 6000,
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

/** ตัดข้อความ s (ยาวกว่า max) ออกหนึ่งชิ้นที่ยาวไม่เกิน max: ที่ช่องว่างสุดท้ายถ้าอยู่เลยครึ่ง max ไม่งั้นที่ max */
function cutPiece(s: string, max: number): [piece: string, rest: string] {
  const space = s.lastIndexOf(" ", max)
  if (space > max / 2) return [s.slice(0, space).trimEnd(), s.slice(space + 1).trimStart()]
  // ตัดกลางคู่ surrogate (อีโมจิ ฯลฯ) ไม่ได้ จะเหลือครึ่งตัวที่ส่งต่อเป็นข้อความไม่ได้
  const cut = max > 1 && isHighSurrogate(s.charCodeAt(max - 1)) ? max - 1 : max
  return [s.slice(0, cut), s.slice(cut)]
}

/** ตัดย่อหน้าที่ยาวเกิน max เป็นชิ้นย่อยตามประโยค; ประโยคเดียวที่ยังยาวเกินตัดต่อที่ช่องว่าง */
function hardSplit(paragraph: string, max: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?。！？”"])\s+/)
  const out: string[] = []
  let cur = ""
  for (let s of sentences) {
    while (s.length > max) {
      if (cur) {
        out.push(cur)
        cur = ""
      }
      const [piece, rest] = cutPiece(s, max)
      out.push(piece)
      s = rest
    }
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur)
      cur = s
    } else {
      cur = cur ? `${cur} ${s}` : s
    }
  }
  if (cur) out.push(cur)
  return out
}

/** แบ่งต้นฉบับเป็นชิ้นตามย่อหน้า ไม่ให้ยาวเกิน max ตัวอักษร (ย่อหน้าในชิ้นคั่นด้วยบรรทัดว่างหนึ่งบรรทัด) */
export function splitChunks(text: string, max: number): string[] {
  if (!Number.isInteger(max) || max < 1) throw new RangeError(`max ต้องเป็นจำนวนเต็มบวก (ได้ ${max})`)
  const paras = text
    .split(/[\r\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > max ? hardSplit(p, max) : [p]))

  const chunks: string[] = []
  let cur: string[] = []
  let len = 0 // ความยาวของ cur นับตัวคั่น "\n\n" ท้ายทุกย่อหน้า ดังนั้น len + p.length คือความยาวเมื่อเติม p
  for (const p of paras) {
    if (len + p.length > max && cur.length) {
      chunks.push(cur.join("\n\n"))
      cur = []
      len = 0
    }
    cur.push(p)
    len += p.length + 2
  }
  if (cur.length) chunks.push(cur.join("\n\n"))
  return chunks
}
