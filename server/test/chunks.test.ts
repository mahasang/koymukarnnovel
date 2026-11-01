import { test } from "node:test"
import assert from "node:assert/strict"
import { CHUNK_SIZE, splitChunks } from "../src/chunks.js"

test("CHUNK_SIZE: แปลตรง 5000 เล่าเรื่อง 6000 (spec 8.3)", () => {
  assert.deepEqual(CHUNK_SIZE, { translate: 5000, story: 6000 })
})

test("ข้อความว่าง ช่องว่างล้วน บรรทัดว่างล้วน หรืออักขระล่องหนล้วน ได้ []", () => {
  for (const text of ["", "   ", "\n\n\n", " \r\n \t\n  ", " \n﻿"]) {
    assert.deepEqual(splitChunks(text, 100), [], JSON.stringify(text))
  }
})

test("ข้อความสั้น: ชิ้นเดียว ย่อหน้าคั่นด้วยบรรทัดว่างหนึ่งบรรทัด ตัดช่องว่างหัวท้ายของแต่ละย่อหน้า", () => {
  assert.deepEqual(splitChunks("  One.  \n\n\n\n Two.\nThree.  ", 1000), ["One.\n\nTwo.\n\nThree."])
})

test("CRLF และ CR เดี่ยวนับเป็นการขึ้นบรรทัดใหม่ ไม่มี \\r หลงเหลือ", () => {
  assert.deepEqual(splitChunks("a\r\nb\r\n\r\nc\rd", 1000), ["a\n\nb\n\nc\n\nd"])
})

test("แบ่งตามย่อหน้า: ชิ้นยาวพอดี max ได้ ยาวกว่า max แม้ 1 ตัวต้องขึ้นชิ้นใหม่", () => {
  const text = ["aaaa", "bbbb", "cccc", "dddd", "eeee"].join("\n")
  assert.deepEqual(splitChunks(text, 100), ["aaaa\n\nbbbb\n\ncccc\n\ndddd\n\neeee"])
  assert.deepEqual(splitChunks(text, 16), ["aaaa\n\nbbbb\n\ncccc", "dddd\n\neeee"]) // 4+2+4+2+4 = 16 พอดี
  assert.deepEqual(splitChunks(text, 15), ["aaaa\n\nbbbb", "cccc\n\ndddd", "eeee"])
  assert.deepEqual(splitChunks(text, 10), ["aaaa\n\nbbbb", "cccc\n\ndddd", "eeee"]) // 4+2+4 = 10 พอดี
  assert.deepEqual(splitChunks(text, 9), ["aaaa", "bbbb", "cccc", "dddd", "eeee"])
})

test("ย่อหน้ายาวเกิน max ถูกตัดตามประโยค: . ! ? 。 ！ ？ ” \" ตามด้วยช่องว่าง", () => {
  for (const end of [".", "!", "?", "。", "！", "？", "”", '"']) {
    const paragraph = ["aa bb", "cc dd", "ee ff"].map((s) => s + end).join(" ")
    // ถ้าไม่รู้จักตัวจบประโยคนี้ จะไปตัดที่ช่องว่างกลางประโยค (aa bb. cc) แทน
    assert.deepEqual(splitChunks(paragraph, 11), ["aa bb" + end, "cc dd" + end, "ee ff" + end], `จบประโยคด้วย ${end}`)
  }
})

test("ประโยคที่รวมกันได้ไม่เกิน max ถูกรวมเป็นชิ้นเดียว (คั่นด้วยช่องว่าง) ไม่ใช่บรรทัดว่าง", () => {
  const paragraph = "Alpha one. Beta two! Gamma three? Delta four."
  assert.deepEqual(splitChunks(paragraph, 25), ["Alpha one. Beta two!", "Gamma three? Delta four."])
})

test("ประโยคเดียวยาวเกิน max ถูกตัดที่ช่องว่างสุดท้ายก่อน max ไม่ตัดกลางคำ", () => {
  const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa"
  assert.deepEqual(splitChunks(text, 20), ["alpha beta gamma", "delta epsilon zeta", "eta theta iota kappa"])
  // ช่องว่างอยู่ที่ตำแหน่ง max พอดี → ชิ้นยาว max ตัวได้
  assert.deepEqual(splitChunks("aaaa bbbb cccc", 9), ["aaaa bbbb", "cccc"])
})

