import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseCss, type CssRule } from "../testing/css"

/**
 * ตรวจ `admin.css` โดยอ่านไฟล์จริง (ไม่ใช้เบราว์เซอร์): คลาสในโค้ดหลังบ้านกับสไตล์ตรงกันทั้งสองทิศ, สีมาจากตัวแปร, สีแดงผ่านความต่างสีทุกธีม,
 * กติกาฟอนต์/โฟกัสเหมือนหน้าบ้าน, และจุดตัดจอเดียวของหลังบ้าน (899px) ผูกกับ matchMedia ใน Layout.tsx
 * ส่วนหน้าตาที่เห็นด้วยตา (ระยะห่าง สีเมื่อเอาเมาส์ชี้ ฯลฯ) ตรวจด้วยภาพจากเบราว์เซอร์จริง ไม่ปักค่าในเทสต์นี้
 */

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), "utf8")
const adminCss = read("./admin.css")
const rules = parseCss(adminCss)
const publicRules = parseCss(read("./public.css"))
const baseRules = parseCss(read("./base.css"))
const tokenRules = parseCss(read("./tokens.css"))

const rulesFor = (selector: string, media: string | null = null) => rules.filter((rule) => rule.selectors.includes(selector) && rule.media === media)
/** ค่า declaration ล่าสุดของ selector ที่ตรงตัว (ในเงื่อนไข media ที่ระบุ) — กฎหลังชนะกฎก่อนเหมือนเบราว์เซอร์ */
const declOf = (selector: string, property: string, media: string | null = null) =>
  rulesFor(selector, media)
    .map((rule) => rule.decls[property])
    .filter((value): value is string => value !== undefined)
    .at(-1)

const MOBILE = "(max-width: 899px)"

// ───────────────────────── คลาสในโค้ด ↔ คลาสใน CSS ─────────────────────────

const SRC = here("../")
/** ไฟล์ที่ใช้เฉพาะในหลังบ้าน: ทุกอย่างใต้ admin/ และกล่องยืนยัน (public.test.ts ข้ามไฟล์เหล่านี้) */
const ADMIN_ONLY_COMPONENTS = ["components/ConfirmDialog.tsx"]
const adminFiles = [
  ...readdirSync(`${SRC}admin`, { recursive: true, encoding: "utf8" })
    .map((file) => `admin/${file.replaceAll("\\", "/")}`)
    .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx")),
  ...ADMIN_ONLY_COMPONENTS,
]

function classNameExpressions(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (match[1] !== undefined) {
      found.push(JSON.stringify(match[1]))
      continue
    }
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let end = start
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth++
      else if (source[end] === "}") depth--
      end++
    }
    found.push(source.slice(start, end - 1))
  }
  return found
}

const DYNAMIC = "@dynamic@"
function classTokens(expression: string): string[] {
  const tokens: string[] = []
  for (const literal of expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const raw = literal[1] ?? literal[2] ?? literal[3] ?? ""
    for (const token of raw.replace(/\$\{[^}]*\}/g, DYNAMIC).split(/\s+/)) if (token !== "" && !token.includes(DYNAMIC)) tokens.push(token)
  }
  return tokens
}

const classesIn = (list: CssRule[]) => new Set(list.flatMap((rule) => rule.selectors).flatMap((selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1])))
const usedClasses = new Set(adminFiles.flatMap((file) => classNameExpressions(readFileSync(`${SRC}${file}`, "utf8")).flatMap(classTokens)))
const adminDefined = classesIn(rules)
const sharedDefined = new Set([...classesIn(publicRules), ...classesIn(baseRules)])

/**
 * คลาสที่หลังบ้านอ้างใน CSS แต่ถูกใส่โดยโค้ดนอก className= ของไฟล์หลังบ้าน (NavLink ที่รับฟังก์ชัน, คอมโพเนนต์กลาง Chip/Switch ที่หลังบ้านปรับหน้าตาเฉพาะในหน้าของตัวเอง)
 * — ยืนยันด้วยข้อความในโค้ดต้นทางด้านล่าง
 */
const ASSEMBLED: Array<{ file: string; literal: string; classes: string[] }> = [
  { file: "admin/Layout.tsx", literal: '"ad-it on"', classes: ["on"] },
  { file: "components/Chip.tsx", literal: '"fchip on"', classes: ["fchip"] },
  { file: "components/Switch.tsx", literal: 'className="switch-label"', classes: ["switch-label"] },
]

describe("คลาสในโค้ดหลังบ้านกับ admin.css ตรงกัน", () => {
  test("พบไฟล์หลังบ้านและอ่านคลาสออกมาได้ (ตัวอ่านไม่ได้ทำงานว่างเปล่า)", () => {
    assert.ok(adminFiles.length >= 6, `พบ ${adminFiles.length} ไฟล์: ${adminFiles.join(", ")}`)
    for (const file of ["admin/Layout.tsx", "admin/Login.tsx", "admin/AdminShell.tsx", "components/ConfirmDialog.tsx"]) assert.ok(adminFiles.includes(file), file)
    for (const name of ["ad-shell", "ad-side", "ad-banner", "ad-login-card", "ad-dialog", "btn", "danger", "logo"]) assert.ok(usedClasses.has(name), name)
  })

  test("คลาสที่โค้ดหลังบ้านใช้ทุกตัวมีสไตล์ใน admin.css / public.css / base.css (พิมพ์ผิดแล้วเงียบ ต้องไม่หลุด)", () => {
    const missing = [...usedClasses].filter((name) => !adminDefined.has(name) && !sharedDefined.has(name))
    assert.deepEqual(missing, [])
  })

  test("สไตล์ใน admin.css ทุกคลาสมีโค้ดหลังบ้านใช้ (ไม่มีสไตล์ตกค้าง)", () => {
    const used = new Set([...usedClasses, ...ASSEMBLED.flatMap((a) => a.classes)])
    assert.deepEqual(
      [...adminDefined].filter((name) => !used.has(name)),
      [],
    )
  })

  test("คลาสที่ประกอบนอก className= ยังมีข้อความจริงในโค้ดต้นทาง (รายการไม่เน่า)", () => {
    for (const { file, literal, classes } of ASSEMBLED) {
      assert.ok(readFileSync(`${SRC}${file}`, "utf8").includes(literal), `${file} ไม่มี ${literal} แล้ว`)
      for (const name of classes) assert.ok(adminDefined.has(name), name)
    }
  })

  test("public.test.ts ข้ามไฟล์หลังบ้านด้วยรายการเดียวกับที่นี่ (ไม่ปล่อยให้ตรวจซ้ำ/คลาดกัน)", () => {
    const publicTest = read("./public.test.ts")
    assert.match(publicTest, /file\.startsWith\("admin\/"\)/)
    for (const file of ADMIN_ONLY_COMPONENTS) assert.ok(publicTest.includes(`"${file}"`), file)
  })
})

