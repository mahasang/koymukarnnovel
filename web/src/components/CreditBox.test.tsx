import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text, type El } from "../testing/dom"
import { renderPage } from "../testing/render"
import { MESSAGES } from "../i18n/messages"
import { CreditBox } from "./CreditBox"

const AI_BADGE = MESSAGES.th.credit.aiBadge

type Props = Parameters<typeof CreditBox>[0]
const props = (over: Partial<Props> = {}): Props => ({ author: "Elmer Quill", sourceUrl: "https://www.royalroad.com/fiction/1/x", licenseNote: "", ...over })
const box = (over: Partial<Props> = {}) => one(renderPage(<CreditBox {...props(over)} />), "section.credit")
/** ค่าของแถวที่มีป้ายนั้นใน dl */
const rowOf = (root: El, label: string): El => {
  const row = all(root, "div.credit-row").find((r) => text(one(r, "dt")) === label)
  if (row === undefined) throw new Error(`ไม่พบแถว ${label}`)
  return one(row, "dd")
}

describe("CreditBox (spec 6.2)", () => {
  test("ส่วน 'เครดิตและที่มา' ที่ชื่อโดยหัวข้อของตัวเอง", () => {
    const section = box()
    const heading = one(section, "h2.nv-h")
    assert.equal(text(heading), "เครดิตและที่มา")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
  })

  test("ผู้แต่ง: แสดงชื่อ · ว่างหรือช่องว่างล้วน → 'ไม่ระบุ'", () => {
    assert.equal(text(rowOf(box(), "ผู้แต่ง")), "Elmer Quill")
    assert.equal(text(rowOf(box({ author: "  Elmer Quill  " }), "ผู้แต่ง")), "Elmer Quill")
    assert.equal(text(rowOf(box({ author: "" }), "ผู้แต่ง")), "ไม่ระบุ")
    assert.equal(text(rowOf(box({ author: "   " }), "ผู้แต่ง")), "ไม่ระบุ")
  })

  test("ต้นฉบับ http/https → ลิงก์เปิดแท็บใหม่ด้วย rel เต็มชุด ป้ายเป็นชื่อโฮสต์ และบอกโปรแกรมอ่านหน้าจอว่าเปิดแท็บใหม่", () => {
    const link = one(rowOf(box(), "ต้นฉบับ"), "a")
    assert.equal(link.attrs.href, "https://www.royalroad.com/fiction/1/x")
    assert.equal(link.attrs.target, "_blank")
    assert.equal(link.attrs.rel, "noopener noreferrer nofollow")
    assert.equal(text(link), "royalroad.com (เปิดในแท็บใหม่)")
    assert.equal(text(one(link, "span.sr-only")), " (เปิดในแท็บใหม่)")
    assert.equal(link.attrs.title, "https://www.royalroad.com/fiction/1/x")
  })

  test("ลิงก์ใช้รูปที่ URL ปรับให้แล้ว (ไม่ใช่ข้อความที่พิมพ์ดิบ): ตัดช่องว่างหัวท้าย ตัวพิมพ์ใหญ่ของ scheme/โฮสต์ถูกปรับ", () => {
    const link = one(rowOf(box({ sourceUrl: "  HTTPS://Example.ORG/Fic  " }), "ต้นฉบับ"), "a")
    assert.equal(link.attrs.href, "https://example.org/Fic")
    assert.equal(link.attrs.title, "https://example.org/Fic")
  })

  test("ต้นฉบับที่ไม่ใช่ http/https → ข้อความธรรมดา ไม่มีลิงก์ (javascript:, data:, file:)", () => {
    for (const bad of ["javascript:alert(document.cookie)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://example.com/x"]) {
      const cell = rowOf(box({ sourceUrl: bad }), "ต้นฉบับ")
      assert.equal(all(cell, "a").length, 0, bad)
      assert.equal(text(cell), bad)
    }
  })

  test("ต้นฉบับเป็นชื่อเว็บธรรมดา → ข้อความ · ว่าง → 'ไม่ระบุ'", () => {
    assert.equal(text(rowOf(box({ sourceUrl: "Royal Road" }), "ต้นฉบับ")), "Royal Road")
    assert.equal(text(rowOf(box({ sourceUrl: "" }), "ต้นฉบับ")), "ไม่ระบุ")
    assert.equal(all(rowOf(box({ sourceUrl: "" }), "ต้นฉบับ"), "a").length, 0)
  })

  test("ป้าย AI ตามข้อความในสเปกเป๊ะ", () => {
    assert.equal(AI_BADGE, "แปลโดย AI (Claude) — อาจมีข้อผิดพลาด")
    assert.equal(text(one(box(), ".ai-badge")), AI_BADGE)
  })

  test("บันทึกสิทธิ์ (license_note): มีเมื่อกรอก เป็นข้อความล้วน · ว่างไม่แสดงแถว", () => {
    const withNote = box({ licenseNote: "  CC BY-NC 4.0 <b>ได้รับอนุญาต</b>\nติดต่อผู้แต่ง " })
    const cell = rowOf(withNote, "บันทึกสิทธิ์")
    assert.equal(text(cell), "CC BY-NC 4.0 <b>ได้รับอนุญาต</b>\nติดต่อผู้แต่ง")
    assert.equal(all(cell, "b").length, 0)
    assert.equal(cell.attrs.class, "credit-license")
    assert.equal(all(box({ licenseNote: "" }), "div.credit-row").length, 2)
    assert.equal(all(box({ licenseNote: "   " }), "div.credit-row").length, 2)
    assert.equal(all(withNote, "div.credit-row").length, 3)
  })

  test("ลิงก์ 'แจ้งลบเนื้อหา' ไปหน้าติดต่อ (ลิงก์ภายในเว็บ ไม่เปิดแท็บใหม่)", () => {
    const link = one(box(), "a.credit-report")
    assert.equal(text(link), "แจ้งลบเนื้อหา")
    assert.equal(link.attrs.href, "/contact")
    assert.equal(link.attrs.target, undefined)
  })
})
