import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Switch } from "../components/Switch"
import { parseChapters, type ParsedRow } from "../lib/parse-chapters"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { AddChaptersView, type AddChaptersViewProps } from "./AddChapters"
import type { AdminNovelDto } from "./types"

const novel = (id: number, titleTh: string, title = "Title"): AdminNovelDto =>
  ({
    id,
    title,
    titleTh,
    author: "",
    synopsis: "",
    synopsisSrc: "",
    tags: [],
    status: "ongoing",
    sourceUrl: "",
    licenseNote: "",
    styleNote: "",
    mode: "translate",
    published: false,
    featured: false,
    hasCover: false,
    coverV: 0,
    chapterCount: 0,
    translatedCount: 0,
    publishedCount: 0,
    createdAt: "",
    updatedAt: "",
  }) satisfies AdminNovelDto

const TEXT = "Chapter 1: Start\nHello there.\n\nChapter 2: Next\nMore words here."
const goodRows = (): ParsedRow[] => parseChapters(TEXT, new Set())

const props = (over: Partial<AddChaptersViewProps> = {}): AddChaptersViewProps => ({
  novels: [novel(4, "นิยายสี่", "Four"), novel(9, "", "Nine")],
  novelId: 4,
  text: TEXT,
  mode: "auto",
  rows: goodRows(),
  options: { translate: true, publish: false },
  apiKeySet: true,
  cost: null,
  checking: false,
  existingError: null,
  busy: false,
  error: null,
  onNovel: () => {},
  onText: () => {},
  onMode: () => {},
  onRow: () => {},
  onOptions: () => {},
  onSubmit: () => {},
  ...over,
})

const render = (over: Partial<AddChaptersViewProps> = {}) => renderPage(<AddChaptersView {...props(over)} />)
const submitBtn = (page: ReturnType<typeof render>) => one(page, "button[type=submit]")

describe("AddChaptersView: ไม่มีนิยายเลย", () => {
  test("แสดงหน้าว่างพร้อมลิงก์สร้างเรื่อง และไม่มีช่องวางข้อความ", () => {
    const page = render({ novels: [], novelId: null, rows: [], text: "" })
    assert.match(text(page), /ยังไม่มีนิยาย/)
    assert.ok(all(page, "a").some((a) => a.attrs.href === "/admin/novels/new"))
    assert.equal(all(page, "textarea").length, 0)
    assert.equal(all(page, "button[type=submit]").length, 0)
  })
})

describe("AddChaptersView: เลือกเรื่องและช่องวางข้อความ", () => {
  test("ฟอร์มไม่ใช้การตรวจของเบราว์เซอร์ (ข้อความเตือนเป็นของหน้าเอง)", () => assert.ok("novalidate" in one(render(), "form").attrs))

  test("หัวข้อหน้า 'เพิ่มตอน'", () => assert.match(text(one(render(), "h1")), /เพิ่มตอน/))

  test("ช่องเลือกเรื่อง: ตัวเลือกว่าง + ทุกเรื่อง (ชื่อไทยก่อน ไม่มีก็ใช้ชื่อต้นฉบับ) · ค่าที่เลือกตาม novelId", () => {
    const page = render()
    const select = one(page, "select")
    assert.equal(select.attrs.id, "add-novel")
    assert.equal(one(page, "label[for=add-novel]").tag, "label")
    assert.deepEqual(all(select, "option").map((o) => [o.attrs.value, text(o)]), [
      ["", "— เลือกเรื่อง —"],
      ["4", "นิยายสี่"],
      ["9", "Nine"],
    ])
    assert.ok("selected" in all(select, "option").find((o) => o.attrs.value === "4")!.attrs)
    assert.ok("selected" in all(render({ novelId: null }), "option")[0]!.attrs)
  })

  test("เปลี่ยนเรื่อง → onNovel(รหัส) · เลือกตัวเลือกว่าง → null", () => {
    const got: Array<number | null> = []
    const view = AddChaptersView(props({ onNovel: (id) => got.push(id) }))
    const change = handlerOf(findTag(view, "select"), "onChange")
    change({ target: { value: "9" } })
    change({ target: { value: "" } })
    assert.deepEqual(got, [9, null])
  })

  test("ช่องวางข้อความมีป้ายผูกกับช่อง ค่าตาม text และส่งค่าใหม่ให้ onText", () => {
    const got: string[] = []
    const page = render()
    assert.equal(one(page, "label[for=add-text]").tag, "label")
    assert.equal(text(one(page, "textarea")), TEXT)
    const view = AddChaptersView(props({ onText: (v) => got.push(v) }))
    handlerOf(findTag(view, "textarea"), "onChange")({ target: { value: "abc" } })
    assert.deepEqual(got, ["abc"])
  })
})

