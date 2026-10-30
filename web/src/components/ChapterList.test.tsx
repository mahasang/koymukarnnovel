import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { INITIAL_LIST, type ListAction, type ListState } from "../lib/chapter-list"
import type { ChapterItemDto } from "../lib/types"
import { all, one, text, type El } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { Chip } from "./Chip"
import { ChapterList, ChapterListView, type ChapterListViewProps } from "./ChapterList"

const chapter = (number: number, over: Partial<ChapterItemDto> = {}): ChapterItemDto => ({
  number,
  title: `Chapter ${number}`,
  titleTh: `ตอน ${number}`,
  publishedAt: "2026-10-22 03:00:00",
  published: true,
  ...over,
})
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => chapter(from + i))

const props = (over: Partial<ChapterListViewProps> = {}): ChapterListViewProps => ({
  novelId: 7,
  chapters: range(1, 120),
  state: INITIAL_LIST,
  lastRead: null,
  jumpValue: "",
  jumpError: null,
  onJumpValue: () => {},
  onJumpSubmit: () => {},
  dispatch: () => {},
  ...over,
})
const view = (over: Partial<ChapterListViewProps> = {}) => one(renderPage(<ChapterListView {...props(over)} />), 'section[aria-labelledby="chapters-title"]')
const state = (over: Partial<ListState> = {}): ListState => ({ ...INITIAL_LIST, ...over })
const rows = (root: El) => all(root, "li.ch-row")
const numberOf = (row: El) => text(one(row, ".ch-num"))

