import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  actionState,
  changedFields,
  draftOf,
  isDirty,
  LEAVE_MESSAGE,
  lengthLabel,
  lockedFields,
  neighbors,
  rebase,
  saveNotice,
  translationNote,
} from "./chapter-edit-logic"
import type { AdminChapterDto, AdminChapterRow } from "./types"

const dto = (over: Partial<AdminChapterDto> = {}): AdminChapterDto => ({
  id: 5,
  novelId: 1,
  number: 3,
  title: "The Stairs",
  titleTh: "บันได",
  sourceText: "Source body",
  translation: "เนื้อหาแปล",
  recap: "สรุป",
  status: "done",
  error: "",
  published: false,
  publishedAt: null,
  translatedAt: "2026-10-01 00:00:00",
  queueSeq: null,
  autoPublish: false,
  createdAt: "2026-10-01 00:00:00",
  updatedAt: "2026-10-01 00:00:00",
  ...over,
})

const row = (id: number, number: number): AdminChapterRow => ({
  id,
  number,
  title: "T",
  titleTh: "",
  status: "done",
  error: "",
  published: false,
  publishedAt: null,
  translatedAt: null,
  queueSeq: null,
  hasTranslation: true,
  srcLength: 1,
})

describe("draftOf / changedFields / isDirty — ส่งเฉพาะฟิลด์ที่เปลี่ยน", () => {
  test("draftOf เอาเฉพาะห้าช่องที่แก้ได้", () => {
    assert.deepEqual(draftOf(dto()), { title: "The Stairs", titleTh: "บันได", sourceText: "Source body", translation: "เนื้อหาแปล", recap: "สรุป" })
  })
  test("ไม่แก้อะไร → ไม่มีฟิลด์ · ไม่ dirty", () => {
    const base = draftOf(dto())
    assert.deepEqual(changedFields(base, { ...base }), {})
    assert.equal(isDirty(base, { ...base }), false)
  })
  test("แก้ฟิลด์เดียว → ส่งฟิลด์นั้นฟิลด์เดียว", () => {
    const base = draftOf(dto())
    assert.deepEqual(changedFields(base, { ...base, titleTh: "บันไดหิน" }), { titleTh: "บันไดหิน" })
    assert.deepEqual(changedFields(base, { ...base, recap: "" }), { recap: "" })
    assert.equal(isDirty(base, { ...base, translation: "x" }), true)
  })
  test("แก้หลายฟิลด์ → ส่งครบทุกฟิลด์ที่เปลี่ยน", () => {
    const base = draftOf(dto())
    assert.deepEqual(changedFields(base, { ...base, title: "A", sourceText: "B", translation: "C" }), { title: "A", sourceText: "B", translation: "C" })
  })
  test("แก้แล้วพิมพ์กลับเป็นค่าเดิม → ไม่นับว่าเปลี่ยน", () => {
    const base = draftOf(dto())
    assert.equal(isDirty(base, { ...base, title: "x" }), true)
    assert.equal(isDirty(base, { ...base, title: base.title }), false)
  })
})

describe("rebase — ช่องที่เจ้าของไม่ได้แตะตามค่าใหม่จากเซิร์ฟเวอร์ ช่องที่แก้แล้วคงไว้", () => {
  const oldBase = draftOf(dto({ status: "translating", translation: "" }))
  const newBase = draftOf(dto({ status: "done", translation: "คำแปลใหม่", titleTh: "ชื่อจาก AI", recap: "สรุปจาก AI" }))
  test("ไม่ได้แตะอะไร → ได้ค่าใหม่ทั้งหมด (คำแปลที่เพิ่งแปลเสร็จโผล่ในช่อง)", () => {
    assert.deepEqual(rebase({ ...oldBase }, oldBase, newBase), newBase)
  })
  test("แก้เรื่องย่อค้างไว้ → เรื่องย่อของเจ้าของไม่ถูกทับ ช่องอื่นตามค่าใหม่", () => {
    const out = rebase({ ...oldBase, recap: "ผมพิมพ์เอง" }, oldBase, newBase)
    assert.equal(out.recap, "ผมพิมพ์เอง")
    assert.equal(out.translation, "คำแปลใหม่")
    assert.equal(out.titleTh, "ชื่อจาก AI")
  })
  test("หลังบันทึก: แก้ช่องอื่นระหว่างรอ → คงไว้ · ยังนับว่า dirty เทียบกับค่าที่เซิร์ฟเวอร์เก็บ", () => {
    const submitted = { ...oldBase, titleTh: "ส่งไป" }
    const server = { ...oldBase, titleTh: "ส่งไป" }
    const current = { ...submitted, recap: "พิมพ์เพิ่มระหว่างรอ" }
    const out = rebase(current, submitted, server)
    assert.equal(out.recap, "พิมพ์เพิ่มระหว่างรอ")
    assert.equal(isDirty(server, out), true)
  })
  test("ไม่มีอะไรเปลี่ยนจากเซิร์ฟเวอร์ → คืนค่าเท่ากับเดิม", () => {
    assert.deepEqual(rebase({ ...oldBase }, oldBase, oldBase), oldBase)
  })
})

