import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
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
/** มีสไตล์แล้วแต่ยังไม่มีคอมโพเนนต์ใช้ — สงวนไว้ให้หน้าถัดไป (งาน 24: แถวชิปกรอง, ปุ่มเต็มแถว) */
const RESERVED = ["chips", "full"]
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
    const NO_TEXT = [".switch.on .switch-track"] // แค่ราง ไม่มีข้อความข้างใน
    const painted = rules.filter((rule) => usesAccent(rule.decls.background) || usesAccent(rule.decls["background-color"]))
    assert.ok(painted.length >= 6, `พบ ${painted.length} กฎ`)
    for (const rule of painted) {
      if (rule.selectors.every((selector) => NO_TEXT.includes(selector))) continue
      assert.equal(rule.decls.color, "var(--accent-ink)", rule.selectors.join(", "))
    }
  })

  test("ข้อความสีตายตัว (#fff, rgba, ชื่อสี) มีเฉพาะบนปก/ป้ายซ้อนปกที่พื้นไม่ขึ้นกับธีม", () => {
    const OVER_COVER_ART = [".cv-title", ".b-ep", ".b-done"]
    const hardCoded = rules.filter((rule) => rule.decls.color !== undefined && !rule.decls.color.startsWith("var(") && rule.decls.color !== "inherit")
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