test("ช่องว่างซ้อนกันตรงรอยตัด: ชิ้นที่ได้ไม่มีช่องว่างหัวท้าย", () => {
  assert.deepEqual(splitChunks("aaaa  bbbb  cccc", 9), ["aaaa", "bbbb", "cccc"])
  assert.deepEqual(splitChunks("aaaa bbbb  cccc", 9), ["aaaa bbbb", "cccc"])
})

test("ไม่มีช่องว่างให้ตัด (คำเดียวยาวเกิน max) ตัดที่ max พอดี", () => {
  assert.deepEqual(splitChunks("x".repeat(50), 20), ["x".repeat(20), "x".repeat(20), "x".repeat(10)])
})

test("ช่องว่างสุดท้ายอยู่ไม่เลยครึ่ง max → ตัดที่ max แทน (ไม่ทิ้งชิ้นสั้นเกินไป)", () => {
  assert.deepEqual(splitChunks("ab " + "x".repeat(40), 20), ["ab " + "x".repeat(17), "x".repeat(20), "xxx"])
  // พอดีครึ่ง max ยังไม่นับว่า "เลยครึ่ง"
  assert.deepEqual(splitChunks("a".repeat(10) + " " + "b".repeat(24), 20), ["a".repeat(10) + " " + "b".repeat(9), "b".repeat(15)])
})

test("ตัดที่ max กลางอีโมจิไม่ได้: ไม่ทิ้ง surrogate เดี่ยว (ส่งต่อ API แล้วข้อความเพี้ยน)", () => {
  const text = "😀".repeat(30)
  const chunks = splitChunks(text, 21)
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 21))
  assert.ok(chunks.every((c) => [...c].every((ch) => ch === "😀")), "ทุกชิ้นประกอบด้วยอีโมจิครบตัว")
  assert.equal(chunks.join(""), text)
})

test("max ที่ไม่ใช่จำนวนเต็มบวกถูกปฏิเสธ (กัน loop ไม่รู้จบ)", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => splitChunks("abc def", bad), RangeError, String(bad))
  }
})

/** ข้อความจำลองแบบกำหนดผลได้: หลายย่อหน้า และมีย่อหน้ายักษ์ที่ยาวกว่า max ทุกขนาด */
function pseudoNovel(): string {
  let seed = 20261022
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % n
  }
  const word = () => String.fromCharCode(...Array.from({ length: 1 + rand(10) }, () => 97 + rand(26)))
  const sentence = () => `${Array.from({ length: 3 + rand(10) }, word).join(" ")}${".!?"[rand(3)]}`
  const paragraph = (sentences: number) => Array.from({ length: sentences }, sentence).join(" ")
  const paragraphs = Array.from({ length: 120 }, () => paragraph(1 + rand(12)))
  paragraphs.splice(40, 0, paragraph(400))
  return paragraphs.join("\n\n")
}

test("ข้อความยาวจริง: ทุกชิ้นไม่เกิน max ไม่ว่าง และต่อกันแล้วได้ข้อความเดิม", () => {
  const text = pseudoNovel()
  const flat = text.replace(/\s+/g, " ").trim()
  for (const max of [60, 200, CHUNK_SIZE.translate, CHUNK_SIZE.story]) {
    const chunks = splitChunks(text, max)
    assert.ok(chunks.length >= Math.ceil((flat.length + 1) / (max + 1)), `max ${max}: ชิ้นน้อยเกินไป`)
    for (const c of chunks) {
      assert.ok(c.length > 0 && c.length <= max, `max ${max}: ชิ้นยาว ${c.length}`)
      assert.equal(c, c.trim(), `max ${max}: ชิ้นมีช่องว่างหัวท้าย`)
    }
    assert.equal(chunks.join(" ").replace(/\s+/g, " "), flat, `max ${max}: ข้อความหาย/เพี้ยน`)
  }
})
