import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { INITIAL_LIBRARY, PAGE_SIZE, type LibraryAction, type LibraryState } from "../lib/library"
import type { NovelCardDto } from "../lib/types"
import { all, one, text, type El } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { DRAFT_LABEL } from "./DraftBadge"
import type { ReactNode } from "react"
import { Chip } from "./Chip"
import { EmptyState } from "./EmptyState"
import { LibraryView, type LibraryViewProps } from "./Library"

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const dto = (id: number, over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id,
  title: `Novel ${id}`,
  titleTh: `นิยาย ${id}`,
  author: "Author",
  synopsisShort: "",
  tags: [],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 10,
  latestNumber: 10,
  updatedAt: `2026-10-${String(id % 28 || 1).padStart(2, "0")} 00:00:00`,
  published: true,
  ...over,
})
const many = (count: number, over: (id: number) => Partial<NovelCardDto> = () => ({})) => Array.from({ length: count }, (_, i) => dto(i + 1, over(i + 1)))

const props = (over: Partial<LibraryViewProps> = {}): LibraryViewProps => ({
  novels: many(3),
  query: "",
  state: INITIAL_LIBRARY,
  dispatch: () => {},
  onClear: () => {},
  asPageHeading: false,
  now: NOW,
  ...over,
})
const render = (over: Partial<LibraryViewProps> = {}) => one(renderPage(<LibraryView {...props(over)} />), "section")
const cardHrefs = (root: El) => all(root, "a.card").map((card) => card.attrs.href)

describe("LibraryView: หัวข้อ", () => {
  test("ปกติ: หัวข้อ 'นิยายทั้งหมด' ระดับ h2; ส่วนชื่อโดยหัวข้อนี้", () => {
    const section = render()
    const heading = one(section, "h2.sec-h")
    assert.equal(text(heading), "นิยายทั้งหมด")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
    assert.equal(all(section, "h1").length, 0)
  })

  test("ค้นหาอยู่: หัวข้อ 'ผลการค้นหา “คำค้น”' เป็น h1 ของหน้า", () => {
    const section = render({ query: "lantern", asPageHeading: true })
    assert.equal(text(one(section, "h1.sec-h")), "ผลการค้นหา “lantern”")
    assert.equal(all(section, "h2.sec-h").length, 0)
  })

  test("คำค้นที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const section = render({ query: "<b>x</b>", asPageHeading: true })
    assert.equal(all(section, "b").length, 0)
    assert.equal(text(one(section, "h1")), "ผลการค้นหา “<b>x</b>”")
  })
})