describe("AddChaptersView: ผลการแยกตอน", () => {
  test("ยังไม่วางอะไร → ข้อความชวนวาง ไม่มีตาราง", () => {
    const page = render({ rows: [], text: "" })
    assert.equal(all(page, "table").length, 0)
    assert.match(text(one(page, "p[class=ad-empty]")), /วางข้อความ/)
    assert.match(text(one(page, "h2[class=ad-found]")), /พบ 0 ตอน/)
    assert.equal(all(page, "span[class=ad-panel-sub]").length, 0, "ยังไม่มีตอน → ไม่มีบรรทัด 'ติ๊กไว้'")
  })

  test("พบ N ตอน และติ๊กกี่ตอน · หนึ่งแถวต่อหนึ่งตอน", () => {
    const page = render()
    assert.match(text(one(page, "h2[class=ad-found]")), /พบ 2 ตอน/)
    assert.match(text(one(page, "span[class=ad-panel-sub]")), /ติ๊กไว้ 2/)
    assert.equal(all(one(page, "tbody"), "tr").length, 2)
    assert.deepEqual(all(page, "th").map((th) => text(th)), ["เลือก", "เลขตอน", "ชื่อตอน", "จำนวนคำ", "สถานะ"])
  })

  test("แถว: ช่องติ๊ก (ป้ายบอกเลขตอน) · เลข · ชื่อ · จำนวนคำ · สถานะพร้อม", () => {
    const rows = goodRows()
    const tr = all(one(render(), "tbody"), "tr")[0]!
    const box = one(tr, "input[type=checkbox]")
    assert.ok("checked" in box.attrs)
    assert.equal(box.attrs["aria-label"], "เลือกแถวที่ 1")
    assert.equal(one(tr, "input[class=ad-anum]").attrs.value, "1")
    assert.equal(one(tr, "input[class=ad-anum]").attrs["aria-label"], "เลขตอน (แถวที่ 1)")
    assert.equal(one(tr, "input[class=ad-atitle]").attrs.value, "Start")
    assert.equal(one(tr, "input[class=ad-atitle]").attrs["aria-label"], "ชื่อตอน (แถวที่ 1)")
    assert.match(text(tr), new RegExp(String(rows[0]!.words)))
    assert.match(text(one(tr, "span[class=ad-pill]")), /พร้อม/)
    assert.equal(one(tr, "input[class=ad-atitle]").attrs.maxlength, "300", "ชื่อตอนยาวเท่าที่เซิร์ฟเวอร์รับ")
  })

  test("พบ N = ทุกแถว · ติ๊กไว้ = เฉพาะที่ติ๊ก", () => {
    const rows = goodRows()
    rows[1] = { ...rows[1]!, checked: false }
    const page = render({ rows })
    assert.match(text(one(page, "h2[class=ad-found]")), /^พบ 2 ตอน$/)
    assert.match(text(one(page, "span[class=ad-panel-sub]")), /^ติ๊กไว้ 1 ตอน$/)
    assert.equal(text(submitBtn(page)), "แปล 1 ตอน")
  })

  test("ช่องเลขตอนมี aria-invalid เมื่อเลขซ้ำหรือใช้ไม่ได้ · ปัญหาอื่น (ว่าง/ยาว) ไม่ทำให้ช่องเลขเตือน", () => {
    const base = goodRows()[0]!
    const flagOf = (issues: ParsedRow["issues"]) => one(one(render({ rows: [{ ...base, issues, checked: false }] }), "tbody"), "input[class=ad-anum]").attrs["aria-invalid"]
    assert.equal(flagOf(["duplicate"]), "true")
    assert.equal(flagOf(["bad_number"]), "true")
    assert.equal(flagOf(["empty"]), undefined)
    assert.equal(flagOf(["too_long"]), undefined)
    assert.equal(flagOf([]), undefined)
  })

  test("แถวมีปัญหา: ป้ายเตือนข้อความไทย (data-tone=fail) และไม่ติ๊ก · เลขว่างแสดงช่องว่าง", () => {
    const rows = parseChapters(TEXT, new Set([2]))
    const page = render({ rows })
    const trs = all(one(page, "tbody"), "tr")
    assert.equal("checked" in one(trs[1]!, "input[type=checkbox]").attrs, false)
    const pill = one(trs[1]!, "span[class=ad-pill]")
    assert.equal(pill.attrs["data-tone"], "fail")
    assert.match(text(pill), /ซ้ำ/)
    const blank = render({ rows: [{ ...rows[0]!, number: null, issues: ["bad_number"], checked: false }] })
    assert.equal(one(one(blank, "tbody"), "input[class=ad-anum]").attrs.value, "")
  })

  test("ข้อความก่อนหัวข้อแรกมีป้ายบอกชนิด (ไม่ใช่ตอนที่มีหัวข้อ)", () => {
    const rows = parseChapters(`${"intro ".repeat(120)}\n\nChapter 1: A\nx`, new Set())
    assert.match(text(one(render({ rows }), "tbody")), /ก่อนหัวข้อแรก/)
    assert.doesNotMatch(text(one(render(), "tbody")), /ก่อนหัวข้อแรก/)
  })

  test("แก้แถว: ติ๊ก/เลข/ชื่อ ส่ง onRow(key, patch) · เลขที่พิมพ์ผิด (ไม่ใช่เลขล้วน) ไม่ส่งอะไร", () => {
    const got: unknown[] = []
    const rows = goodRows()
    const view = AddChaptersView(props({ onRow: (key, patch) => got.push([key, patch]) }))
    const box = findTag(view, "input", (e) => e.props.type === "checkbox")
    handlerOf(box, "onChange")({ target: { checked: false } })
    const num = findTag(view, "input", (e) => e.props.className === "ad-anum")
    handlerOf(num, "onChange")({ target: { value: "12" } })
    handlerOf(num, "onChange")({ target: { value: "" } })
    handlerOf(num, "onChange")({ target: { value: "1x" } })
    const title = findTag(view, "input", (e) => e.props.className === "ad-atitle")
    handlerOf(title, "onChange")({ target: { value: "ชื่อใหม่" } })
    assert.deepEqual(got, [
      [rows[0]!.key, { checked: false }],
      [rows[0]!.key, { number: 12 }],
      [rows[0]!.key, { number: null }],
      [rows[0]!.key, { title: "ชื่อใหม่" }],
    ])
  })

  test("ปุ่มโหมดแยกตอน: แยกอัตโนมัติ / ไม่ต้องแยกตอน — aria-pressed ตามโหมด และกดแล้วส่งโหมดให้ผู้เรียก", () => {
    const page = render({ mode: "single" })
    const [auto, single] = all(page, "button[data-split]")
    assert.equal(auto!.attrs["data-split"], "auto")
    assert.equal(text(auto!), "แยกตอนอัตโนมัติ")
    assert.equal(auto!.attrs["aria-pressed"], "false")
    assert.equal(single!.attrs["data-split"], "single")
    assert.equal(text(single!), "ไม่ต้องแยกตอน")
    assert.equal(single!.attrs["aria-pressed"], "true")
    const got: string[] = []
    const view = AddChaptersView(props({ onMode: (m) => got.push(m) }))
    for (const b of findAll(view, (e) => e.type === "button" && e.props["data-split"] !== undefined)) handlerOf(b, "onClick")()
    assert.deepEqual(got, ["auto", "single"])
  })
})