describe("lockedFields / translationNote — ตอนกำลังแปลและตอนยังไม่มีคำแปล", () => {
  test("translating: ต้นฉบับและคำแปลถูกล็อก (เซิร์ฟเวอร์ตอบ 409 ทั้งสองช่อง) ชื่อ/เรื่องย่อไม่ล็อก", () => {
    assert.deepEqual(lockedFields("translating"), { sourceText: true, translation: true })
  })
  test("สถานะอื่นไม่ล็อกอะไร", () => {
    for (const status of ["draft", "queued", "done", "error"] as const) assert.deepEqual(lockedFields(status), { sourceText: false, translation: false }, status)
  })
  test("กำลังแปล: บอกให้รอหรือหยุดคิว และบอกว่าแก้ชื่อ/เรื่องย่อได้", () => {
    const note = translationNote(dto({ status: "translating", translation: "" }))
    assert.match(note ?? "", /รอ/)
    assert.match(note ?? "", /หยุดคิว/)
    assert.match(note ?? "", /ชื่อและเรื่องย่อ/)
  })
  test("กำลังแปลแต่มีคำแปลเก่า → ยังเป็นข้อความกำลังแปล (ไม่ใช่ข้อความวางคำแปล)", () => {
    assert.doesNotMatch(translationNote(dto({ status: "translating" })) ?? "", /วางคำแปล/)
  })
  test("ยังไม่มีคำแปล: บอกว่าวางคำแปลเองได้ ไม่เสียค่า API และไม่เผยแพร่เอง", () => {
    for (const status of ["draft", "error", "queued"] as const) {
      const note = translationNote(dto({ status, translation: "" }))
      assert.match(note ?? "", /วางคำแปล/, status)
      assert.match(note ?? "", /ไม่เสียค่า API/, status)
      assert.match(note ?? "", /ไม่เผยแพร่/, status)
    }
  })
  test("มีคำแปลแล้วและไม่ได้กำลังแปล → ไม่มีข้อความ", () => {
    assert.equal(translationNote(dto()), null)
    assert.equal(translationNote(dto({ status: "error", error: "x" })), null)
  })
})

describe("actionState — ปุ่ม บันทึก · แปลใหม่ · เผยแพร่/ซ่อน", () => {
  test("ไม่ dirty: บันทึกปิด · แปลใหม่ใช้ได้ · เผยแพร่ใช้ได้", () => {
    const a = actionState(dto(), false)
    assert.equal(a.canSave, false)
    assert.equal(a.canTranslate, true)
    assert.equal(a.translateLabel, "แปลใหม่")
    assert.equal(a.canToggle, true)
    assert.equal(a.toggleLabel, "เผยแพร่")
    assert.equal(a.toggleTo, true)
    assert.equal(a.reason, null)
  })
  test("dirty: บันทึกใช้ได้ · แปลใหม่/เผยแพร่ปิดพร้อมเหตุผลให้บันทึกก่อน", () => {
    const a = actionState(dto(), true)
    assert.equal(a.canSave, true)
    assert.equal(a.canTranslate, false)
    assert.equal(a.canToggle, false)
    assert.match(a.reason ?? "", /บันทึกก่อน/)
  })
  test("เผยแพร่อยู่แล้ว → ปุ่มเป็น 'ซ่อน' และสั่งซ่อน", () => {
    const a = actionState(dto({ published: true }), false)
    assert.equal(a.toggleLabel, "ซ่อน")
    assert.equal(a.toggleTo, false)
    assert.equal(a.canToggle, true)
  })
  test("ยังไม่มีคำแปล: เผยแพร่ไม่ได้ (เหตุผลบอกชัด) · ปุ่มแปลชื่อ 'แปล'", () => {
    const a = actionState(dto({ translation: "", status: "draft" }), false)
    assert.equal(a.canToggle, false)
    assert.match(a.reason ?? "", /ยังไม่มีคำแปล/)
    assert.equal(a.translateLabel, "แปล")
    assert.equal(a.canTranslate, true)
  })
  test("รอคิว/กำลังแปล: สั่งแปลซ้ำไม่ได้ · ส่วนเผยแพร่ตามคำแปลที่มี", () => {
    for (const status of ["queued", "translating"] as const) {
      const a = actionState(dto({ status }), false)
      assert.equal(a.canTranslate, false, status)
      assert.equal(a.canToggle, true, status)
    }
  })
  test("ซ่อนทำได้เสมอแม้ไม่มีคำแปล (ข้อมูลผิดปกติ) ถ้าไม่ dirty", () => {
    assert.equal(actionState(dto({ published: true, translation: "" }), false).canToggle, true)
  })
  test("ตอนผิดพลาด: แปลใหม่ใช้ได้", () => {
    assert.equal(actionState(dto({ status: "error", error: "x" }), false).canTranslate, true)
  })
})