describe("LibraryView: ตารางและจำนวน", () => {
  test("แสดงการ์ดนิยายตามที่เรียง (ค่าเริ่มต้น: อัปเดตล่าสุดก่อน) ในตาราง .grid", () => {
    const novels = [dto(1, { updatedAt: "2026-10-01 00:00:00" }), dto(2, { updatedAt: "2026-10-03 00:00:00" }), dto(3, { updatedAt: "2026-10-02 00:00:00" })]
    assert.deepEqual(cardHrefs(one(render({ novels }), ".grid")), ["/novel/2", "/novel/3", "/novel/1"])
  })

  test("เรียงตามชื่อเมื่อเลือก", () => {
    const novels = [dto(1, { titleTh: "ขอบฟ้า" }), dto(2, { titleTh: "กา" }), dto(3, { titleTh: "เกม" })]
    const state: LibraryState = { ...INITIAL_LIBRARY, sort: "title" }
    assert.deepEqual(cardHrefs(render({ novels, state })), ["/novel/2", "/novel/3", "/novel/1"])
  })

  test("เวลาอัปเดตบนการ์ดนับจาก now ที่ส่งเข้ามา (ไม่ใช่เวลาจริงของเครื่อง)", () => {
    const section = render({ novels: [dto(22)] }) // อัปเดต 2026-10-22 00:00 UTC; NOW = 12:00 ของวันเดียวกัน
    assert.ok(all(section, ".meta").some((meta) => text(meta).includes("12 ชั่วโมงที่แล้ว")))
  })

  test("การ์ดในตารางมีชิป 'ตอน N' แต่ไม่มีป้าย 'ใหม่' (ป้ายนั้นอยู่ในแถวอัปเดตล่าสุด)", () => {
    const section = render({ novels: [dto(1, { latestNumber: 87, updatedAt: "2026-10-22 09:00:00" })] })
    assert.equal(text(one(section, ".b-ep")), "ตอน 87")
    assert.equal(all(section, ".b-new").length, 0)
    assert.equal(all(render({ novels: [dto(1, { latestNumber: null })] }), ".b-ep").length, 0)
  })

  test("แสดงทีละ 24 เรื่อง; จำนวนที่เห็น 'แสดง 24 จาก 30 เรื่อง' และปุ่ม 'แสดงเพิ่ม' บอกจำนวนที่เหลือ", () => {
    const section = render({ novels: many(30) })
    assert.equal(all(section, "a.card").length, PAGE_SIZE)
    assert.equal(text(one(section, ".lib-count")), "แสดง 24 จาก 30 เรื่อง")
    assert.equal(one(section, ".lib-count").attrs.role, "status")
    const more = one(one(section, ".more"), "button")
    assert.equal(text(more).replace(/\s+/g, " ").trim(), "แสดงเพิ่ม (อีก 6 เรื่อง)")
  })

  test("หน้าถัดไป: แสดงเพิ่มอีกหนึ่งหน้า (เหลือไม่ถึง 24 ก็บอกจำนวนจริง)", () => {
    const section = render({ novels: many(60), state: { ...INITIAL_LIBRARY, pages: 2 } })
    assert.equal(all(section, "a.card").length, 48)
    assert.equal(text(one(one(section, ".more"), "button")).replace(/\s+/g, " ").trim(), "แสดงเพิ่ม (อีก 12 เรื่อง)")
  })

  test("แสดงครบแล้ว → ไม่มีปุ่ม 'แสดงเพิ่ม' และบอกแค่จำนวนเรื่อง", () => {
    const section = render({ novels: many(24) })
    assert.equal(all(section, ".more").length, 0)
    assert.equal(text(one(section, ".lib-count")), "24 เรื่อง")
    const last = render({ novels: many(30), state: { ...INITIAL_LIBRARY, pages: 2 } })
    assert.equal(all(last, ".more").length, 0)
    assert.equal(all(last, "a.card").length, 30)
    assert.equal(text(one(last, ".lib-count")), "30 เรื่อง")
  })

  test("gridRef ถูกส่งไปที่ตาราง .grid (ให้ Library ย้ายโฟกัสไปเรื่องแรกที่เพิ่งโผล่) · ไม่ส่งก็แสดงปกติ", () => {
    const ref = { current: null }
    const grid = findTag(LibraryView(props({ gridRef: ref })), "div", (el) => el.props.className === "grid")
    assert.equal(grid.props.ref, ref)
    assert.equal(all(render(), ".grid").length, 1)
  })

  test("ปุ่ม 'แสดงเพิ่ม' ส่งคำสั่ง more", () => {
    const actions: LibraryAction[] = []
    const tree = LibraryView(props({ novels: many(30), dispatch: (action) => actions.push(action) }))
    const button = findTag(tree, "button", (el) => String(el.props.className).includes("btn"))
    handlerOf(button, "onClick")()
    assert.deepEqual(actions, [{ type: "more" }])
  })

  test("เรื่องที่ยังไม่เผยแพร่ (ผู้ดูแลเห็น) มีป้ายร่างบนการ์ด", () => {
    const section = render({ novels: [dto(1, { published: false }), dto(2)] })
    const cards = all(section, "a.card")
    assert.equal(all(cards[1], ".b-draft").length, 1)
    assert.equal(text(one(one(cards[1], ".draft"), ".sr-only")), DRAFT_LABEL)
    assert.equal(all(cards[0], ".b-draft").length, 0)
  })
})