describe("ChapterListView: หัวข้อและแถว", () => {
  test("ส่วน 'รายการตอน' ที่ชื่อโดยหัวข้อของตัวเอง พร้อมจำนวนตอนทั้งหมด", () => {
    const section = view()
    const heading = one(section, "h2.nv-h")
    assert.equal(text(heading), "รายการตอน (120)")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
  })

  test("ค่าเริ่มต้น: 50 แถว ใหม่→เก่า เริ่มที่ตอนที่ 120 ลิงก์ไปหน้าอ่านของเรื่องนั้น", () => {
    const list = rows(view())
    assert.equal(list.length, 50)
    assert.equal(numberOf(list[0]), "ตอนที่ 120")
    assert.equal(numberOf(list[49]), "ตอนที่ 71")
    assert.equal(one(list[0], "a.ch-link").attrs.href, "/novel/7/120")
    assert.equal(one(list[49], "a.ch-link").attrs.href, "/novel/7/71")
  })

  test("เก่า→ใหม่ และหน้าสุดท้ายสั้นกว่า 50", () => {
    const asc = rows(view({ state: state({ order: "asc" }) }))
    assert.equal(numberOf(asc[0]), "ตอนที่ 1")
    assert.equal(numberOf(asc[49]), "ตอนที่ 50")
    const last = rows(view({ state: state({ order: "asc", page: 3 }) }))
    assert.equal(last.length, 20)
    assert.equal(numberOf(last[0]), "ตอนที่ 101")
  })

  test("ชื่อตอน: ชื่อไทยก่อน → ชื่อต้นฉบับ → ไม่มีชื่อก็ไม่มีองค์ประกอบชื่อ", () => {
    const section = view({ chapters: [chapter(1), chapter(2, { titleTh: "  " }), chapter(3, { titleTh: "", title: "" })], state: state({ order: "asc" }) })
    const list = rows(section)
    assert.equal(text(one(list[0], ".ch-title")), "ตอน 1")
    assert.equal(text(one(list[1], ".ch-title")), "Chapter 2")
    assert.equal(all(list[2], ".ch-title").length, 0)
  })

  test("วันที่เผยแพร่แบบไทย · ตอนร่างของผู้ดูแลมีป้าย 'ร่าง' แทนวันที่", () => {
    const section = view({ chapters: [chapter(1), chapter(2, { published: false, publishedAt: null })], state: state({ order: "asc" }) })
    const [published, draft] = rows(section)
    assert.equal(text(one(published, ".ch-date")), "22 ต.ค. 2569")
    assert.equal(all(published, ".draft").length, 0)
    assert.equal(all(draft, ".ch-date").length, 0)
    assert.equal(text(one(draft, ".draft")), "ร่างร่าง — เห็นเฉพาะผู้ดูแล")
  })

  test("วันที่ในรูปแบบผิดไม่แสดงข้อความมั่ว", () => {
    const section = view({ chapters: [chapter(1, { publishedAt: "not a date" })] })
    assert.equal(all(section, ".ch-date").length, 0)
  })

  test("ตอนที่อ่านล่าสุดถูกไฮไลต์ด้วยคลาส last และป้ายข้อความ 'อ่านล่าสุด' (ไม่พึ่งสีอย่างเดียว) เฉพาะตอนนั้น", () => {
    const list = rows(view({ lastRead: 100 }))
    const marked = list.filter((row) => row.attrs.class?.split(/\s+/).includes("last"))
    assert.equal(marked.length, 1)
    assert.equal(numberOf(marked[0]), "ตอนที่ 100")
    assert.equal(text(one(marked[0], ".ch-tag")), "อ่านล่าสุด")
    assert.equal(all(list[0], ".ch-tag").length, 0)
  })

  test("ตอนที่ 0 ที่อ่านล่าสุดก็ไฮไลต์ (0 ไม่ใช่ 'ไม่มี')", () => {
    const list = rows(view({ chapters: range(0, 5), lastRead: 0, state: state({ order: "asc" }) }))
    assert.ok(list[0].attrs.class?.split(/\s+/).includes("last"))
    assert.equal(list.filter((row) => row.attrs.class?.split(/\s+/).includes("last")).length, 1)
  })

  test("อ่านล่าสุดเป็นตอนที่อยู่คนละหน้า → ไม่มีแถวไฮไลต์ในหน้านี้", () => {
    assert.equal(all(view({ lastRead: 1 }), "li.last").length, 0)
  })

  test("ตอนที่เพิ่งกระโดดไปหาถูกไฮไลต์ด้วยคลาส jump · ซ้อนกับ last ได้", () => {
    const list = rows(view({ lastRead: 100, state: state({ jump: 100 }) }))
    const target = list.find((row) => numberOf(row) === "ตอนที่ 100")
    assert.ok(target)
    assert.equal(target.attrs.class, "ch-row last jump")
    assert.equal(list.filter((row) => row.attrs.class?.split(/\s+/).includes("jump")).length, 1)
    assert.equal(rows(view({ chapters: range(0, 3), state: state({ jump: 0, order: "asc" }) }))[0].attrs.class, "ch-row jump")
  })

  test("ไม่มีตอนเลย → ข้อความบอกตรงๆ ไม่มีแถบเครื่องมือ/ตัวแบ่งหน้า", () => {
    const section = view({ chapters: [] })
    assert.equal(text(one(section, ".ch-empty")), "ยังไม่มีตอนให้อ่าน")
    for (const selector of [".ch-bar", "form", "nav", "ol"]) assert.equal(all(section, selector).length, 0, selector)
    assert.equal(text(one(section, "h2.nv-h")), "รายการตอน")
  })
})

