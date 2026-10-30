import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { displayTitle, parseNovelId } from "./novel"

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

describe("parseNovelId (เลขนิยายจาก URL)", () => {
  test("จำนวนเต็มบวกไม่มีศูนย์นำหน้า", () => {
    assert.equal(parseNovelId("1"), 1)
    assert.equal(parseNovelId("42"), 42)
    assert.equal(parseNovelId("123456789"), 123456789)
  })

  test("ที่เหลือไม่ใช่เลขนิยาย → null (ไม่ยิงคำขอไปเซิร์ฟเวอร์)", () => {
    for (const bad of [undefined, "", "0", "07", "-1", "+1", "1.5", "abc", "1e3", " 1", "1 ", "１２", "๑๒", "12abc", "1234567890", "0x10", "NaN"]) {
      assert.equal(parseNovelId(bad), null, JSON.stringify(bad))
    }
  })
})