describe("LibraryView: ตัวกรอง", () => {
  const chipLabels = (section: El, group: string) => all(one(section, `[aria-label="${group}"]`), "button").map((chip) => [text(chip).trim(), chip.attrs["aria-pressed"]])

  test("ชิปสถานะ: ทั้งหมด / กำลังอัปเดต / จบแล้ว เป็นกลุ่มที่มีชื่อ; อันที่เลือก aria-pressed", () => {
    assert.deepEqual(chipLabels(render(), "สถานะ"), [
      ["ทั้งหมด", "true"],
      ["กำลังอัปเดต", "false"],
      ["จบแล้ว", "false"],
    ])
    assert.deepEqual(chipLabels(render({ state: { ...INITIAL_LIBRARY, status: "completed" } }), "สถานะ").map((chip) => chip[1]), ["false", "false", "true"])
    assert.equal(one(render(), '[aria-label="สถานะ"]').attrs.role, "group")
  })

  test("กรองตามสถานะที่เลือก", () => {
    const novels = [dto(1, { status: "ongoing" }), dto(2, { status: "completed" })]
    assert.deepEqual(cardHrefs(render({ novels, state: { ...INITIAL_LIBRARY, status: "completed" } })), ["/novel/2"])
  })

  test("ชิปแท็กเรียงตามจำนวนเรื่อง; ไม่มีแท็กเลย → ไม่มีกลุ่มแท็ก", () => {
    const novels = [dto(1, { tags: ["ก", "ข"] }), dto(2, { tags: ["ข"] }), dto(3, { tags: ["ข", "ค"] })]
    assert.deepEqual(chipLabels(render({ novels }), "แท็ก"), [
      ["ข", "false"],
      ["ก", "false"],
      ["ค", "false"],
    ])
    assert.equal(all(render({ novels: many(2) }), '[aria-label="แท็ก"]').length, 0)
  })

  test("ระหว่างค้นหา ชิปแท็กมาจากเรื่องที่ตรงคำค้นเท่านั้น (ไม่มีแท็กที่กดแล้วไม่เหลือผล) และนับตามผลค้นหา", () => {
    const novels = [
      dto(1, { title: "Moon Courier", tags: ["ผจญภัย", "แฟนตาซี"] }),
      dto(2, { title: "Moon Garden", tags: ["แฟนตาซี"] }),
      dto(3, { title: "Quiet Rooms", tags: ["ลึกลับ", "ผจญภัย"] }),
    ]
    assert.deepEqual(chipLabels(render({ novels, query: "moon" }), "แท็ก"), [
      ["แฟนตาซี", "false"],
      ["ผจญภัย", "false"],
    ])
    assert.deepEqual(
      chipLabels(render({ novels }), "แท็ก").map(([label]) => label),
      ["ผจญภัย", "แฟนตาซี", "ลึกลับ"],
    )
    // ค้นแล้วไม่พบอะไร → ไม่มีกลุ่มแท็ก
    assert.equal(all(render({ novels, query: "zzz" }), '[aria-label="แท็ก"]').length, 0)
    // สถานะที่เลือกไม่ตัดแท็กออกจากชิป (ชิปไม่กระโดดตามทุกครั้งที่สลับสถานะ)
    assert.equal(chipLabels(render({ novels, query: "moon", state: { ...INITIAL_LIBRARY, status: "completed" } }), "แท็ก").length, 2)
  })

  test("แท็กที่เลือกอยู่นอก 10 อันดับแรกก็ยังเห็นเป็นชิป (ต่อท้าย กดอยู่) ให้ยกเลิกได้", () => {
    const novels = Array.from({ length: 12 }, (_, i) => dto(i + 1, { tags: [`t${i + 1}`] }))
    const labels = (state: LibraryState) => chipLabels(render({ novels, state }), "แท็ก")
    assert.equal(labels(INITIAL_LIBRARY).length, 10)
    assert.equal(
      labels(INITIAL_LIBRARY).some(([label]) => label === "t9"),
      false,
    )
    const selected = labels({ ...INITIAL_LIBRARY, tag: "t9" })
    assert.equal(selected.length, 11)
    assert.deepEqual(selected[10], ["t9", "true"])
  })

  test("แท็กที่เลือกกดอยู่ (aria-pressed) และกรองรายการ", () => {
    const novels = [dto(1, { tags: ["ก"] }), dto(2, { tags: ["ข"] })]
    const section = render({ novels, state: { ...INITIAL_LIBRARY, tag: "ข" } })
    assert.deepEqual(chipLabels(section, "แท็ก"), [
      ["ก", "false"],
      ["ข", "true"],
    ])
    assert.deepEqual(cardHrefs(section), ["/novel/2"])
  })

  test("แตะชิปสถานะ/แท็กส่งคำสั่งที่ตรงกัน", () => {
    const actions: LibraryAction[] = []
    const tree = LibraryView(props({ novels: [dto(1, { tags: ["ก"] })], dispatch: (action) => actions.push(action) }))
    const chips = findAll(tree, (el) => el.type === Chip)
    const click = (label: string) => handlerOf(chips.find((chip) => chip.props.children === label)!, "onClick")()
    click("จบแล้ว")
    click("กำลังอัปเดต")
    click("ทั้งหมด")
    click("ก")
    assert.deepEqual(actions, [
      { type: "status", status: "completed" },
      { type: "status", status: "ongoing" },
      { type: "status", status: "all" },
      { type: "tag", tag: "ก" },
    ])
  })

  test("คำค้นกรองรายการ (ชื่อ ชื่อไทย ผู้แต่ง แท็ก) ร่วมกับตัวกรองอื่น", () => {
    const novels = [dto(1, { author: "Quill", status: "completed" }), dto(2, { author: "Quill", status: "ongoing" }), dto(3, { author: "Other" })]
    assert.deepEqual(cardHrefs(render({ novels, query: "quill", asPageHeading: true })).sort(), ["/novel/1", "/novel/2"])
    assert.deepEqual(cardHrefs(render({ novels, query: "quill", asPageHeading: true, state: { ...INITIAL_LIBRARY, status: "completed" } })), ["/novel/1"])
  })
})

