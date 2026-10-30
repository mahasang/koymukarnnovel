import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { SYNOPSIS_LINES } from "../components/Synopsis"
import { parseCss, type CssRule } from "../testing/css"

/**
 * ตรวจ `public.css` โดยอ่านไฟล์จริง (ไม่ใช้เบราว์เซอร์): คลาสในโค้ดกับสไตล์ตรงกัน, ตัวแปรสีมีอยู่จริง,
 * กติกาความต่างสีที่ tokens.css ให้ไว้ถูกใช้ถูกที่, น้ำหนักฟอนต์ที่โหลดไว้, ตารางปก 6/4/3 คอลัมน์ตาม spec 6.1, และจุดตัดจอของแถบบน
 */

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
const publicCss = read("./public.css")
const rules = parseCss(publicCss)

const rulesFor = (selector: string, media: string | null = null) => rules.filter((rule) => rule.selectors.includes(selector) && rule.media === media)
/** ค่า declaration ล่าสุดของ selector ที่ตรงตัว (ในเงื่อนไข media ที่ระบุ) — กฎหลังชนะกฎก่อนเหมือนเบราว์เซอร์ */
const declOf = (selector: string, property: string, media: string | null = null) =>
  rulesFor(selector, media)
    .map((rule) => rule.decls[property])
    .filter((value): value is string => value !== undefined)
    .at(-1)

// ───────────────────────── คลาสในโค้ด ↔ คลาสใน CSS ─────────────────────────

const SRC = fileURLToPath(new URL("../", import.meta.url))
const sourceFiles = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx") && !file.startsWith("testing/"))

/** นิพจน์ของ `className=` แต่ละที่: ข้อความตรงๆ หรือเนื้อใน {…} */
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
/** ชื่อคลาสจากข้อความทุกก้อนในนิพจน์ (ส่วนที่ต่อด้วย ${…} เป็นของที่รู้ตอนรันเท่านั้น ข้ามไป) */
function classTokens(expression: string): string[] {
  const tokens: string[] = []
  for (const literal of expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const raw = literal[1] ?? literal[2] ?? literal[3] ?? ""
    for (const token of raw.replace(/\$\{[^}]*\}/g, DYNAMIC).split(/\s+/)) {
      if (token !== "" && !token.includes(DYNAMIC)) tokens.push(token)
    }
  }
  return tokens
}

const usedClasses = new Set(sourceFiles.flatMap((file) => classNameExpressions(readFileSync(`${SRC}${file}`, "utf8")).flatMap(classTokens)))
const classesIn = (list: CssRule[]) => new Set(list.flatMap((rule) => rule.selectors).flatMap((selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1])))
const definedClasses = classesIn(rules)
/** คลาสทั่วไปที่ base.css ให้ไว้ (เช่น .sr-only) — ใช้ได้ทุกหน้าโดยไม่ต้องมีสไตล์ซ้ำใน public.css */
const globalClasses = classesIn(parseCss(read("./base.css")))
/** @keyframes ที่ base.css ให้ไว้ให้ทุกหน้า */
const globalKeyframes = new Set([...read("./base.css").matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]))

/** ใช้ในโค้ดแต่ไม่มีสไตล์ของตัวเอง (ตัวยึดโครงสร้างให้ CSS/เทสต์อ้างถึง) */
const STRUCTURAL = ["foot-brand", "state-empty", "skeleton", "switch-label", "sk-card"]
/** มีสไตล์แล้วแต่ยังไม่มีคอมโพเนนต์ใช้ — สงวนไว้ให้หน้าถัดไป (ปุ่มเต็มแถว: ปุ่มบนหน้าเรื่อง/ท้ายตอน) */
const RESERVED = ["full"]
/** คลาสที่ประกอบตอนรันจากแม่แบบ `skeleton-${variant}` (variant = grid | lines) */
const SKELETON_VARIANTS = ["skeleton-grid", "skeleton-lines"]

describe("คลาสในโค้ดกับ public.css ตรงกัน", () => {
  test("พบไฟล์คอมโพเนนต์และอ่านคลาสออกมาได้ (ตัวอ่านไม่ได้ทำงานว่างเปล่า)", () => {
    assert.ok(sourceFiles.length >= 15, `พบ ${sourceFiles.length} ไฟล์`)
    for (const name of ["card", "cv", "logo", "theme-menu", "state-error", "skip-link", "fchip", "switch", "prose-text"]) assert.ok(usedClasses.has(name), name)
  })

  test("คลาสที่คอมโพเนนต์ใช้ทุกตัวมีสไตล์ (พิมพ์ชื่อคลาสผิดแล้วเงียบ ต้องไม่หลุด)", () => {
    const missing = [...usedClasses].filter((name) => !definedClasses.has(name) && !globalClasses.has(name) && !STRUCTURAL.includes(name))
    assert.deepEqual(missing, [])
  })

  test("ตัวยึดโครงสร้างที่ยกเว้นไว้ยังถูกใช้อยู่และยังไม่มีสไตล์ (รายการไม่เน่า)", () => {
    for (const name of STRUCTURAL) {
      assert.ok(usedClasses.has(name), `${name} ไม่ถูกใช้แล้ว ลบออกจาก STRUCTURAL`)
      assert.ok(!definedClasses.has(name) && !globalClasses.has(name), `${name} มีสไตล์แล้ว ลบออกจาก STRUCTURAL`)
    }
  })

  test("สไตล์ใน public.css ทุกคลาสมีคอมโพเนนต์ใช้ (ไม่มีสไตล์ตกค้าง) ยกเว้นที่สงวนไว้", () => {
    const used = new Set([...usedClasses, ...SKELETON_VARIANTS])
    const dead = [...definedClasses].filter((name) => !used.has(name) && !RESERVED.includes(name))
    assert.deepEqual(dead, [])
    for (const name of RESERVED) {
      assert.ok(definedClasses.has(name), `${name} ไม่มีสไตล์แล้ว ลบออกจาก RESERVED`)
      assert.ok(!used.has(name), `${name} มีคอมโพเนนต์ใช้แล้ว ลบออกจาก RESERVED`)
    }
  })

  test("คลาสของ Skeleton ประกอบจาก skeleton-${variant} และมีสไตล์ครบทั้งสองแบบ", () => {
    const source = readFileSync(`${SRC}components/Skeleton.tsx`, "utf8")
    assert.ok(source.includes("skeleton-${variant}"))
    assert.match(source, /variant: "grid" \| "lines"/)
    for (const name of SKELETON_VARIANTS) assert.ok(definedClasses.has(name), name)
  })
})

// ───────────────────────── ตัวแปรสี ─────────────────────────

