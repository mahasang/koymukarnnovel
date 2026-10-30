/**
 * `public/manifest.webmanifest` + ไอคอน — ให้ติดตั้งเป็นแอป (PWA) ได้
 * สีของแถบ/พื้นหลังตอนเปิดแอป และสีโลโก้ ต้องตรงกับ tokens ของธีม Midnight (ค่าตั้งต้นของเว็บ) ไม่ใช่ค่าที่เขียนซ้ำแล้วเพี้ยนทีหลัง
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(here, "..", "public")
const read = (name: string) => fs.readFileSync(path.join(PUBLIC, name), "utf8")
const tokens = fs.readFileSync(path.join(here, "styles", "tokens.css"), "utf8")

interface Icon {
  src: string
  sizes: string
  type: string
  purpose?: string
}
const manifest = JSON.parse(read("manifest.webmanifest")) as {
  name: string
  short_name: string
  description: string
  lang: string
  start_url: string
  display: string
  background_color: string
  theme_color: string
  icons: Icon[]
}

/** ค่า `--<name>` ในบล็อกธีม Midnight (ถ้าเป็น var(--x, #fallback) คืนค่า fallback) */
function midnight(name: string): string {
  const block = /html\[data-theme="midnight"\]\s*\{([^}]*)\}/.exec(tokens)?.[1]
  assert.ok(block, "ไม่พบบล็อกธีม midnight ใน tokens.css")
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
  assert.ok(value, `ไม่พบ --${name} ในธีม midnight`)
  return /^var\([^,]+,\s*(#[0-9a-fA-F]{3,8})\)$/.exec(value)?.[1] ?? value
}

/** ขนาดภาพจากส่วนหัว PNG (IHDR) พร้อมตรวจลายเซ็นไฟล์ */
function pngSize(file: string): { width: number; height: number } {
  const data = fs.readFileSync(path.join(PUBLIC, file))
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} ไม่ใช่ PNG`)
  assert.equal(data.subarray(12, 16).toString("latin1"), "IHDR")
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

describe("manifest.webmanifest", () => {
  test("ชื่อ koymukarnnovel · ภาษาไทย · เปิดเป็นแอปเต็มจอที่หน้าแรก · ไม่มีชื่อเก่า", () => {
    assert.equal(manifest.name, "koymukarnnovel")
    assert.equal(manifest.short_name, "koymukarnnovel")
    assert.equal(manifest.lang, "th")
    assert.equal(manifest.display, "standalone")
    assert.equal(manifest.start_url, "/")
    assert.ok(manifest.description.length > 0)
    assert.doesNotMatch(JSON.stringify(manifest), /novel\s*99|novel\s*teller/i)
  })

  test("theme_color และ background_color คือสีพื้น Midnight (#0a0c12 = --bg) — จอเปิดแอปไม่วาบสีอื่นก่อนหน้าเว็บ", () => {
    assert.equal(manifest.theme_color, "#0a0c12")
    assert.equal(manifest.background_color, "#0a0c12")
    assert.equal(manifest.theme_color, midnight("bg"))
  })

  test("ไอคอน: มี PNG 192 และ 512 ที่ขนาดจริงตรงกับที่ประกาศ · ไฟล์ทุกอันที่อ้างถึงมีอยู่ · ชนิดไฟล์ตรงนามสกุล", () => {
    const sizes = new Set(manifest.icons.map((icon) => icon.sizes))
    assert.ok(sizes.has("192x192") && sizes.has("512x512"))
    for (const icon of manifest.icons) {
      assert.match(icon.src, /^\/[^/]+$/, icon.src)
      assert.ok(fs.existsSync(path.join(PUBLIC, icon.src.slice(1))), `ไม่พบ ${icon.src}`)
      if (icon.src.endsWith(".png")) {
        assert.equal(icon.type, "image/png")
        const { width, height } = pngSize(icon.src.slice(1))
        assert.equal(icon.sizes, `${width}x${height}`, icon.src)
        assert.equal(width, height)
      } else {
        assert.equal(icon.src, "/icon.svg")
        assert.equal(icon.type, "image/svg+xml")
        assert.equal(icon.sizes, "any")
      }
    }
  })

  test("ไอคอน PNG ใช้เป็นไอคอนหน้าจอหลักได้ทั้งแบบเต็มและแบบ maskable (ตัว K อยู่ในโซนปลอดภัย พื้นเต็มสี่เหลี่ยม)", () => {
    for (const icon of manifest.icons.filter((i) => i.src.endsWith(".png"))) assert.equal(icon.purpose, "any maskable", icon.src)
    assert.ok(!manifest.icons.some((icon) => icon.src === "/icon.svg" && /maskable/.test(icon.purpose ?? "")), "SVG ไม่ใช่ maskable")
  })
})

describe("icon.svg (โลโก้ K)", () => {
  const svg = read("icon.svg")

  test("สี่เหลี่ยมเต็มภาพ 512×512 ไล่สี 135° จาก accent ไปเป็น accent-2 และตัว K สี --accent-ink — ตรงกับโลโก้ในแถบบนของเว็บ (Midnight)", () => {
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 512 512"/)
    assert.match(svg, /<linearGradient[^>]*\bx1="0"[^>]*\by1="0"[^>]*\bx2="1"[^>]*\by2="1"/)
    for (const token of ["accent", "accent-2", "accent-ink"]) assert.ok(svg.toLowerCase().includes(midnight(token).toLowerCase()), `ไม่มีสี --${token} (${midnight(token)})`)
    assert.match(svg, /<rect [^>]*width="512"[^>]*height="512"[^>]*fill="url\(#/)
    assert.doesNotMatch(svg, /\brx=/, "พื้นเต็มสี่เหลี่ยม ให้ระบบเป็นคนตัดมุมเอง (maskable)")
  })

  test("ตัว K วาดด้วยเส้น (ไม่พึ่งฟอนต์) และอยู่ในโซนปลอดภัยของ maskable (วงกลมรัศมี 40% กลางภาพ)", () => {
    assert.doesNotMatch(svg, /<text\b/)
    assert.match(svg, /<g [^>]*\bstroke="#[0-9a-fA-F]{6}"[^>]*>\s*<path /)
    const stroke = Number(/stroke-width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1])
    assert.ok(stroke > 0)
    const points = [...svg.matchAll(/<path [^>]*\bd="([^"]+)"/g)].flatMap((m) => [...m[1].matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((p) => [Number(p[1]), Number(p[2])]))
    assert.ok(points.length >= 6, "ต้องมีจุดของเส้น K")
    for (const [x, y] of points) assert.ok(Math.hypot(x - 256, y - 256) + stroke / 2 <= 0.4 * 512, `จุด ${x},${y} ออกนอกโซนปลอดภัย`)
  })
})
