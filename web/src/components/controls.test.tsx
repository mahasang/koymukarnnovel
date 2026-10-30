import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { findTag, handlerOf } from "../testing/elements"
import { one, parse, text } from "../testing/dom"
import { Chip } from "./Chip"
import { Switch } from "./Switch"

describe("Chip (ชิปกรอง)", () => {
  test("ยังไม่เลือก: ปุ่ม type=button, aria-pressed=false, คลาส fchip เท่านั้น", () => {
    const button = one(parse(renderToStaticMarkup(<Chip>แฟนตาซี</Chip>)), "button")
    assert.equal(button.attrs.type, "button")
    assert.equal(button.attrs["aria-pressed"], "false")
    assert.equal(button.attrs.class, "fchip")
    assert.equal(text(button), "แฟนตาซี")
  })

  test("เลือกอยู่: aria-pressed=true และคลาส on", () => {
    const button = one(parse(renderToStaticMarkup(<Chip selected>ทั้งหมด</Chip>)), "button")
    assert.equal(button.attrs["aria-pressed"], "true")
    assert.equal(button.attrs.class, "fchip on")
  })

  test("selected={false} เหมือนไม่ระบุ", () => {
    const button = one(parse(renderToStaticMarkup(<Chip selected={false}>x</Chip>)), "button")
    assert.equal(button.attrs.class, "fchip")
    assert.equal(button.attrs["aria-pressed"], "false")
  })

  test("กดแล้วเรียก onClick หนึ่งครั้ง; ไม่มี onClick ก็ไม่พัง", () => {
    let clicks = 0
    const el = Chip({ onClick: () => clicks++, children: "x" })
    handlerOf(findTag(el, "button"), "onClick")()
    assert.equal(clicks, 1)
    assert.doesNotThrow(() => renderToStaticMarkup(<Chip>x</Chip>))
  })
})

describe("Switch (สวิตช์เปิด/ปิด)", () => {
  test("ปิดอยู่: role=switch, aria-checked=false, ไม่มีคลาส on, มีป้ายข้อความ", () => {
    const button = one(parse(renderToStaticMarkup(<Switch checked={false} onChange={() => {}} label="ให้เสิร์ชเอนจินค้นเจอ" />)), "button")
    assert.equal(button.attrs.role, "switch")
    assert.equal(button.attrs["aria-checked"], "false")
    assert.equal(button.attrs.type, "button")
    assert.equal(button.attrs.class, "switch")
    assert.equal(text(button), "ให้เสิร์ชเอนจินค้นเจอ")
    assert.equal("disabled" in button.attrs, false)
  })

  test("เปิดอยู่: aria-checked=true และคลาส on", () => {
    const button = one(parse(renderToStaticMarkup(<Switch checked onChange={() => {}} label="x" />)), "button")
    assert.equal(button.attrs["aria-checked"], "true")
    assert.equal(button.attrs.class, "switch on")
  })

  test("ปิดการใช้งาน: มี disabled", () => {
    const button = one(parse(renderToStaticMarkup(<Switch checked={false} disabled onChange={() => {}} label="x" />)), "button")
    assert.equal("disabled" in button.attrs, true)
  })

  test("ส่ง id ต่อให้ปุ่ม (ใช้ผูกกับ label หรือ aria-describedby ภายนอกได้)", () => {
    const button = one(parse(renderToStaticMarkup(<Switch id="indexable" checked onChange={() => {}} label="x" />)), "button")
    assert.equal(button.attrs.id, "indexable")
  })

  test("กดแล้วส่งค่าตรงข้ามของสถานะปัจจุบันให้ onChange (ปิด → true, เปิด → false)", () => {
    const seen: boolean[] = []
    handlerOf(findTag(Switch({ checked: false, onChange: (v) => seen.push(v), label: "x" }), "button"), "onClick")()
    handlerOf(findTag(Switch({ checked: true, onChange: (v) => seen.push(v), label: "x" }), "button"), "onClick")()
    assert.deepEqual(seen, [true, false])
  })

  test("มีรางและปุ่มกลมให้ CSS วาด (ตกแต่งอย่างเดียว ซ่อนจากโปรแกรมอ่านหน้าจอ)", () => {
    const html = parse(renderToStaticMarkup(<Switch checked onChange={() => {}} label="x" />))
    const track = one(html, ".switch-track")
    assert.equal(track.attrs["aria-hidden"], "true")
    assert.equal(one(track, ".switch-thumb").tag, "span")
  })
})
