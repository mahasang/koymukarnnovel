import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ApiError } from "../lib/api"
import { parseChapters, type ParsedRow } from "../lib/parse-chapters"
import {
  applyConflicts,
  buildPayload,
  conflictsOf,
  costLine,
  DEFAULT_OPTIONS,
  editRow,
  effectiveOptions,
  novelIdFrom,
  parseNumberInput,
  parseOptions,
  rowNote,
  submitErrorMessage,
  submitLabel,
} from "./add-logic"

const row = (over: Partial<ParsedRow> & { number: number | null }): ParsedRow => ({
  key: `r${over.number}`,
  kind: "chapter",
  title: `T${over.number}`,
  text: "เนื้อหา body",
  words: 2,
  checked: true,
  issues: [],
  ...over,
})

describe("parseOptions — ค่าที่จำไว้ใน localStorage อาจเสีย/ของรุ่นเก่า", () => {
  test("ค่าเริ่มต้น: แปลทันที เปิด · เผยแพร่เอง ปิด", () => {
    assert.deepEqual(DEFAULT_OPTIONS, { translate: true, publish: false })
  })
  test("ค่าที่ถูกต้องอ่านกลับตามเดิม", () => {
    assert.deepEqual(parseOptions({ translate: false, publish: true }), { translate: false, publish: true })
  })
  test("ไม่ใช่ออบเจ็กต์/ชนิดผิด → ใช้ค่าเริ่มต้นทีละช่อง", () => {
    for (const bad of [null, undefined, "x", 5, [], true]) assert.deepEqual(parseOptions(bad), DEFAULT_OPTIONS)
    assert.deepEqual(parseOptions({ translate: "no", publish: 1 }), DEFAULT_OPTIONS)
    assert.deepEqual(parseOptions({ translate: false }), { translate: false, publish: false })
    assert.deepEqual(parseOptions({ publish: true }), { translate: true, publish: true })
  })
})

describe("effectiveOptions — ตัวเลือกที่ใช้จริง", () => {
  test("ไม่มีคีย์ API → ไม่แปลทันที และไม่เผยแพร่เอง (บันทึกเป็นร่าง)", () => {
    assert.deepEqual(effectiveOptions({ translate: true, publish: true }, false), { translate: false, publish: false })
  })
  test("มีคีย์ → ตามที่เลือก", () => {
    assert.deepEqual(effectiveOptions({ translate: true, publish: true }, true), { translate: true, publish: true })
  })
  test("ไม่แปลทันที → เผยแพร่เองไม่ได้ แม้จำค่า publish ไว้เป็นจริง", () => {
    assert.deepEqual(effectiveOptions({ translate: false, publish: true }, true), { translate: false, publish: false })
  })
})

describe("submitLabel", () => {
  test("แปลทันที → แปล N ตอน", () => assert.equal(submitLabel(3, true), "แปล 3 ตอน"))
  test("ไม่แปล → บันทึกเป็นร่าง", () => assert.equal(submitLabel(3, false), "บันทึกเป็นร่าง"))
  test("ยังไม่ติ๊กเลย → ไม่มีเลข 0 ในปุ่มแปล", () => {
    assert.equal(submitLabel(0, true), "แปล")
    assert.equal(submitLabel(0, false), "บันทึกเป็นร่าง")
  })
})