describe("ChapterListView: เรียงและไปตอนที่ …", () => {
  test("ชิปเรียงสองแบบตามสเปก ปุ่มที่ใช้อยู่ aria-pressed", () => {
    const group = one(view(), "div.ch-orders")
    assert.equal(group.attrs.role, "group")
    assert.equal(group.attrs["aria-label"], "เรียงตอน")
    const buttons = all(group, "button")
    assert.deepEqual(buttons.map(text), ["ใหม่ → เก่า", "เก่า → ใหม่"])
    assert.deepEqual(buttons.map((b) => b.attrs["aria-pressed"]), ["true", "false"])
    const asc = all(one(view({ state: state({ order: "asc" }) }), "div.ch-orders"), "button")
    assert.deepEqual(asc.map((b) => b.attrs["aria-pressed"]), ["false", "true"])
  })

  test("กดชิปเรียง → dispatch สลับแบบเรียง", () => {
    const actions: ListAction[] = []
    const tree = ChapterListView(props({ dispatch: (action) => actions.push(action) }))
    const chips = findAll(tree, (el) => el.type === Chip)
    assert.equal(chips.length, 2)
    handlerOf(chips[1], "onClick")()
    handlerOf(chips[0], "onClick")()
    assert.deepEqual(actions, [
      { type: "order", order: "asc" },
      { type: "order", order: "desc" },
    ])
  })

  test("ช่อง 'ไปตอนที่ …': ป้ายผูกกับช่องกรอก เป็นช่องข้อความรับตัวเลข ค่าที่ควบคุมมาจาก jumpValue", () => {
    const form = one(view({ jumpValue: "75" }), "form.ch-jump")
    const label = one(form, "label")
    const input = one(form, "input")
    assert.equal(text(label), "ไปตอนที่")
    assert.equal(label.attrs.for, input.attrs.id)
    assert.ok(input.attrs.id)
    assert.equal(input.attrs.type, "text")
    assert.equal(input.attrs.inputmode, "numeric")
    assert.equal(input.attrs.autocomplete, "off")
    assert.equal(input.attrs.value, "75")
    assert.equal(text(one(form, "button")), "ไป")
    assert.equal(one(form, "button").attrs.type, "submit")
  })

  test("พิมพ์ในช่อง → onJumpValue ได้ค่าที่พิมพ์ · ส่งฟอร์ม → ไม่โหลดหน้าใหม่ + onJumpSubmit หนึ่งครั้ง", () => {
    const typed: string[] = []
    let submits = 0
    const tree = ChapterListView(props({ onJumpValue: (value) => typed.push(value), onJumpSubmit: () => (submits += 1) }))
    handlerOf(findTag(tree, "input"), "onChange")({ target: { value: "๑๒" } })
    assert.deepEqual(typed, ["๑๒"])
    let prevented = 0
    handlerOf(findTag(tree, "form"), "onSubmit")({ preventDefault: () => (prevented += 1) })
    assert.equal(prevented, 1)
    assert.equal(submits, 1)
  })

  test("ข้อผิดพลาดของช่อง: ข้อความ role=alert ผูกกับช่องด้วย aria-describedby และ aria-invalid · ไม่มีข้อผิดพลาด = ไม่มีทั้งสาม", () => {
    const withError = view({ jumpError: "ไม่พบตอนที่ 500 (มีตั้งแต่ตอนที่ 1 ถึง 120)" })
    const error = one(withError, "p.ch-err")
    assert.equal(error.attrs.role, "alert")
    assert.equal(text(error), "ไม่พบตอนที่ 500 (มีตั้งแต่ตอนที่ 1 ถึง 120)")
    const input = one(withError, "input")
    assert.equal(input.attrs["aria-invalid"], "true")
    assert.equal(input.attrs["aria-describedby"], error.attrs.id)
    assert.ok(error.attrs.id)
    const clean = view()
    assert.equal(all(clean, "p.ch-err").length, 0)
    assert.equal(one(clean, "input").attrs["aria-invalid"], undefined)
    assert.equal(one(clean, "input").attrs["aria-describedby"], undefined)
  })

  test("ส่ง ref ของรายการและหัวข้อให้ตัวห่อใช้โฟกัส/เลื่อน", () => {
    const listRef = { current: null }
    const headingRef = { current: null }
    const tree = ChapterListView(props({ listRef, headingRef }))
    assert.equal(findTag(tree, "ol").props.ref, listRef)
    assert.equal(findTag(tree, "h2").props.ref, headingRef)
  })
})

describe("ChapterListView: key ของแถว", () => {
  test("key = เลขตอน (ไม่ซ้ำแม้ชื่อตอนซ้ำกัน ไม่ใช่ชื่อตอน)", () => {
    const same = [1, 2, 3].map((number) => chapter(number, { title: "Interlude", titleTh: "" }))
    const tree = ChapterListView(props({ chapters: same }))
    const keys = findAll(tree, (el) => el.type === "li").map((el) => el.key)
    assert.deepEqual(keys, ["3", "2", "1"])
  })
})

