import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { TagInputView, tagKeyAction, type TagInputViewProps } from "./TagInput"

const props = (over: Partial<TagInputViewProps> = {}): TagInputViewProps => ({
  id: "tags",
  hintId: "tags-hint",
  errorId: "tags-error",
  tags: [],
  text: "",
  problem: null,
  onText: () => {},
  onCommit: () => {},
  onRemove: () => {},
  ...over,
})

describe("tagKeyAction: แป้นในช่องแท็ก", () => {
  test("Enter (ปกติ) → เพิ่มแท็ก", () => {
    assert.equal(tagKeyAction({ key: "Enter", isComposing: false, keyCode: 13 }), "commit")
  })

  test("Enter ที่กดยืนยันคำจากแป้นพิมพ์ภาษา (isComposing หรือ keyCode 229) → ปล่อยผ่าน ไม่เพิ่มแท็กครึ่งคำ", () => {
    assert.equal(tagKeyAction({ key: "Enter", isComposing: true, keyCode: 13 }), "ignore")
    assert.equal(tagKeyAction({ key: "Enter", isComposing: false, keyCode: 229 }), "ignore")
  })

  test("แป้นอื่น → ไม่ทำอะไร", () => {
    for (const key of ["a", "Tab", "Escape", ",", "Backspace", " "]) assert.equal(tagKeyAction({ key, isComposing: false, keyCode: 65 }), null, key)
  })
})

describe("TagInputView", () => {
  test("ไม่มีแท็ก → ไม่มีรายการ (ไม่ทิ้งรายการว่างให้โปรแกรมอ่านหน้าจอ)", () => {
    assert.deepEqual(findAll(TagInputView(props()), (el) => el.type === "ul"), [])
  })

  test("แต่ละแท็กเป็นรายการหนึ่งพร้อมปุ่มลบที่บอกชื่อแท็ก · กดลบส่งตำแหน่งที่ถูกต้อง", () => {
    const removed: number[] = []
    const view = TagInputView(props({ tags: ["ผจญภัย", "แฟนตาซี", "ดราม่า"], onRemove: (i) => removed.push(i) }))
    const items = findAll(view, (el) => el.type === "li")
    assert.equal(items.length, 3)
    const buttons = findAll(view, (el) => el.type === "button")
    assert.deepEqual(
      buttons.map((b) => b.props["aria-label"]),
      ["ลบแท็ก ผจญภัย", "ลบแท็ก แฟนตาซี", "ลบแท็ก ดราม่า"],
    )
    for (const b of buttons) assert.equal(b.props.type, "button", "ต้องไม่ส่งฟอร์ม")
    handlerOf(buttons[1]!, "onClick")()
    handlerOf(buttons[0]!, "onClick")()
    assert.deepEqual(removed, [1, 0])
  })

  test("ช่องกรอก: ค่า ป้ายกำกับผ่าน id คำอธิบายผ่าน aria-describedby ไม่มี aria-invalid เมื่อไม่มีปัญหา", () => {
    const input = findTag(TagInputView(props({ text: "ผจญ" })), "input")
    assert.equal(input.props.id, "tags")
    assert.equal(input.props.type, "text")
    assert.equal(input.props.value, "ผจญ")
    assert.equal(input.props["aria-describedby"], "tags-hint")
    assert.equal(input.props["aria-invalid"], undefined)
    assert.equal(input.props.autoComplete, "off")
  })

  test("พิมพ์ในช่อง → ส่งข้อความขึ้นไป", () => {
    const got: string[] = []
    const input = findTag(TagInputView(props({ onText: (v) => got.push(v) })), "input")
    handlerOf(input, "onChange")({ target: { value: "abc" } })
    assert.deepEqual(got, ["abc"])
  })

  test("Enter → เพิ่มแท็กและกันไม่ให้ฟอร์มถูกส่ง · แป้นอื่นและ Enter ระหว่างพิมพ์ด้วยแป้นภาษา → ไม่เพิ่ม ไม่กัน", () => {
    let commits = 0
    const input = findTag(TagInputView(props({ onCommit: () => commits++ })), "input")
    const press = (key: string, nativeEvent: { isComposing: boolean }, keyCode: number) => {
      let prevented = false
      handlerOf(input, "onKeyDown")({ key, keyCode, nativeEvent, preventDefault: () => (prevented = true) })
      return prevented
    }
    assert.equal(press("Enter", { isComposing: false }, 13), true)
    assert.equal(commits, 1)
    assert.equal(press("Enter", { isComposing: true }, 13), false)
    assert.equal(press("Enter", { isComposing: false }, 229), false)
    assert.equal(press("a", { isComposing: false }, 65), false)
    assert.equal(commits, 1)
  })

  test("ออกจากช่อง (blur) → เพิ่มแท็กที่ค้างอยู่ (กดบันทึกโดยไม่กด Enter แล้วแท็กไม่หาย)", () => {
    let commits = 0
    handlerOf(findTag(TagInputView(props({ onCommit: () => commits++ })), "input"), "onBlur")()
    assert.equal(commits, 1)
  })

  test("คำแนะนำบอกจำนวนแท็กและวิธีเพิ่ม · ไม่มีกล่องข้อผิดพลาดเมื่อไม่มีปัญหา", () => {
    const view = TagInputView(props({ tags: ["a", "b"] }))
    const hint = findTag(view, "p", (el) => el.props.id === "tags-hint")
    assert.equal(hint.props.children, "2/12 อัน · พิมพ์แล้วกด Enter (วางหลายอันคั่นด้วยจุลภาคได้)")
    assert.deepEqual(findAll(view, (el) => el.props.role === "alert"), [])
  })

  test("มีปัญหา → แสดงข้อความเป็น role=alert, ช่องเป็น aria-invalid และอ้างถึงทั้งคำแนะนำและข้อผิดพลาด", () => {
    const view = TagInputView(props({ problem: "ใส่แท็กได้ไม่เกิน 12 อัน" }))
    const [alert] = findAll(view, (el) => el.props.role === "alert")
    assert.equal(alert!.props.id, "tags-error")
    assert.equal(alert!.props.children, "ใส่แท็กได้ไม่เกิน 12 อัน")
    const input = findTag(view, "input")
    assert.equal(input.props["aria-invalid"], true)
    assert.equal(input.props["aria-describedby"], "tags-hint tags-error")
  })

  test("ช่องกรอกจำกัดความยาวพอสำหรับวางหลายแท็กพร้อมกัน (ไม่ตัดที่ 40 ตัวของแท็กเดียว)", () => {
    const input = findTag(TagInputView(props()), "input")
    assert.ok(Number(input.props.maxLength) >= 200)
  })
})

describe("TagInputView: ป้ายของรายการแท็ก", () => {
  test("รายการแท็กมีชื่อ 'แท็กที่ใส่แล้ว' ให้โปรแกรมอ่านหน้าจอ", () => {
    const view = TagInputView(props({ tags: ["ก"] }))
    assert.equal(findTag(view, "ul")?.props["aria-label"], "แท็กที่ใส่แล้ว")
  })
})
