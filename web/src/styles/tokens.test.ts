import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { THEMES } from "../lib/theme"

/**
 * ตรวจ `tokens.css` โดยอ่านไฟล์จริงแล้วแยกบล็อก (ไม่ใช้เบราว์เซอร์): ค่าสีตรงตาราง spec 6.5, ชุด accent ตรงตารางในแผน Task 20,
 * และความต่างสี WCAG ≥ 4.5:1 ครบทุกธีม × ทุก accent (รวมค่าเริ่มต้นที่ไม่มี `data-accent`)
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(here, "tokens.css"), "utf8")

// ───────────────────────── ตัวแยกบล็อก CSS ─────────────────────────

type Decls = Record<string, string>
interface Rule {
  selectors: string[]
  decls: Decls
}

function parseCss(source: string): Rule[] {
  const rules: Rule[] = []
  for (const m of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Decls = {}
    for (const part of m[2].split(";")) {
      const colon = part.indexOf(":")
      if (colon > 0) decls[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
    }
    rules.push({ selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean), decls })
  }
  return rules
}

const rules = parseCss(css)

function ruleFor(selector: string): Rule {
  const hit = rules.filter((r) => r.selectors.includes(selector))
  assert.equal(hit.length, 1, `ต้องมีบล็อก ${selector} หนึ่งบล็อกพอดี (เจอ ${hit.length})`)
  return hit[0]
}

/** `var(--a-dark, #8b7bff)` → ค่าจากตัวแปรช่วยของ accent ถ้ามี ไม่งั้นค่าสำรองในวงเล็บ (ค่าของธีมเอง) */
function resolve(value: string, helpers: Decls): string {
  const m = value.match(/^var\(\s*(--[\w-]+)\s*,\s*([^()]+?)\s*\)$/)
  return (m ? (helpers[m[1]] ?? m[2]) : value).toLowerCase()
}

/** โทเค็นของธีมหนึ่งเมื่อใส่ accent หนึ่งชุด (`default` = ไม่มี `data-accent`) */
function tokensFor(theme: string, accent: string): Decls {
  const helpers = accent === "default" ? {} : ruleFor(`html[data-accent="${accent}"]`).decls
  const out: Decls = {}
  for (const [name, value] of Object.entries(ruleFor(`html[data-theme="${theme}"]`).decls)) {
    if (name.startsWith("--")) out[name] = resolve(value, helpers)
  }
  return out
}

// ───────────────────────── ความต่างสี WCAG ─────────────────────────

const HEX = /^#[0-9a-f]{6}$/

function luminance(hex: string): number {
  assert.match(hex, HEX, `ต้องเป็นสี hex 6 หลัก: ${hex}`)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("ตัวคำนวณความต่างสี (ถ้าตัวนี้เพี้ยน เทสต์ที่เหลือจะผ่านโดยไม่มีความหมาย)", () => {
  test("ค่าอ้างอิงที่รู้คำตอบ: ดำ/ขาว = 21, สีเดียวกัน = 1, #767676 บนขาว ≈ 4.54 (ผ่านเกณฑ์), #777777 บนขาว ≈ 4.48 (ไม่ผ่าน)", () => {
    assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 1e-9)
    assert.ok(Math.abs(contrast("#ffffff", "#000000") - 21) < 1e-9)
    assert.equal(contrast("#123456", "#123456"), 1)
    assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.01)
    assert.ok(Math.abs(contrast("#777777", "#ffffff") - 4.48) < 0.01)
  })
})

// ───────────────────────── ค่าที่ต้องตรงตาราง ─────────────────────────

/** spec 6.5 (ตรงตัว) */
const SPEC = {
  midnight: { bg: "#0a0c12", surface: "#141824", line: "#252c40", text: "#eceef5", muted: "#8f98ae", accent: "#8b7bff", "accent-2": "#ff6f91" },
  paper: { bg: "#f4efe6", surface: "#fffcf6", line: "#e3d8c3", text: "#2a2118", muted: "#6b5d4a", accent: "#c2410c", "accent-2": "#0f766e" },
  sepia: { bg: "#f2e8d2", surface: "#f8efdb", line: "#dccfae", text: "#3b2f20", muted: "#6e604a", accent: "#9a4508", "accent-2": "#0d6e66" },
  black: { bg: "#000000", surface: "#0d0f14", line: "#1f232e", text: "#e6e8ee", muted: "#8a92a6", accent: "#8b7bff", "accent-2": "#ff6f91" },
} as const