describe("AddChaptersView: ตัวเลือกแปล/เผยแพร่", () => {
  const switches = (over: Partial<AddChaptersViewProps> = {}) => findAll(AddChaptersView(props(over)), (e) => e.type === Switch)

  test("สองสวิตช์: แปลทันที / เผยแพร่เองเมื่อแปลเสร็จ ตามค่าที่ใช้จริง", () => {
    const [t, p] = switches({ options: { translate: true, publish: true } })
    assert.equal(t!.props.label, "แปลทันที")
    assert.equal(t!.props.checked, true)
    assert.equal(p!.props.label, "เผยแพร่เองเมื่อแปลเสร็จ")
    assert.equal(p!.props.checked, true)
    assert.equal(t!.props.disabled, false)
    assert.equal(p!.props.disabled, false)
  })

  test("กดสวิตช์ → onOptions(ช่องนั้น)", () => {
    const got: unknown[] = []
    const [t, p] = switches({ onOptions: (o) => got.push(o) })
    ;(t!.props.onChange as (v: boolean) => void)(false)
    ;(p!.props.onChange as (v: boolean) => void)(true)
    assert.deepEqual(got, [{ translate: false }, { publish: true }])
  })

  test("ไม่แปลทันที → สวิตช์เผยแพร่เองปิดใช้ + คำอธิบาย", () => {
    const [, p] = switches({ options: { translate: false, publish: false } })
    assert.equal(p!.props.disabled, true)
    assert.match(text(render({ options: { translate: false, publish: false } })), /เผยแพร่เองได้เมื่อเลือกแปลทันที/)
    assert.doesNotMatch(text(render()), /เผยแพร่เองได้เมื่อเลือกแปลทันที/)
  })

  test("ไม่มีคีย์ API → แปลทันทีปิดใช้ พร้อมคำอธิบายและลิงก์ไปตั้งค่า · มีคีย์ → ไม่มีคำอธิบายนี้", () => {
    const over = { apiKeySet: false, options: { translate: false, publish: false } }
    const [t] = switches(over)
    assert.equal(t!.props.disabled, true)
    const page = render(over)
    assert.match(text(page), /ยังไม่ได้ตั้งคีย์ API/)
    assert.ok(all(page, "a").some((a) => a.attrs.href === "/admin/settings"))
    assert.doesNotMatch(text(render()), /ยังไม่ได้ตั้งคีย์ API/)
    // คำอธิบายเรื่อง "เผยแพร่เอง" ไม่ซ้อนกับคำอธิบายเรื่องคีย์
    assert.doesNotMatch(text(page), /เผยแพร่เองได้เมื่อเลือกแปลทันที/)
  })
})