describe("buildPayload", () => {
  test("เฉพาะแถวที่ติ๊ก เรียงตามเลขตอน ไม่ใช่ตามลำดับที่วาง", () => {
    const rows = [row({ number: 5 }), row({ number: 2, checked: false }), row({ number: 3 }), row({ number: 1 })]
    const p = buildPayload(rows, { translate: true, publish: false })
    assert.deepEqual(
      p.chapters.map((c) => c.number),
      [1, 3, 5],
    )
  })
  test("ชื่อตัดช่องว่างหัวท้าย · text เป็นเนื้อหาของแถว · ส่งธง translate/publish ตามตัวเลือก", () => {
    const p = buildPayload([row({ number: 1, title: "  Hello  ", text: "abc" })], { translate: true, publish: true })
    assert.deepEqual(p, { chapters: [{ number: 1, title: "Hello", text: "abc" }], translate: true, publish: true })
    assert.deepEqual(buildPayload([row({ number: 1 })], { translate: false, publish: false }).translate, false)
  })
  test("ตอน 0 ส่งได้ (เซิร์ฟเวอร์รับเลข ≥ 0)", () => {
    assert.deepEqual(buildPayload([row({ number: 0 }), row({ number: 1 })], DEFAULT_OPTIONS).chapters.map((c) => c.number), [0, 1])
  })
  test("แถวที่ไม่มีเลข (null) ไม่เข้าชุด — ไม่โยน", () => {
    assert.deepEqual(buildPayload([row({ number: null })], DEFAULT_OPTIONS).chapters, [])
  })
})

describe("conflictsOf — 409 duplicate_numbers", () => {
  test("อ่านรายการเลขซ้ำจากตัวคำตอบ", () => {
    const e = new ApiError(409, "เลขตอนซ้ำ", "duplicate_numbers", { conflicts: [2, 7], error: "x", code: "duplicate_numbers" })
    assert.deepEqual(conflictsOf(e), [2, 7])
  })
  test("รหัสอื่น/สถานะอื่น/รูปร่างเพี้ยน → null", () => {
    assert.equal(conflictsOf(new ApiError(409, "x", "other", { conflicts: [1] })), null)
    assert.equal(conflictsOf(new ApiError(400, "x", "duplicate_numbers", { conflicts: [1] })), null)
    assert.equal(conflictsOf(new ApiError(409, "x", "duplicate_numbers", {})), null)
    assert.equal(conflictsOf(new ApiError(409, "x", "duplicate_numbers", { conflicts: "1" })), null)
    assert.equal(conflictsOf(new ApiError(409, "x", "duplicate_numbers")), null)
    assert.equal(conflictsOf(new Error("x")), null)
    assert.equal(conflictsOf(null), null)
  })
  test("กรองค่าที่ไม่ใช่เลขตอนที่ใช้ได้ทิ้ง (ตอน 0 ยังนับ); ว่างทั้งหมด → null", () => {
    const e = (c: unknown) => new ApiError(409, "x", "duplicate_numbers", { conflicts: c })
    assert.deepEqual(conflictsOf(e([3, "a", -1, 1.5, 0, 4])), [3, 0, 4])
    assert.equal(conflictsOf(e(["a"])), null)
    assert.equal(conflictsOf(e([])), null)
  })
})

describe("applyConflicts", () => {
  const existing = new Set([1])
  test("เลขที่ชนถูกเพิ่มเข้าเซตตอนที่มีอยู่ แถวนั้นได้ป้ายซ้ำและถูกเอาติ๊กออก แถวอื่นคงเดิม", () => {
    const rows = parseChapters("Chapter 2: A\nx\n\nChapter 3: B\ny\n\nChapter 4: C\nz", existing)
    const out = applyConflicts(rows, existing, [3])
    assert.deepEqual([...out.existing].sort(), [1, 3])
    assert.deepEqual(
      out.rows.map((r) => [r.number, r.checked, r.issues]),
      [
        [2, true, []],
        [3, false, ["duplicate"]],
        [4, true, []],
      ],
    )
  })
  test("ไม่แก้ของเดิม (คืนเซต/แถวใหม่)", () => {
    const rows = parseChapters("Chapter 2: A\nx", existing)
    const out = applyConflicts(rows, existing, [2])
    assert.equal(existing.size, 1)
    assert.equal(rows[0]!.checked, true)
    assert.notEqual(out.existing, existing)
  })
  test("แถวที่ติ๊กเองทั้งที่มีป้ายซ้ำอยู่แล้วก็ถูกเอาติ๊กออกเมื่อเซิร์ฟเวอร์ยืนยันว่าชน", () => {
    const r = row({ number: 9, issues: ["duplicate"], checked: true })
    assert.equal(applyConflicts([r], new Set(), [9]).rows[0]!.checked, false)
  })
})

