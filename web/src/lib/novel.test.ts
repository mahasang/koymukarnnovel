import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { displayTitle } from "./novel"

describe("displayTitle", () => {
  test("มีชื่อไทย → ใช้ชื่อไทย", () => {
    assert.equal(displayTitle({ title: "The Last Lantern", titleTh: "ตะเกียงดวงสุดท้าย" }), "ตะเกียงดวงสุดท้าย")
  })

  test("ยังไม่มีชื่อไทย (ว่าง) → ใช้ชื่อต้นฉบับ", () => {
    assert.equal(displayTitle({ title: "The Last Lantern", titleTh: "" }), "The Last Lantern")
  })

  test("ชื่อไทยเป็นช่องว่างล้วนนับเป็นว่าง", () => {
    assert.equal(displayTitle({ title: "Planet No. 99", titleTh: "   " }), "Planet No. 99")
    assert.equal(displayTitle({ title: "Planet No. 99", titleTh: "\t\n" }), "Planet No. 99")
  })

  test("ตัดช่องว่างหัวท้ายของชื่อที่เลือก", () => {
    assert.equal(displayTitle({ title: "  A  ", titleTh: "" }), "A")
    assert.equal(displayTitle({ title: "A", titleTh: "  ก  " }), "ก")
  })

  test("ไม่มีทั้งสองชื่อ → สตริงว่าง ไม่โยน", () => {
    assert.equal(displayTitle({ title: "", titleTh: "" }), "")
    assert.equal(displayTitle({ title: "  ", titleTh: "  " }), "")
  })

  test("ใช้ได้กับข้อมูลที่มีแค่ title/titleTh (เช่น novel ในหน้าอ่าน)", () => {
    assert.equal(displayTitle({ title: "X", titleTh: "ก", ...{ id: 1 } }), "ก")
  })
})