describe("ตัวแปร CSS", () => {
  const defined = new Set(["./tokens.css", "./base.css", "./public.css"].flatMap((file) => parseCss(read(file)).flatMap((rule) => Object.keys(rule.decls).filter((name) => name.startsWith("--")))))

  test("ทุก var(--ชื่อ) ใน public.css มีการกำหนดค่าจริงใน tokens.css / base.css / public.css (พิมพ์ผิดแล้วสีหายเงียบ)", () => {
    const used = [...publicCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
    assert.ok(used.length > 40, `พบการใช้ตัวแปร ${used.length} ที่`)
    assert.deepEqual(
      [...new Set(used)].filter((name) => !defined.has(name)),
      [],
    )
  })

  test("โทเค็นหลักที่คอมโพเนนต์พึ่งอยู่ครบ", () => {
    for (const name of ["--bg", "--bg-2", "--surface", "--surface-2", "--line", "--text", "--muted", "--accent", "--accent-2", "--accent-ink", "--shadow", "--display", "--font-ui", "--font-body", "--header-h"]) {
      assert.ok(defined.has(name), name)
    }
  })
})

// ───────────────────────── กติกาความต่างสี (tokens.css) ─────────────────────────

describe("กติกาสีที่ tokens.css กำหนดไว้ถูกใช้ถูกที่", () => {
  // --accent และ --accent-2 เท่านั้น (ไม่รวม --accent-ink ซึ่งเป็นสีข้อความบนพื้น accent)
  const usesAccent = (value: string | undefined) => /var\(--accent(?:-2)?\s*[,)]/.test(value ?? "")

  test("ท้ายเว็บ (พื้น --bg-2) ไม่ใช้ข้อความสี accent ทั้งตัวมันเองและลูกหลาน", () => {
    assert.equal(declOf(".foot", "background"), "var(--bg-2)")
    const footRules = rules.filter((rule) => rule.selectors.some((selector) => selector === ".foot" || selector.startsWith(".foot ") || selector.startsWith(".foot-")))
    assert.ok(footRules.length >= 8)
    for (const rule of footRules) assert.equal(usesAccent(rule.decls.color), false, `${rule.selectors.join(", ")} color: ${rule.decls.color}`)
  })

  test("พื้นที่ระบายด้วย --accent / --accent-2 ใช้ข้อความสี --accent-ink", () => {
    const NO_TEXT = [".switch.on .switch-track", ".bar i"] // แค่ราง/แถบเติม ไม่มีข้อความข้างใน
    const painted = rules.filter((rule) => usesAccent(rule.decls.background) || usesAccent(rule.decls["background-color"]))
    assert.ok(painted.length >= 6, `พบ ${painted.length} กฎ`)
    for (const rule of painted) {
      if (rule.selectors.every((selector) => NO_TEXT.includes(selector))) continue
      assert.equal(rule.decls.color, "var(--accent-ink)", rule.selectors.join(", "))
    }
  })

  test("ข้อความสีตายตัว (#fff, rgba, ชื่อสี) มีเฉพาะบนปก/ป้ายซ้อนปกที่พื้นไม่ขึ้นกับธีม", () => {
    const OVER_COVER_ART = [".cv-title", ".b-ep", ".b-done"]
    // สีที่ผสมจากตัวแปรของธีม (color-mix(… var(--text) …)) ตามธีมเสมอ ไม่ใช่สีตายตัว
    const themed = (color: string) => color.startsWith("var(") || color === "inherit" || (color.startsWith("color-mix(") && color.includes("var(--"))
    const hardCoded = rules.filter((rule) => rule.decls.color !== undefined && !themed(rule.decls.color))
    assert.deepEqual(
      hardCoded.flatMap((rule) => rule.selectors).sort(),
      [...OVER_COVER_ART].sort(),
    )
  })

  test("ป้ายบนปกที่ใช้สีตายตัวมีพื้นของตัวเองที่เข้ากัน (ขาวบนดำโปร่ง / ดำบนขาว) ไม่พึ่งพื้นหลังของปก", () => {
    assert.match(declOf(".b-ep", "background") ?? "", /^rgba\(8, 8, 14, 0?\.7\d*\)$/)
    assert.equal(declOf(".b-ep", "color"), "#fff")
    assert.match(declOf(".b-done", "background") ?? "", /^rgba\(255, 255, 255, 0?\.9\d*\)$/)
    assert.equal(declOf(".b-done", "color"), "#111")
  })

  test("ชื่อเรื่องบนปกอัตโนมัติเป็นสีขาวบนเงาจางด้านล่าง (cover.test.ts ตรวจความต่างสีของพื้นไล่สีแล้ว)", () => {
    assert.equal(declOf(".cv-title", "color"), "#fff")
    const shade = declOf(".cv-placeholder::after", "background") ?? ""
    assert.match(shade, /linear-gradient\(180deg, transparent 42%, rgba\(0, 0, 0, 0?\.6\) 100%\)/)
  })
})

// ───────────────────────── ฟอนต์ ─────────────────────────

describe("ฟอนต์และน้ำหนักตัวอักษรตรงกับที่โหลดไว้ (base.css)", () => {
  const withWeight = rules.filter((rule) => rule.decls["font-weight"] !== undefined)

  test("น้ำหนักที่ใช้เป็น 400 500 600 700 เท่านั้น", () => {
    assert.ok(withWeight.length >= 15, `พบ ${withWeight.length} กฎ`)
    for (const rule of withWeight) assert.ok(["400", "500", "600", "700"].includes(rule.decls["font-weight"] ?? ""), `${rule.selectors.join(", ")}: ${rule.decls["font-weight"]}`)
  })

  test("น้ำหนัก 700 ต้องระบุฟอนต์ที่มี 700 (Prompt / ฟอนต์หัวข้อ) ในกฎเดียวกัน — Sarabun ไม่มี 700 เบราว์เซอร์จะวาดตัวหนาปลอม", () => {
    for (const rule of withWeight.filter((r) => r.decls["font-weight"] === "700")) {
      assert.ok(["var(--font-ui)", "var(--display)"].includes(rule.decls["font-family"] ?? ""), rule.selectors.join(", "))
    }
  })

  test("Prompt (--font-ui) มีน้ำหนัก 500 600 700 — กฎที่ใช้ฟอนต์นี้ต้องไม่ขอเบากว่า 500", () => {
    for (const rule of withWeight.filter((r) => r.decls["font-family"] === "var(--font-ui)")) {
      assert.ok(Number(rule.decls["font-weight"]) >= 500, `${rule.selectors.join(", ")}: ${rule.decls["font-weight"]}`)
    }
  })

  test("font-family ทุกที่ใช้ตัวแปรของระบบ ไม่เขียนชื่อฟอนต์ตายตัว", () => {
    const families = rules.filter((rule) => rule.decls["font-family"] !== undefined)
    assert.ok(families.length >= 10, `พบ ${families.length} กฎ`)
    for (const rule of families) assert.match(rule.decls["font-family"] ?? "", /^var\(--(?:font-ui|font-body|font-serif|display)\)$/, rule.selectors.join(", "))
  })
})

// ───────────────────────── ตารางปกและจุดตัดจอ ─────────────────────────

describe("ตารางปก 6 / 4 / 3 คอลัมน์ตาม spec 6.1 (และ 2 คอลัมน์บนจอแคบมาก)", () => {
  const COLUMNS: Array<[string | null, string]> = [
    [null, "repeat(6, minmax(0, 1fr))"],
    ["(max-width: 1099px)", "repeat(4, minmax(0, 1fr))"],
    ["(max-width: 719px)", "repeat(3, minmax(0, 1fr))"],
    ["(max-width: 359px)", "repeat(2, minmax(0, 1fr))"],
  ]

  test("ตารางการ์ด (.grid) แบ่งคอลัมน์ตามขนาดจอ", () => {
    for (const [media, expected] of COLUMNS) assert.equal(declOf(".grid", "grid-template-columns", media), expected, String(media))
  })

  test("โครงจำลองตอนโหลด (.skeleton-grid) แบ่งคอลัมน์เหมือนตารางจริงทุกขนาดจอ (ไม่กระโดดตอนข้อมูลมา)", () => {
    for (const [media, expected] of COLUMNS) assert.equal(declOf(".skeleton-grid", "grid-template-columns", media), expected, String(media))
  })

  test("ช่องไฟระหว่างการ์ดของตารางจริงกับโครงจำลองเท่ากันทุกขนาดจอ", () => {
    for (const media of [null, "(max-width: 719px)"]) assert.equal(declOf(".grid", "gap", media), declOf(".skeleton-grid", "gap", media), String(media))
  })
})

describe("แถบบนตอบสนองตามขนาดจอ", () => {
  test("เมนูหน้าแรก/เกี่ยวกับ/ติดต่อซ่อนที่จอกว้าง ≤ 959px (ลิงก์เดียวกันอยู่ท้ายเว็บ) — แท็บเล็ตแนวตั้งที่ 720–959 ใส่เมนูไม่พอเมื่อมีปุ่มหลังบ้าน; ตอนแสดงต้องไม่ตัดบรรทัด", () => {
    assert.equal(declOf(".nav", "display"), "flex")
    assert.equal(declOf(".nav", "display", "(max-width: 959px)"), "none")
    assert.equal(declOf(".nav", "display", "(max-width: 719px)"), undefined)
    assert.equal(declOf(".nav a", "white-space"), "nowrap")
  })

  test("ช่องค้นหาขยายเต็มพื้นที่ที่เหลือเมื่อไม่มีเมนู (≤ 959px) และเป็นฝ่ายหดก่อนเสมอ (flex-shrink 100) เมื่อพื้นที่ไม่พอ", () => {
    assert.equal(declOf(".search", "margin-left"), "auto")
    assert.equal(declOf(".search", "margin-left", "(max-width: 959px)"), "0")
    assert.equal(declOf(".search", "flex"), "0 100 330px")
    assert.equal(declOf(".search", "flex", "(max-width: 959px)"), "1 100 auto")
  })

  test("ช่องค้นหาหดได้แต่ไม่ต่ำกว่า 150px จนกว่าชื่อเว็บจะถูกซ่อน (≤ 519px) — ชื่อเว็บยาวถึง 80 ตัวอักษรตามที่เซิร์ฟเวอร์อนุญาต ต้องไม่บีบช่องค้นหาจนใช้ไม่ได้ และไม่ดันแถบบนให้ล้นจอ", () => {
    assert.equal(declOf(".search", "min-width"), "150px")
    assert.equal(declOf(".search", "min-width", "(max-width: 519px)"), "0")
    assert.equal(declOf(".search input", "min-width"), "0")
  })

  test("โลโก้ในแถบบนหดได้เป็นอันดับหลังช่องค้นหา (ชื่อเว็บตัดด้วย …) แต่ไม่เล็กกว่าตัว K — ตัว K ไม่ถูกช่องค้นหาทับ", () => {
    assert.equal(declOf(".top .logo", "flex"), "0 1 auto")
    assert.equal(declOf(".top .logo", "min-width"), "var(--mark)")
    assert.equal(declOf(".logo .mark", "width"), "var(--mark)")
    assert.equal(declOf(".logo .mark", "height"), "var(--mark)")
    assert.equal(declOf(".logo", "--mark"), "34px")
    assert.equal(declOf(".logo", "max-width"), undefined) // โลโก้ท้ายเว็บ (นอกแถบบน) ไม่ถูกจำกัด
    assert.equal(declOf(".logo .logo-name", "text-overflow"), "ellipsis")
    assert.equal(declOf(".logo .logo-name", "overflow"), "hidden")
  })

  test("ซ่อนข้อความแบบที่โปรแกรมอ่านหน้าจอยังอ่านได้ (เหมือน .sr-only ของ base.css): ข้อความปุ่มหลังบ้านที่ ≤ 719px, ชื่อเว็บในโลโก้ที่ ≤ 519px", () => {
    const base = parseCss(read("./base.css")).find((rule) => rule.selectors.includes(".sr-only"))
    assert.ok(base)
    const hiding = (media: string, selector: string) => rules.find((rule) => rule.media === media && rule.selectors.includes(selector))
    for (const [media, selector] of [
      ["(max-width: 719px)", ".admin-link span"],
      ["(max-width: 519px)", ".top .logo-name"],
    ] as const) {
      const hide = hiding(media, selector)
      assert.ok(hide, `${selector} @ ${media}`)
      for (const property of ["position", "width", "height", "overflow", "clip-path", "white-space"]) assert.equal(hide.decls[property], base.decls[property], `${selector}: ${property}`)
    }
    // ปุ่มหลังบ้านเหลือแต่ไอคอนเป็นวงกลมเท่าปุ่มธีม
    assert.equal(declOf(".admin-link", "width", "(max-width: 719px)"), "42px")
    assert.equal(declOf(".admin-link", "padding", "(max-width: 719px)"), "0")
  })

  test("ทุกขนาดจอแถบบนมีความสูงจากตัวแปร --header-h (ใช้ร่วมกับ scroll-margin ของเนื้อหา)", () => {
    assert.equal(declOf(".top .in", "height"), "var(--header-h)")
    assert.equal(declOf(".main", "scroll-margin-top"), "var(--header-h)")
    assert.equal(declOf(":root", "--header-h"), "64px")
    assert.equal(declOf(":root", "--header-h", "(max-width: 719px)"), "58px")
  })
})

// ───────────────────────── ปก ─────────────────────────

describe("ปกนิยาย", () => {
  test("กรอบปกสัดส่วน 2:3 และเป็น container ให้ชื่อเรื่องขนาดตามความกว้างปก (cqw)", () => {
    assert.equal(declOf(".cv", "aspect-ratio"), "2 / 3")
    assert.equal(declOf(".cv", "container-type"), "inline-size")
    assert.match(declOf(".cv-title", "font-size") ?? "", /cqw/)
  })

  test("ชื่อเรื่องบนปกมีขนาดสำรองสำหรับเบราว์เซอร์ที่ไม่รู้จัก cqw (ประกาศก่อนค่า cqw)", () => {
    const rule = rulesFor(".cv-title")[0]
    assert.ok(rule)
    assert.match(publicCss, /\.cv-title \{[^}]*font-size: 15px;\s*font-size: max\(10px, 11\.5cqw\);/)
  })

  test("รูปปกจริงเต็มกรอบแบบ cover และไม่ถูกเงาของปกอัตโนมัติบัง (เงาอยู่ที่ .cv-placeholder เท่านั้น)", () => {
    assert.equal(declOf(".cv-img", "object-fit"), "cover")
    assert.equal(rulesFor(".cv::after").length, 0)
    assert.equal(rulesFor(".cv-placeholder::after").length, 1)
  })

  test("ในการ์ด ชื่อบนปกอัตโนมัติเว้นด้านล่างให้พ้นแถบป้ายมุมล่าง (จบแล้ว / ร่าง) ไม่ให้ซ้อนทับกัน", () => {
    const px = (value: string | undefined) => {
      const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? "")
      assert.ok(match, `ต้องเป็นหน่วย px: ${value}`)
      return Number(match[1])
    }
    // ป้ายล่างที่สูงสุดคือป้ายร่างแบบย่อ — วัดจริงในเบราว์เซอร์ที่ Task 23 ได้ 26px (ตัวป้ายเอง 23.6px แต่เส้นบรรทัดของ .b-draft ดันให้สูงขึ้น)
    const BADGE_HEIGHT = 26
    const MIN_GAP = 6
    const badgeBottom = px(declOf(".b-done", "bottom"))
    assert.equal(px(declOf(".b-draft", "bottom")), badgeBottom)
    assert.ok(px(declOf(".card .cv-title", "bottom")) >= badgeBottom + BADGE_HEIGHT + MIN_GAP)
    // นอกการ์ด (หน้านิยาย ฯลฯ) ไม่มีป้ายซ้อน ชื่อคงตำแหน่งเดิมตามสัดส่วนปก
    assert.equal(declOf(".cv-title", "bottom"), "8%")
  })
})