/** ค่าเสริมที่ spec ไม่ได้กำหนด (มาจาก mockup; Black กำหนดเองในงานนี้) — ใช้เป็นพื้นของข้อความด้วย จึงอยู่ในการตรวจความต่างสีเช่นกัน */
const EXTRA = {
  midnight: { "bg-2": "#0f121a", "surface-2": "#1b2132", "accent-ink": "#0b0b14" },
  paper: { "bg-2": "#efe8db", "surface-2": "#f6efe1", "accent-ink": "#fff7ed" },
  sepia: { "bg-2": "#ecdfc3", "surface-2": "#efe3c8", "accent-ink": "#fff7ed" },
  black: { "bg-2": "#05060a", "surface-2": "#161a22", "accent-ink": "#0b0b14" },
} as const

/** เงากับฟอนต์หัวข้อของแต่ละธีม (จาก mockup; Black กำหนดเงาเองในงานนี้): Paper ใช้ตัวเซอริฟกับหัวข้อให้ความรู้สึกเป็นหนังสือ ธีมอื่นใช้ Prompt */
const LOOK = {
  midnight: { shadow: "0 12px 30px rgba(0, 0, 0, 0.45)", display: '"Prompt", "Sarabun", sans-serif' },
  paper: { shadow: "0 10px 26px rgba(80, 56, 20, 0.18)", display: '"Noto Serif Thai", "Prompt", serif' },
  sepia: { shadow: "0 10px 26px rgba(80, 56, 20, 0.18)", display: '"Prompt", "Sarabun", sans-serif' },
  black: { shadow: "0 12px 30px rgba(0, 0, 0, 0.6)", display: '"Prompt", "Sarabun", sans-serif' },
} as const

/** ชุด accent (ตารางในแผน Task 20): [accent, accent-2] */
const ACCENTS = {
  violet: { dark: ["#8b7bff", "#ff6f91"], light: ["#6d28d9", "#be185d"] },
  pink: { dark: ["#ff7aa8", "#ffb36b"], light: ["#be185d", "#9a3412"] },
  teal: { dark: ["#2dd4bf", "#60a5fa"], light: ["#0d6e66", "#1d4ed8"] },
  amber: { dark: ["#fbbf24", "#fb7185"], light: ["#92400e", "#9f1239"] },
  blue: { dark: ["#60a5fa", "#a78bfa"], light: ["#1d4ed8", "#6d28d9"] },
} as const

const DARK = ["midnight", "black"] as const
const LIGHT = ["paper", "sepia"] as const
const THEME_IDS = Object.keys(SPEC) as (keyof typeof SPEC)[]
const ACCENT_IDS = Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]

