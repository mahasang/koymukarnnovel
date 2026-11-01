/**
 * สร้างตารางให้เจ้าของตรวจคำแปล: คีย์ | ไทย | English | ລາວ (markdown)
 * ฟังก์ชันข้อความถูกเรียกโดยใส่เลข 7 ในทุกช่อง เพื่อให้เห็นรูปประโยคจริง
 *
 *   node --import tsx web/scripts/i18n-review.mts > docs/superpowers/verification/i18n-review.md
 */
import { MESSAGES } from "../src/i18n/messages"

type Flat = Map<string, string>

function flatten(node: unknown, prefix: string, out: Flat): Flat {
  if (typeof node === "string") out.set(prefix, node)
  else if (typeof node === "function") {
    const fn = node as (...args: unknown[]) => unknown
    out.set(prefix, String(fn(...Array.from({ length: fn.length }, () => 7))))
  }
  else if (Array.isArray(node)) node.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out))
  else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) flatten(value, prefix === "" ? key : `${prefix}.${key}`, out)
  }
  return out
}

const cell = (text: string | undefined) => (text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")

const th = flatten(MESSAGES.th, "", new Map())
const en = flatten(MESSAGES.en, "", new Map())
const lo = flatten(MESSAGES.lo, "", new Map())

const lines = [
  "# ตารางตรวจคำแปล UI หน้าบ้าน (ไทย / English / ລາວ)",
  "",
  "สร้างจาก `web/src/i18n/{th,en,lo}.ts` — แก้คำแปลที่ไฟล์เหล่านั้นแล้วสร้างตารางใหม่ (ข้อความแบบฟังก์ชันแสดงผลเมื่อใส่เลข 7 ในทุกช่อง)",
  "",
  "| คีย์ | ไทย | English | ລາວ |",
  "| --- | --- | --- | --- |",
]
for (const [key, value] of th) lines.push(`| \`${key}\` | ${cell(value)} | ${cell(en.get(key))} | ${cell(lo.get(key))} |`)
console.log(lines.join("\n"))