describe("AddChaptersView: ปุ่มส่ง ข้อความเตือน และค่าใช้จ่าย", () => {
  test("พร้อมส่ง: 'แปล 2 ตอน' กดได้ · ไม่แปลทันที → 'บันทึกเป็นร่าง'", () => {
    const b = submitBtn(render())
    assert.equal(text(b), "แปล 2 ตอน")
    assert.equal("disabled" in b.attrs, false)
    assert.equal(text(submitBtn(render({ options: { translate: false, publish: false } }))), "บันทึกเป็นร่าง")
  })

  test("ยังไม่เลือกเรื่อง → ปิดปุ่ม + บอกให้เลือกเรื่องก่อน", () => {
    const page = render({ novelId: null })
    assert.ok("disabled" in submitBtn(page).attrs)
    assert.match(text(page), /เลือกเรื่องก่อน/)
    assert.doesNotMatch(text(render()), /เลือกเรื่องก่อน/)
  })

  test("ไม่ได้ติ๊กตอนไหนเลย → ปิดปุ่ม (ไม่ใช่ error)", () => {
    const rows = goodRows().map((r) => ({ ...r, checked: false }))
    const page = render({ rows })
    assert.ok("disabled" in submitBtn(page).attrs)
    assert.equal(all(page, "p[data-kind=selection]").length, 0)
  })

  test("ชุดที่เลือกมีปัญหา (validateSelection) → ปิดปุ่ม และแสดงข้อความไทยของข้อนั้น", () => {
    const rows = goodRows().map((r) => ({ ...r, number: 1 }))
    const page = render({ rows })
    assert.ok("disabled" in submitBtn(page).attrs)
    assert.match(text(one(page, "p[data-kind=selection]")), /เลขตอน/)
  })

  test("ข้อความรวมเกิน 7.5MB → ปิดปุ่มและเตือนก่อนส่ง", () => {
    const big = "ก".repeat(100_000) // 3 ไบต์/ตัว
    const rows: ParsedRow[] = Array.from({ length: 26 }, (_, i) => ({ ...goodRows()[0]!, key: `k${i}`, number: i + 1, text: big, words: 1 }))
    const page = render({ rows })
    assert.ok("disabled" in submitBtn(page).attrs)
    assert.match(text(one(page, "p[data-kind=selection]")), /7\.5/)
  })

  test("กำลังส่ง → ปิดปุ่มและเปลี่ยนข้อความ", () => {
    const b = submitBtn(render({ busy: true }))
    assert.ok("disabled" in b.attrs)
    assert.match(text(b), /กำลังส่ง/)
  })

  test("ส่งฟอร์ม → กันการส่งแบบเบราว์เซอร์ แล้วเรียก onSubmit", () => {
    let prevented = 0
    let submits = 0
    const view = AddChaptersView(props({ onSubmit: () => submits++ }))
    handlerOf(findTag(view, "form"), "onSubmit")({ preventDefault: () => prevented++ })
    assert.deepEqual([prevented, submits], [1, 1])
  })

  test("ข้อผิดพลาดจากเซิร์ฟเวอร์ → role=alert ในหน้า · ไม่มี → ไม่มีกล่อง", () => {
    const page = render({ error: "ข้อมูลที่ส่งมาใหญ่เกินกำหนด" })
    assert.equal(text(one(page, "p[role=alert]")), "ข้อมูลที่ส่งมาใหญ่เกินกำหนด")
    assert.equal(all(render(), "p[role=alert]").length, 0)
  })

  test("บรรทัดค่าใช้จ่ายแสดงเมื่อมี · ไม่มี → ไม่มีบรรทัด", () => {
    assert.match(text(one(render({ cost: "ประมาณการ: 2 ตอน" }), "p[data-kind=cost]")), /ประมาณการ: 2 ตอน/)
    assert.equal(all(render(), "p[data-kind=cost]").length, 0)
  })
})

describe("AddChaptersView: ตรวจเลขตอนที่มีอยู่", () => {
  test("กำลังดึงเลขตอนที่มีอยู่ → ปิดปุ่มส่งพร้อมข้อความสถานะ", () => {
    const page = render({ checking: true })
    assert.ok("disabled" in submitBtn(page).attrs)
    assert.match(text(one(page, "p[role=status]")), /กำลังตรวจเลขตอน/)
    assert.equal(all(render(), "p[role=status]").length, 0)
  })
  test("ดึงไม่ได้ → เตือนใต้ช่องเลือกเรื่อง แต่ยังส่งได้", () => {
    const page = render({ existingError: "ดึงรายการตอนที่มีอยู่ไม่ได้" })
    assert.match(text(page), /ดึงรายการตอนที่มีอยู่ไม่ได้/)
    assert.equal("disabled" in submitBtn(page).attrs, false)
  })
})