describe("neighbors — ตอนก่อนหน้า/ถัดไปตามเลขตอน", () => {
  const rows = [row(30, 3), row(10, 1), row(20, 2)]
  test("กลาง: ได้ทั้งสองข้างโดยเรียงตามเลขตอน (ไม่ใช่ลำดับในอาร์เรย์)", () => {
    const n = neighbors(rows, 20)
    assert.equal(n.prev?.id, 10)
    assert.equal(n.next?.id, 30)
  })
  test("ตอนแรกไม่มีก่อนหน้า · ตอนสุดท้ายไม่มีถัดไป", () => {
    assert.equal(neighbors(rows, 10).prev, null)
    assert.equal(neighbors(rows, 30).next, null)
  })
  test("ไม่พบรหัส/รายการว่าง → ไม่มีทั้งคู่", () => {
    assert.deepEqual(neighbors(rows, 99), { prev: null, next: null })
    assert.deepEqual(neighbors([], 1), { prev: null, next: null })
  })
})

describe("saveNotice / lengthLabel / LEAVE_MESSAGE", () => {
  test("วางคำแปลในตอนที่ยังไม่มีคำแปล → บอกว่าเป็นแปลเสร็จแล้วแต่ยังไม่เผยแพร่", () => {
    const before = dto({ translation: "", status: "draft" })
    const after = dto({ status: "done" })
    const note = saveNotice({ translation: "เนื้อหาแปล" }, before, after)
    assert.match(note, /แปลเสร็จ/)
    assert.match(note, /ยังไม่เผยแพร่/)
  })
  test("แก้คำแปลที่มีอยู่แล้ว/แก้ช่องอื่น → 'บันทึกแล้ว' เฉยๆ", () => {
    assert.equal(saveNotice({ translation: "ใหม่" }, dto(), dto({ translation: "ใหม่" })), "บันทึกแล้ว")
    assert.equal(saveNotice({ recap: "x" }, dto({ translation: "", status: "draft" }), dto({ translation: "", status: "draft" })), "บันทึกแล้ว")
  })
  test("ตอนที่เผยแพร่อยู่แล้วและวางคำแปลไม่ได้เปลี่ยนสถานะเผยแพร่ → ไม่กล่าวว่ายังไม่เผยแพร่", () => {
    assert.equal(saveNotice({ translation: "x" }, dto({ translation: "", published: true }), dto({ published: true })), "บันทึกแล้ว — ตอนนี้มีคำแปลและเป็น “แปลเสร็จ”")
  })
  test("วางคำแปลแต่ตอนยังไม่เป็นแปลเสร็จ (เช่นอยู่ในคิว) → ไม่บอกว่าแปลเสร็จ", () => {
    assert.equal(saveNotice({ translation: "x" }, dto({ translation: "", status: "draft" }), dto({ status: "queued" })), "บันทึกแล้ว")
  })
  test("lengthLabel ใส่จุลภาค", () => {
    assert.equal(lengthLabel("abc"), "3 ตัวอักษร")
    assert.equal(lengthLabel("a".repeat(12345)), "12,345 ตัวอักษร")
    assert.equal(lengthLabel(""), "0 ตัวอักษร")
  })
  test("ข้อความยืนยันออก: บอกว่าแก้ค้างจะหาย", () => {
    assert.match(LEAVE_MESSAGE, /ยังไม่ได้บันทึก/)
  })
})