describe("ChapterListView: ตัวแบ่งหน้า", () => {
  const pager = (over: Partial<ChapterListViewProps> = {}) => one(view(over), "nav.ch-pager")

  test("ไม่เกิน 50 ตอน → ไม่มีตัวแบ่งหน้า", () => {
    assert.equal(all(view({ chapters: range(1, 50) }), "nav").length, 0)
    assert.equal(all(view({ chapters: range(1, 1) }), "nav").length, 0)
  })

  test("หน้าแรก: ปุ่มก่อนหน้าปิด ปุ่มถัดไปเปิด · บอกหน้าและช่วงตอน", () => {
    const nav = pager()
    assert.equal(nav.attrs["aria-label"], "หน้ารายการตอน")
    const [prev, next] = all(nav, "button")
    assert.equal(text(prev), "ก่อนหน้า")
    assert.equal(text(next), "ถัดไป")
    assert.ok("disabled" in prev.attrs)
    assert.ok(!("disabled" in next.attrs))
    assert.equal(text(one(nav, ".ch-page")), "หน้า 1 จาก 3 · ตอนที่ 71–120")
    assert.equal(one(nav, ".ch-page").attrs["aria-live"], "polite")
  })

  test("หน้ากลางเปิดทั้งสองปุ่ม · หน้าสุดท้ายปิดปุ่มถัดไป และช่วงตอนเป็นของหน้านั้น", () => {
    const [prev, next] = all(pager({ state: state({ page: 2 }) }), "button")
    assert.ok(!("disabled" in prev.attrs) && !("disabled" in next.attrs))
    const last = pager({ state: state({ page: 3 }) })
    const [prevLast, nextLast] = all(last, "button")
    assert.ok(!("disabled" in prevLast.attrs))
    assert.ok("disabled" in nextLast.attrs)
    assert.equal(text(one(last, ".ch-page")), "หน้า 3 จาก 3 · ตอนที่ 1–20")
  })

  test("เลขหน้าที่เกินช่วง (รายการตอนหดลงหลังโหลดใหม่) ถูกตรึง: ข้อความและปุ่มตามหน้าที่แสดงจริง", () => {
    const beyond = pager({ state: state({ page: 9 }) })
    assert.equal(text(one(beyond, ".ch-page")), "หน้า 3 จาก 3 · ตอนที่ 1–20")
    const [, next] = all(beyond, "button")
    assert.ok("disabled" in next.attrs)
    const before = pager({ state: state({ page: 0 }) })
    assert.equal(text(one(before, ".ch-page")), "หน้า 1 จาก 3 · ตอนที่ 71–120")
    assert.ok("disabled" in all(before, "button")[0].attrs)
  })

  test("ช่วงตอนตามแบบเรียงและตอนที่ 0", () => {
    assert.equal(text(one(pager({ state: state({ order: "asc", page: 2 }) }), ".ch-page")), "หน้า 2 จาก 3 · ตอนที่ 51–100")
    assert.equal(text(one(pager({ chapters: range(0, 60), state: state({ order: "asc", page: 1 }) }), ".ch-page")), "หน้า 1 จาก 2 · ตอนที่ 0–49")
  })

  test("กดปุ่ม → dispatch เปลี่ยนหน้าพร้อมจำนวนตอนทั้งหมด", () => {
    const actions: ListAction[] = []
    const tree = ChapterListView(props({ state: state({ page: 2 }), dispatch: (action) => actions.push(action) }))
    const [prev, next] = findAll(tree, (el) => el.type === "button" && typeof el.props.onClick === "function" && ["ก่อนหน้า", "ถัดไป"].includes(String(el.props.children)))
    handlerOf(prev, "onClick")()
    handlerOf(next, "onClick")()
    assert.deepEqual(actions, [
      { type: "page", page: 1, count: 120 },
      { type: "page", page: 3, count: 120 },
    ])
  })
})

describe("ChapterList (ตัวห่อที่มีสถานะ)", () => {
  test("เรนเดอร์ครั้งแรก: ใหม่→เก่า หน้า 1 ยังไม่มีข้อผิดพลาด · อ่านล่าสุดมาจาก lastRead", () => {
    const root = renderPage(<ChapterList novelId={7} chapters={range(1, 120)} lastRead={120} />)
    const list = all(root, "li.ch-row")
    assert.equal(list.length, 50)
    assert.equal(numberOf(list[0]), "ตอนที่ 120")
    assert.ok(list[0].attrs.class?.split(/\s+/).includes("last"))
    assert.equal(all(root, "p.ch-err").length, 0)
    assert.equal(one(root, "input").attrs.value, "")
  })
})
