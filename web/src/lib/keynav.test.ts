import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { menuKeyAction, nextMenuIndex } from "./keynav"

describe("nextMenuIndex", () => {
  test("ลูกศรลง → รายการถัดไป วนกลับไปรายการแรกเมื่อถึงท้าย", () => {
    assert.equal(nextMenuIndex("ArrowDown", 0, 4), 1)
    assert.equal(nextMenuIndex("ArrowDown", 2, 4), 3)
    assert.equal(nextMenuIndex("ArrowDown", 3, 4), 0)
  })

  test("ลูกศรขึ้น → รายการก่อนหน้า วนไปรายการสุดท้ายเมื่อถึงต้น", () => {
    assert.equal(nextMenuIndex("ArrowUp", 3, 4), 2)
    assert.equal(nextMenuIndex("ArrowUp", 1, 4), 0)
    assert.equal(nextMenuIndex("ArrowUp", 0, 4), 3)
  })

  test("Home → รายการแรก, End → รายการสุดท้าย (จากที่ไหนก็ได้)", () => {
    for (const current of [-1, 0, 1, 3]) {
      assert.equal(nextMenuIndex("Home", current, 4), 0)
      assert.equal(nextMenuIndex("End", current, 4), 3)
    }
  })

  test("ยังไม่ได้โฟกัสรายการใด (-1): ลง → รายการแรก, ขึ้น → รายการสุดท้าย", () => {
    assert.equal(nextMenuIndex("ArrowDown", -1, 4), 0)
    assert.equal(nextMenuIndex("ArrowUp", -1, 4), 3)
  })

  test("มีรายการเดียว → ลง/ขึ้นวนอยู่ที่เดิม", () => {
    assert.equal(nextMenuIndex("ArrowDown", 0, 1), 0)
    assert.equal(nextMenuIndex("ArrowUp", 0, 1), 0)
    assert.equal(nextMenuIndex("End", 0, 1), 0)
  })

  test("ปุ่มอื่นไม่ถูกจัดการ (null) เพื่อให้ผู้เรียกปล่อยให้เบราว์เซอร์ทำงานต่อ", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "ArrowLeft", "ArrowRight", "a", "", "arrowdown", "PageDown"]) {
      assert.equal(nextMenuIndex(key, 1, 4), null, JSON.stringify(key))
    }
  })

  test("ไม่มีรายการเลย (0 หรือติดลบ) → null ทุกปุ่ม", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      assert.equal(nextMenuIndex(key, -1, 0), null, key)
      assert.equal(nextMenuIndex(key, 0, -3), null, key)
    }
  })

  test("ดัชนีปัจจุบันที่อยู่นอกช่วง (เช่น รายการเพิ่งลดลง) นับเหมือนยังไม่ได้โฟกัสรายการใด", () => {
    for (const outside of [9, 4, -2, -100, 1.5, NaN, Infinity]) {
      assert.equal(nextMenuIndex("ArrowDown", outside, 4), 0, String(outside))
      assert.equal(nextMenuIndex("ArrowUp", outside, 4), 3, String(outside))
    }
  })
})

describe("menuKeyAction", () => {
  test("เมนูปิดอยู่: ลูกศรลง/ขึ้นเปิดเมนู", () => {
    assert.deepEqual(menuKeyAction(false, "ArrowDown", -1, 4), { type: "open" })
    assert.deepEqual(menuKeyAction(false, "ArrowUp", -1, 4), { type: "open" })
    // จำนวนรายการไม่เกี่ยว: ตอนปิดอยู่ยังไม่มีรายการให้นับ
    assert.deepEqual(menuKeyAction(false, "ArrowDown", -1, 0), { type: "open" })
  })

  test("เมนูปิดอยู่: ปุ่มอื่นทั้งหมดไม่ถูกจัดการ (Escape, Home, End, Enter, Tab ปล่อยให้เบราว์เซอร์)", () => {
    for (const key of ["Escape", "Home", "End", "Enter", " ", "Tab", "ArrowLeft", "ArrowRight", "a", ""]) {
      assert.equal(menuKeyAction(false, key, 0, 4), null, JSON.stringify(key))
    }
  })

  test("เมนูเปิดอยู่: Escape ปิด", () => {
    assert.deepEqual(menuKeyAction(true, "Escape", 2, 4), { type: "close" })
    assert.deepEqual(menuKeyAction(true, "Escape", -1, 0), { type: "close" })
  })

  test("เมนูเปิดอยู่: ลูกศร/Home/End ย้ายโฟกัสตามดัชนีที่ nextMenuIndex ให้ (วนรอบได้)", () => {
    assert.deepEqual(menuKeyAction(true, "ArrowDown", 0, 4), { type: "focus", index: 1 })
    assert.deepEqual(menuKeyAction(true, "ArrowDown", 3, 4), { type: "focus", index: 0 })
    assert.deepEqual(menuKeyAction(true, "ArrowUp", 0, 4), { type: "focus", index: 3 })
    assert.deepEqual(menuKeyAction(true, "ArrowUp", 2, 4), { type: "focus", index: 1 })
    assert.deepEqual(menuKeyAction(true, "Home", 2, 4), { type: "focus", index: 0 })
    assert.deepEqual(menuKeyAction(true, "End", 1, 4), { type: "focus", index: 3 })
  })

  test("เมนูเปิดอยู่แต่โฟกัสยังไม่อยู่ที่รายการใด (-1): ลง → แรก, ขึ้น → สุดท้าย", () => {
    assert.deepEqual(menuKeyAction(true, "ArrowDown", -1, 4), { type: "focus", index: 0 })
    assert.deepEqual(menuKeyAction(true, "ArrowUp", -1, 4), { type: "focus", index: 3 })
  })

  test("เมนูเปิดอยู่: ปุ่มอื่นไม่ถูกจัดการ (Tab ต้องพาโฟกัสออกตามปกติ, Enter/Space กดรายการเอง)", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "PageDown", "a", ""]) {
      assert.equal(menuKeyAction(true, key, 1, 4), null, JSON.stringify(key))
    }
  })

  test("เมนูเปิดอยู่แต่ไม่มีรายการ → ปุ่มย้ายโฟกัสไม่ทำอะไร (null) แต่ Escape ยังปิดได้", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) assert.equal(menuKeyAction(true, key, -1, 0), null, key)
    assert.deepEqual(menuKeyAction(true, "Escape", -1, 0), { type: "close" })
  })
})
