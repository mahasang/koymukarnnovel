import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { THEMES } from "./lib/theme"

/**
 * `public/theme-init.js` ต้องตั้ง `<html data-theme>` ก่อนวาดหน้าเพื่อไม่ให้จอวาบ และเป็นสคริปต์คลาสสิก (ไม่ใช่ module) ไฟล์เล็ก
 * ทำงานได้โดยไม่ล้มแม้เบราว์เซอร์ปิด localStorage (เข้าถึง `localStorage` แล้วโยน SecurityError ได้จริงเมื่อบล็อกคุกกี้)
 * เทสต์รันสคริปต์จริงใน `vm` ด้วย `document`/`localStorage` ปลอม
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(here, "..", "public", "theme-init.js"), "utf8")
const KEY = "koymukarnnovel.theme"

interface Env {
  stored?: string | null
  /** เข้าถึงตัวแปร `localStorage` แล้วโยน (เบราว์เซอร์ที่บล็อกข้อมูลเว็บไซต์) */
  storageGetterThrows?: boolean
  /** `localStorage.getItem` โยน */
  getItemThrows?: boolean
  /** ไม่มีตัวแปร `localStorage` เลย */
  noStorage?: boolean
}

function run(env: Env = {}) {
  const attributes: Record<string, string> = {}
  const reads: string[] = []
  const sandbox: Record<string, unknown> = {
    document: { documentElement: { setAttribute: (name: string, value: string) => void (attributes[name] = value) } },
  }
  sandbox.window = sandbox
  if (!env.noStorage) {
    Object.defineProperty(sandbox, "localStorage", {
      enumerable: true,
      get() {
        if (env.storageGetterThrows) throw new DOMException("The operation is insecure.", "SecurityError")
        return {
          getItem(key: string) {
            reads.push(key)
            if (env.getItemThrows) throw new Error("denied")
            return key === KEY ? (env.stored ?? null) : null
          },
        }
      },
    })
  }
  const before = Object.keys(sandbox).sort()
  vm.runInNewContext(SOURCE, sandbox) // ถ้าสคริปต์โยน เทสต์นี้ล้มทันที
  return { attributes, reads, leaked: Object.keys(sandbox).filter((k) => !before.includes(k)) }
}

test("ค่าที่เก็บไว้เป็นธีมที่ถูกต้อง → ตั้งเป็น data-theme ตรงตัว (ทุกธีมใน THEMES)", () => {
  for (const theme of THEMES) {
    const { attributes, reads } = run({ stored: theme })
    assert.deepEqual(attributes, { "data-theme": theme }, theme)
    assert.deepEqual(reads, [KEY], "อ่านเฉพาะคีย์ koymukarnnovel.theme")
  }
})

test("ยังไม่เคยเลือกธีม → ไม่แตะอะไร (CSS ใช้ Midnight เป็นค่าเริ่มต้นเอง)", () => {
  assert.deepEqual(run({ stored: null }).attributes, {})
})

test("ค่าที่ไม่ถูกต้องถูกเมิน: ชื่อไม่มี/ตัวพิมพ์ใหญ่/มีช่องว่าง/ใส่เครื่องหมายคำพูดแบบ JSON/ชื่อที่เป็น property ของ Object/โค้ด", () => {
  const bad = ["", " ", "neon", "PAPER", "Midnight", "paper ", " paper", '"paper"', "midnight;", "paper,black", "__proto__", "constructor", "toString", "hasOwnProperty", "0", "null", "undefined", "<script>alert(1)</script>"]
  for (const value of bad) assert.deepEqual(run({ stored: value }).attributes, {}, JSON.stringify(value))
})

test("localStorage ใช้ไม่ได้ (เข้าถึงแล้วโยน / getItem โยน / ไม่มีตัวแปรนี้เลย) → สคริปต์ไม่โยนและไม่ตั้งอะไร", () => {
  assert.deepEqual(run({ storageGetterThrows: true }).attributes, {})
  assert.deepEqual(run({ getItemThrows: true, stored: "paper" }).attributes, {})
  assert.deepEqual(run({ noStorage: true }).attributes, {})
})

test("เป็นสคริปต์คลาสสิกที่ไม่ทิ้งตัวแปรไว้ในพื้นที่ global", () => {
  for (const env of [{ stored: "sepia" }, { stored: "neon" }, { storageGetterThrows: true }]) assert.deepEqual(run(env).leaked, [], JSON.stringify(env))
})

test("ไฟล์เล็ก (บล็อกการวาดหน้าจนโหลดเสร็จ) ไม่มี module syntax และไม่ใช้ eval", () => {
  const bytes = Buffer.byteLength(SOURCE, "utf8")
  assert.ok(bytes < 1024, `ไฟล์ ${bytes} ไบต์`)
  assert.doesNotMatch(SOURCE, /^\s*(import|export)\s/m)
  assert.doesNotMatch(SOURCE, /\beval\b|new Function|document\.write/)
})

test("รายชื่อธีมในสคริปต์ตรงกับ THEMES ในโค้ด (สตริงทั้งหมดในไฟล์ = คีย์ + ชื่อแอตทริบิวต์ + ธีม ไม่มีธีมแอบเพิ่ม/ตกหล่น)", () => {
  const literals = [...SOURCE.matchAll(/(["'])((?:(?!\1).)*)\1/g)].map((m) => m[2])
  assert.deepEqual([...new Set(literals)].sort(), [...THEMES, KEY, "data-theme"].sort())
})
