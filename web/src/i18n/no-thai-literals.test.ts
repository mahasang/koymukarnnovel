/**
 * ตะแกรงกันข้อความไทยหลงอยู่ในไฟล์ UI หน้าบ้าน: ข้อความที่ผู้อ่านเห็นต้องอยู่ใน `i18n/` ทั้งหมด
 * ไฟล์ที่ใช้เฉพาะหลังบ้านหรือเป็นข้อความของนักพัฒนา/ข้อความสำรองอยู่ใน ALLOWED พร้อมเหตุผล
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const THAI = /[฀-๿]/
const LIB_FILES = ["format.ts", "errors.ts", "api.ts", "useFetch.ts", "chapter-list.ts", "library.ts", "theme.ts", "reader.ts", "SiteContext.tsx"]

export const ALLOWED: Record<string, string> = {
  "components/ConfirmDialog.tsx": "ใช้เฉพาะหลังบ้าน (หลังบ้านเป็นไทยเสมอ)",
  "lib/api.ts": "ข้อความไทยสำรองของ ApiError ที่เว็บสร้างเอง (message ไทยเป็นค่าตั้งต้น — ภาษาอื่นแปลจาก code ใน errorText)",
  "lib/useFetch.ts": "ข้อความไทยสำรองของ ApiError ที่เว็บสร้างเอง (แปลจาก code ใน errorText)",
  "lib/SiteContext.tsx": "ข้อความ Error สำหรับนักพัฒนา ไม่ใช่ UI ที่ผู้อ่านเห็น",
}

/** บรรทัดที่มีอักษรไทยนอกคอมเมนต์ (ตัดคอมเมนต์บล็อก /* *\/ และท้ายบรรทัด //) */
export function thaiLines(source: string): number[] {
  const hits: number[] = []
  let inBlock = false
  source.split("\n").forEach((raw, index) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf("*/")
      if (end === -1) return
      line = line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\/\*.*?\*\//g, "")
    const open = line.indexOf("/*")
    if (open !== -1) {
      line = line.slice(0, open)
      inBlock = true
    }
    line = line.replace(/(^|\s)\/\/.*$/, "")
    if (THAI.test(line)) hits.push(index + 1)
  })
  return hits
}

function scopeFiles(): string[] {
  const list = (dir: string) =>
    readdirSync(path.join(SRC, dir))
      .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
      .map((name) => `${dir}/${name}`)
  return [...list("pages"), ...list("components"), ...LIB_FILES.map((name) => `lib/${name}`)].sort()
}

const hasThai = (file: string) => thaiLines(readFileSync(path.join(SRC, file), "utf8")).length > 0

describe("ไม่มีข้อความไทยหลงในไฟล์ UI หน้าบ้าน", () => {
  test("ไฟล์นอก ALLOWED ต้องไม่มีอักษรไทยในโค้ด", () => {
    const bad = scopeFiles().filter((file) => !(file in ALLOWED) && hasThai(file))
    assert.deepEqual(bad, [], "ย้ายข้อความเหล่านี้เข้า src/i18n/ (หรือใส่ ALLOWED พร้อมเหตุผล)")
  })

  test("รายการใน ALLOWED ต้องยังมีข้อความไทยจริงและอยู่ในขอบเขตที่สแกน (ไม่ค้างรายการเก่า)", () => {
    const scoped = scopeFiles()
    const stale = Object.keys(ALLOWED).filter((file) => !scoped.includes(file) || !hasThai(file))
    assert.deepEqual(stale, [], "ไฟล์เหล่านี้ไม่มีข้อความไทยแล้วหรือไม่อยู่ในขอบเขต ลบออกจาก ALLOWED")
  })

  test("สแกนครบหน้า/คอมโพเนนต์/ไลบรารีที่ผู้อ่านเห็น (กันสแกนว่างเปล่า)", () => {
    const scoped = scopeFiles()
    for (const file of ["pages/Home.tsx", "pages/Reader.tsx", "components/Header.tsx", "lib/format.ts", "lib/library.ts"]) assert.ok(scoped.includes(file), file)
  })

  test("ตัวตรวจไม่นับคอมเมนต์ แต่นับสตริงและ JSX", () => {
    const source = ["// ไทยในคอมเมนต์", "/* ไทย", "ต่อบล็อก */", "const a = 1 // ท้ายบรรทัด", 'const b = "สวัสดี"', "<p>ไทย</p>", "x /* ใน */ + 1"].join("\n")
    assert.deepEqual(thaiLines(source), [5, 6])
  })
})
