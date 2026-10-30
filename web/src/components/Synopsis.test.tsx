import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text } from "../testing/dom"
import { findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { SYNOPSIS_LINES, Synopsis, SynopsisView, type SynopsisViewProps } from "./Synopsis"

const props = (over: Partial<SynopsisViewProps> = {}): SynopsisViewProps => ({ text: "เรื่องย่อของนิยาย", expanded: false, overflowing: false, onToggle: () => {}, ...over })
const view = (over: Partial<SynopsisViewProps> = {}) => renderPage(<SynopsisView {...props(over)} />)

describe("SynopsisView", () => {
  test("พับที่ 5 บรรทัด (ค่าเดียวกับ CSS ที่ตรึงไว้ใน public.test.ts)", () => {
    assert.equal(SYNOPSIS_LINES, 5)
  })

  test("ส่วน 'เรื่องย่อ' ที่ชื่อโดยหัวข้อของตัวเอง · เนื้อหาเป็นข้อความตัดช่องว่างหัวท้าย", () => {
    const root = view({ text: "  บรรทัดแรก\nบรรทัดสอง \n" })
    const section = one(root, "section")
    const heading = one(section, "h2.nv-h")
    assert.equal(text(heading), "เรื่องย่อ")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
    assert.equal(one(section, "p.nv-syn").children.join(""), "บรรทัดแรก\nบรรทัดสอง")
  })

  test("เนื้อหาเป็นข้อความล้วน: แท็ก HTML ในเรื่องย่อไม่ถูกตีความ (ไม่มี script/b/img โผล่ใน DOM)", () => {
    const root = view({ text: '<script>alert(1)</script><b>หนา</b><img src=x onerror=alert(2)>' })
    assert.equal(all(root, "script").length, 0)
    assert.equal(all(root, "b").length, 0)
    assert.equal(all(root, "img").length, 0)
    assert.equal(text(one(root, "p.nv-syn")), '<script>alert(1)</script><b>หนา</b><img src=x onerror=alert(2)>')
  })

  test("ว่างหรือช่องว่างล้วน → ไม่แสดงส่วนนี้เลย", () => {
    assert.equal(view({ text: "" }).children.length, 0)
    assert.equal(view({ text: " \n\t " }).children.length, 0)
  })

  test("ยังพับ: ไม่มีคลาส open · ข้อความไม่ยาวเกิน 5 บรรทัด → ไม่มีปุ่ม", () => {
    const root = view()
    assert.equal(one(root, "p.nv-syn").attrs.class, "nv-syn")
    assert.equal(all(root, "button").length, 0)
  })

  test("ข้อความยาวเกินพื้นที่พับ → ปุ่ม 'อ่านเพิ่ม' ที่บอกสถานะและชี้ไปที่เนื้อหา", () => {
    const root = view({ overflowing: true })
    const button = one(root, "button")
    assert.equal(text(button), "อ่านเพิ่ม")
    assert.equal(button.attrs.type, "button")
    assert.equal(button.attrs["aria-expanded"], "false")
    assert.equal(button.attrs["aria-controls"], one(root, "p.nv-syn").attrs.id)
    assert.ok(button.attrs["aria-controls"])
  })

  test("ขยายแล้ว: คลาส open และปุ่ม 'ย่อ' ยังอยู่ (แม้ไม่ถูกตัดแล้วก็ต้องย่อกลับได้)", () => {
    const root = view({ expanded: true, overflowing: false })
    assert.equal(one(root, "p.nv-syn").attrs.class, "nv-syn open")
    const button = one(root, "button")
    assert.equal(text(button), "ย่อ")
    assert.equal(button.attrs["aria-expanded"], "true")
  })

  test("กดปุ่มเรียก onToggle หนึ่งครั้ง", () => {
    let calls = 0
    const tree = SynopsisView(props({ overflowing: true, onToggle: () => (calls += 1) }))
    handlerOf(findTag(tree, "button"), "onClick")()
    assert.equal(calls, 1)
  })

  test("ส่ง ref ของเนื้อหาให้ตัวห่อใช้วัดว่าล้นหรือไม่", () => {
    const ref = { current: null }
    const tree = SynopsisView(props({ textRef: ref }))
    assert.equal(findTag(tree, "p").props.ref, ref)
  })
})

describe("Synopsis (ตัวห่อที่มีสถานะ)", () => {
  test("เรนเดอร์ครั้งแรก: พับอยู่และยังไม่มีปุ่ม (ปุ่มโผล่หลังวัดบนเบราว์เซอร์จริง)", () => {
    const root = renderPage(<Synopsis text="เรื่องย่อ" />)
    assert.equal(one(root, "p.nv-syn").attrs.class, "nv-syn")
    assert.equal(all(root, "button").length, 0)
  })
})
