import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

/**
 * `base.css` ข้อกำหนดที่ spec 6.5 ระบุไว้และพังเงียบๆ ได้ง่าย: ฟอนต์ self-host เฉพาะน้ำหนัก/subset ที่ใช้ (ไทย + ละติน),
 * focus ที่มองเห็นชัด, `prefers-reduced-motion`, ข้อความและพื้นใช้โทเค็นของธีม
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(here, "base.css"), "utf8")
/** ไม่มีคอมเมนต์ และช่องว่าง/ขึ้นบรรทัดใหม่ทุกชนิดยุบเหลือช่องว่างเดียว (จับ selector แบบหลายบรรทัดได้) */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")

/** เนื้อในวงเล็บปีกกาของกฎแรกที่ selector ตรง `selector` (ไม่รองรับกฎซ้อน) */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const m = stripped.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^{}]*)\\}`))
  assert.ok(m, `ไม่พบกฎ ${selector}`)
  return m[1]
}

test("ฟอนต์: นำเข้าจาก @fontsource เฉพาะ subset ไทย+ละติน และเฉพาะน้ำหนักที่ใช้ (Prompt 500/600/700 · Sarabun 400/500/600 · Noto Serif Thai 400/600/700 · Noto Sans Lao ลาว 400/500/600/700)", () => {
  const imports = [...stripped.matchAll(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g)].map((m) => m[1]).sort()
  const expected = [
    ...[500, 600, 700].flatMap((w) => ["thai", "latin"].map((s) => `@fontsource/prompt/${s}-${w}.css`)),
    ...[400, 500, 600].flatMap((w) => ["thai", "latin"].map((s) => `@fontsource/sarabun/${s}-${w}.css`)),
    ...[400, 600, 700].flatMap((w) => ["thai", "latin"].map((s) => `@fontsource/noto-serif-thai/${s}-${w}.css`)),
    ...[400, 500, 600, 700].map((w) => `@fontsource/noto-sans-lao/lao-${w}.css`),
  ].sort()
  assert.deepEqual(imports, expected)
})

test("@import อยู่บนสุดของไฟล์ก่อนกฎอื่น (ไม่งั้นเบราว์เซอร์/Vite ทิ้ง @import ทั้งหมด ฟอนต์หาย)", () => {
  const firstRule = stripped.search(/[^@\s][^{;]*\{/)
  const lastImport = stripped.lastIndexOf("@import")
  assert.ok(lastImport >= 0 && firstRule > lastImport, `กฎแรกอยู่ที่ ${firstRule} แต่ @import สุดท้ายอยู่ที่ ${lastImport}`)
})

test("ข้อความไทยใช้ Sarabun เป็นฟอนต์เนื้อหา, หัวข้อใช้ --display (Prompt ตามธีม), มี --font-serif สำหรับตัวเลือกอ่านนิยาย", () => {
  assert.match(body(":root"), /--font-body:\s*["']Sarabun["']/)
  assert.match(body(":root"), /--font-serif:\s*["']Noto Serif Thai["']/)
  assert.match(body("body"), /font-family:\s*var\(--font-body\)/)
  assert.match(body("h1, h2, h3, h4, h5, h6"), /font-family:\s*var\(--display\)/)
})

test("พื้นและข้อความของหน้าใช้โทเค็นของธีม (--bg / --text) ไม่ใช่ค่าสีตายตัว", () => {
  const b = body("body")
  assert.match(b, /background:\s*var\(--bg\)/)
  assert.match(b, /color:\s*var\(--text\)/)
  assert.doesNotMatch(b, /#[0-9a-f]{3,8}\b/i)
})

test("focus ที่มองเห็นชัด: :focus-visible วงขอบหนา ≥ 2px สี --accent มีระยะห่าง และไม่มีที่ไหนปิด outline", () => {
  const f = body(":focus-visible")
  assert.match(f, /outline:\s*([2-9]|\d{2,})px\s+solid\s+var\(--accent\)/)
  assert.match(f, /outline-offset:\s*\d+px/)
  assert.doesNotMatch(stripped, /outline:\s*(none|0)\b/)
})

test("prefers-reduced-motion: reduce ปิดแอนิเมชัน/ทรานซิชัน/เลื่อนนุ่ม และเลื่อนนุ่มเปิดเฉพาะเมื่อผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว", () => {
  const reduce = stripped.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/)
  assert.ok(reduce, "ไม่พบ @media (prefers-reduced-motion: reduce)")
  assert.match(reduce[1], /animation-duration:\s*0\.01ms\s*!important/)
  assert.match(reduce[1], /animation-iteration-count:\s*1\s*!important/)
  assert.match(reduce[1], /transition-duration:\s*0\.01ms\s*!important/)
  assert.match(reduce[1], /scroll-behavior:\s*auto\s*!important/)
  const smooth = stripped.match(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?scroll-behavior:\s*smooth/)
  assert.ok(smooth, "เลื่อนนุ่มต้องอยู่ใน no-preference เท่านั้น")
  assert.equal((stripped.match(/scroll-behavior:\s*smooth/g) ?? []).length, 1)
})

test("รีเซ็ตพื้นฐาน: border-box ทุกอย่าง, ซ่อน [hidden] จริง, ปุ่ม/ช่องกรอกสืบทอดฟอนต์, ภาพไม่ล้นกรอบ, มี .sr-only สำหรับป้ายที่อ่านได้เฉพาะโปรแกรมอ่านหน้าจอ", () => {
  assert.match(body("*, *::before, *::after"), /box-sizing:\s*border-box/)
  assert.match(body("[hidden]"), /display:\s*none\s*!important/)
  assert.match(body("button, input, select, textarea"), /font:\s*inherit/)
  assert.match(body("img, svg, video"), /max-width:\s*100%/)
  assert.match(body(".sr-only"), /position:\s*absolute/)
  assert.match(body(".sr-only"), /clip(-path)?:/)
})

/** ประกาศของกฎ (ชื่อ → ค่า) จากเนื้อกฎที่ `body` ได้ */
function declarations(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of body(selector).split(";")) {
    const colon = part.indexOf(":")
    if (colon > 0) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
  }
  return out
}

/**
 * ค่าที่ออกแบบไว้ของกฎพื้นฐานทุกข้อ (ตรงตามไฟล์ — ใครแก้ต้องแก้ที่นี่ด้วยเจตนา)
 * ข้อความไทยพึ่ง Sarabun กับ line-height 1.6 (สระบน/วรรณยุกต์ต้องมีที่ว่าง) · .sr-only คือสูตรมาตรฐานที่ทุกบรรทัดมีหน้าที่
 */
const RULES: Record<string, Record<string, string>> = {
  ":root": { "--font-body": '"Sarabun", "Prompt", "Noto Sans Lao", system-ui, sans-serif', "--font-serif": '"Noto Serif Thai", "Sarabun", serif' },
  "*, *::before, *::after": { "box-sizing": "border-box" },
  "*": { margin: "0", padding: "0" },
  html: { "-webkit-text-size-adjust": "100%", "text-size-adjust": "100%", "-webkit-font-smoothing": "antialiased" },
  body: { background: "var(--bg)", color: "var(--text)", "font-family": "var(--font-body)", "font-size": "16px", "line-height": "1.6" },
  "h1, h2, h3, h4, h5, h6": { "font-family": "var(--display)", "line-height": "1.25" },
  a: { color: "inherit", "text-decoration": "none" },
  "img, svg, video": { "max-width": "100%" },
  svg: { flex: "none" },
  "button, input, select, textarea": { font: "inherit", color: "inherit" },
  "[hidden]": { display: "none !important" },
  "::selection": { background: "color-mix(in srgb, var(--accent) 35%, transparent)" },
  ":focus-visible": { outline: "2px solid var(--accent)", "outline-offset": "2px" },
  ".sr-only": {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    "clip-path": "inset(50%)",
    "white-space": "nowrap",
    border: "0",
  },
}

for (const [selector, expected] of Object.entries(RULES)) {
  test(`กฎ ${selector} มีประกาศครบตามที่ออกแบบ (ไม่ขาด ไม่เกิน ค่าไม่เพี้ยน)`, () => {
    assert.deepEqual(declarations(selector), expected)
  })
}
