/**
 * ประมาณโทเคนและค่าใช้จ่ายก่อนสั่งแปล — เป็นการประมาณคร่าวๆ ไม่ใช่ยอดจริง (ยอดจริงดูที่แดชบอร์ดจากตาราง usage)
 * - โทเคนเข้า  ≈ ⌈ตัวอักษร ÷ 4⌉ + 1,500 ต่อตอน (1,500 = คำสั่งระบบ อภิธาน และเรื่องย่อของตอนก่อนหน้าที่แนบไปทุกตอน)
 * - โทเคนออก ≈ ⌈ตัวอักษร ÷ 4 × 1.8⌉ (คำแปลไทยกินโทเคนราว 1.8 เท่าของต้นฉบับ)
 * - ราคาเป็นต่อโทเคน 1 ล้านตัว หน่วยเงินตามที่เจ้าของกรอกในหน้าตั้งค่า
 */

const CHARS_PER_TOKEN = 4
const PROMPT_OVERHEAD_TOKENS = 1500
const OUTPUT_PER_INPUT_TOKEN = 1.8
const TOKENS_PER_PRICE_UNIT = 1_000_000

export function estimateTokens(chars: number): { input: number; output: number } {
  const sourceTokens = chars / CHARS_PER_TOKEN
  return { input: Math.ceil(sourceTokens) + PROMPT_OVERHEAD_TOKENS, output: Math.ceil(sourceTokens * OUTPUT_PER_INPUT_TOKEN) }
}

/**
 * รวมทีละตอน (`chars` = ความยาวต้นฉบับของแต่ละตอน) — ค่าคำสั่งระบบเกิดซ้ำทุกตอนและปัดเศษทีละตอน
 * `cost` เป็น `null` เมื่อไม่มีราคา (หน้าจอจะไม่แสดงค่าใช้จ่าย); ราคา 0 ได้ 0
 */
export function estimateCost(
  chars: readonly number[],
  price: { in: number; out: number } | undefined,
): { input: number; output: number; cost: number | null } {
  let input = 0
  let output = 0
  for (const count of chars) {
    const tokens = estimateTokens(count)
    input += tokens.input
    output += tokens.output
  }
  // คูณก่อนแล้วหารครั้งเดียว: หารทีละขาแล้วบวกจะได้เศษทศนิยมเกิน (เช่น 0.06899999999999999 แทน 0.069)
  const cost = price === undefined ? null : (input * price.in + output * price.out) / TOKENS_PER_PRICE_UNIT
  return { input, output, cost }
}
