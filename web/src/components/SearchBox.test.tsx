import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SEARCH_MAX_LENGTH } from "../lib/search"
import { all, one, parse } from "../testing/dom"
import { findTag, handlerOf, type AnyElement } from "../testing/elements"
import { renderPage } from "../testing/render"
import { SearchBox, SearchBoxView } from "./SearchBox"

const noop = () => {}
const props = (over: Partial<Parameters<typeof SearchBoxView>[0]> = {}) => ({ value: "", onChange: noop, onSubmit: noop, ...over })
const render = (over: Partial<Parameters<typeof SearchBoxView>[0]> = {}) => parse(renderToStaticMarkup(<SearchBoxView {...props(over)} />))

describe("SearchBoxView", () => {
  test("เป็นฟอร์มค้นหา (landmark search) ที่มีช่องเดียว ชื่อ q — กด Enter ส่งได้เลย ไม่ต้องมีปุ่ม", () => {
    const form = one(render(), "form.search")
    assert.equal(form.attrs.role, "search")
    const inputs = all(form, "input")
    assert.equal(inputs.length, 1)
    assert.equal(inputs[0]?.attrs.name, "q")
    assert.equal(all(form, "button").length, 0)
  })

  test("ช่องกรอก: ชนิด search, มีป้ายอ่านออกเสียง, ข้อความตัวอย่าง, จำกัดความยาว, ปิดเดาคำ, ปุ่ม Enter บนมือถือเป็น 'ค้นหา'", () => {
    const input = one(render(), "input")
    assert.equal(input.attrs.type, "search")
    assert.equal(input.attrs["aria-label"], "ค้นหานิยาย")
    assert.equal(input.attrs.placeholder, "ค้นหาชื่อเรื่อง ผู้แต่ง หมวดหมู่…")
    assert.equal(input.attrs.maxlength, String(SEARCH_MAX_LENGTH))
    assert.equal(input.attrs.autocomplete, "off")
    assert.equal(input.attrs.spellcheck, "false")
    assert.equal(input.attrs.enterkeyhint, "search")
  })

  test("ไอคอนแว่นขยายเป็นภาพประดับ", () => {
    const icons = all(one(render(), "form"), "svg")
    assert.equal(icons.length, 1)
    assert.equal(icons[0]?.attrs["aria-hidden"], "true")
  })

  test("แสดงค่าที่ส่งมา (ช่องควบคุมจากภายนอก) และ escape อักขระพิเศษของ HTML ครบ", () => {
    assert.equal(one(render({ value: "ดาวเคราะห์" }), "input").attrs.value, "ดาวเคราะห์")
    const risky = '"><script>alert(1)</script> & \''
    const root = render({ value: risky })
    assert.equal(one(root, "input").attrs.value, risky)
    assert.equal(all(root, "script").length, 0)
  })

  test("พิมพ์ → onChange ด้วยข้อความในช่อง", () => {
    const seen: string[] = []
    const element = SearchBoxView(props({ onChange: (value: string) => seen.push(value) }))
    handlerOf(findTag(element, "input"), "onChange")({ target: { value: "ดาว" } })
    handlerOf(findTag(element, "input"), "onChange")({ target: { value: "" } })
    assert.deepEqual(seen, ["ดาว", ""])
  })

  test("ส่งฟอร์ม → กันเบราว์เซอร์โหลดหน้าใหม่ แล้วเรียก onSubmit หนึ่งครั้ง", () => {
    let submits = 0
    let prevented = 0
    const element = SearchBoxView(props({ onSubmit: () => submits++ }))
    handlerOf(findTag(element, "form"), "onSubmit")({ preventDefault: () => prevented++ })
    assert.equal(prevented, 1)
    assert.equal(submits, 1)
  })

  test("ส่ง inputRef ไปที่ช่องกรอก (ไว้สั่งปิดแป้นพิมพ์หลังค้นหา)", () => {
    const inputRef = { current: null }
    const element = SearchBoxView(props({ inputRef }))
    assert.equal((findTag(element, "input") as AnyElement).props.ref, inputRef)
  })
})

describe("SearchBox (ตัวที่มี state และพาไปหน้าผลลัพธ์)", () => {
  test("เริ่มด้วยคำค้นที่ได้รับ", () => {
    const root = renderPage(<SearchBox initial="ดาวเคราะห์" />)
    assert.equal(one(root, "input").attrs.value, "ดาวเคราะห์")
  })

  test("ไม่มีคำค้นเริ่มต้น → ช่องว่าง", () => {
    assert.equal(one(renderPage(<SearchBox initial="" />), "input").attrs.value, "")
  })
})
