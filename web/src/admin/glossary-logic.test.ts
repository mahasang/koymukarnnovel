import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { aiCount, deleteTermMessage, draftOfTerm, EMPTY_TERM, filterTerms, summaryLine, termChanges, validateTerm } from "./glossary-logic"
import type { GlossaryDto } from "./types"

const term = (over: Partial<GlossaryDto> = {}): GlossaryDto => ({ id: 1, source: "Moon Gate", thai: "ประตูจันทรา", note: "ชื่อสถานที่", auto: false, ...over })

describe("validateTerm — คำต้นฉบับและคำไทยห้ามว่าง · ไม่เกินความยาวที่เซิร์ฟเวอร์รับ", () => {
  test("กรอกครบ → ไม่มีข้อผิดพลาด (หมายเหตุว่างได้)", () => {
    assert.deepEqual(validateTerm({ source: "a", thai: "ก", note: "" }), {})
  })
  test("ว่างหรือมีแต่ช่องว่าง → ข้อความไทยของช่องนั้น", () => {
    const e = validateTerm({ source: "  ", thai: "", note: "" })
    assert.match(e.source ?? "", /คำต้นฉบับ/)
    assert.match(e.thai ?? "", /คำไทย/)
    assert.equal(e.note, undefined)
  })
  test("ยาวเกิน: ต้นฉบับ/ไทย 200 · หมายเหตุ 300 (นับหลังตัดช่องว่างหัวท้าย)", () => {
    assert.deepEqual(validateTerm({ source: "a".repeat(200), thai: "ก".repeat(200), note: "n".repeat(300) }), {})
    const e = validateTerm({ source: "a".repeat(201), thai: "ก".repeat(201), note: "n".repeat(301) })
    assert.match(e.source ?? "", /200/)
    assert.match(e.thai ?? "", /200/)
    assert.match(e.note ?? "", /300/)
    assert.deepEqual(validateTerm({ source: ` ${"a".repeat(200)} `, thai: "ก", note: "" }), {})
  })
})

describe("termChanges — ส่งเฉพาะช่องที่เปลี่ยน (ตัดช่องว่างหัวท้าย)", () => {
  test("ไม่ได้แก้ → {} · ต่างแค่ช่องว่างหัวท้าย → {}", () => {
    assert.deepEqual(termChanges(term(), draftOfTerm(term())), {})
    assert.deepEqual(termChanges(term(), { source: " Moon Gate ", thai: "ประตูจันทรา ", note: " ชื่อสถานที่" }), {})
  })
  test("แก้ช่องเดียว → ช่องเดียว (ค่าที่ตัดแล้ว)", () => {
    assert.deepEqual(termChanges(term(), { ...draftOfTerm(term()), thai: " ประตูพระจันทร์ " }), { thai: "ประตูพระจันทร์" })
  })
  test("ล้างหมายเหตุ → ส่ง note ว่าง", () => {
    assert.deepEqual(termChanges(term(), { ...draftOfTerm(term()), note: "" }), { note: "" })
  })
  test("แก้หลายช่อง → ส่งครบ", () => {
    assert.deepEqual(termChanges(term(), { source: "X", thai: "ย", note: "n" }), { source: "X", thai: "ย", note: "n" })
  })
})

describe("draftOfTerm / EMPTY_TERM / filterTerms / aiCount / summaryLine", () => {
  test("draftOfTerm เอาสามช่อง · EMPTY_TERM ว่าง", () => {
    assert.deepEqual(draftOfTerm(term()), { source: "Moon Gate", thai: "ประตูจันทรา", note: "ชื่อสถานที่" })
    assert.deepEqual(EMPTY_TERM, { source: "", thai: "", note: "" })
  })
  const rows = [term({ id: 1 }), term({ id: 2, auto: true }), term({ id: 3, auto: true })]
  test("ตัวกรอง 'เฉพาะที่ AI เพิ่ม' เหลือเฉพาะ auto · ปิดตัวกรองได้ทั้งหมด", () => {
    assert.deepEqual(filterTerms(rows, true).map((t) => t.id), [2, 3])
    assert.deepEqual(filterTerms(rows, false).map((t) => t.id), [1, 2, 3])
  })
  test("aiCount นับเฉพาะ auto", () => {
    assert.equal(aiCount(rows), 2)
    assert.equal(aiCount([]), 0)
  })
  test("summaryLine: ทั้งหมด + AI เพิ่ม", () => {
    assert.equal(summaryLine(rows), "ทั้งหมด 3 คำ · AI เพิ่ม 2 คำ")
    assert.equal(summaryLine([]), "ทั้งหมด 0 คำ · AI เพิ่ม 0 คำ")
    assert.equal(summaryLine(Array.from({ length: 1200 }, (_, i) => term({ id: i + 1 }))), "ทั้งหมด 1,200 คำ · AI เพิ่ม 0 คำ")
  })
})

describe("deleteTermMessage", () => {
  test("ระบุคำที่จะลบ และบอกว่า AI อาจเสนอกลับมาใหม่ถ้าเป็นคำที่ AI เพิ่ม", () => {
    const m = deleteTermMessage(term({ auto: true }))
    assert.match(m, /Moon Gate/)
    assert.match(m, /ประตูจันทรา/)
    assert.match(m, /AI อาจเสนอ/)
  })
  test("คำที่เจ้าของเพิ่มเอง → ไม่มีข้อความเรื่อง AI เสนอกลับ", () => {
    assert.doesNotMatch(deleteTermMessage(term()), /AI อาจเสนอ/)
  })
})