describe("LibraryView: ช่องเลือกการเรียง", () => {
  test("มีชื่อ 'เรียงตาม' และสองตัวเลือก; ค่าที่เลือกตามสถานะ", () => {
    const section = render()
    const select = one(section, "select")
    assert.ok(select.attrs["aria-label"] === "เรียงตาม" || all(section, "label").some((label) => text(label).includes("เรียงตาม")))
    assert.deepEqual(all(select, "option").map((option) => [option.attrs.value, text(option)]), [
      ["latest", "อัปเดตล่าสุด"],
      ["title", "ชื่อเรื่อง ก–ฮ"],
    ])
    assert.equal(select.attrs.value, undefined) // React ใส่ selected ที่ option ไม่ใช่ value ที่ select
    assert.equal(all(select, "option").filter((option) => "selected" in option.attrs).map((option) => option.attrs.value).join(), "latest")
    const byTitle = one(render({ state: { ...INITIAL_LIBRARY, sort: "title" } }), "select")
    assert.equal(all(byTitle, "option").filter((option) => "selected" in option.attrs).map((option) => option.attrs.value).join(), "title")
  })

  test("เปลี่ยนค่า → ส่งคำสั่ง sort; ค่าที่ไม่รู้จักไม่ทำอะไร", () => {
    const actions: LibraryAction[] = []
    const tree = LibraryView(props({ dispatch: (action) => actions.push(action) }))
    const onChange = handlerOf(findTag(tree, "select"), "onChange")
    onChange({ target: { value: "title" } })
    onChange({ target: { value: "bogus" } })
    onChange({ target: { value: "latest" } })
    assert.deepEqual(actions, [
      { type: "sort", sort: "title" },
      { type: "sort", sort: "latest" },
    ])
  })
})

describe("LibraryView: ไม่พบรายการ", () => {
  test("ค้นหาแล้วไม่พบ → สถานะว่างที่บอกคำค้นและปุ่ม 'ล้างการค้นหา'; ไม่มีตารางและปุ่มแสดงเพิ่ม", () => {
    const section = render({ query: "zzz", asPageHeading: true })
    assert.equal(text(one(one(section, ".state-empty"), ".state-title")), "ไม่พบนิยายที่ตรงกับ “zzz”")
    assert.ok(text(one(section, ".state-hint")).length > 0)
    assert.equal(text(one(one(section, ".state-actions"), "button")).trim(), "ล้างการค้นหา")
    assert.equal(all(section, ".grid").length, 0)
    assert.equal(all(section, ".more").length, 0)
    assert.equal(text(one(section, ".lib-count")), "ไม่พบเรื่อง")
    assert.ok(one(section, ".lib-count").attrs.class.split(" ").includes("sr-only"), "ข้อความซ้ำกับสถานะว่าง จึงซ่อนจากสายตา")
  })

  test("มีรายการ → บรรทัดจำนวนเรื่องมองเห็นได้ (ไม่ใช่ sr-only)", () => {
    assert.ok(!one(render(), ".lib-count").attrs.class.split(" ").includes("sr-only"))
  })

  test("ตัวกรองทำให้ไม่เหลือเรื่อง (ไม่มีคำค้น) → 'ไม่พบนิยายที่ตรงกับตัวกรอง' และปุ่ม 'ล้างตัวกรอง'", () => {
    const section = render({ novels: [dto(1, { status: "ongoing" })], state: { ...INITIAL_LIBRARY, status: "completed" } })
    assert.equal(text(one(section, ".state-title")), "ไม่พบนิยายที่ตรงกับตัวกรอง")
    assert.equal(text(one(one(section, ".state-actions"), "button")).trim(), "ล้างตัวกรอง")
    // ชิปยังอยู่ให้กดเปลี่ยนได้
    assert.equal(all(one(section, '[aria-label="สถานะ"]'), "button").length, 3)
  })

  test("ปุ่มล้างเรียก onClear", () => {
    let cleared = 0
    const tree = LibraryView(props({ novels: [], query: "zzz", asPageHeading: true, onClear: () => cleared++ }))
    const [empty] = findAll(tree, (el) => el.type === EmptyState)
    const button = findTag(empty.props.action as ReactNode, "button")
    handlerOf(button, "onClick")()
    assert.equal(cleared, 1)
  })
})