describe("ท้ายเว็บ", () => {
  test("คอลัมน์ท้ายเว็บหดได้ (minmax(0, …)) — ชื่อเว็บ 80 ตัวอักษรที่ตัดบรรทัดไม่ได้ต้องไม่ดันหน้าให้เลื่อนแนวนอน (ตัดด้วย … ที่ .logo-name)", () => {
    assert.equal(declOf(".foot .cols", "grid-template-columns"), "minmax(0, 1.6fr) minmax(0, 2fr)")
    assert.equal(declOf(".foot .cols", "grid-template-columns", "(max-width: 959px)"), "minmax(0, 1fr)")
    assert.equal(declOf(".foot-nav", "grid-template-columns"), "minmax(0, 1fr) minmax(0, 1fr)")
    assert.equal(declOf(".foot-nav", "grid-template-columns", "(max-width: 519px)"), "minmax(0, 1fr)")
  })
})

describe("ป้ายบนปกในการ์ด", () => {
  test("ป้ายซ้ายบน (ใหม่) กับชิปขวาบน (ตอน N) อยู่ในแถบ flex เดียวกันที่ห่อบรรทัดได้ — ปกแคบบนมือถือไม่ให้สองป้ายทับกัน", () => {
    assert.equal(declOf(".b-top", "position"), "absolute")
    assert.equal(declOf(".b-top", "display"), "flex")
    assert.equal(declOf(".b-top", "flex-wrap"), "wrap")
    for (const side of ["top", "right", "left"]) assert.equal(declOf(".b-top", side), "9px", side)
    // ในแถบ: ชิปชิดขวาเสมอ (แม้อยู่ลำพังหรือถูกห่อลงบรรทัดที่สอง) และสองป้ายไม่ใช่ absolute เอง
    assert.equal(declOf(".b-ep", "margin-left"), "auto")
    for (const name of [".b-new", ".b-ep"]) {
      assert.equal(declOf(name, "position"), undefined, name)
      assert.equal(declOf(name, "top"), undefined, name)
    }
  })

  test("ป้ายมุมล่าง (จบแล้ว/ร่าง) ยังวางแบบ absolute ที่ขอบล่าง", () => {
    for (const name of [".b-done", ".b-draft"]) {
      assert.equal(declOf(name, "position"), "absolute", name)
      assert.equal(declOf(name, "bottom"), "9px", name)
    }
  })
})

describe("ปุ่ม", () => {
  test("ปุ่มสูงอย่างน้อย 48px แต่ขยายตามข้อความที่ตัดบรรทัดบนจอแคบได้ (ไม่ใช้ height ตายตัว)", () => {
    assert.equal(declOf(".btn", "min-height"), "48px")
    assert.equal(declOf(".btn", "height"), undefined)
  })

  test("กล่องสถานะบนจอ ≤ 519px ลด padding ด้านข้าง ให้ปุ่มในกล่องมีที่พอ (จอ 280px)", () => {
    const narrow = declOf(".state", "padding", "(max-width: 519px)")
    assert.ok(narrow, "ต้องมี padding เฉพาะจอแคบ")
    assert.ok(Number(/^\d+px (\d+)px$/.exec(narrow)?.[1]) <= 16, narrow)
  })

  test("ปุ่มที่ปิดใช้งานไม่มีแสงเรือง และ hover ของปุ่มทุกแบบไม่ติดกับปุ่มที่ปิดอยู่ (ดูแล้วรู้ว่ากดไม่ได้)", () => {
    assert.equal(declOf(".btn:disabled", "box-shadow"), "none")
    assert.equal(declOf(".btn:disabled", "cursor"), "not-allowed")
    const hovers = rules.flatMap((rule) => rule.selectors).filter((selector) => selector.startsWith(".btn") && selector.includes(":hover"))
    assert.ok(hovers.length >= 2, `พบ ${hovers.length} ตัว`)
    for (const selector of hovers) assert.ok(selector.endsWith(":not(:disabled)"), selector)
  })
})

// ───────────────────────── การเข้าถึง ─────────────────────────

describe("การเข้าถึง", () => {
  test("ที่ไหนซ่อนกรอบโฟกัส (outline: none/0) ต้องเป็นที่ที่มีกรอบทดแทนหรือโฟกัสด้วยคีย์บอร์ดไม่ได้", () => {
    const removed = rules.filter((rule) => ["none", "0"].includes(rule.decls.outline ?? "")).flatMap((rule) => rule.selectors)
    assert.deepEqual(removed.sort(), [".main:focus", ".search input"])
    // .search input ซ่อนกรอบของช่องกรอก เพราะกรอบไปอยู่ที่ฟอร์มทั้งอัน
    assert.match(declOf(".search:focus-within", "outline") ?? "", /^2px solid var\(--accent\)$/)
  })

  test("ลิงก์ข้ามไปเนื้อหาซ่อนนอกจอจนกว่าจะได้โฟกัส แล้วเลื่อนเข้ามาเหนือแถบบน", () => {
    assert.match(declOf(".skip-link", "top") ?? "", /^-\d+px$/)
    assert.equal(declOf(".skip-link:focus", "top"), "12px")
    assert.ok(Number(declOf(".skip-link", "z-index")) > Number(declOf(".top", "z-index")))
  })

  test("เมนูธีมลอยเหนือเนื้อหา (z-index สูงกว่า) และชิดขอบขวาของปุ่ม", () => {
    assert.equal(declOf(".theme-menu", "position"), "relative")
    assert.equal(declOf(".theme-list", "position"), "absolute")
    assert.equal(declOf(".theme-list", "right"), "0")
    assert.ok(Number(declOf(".theme-list", "z-index")) > 0)
  })
})

