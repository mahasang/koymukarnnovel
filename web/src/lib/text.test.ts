import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { isSceneBreak, splitParagraphs } from "./text"

/** แยกเนื้อหาตอนเป็นย่อหน้าสำหรับหน้าอ่าน: ย่อหน้าคั่นด้วยบรรทัดว่าง, เส้นคั่นฉาก (`***` ฯลฯ) เป็นบรรทัดของมันเอง */

describe("splitParagraphs", () => {
  test("แยกที่บรรทัดว่าง ตัดช่องว่างรอบย่อหน้า ทิ้งย่อหน้าว่าง", () => {
    assert.deepEqual(splitParagraphs("a\n\n\nb\n  \nc"), ["a", "b", "c"])
  })

  test("ขึ้นบรรทัดเดียวไม่แยกย่อหน้า — คงบรรทัดใหม่ไว้ในย่อหน้า (หน้าอ่านแสดงด้วย white-space: pre-line)", () => {
    assert.deepEqual(splitParagraphs("บรรทัดแรก\nบรรทัดสอง\n\nย่อหน้าถัดไป"), ["บรรทัดแรก\nบรรทัดสอง", "ย่อหน้าถัดไป"])
  })

  test("ตัดช่องว่างหน้า-หลังย่อหน้า แต่ช่องว่างกลางประโยคอยู่ครบ", () => {
    assert.deepEqual(splitParagraphs("  a  b  \n\n\t c \t"), ["a  b", "c"])
  })

  test("ข้อความว่าง/มีแต่ช่องว่างและบรรทัดว่าง → []", () => {
    assert.deepEqual(splitParagraphs(""), [])
    assert.deepEqual(splitParagraphs("  \n\n \t\n"), [])
  })

  test("จบบรรทัดแบบ Windows (\\r\\n) และ Mac เก่า (\\r) แยกย่อหน้าเหมือน \\n", () => {
    assert.deepEqual(splitParagraphs("a\r\n\r\nb\r\rc\r\nd"), ["a", "b", "c\nd"])
  })

  test("ตัวคั่นบรรทัด Unicode (U+2028/U+2029) นับเป็นขึ้นบรรทัด", () => {
    assert.deepEqual(splitParagraphs("a\u{2028}\u{2028}b\u{2029}\u{2029}c"), ["a", "b", "c"])
  })

  test("BOM ต้นข้อความ, บรรทัดที่มีแต่ NBSP หรือช่องว่างไร้ความกว้าง นับเป็นบรรทัดว่าง (ข้อความที่วางมาจากเว็บอื่น)", () => {
    assert.deepEqual(splitParagraphs("\u{FEFF}a\n\u{A0}\nb\n\u{200B}\u{200C}\nc\n\u{2060}\n\u{FEFF}\nd"), ["a", "b", "c", "d"])
  })

  test("เส้นคั่นฉากเป็นย่อหน้าของมันเอง แม้ผู้เขียนไม่เว้นบรรทัดว่างรอบมัน", () => {
    assert.deepEqual(splitParagraphs("ก่อน\n***\nหลัง"), ["ก่อน", "***", "หลัง"])
    assert.deepEqual(splitParagraphs("ก่อน\nบรรทัดสอง\n* * *\nหลัง\n---\nจบ"), ["ก่อน\nบรรทัดสอง", "* * *", "หลัง", "---", "จบ"])
  })

  test("เส้นคั่นฉากที่เว้นบรรทัดว่างอยู่แล้วก็ได้ผลเหมือนกัน และเส้นคั่นติดกันไม่รวมกัน", () => {
    assert.deepEqual(splitParagraphs("a\n\n***\n\nb"), ["a", "***", "b"])
    assert.deepEqual(splitParagraphs("***\n***"), ["***", "***"])
  })

  test("บรรทัดที่ไม่ใช่เส้นคั่นฉาก (-- สองขีด, ตัวหนา) ยังอยู่ในย่อหน้าเดิม", () => {
    assert.deepEqual(splitParagraphs("a\n--\nb\n**bold**"), ["a\n--\nb\n**bold**"])
  })

  test("ข้อความใหญ่: ย่อหน้าห้าหมื่นย่อหน้า และบรรทัดว่างที่ยาวเป็นล้านช่องว่าง ไม่ค้าง", () => {
    assert.equal(splitParagraphs("a\n\n".repeat(50_000)).length, 50_000)
    assert.deepEqual(splitParagraphs(`x\n${" ".repeat(2_000_000)}\ny`), ["x", "y"])
  })
})

describe("isSceneBreak", () => {
  test("อย่างน้อยสามตัว * - _ ซ้ำกัน จะเว้นวรรคคั่นหรือไม่ก็ได้", () => {
    for (const p of ["***", "* * *", "---", "- - -", "___", "_ _ _", "*****", "* * * * *", "----------", "*  *   *"]) {
      assert.equal(isSceneBreak(p), true, JSON.stringify(p))
    }
  })

  test("ช่องว่างรอบบรรทัด (รวม NBSP) ไม่มีผล", () => {
    assert.equal(isSceneBreak("  ***  "), true)
    assert.equal(isSceneBreak("\t- - -\t"), true)
    assert.equal(isSceneBreak("\u{A0}___\u{A0}"), true)
  })

  test("ไม่ใช่เส้นคั่นฉาก: น้อยกว่าสามตัว, ตัวหนา, มีตัวอื่นปน, ตัวต่างชนิดปนกัน, ว่าง", () => {
    for (const p of ["--", "**", "*", "-", "_", "**bold**", "a***", "***a", "* * a", "*-*", "-*-", "-_-", "***\n***", "", "   ", "— — —", "..."]) {
      assert.equal(isSceneBreak(p), false, JSON.stringify(p))
    }
  })
})

describe("splitParagraphs — ช่องว่างที่ mutation พบ", () => {
  test("บรรทัดที่มีแต่ ZWJ (U+200D) ก็เป็นบรรทัดว่าง", () => {
    assert.deepEqual(splitParagraphs("ก\n\u{200D}\nข"), ["ก", "ข"])
    assert.deepEqual(splitParagraphs("ก\n\u{200B}\u{200C}\u{200D}\u{2060}\nข"), ["ก", "ข"])
  })

  test("เส้นคั่นฉากที่มีช่องว่างรอบข้างถูกตัดช่องว่างด้วย (ผลลัพธ์เป็นเส้นล้วนๆ)", () => {
    assert.deepEqual(splitParagraphs("ก\n  ***  \nข"), ["ก", "***", "ข"])
    assert.deepEqual(splitParagraphs("ก\n\t* * *\t\nข"), ["ก", "* * *", "ข"])
  })
})
