/**
 * ตะแกรงกันข้อความไทยหลงอยู่ในไฟล์ UI หน้าบ้าน: ไฟล์ที่ยังไม่ได้ย้ายข้อความเข้า `i18n/` ต้องอยู่ใน PENDING
 * (แต่ละงานของแผนย้ายไฟล์ของตัวเองแล้วเอาออกจาก PENDING) · ไฟล์ที่ใช้เฉพาะหลังบ้านหรือเป็นข้อความของนักพัฒนาอยู่ใน ALLOWED พร้อมเหตุผล
 */
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const THAI = /[฀-๿]/
const LIB_FILES = ["format.ts", "errors.ts", "api.ts", "useFetch.ts", "chapter-list.ts", "library.ts", "theme.ts", "reader.ts", "SiteContext.tsx"]

/** ไฟล์ (เทียบจาก web/src) ที่ยังมีข้อความไทยในโค้ดและรอการย้าย */
export const PENDING: string[] = [
  "components/AppErrorBoundary.tsx",
  "components/ChapterList.tsx",
  "components/ContinueRow.tsx",
  "components/CreditBox.tsx",
  "components/DraftBadge.tsx",
  "components/ErrorState.tsx",
  "components/Footer.tsx",
  "components/Header.tsx",
  "components/Hero.tsx",
  "components/Layout.tsx",
  "components/Library.tsx",
  "components/NovelCard.tsx",
  "components/NovelRow.tsx",
  "components/ReaderBar.tsx",
  "components/ReaderSettings.tsx",
  "components/SearchBox.tsx",
  "components/Skeleton.tsx",
  "components/Synopsis.tsx",
  "components/ThemeMenu.tsx",
  "lib/api.ts",
  "lib/chapter-list.ts",
  "lib/errors.ts",
  "lib/library.ts",
  "lib/reader.ts",
  "lib/theme.ts",
  "lib/useFetch.ts",
  "pages/About.tsx",
  "pages/Contact.tsx",
  "pages/Home.tsx",
  "pages/NotFound.tsx",
  "pages/Novel.tsx",
  "pages/Reader.tsx",
]

export const ALLOWED: Record<string, string> = {
  "components/ConfirmDialog.tsx": "ใช้เฉพาะหลังบ้าน (หลังบ้านเป็นไทยเสมอ)",
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
  test("ไฟล์นอก PENDING / ALLOWED ต้องไม่มีอักษรไทยในโค้ด", () => {
    const bad = scopeFiles().filter((file) => !PENDING.includes(file) && !(file in ALLOWED) && hasThai(file))
    assert.deepEqual(bad, [], "ย้ายข้อความเหล่านี้เข้า src/i18n/ (หรือใส่ ALLOWED พร้อมเหตุผล)")
  })

  test("รายการใน PENDING ต้องยังมีข้อความไทยจริง (ย้ายเสร็จแล้วต้องเอาออก)", () => {
    const stale = PENDING.filter((file) => !hasThai(file))
    assert.deepEqual(stale, [], "ไฟล์เหล่านี้ไม่มีข้อความไทยแล้ว ลบออกจาก PENDING")
  })

  test("ตัวตรวจไม่นับคอมเมนต์ แต่นับสตริงและ JSX", () => {
    const source = ["// ไทยในคอมเมนต์", "/* ไทย", "ต่อบล็อก */", "const a = 1 // ท้ายบรรทัด", 'const b = "สวัสดี"', "<p>ไทย</p>", "x /* ใน */ + 1"].join("\n")
    assert.deepEqual(thaiLines(source), [5, 6])
  })
})
