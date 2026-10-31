import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Chip } from "../components/Chip"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { GlossaryView, type GlossaryViewProps } from "./Glossary"
import { EMPTY_TERM } from "./glossary-logic"
import { TextField } from "./NovelForm"
import type { GlossaryDto } from "./types"

const rows: GlossaryDto[] = [
  { id: 1, source: "Moon Gate", thai: "ประตูจันทรา", note: "ชื่อสถานที่", auto: false },
  { id: 2, source: "Qi", thai: "ชี่", note: "", auto: true },
  { id: 3, source: "Elder Wu", thai: "ผู้อาวุโสอู๋", note: "", auto: true },
]

const props = (over: Partial<GlossaryViewProps> = {}): GlossaryViewProps => ({
  rows,
  autoOnly: false,
  add: EMPTY_TERM,
  addErrors: {},
  addError: null,
  adding: false,
  editingId: null,
  edit: EMPTY_TERM,
  editErrors: {},
  editError: null,
  saving: false,
  notice: null,
  onAddChange: () => {},
  onAdd: () => {},
  onFilter: () => {},
  onEdit: () => {},
  onEditChange: () => {},
  onEditSave: () => {},
  onEditCancel: () => {},
  onDelete: () => {},
  ...over,
})

const render = (over: Partial<GlossaryViewProps> = {}) => renderPage(<GlossaryView {...props(over)} />)
const bodyRows = (page: ReturnType<typeof render>) => all(page, "tr").filter((r) => all(r, "td").length > 0)

describe("GlossaryView — ตาราง", () => {
  test("หัวคอลัมน์: คำต้นฉบับ · คำไทย · หมายเหตุ · จัดการ", () => {
    const heads = all(render(), "th").map((h) => text(h))
    assert.deepEqual(heads, ["คำต้นฉบับ", "คำไทย", "หมายเหตุ", "จัดการ"])
  })
  test("แถวแสดงคำ/คำไทย/หมายเหตุ ตามลำดับที่ส่งมา", () => {
    const first = all(bodyRows(render())[0]!, "td").map((c) => text(c))
    assert.match(first[0]!, /Moon Gate/)
    assert.equal(first[1], "ประตูจันทรา")
    assert.equal(first[2], "ชื่อสถานที่")
    assert.equal(bodyRows(render()).length, 3)
  })
  test("ป้าย AI เฉพาะคำที่ AI เพิ่ม (auto)", () => {
    const page = render()
    const rowsOut = bodyRows(page)
    assert.equal(all(rowsOut[0]!, "span[data-tone=live]").length, 0)
    assert.equal(text(one(rowsOut[1]!, "span[data-tone=live]")), "AI")
    assert.equal(text(one(rowsOut[2]!, "span[data-tone=live]")), "AI")
  })
  test("หมายเหตุว่าง → ขีด '—'", () => {
    assert.equal(text(all(bodyRows(render())[1]!, "td")[2]!), "—")
  })
  test("สรุปจำนวน", () => {
    assert.equal(text(one(render(), "p[class=ad-csummary]")), "ทั้งหมด 3 คำ · AI เพิ่ม 2 คำ")
  })
})

describe("GlossaryView — ตัวกรอง 'เฉพาะที่ AI เพิ่ม'", () => {
  test("ปุ่มกรองเป็น Chip สลับได้ ส่งค่าใหม่ให้ onFilter", () => {
    const got: boolean[] = []
    const view = GlossaryView(props({ onFilter: (v) => got.push(v) }))
    const [chip] = findAll(view, (e) => e.type === Chip)
    assert.equal(chip!.props.selected, false)
    ;(chip!.props.onClick as () => void)()
    const on = GlossaryView(props({ autoOnly: true, onFilter: (v) => got.push(v) }))
    const [chipOn] = findAll(on, (e) => e.type === Chip)
    assert.equal(chipOn!.props.selected, true)
    ;(chipOn!.props.onClick as () => void)()
    assert.deepEqual(got, [true, false])
  })
  test("กรองแล้วโชว์เฉพาะ auto", () => {
    assert.equal(bodyRows(render({ autoOnly: true })).length, 2)
  })
  test("กรองแล้วไม่เหลือ → ข้อความว่างของการกรอง (ไม่ใช่ว่างทั้งอภิธาน)", () => {
    const page = render({ autoOnly: true, rows: [rows[0]!] })
    assert.match(text(one(page, "h2[class=state-title]")), /ยังไม่มีคำที่ AI เพิ่ม/)
  })
})

