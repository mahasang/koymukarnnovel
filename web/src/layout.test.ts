import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"

/**
 * Windows และ macOS ถือว่า `Login` กับ `login` เป็นไฟล์ชื่อเดียวกัน: `import "./Login"` จึงหาไปเจอ `login.ts` ก่อน `Login.tsx`
 * และ `tsc` พังด้วยข้อความ "differs only in casing" ทั้งที่บน Linux (ที่เราทดสอบ) ผ่านปกติ — เทสต์นี้กันเหตุแบบนั้นไว้ก่อนส่งถึงเครื่องเจ้าของ
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const SOURCE_DIRS = ["server/src", "server/test", "web/src", "e2e"]
const SKIP = new Set(["node_modules", "dist", "out"])
const MODULE_EXT = [".test.tsx", ".test.ts", ".d.ts", ".tsx", ".ts", ".mjs", ".js"]

const moduleName = (file: string): string => {
  const ext = MODULE_EXT.find((e) => file.endsWith(e))
  return ext === undefined ? file : file.slice(0, -ext.length)
}

/** โฟลเดอร์ → ชื่อโมดูลที่ต่างกันเฉพาะตัวพิมพ์ (ชุดละกลุ่ม) */
export function caseCollisions(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
    const byFolded = new Map<string, Set<string>>()
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      const name = moduleName(entry.name)
      const folded = name.toLowerCase()
      byFolded.set(folded, (byFolded.get(folded) ?? new Set()).add(name))
    }
    for (const names of byFolded.values()) {
      if (names.size > 1) found.push(`${path.relative(ROOT, current)}: ${[...names].sort().join(" / ")}`)
    }
  }
  walk(dir)
  return found
}

describe("ชื่อไฟล์โมดูล", () => {
  test("ไม่มีสองโมดูลในโฟลเดอร์เดียวกันที่ชื่อต่างกันแค่ตัวพิมพ์เล็ก/ใหญ่ (กัน build พังบน Windows/macOS)", () => {
    const collisions = SOURCE_DIRS.flatMap((d) => caseCollisions(path.join(ROOT, d)))
    assert.deepEqual(collisions, [])
  })

  test("ตัวตรวจจับจับคู่ Login.tsx / login.ts ได้จริง", () => {
    const tmp = fs.mkdtempSync(path.join(ROOT, ".case-check-"))
    try {
      fs.writeFileSync(path.join(tmp, "Login.tsx"), "")
      fs.writeFileSync(path.join(tmp, "login.ts"), "")
      fs.writeFileSync(path.join(tmp, "chart.test.ts"), "")
      fs.writeFileSync(path.join(tmp, "chart.test.tsx"), "")
      assert.equal(caseCollisions(tmp).length, 1)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