// ───────────────────────── ค่าที่เห็นได้ในเบราว์เซอร์เท่านั้น (ตรึงไว้กันแก้พลาด) ─────────────────────────

describe("ตำแหน่ง ขนาด และการตัดขอบที่เบราว์เซอร์เป็นคนวาด", () => {
  const px = (value: string | undefined) => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? "")
    assert.ok(match, `ต้องเป็นหน่วย px: ${value}`)
    return Number(match[1])
  }

  test("ป้ายมุมล่างอยู่คนละมุม: จบแล้วซ้ายล่าง ร่างขวาล่าง (ไม่ซ้อนกันเมื่อมีทั้งคู่)", () => {
    assert.equal(declOf(".b-done", "left"), "9px")
    assert.equal(declOf(".b-done", "right"), undefined)
    assert.equal(declOf(".b-draft", "right"), "9px")
    assert.equal(declOf(".b-draft", "left"), undefined)
  })

  test("ป้ายทุกชนิดลอยเหนือรูปปก/เงาของปกอัตโนมัติ (z-index สูงกว่าทุกชั้นในปก)", () => {
    const inCover = rules
      .filter((rule) => rule.selectors.some((selector) => selector.startsWith(".cv")))
      .map((rule) => Number(rule.decls["z-index"] ?? 0))
    const floor = Math.max(0, ...inCover)
    for (const badge of [".b-top", ".b-done", ".b-draft"]) {
      assert.ok(Number(declOf(badge, "z-index")) > floor, `${badge}: z-index ต้องสูงกว่า ${floor}`)
    }
    assert.ok(inCover.some((z) => z > 0), "ชื่อเรื่องบนปกมี z-index ของตัวเอง (ตัวเทียบนี้ยังใช้ได้)")
  })

  test("แถบบนเกาะติดขอบบนเมื่อเลื่อนหน้า และลอยเหนือเนื้อหา", () => {
    assert.equal(declOf(".top", "position"), "sticky")
    assert.equal(declOf(".top", "top"), "0")
    assert.ok(Number(declOf(".top", "z-index")) >= 5)
  })

  test("โลโก้: ตัว K ไม่ถูกบีบ (flex: none) และชื่อเว็บไม่ตัดบรรทัด (nowrap + … เมื่อยาวเกิน)", () => {
    assert.equal(declOf(".logo .mark", "flex"), "none")
    assert.equal(declOf(".logo .logo-name", "white-space"), "nowrap")
  })

  test("เนื้อหาหลักยืดเต็มที่ว่างของหน้า (ดันท้ายเว็บลงล่างสุดแม้หน้าสั้น) และหน้าสูงเต็มจอ (มีค่าสำรองก่อน dvh)", () => {
    assert.equal(declOf(".main", "flex"), "1 0 auto")
    assert.equal(declOf("#root", "display"), "flex")
    assert.equal(declOf("#root", "flex-direction"), "column")
    assert.equal(declOf("#root", "min-height"), "100dvh")
    assert.match(publicCss, /#root \{[^}]*min-height: 100vh;\s*min-height: 100dvh;/)
  })

  test("ความกว้างหน้า 1160px (ค่าจากต้นแบบ design-reference) กึ่งกลางหน้าและมีขอบข้าง", () => {
    assert.equal(declOf(".wrap", "max-width"), "1160px")
    assert.equal(declOf(".wrap", "width"), "100%")
    assert.equal(declOf(".wrap", "margin-inline"), "auto")
    assert.equal(declOf(".wrap", "padding-inline"), "24px")
  })

  test("โครงจำลองปกมีสัดส่วนเดียวกับปกจริง (2:3) — ตอนโหลดเสร็จเนื้อหาไม่กระโดด", () => {
    assert.equal(declOf(".sk-cover", "aspect-ratio"), declOf(".cv", "aspect-ratio"))
    assert.equal(declOf(".sk-cover", "aspect-ratio"), "2 / 3")
  })

  test("กรอบปกในการ์ดตัดส่วนเกินตามมุมโค้ง (รูปปกกับเงาไม่ล้นมุม) และเป็นที่อ้างอิงตำแหน่งของป้าย", () => {
    assert.equal(declOf(".card .box", "overflow"), "hidden")
    assert.equal(declOf(".card .box", "position"), "relative")
  })

  test("ปุ่มไอคอนเป็นวงกลม 42px (กว้าง = สูง) และไม่ถูกบีบ", () => {
    assert.equal(declOf(".iconbtn", "width"), "42px")
    assert.equal(declOf(".iconbtn", "height"), declOf(".iconbtn", "width"))
    assert.equal(declOf(".iconbtn", "flex"), "none")
    assert.equal(declOf(".iconbtn", "border-radius"), "999px")
  })

  test("สวิตช์: ตัวเลื่อนวิ่งจากซ้ายสุดถึงขวาสุดพอดี (ระยะห่างจากขอบสองข้างเท่ากัน)", () => {
    const outer = px(declOf(".switch-track", "width"))
    const border = px(declOf(".switch-track", "border")?.split(" ")[0])
    const thumb = px(declOf(".switch-thumb", "width"))
    assert.equal(px(declOf(".switch-thumb", "height")), thumb)
    const inset = px(declOf(".switch-thumb", "left"))
    const travel = px(/translateX\((\d+px)\)/.exec(declOf(".switch.on .switch-thumb", "transform") ?? "")?.[1])
    assert.equal(inset + travel + thumb, outer - 2 * border - inset)
  })

  test("ข้อความบทอ่าน (.prose-text) รักษาการขึ้นบรรทัดของต้นฉบับ (pre-wrap) และตัดคำยาวไม่ให้ล้นจอ", () => {
    assert.equal(declOf(".prose-text", "white-space"), "pre-wrap")
    assert.equal(declOf(".prose-text", "overflow-wrap"), "anywhere")
  })

  test("ทุก animation ที่ใช้มี @keyframes ชื่อเดียวกันอยู่จริง (พิมพ์ชื่อผิดแล้วแอนิเมชันเงียบหาย)", () => {
    const keyframes = new Set([...publicCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]))
    assert.ok(keyframes.size > 0)
    const used = rules
      .flatMap((rule) => [rule.decls.animation, rule.decls["animation-name"]])
      .filter((value): value is string => value !== undefined)
      .map((value) => value.split(" ")[0])
    assert.ok(used.length > 0)
    for (const name of used) assert.ok(keyframes.has(name) || globalKeyframes.has(name), `ไม่มี @keyframes ${name}`)
  })
})

// ───────────────────────── หน้าแรก: โครงที่เบราว์เซอร์เป็นคนวาด (ตรึงไว้กันแก้พลาด) ─────────────────────────
// ค่าความสวยล้วนๆ (ระยะห่าง ขนาดตัวอักษร มุมโค้ง สี) ไม่ตรึง — ตรวจด้วยตาจากภาพจริง; ที่ตรึงคือค่าที่ถ้าผิดแล้วหน้าพัง/ล้น/ซ้อนผิดชั้น

const maxWidthOf = (media: string | null) => (media === null ? Number.POSITIVE_INFINITY : Number(/max-width: (\d+)px/.exec(media)?.[1] ?? Number.NaN))
/** ค่าที่ใช้จริงที่ความกว้างหน้าจอ `width` (กฎ media หลังชนะกฎก่อนตามลำดับในไฟล์ ซึ่งเรียงจากกว้างไปแคบ) */
const at = (selector: string, property: string, width: number): string | undefined =>
  rules
    .filter((rule) => rule.selectors.includes(selector) && maxWidthOf(rule.media) >= width)
    .map((rule) => rule.decls[property])
    .filter((value): value is string => value !== undefined)
    .at(-1)
const px = (value: string | undefined): number => {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value ?? "")
  assert.ok(match, `ต้องเป็นหน่วย px: ${value}`)
  return Number(match[1])
}

