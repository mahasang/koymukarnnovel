import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { FOCUSABLE, dialogKeyAction, focusableIn, trapTarget } from "./focus"

/** วนโฟกัสในกล่องโต้ตอบ (focus trap) — ส่วนตัดสินใจล้วน ไม่แตะ DOM; ตัวค้นหา element ที่โฟกัสได้ตรวจในเบราว์เซอร์จริง */

describe("trapTarget: กด Tab แล้วโฟกัสต้องไปไหน", () => {
  test("กลางกลุ่ม → null (ปล่อยให้เบราว์เซอร์เลื่อนเอง)", () => {
    assert.equal(trapTarget(3, 1, false), null)
    assert.equal(trapTarget(3, 1, true), null)
    assert.equal(trapTarget(3, 0, false), null)
    assert.equal(trapTarget(3, 2, true), null)
  })
  test("Tab ที่ตัวสุดท้าย → วนไปตัวแรก", () => {
    assert.equal(trapTarget(3, 2, false), 0)
    assert.equal(trapTarget(1, 0, false), 0)
  })
  test("Shift+Tab ที่ตัวแรก → วนไปตัวสุดท้าย", () => {
    assert.equal(trapTarget(3, 0, true), 2)
    assert.equal(trapTarget(1, 0, true), 0)
  })
  test("โฟกัสอยู่ที่ตัวกล่องเอง/นอกรายการ (active = -1): Tab → ตัวแรก, Shift+Tab → ตัวสุดท้าย", () => {
    assert.equal(trapTarget(3, -1, false), 0)
    assert.equal(trapTarget(3, -1, true), 2)
  })
  test("ไม่มีอะไรให้โฟกัสเลย → ค้างที่ตัวกล่อง", () => {
    assert.equal(trapTarget(0, -1, false), "dialog")
    assert.equal(trapTarget(0, -1, true), "dialog")
  })
})

describe("dialogKeyAction", () => {
  const free = { busy: false, count: 2, active: 0 }
  test("Escape → ยกเลิก", () => {
    assert.deepEqual(dialogKeyAction("Escape", false, free), { type: "cancel" })
  })
  test("Escape ระหว่างกำลังทำงาน → ไม่ทำอะไร (ปิดกลางคำสั่งไม่ได้)", () => {
    assert.equal(dialogKeyAction("Escape", false, { ...free, busy: true }), null)
  })
  test("Tab ที่ขอบ → สั่งย้ายโฟกัส; กลางกลุ่ม → null", () => {
    assert.deepEqual(dialogKeyAction("Tab", false, { busy: false, count: 2, active: 1 }), { type: "focus", target: 0 })
    assert.deepEqual(dialogKeyAction("Tab", true, free), { type: "focus", target: 1 })
    assert.equal(dialogKeyAction("Tab", false, free), null)
  })
  test("Tab ระหว่างกำลังทำงาน (ปุ่มถูกปิด ไม่เหลืออะไรโฟกัสได้) → ค้างที่ตัวกล่อง", () => {
    assert.deepEqual(dialogKeyAction("Tab", false, { busy: true, count: 0, active: -1 }), { type: "focus", target: "dialog" })
  })
  test("ปุ่มอื่น → null", () => {
    for (const key of ["Enter", " ", "a", "ArrowDown", "Shift"]) assert.equal(dialogKeyAction(key, false, free), null, key)
  })
})

describe("FOCUSABLE", () => {
  test("ครอบคลุมลิงก์ ปุ่ม ช่องกรอก และ tabindex ที่ไม่ใช่ -1 แต่ไม่รวมของที่ถูกปิด", () => {
    for (const part of ["a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])", '[tabindex]:not([tabindex="-1"])', ':not([type="hidden"])'])
      assert.ok(FOCUSABLE.includes(part), part)
  })
})

describe("focusableIn: เก็บเฉพาะตัวที่มองเห็นอยู่ ตามลำดับเอกสาร", () => {
  // ไม่มี DOM ในเทสต์: ใช้ root ปลอมที่มีแค่ querySelectorAll (ตัวที่ display:none มี getClientRects ว่าง)
  const el = (id: string, visible: boolean) => ({ id, getClientRects: () => (visible ? [{}] : []) })
  const rootOf = (els: ReturnType<typeof el>[]) => {
    const asked: string[] = []
    const root = {
      querySelectorAll(selector: string) {
        asked.push(selector)
        return els
      },
    }
    return { root: root as unknown as HTMLElement, asked }
  }

  test("ตัดตัวที่ไม่ได้แสดงอยู่ออก คงลำดับเดิม และถามด้วยตัวเลือก FOCUSABLE", () => {
    const { root, asked } = rootOf([el("a", true), el("b", false), el("c", true), el("d", false)])
    assert.deepEqual(
      focusableIn(root).map((e) => e.id),
      ["a", "c"],
    )
    assert.deepEqual(asked, [FOCUSABLE])
  })

  test("ไม่มีตัวที่มองเห็นเลย → รายการว่าง (กล่องจะโฟกัสที่ตัวเอง)", () => {
    assert.deepEqual(focusableIn(rootOf([el("x", false)]).root), [])
    assert.deepEqual(focusableIn(rootOf([]).root), [])
  })
})
