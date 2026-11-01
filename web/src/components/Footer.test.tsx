import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text, type El } from "../testing/dom"
import { loadedSite, renderPage } from "../testing/render"
import { Footer, FooterView } from "./Footer"

const view = (over: Partial<Parameters<typeof FooterView>[0]> = {}) => renderPage(<FooterView siteName="koymukarnnovel" year={2026} {...over} />)
const links = (root: El) => all(one(root, "nav"), "a").map((a) => [a.attrs.href, text(a).trim()])

describe("FooterView", () => {
  test("เป็น landmark contentinfo (footer) คลาส foot ที่มีแถวคอลัมน์และบรรทัดลิขสิทธิ์", () => {
    const footer = one(view(), "footer.foot")
    one(footer, ".cols")
    one(footer, ".cr")
  })

  test("ข้อความสถานะเนื้อหาตาม spec: นิยายแปลโดย AI สิทธิ์เป็นของเจ้าของผลงานเดิม", () => {
    assert.equal(text(one(view(), "p.foot-note")).trim(), "นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม")
  })

  test("แบรนด์: ตัว K (ภาพประดับ) + ชื่อเว็บ", () => {
    const brand = one(view({ siteName: "คลังนิยาย" }), ".foot-brand")
    assert.equal(text(one(brand, "span.mark")), "K")
    assert.equal(one(brand, "span.mark").attrs["aria-hidden"], "true")
    assert.equal(text(one(brand, "span.logo-name")), "คลังนิยาย")
  })

  test("ลิงก์ท้ายเว็บ: หน้าแรก / เกี่ยวกับเว็บไซต์ / ติดต่อ-แจ้งลบเนื้อหา (ตามลำดับ) ใน nav ที่มีชื่อ", () => {
    const root = view()
    assert.equal(one(root, "nav").attrs["aria-label"], "ลิงก์ท้ายเว็บ")
    assert.deepEqual(links(root), [
      ["/", "หน้าแรก"],
      ["/about", "เกี่ยวกับเว็บไซต์"],
      ["/contact", "ติดต่อ / แจ้งลบเนื้อหา"],
    ])
  })

  test("ลิงก์แบ่งเป็นกลุ่ม เมนู / ข้อมูล มีหัวข้อกำกับ", () => {
    const groups = all(one(view(), "nav"), "h2.foot-h").map((h) => text(h).trim())
    assert.deepEqual(groups, ["เมนู", "ข้อมูล"])
  })

  test("บรรทัดลิขสิทธิ์: © ปี ชื่อเว็บ", () => {
    assert.equal(text(one(view({ siteName: "คลังนิยาย", year: 2026 }), ".cr")).trim(), "© 2026 คลังนิยาย")
    assert.equal(text(one(view({ siteName: "คลังนิยาย", year: 2031 }), ".cr")).trim(), "© 2031 คลังนิยาย")
  })

  test("ยังไม่รู้ชื่อเว็บ (null ตอนกำลังโหลด) → ไม่เขียนชื่อทั้งในแบรนด์และบรรทัดลิขสิทธิ์", () => {
    const root = view({ siteName: null, year: 2026 })
    assert.equal(all(root, "span.logo-name").length, 0)
    assert.equal(text(one(root, ".cr")).trim(), "© 2026")
    assert.equal(text(one(root, "span.mark")), "K")
  })

  test("ชื่อเว็บที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const root = view({ siteName: "<b>x</b> & y" })
    assert.equal(all(root, "b").length, 0)
    assert.equal(text(one(root, "span.logo-name")), "<b>x</b> & y")
    assert.equal(text(one(root, ".cr")).trim(), "© 2026 <b>x</b> & y")
  })
})

describe("Footer (ตัวที่ดึงข้อมูลเว็บ)", () => {
  const year = String(new Date().getFullYear())

  test("โหลดข้อมูลเว็บแล้ว → ชื่อเว็บของเจ้าของ + ปีปัจจุบัน", () => {
    const root = renderPage(<Footer />, { state: loadedSite({ siteName: "คลังนิยาย" }) })
    assert.equal(text(one(root, "span.logo-name")), "คลังนิยาย")
    assert.equal(text(one(root, ".cr")).trim(), `© ${year} คลังนิยาย`)
  })

  test("ยังไม่ได้ตั้งชื่อ → ชื่อสำรอง", () => {
    const root = renderPage(<Footer />, { state: loadedSite({ siteName: "" }) })
    assert.equal(text(one(root, "span.logo-name")), "koymukarnnovel")
  })

  test("กำลังโหลด → ไม่เขียนชื่อ; โหลดไม่สำเร็จ → ชื่อสำรอง", () => {
    const loading = renderPage(<Footer />, { state: { site: null, loading: true, error: null } })
    assert.equal(all(loading, "span.logo-name").length, 0)
    assert.equal(text(one(loading, ".cr")).trim(), `© ${year}`)
    const failed = renderPage(<Footer />, { state: { site: null, loading: false, error: null } })
    assert.equal(text(one(failed, "span.logo-name")), "koymukarnnovel")
  })
})