describe("GlossaryView — ว่าง · เพิ่มคำ", () => {
  test("ไม่มีคำเลย → ข้อความว่างแต่ฟอร์มเพิ่มคำยังอยู่", () => {
    const page = render({ rows: [] })
    assert.match(text(one(page, "h2[class=state-title]")), /ยังไม่มีคำศัพท์/)
    assert.equal(all(page, "table").length, 0)
    assert.equal(all(page, "input[id=gl-source]").length, 1)
  })
  test("ฟอร์มเพิ่ม: ช่อง คำต้นฉบับ/คำไทย/หมายเหตุ แสดงค่าร่าง", () => {
    const page = render({ add: { source: "Qi", thai: "ชี่", note: "พลัง" } })
    assert.equal(one(page, "input[id=gl-source]").attrs.value, "Qi")
    assert.equal(one(page, "input[id=gl-thai]").attrs.value, "ชี่")
    assert.equal(one(page, "input[id=gl-note]").attrs.value, "พลัง")
  })
  test("พิมพ์ในแต่ละช่องส่ง patch ช่องเดียว · ส่งฟอร์มเรียก onAdd และกันเปลี่ยนหน้า", () => {
    const got: unknown[] = []
    let prevented = false
    const view = GlossaryView(props({ onAddChange: (p) => got.push(p), onAdd: () => got.push("add") }))
    for (const key of ["source", "thai", "note"]) {
      const [field] = findAll(view, (e) => e.type === TextField && e.props.id === `gl-${key}`)
      ;(field!.props.onChange as (v: string) => void)(`v-${key}`)
    }
    handlerOf(findTag(view, "form", (f) => f.props["data-kind"] === "add"), "onSubmit")({ preventDefault: () => (prevented = true) })
    assert.deepEqual(got, [{ source: "v-source" }, { thai: "v-thai" }, { note: "v-note" }, "add"])
    assert.equal(prevented, true)
  })
  test("ข้อผิดพลาดของช่องโชว์ใต้ช่อง · ข้อความจากเซิร์ฟเวอร์ (ซ้ำ 409) เป็น role=alert", () => {
    const page = render({ addErrors: { source: "กรอกคำต้นฉบับ" }, addError: "คำต้นฉบับ \"Qi\" มีอยู่ในอภิธานของเรื่องนี้แล้ว" })
    assert.equal(one(page, "input[id=gl-source]").attrs["aria-invalid"], "true")
    assert.equal(text(one(page, "p[id=gl-source-error]")), "กรอกคำต้นฉบับ")
    assert.match(text(one(page, "p[role=alert]")), /มีอยู่ในอภิธานของเรื่องนี้แล้ว/)
  })
  test("กำลังเพิ่ม: ปุ่มเขียน 'กำลังเพิ่ม…' และปิด", () => {
    const btn = one(render({ adding: true }), "button[type=submit]")
    assert.equal(text(btn), "กำลังเพิ่ม…")
    assert.equal(btn.attrs.disabled !== undefined, true)
    assert.equal(text(one(render(), "button[type=submit]")), "เพิ่มคำ")
  })
})

