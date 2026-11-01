import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { parseCss } from "./css"

describe("parseCss", () => {
  test("กฎเดียว: selector และ declaration (ชื่อเป็นตัวพิมพ์เล็ก ค่าถูกตัดช่องว่าง)", () => {
    const [rule] = parseCss(".a { Color : red ; margin: 0  auto }")
    assert.deepEqual(rule, { selectors: [".a"], decls: { color: "red", margin: "0 auto" }, media: null })
  })

  test("หลาย selector คั่นด้วย , แยกเป็นรายตัวและยุบช่องว่างซ้อน", () => {
    const [rule] = parseCss(".a,\n.b   .c ,.d{x:1}")
    assert.deepEqual(rule?.selectors, [".a", ".b .c", ".d"])
  })

  test("หลายกฎ เรียงตามลำดับในไฟล์", () => {
    const rules = parseCss(".a{x:1}\n.b{y:2}\n.c{z:3}")
    assert.deepEqual(
      rules.map((rule) => rule.selectors[0]),
      [".a", ".b", ".c"],
    )
  })

  test("ความเห็นถูกตัดทิ้ง (รวมที่ขวางกลางกฎและที่มีวงเล็บปีกกาอยู่ข้างใน)", () => {
    const rules = parseCss("/* ก { } */ .a { /* ข: 1; */ x: 1 } /* ค */ .b { y: 2 }")
    assert.deepEqual(rules, [
      { selectors: [".a"], decls: { x: "1" }, media: null },
      { selectors: [".b"], decls: { y: "2" }, media: null },
    ])
  })

  test("ประกาศซ้ำในกฎเดียว ตัวหลังชนะ; ค่าที่มี : อยู่ข้างในไม่ถูกตัดผิด", () => {
    const [rule] = parseCss(".a{ color: red; color: blue; background: url(data:image/png;base64,AAAA) }")
    assert.equal(rule?.decls.color, "blue")
    // ; ในวงเล็บตัดค่าขาด — ไฟล์ของโปรเจกต์ไม่มีรูปแบบนี้ ตัวช่วยไม่รองรับและเทสต์ตรึงพฤติกรรมไว้ให้รู้
    assert.equal(rule?.decls.background, "url(data:image/png")
  })

  test("ประกาศสุดท้ายไม่มี ; ก็อ่านได้; ประกาศที่ไม่มี : ถูกเมิน", () => {
    const [rule] = parseCss(".a{ x: 1; junk; y: 2 }")
    assert.deepEqual(rule?.decls, { x: "1", y: "2" })
  })

  test("@media ครอบกฎด้านใน ได้เงื่อนไขในช่อง media; กฎนอก @media เป็น null", () => {
    const rules = parseCss(".a{x:1} @media (max-width:  719px) { .a{x:2} .b{y:3} } .c{z:4}")
    assert.deepEqual(
      rules.map((rule) => [rule.selectors[0], rule.decls, rule.media]),
      [
        [".a", { x: "1" }, null],
        [".a", { x: "2" }, "(max-width: 719px)"],
        [".b", { y: "3" }, "(max-width: 719px)"],
        [".c", { z: "4" }, null],
      ],
    )
  })

  test("@keyframes และ @font-face ถูกข้ามทั้งก้อน (from/to ไม่กลายเป็นกฎ)", () => {
    const rules = parseCss("@keyframes spin { from { a: 1 } to { a: 2 } } .a{x:1} @font-face { font-family: X; src: url(x.woff2) } .b{y:2}")
    assert.deepEqual(
      rules.map((rule) => rule.selectors[0]),
      [".a", ".b"],
    )
  })

  test("@import ที่จบด้วย ; ถูกข้าม", () => {
    const rules = parseCss('@import "a.css";\n@import "b.css";\n.a{x:1}')
    assert.deepEqual(rules, [{ selectors: [".a"], decls: { x: "1" }, media: null }])
  })

  test("@media ที่ตามด้วยกฎนอก @media ยังได้ media เป็น null (ไม่รั่วเงื่อนไขต่อ)", () => {
    const rules = parseCss("@media print { .a{x:1} } .b{y:2}")
    assert.equal(rules.find((rule) => rule.selectors[0] === ".b")?.media, null)
  })

  test("กฎที่ไม่ปิดปีกกา → โยน Error บอกกฎที่เสีย", () => {
    assert.throws(() => parseCss(".broken { x: 1"), /\.broken/)
  })

  test("ไฟล์ว่างหรือมีแต่ความเห็น → ไม่มีกฎ", () => {
    assert.deepEqual(parseCss(""), [])
    assert.deepEqual(parseCss("/* ว่าง */"), [])
  })
})