// ───────────────────────── ตัวแปรและสี ─────────────────────────

describe("ตัวแปร CSS และสี", () => {
  const defined = new Set([...tokenRules, ...baseRules, ...publicRules, ...rules].flatMap((rule) => Object.keys(rule.decls).filter((name) => name.startsWith("--"))))

  test("ทุก var(--ชื่อ) ใน admin.css มีการกำหนดค่าจริง (พิมพ์ผิดแล้วสีหายเงียบ)", () => {
    const used = [...adminCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
    assert.ok(used.length > 40, `พบการใช้ตัวแปร ${used.length} ที่`)
    assert.deepEqual(
      [...new Set(used)].filter((name) => !defined.has(name)),
      [],
    )
  })

  test("ไม่มี !important", () => {
    assert.equal(/!important/.test(adminCss.replace(/\/\*[\s\S]*?\*\//g, "")), false) // ไม่นับในคอมเมนต์
  })

  test("ไม่มีสีตายตัว (#hex, rgb(), hsl()) นอกตัวแปร --ad-* ที่ประกาศไว้ต้นไฟล์ — ที่เหลืออ้างตัวแปรของธีมเสมอ ธีมไหนก็ได้สีถูก", () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
    for (const rule of rules) {
      for (const [property, value] of Object.entries(rule.decls)) {
        if (property.startsWith("--ad-")) continue
        assert.equal(literal.test(value), false, `${rule.selectors.join(", ")} { ${property}: ${value} }`)
      }
    }
    for (const name of ["--ad-danger", "--ad-danger-ink", "--ad-danger-text", "--ad-warn-text", "--ad-ok-text", "--ad-scrim"]) assert.ok(rulesFor(":root").some((rule) => rule.decls[name] !== undefined), name)
  })

  test("color ของทุกกฎมาจาก var() / inherit / color-mix ของตัวแปร", () => {
    const withColor = rules.filter((rule) => rule.decls.color !== undefined)
    assert.ok(withColor.length >= 15, `พบ ${withColor.length} กฎ`)
    for (const rule of withColor) {
      const color = rule.decls.color ?? ""
      assert.ok(color.startsWith("var(") || color === "inherit" || (color.startsWith("color-mix(") && color.includes("var(--")), `${rule.selectors.join(", ")}: ${color}`)
    }
  })

  test("ข้อความสี accent ไม่วางบน --bg-2 (พื้นเมนูข้าง) — ไอคอนของรายการที่เปิดอยู่เป็นข้อยกเว้นเพราะอยู่บนพื้น --surface-2 ของรายการเอง", () => {
    const accentText = rules.filter((rule) => /var\(--accent(?:-2)?\s*[,)]/.test(rule.decls.color ?? ""))
    assert.deepEqual(accentText.flatMap((rule) => rule.selectors).sort(), [".ad-banner svg", ".ad-it.on svg"])
    assert.equal(declOf(".ad-it.on", "background"), "var(--surface-2)")
    assert.equal(declOf(".ad-side", "background"), "var(--bg-2)")
    // แถบเตือนผสม accent เข้ากับ --surface (ไม่ใช่ --bg-2) ข้อความข้างในเป็นสี --text
    assert.match(declOf(".ad-banner", "background") ?? "", /^color-mix\(in srgb, var\(--accent\) \d+%, var\(--surface\)\)$/)
    assert.equal(declOf(".ad-banner", "color"), "var(--text)")
  })

  test("พื้นที่ระบายด้วย --accent ล้วน (ไม่ใช่การผสมจาง) ต้องใช้ข้อความสี --accent-ink", () => {
    const solid = (value: string | undefined) => /^var\(--accent(?:-2)?\)$/.test(value ?? "") || /^linear-gradient\(.*var\(--accent/.test(value ?? "")
    for (const rule of rules.filter((r) => solid(r.decls.background) || solid(r.decls["background-color"]))) assert.equal(rule.decls.color, "var(--accent-ink)", rule.selectors.join(", "))
  })
})

// ───────────────────────── ความต่างสีของสีแดง (WCAG) ─────────────────────────

/** ตัวช่วยคำนวณความต่างสีจากค่า #rrggbb */
const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const rgb = (hex: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  assert.ok(m, `ต้องเป็น #rrggbb: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
/** ผสม `top` ร้อยละ `pct` ทับ `bottom` (เหมือน color-mix(in srgb, top pct%, bottom)) */
const mix = (top: string, pct: number, bottom: string) => {
  const t = rgb(top)
  const b = rgb(bottom)
  const out = t.map((v, i) => Math.round((v * pct + b[i]! * (100 - pct)) / 100))
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

describe("สีแดงของหลังบ้านผ่านความต่างสี ≥ 4.5:1 ทุกธีม", () => {
  const THEMES = ["midnight", "paper", "sepia", "black"] as const
  const decl = (selector: string, property: string) => {
    const hit = tokenRules.filter((rule) => rule.selectors.includes(selector) && rule.decls[property] !== undefined)
    assert.equal(hit.length, 1, `${selector} ${property}`)
    return hit[0]!.decls[property]!
  }
  const adminToken = (name: string, theme: string) => {
    const override = rules.filter((rule) => rule.selectors.includes(`html[data-theme="${theme}"]`) && rule.decls[name] !== undefined).at(-1)
    const base = rules.filter((rule) => rule.selectors.includes(":root") && rule.decls[name] !== undefined).at(-1)
    return (override ?? base)!.decls[name]!
  }
  const surfaces = (theme: string) => {
    const selector = theme === "midnight" ? ":root" : `html[data-theme="${theme}"]`
    return { bg: decl(selector, "--bg"), bg2: decl(selector, "--bg-2"), surface: decl(selector, "--surface"), surface2: decl(selector, "--surface-2") }
  }

  test("ข้อความแดง (--ad-danger-text) บนพื้นทุกแบบที่มันไปวาง: --bg-2 (ข้อความเตือนในเมนูข้าง), --surface (ล็อกอิน กล่องยืนยัน), --bg", () => {
    for (const theme of THEMES) {
      const color = adminToken("--ad-danger-text", theme)
      const s = surfaces(theme)
      for (const [name, bg] of Object.entries({ bg: s.bg, bg2: s.bg2, surface: s.surface, surface2: s.surface2 })) assert.ok(contrast(color, bg) >= 4.5, `${theme}: ${color} บน ${name} ${bg} = ${contrast(color, bg).toFixed(2)}`)
    }
  })

  test("ข้อความแดงในแถบเตือน (พื้น = accent 12% ผสม --surface) ผ่านทุกธีม × ทุกชุด accent", () => {
    const pct = Number(/color-mix\(in srgb, var\(--accent\) (\d+)%/.exec(declOf(".ad-banner", "background") ?? "")![1])
    assert.ok(pct >= 5 && pct <= 20, String(pct))
    const accents = ["violet", "pink", "teal", "amber", "blue"]
    for (const theme of THEMES) {
      const dark = theme === "midnight" || theme === "black"
      const selector = theme === "midnight" ? ":root" : `html[data-theme="${theme}"]`
      const themeAccent = /var\(--a(?:-dark|-light), (#[0-9a-f]{6})\)/i.exec(decl(selector, "--accent"))![1]!
      const candidates = [themeAccent, ...accents.map((a) => decl(`html[data-accent="${a}"]`, dark ? "--a-dark" : "--a-light"))]
      const tint = candidates.map((accent) => mix(accent, pct, surfaces(theme).surface))
      for (const bg of tint) assert.ok(contrast(adminToken("--ad-danger-text", theme), bg) >= 4.5, `${theme}: แดงบน ${bg} = ${contrast(adminToken("--ad-danger-text", theme), bg).toFixed(2)}`)
    }
  })

  test("ข้อความเตือน (--ad-warn-text) และสำเร็จ (--ad-ok-text) ผ่าน ≥ 4.5:1 บนพื้นธีมทุกแบบ และบนพื้นป้ายที่ผสมสีนั้นเอง 14% กับ --surface", () => {
    for (const token of ["--ad-warn-text", "--ad-ok-text", "--ad-danger-text"]) {
      for (const theme of THEMES) {
        const color = adminToken(token, theme)
        const s = surfaces(theme)
        for (const [name, bg] of Object.entries({ bg: s.bg, bg2: s.bg2, surface: s.surface, surface2: s.surface2 })) assert.ok(contrast(color, bg) >= 4.5, `${token} ${theme}: ${color} บน ${name} ${bg} = ${contrast(color, bg).toFixed(2)}`)
        const pill = mix(color, 14, s.surface)
        assert.ok(contrast(color, pill) >= 4.5, `${token} ${theme}: ${color} บนป้าย ${pill} = ${contrast(color, pill).toFixed(2)}`)
      }
    }
    // พื้นป้ายในโค้ดผสมที่ 14% จริง (ตัวเลขที่เทสต์ข้างบนใช้ต้องตรงกับ CSS)
    for (const tone of ["warn", "ok", "fail"]) assert.match(declOf(`.ad-pill[data-tone="${tone}"]`, "background") ?? "", /^color-mix\(in srgb, var\(--ad-(?:warn|ok|danger)-text\) 14%, var\(--surface\)\)$/, tone)
    assert.match(declOf(".ad-retry", "background") ?? "", /^color-mix\(in srgb, var\(--ad-danger-text\) 14%, var\(--surface\)\)$/)
  })

  test("ธีมสว่างใช้สีเตือน/สำเร็จเข้ม ธีมมืดใช้สีอ่อน (เหมือนสีแดง) และธีมที่เป็นชนิดเดียวกันได้สีเดียวกัน", () => {
    for (const token of ["--ad-warn-text", "--ad-ok-text"]) {
      assert.notEqual(adminToken(token, "paper"), adminToken(token, "midnight"))
      assert.equal(adminToken(token, "paper"), adminToken(token, "sepia"))
      assert.equal(adminToken(token, "midnight"), adminToken(token, "black"))
    }
  })

  test("ข้อความในรายการ \"เริ่มต้นใช้งาน\" ที่เน้นสี (พื้น = accent 12% ผสม --surface): ตัวหนังสือสี --text ผ่านทุกธีม × ทุกชุด accent", () => {
    assert.match(declOf('.ad-onboard-item[data-state="warn"]', "background") ?? "", /^color-mix\(in srgb, var\(--accent\) 12%, var\(--surface\)\)$/)
    assert.equal(declOf('.ad-onboard-item[data-state="warn"] .ad-onboard-hint', "color"), "var(--text)")
    const accents = ["violet", "pink", "teal", "amber", "blue"]
    for (const theme of THEMES) {
      const dark = theme === "midnight" || theme === "black"
      const selector = theme === "midnight" ? ":root" : `html[data-theme="${theme}"]`
      const themeAccent = /var\(--a(?:-dark|-light), (#[0-9a-f]{6})\)/i.exec(decl(selector, "--accent"))![1]!
      const candidates = [themeAccent, ...accents.map((a) => decl(`html[data-accent="${a}"]`, dark ? "--a-dark" : "--a-light"))]
      for (const accent of candidates) {
        const bg = mix(accent, 12, surfaces(theme).surface)
        assert.ok(contrast(decl(selector, "--text"), bg) >= 4.5, `${theme}: --text บน ${bg}`)
      }
    }
  })

  test("ปุ่มอันตราย: ตัวอักษรขาวบนพื้นแดง ≥ 4.5:1 และทั้งสองไม่เปลี่ยนตามธีม (ปุ่มแดงต้องแดงเสมอ)", () => {
    assert.ok(contrast(adminToken("--ad-danger-ink", "midnight"), adminToken("--ad-danger", "midnight")) >= 4.5)
    for (const theme of THEMES) {
      assert.equal(adminToken("--ad-danger", theme), adminToken("--ad-danger", "midnight"))
      assert.equal(adminToken("--ad-danger-ink", theme), adminToken("--ad-danger-ink", "midnight"))
    }
    assert.equal(declOf(".btn.danger", "background"), "var(--ad-danger)")
    assert.equal(declOf(".btn.danger", "color"), "var(--ad-danger-ink)")
  })

  test("ธีมสว่าง (paper, sepia) ใช้แดงเข้ม ธีมมืด (midnight, black) ใช้แดงอ่อน", () => {
    assert.notEqual(adminToken("--ad-danger-text", "paper"), adminToken("--ad-danger-text", "midnight"))
    assert.equal(adminToken("--ad-danger-text", "paper"), adminToken("--ad-danger-text", "sepia"))
    assert.equal(adminToken("--ad-danger-text", "midnight"), adminToken("--ad-danger-text", "black"))
  })
})

// ───────────────────────── ฟอนต์ โฟกัส ─────────────────────────

describe("ฟอนต์และน้ำหนักตัวอักษรตรงกับที่โหลดไว้ (base.css)", () => {
  const withWeight = rules.filter((rule) => rule.decls["font-weight"] !== undefined)

  test("น้ำหนักที่ใช้เป็น 400 500 600 700 เท่านั้น", () => {
    assert.ok(withWeight.length >= 6, `พบ ${withWeight.length} กฎ`)
    for (const rule of withWeight) assert.ok(["400", "500", "600", "700"].includes(rule.decls["font-weight"] ?? ""), `${rule.selectors.join(", ")}: ${rule.decls["font-weight"]}`)
  })

  test("น้ำหนัก 700 ต้องระบุฟอนต์ที่มี 700 (Prompt / ฟอนต์หัวข้อ) ในกฎเดียวกัน", () => {
    for (const rule of withWeight.filter((r) => r.decls["font-weight"] === "700")) assert.ok(["var(--font-ui)", "var(--display)"].includes(rule.decls["font-family"] ?? ""), rule.selectors.join(", "))
  })

  test("กฎที่ใช้ Prompt (--font-ui) ไม่ขอเบากว่า 500", () => {
    const prompt = withWeight.filter((r) => r.decls["font-family"] === "var(--font-ui)")
    assert.ok(prompt.length >= 2)
    for (const rule of prompt) assert.ok(Number(rule.decls["font-weight"]) >= 500, rule.selectors.join(", "))
  })

  test("font-family ทุกที่ใช้ตัวแปรของระบบ ไม่เขียนชื่อฟอนต์ตายตัว", () => {
    const families = rules.filter((rule) => rule.decls["font-family"] !== undefined)
    assert.ok(families.length >= 4, `พบ ${families.length} กฎ`)
    for (const rule of families) assert.match(rule.decls["font-family"] ?? "", /^var\(--(?:font-ui|font-body|font-serif|display)\)$/, rule.selectors.join(", "))
  })

  test("ช่องกรอกใช้ฟอนต์ 16px ขึ้นไป (iOS ไม่ซูมหน้าเองตอนแตะช่อง)", () => {
    assert.equal(declOf(".ad-field input", "font-size"), "16px")
  })
})

describe("โฟกัสด้วยแป้นพิมพ์", () => {
  test("outline: none/0 มีเฉพาะที่เป็นเป้าหมายโฟกัสด้วยโค้ด (เนื้อหาหลักหลังเปลี่ยนหน้า, ตัวกล่องยืนยัน) — ที่เหลือใช้วงโฟกัสของ base.css", () => {
    const removed = rules.filter((rule) => ["none", "0"].includes(rule.decls.outline ?? "") || ["none", "0"].includes(rule.decls["outline-style"] ?? "") || rule.decls["outline-width"] === "0")
    assert.deepEqual(removed.flatMap((rule) => rule.selectors).sort(), [".ad-dialog:focus", ".ad-main:focus"])
    assert.ok(baseRules.some((rule) => rule.selectors.includes(":focus-visible") && /^2px solid var\(--accent\)$/.test(rule.decls.outline ?? "")))
  })

  test("ปุ่มเมนูแตะง่าย: ≥ 44px ทั้งสองด้าน", () => {
    assert.ok(parseInt(declOf(".ad-menu-btn", "width") ?? "0") >= 44)
    assert.ok(parseInt(declOf(".ad-menu-btn", "height") ?? "0") >= 44)
  })
})

// ───────────────────────── โครงหน้าและจุดตัดจอ ─────────────────────────

describe("โครงหน้า: เมนูข้าง 248px ↔ แถบบน + ลิ้นชัก", () => {
  test("จุดตัดจอเดียว (max-width: 899px) และผูกกับ matchMedia (min-width: 900px) ใน Layout.tsx พอดี", () => {
    const medias = [...new Set(rules.map((rule) => rule.media).filter((m): m is string => m !== null))]
    assert.deepEqual(medias, [MOBILE])
    const layout = read("../admin/Layout.tsx")
    const wide = /matchMedia\("\(min-width: (\d+)px\)"\)/.exec(layout)
    assert.ok(wide)
    assert.equal(Number(wide[1]) - 1, 899)
  })

  test("จอกว้าง: ตารางสองคอลัมน์ 248px + ที่เหลือ (หดได้) เมนูข้างติดบนจอ (sticky) สูงเต็มจอ", () => {
    assert.equal(declOf(".ad-shell", "grid-template-columns"), "248px minmax(0, 1fr)")
    assert.equal(declOf(".ad-shell", "display"), "grid")
    assert.equal(declOf(".ad-side", "position"), "sticky")
    assert.equal(declOf(".ad-side", "height"), "100dvh")
    assert.equal(declOf(".ad-side", "background"), "var(--bg-2)")
    assert.equal(declOf(".ad-main", "min-width"), "0")
  })

  test("จอกว้างไม่เห็นแถบบนและฉากหลังลิ้นชัก", () => {
    assert.equal(declOf(".ad-topbar", "display"), "none")
    assert.equal(declOf(".ad-drawer-scrim", "display"), "none")
  })

  test("จอแคบ: แถบบนติดขอบบน, เมนูข้างกลายเป็นลิ้นชักที่ซ่อนด้วย visibility (ลิงก์ข้างในโฟกัสด้วย Tab ไม่ได้ตอนปิด) และเลื่อนออกนอกจอ", () => {
    assert.equal(declOf(".ad-shell", "display", MOBILE), "block")
    assert.equal(declOf(".ad-topbar", "display", MOBILE), "flex")
    assert.equal(declOf(".ad-topbar", "position", MOBILE), "sticky")
    assert.equal(declOf(".ad-drawer-scrim", "display", MOBILE), "block")
    assert.equal(declOf(".ad-side", "position", MOBILE), "fixed")
    assert.equal(declOf(".ad-side", "visibility", MOBILE), "hidden")
    assert.equal(declOf(".ad-side", "transform", MOBILE), "translateX(-100%)")
    assert.equal(declOf(".ad-side", "height", MOBILE), "auto")
  })

  test("ลิ้นชักเปิด (.menu-open): มองเห็นและเลื่อนเข้าจอ · visibility เปลี่ยนทันทีตอนเปิด แต่หน่วงจนเลื่อนออกเสร็จตอนปิด", () => {
    assert.equal(declOf(".menu-open .ad-side", "visibility", MOBILE), "visible")
    assert.equal(declOf(".menu-open .ad-side", "transform", MOBILE), "none")
    assert.match(declOf(".menu-open .ad-side", "transition", MOBILE) ?? "", /visibility 0s$/)
    assert.match(declOf(".ad-side", "transition", MOBILE) ?? "", /visibility 0s linear 0\.22s$/)
  })

  test("ลำดับชั้น: ฉากหลังลิ้นชัก < ลิ้นชัก < แถบบน (ปุ่ม X ที่แถบบนยังกดได้ตอนลิ้นชักเปิด) < กล่องยืนยัน (ทับทุกอย่าง)", () => {
    const z = (selector: string) => Number(declOf(selector, "z-index", MOBILE) ?? declOf(selector, "z-index"))
    assert.ok(z(".ad-drawer-scrim") < z(".ad-side"))
    assert.ok(z(".ad-side") < z(".ad-topbar"))
    assert.ok(z(".ad-topbar") < z(".ad-scrim"))
  })

  test("ลิ้นชักเลื่อนออกมาใต้แถบบน (top = ความสูงแถบบน) และไม่ซ้ำโลโก้ที่แถบบนมีอยู่แล้ว", () => {
    assert.equal(declOf(".ad-side", "top", MOBILE), declOf(".ad-topbar", "height", MOBILE))
    assert.equal(declOf(".ad-side", "top", MOBILE), "58px")
    assert.equal(declOf(".ad-side .logo", "display", MOBILE), "none")
    assert.equal(declOf(".ad-side .logo", "display"), undefined)
  })

  test("เอาเมาส์ชี้รายการที่เปิดอยู่ไม่ทำให้พื้นของมันจางลง (hover ใช้กับรายการอื่นเท่านั้น)", () => {
    assert.equal(rulesFor(".ad-it:hover:not(.on):not(:disabled)").length, 1)
    assert.equal(rulesFor(".ad-it:hover:not(:disabled)").length, 0)
    assert.equal(declOf(".ad-it.on", "background"), "var(--surface-2)")
  })

  test("ฉากหลังกล่องยืนยันคลุมทั้งจอ จัดกล่องกลางจอ", () => {
    assert.equal(declOf(".ad-scrim", "position"), "fixed")
    assert.equal(declOf(".ad-scrim", "inset"), "0")
    assert.equal(declOf(".ad-scrim", "display"), "grid")
    assert.equal(declOf(".ad-scrim", "place-items"), "center")
    assert.equal(declOf(".ad-dialog", "max-height"), "calc(100dvh - 32px)")
  })

  test("ฉากหลังลิ้นชัก/กล่องยืนยันทึบพอให้เห็นว่าหน้าด้านหลังใช้ไม่ได้ (ทึบ 30–85%) และใช้ตัวแปรเดียวกัน", () => {
    const scrim = /--ad-scrim:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+)\s*\)/.exec(adminCss)
    assert.ok(scrim, "ไม่พบ --ad-scrim แบบ rgba(0, 0, 0, a)")
    const alpha = Number(scrim[1])
    assert.ok(alpha >= 0.3 && alpha <= 0.85, `ความทึบ ${alpha}`)
    assert.equal(declOf(".ad-scrim", "background"), "var(--ad-scrim)")
    assert.equal(declOf(".ad-drawer-scrim", "background", MOBILE), "var(--ad-scrim)")
  })

  test("หน้าล็อกอินจัดกลางจอ และบัตรไม่กว้างเกิน 400px", () => {
    assert.equal(declOf(".ad-login", "place-items"), "center")
    assert.equal(declOf(".ad-login-card", "max-width"), "400px")
    assert.equal(declOf(".ad-login-card", "width"), "100%")
  })
})

// ───────────────────────── แดชบอร์ด ─────────────────────────

describe("แดชบอร์ด: โครงหน้าและส่วนที่โค้ดพึ่งพา", () => {
  test("ป้ายสถานะมีสไตล์ครบทุก data-tone ที่โค้ดใช้ (ok / fail / warn / idle) — พิมพ์ผิดแล้วป้ายจะกลายเป็นสีกลางๆ เงียบๆ", () => {
    const dashboard = read("../admin/Dashboard.tsx")
    const logic = read("../admin/dashboard-logic.ts")
    const literal = [...dashboard.matchAll(/data-tone="(\w+)"/g)].map((m) => m[1]!)
    const fromStatus = [...logic.matchAll(/tone: "(\w+)"/g)].map((m) => m[1]!)
    assert.ok(literal.includes("warn") && fromStatus.includes("ok") && fromStatus.includes("fail") && fromStatus.includes("idle"))
    for (const tone of new Set([...fromStatus, "warn"])) assert.equal(rulesFor(`.ad-pill[data-tone="${tone}"]`).length, 1, tone)
    assert.equal(rulesFor('.ad-onboard-item[data-state="warn"]').length, 1)
    for (const state of ["done", "warn"]) assert.equal(rulesFor(`.ad-onboard-item[data-state="${state}"] .ad-onboard-mark`).length, 1, state)
    assert.equal(rulesFor('.ad-stat[data-tone="fail"]').length, 1)
  })

  test("การ์ดตัวเลขเรียงตัวเองตามความกว้าง (auto-fit) และการ์ดตอนผิดพลาดใช้สีแดงของหลังบ้าน", () => {
    assert.match(declOf(".ad-stats", "grid-template-columns") ?? "", /^repeat\(auto-fit, minmax\(\d+px, 1fr\)\)$/)
    assert.equal(declOf('.ad-stat[data-tone="fail"] .ad-stat-value', "color"), "var(--ad-danger-text)")
    assert.equal(declOf(".ad-stat-value", "font-family"), "var(--font-ui)")
  })

  test("จอกว้าง: คิว (กว้างกว่า) + กราฟ แล้วความคืบหน้า + การใช้ AI · จอแคบเรียงเป็นคอลัมน์เดียว", () => {
    assert.match(declOf(".ad-dash-top", "grid-template-columns") ?? "", /^minmax\(0, 1\.\d+fr\) minmax\(0, 1fr\)$/)
    assert.equal(declOf(".ad-dash-row", "grid-template-columns"), "repeat(2, minmax(0, 1fr))")
    assert.equal(declOf(".ad-dash-row", "grid-template-columns", MOBILE), "minmax(0, 1fr)")
    assert.equal(declOf(".ad-dash-top", "grid-template-columns", MOBILE), "minmax(0, 1fr)")
    assert.equal(declOf(".ad-ph-actions", "width", MOBILE), "100%")
    // แผงต้องหดได้ในตาราง (ไม่ให้ตารางการใช้ AI ดันหน้ากว้างเกินจอ)
    assert.equal(declOf(".ad-panel", "min-width"), "0")
  })

  test("จอแคบ: ป้าย \"ควรทำก่อนเผยแพร่\" ลงไปบรรทัดของตัวเองใต้ข้อความ (ไม่นั่งข้างๆ จนข้อความถูกบีบเหลือคำเดียวต่อบรรทัด)", () => {
    // เจอจากภาพจริงที่ 390px: แถวแบบ flex ยัดป้ายที่ห้ามตัดบรรทัดไว้ข้างข้อความ ข้อความเหลือกว้างราว 60px
    assert.equal(declOf(".ad-onboard-link", "display"), "flex")
    assert.equal(declOf(".ad-onboard-link", "display", MOBILE), "grid")
    assert.equal(declOf(".ad-onboard-link", "grid-template-columns", MOBILE), "32px minmax(0, 1fr) auto")
    const pill = ".ad-onboard-link > .ad-pill"
    assert.equal(declOf(pill, "grid-row", MOBILE), "2")
    assert.equal(declOf(pill, "grid-column", MOBILE), "2 / 4")
    assert.equal(declOf(pill, "justify-self", MOBILE), "start")
    // คอลัมน์แรกต้องกว้างเท่าวงกลมเลขข้อ ไม่งั้นข้อความเยื้องไม่ตรงกับแถวอื่น
    assert.equal(declOf(".ad-onboard-mark", "width"), "32px")
  })

  test("กล่องข้อความที่ไหล: เลื่อนในกล่องได้ (สูงจำกัด + overflow-y: auto) เพื่อให้เลื่อนลงท้ายสุดเองได้ และขึ้นบรรทัดตามข้อความจริง", () => {
    assert.equal(declOf(".ad-live", "overflow-y"), "auto")
    assert.match(declOf(".ad-live", "max-height") ?? "", /^\d+px$/)
    assert.equal(declOf(".ad-live", "white-space"), "pre-wrap")
    assert.equal(declOf(".ad-live", "overflow-wrap"), "anywhere")
    assert.match(declOf(".ad-live", "border-left") ?? "", /var\(--accent\)/)
  })

  test("วงหมุนของตอนที่กำลังแปลมี keyframes ชื่อเดียวกับที่ใช้ (animation ชี้ไปที่ว่างเปล่าไม่หมุน)", () => {
    const name = /^ad-spin\b/.exec(declOf(".ad-spin", "animation") ?? "")
    assert.ok(name, declOf(".ad-spin", "animation"))
    assert.match(adminCss, /@keyframes ad-spin\s*\{/)
  })

  test("ตารางการใช้ AI เลื่อนแนวนอนในกรอบของมันเอง (จอแคบ) และกราฟยอดอ่านมีความสูงและวางเป็นบล็อก", () => {
    assert.equal(declOf(".ad-scroll", "overflow-x"), "auto")
    assert.equal(declOf(".ad-table", "white-space"), "nowrap")
    assert.equal(declOf(".ad-chart-svg", "display"), "block")
    assert.equal(declOf(".ad-chart-svg", "width"), "100%")
    assert.match(declOf(".ad-chart-svg", "height") ?? "", /^\d+px$/)
    assert.equal(declOf(".ad-chart-days", "display"), "grid")
    assert.equal(declOf(".ad-bar", "fill"), "url(#ad-bar-fill)")
    assert.match(read("../admin/chart.tsx"), /id="ad-bar-fill"/)
  })

  test("ปุ่มลองใหม่และปุ่มปิดข้อความแตะง่าย (สูง ≥ 36px) และปุ่มลองใหม่ใช้สีแดงเดียวกับป้ายผิดพลาด", () => {
    assert.ok(parseInt(declOf(".ad-retry", "min-height") ?? "0") >= 36)
    assert.ok(parseInt(declOf(".ad-notice-close", "width") ?? "0") >= 36)
    assert.ok(parseInt(declOf(".ad-notice-close", "height") ?? "0") >= 36)
    assert.equal(declOf(".ad-retry", "color"), declOf('.ad-pill[data-tone="fail"]', "color"))
  })

  test("แถบความคืบหน้า: รางจางๆ ไล่สี accent และไม่ล้นรางตอนค่า 100%", () => {
    assert.match(declOf(".ad-meter-fill", "background") ?? "", /^linear-gradient\(90deg, var\(--accent\), var\(--accent-2\)\)$/)
    assert.equal(declOf(".ad-meter", "overflow"), "hidden")
    assert.equal(declOf(".ad-meter-fill", "height"), "100%")
  })

  test("ข้อความแจ้งผลเผยแพร่ใช้สีสำเร็จของหลังบ้าน ไม่ใช้สี accent เป็นตัวอักษร", () => {
    assert.match(declOf(".ad-notice", "background") ?? "", /var\(--ad-ok-text\)/)
    assert.equal(declOf(".ad-notice", "color"), "var(--text)")
  })
})

// ───────────────────────── ฟอร์มนิยาย · แท็บ · แท็ก · ปก · ตารางนิยาย ─────────────────────────

describe("ฟอร์มนิยาย: ช่องกรอกและเลย์เอาต์", () => {
  test("ช่องหลายบรรทัดและช่องแท็กใช้ฟอนต์ 16px ขึ้นไปเหมือนช่องบรรทัดเดียว (iOS ไม่ซูมหน้า) และใช้ฟอนต์เนื้อหา", () => {
    assert.equal(declOf(".ad-field textarea", "font-size"), "16px")
    assert.equal(declOf(".ad-field textarea", "font-family"), "var(--font-body)")
    assert.equal(declOf(".ad-tag-input", "font-size"), "16px")
    assert.equal(declOf(".ad-tag-input", "height"), declOf(".ad-field input", "height"))
  })

  test("ช่องที่ผิด (aria-invalid) เปลี่ยนขอบเป็นสีแดงหลังบ้านทุกชนิด: บรรทัดเดียว, หลายบรรทัด, แท็ก", () => {
    for (const selector of [".ad-field input[aria-invalid=\"true\"]", ".ad-field textarea[aria-invalid=\"true\"]", ".ad-tag-input[aria-invalid=\"true\"]"]) {
      assert.equal(declOf(selector, "border-color"), "var(--ad-danger-text)", selector)
    }
  })

  test("ข้อความผิดพลาด/ดอกจันบังคับใช้สีแดงหลังบ้าน (ผ่านความต่างสีที่ทดสอบไว้แล้ว) · คำอธิบายใช้สีรอง · ข้อความสำเร็จใช้สีสำเร็จ", () => {
    assert.equal(declOf(".ad-field-error", "color"), "var(--ad-danger-text)")
    assert.equal(declOf(".ad-req", "color"), "var(--ad-danger-text)")
    assert.equal(declOf(".ad-hint", "color"), "var(--muted)")
    assert.equal(declOf(".ad-form-ok", "color"), "var(--ad-ok-text)")
    assert.equal(declOf(".ad-ai-note", "color"), "var(--ad-ok-text)")
  })

  test("สองคอลัมน์ด้วย flex-wrap (ไม่พึ่งจุดตัดจอ): ข้อมูลหลักกว้างกว่า ได้พื้นที่ที่เหลือ · แคบลงคอลัมน์ข้างลงไปอยู่ใต้ข้อมูลหลักเอง", () => {
    assert.equal(declOf(".ad-form-grid", "display"), "flex")
    assert.equal(declOf(".ad-form-grid", "flex-wrap"), "wrap")
    const grow = (selector: string) => parseInt(declOf(selector, "flex") ?? "0")
    assert.ok(grow(".ad-form-main") > grow(".ad-form-side"), "ข้อมูลหลักต้องได้ส่วนที่เหลือมากกว่า")
    for (const selector of [".ad-form-main", ".ad-form-side"]) assert.equal(declOf(selector, "min-width"), "0", `${selector}: ต้องหดได้ ไม่ดันหน้ากว้าง`)
  })

  test("แถบบันทึกลอยติดขอบล่าง (sticky) อยู่ใต้ฉากหลังลิ้นชัก/แถบบน/กล่องยืนยัน และชิดขอบล่างจริงบนจอแคบ", () => {
    assert.equal(declOf(".ad-form-bar", "position"), "sticky")
    const bar = Number(declOf(".ad-form-bar", "z-index"))
    assert.ok(bar > 0, "ต้องอยู่เหนือเนื้อหาปกติ (ปกที่ซ้อน z-index 2–3 ในหน้าบ้าน)")
    assert.ok(bar < Number(declOf(".ad-drawer-scrim", "z-index", MOBILE)), "ใต้ฉากหลังลิ้นชัก")
    assert.ok(bar < Number(declOf(".ad-scrim", "z-index")), "ใต้กล่องยืนยัน")
    assert.equal(declOf(".ad-form-bar", "bottom", MOBILE), "0")
  })

  test("ปุ่ม AI ช่วยกรอก: ข้อความยาวขึ้นบรรทัดใหม่ได้ (ไม่ล้นกล่อง) และเต็มความกว้างบนจอแคบ", () => {
    assert.equal(declOf(".ad-ai > .btn", "max-width"), "100%")
    assert.equal(declOf(".ad-ai > .btn", "align-self", MOBILE), "stretch")
  })

  test("ปุ่มลบเรื่องเป็นสีแดงหลังบ้าน และชนะสีของ .btn.ghost (ความจำเพาะสูงกว่า)", () => {
    assert.equal(declOf(".btn.ghost.ad-danger-ghost", "color"), "var(--ad-danger-text)")
    assert.match(declOf(".btn.ghost.ad-danger-ghost", "border-color") ?? "", /var\(--ad-danger-text\)/)
  })

  test("ชิปสถานะ/โหมดสูงพอแตะง่าย (≥ 40px)", () => {
    assert.ok(parseInt(declOf(".ad-chips .fchip", "min-height") ?? "0") >= 40)
  })
})

describe("แท็บ · แท็ก · ช่องปก", () => {
  test("แท็บเลื่อนแนวนอนได้เมื่อจอแคบ ไม่ตัดบรรทัด · แท็บที่เปิดอยู่ขีดเส้นใต้ด้วย accent (ตัวอักษรไม่ใช้ accent) และแตะง่าย", () => {
    assert.equal(declOf(".ad-tabs", "overflow-x"), "auto")
    assert.equal(declOf(".ad-tab", "white-space"), "nowrap")
    assert.equal(declOf(".ad-tab[aria-current=\"page\"]", "border-bottom-color"), "var(--accent)")
    assert.equal(declOf(".ad-tab[aria-current=\"page\"]", "color"), "var(--text)")
    assert.ok(parseInt(declOf(".ad-tab", "padding") ?? "0") >= 12)
  })

  test("แท็ก: รายการไม่มีจุดนำหน้า/ขอบในตัว · ปุ่มลบแท็กเป็นวงกลม ≥ 30px · ข้อความยาวขึ้นบรรทัดใหม่ได้", () => {
    assert.equal(declOf(".ad-tag-list", "list-style"), "none")
    assert.equal(declOf(".ad-tag-list", "flex-wrap"), "wrap")
    assert.ok(parseInt(declOf(".ad-tag-x", "width") ?? "0") >= 30)
    assert.ok(parseInt(declOf(".ad-tag-x", "height") ?? "0") >= 30)
    assert.equal(declOf(".ad-tag-x", "border-radius"), "50%")
    assert.equal(declOf(".ad-tag", "overflow-wrap"), "anywhere")
  })

  test("ตัวอย่างปกคงอัตราส่วนด้วย .cv (2:3) และถูกจำกัดความกว้าง · ปุ่มเลือกไฟล์โชว์วงโฟกัสเมื่อช่องไฟล์ที่ซ่อนอยู่ได้โฟกัส", () => {
    assert.match(declOf(".ad-cover-preview", "width") ?? "", /^\d+px$/)
    assert.equal(declOf(".ad-cover-preview", "overflow"), "hidden")
    assert.equal(declOf(".ad-file", "position"), "relative") // ช่องไฟล์ sr-only เป็น absolute: ต้องมีที่อ้างอิงในปุ่ม ไม่งั้นหน้าเลื่อนกระโดด
    assert.match(declOf(".ad-file:focus-within", "outline") ?? "", /^2px solid var\(--accent\)$/)
    assert.equal(declOf(".ad-file:has(input:disabled)", "cursor"), "not-allowed")
  })
})

describe("รายการนิยาย", () => {
  test("ตารางนิยายจัดชิดซ้ายทุกคอลัมน์และขึ้นบรรทัดใหม่ได้ (ทับค่าตัวเลขชิดขวา/ไม่ตัดบรรทัดของตารางการใช้ AI) · หัวคอลัมน์ไม่ตัดบรรทัด", () => {
    assert.equal(declOf(".ad-ntable td", "text-align"), "left")
    assert.equal(declOf(".ad-ntable th", "text-align"), "left")
    assert.equal(declOf(".ad-ntable td", "white-space"), "normal")
    assert.equal(declOf(".ad-ntable thead th", "white-space"), "nowrap")
  })

  test("ปกในตารางกว้างคงที่ ไม่หดเมื่อชื่อยาว · ชื่อยาวขึ้นบรรทัดใหม่ได้ ไม่ดันตาราง", () => {
    assert.equal(declOf(".ad-thumb", "flex"), "none")
    assert.ok(parseInt(declOf(".ad-thumb", "width") ?? "0") >= 40)
    assert.equal(declOf(".ad-ntext", "min-width"), "0")
    assert.equal(declOf(".ad-ntext strong", "overflow-wrap"), "anywhere")
    assert.equal(declOf(".ad-nsub", "overflow-wrap"), "anywhere")
  })

  test("ป้ายของสวิตช์ในตารางซ่อนจากสายตาแต่ยังอยู่ให้โปรแกรมอ่านหน้าจอ (ไม่ใช่ display:none)", () => {
    const hidden = rulesFor(".ad-ntable .switch-label")
    assert.equal(hidden.length, 1)
    assert.equal(hidden[0]!.decls.position, "absolute")
    assert.equal(hidden[0]!.decls.width, "1px")
    assert.equal(hidden[0]!.decls.height, "1px")
    assert.equal(hidden[0]!.decls.overflow, "hidden")
    assert.notEqual(hidden[0]!.decls.display, "none")
    assert.notEqual(hidden[0]!.decls.visibility, "hidden")
    // absolute ที่ไม่มีบรรพบุรุษ positioned จะหลุดออกนอกกรอบเลื่อนแล้วดันหน้าให้เลื่อนแนวนอน (พบจริงที่ 390px): ตารางต้องเป็นที่อ้างอิง
    assert.equal(declOf(".ad-ntable", "position"), "relative")
  })

  test("จอแคบ: ตารางนิยายกว้างขั้นต่ำกว่าจอ แล้วเลื่อนในกรอบ .ad-scroll เอง (หน้าไม่เลื่อนแนวนอน)", () => {
    assert.ok(parseInt(declOf(".ad-ntable", "min-width", MOBILE) ?? "0") >= 560)
    assert.equal(declOf(".ad-scroll", "overflow-x"), "auto")
  })
})