describe("submitErrorMessage — แสดงข้อความภาษาไทยของเซิร์ฟเวอร์", () => {
  test("413 → ข้อความของเซิร์ฟเวอร์ + คำแนะนำให้ลดจำนวนตอน", () => {
    const m = submitErrorMessage(new ApiError(413, "ข้อมูลที่ส่งมาใหญ่เกินกำหนด", "too_large"))
    assert.match(m, /^ข้อมูลที่ส่งมาใหญ่เกินกำหนด/)
    assert.match(m, /ลดจำนวนตอน/)
  })
  test("400 no_api_key และอื่นๆ → ข้อความของเซิร์ฟเวอร์ตรงๆ", () => {
    assert.equal(submitErrorMessage(new ApiError(400, "ยังไม่ได้ตั้งคีย์ API", "no_api_key")), "ยังไม่ได้ตั้งคีย์ API")
    assert.equal(submitErrorMessage(new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")), "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
  })
  test("ไม่ใช่ ApiError → ข้อความกลาง", () => {
    assert.equal(submitErrorMessage(new Error("boom")), "ทำไม่สำเร็จ ลองอีกครั้ง")
  })
})

describe("costLine", () => {
  const price = { in: 3, out: 15 }
  test("มีราคา → จำนวนตอน ประมาณโทเคน และเงิน", () => {
    const line = costLine([4000, 4000], price)
    assert.ok(line !== null)
    assert.match(line, /^ประมาณการ: 2 ตอน/)
    assert.match(line, /\$0\.\d+/)
    assert.match(line, /ประมาณคร่าวๆ/)
  })
  test("ตัวเลขโทเคน: 4,000 ตัวอักษร → เข้า 2,500 (1,000 + 1,500 ค่าคำสั่ง) ออก 1,800 ตามลำดับ เข้าก่อนออก", () => {
    assert.match(costLine([4000], price)!, /โทเคนเข้า ≈ 2,500 · ออก ≈ 1,800/)
  })
  test("ไม่มีราคา → ไม่ประเมินเงิน แต่ยังบอกโทเคนได้ หรือ null เมื่อไม่มีตอน", () => {
    const line = costLine([4000], undefined)
    assert.ok(line !== null)
    assert.doesNotMatch(line, /\$/)
    assert.equal(costLine([], price), null)
  })
})

describe("rowNote — ป้ายเตือนรายแถว", () => {
  test("ไม่มี issue → null; มี → ข้อความไทยตาม issue (เรียงตามความสำคัญ รวมเป็นข้อความเดียว)", () => {
    assert.equal(rowNote([]), null)
    assert.match(rowNote(["duplicate"])!, /เลขตอนนี้มีอยู่แล้ว|ซ้ำ/)
    assert.match(rowNote(["bad_number"])!, /เลขตอน/)
    assert.match(rowNote(["empty"])!, /ไม่มีเนื้อหา|ว่าง/)
    assert.match(rowNote(["too_long"])!, /200,000/)
    const both = rowNote(["empty", "duplicate"])!
    assert.match(both, /ซ้ำ|มีอยู่แล้ว/)
    assert.match(both, /ว่าง|ไม่มีเนื้อหา/)
    // ลำดับความสำคัญคงที่ไม่ว่า issue มาลำดับไหน: ซ้ำ → เลขใช้ไม่ได้ → ไม่มีเนื้อหา → ยาวเกิน คั่นด้วย " · "
    assert.equal(rowNote(["too_long", "empty", "bad_number", "duplicate"]), "เลขตอนนี้ซ้ำกับตอนที่มีอยู่แล้ว · เลขตอนใช้ไม่ได้ (ต้องเป็นจำนวนเต็มบวก) · ไม่มีเนื้อหา · ยาวเกิน 200,000 ตัวอักษร")
  })
})

describe("novelIdFrom — เลือกเรื่องจาก ?novel=", () => {
  const novels = [{ id: 4 }, { id: 9 }]
  test("รหัสที่มีอยู่ → รหัสนั้น", () => assert.equal(novelIdFrom("9", novels), 9))
  test("ไม่ระบุ/ไม่ใช่เลข/ไม่มีเรื่องนั้น → null (ให้เจ้าของเลือกเอง)", () => {
    for (const q of [null, "", "abc", "3", "9.5", "-9", "9x", "0", "09", "9.0", " 9", "9 ", "+9", "0x9"]) assert.equal(novelIdFrom(q, novels), null, String(q))
  })
  test("รหัสต้องเป็นเลขล้วนรูปมาตรฐาน: ไม่รับ 0 หรือไม่ระบุ แม้มีเรื่องรหัส 0 (ไม่ควรมีจริง)", () => {
    assert.equal(novelIdFrom("0", [{ id: 0 }]), null)
    assert.equal(novelIdFrom(null, [{ id: 0 }]), null)
  })
  test("ไม่มีเรื่องเลย → null", () => assert.equal(novelIdFrom("4", []), null))
})

describe("parseNumberInput — ช่องเลขตอน", () => {
  test("ว่าง → null (ล้างเลข) · เลขล้วน → จำนวน (ตอน 0 ใช้ได้) · ตัดช่องว่างหัวท้าย", () => {
    assert.equal(parseNumberInput(""), null)
    assert.equal(parseNumberInput("  "), null)
    assert.equal(parseNumberInput("12"), 12)
    assert.equal(parseNumberInput(" 7 "), 7)
    assert.equal(parseNumberInput("0"), 0)
    assert.equal(parseNumberInput("007"), 7)
  })
  test("มีอักขระอื่น/ยาวเกินจะเป็นเลขปลอดภัยไม่ได้ → undefined (ไม่เปลี่ยนค่าเดิม)", () => {
    for (const bad of ["1a", "a", "-1", "1.5", "1e3", "٣", "12345678901"]) assert.equal(parseNumberInput(bad), undefined, bad)
  })
})

describe("editRow — แก้แถวแล้วตรวจใหม่", () => {
  const existing = new Set([1])
  const rows = parseChapters("Chapter 2: A\nx\n\nChapter 3: B\ny", existing)
  test("แก้ชื่อ: เฉพาะแถวนั้น ไม่แตะแถวอื่น", () => {
    const out = editRow(rows, existing, rows[0]!.key, { title: "ใหม่" })
    assert.equal(out[0]!.title, "ใหม่")
    assert.equal(out[1]!.title, "B")
  })
  test("แก้เลขไปซ้ำกับตอนที่มีอยู่ → ได้ป้ายซ้ำและเอาติ๊กออก", () => {
    const out = editRow(rows, existing, rows[0]!.key, { number: 1 })
    assert.deepEqual(out[0]!.issues, ["duplicate"])
    assert.equal(out[0]!.checked, false)
  })
  test("ล้างเลข → bad_number และเอาติ๊กออก · แก้กลับเป็นเลขดี ป้ายหาย (ไม่ติ๊กให้เอง)", () => {
    const cleared = editRow(rows, existing, rows[0]!.key, { number: null })
    assert.deepEqual(cleared[0]!.issues, ["bad_number"])
    assert.equal(cleared[0]!.checked, false)
    const fixed = editRow(cleared, existing, rows[0]!.key, { number: 9 })
    assert.deepEqual(fixed[0]!.issues, [])
    assert.equal(fixed[0]!.checked, false)
  })
  test("ติ๊ก/เอาติ๊กออกได้เอง · key ที่ไม่มี → ไม่เปลี่ยนอะไร", () => {
    assert.equal(editRow(rows, existing, rows[1]!.key, { checked: false })[1]!.checked, false)
    assert.deepEqual(editRow(rows, existing, "nope", { title: "x" }), rows)
  })
  test("เลขชนกันเองในชุดที่วาง: แถวหลังเป็นฝ่ายถูกทำเครื่องหมาย", () => {
    const out = editRow(rows, existing, rows[1]!.key, { number: 2 })
    assert.deepEqual(out[0]!.issues, [])
    assert.deepEqual(out[1]!.issues, ["duplicate"])
  })
})