describe("หน้าแรก: โครง Hero และการซ้อนชั้น", () => {
  test("หน้านี้เรียงเป็นคอลัมน์เดียวต่อกัน (.home flex column)", () => {
    assert.equal(declOf(".home", "display"), "flex")
    assert.equal(declOf(".home", "flex-direction"), "column")
  })

  test("Hero เป็นกรอบอ้างอิงตำแหน่งที่ตัดส่วนที่ล้น (พื้นหลังเบลอขยายเกินกรอบต้องไม่โผล่ออกมา)", () => {
    assert.equal(declOf(".hero", "position"), "relative")
    assert.equal(declOf(".hero", "overflow"), "hidden")
    assert.equal(declOf(".hero", "display"), "flex")
    assert.equal(declOf(".hero", "align-items"), "center")
  })

  test("ชั้นซ้อน: พื้นหลังเบลอ และฉากเฟด วางเต็มกรอบ (absolute); เนื้อหา (.hero-body) เป็น relative และอยู่หลังสุดใน DOM จึงอยู่บนสุด", () => {
    for (const layer of [".hero-bg", ".hero-shade"]) assert.equal(declOf(layer, "position"), "absolute", layer)
    assert.equal(declOf(".hero-shade", "inset"), "0")
    assert.equal(declOf(".hero-body", "position"), "relative")
    assert.equal(declOf(".hero-body", "width"), "100%")
    assert.equal(declOf(".hero-bg", "overflow"), "hidden")
    assert.match(declOf(".hero-bg", "filter") ?? "", /^blur\(\d+px\)/, "พื้นหลังเป็นปกเบลอ")
    assert.match(declOf(".hero-bg", "transform") ?? "", /^scale\(1\.\d+\)$/, "ขยายเล็กน้อยให้ขอบเบลอไม่โผล่")
    // ปกในพื้นหลังจัดกลางแนวตั้ง
    assert.equal(declOf(".hero-bg .cv", "position"), "absolute")
    assert.equal(declOf(".hero-bg .cv", "top"), "50%")
    assert.equal(declOf(".hero-bg .cv", "transform"), "translateY(-50%)")
  })

  test("ฉากเฟดใช้สีพื้นของธีม (ตามธีมทุกธีม) ทั้งแนวนอนและแนวตั้ง — ไม่ฝังสีตายตัว", () => {
    const background = declOf(".hero-shade", "background") ?? ""
    assert.match(background, /linear-gradient\(90deg/)
    assert.match(background, /linear-gradient\(0deg/)
    assert.doesNotMatch(background, /#[0-9a-f]{3,8}\b|rgba?\(/i)
    assert.ok((background.match(/var\(--bg\)|var\(--bg\) \d+%/g) ?? []).length >= 3)
  })

  test("Hero สองคอลัมน์ (ข้อความ | โปสเตอร์) กว้างเท่าโปสเตอร์ทุกจุดตัด; จอ ≤ 719 คอลัมน์เดียวและซ่อนโปสเตอร์", () => {
    for (const width of [1280, 1099, 959]) {
      const columns = at(".hero-body", "grid-template-columns", width) ?? ""
      assert.equal(columns, `minmax(0, 1fr) ${at(".poster", "width", width)}`, `ที่ ${width}px`)
    }
    for (const width of [719, 519, 359]) {
      assert.equal(at(".hero-body", "grid-template-columns", width), "minmax(0, 1fr)", `ที่ ${width}px`)
      assert.equal(at(".poster", "display", width), "none", `ที่ ${width}px`)
    }
    for (const width of [1280, 1099, 959]) assert.notEqual(at(".poster", "display", width), "none", `ที่ ${width}px`)
    assert.equal(declOf(".hero-text", "min-width"), "0", "ชื่อเรื่องยาวต้องไม่ดันคอลัมน์ให้กว้างเกินกรอบ")
    assert.equal(declOf(".hero-title", "overflow-wrap"), "anywhere")
  })

  test("โปสเตอร์เอียงและตัดขอบตามมุมโค้ง", () => {
    assert.match(declOf(".poster", "transform") ?? "", /^rotate\(\d+(\.\d+)?deg\)$/)
    assert.equal(declOf(".poster", "overflow"), "hidden")
    assert.equal(declOf(".poster", "justify-self"), "center")
  })

  test("เรื่องย่อบน Hero ตัดที่ 3 บรรทัด (spec 6.1) ด้วยกล่อง webkit", () => {
    assert.equal(declOf(".hero-syn", "-webkit-line-clamp"), "3")
    assert.equal(declOf(".hero-syn", "display"), "-webkit-box")
    assert.equal(declOf(".hero-syn", "-webkit-box-orient"), "vertical")
    assert.equal(declOf(".hero-syn", "overflow"), "hidden")
  })

  test("พื้นหลังเบลอยื่นออกนอกกรอบมากกว่ารัศมีเบลอ (ขอบที่จางจากการเบลอถูก .hero ตัดทิ้ง ไม่เห็นเป็นเส้นโปร่งใส)", () => {
    const blur = Number(/^blur\((\d+)px\)/.exec(declOf(".hero-bg", "filter") ?? "")?.[1])
    assert.ok(blur > 0)
    assert.ok(-px(declOf(".hero-bg", "inset")) >= blur, `inset ${declOf(".hero-bg", "inset")} ต้องยื่นออกอย่างน้อย ${blur}px`)
  })

  test("คอนเทนเนอร์ที่ใช้ flex-wrap / align-items ต้องเป็น flex จริง (ไม่เช่นนั้นค่าที่ตรึงไว้ไม่มีผล)", () => {
    for (const [selector, display] of [
      [".hero-facts", "flex"],
      [".hero-cta", "flex"],
      [".hero-tag", "inline-flex"],
      [".pill", "inline-flex"],
      [".go", "inline-flex"],
      [".sort", "inline-flex"],
    ] as const) {
      assert.equal(declOf(selector, "display"), display, selector)
    }
    for (const selector of [".hero-facts", ".hero-tag", ".pill", ".go", ".sort"]) assert.equal(declOf(selector, "align-items"), "center", selector)
  })

  test("ลิงก์ \"อ่านต่อ\" ในการ์ดไม่ยืดเต็มความกว้างการ์ด (พื้นที่กดเท่าตัวลิงก์)", () => {
    assert.equal(declOf(".go", "align-self"), "flex-start")
  })

  test("เรื่องย่อบน Hero ตัดคำยาวติดกัน (overflow-wrap) ไม่ให้ดันเกินกรอบ", () => {
    assert.equal(declOf(".hero-syn", "overflow-wrap"), "anywhere")
  })

  test("ป้ายสถานะเด่นกว่าป้ายทั่วไปด้วยสีเสริม --accent-2 (คู่สีนี้ผ่านเกณฑ์ตัดกันใน tokens.test.ts)", () => {
    assert.equal(declOf(".pill.st", "color"), "var(--accent-2)")
    assert.equal(declOf(".pill", "color"), "var(--muted)")
  })

  test("ข้อมูลใต้ชื่อ (ป้าย/ปุ่ม) ห่อบรรทัดได้ — จอแคบไม่ล้น", () => {
    assert.equal(declOf(".hero-facts", "flex-wrap"), "wrap")
    assert.equal(declOf(".hero-cta", "flex-wrap"), "wrap")
    assert.equal(declOf(".pill", "overflow-wrap"), "anywhere")
    assert.equal(declOf(".hero-sub", "overflow-wrap"), "anywhere")
  })

  test("ป้ายหัวการ์ดและป้ายสถานะ: พื้นทึบ (ไม่โปร่งใสบนปกเบลอ) ตัวอักษรยังอ่านออก", () => {
    assert.equal(declOf(".hero-tag", "background"), "var(--surface)")
    assert.equal(declOf(".pill", "background"), "var(--surface-2)")
  })
})

describe("หน้าแรก: อ่านต่อจากที่ค้างไว้", () => {
  test("การ์ดอ่านต่อ 3 คอลัมน์บนจอกว้าง แล้วเป็นคอลัมน์เดียวตั้งแต่ ≤ 959", () => {
    assert.equal(declOf(".resume", "display"), "grid")
    assert.equal(declOf(".resume", "grid-template-columns"), "repeat(3, minmax(0, 1fr))")
    assert.equal(declOf(".resume", "grid-template-columns", "(max-width: 959px)"), "minmax(0, 1fr)")
  })

  test("ปกเล็กไม่ถูกบีบและไม่ยืด; ข้อความหดได้ (ชื่อยาวไม่ดันการ์ดให้ล้น)", () => {
    assert.equal(declOf(".rcard", "display"), "flex")
    assert.equal(declOf(".rcard", "min-width"), "0")
    assert.equal(declOf(".rcard-th", "flex"), "none")
    assert.match(declOf(".rcard-th", "width") ?? "", /^\d+px$/)
    assert.equal(declOf(".rcard-th", "align-self"), "flex-start")
    assert.equal(declOf(".rcard-th", "overflow"), "hidden")
    assert.equal(declOf(".rcard-tx", "flex"), "1")
    assert.equal(declOf(".rcard-tx", "min-width"), "0")
    assert.equal(declOf(".rcard-tx", "flex-direction"), "column")
    assert.equal(declOf(".rcard h3", "-webkit-line-clamp"), "2")
    assert.equal(declOf(".rcard h3", "overflow-wrap"), "anywhere")
  })

  test("แถบความคืบหน้า: รางมีความสูงและตัดส่วนเกิน; แท่งเต็มความสูงของราง (ความกว้างมาจาก style ในโค้ด)", () => {
    assert.ok(Number.parseInt(declOf(".bar", "height") ?? "0", 10) >= 4)
    assert.equal(declOf(".bar", "overflow"), "hidden")
    assert.equal(declOf(".bar", "margin-top"), "auto", "ดันแถบลงล่างสุดของการ์ด ให้แนวเดียวกันเมื่อชื่อยาวสั้นต่างกัน")
    assert.equal(declOf(".bar i", "display"), "block")
    assert.equal(declOf(".bar i", "height"), "100%")
    assert.equal(declOf(".bar i", "width"), undefined, "ความกว้างต้องมาจาก inline style ตามเปอร์เซ็นต์ ไม่ใช่ CSS")
  })
})

describe("หน้าแรก: แถว 'อัปเดตล่าสุด' เลื่อนข้าง", () => {
  const WIDTHS = [1280, 1099, 959, 719, 519, 359] as const

  test("เป็นแถวเดียวที่เลื่อนแนวนอนได้และการ์ดไม่หด (flex: none) พร้อมจุดหยุดเลื่อนที่ต้นการ์ด", () => {
    assert.equal(declOf(".row", "display"), "flex")
    assert.equal(declOf(".row", "overflow-x"), "auto")
    assert.match(declOf(".row", "scroll-snap-type") ?? "", /^x (proximity|mandatory)$/)
    assert.equal(declOf(".row > .card", "flex"), "none")
    assert.equal(declOf(".row > .card", "scroll-snap-align"), "start")
  })

  test("ขอบแถวเลื่อนตรงกับขอบหน้า: margin ติดลบ = ขอบข้างของ .wrap, padding และ scroll-padding เท่ากัน (การ์ดแรกชิดแนวหัวข้อ ไม่ทำให้หน้าล้น) ทุกจุดตัด", () => {
    for (const width of WIDTHS) {
      const gutter = px(at(".wrap", "padding-inline", width))
      assert.equal(px(at(".row", "margin-inline", width)), -gutter, `margin-inline ที่ ${width}px`)
      assert.equal(px(at(".row", "padding-inline", width) ?? at(".row", "padding", width)?.split(" ")[1]), gutter, `padding-inline ที่ ${width}px`)
      assert.equal(px(at(".row", "scroll-padding-inline", width)), gutter, `scroll-padding-inline ที่ ${width}px`)
    }
  })

  test("ความกว้างการ์ดในแถว: จอ ≥ 720 เท่าช่องของตาราง (6/4 คอลัมน์ เว้นช่องไฟเท่ากัน — แนวตรงกับตารางด้านล่าง); จอเล็กเห็นการ์ดสุดท้ายโผล่ครึ่งใบให้รู้ว่าเลื่อนได้", () => {
    const columnsOf = (width: number) => Number(/^repeat\((\d+), /.exec(at(".grid", "grid-template-columns", width) ?? "")?.[1])
    const cardWidth = (width: number) => {
      const match = /^calc\(\(100% - (\d+(?:\.\d+)?)px\) \/ (\d+(?:\.\d+)?)\)$/.exec(at(".row > .card", "width", width) ?? "")
      assert.ok(match, `ความกว้างการ์ดที่ ${width}px: ${at(".row > .card", "width", width)}`)
      return { gaps: Number(match[1]), count: Number(match[2]) }
    }
    const rowGap = (width: number) => px(at(".row", "gap", width))
    const gridGap = (width: number) => px((at(".grid", "gap", width) ?? "").split(" ").at(-1))
    for (const width of [1280, 1099, 959]) {
      const { gaps, count } = cardWidth(width)
      assert.equal(count, columnsOf(width), `จำนวนการ์ดที่เห็น = จำนวนคอลัมน์ ที่ ${width}px`)
      assert.equal(rowGap(width), gridGap(width), `ช่องไฟแถว = ช่องไฟตาราง ที่ ${width}px`)
      assert.equal(gaps, rowGap(width) * (count - 1), `ช่องไฟรวม ที่ ${width}px`)
    }
    for (const width of [719, 519, 359]) {
      const { gaps, count } = cardWidth(width)
      assert.ok(count % 1 !== 0 && count < columnsOf(width) + 1 && count > columnsOf(width) - 1, `จอเล็ก: เห็นการ์ดเศษส่วน ที่ ${width}px (ได้ ${count} ช่อง; ตาราง ${columnsOf(width)} คอลัมน์)`)
      assert.equal(gaps, rowGap(width) * (Math.ceil(count) - 1), `ช่องไฟรวม ที่ ${width}px`)
    }
  })

  test("แถวเลื่อนตัดแนวตั้งด้วย (overflow-x ≠ visible บังคับ overflow-y) จึงต้องเผื่อที่ให้เงา/การยกของการ์ด: padding บน ≥ 4px, ล่าง ≥ 16px และดึง margin-bottom ติดลบคืนไม่เกินที่เผื่อ (ระยะห่างถึงส่วนถัดไปไม่ติดลบ)", () => {
    const [top, , bottom] = (declOf(".row", "padding") ?? "").split(" ")
    assert.ok(px(top) >= 4, `padding บน ${top}`)
    assert.ok(px(bottom) >= 16, `padding ล่าง ${bottom}`)
    const pull = px(declOf(".row", "margin-bottom"))
    assert.ok(pull <= 0, "margin-bottom ไม่เป็นบวก")
    assert.ok(-pull <= px(bottom), "ดึงคืนได้ไม่เกินที่ padding ล่างเผื่อไว้")
  })
})

describe("หน้าแรก: แถบตัวกรองและปุ่มแสดงเพิ่ม", () => {
  test("แถบกรองห่อบรรทัดได้ จัดสองฝั่ง; ปุ่มเรียงไม่ตัดคำ; ปุ่มแสดงเพิ่มอยู่กลางหน้า", () => {
    assert.equal(declOf(".lib-bar", "display"), "flex")
    assert.equal(declOf(".lib-bar", "flex-wrap"), "wrap")
    assert.equal(declOf(".lib-bar", "justify-content"), "space-between")
    assert.equal(declOf(".sort-label", "white-space"), "nowrap")
    assert.equal(declOf(".more", "display"), "flex")
    assert.equal(declOf(".more", "justify-content"), "center")
  })

  test("ช่องเลือกเรียงกำหนดสีตัวอักษรคู่กับสีพื้นเองจากธีม (select ของระบบไม่ตามธีมมืด)", () => {
    assert.equal(declOf(".sort select", "color"), "var(--text)")
    assert.equal(declOf(".sort select", "background"), "var(--surface)")
  })

  test("ช่องเลือกเรียงแตะง่าย (สูง ≥ 40px) และแท็กชิปในแถบไม่เว้นล่างซ้ำสองชั้น", () => {
    assert.ok(Number.parseInt(declOf(".sort select", "min-height") ?? "0", 10) >= 40)
    assert.equal(declOf(".lib-bar .chips", "margin-bottom"), "0")
  })
})

// ───────────────────────── หน้าเรื่อง: โครงที่เบราว์เซอร์เป็นคนวาด (ตรึงไว้กันแก้พลาด) ─────────────────────────
// เช่นเดียวกับหน้าแรก: ค่าความสวยล้วนๆ (ระยะห่าง ขนาดตัวอักษร มุมโค้ง เงา) ไม่ตรึง — ตรวจด้วยตาจากภาพจริง

describe("หน้าเรื่อง: โครงหน้าและเรื่องย่อ", () => {
  test("เนื้อหาหน้าเรื่องเป็นคอลัมน์เดียวกว้างไม่เกิน 960px จัดกลาง (บรรทัดเรื่องย่อไม่ยาวเกินอ่าน)", () => {
    assert.equal(declOf(".novel", "display"), "flex")
    assert.equal(declOf(".novel", "flex-direction"), "column")
    assert.equal(declOf(".novel", "max-width"), "960px")
    assert.equal(declOf(".novel", "width"), "100%")
    assert.equal(declOf(".novel", "margin-inline"), "auto")
  })

  test("หัวเรื่อง: ปก | ข้อมูล สองคอลัมน์ที่คอลัมน์ข้อมูลหดได้ (minmax(0, 1fr)) — ชื่อ 80 ตัวอักษรไม่ดันหน้าให้ล้น; จอ ≤ 719 คอลัมน์เดียวและปกกว้างพอดีจัดกลาง", () => {
    for (const width of [1280, 1099, 959]) {
      assert.match(at(".nv-head", "grid-template-columns", width) ?? "", /^\d+px minmax\(0, 1fr\)$/, `ที่ ${width}px`)
    }
    for (const width of [719, 519, 359]) assert.equal(at(".nv-head", "grid-template-columns", width), "minmax(0, 1fr)", `ที่ ${width}px`)
    assert.ok(px(/^(\d+px)/.exec(at(".nv-head", "grid-template-columns", 959) ?? "")?.[1]) < px(/^(\d+px)/.exec(at(".nv-head", "grid-template-columns", 1280) ?? "")?.[1]), "แท็บเล็ตปกเล็กลง")
    assert.equal(declOf(".nv-head", "align-items"), "start", "ปกไม่ถูกยืดตามความสูงของคอลัมน์ข้อมูล")
    assert.equal(declOf(".nv-info", "min-width"), "0")
    assert.ok(px(at(".nv-cover", "width", 719)) <= 200)
    assert.equal(at(".nv-cover", "margin-inline", 719), "auto")
    assert.equal(at(".nv-cover", "width", 1280), undefined, "จอกว้างความกว้างปกมาจากคอลัมน์")
  })

  test("ชื่อและบรรทัดข้อมูลตัดคำยาวติดกันได้ · ป้าย/แท็ก/ปุ่มห่อบรรทัด", () => {
    for (const selector of [".nv-title", ".nv-orig", ".nv-author", ".nv-h", ".nv-syn", ".credit-row dd"]) assert.equal(declOf(selector, "overflow-wrap"), "anywhere", selector)
    for (const selector of [".nv-facts", ".nv-tags", ".nv-cta"]) {
      assert.equal(declOf(selector, "display"), "flex", selector)
      assert.equal(declOf(selector, "flex-wrap"), "wrap", selector)
    }
    assert.equal(declOf(".nv-facts", "align-items"), "center")
  })

  test("บนมือถือปุ่มอ่านซ้อนเป็นแถวเต็มความกว้าง: สองปุ่มรวมช่องไฟกว้างกว่าพื้นที่ของจอ 360px", () => {
    const basis = px(/^1 1 (\d+px)$/.exec(at(".nv-cta .btn", "flex", 719) ?? "")?.[1])
    const content = 360 - 2 * px(at(".wrap", "padding-inline", 359))
    assert.ok(2 * basis + px(declOf(".nv-cta", "gap")) > content, `2×${basis}+gap ต้องกว้างกว่า ${content}`)
    assert.ok(basis <= content)
    assert.equal(at(".nv-cta .btn", "flex", 1280), undefined)
  })

  test("เรื่องย่อพับ 5 บรรทัด (ค่าเดียวกับ SYNOPSIS_LINES) ด้วยกล่อง webkit; ขึ้นบรรทัดตามที่พิมพ์; ขยายแล้วไม่ตัด", () => {
    assert.equal(declOf(".nv-syn", "-webkit-line-clamp"), String(SYNOPSIS_LINES))
    assert.equal(declOf(".nv-syn", "display"), "-webkit-box")
    assert.equal(declOf(".nv-syn", "-webkit-box-orient"), "vertical")
    assert.equal(declOf(".nv-syn", "overflow"), "hidden")
    assert.equal(declOf(".nv-syn", "white-space"), "pre-line")
    assert.equal(declOf(".nv-syn.open", "display"), "block", "display: block ยกเลิกการตัดบรรทัด")
    assert.equal(declOf(".nv-syn.open", "overflow"), "visible")
  })

  test("ปุ่ม 'อ่านเพิ่ม' กดง่าย (สูง ≥ 40px) · หัวข้อที่เลื่อนมาถึงไม่ถูกแถบบนบัง", () => {
    assert.ok(px(declOf(".nv-more", "min-height")) >= 40)
    assert.match(declOf(".nv-h", "scroll-margin-top") ?? "", /var\(--header-h\)/)
  })
})

describe("หน้าเรื่อง: กล่องเครดิต", () => {
  test("แถวเครดิต: ป้าย | ค่า สองคอลัมน์ที่ค่าหดได้ ทุกจุดตัด (ลิงก์ต้นฉบับยาวไม่ดันกล่องล้น)", () => {
    for (const width of [1280, 959, 719, 519, 359]) {
      assert.match(at(".credit-row", "grid-template-columns", width) ?? "", /^\d+px minmax\(0, 1fr\)$/, `ที่ ${width}px`)
    }
    assert.equal(declOf(".credit-row dd", "min-width"), "0")
    assert.ok(px(/^(\d+px)/.exec(at(".credit-row", "grid-template-columns", 519) ?? "")?.[1]) < px(/^(\d+px)/.exec(at(".credit-row", "grid-template-columns", 1280) ?? "")?.[1]))
    assert.equal(declOf(".credit-list", "width"), "100%", "รายการเต็มความกว้างกล่อง แม้กล่องจัดชิดซ้าย (align-items: flex-start)")
    assert.equal(declOf(".credit", "align-items"), "flex-start")
  })

  test("บันทึกสิทธิ์ขึ้นบรรทัดตามที่เจ้าของพิมพ์", () => {
    assert.equal(declOf(".credit-license", "white-space"), "pre-line")
  })

  test("สีป้าย AI และลิงก์ใช้โทเค็นที่ผ่านเกณฑ์ตัดกันบนพื้นกล่อง (accent-2 บน surface-2, accent บน surface)", () => {
    assert.equal(declOf(".ai-badge", "color"), "var(--accent-2)")
    assert.equal(declOf(".ai-badge", "background"), "var(--surface-2)")
    assert.equal(declOf(".credit", "background"), "var(--surface)")
    assert.equal(declOf(".credit-row a", "color"), "var(--accent)")
    assert.equal(declOf(".credit-report", "color"), "var(--accent)")
  })

  test("ลิงก์ในกล่องเครดิตขีดเส้นใต้ (ไม่พึ่งสีอย่างเดียว) และ 'แจ้งลบเนื้อหา' กดง่าย (สูง ≥ 40px)", () => {
    assert.equal(declOf(".credit-row a", "text-decoration"), "underline")
    assert.equal(declOf(".credit-report", "text-decoration"), "underline")
    assert.ok(px(declOf(".credit-report", "min-height")) >= 40)
    assert.equal(declOf(".credit-report", "display"), "inline-flex")
  })
})

describe("หน้าเรื่อง: รายการตอน", () => {
  test("รายการเป็นกริดคอลัมน์เดียวไม่มีจุดนำหน้าและไม่มีระยะขอบของ ol", () => {
    assert.equal(declOf(".ch-list", "display"), "grid")
    assert.equal(declOf(".ch-list", "list-style"), "none")
    assert.equal(declOf(".ch-list", "margin"), "0")
    assert.equal(declOf(".ch-list", "padding"), "0")
  })

  test("ทั้งแถวเป็นลิงก์ที่กดง่าย (สูง ≥ 44px) ทุกจุดตัด", () => {
    for (const width of [1280, 959, 719, 519, 359]) assert.ok(px(at(".ch-link", "min-height", width)) >= 44, `ที่ ${width}px`)
    assert.equal(declOf(".ch-link", "display"), "flex")
    assert.equal(declOf(".ch-link", "align-items"), "center")
  })

  test("ชื่อตอนหดได้และตัดที่ 2 บรรทัด; เลขตอนกับข้อมูลท้ายแถวไม่ถูกบีบ", () => {
    assert.equal(declOf(".ch-title", "flex"), "1")
    assert.equal(declOf(".ch-title", "min-width"), "0")
    assert.equal(declOf(".ch-title", "-webkit-line-clamp"), "2")
    assert.equal(declOf(".ch-title", "overflow-wrap"), "anywhere")
    assert.equal(declOf(".ch-num", "flex"), "none")
    assert.equal(declOf(".ch-meta", "flex"), "none")
    assert.equal(declOf(".ch-meta", "white-space"), "nowrap")
    assert.equal(declOf(".ch-meta", "margin-left"), "auto")
  })

  test("จอ ≤ 519: แถวเป็นกริด 2 คอลัมน์ — เลขตอนซ้ายบน ข้อมูลขวาบน ชื่อตอนเต็มความกว้างแถวที่สอง (ไม่ไปตกคอลัมน์ขวา)", () => {
    assert.equal(declOf(".ch-link", "display", "(max-width: 519px)"), "grid")
    assert.equal(declOf(".ch-link", "grid-template-columns", "(max-width: 519px)"), "minmax(0, 1fr) auto")
    assert.equal(declOf(".ch-num", "grid-column", "(max-width: 519px)"), "1")
    assert.equal(declOf(".ch-num", "grid-row", "(max-width: 519px)"), "1")
    assert.equal(declOf(".ch-meta", "grid-column", "(max-width: 519px)"), "2")
    assert.equal(declOf(".ch-meta", "grid-row", "(max-width: 519px)"), "1")
    assert.equal(declOf(".ch-title", "grid-column", "(max-width: 519px)"), "1 / -1")
    assert.equal(declOf(".ch-title", "grid-row", "(max-width: 519px)"), "2")
    assert.equal(declOf(".ch-link", "display", "(max-width: 719px)"), undefined, "ระหว่าง 520–719 ยังเป็นแถวเดียว")
  })

  test("ตอนที่อ่านล่าสุดมีกรอบสี accent + ป้ายข้อความ; ตอนที่กระโดดไปหามีเส้นขอบนอกสี accent-2 (คนละแบบกัน ซ้อนกันได้)", () => {
    assert.equal(declOf(".ch-row.last", "border-color"), "var(--accent)")
    assert.match(declOf(".ch-row.jump", "outline") ?? "", /^\d+px solid var\(--accent-2\)$/)
    assert.ok(px(declOf(".ch-row.jump", "outline-offset")) >= 1, "เส้นขอบนอกไม่ชนกรอบแถว")
    assert.equal(declOf(".ch-tag", "background"), "var(--accent)")
    assert.equal(declOf(".ch-tag", "color"), "var(--accent-ink)")
  })

  test("วางเมาส์ไฮไลต์แถวเฉพาะอุปกรณ์ที่มีเมาส์ (hover: hover) — จอสัมผัสไม่ค้างสถานะ hover", () => {
    assert.ok(declOf(".ch-row:hover", "border-color", "(hover: hover)"))
    assert.equal(rulesFor(".ch-row:hover").length, 0)
  })

  test("แถบเครื่องมือห่อบรรทัด จัดสองฝั่ง; จอ ≤ 719 ซ้อนเป็นแถวเต็มและช่องกรอกยืดได้โดยไม่ล้น", () => {
    assert.equal(declOf(".ch-bar", "display"), "flex")
    assert.equal(declOf(".ch-bar", "flex-wrap"), "wrap")
    assert.equal(declOf(".ch-bar", "justify-content"), "space-between")
    assert.equal(declOf(".ch-bar", "flex-direction", "(max-width: 719px)"), "column")
    assert.equal(declOf(".ch-bar", "align-items", "(max-width: 719px)"), "stretch")
    // column + wrap = แถวเดียวที่กว้างเท่า max-content ของช่องไปตอน (≈330px) → ล้นจอ 320px; column ต้องไม่ wrap เพื่อให้กว้างเท่าคอนเทนเนอร์และช่องกรอกหดได้
    assert.equal(declOf(".ch-bar", "flex-wrap", "(max-width: 719px)"), "nowrap")
    assert.equal(declOf(".ch-jump", "display"), "flex")
    assert.equal(declOf(".ch-jump", "align-items"), "center")
    assert.equal(declOf(".ch-jump input", "flex", "(max-width: 719px)"), "1")
    assert.equal(declOf(".ch-jump input", "min-width", "(max-width: 719px)"), "0")
    assert.equal(declOf(".ch-jump input", "width", "(max-width: 719px)"), "auto")
    assert.equal(declOf(".ch-jump label", "white-space"), "nowrap")
  })

  test("ช่องกรอกเลขตอนและปุ่ม 'ไป' กดง่าย (สูง ≥ 40px) · สีตัวอักษรคู่กับสีพื้นจากธีม · ช่องที่ผิดเปลี่ยนสีขอบ", () => {
    assert.ok(px(declOf(".ch-jump input", "min-height")) >= 40)
    assert.ok(px(declOf(".ch-jump .btn", "min-height")) >= 40)
    assert.equal(declOf(".ch-jump input", "color"), "var(--text)")
    assert.equal(declOf(".ch-jump input", "background"), "var(--surface)")
    assert.equal(declOf('.ch-jump input[aria-invalid="true"]', "border-color"), "var(--accent-2)")
    assert.equal(declOf(".ch-err", "color"), "var(--accent-2)")
  })

  test("ตัวแบ่งหน้า: ปุ่มซ้าย-ข้อความกลาง-ปุ่มขวา ปุ่มกดง่าย (สูง ≥ 44px) ข้อความกลางจัดกึ่งกลาง", () => {
    assert.equal(declOf(".ch-pager", "display"), "flex")
    assert.equal(declOf(".ch-pager", "justify-content"), "space-between")
    assert.equal(declOf(".ch-pager", "align-items"), "center")
    assert.ok(px(declOf(".ch-pager .btn", "min-height")) >= 44)
    assert.equal(declOf(".ch-page", "text-align"), "center")
  })

  test("วันที่ในแถวเรียงเลขกว้างเท่ากัน (ตัวเลขตรงแนว)", () => {
    assert.equal(declOf(".ch-date", "font-variant-numeric"), "tabular-nums")
  })
})

describe("หน้าเรื่อง: โครงที่ค่าอื่นพึ่งอยู่และขนาดที่ต้องอ่านออก", () => {
  const NOVEL_RULE = /^\.(novel\b|nv-|credit|ai-badge|ch-)/
  const novelRules = rules.filter((rule) => rule.selectors.some((selector) => NOVEL_RULE.test(selector)))

  test("ชนิดการจัดวางของแต่ละกล่อง (ไม่เช่นนั้นค่า gap/grid-template/align ที่ตรึงไว้ไม่มีผล)", () => {
    const layouts: [string, string][] = [
      [".novel", "flex"],
      [".nv-head", "grid"],
      [".nv-info", "flex"],
      [".nv-facts", "flex"],
      [".nv-tags", "flex"],
      [".nv-cta", "flex"],
      [".credit", "flex"],
      [".credit-list", "grid"],
      [".credit-row", "grid"],
      [".credit-row a", "inline-flex"],
      [".ai-badge", "inline-flex"],
      [".credit-report", "inline-flex"],
      [".ch-list", "grid"],
      [".ch-link", "flex"],
      [".ch-meta", "inline-flex"],
      [".ch-pager", "flex"],
      [".ch-title", "-webkit-box"],
    ]
    for (const [selector, display] of layouts) assert.equal(declOf(selector, "display"), display, selector)
    for (const selector of [".novel", ".nv-info", ".credit"]) assert.equal(declOf(selector, "flex-direction"), "column", selector)
    assert.equal(declOf(".ch-title", "-webkit-box-orient"), "vertical")
    assert.equal(declOf(".ch-title", "overflow"), "hidden")
  })

  test("ปกตัดตามมุมโค้ง · ส่วนต่างๆ หดได้ (min-width: 0) เพื่อไม่ดันหน้าให้ล้นแนวนอน", () => {
    assert.equal(declOf(".nv-cover", "overflow"), "hidden")
    assert.equal(declOf(".nv-sec", "min-width"), "0")
    assert.equal(declOf(".nv-info", "min-width"), "0")
    assert.equal(declOf(".credit-row dd", "min-width"), "0")
    assert.equal(declOf(".ch-title", "min-width"), "0")
  })

  test("จัดกึ่งกลางแนวตั้งในแถวที่มีไอคอน/ป้ายข้างข้อความ · ข้อความว่างจัดกลาง · ช่องกรอกเลขตอนกว้างพอพิมพ์ 5–6 หลัก", () => {
    for (const selector of [".nv-facts", ".ch-bar", ".ch-jump", ".ch-link", ".ch-meta", ".ch-pager", ".credit-row a", ".ai-badge", ".credit-report"]) {
      assert.equal(declOf(selector, "align-items"), "center", selector)
    }
    assert.equal(declOf(".ch-empty", "text-align"), "center")
    assert.ok(px(declOf(".ch-jump input", "width")) >= 80)
  })

  test("กรอบที่ทำให้เห็นขอบเขตของช่องกรอก แถวตอน กล่องเครดิต ป้าย AI และกล่องว่างยังอยู่", () => {
    for (const selector of [".credit", ".ai-badge", ".ch-jump input", ".ch-row"]) assert.match(declOf(selector, "border") ?? "", /^1px solid /, selector)
    assert.match(declOf(".ch-empty", "border") ?? "", /^1px dashed /)
  })

  test("ข้อความรองใช้สี --muted (ลำดับความสำคัญของข้อความ ไม่ใช่สีเดียวกับเนื้อหา)", () => {
    for (const selector of [".nv-orig", ".nv-count", ".credit-row dt", ".ch-jump label", ".ch-meta", ".ch-page", ".ch-empty"]) {
      assert.equal(declOf(selector, "color"), "var(--muted)", selector)
    }
  })

  test("ตัวอักษรทุกกฎของหน้านี้อ่านออก (ทุกจุด ≥ 12px) เนื้อหา/ชื่อ/ปุ่มกด ≥ 14px", () => {
    let checked = 0
    for (const rule of novelRules) {
      const size = rule.decls["font-size"]
      if (size === undefined) continue
      checked += 1
      assert.ok(px(size) >= 12, `${rule.selectors.join(",")} ${size}`)
    }
    assert.ok(checked >= 20, `ตรวจ font-size ${checked} กฎ`)
    for (const selector of [".nv-title", ".nv-orig", ".nv-author", ".nv-h", ".nv-syn", ".nv-more", ".credit-row dt", ".credit-report", ".ch-jump label", ".ch-jump input", ".ch-jump .btn", ".ch-err", ".ch-num", ".ch-title", ".ch-pager .btn", ".ch-page"]) {
      assert.ok(px(declOf(selector, "font-size")) >= 14, selector)
    }
  })

  test("ช่องไฟ: ทุกกล่องที่จัดวางด้วย gap มีช่องไฟจริง · ตัวควบคุมที่กดได้ห่างกัน ≥ 8px (กดพลาดยาก)", () => {
    for (const rule of novelRules) {
      const gap = rule.decls.gap
      if (gap === undefined) continue
      for (const part of gap.split(/\s+/)) assert.ok(px(part) > 0, `${rule.selectors.join(",")} ${rule.media ?? ""} ${gap}`)
    }
    for (const selector of [".nv-cta", ".ch-jump", ".ch-list", ".ch-pager", ".ch-bar", ".nv-tags"]) {
      for (const part of (declOf(selector, "gap") ?? "").split(/\s+/)) assert.ok(px(part) >= 8, selector)
    }
  })
})

// ───────────────────────── รูปแบบไฟล์ ─────────────────────────

describe("รูปแบบไฟล์", () => {
  const all: CssRule[] = rules

  test("ไม่มีกฎซ้ำ selector ชุดเดียวกันในเงื่อนไขเดียวกัน (กฎหลังจะทับกฎก่อนโดยไม่รู้ตัว)", () => {
    const seen = new Map<string, number>()
    for (const rule of all) {
      const key = `${rule.media ?? ""}|${rule.selectors.join(",")}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    assert.deepEqual(
      [...seen].filter(([, count]) => count > 1).map(([key]) => key),
      [],
    )
  })

  test("ใช้เฉพาะ media แบบ max-width ที่เป็นจุดตัดของระบบ (1099 959 719 519 359)", () => {
    const media = new Set(all.map((rule) => rule.media).filter((value) => value !== null))
    assert.deepEqual([...media].sort(), ["(max-width: 1099px)", "(max-width: 359px)", "(max-width: 519px)", "(max-width: 719px)", "(max-width: 959px)", "(hover: hover)"].sort())
  })

  test("ไม่มี !important (สไตล์ซ้อนกันด้วยลำดับ ไม่ใช่การบังคับ)", () => {
    assert.doesNotMatch(publicCss, /!important/)
  })
})
