import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseCss } from "../testing/css"

/** ฟอนต์ภาษาลาว (Noto Sans Lao): Sarabun/Prompt ไม่มีอักษรลาว — ไม่มีฟอนต์นี้ ตัวอักษรลาวจะตกไปใช้ฟอนต์ของระบบที่หน้าตาไม่ตรงกันในแต่ละเครื่อง */

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string) => fs.readFileSync(path.join(here, name), "utf8")
const WEIGHTS = [400, 500, 600, 700]

const declsNamed = (file: string, name: string) => parseCss(read(file)).flatMap((rule) => (name in rule.decls ? [{ selectors: rule.selectors.join(", "), value: rule.decls[name]! }] : []))

/** รายชื่อฟอนต์ในสแต็ก (ตัดเครื่องหมายคำพูด) */
const families = (value: string) => value.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""))

describe("ฟอนต์ลาว", () => {
  test("base.css นำเข้า Noto Sans Lao เฉพาะ subset ลาว น้ำหนัก 400/500/600/700 (ใช้ตามน้ำหนักของ Sarabun/Prompt)", () => {
    const stripped = read("base.css").replace(/\/\*[\s\S]*?\*\//g, "")
    const imports = [...stripped.matchAll(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g)].map((m) => m[1]!).filter((i) => i.includes("noto-sans-lao"))
    assert.deepEqual(imports.sort(), WEIGHTS.map((w) => `@fontsource/noto-sans-lao/lao-${w}.css`))
  })

  test("ไฟล์ CSS ของแพ็กเกจมีอยู่จริงและประกาศฟอนต์ Noto Sans Lao น้ำหนักนั้น", () => {
    for (const w of WEIGHTS) {
      const file = path.resolve(here, "../../../node_modules/@fontsource/noto-sans-lao", `lao-${w}.css`)
      const css = fs.readFileSync(file, "utf8")
      assert.match(css, /font-family:\s*['"]Noto Sans Lao['"]/, String(w))
      assert.match(css, new RegExp(`font-weight:\\s*${w}\\b`), String(w))
    }
  })

  test("--font-body และ --font-ui: Noto Sans Lao อยู่หลัง Sarabun/Prompt และก่อนฟอนต์ระบบ", () => {
    for (const [file, name, first] of [["base.css", "--font-body", "Sarabun"], ["public.css", "--font-ui", "Prompt"]] as const) {
      const found = declsNamed(file, name)
      assert.equal(found.length, 1, `${file} ${name}`)
      const stack = families(found[0]!.value)
      const lao = stack.indexOf("Noto Sans Lao")
      assert.ok(lao > stack.indexOf(first) && stack.indexOf(first) >= 0, `${name}: ${stack.join(", ")}`)
      assert.ok(lao < stack.indexOf("system-ui"), `${name}: ${stack.join(", ")}`)
    }
  })

  test("--display (หัวข้อของทุกธีม) มี Noto Sans Lao ก่อนฟอนต์ทั่วไป — หัวข้อลาวไม่ตกไปใช้ฟอนต์ระบบ", () => {
    const found = declsNamed("tokens.css", "--display")
    assert.equal(found.length, 4)
    for (const { selectors, value } of found) {
      const stack = families(value)
      const lao = stack.indexOf("Noto Sans Lao")
      assert.ok(lao > 0, `${selectors}: ${stack.join(", ")}`)
      assert.ok(lao === stack.length - 2, `${selectors}: Noto Sans Lao ต้องอยู่ก่อนฟอนต์ทั่วไปตัวสุดท้าย: ${stack.join(", ")}`)
    }
  })

  test("web/package.json ประกาศแพ็กเกจฟอนต์", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../../package.json"), "utf8")) as { dependencies: Record<string, string> }
    assert.ok("@fontsource/noto-sans-lao" in pkg.dependencies)
  })
})