describe("ธีม", () => {
  test("ธีมในโค้ด (THEMES) ตรงกับบล็อกธีมใน tokens.css และตรงกับตารางที่ตรวจในไฟล์นี้ — เพิ่มธีมแล้วลืมเพิ่มเทสต์ไม่ได้", () => {
    const inCss = rules.flatMap((r) => r.selectors).flatMap((s) => s.match(/^html\[data-theme="([^"]+)"\]$/)?.[1] ?? [])
    assert.deepEqual([...inCss].sort(), [...THEMES].sort())
    assert.deepEqual([...THEME_IDS].sort(), [...THEMES].sort())
  })

  for (const id of THEME_IDS) {
    test(`${id}: ค่าสีตรงตาราง spec 6.5 ทุกโทเค็น และค่าเสริมตรงที่กำหนด`, () => {
      const t = tokensFor(id, "default")
      for (const [name, value] of Object.entries({ ...SPEC[id], ...EXTRA[id] })) {
        assert.equal(t[`--${name}`], value, `${id} --${name}`)
      }
    })
  }

  for (const id of THEME_IDS) {
    test(`${id}: เงา (--shadow) และฟอนต์หัวข้อ (--display) ตามแบบ`, () => {
      const { decls } = ruleFor(`html[data-theme="${id}"]`) // ค่าดิบ (tokensFor แปลงเป็นตัวพิมพ์เล็กเพื่อเทียบสี ซึ่งทำให้ชื่อฟอนต์เพี้ยน)
      assert.equal(decls["--shadow"], LOOK[id].shadow, `${id} --shadow`)
      assert.equal(decls["--display"], LOOK[id].display, `${id} --display`)
    })
  }

  test("ค่าที่ spec ระบุเป็นตัวอย่างตรงตัว: paper.bg, sepia.muted, black.bg", () => {
    assert.equal(tokensFor("paper", "default")["--bg"], "#f4efe6")
    assert.equal(tokensFor("sepia", "default")["--muted"], "#6e604a")
    assert.equal(tokensFor("black", "default")["--bg"], "#000000")
  })

  test("ทุกธีมประกาศชุดโทเค็นเดียวกัน (ไม่มีธีมไหนขาดตัวแปรที่ธีมอื่นมี)", () => {
    const names = (id: string) => Object.keys(ruleFor(`html[data-theme="${id}"]`).decls).sort()
    for (const id of THEME_IDS) assert.deepEqual(names(id), names("midnight"), id)
    for (const required of ["--bg", "--bg-2", "--surface", "--surface-2", "--line", "--text", "--muted", "--accent", "--accent-2", "--accent-ink", "--shadow", "--display"]) {
      assert.ok(names("midnight").includes(required), `ขาด ${required}`)
    }
  })

  test("ธีมมืดประกาศ color-scheme: dark และธีมสว่างประกาศ light (แถบเลื่อน/ช่องกรอกของเบราว์เซอร์กลมกลืนกับธีม)", () => {
    for (const id of DARK) assert.equal(ruleFor(`html[data-theme="${id}"]`).decls["color-scheme"], "dark", id)
    for (const id of LIGHT) assert.equal(ruleFor(`html[data-theme="${id}"]`).decls["color-scheme"], "light", id)
  })

  test("ธีมเริ่มต้นเมื่อไม่มี data-theme คือ Midnight: :root อยู่ในบล็อกเดียวกับ Midnight และไม่ซ้ำกับธีมอื่น", () => {
    assert.ok(ruleFor('html[data-theme="midnight"]').selectors.includes(":root"))
    assert.equal(rules.filter((r) => r.selectors.includes(":root")).length, 1)
    assert.deepEqual(rules.find((r) => r.selectors.includes(":root"))!.selectors.sort(), [":root", 'html[data-theme="midnight"]'])
  })

})

describe("ชุด accent", () => {
  test("accent ที่มีใน CSS ตรงกับตารางที่ตรวจ (ไม่มีบล็อก default เพราะ default = ไม่ใส่ data-accent)", () => {
    const inCss = rules.flatMap((r) => r.selectors).flatMap((s) => s.match(/^html\[data-accent="([^"]+)"\]$/)?.[1] ?? [])
    assert.deepEqual([...inCss].sort(), [...ACCENT_IDS].sort())
  })

  for (const id of ACCENT_IDS) {
    test(`${id}: ตัวแปรช่วยตรงตาราง (มืด ${ACCENTS[id].dark.join(" / ")} · สว่าง ${ACCENTS[id].light.join(" / ")})`, () => {
      const helpers = ruleFor(`html[data-accent="${id}"]`).decls
      assert.deepEqual(Object.keys(helpers).sort(), ["--a-dark", "--a-light", "--a2-dark", "--a2-light"])
      assert.equal(helpers["--a-dark"].toLowerCase(), ACCENTS[id].dark[0])
      assert.equal(helpers["--a2-dark"].toLowerCase(), ACCENTS[id].dark[1])
      assert.equal(helpers["--a-light"].toLowerCase(), ACCENTS[id].light[0])
      assert.equal(helpers["--a2-light"].toLowerCase(), ACCENTS[id].light[1])
    })

    test(`${id}: ธีมมืด (Midnight, Black) ใช้ค่ามืด · ธีมสว่าง (Paper, Sepia) ใช้ค่าสว่าง · สีอื่นของธีมไม่ถูกแตะ`, () => {
      for (const theme of DARK) {
        const t = tokensFor(theme, id)
        assert.equal(t["--accent"], ACCENTS[id].dark[0], `${theme} accent`)
        assert.equal(t["--accent-2"], ACCENTS[id].dark[1], `${theme} accent-2`)
      }
      for (const theme of LIGHT) {
        const t = tokensFor(theme, id)
        assert.equal(t["--accent"], ACCENTS[id].light[0], `${theme} accent`)
        assert.equal(t["--accent-2"], ACCENTS[id].light[1], `${theme} accent-2`)
      }
      for (const theme of THEME_IDS) {
        const t = tokensFor(theme, id)
        for (const name of ["bg", "surface", "line", "text", "muted"] as const) assert.equal(t[`--${name}`], SPEC[theme][name], `${theme} ${id} --${name}`)
        assert.equal(t["--accent-ink"], EXTRA[theme]["accent-ink"], `${theme} ${id} --accent-ink`)
      }
    })
  }

  test("ปุ่มเลือกสีในหน้าตั้งค่า (.ad-swatch[data-accent]) ใช้บล็อกตัวแปรเดียวกับ html[data-accent] ทุกชุด — ไม่มีค่าสีซ้ำ", () => {
    for (const id of ACCENT_IDS) {
      assert.ok(ruleFor(`html[data-accent="${id}"]`).selectors.includes(`.ad-swatch[data-accent="${id}"]`), id)
    }
    assert.equal(rules.filter((r) => r.selectors.some((sel) => sel.startsWith(".ad-swatch"))).length, ACCENT_IDS.length)
  })

  test("ไม่ใส่ accent (default): แต่ละธีมใช้สี accent ของธีมเองตามตาราง spec — ไม่ใช่สีของชุดใดชุดหนึ่ง", () => {
    for (const theme of THEME_IDS) {
      const t = tokensFor(theme, "default")
      assert.equal(t["--accent"], SPEC[theme].accent)
      assert.equal(t["--accent-2"], SPEC[theme]["accent-2"])
    }
  })
})

// ───────────────────────── ความต่างสี ─────────────────────────

const MIN = 4.5
/**
 * ข้อความ --text/--muted วางได้บนพื้นทั้งสี่แบบ · ข้อความสี accent วางได้บน --bg, --surface, --surface-2 เท่านั้น
 * (--bg-2 เป็นพื้นแถบที่เข้มกว่า --bg ในธีมสว่าง: Paper ที่ไม่เลือก accent ได้ 4.25:1 / 4.49:1 — ห้ามวางข้อความสี accent บนพื้นนี้)
 */
const FOREGROUNDS = [
  { fg: "--text", on: ["--bg", "--bg-2", "--surface", "--surface-2"] },
  { fg: "--muted", on: ["--bg", "--bg-2", "--surface", "--surface-2"] },
  { fg: "--accent", on: ["--bg", "--surface", "--surface-2"] },
  { fg: "--accent-2", on: ["--bg", "--surface", "--surface-2"] },
] as const

describe(`ความต่างสี WCAG ≥ ${MIN}:1 ทุกธีม × ทุก accent`, () => {
  for (const theme of THEME_IDS) {
    for (const accent of ["default", ...ACCENT_IDS]) {
      test(`${theme} · ${accent}`, () => {
        const t = tokensFor(theme, accent)
        const failures: string[] = []
        const check = (label: string, fg: string, bg: string) => {
          const ratio = contrast(fg, bg)
          if (!(ratio >= MIN)) failures.push(`${label} ${fg} บน ${bg} = ${ratio.toFixed(3)}`)
        }
        for (const { fg, on } of FOREGROUNDS) for (const bg of on) check(`${fg} บน ${bg}`, t[fg], t[bg])
        check("--accent-ink บน --accent", t["--accent-ink"], t["--accent"])
        check("--accent-ink บน --accent-2 (ปลายอีกด้านของโลโก้ไล่สี)", t["--accent-ink"], t["--accent-2"])
        assert.deepEqual(failures, [])
      })
    }
  }
})
