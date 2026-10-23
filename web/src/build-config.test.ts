import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import config from "../vite.config"
import { THEMES } from "./lib/theme"

/**
 * ค่าตั้งของ Vite และ `index.html` ที่พังแล้วไม่เห็นตอนพัฒนา แต่ไปพังบนเซิร์ฟเวอร์จริงภายใต้ CSP ของ spec 9.2
 * (`script-src 'self'` ห้าม inline script · `font-src 'self'` ห้ามฟอนต์แบบ `data:`)
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8")

describe("vite.config.ts", () => {
  test("build.assetsInlineLimit = 0: ฟอนต์ (และไฟล์อื่น) ต้องออกเป็นไฟล์ ไม่ถูกฝังเป็น data: URI ที่ CSP font-src 'self' ปิดกั้น", () => {
    assert.strictEqual(config.build?.assetsInlineLimit, 0)
  })

  test("โหมดพัฒนา: /api และ /covers ถูกส่งต่อไปเซิร์ฟเวอร์ที่ 127.0.0.1:8787 (พอร์ตเริ่มต้นของ server/src/config.ts)", () => {
    const proxy = config.server?.proxy ?? {}
    assert.deepEqual(Object.keys(proxy).sort(), ["/api", "/covers"])
    for (const key of ["/api", "/covers"]) {
      const entry = proxy[key]
      assert.equal(typeof entry === "string" ? entry : entry.target, "http://127.0.0.1:8787", key)
    }
  })

  test("ยังเปิดโหมดพัฒนาให้เครื่องอื่นในวงเดียวกันเข้าได้ (host: true) — ใช้เปิดดูบนมือถือ", () => {
    assert.equal(config.server?.host, true)
  })

  test("ใช้ปลั๊กอิน React ของ Vite (แปลง JSX + รีเฟรชหน้าตอนแก้โค้ด)", () => {
    const flatten = (value: unknown): unknown[] => (Array.isArray(value) ? value.flatMap(flatten) : [value])
    const names = flatten(config.plugins).map((p) => (p && typeof p === "object" && "name" in p ? String(p.name) : ""))
    assert.ok(
      names.some((name) => name.startsWith("vite:react")),
      names.join(", "),
    )
  })
})

describe("index.html", () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], body: m[2], at: m.index! }))

  test("ภาษาไทยทั้งหน้า, viewport รองรับรอยบากของมือถือ, theme-color = พื้น Midnight (ธีมเริ่มต้น)", () => {
    assert.match(html, /<html\s[^>]*\blang="th"/)
    assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"/)
    assert.match(html, /<meta\s+name="theme-color"\s+content="#0a0c12"/)
  })

  test("ไม่มี inline script เลย (CSP ห้าม): ทุก <script> มี src และไม่มีเนื้อหาข้างใน", () => {
    assert.ok(scripts.length >= 2, "ต้องมีอย่างน้อย theme-init กับจุดเข้าของแอป")
    for (const s of scripts) {
      assert.match(s.attrs, /\bsrc="[^"]+"/, s.attrs)
      assert.equal(s.body.trim(), "")
    }
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "ไม่มี inline event handler")
  })

  test("theme-init.js เป็นสคริปต์คลาสสิกตัวแรก อยู่ใน <head> ก่อนสคริปต์/สไตล์ชีตอื่นทั้งหมด (ตั้งธีมก่อนวาดหน้า จอจะไม่วาบ)", () => {
    const init = scripts[0]
    assert.match(init.attrs, /\bsrc="\/theme-init\.js"/)
    assert.doesNotMatch(init.attrs, /type="module"|\bdefer\b|\basync\b/)
    const headEnd = html.indexOf("</head>")
    assert.ok(init.at < headEnd, "ต้องอยู่ใน <head>")
    const firstStylesheet = html.search(/<link\b[^>]*rel="stylesheet"/i)
    if (firstStylesheet >= 0) assert.ok(init.at < firstStylesheet)
    const entry = scripts.find((s) => /type="module"/.test(s.attrs))
    assert.ok(entry && /src="\/src\/main\.tsx"/.test(entry.attrs), "จุดเข้าของแอปคือ /src/main.tsx")
    assert.ok(init.at < entry.at)
  })

  test("ลิงก์ manifest และไอคอนที่ PWA ใช้ยังอยู่ · เปิดเป็นแอปเต็มจอได้ทั้ง Android และ iOS", () => {
    assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"/)
    assert.match(html, /<link\s+rel="icon"\s+href="\/icon\.svg"/)
    assert.match(html, /<link\s+rel="apple-touch-icon"\s+href="\/icon-192\.png"/)
    assert.match(html, /<meta\s+name="mobile-web-app-capable"\s+content="yes"/)
    assert.match(html, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/)
  })

  test("ประกาศ charset UTF-8 ในช่วง 1024 ไบต์แรก (ข้อความไทยต้องอ่านถูกแม้เซิร์ฟเวอร์ไม่ส่ง charset) และมี #root ให้แอปไปแขวน", () => {
    const head = Buffer.from(html, "utf8").subarray(0, 1024).toString("utf8")
    assert.match(head, /<meta\s+charset="utf-8"\s*\/?>/i)
    assert.match(html, /<div\s+id="root"\s*><\/div>/)
  })

  test("ชื่อหน้าตั้งต้นคือ koymukarnnovel (ชื่อเก่า Novel 99 / Novel Teller ต้องไม่หลงเหลือ)", () => {
    assert.match(html, /<title>koymukarnnovel<\/title>/)
    assert.doesNotMatch(html, /novel\s*99|novel\s*teller/i)
  })
})

/**
 * `e2e/shot.mjs` เป็นสคริปต์ Node ล้วนที่ import โค้ดของหน้าเว็บไม่ได้ จึงมีรายชื่อธีมและคีย์ localStorage ซ้ำไว้ในตัวเอง —
 * ถ้าไม่ตรวจ วันที่เพิ่มธีมหรือเปลี่ยนคีย์ ตัวถ่ายภาพจะเงียบ ๆ ถ่ายผิดธีม (หน้าเว็บตกกลับเป็น Midnight)
 */
describe("e2e/shot.mjs (รายการที่ซ้ำกับของหน้าเว็บ)", () => {
  const shot = fs.readFileSync(path.join(here, "..", "..", "e2e", "shot.mjs"), "utf8")
  const themeInit = fs.readFileSync(path.join(here, "..", "public", "theme-init.js"), "utf8")

  test("รายชื่อธีมที่รับ = THEMES ของ src/lib/theme.ts (ชุดเดียวกัน ลำดับเดียวกัน)", () => {
    const literal = shot.match(/^const THEMES = (\[[^\]]*\])$/m)?.[1]
    assert.ok(literal, "ไม่พบบรรทัด const THEMES = [...] ใน e2e/shot.mjs")
    assert.deepEqual(JSON.parse(literal), [...THEMES])
  })

  test("คีย์ localStorage ที่ใช้ตั้งธีมก่อนเปิดหน้า = คีย์ที่ theme-init.js อ่าน", () => {
    const key = shot.match(/^const THEME_KEY = "([^"]+)"$/m)?.[1]
    const read = themeInit.match(/localStorage\.getItem\("([^"]+)"\)/)?.[1]
    assert.ok(key, "ไม่พบบรรทัด const THEME_KEY = \"...\" ใน e2e/shot.mjs")
    assert.ok(read, "ไม่พบ localStorage.getItem(\"...\") ใน theme-init.js")
    assert.equal(key, read)
  })
})