describe("GlossaryView — แก้ในแถว · ลบ", () => {
  test("แถวที่ไม่ได้แก้มีปุ่มแก้ไข/ลบที่มีป้ายชื่อคำ · กดแล้วส่งแถวนั้น", () => {
    const got: string[] = []
    const view = GlossaryView(props({ onEdit: (r) => got.push(`edit:${r.id}`), onDelete: (r) => got.push(`del:${r.id}`) }))
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "แก้ไขคำ Qi"), "onClick")()
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "ลบคำ Moon Gate"), "onClick")()
    assert.deepEqual(got, ["edit:2", "del:1"])
  })
  test("แถวที่กำลังแก้: เป็นช่องกรอกสามช่อง + บันทึก/ยกเลิก · แถวอื่นยังเป็นข้อความ", () => {
    const page = render({ editingId: 2, edit: { source: "Qi", thai: "ชี่ใหม่", note: "" } })
    const row = bodyRows(page)[1]!
    assert.equal(all(row, "input").length, 3)
    assert.equal(one(row, "input[aria-label=คำไทย]").attrs.value, "ชี่ใหม่")
    assert.equal(all(bodyRows(page)[0]!, "input").length, 0)
    assert.equal(all(row, "button[aria-label=บันทึกคำที่แก้]").length, 1)
    assert.equal(all(row, "button[aria-label=ยกเลิกการแก้คำ]").length, 1)
  })
  test("ช่องในแถวส่ง patch ช่องเดียว · บันทึก/ยกเลิกเรียก handler", () => {
    const got: unknown[] = []
    const view = GlossaryView(props({ editingId: 2, edit: { source: "Qi", thai: "ชี่", note: "" }, onEditChange: (p) => got.push(p), onEditSave: () => got.push("save"), onEditCancel: () => got.push("cancel") }))
    const inputs = findAll(view, (e) => e.type === "input" && typeof e.props["aria-label"] === "string")
    for (const input of inputs) (input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: `v-${String(input.props["aria-label"])}` } })
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "บันทึกคำที่แก้"), "onClick")()
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "ยกเลิกการแก้คำ"), "onClick")()
    assert.deepEqual(got, [{ source: "v-คำต้นฉบับ" }, { thai: "v-คำไทย" }, { note: "v-หมายเหตุ" }, "save", "cancel"])
  })
  test("ข้อผิดพลาดของแถวที่แก้ (ซ้ำ 409/ช่องว่าง) โชว์ในแถวใต้ช่อง", () => {
    const page = render({ editingId: 2, edit: EMPTY_TERM, editErrors: { thai: "กรอกคำไทย" }, editError: "คำต้นฉบับ \"Qi\" มีอยู่ในอภิธานของเรื่องนี้แล้ว" })
    assert.equal(one(page, "input[aria-label=คำไทย]").attrs["aria-invalid"], "true")
    assert.match(text(one(page, "p[role=alert]")), /มีอยู่ในอภิธานของเรื่องนี้แล้ว/)
    assert.match(text(one(page, "p[data-kind=edit-error]")), /กรอกคำไทย/)
  })
  test("กำลังบันทึกแถว: ปุ่มของทุกแถวและช่องกรอกในแถวที่แก้ปิด", () => {
    const page = render({ saving: true, editingId: 2, edit: EMPTY_TERM })
    const buttons = all(page, "button").filter((x) => /^(แก้ไขคำ|ลบคำ|บันทึกคำที่แก้|ยกเลิกการแก้คำ)/.test(x.attrs["aria-label"] ?? ""))
    assert.equal(buttons.length, 6)
    for (const b of buttons) assert.equal(b.attrs.disabled !== undefined, true, b.attrs["aria-label"])
    for (const i of all(bodyRows(page)[1]!, "input")) assert.equal(i.attrs.disabled !== undefined, true)
  })
  test("ไม่ได้บันทึก: ปุ่มและช่องใช้ได้", () => {
    const page = render({ editingId: 2, edit: EMPTY_TERM })
    for (const b of all(page, "button").filter((x) => /^(แก้ไขคำ|ลบคำ|บันทึกคำที่แก้|ยกเลิกการแก้คำ)/.test(x.attrs["aria-label"] ?? ""))) assert.equal(b.attrs.disabled, undefined, b.attrs["aria-label"])
  })
})

describe("GlossaryView — แจ้งผล", () => {
  test("notice = role=status · ไม่มีก็ไม่แสดง", () => {
    const page = render({ notice: "ลบคำแล้ว" })
    assert.equal(text(one(page, "p[class=ad-notice]")), "ลบคำแล้ว")
    assert.equal(one(page, "p[class=ad-notice]").attrs.role, "status")
    assert.equal(all(render(), "p[class=ad-notice]").length, 0)
  })
})

describe("GlossaryView — ขอบเขตหลัง mutation sweep", () => {
  test("ไม่มีคำเลย → ไม่มีแถบสรุป/ตัวกรอง", () => {
    const page = render({ rows: [] })
    assert.equal(all(page, "p[class=ad-csummary]").length, 0)
    assert.equal(all(page, "button[aria-pressed]").length, 0)
  })
  test("ป้ายตัวกรองบอกจำนวนคำที่ AI เพิ่ม (ไม่ใช่จำนวนทั้งหมด)", () => {
    assert.equal(text(one(render(), "button[aria-pressed]")), "เฉพาะที่ AI เพิ่ม (2)")
  })
  test("ในช่องของแถวที่แก้: Enter = บันทึก (กันส่งฟอร์มเอง) · Esc = ยกเลิก · แป้นอื่นไม่ทำอะไร", () => {
    const got: string[] = []
    const view = GlossaryView(props({ editingId: 2, edit: EMPTY_TERM, onEditSave: () => got.push("save"), onEditCancel: () => got.push("cancel") }))
    const [input] = findAll(view, (e) => e.type === "input" && e.props["aria-label"] === "คำไทย")
    const press = (key: string) => (input!.props.onKeyDown as (e: { key: string; preventDefault(): void }) => void)({ key, preventDefault: () => got.push("prevented") })
    press("Enter")
    press("Escape")
    press("a")
    assert.deepEqual(got, ["prevented", "save", "cancel"])
  })
})

