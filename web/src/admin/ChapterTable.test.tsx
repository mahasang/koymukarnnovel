import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Switch } from "../components/Switch"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { ChapterTableView, type ChapterTableViewProps } from "./ChapterTable"
import type { AdminChapterRow } from "./types"

const row = (over: Partial<AdminChapterRow> = {}): AdminChapterRow => ({
  id: 10,
  number: 1,
  title: "The Stone Stairs",
  titleTh: "บันไดหิน",
  status: "done",
  error: "",
  published: true,
  publishedAt: "2026-10-01 00:00:00",
  translatedAt: "2026-10-01 05:30:00",
  queueSeq: null,
  hasTranslation: true,
  srcLength: 5000,
  ...over,
})

const ROWS = [
  row({ id: 10, number: 1 }),
  row({ id: 11, number: 2, title: "Two", titleTh: "", status: "draft", hasTranslation: false, published: false, translatedAt: null }),
  row({ id: 12, number: 3, status: "error", error: "API ล้มเหลว 529", published: false, hasTranslation: false, translatedAt: null }),
  row({ id: 13, number: 4, status: "translating", published: false }),
  row({ id: 14, number: 5, status: "queued", published: false, hasTranslation: false, translatedAt: null }),
]

const props = (over: Partial<ChapterTableViewProps> = {}): ChapterTableViewProps => ({
  novelId: 7,
  rows: ROWS,
  selected: new Set(),
  pending: false,
  notice: null,
  error: null,
  onToggle: () => {},
  onToggleAll: () => {},
  onClear: () => {},
  onPublish: () => {},
  onRetry: () => {},
  onDeleteRows: () => {},
  onBulk: () => {},
  onPublishReady: () => {},
  ...over,
})

const render = (over: Partial<ChapterTableViewProps> = {}) => renderPage(<ChapterTableView {...props(over)} />)
const trs = (page: ReturnType<typeof render>) => all(one(page, "tbody"), "tr")
const btn = (page: ReturnType<typeof render>, label: string) => all(page, "button").find((b) => text(b) === label || b.attrs["aria-label"] === label)

describe("ChapterTableView: ว่างเปล่า", () => {
  test("ยังไม่มีตอน → หน้าว่างพร้อมลิงก์เพิ่มตอนของเรื่องนี้ · ไม่มีตาราง", () => {
    const page = render({ rows: [] })
    assert.equal(all(page, "table").length, 0)
    assert.match(text(page), /ยังไม่มีตอน/)
    assert.ok(all(page, "a").some((a) => a.attrs.href === "/admin/add?novel=7"))
  })
})

describe("ChapterTableView: หัวตารางและแถบสรุป", () => {
  test("สรุปจำนวน + ปุ่ม 'เผยแพร่ตอนที่แปลเสร็จทั้งหมด' + ลิงก์เพิ่มตอน", () => {
    const page = render()
    assert.equal(text(one(page, "p[class=ad-csummary]")), "ทั้งหมด 5 ตอน · แปลแล้ว 1 · เผยแพร่ 1")
    assert.ok(btn(page, "เผยแพร่ตอนที่แปลเสร็จทั้งหมด"))
    assert.ok(all(page, "a").some((a) => a.attrs.href === "/admin/add?novel=7" && text(a) === "เพิ่มตอน"))
  })

  test("ปุ่มเผยแพร่ทั้งหมด: ปิดเมื่อไม่มีตอนที่พร้อม · เปิดเมื่อมี (แปลเสร็จ ยังไม่เผยแพร่) · ปิดระหว่างทำคำสั่งอยู่", () => {
    const off = btn(render(), "เผยแพร่ตอนที่แปลเสร็จทั้งหมด")!
    assert.ok("disabled" in off.attrs)
    const ready = [...ROWS, row({ id: 20, number: 6, published: false })]
    assert.equal("disabled" in btn(render({ rows: ready }), "เผยแพร่ตอนที่แปลเสร็จทั้งหมด")!.attrs, false)
    assert.ok("disabled" in btn(render({ rows: ready, pending: true }), "เผยแพร่ตอนที่แปลเสร็จทั้งหมด")!.attrs)
  })

  test("กดปุ่มเผยแพร่ทั้งหมด → onPublishReady", () => {
    let n = 0
    const view = ChapterTableView(props({ rows: [row({ published: false })], onPublishReady: () => n++ }))
    handlerOf(findTag(view, "button", (b) => b.props["data-act"] === "publish-ready"), "onClick")()
    assert.equal(n, 1)
  })

  test("แจ้งผล role=status · ข้อผิดพลาด role=alert · ไม่มี → ไม่มีกล่อง", () => {
    const page = render({ notice: "เผยแพร่แล้ว 2 ตอน", error: "ทำไม่สำเร็จ" })
    assert.equal(text(one(page, "p[role=status]")), "เผยแพร่แล้ว 2 ตอน")
    assert.equal(text(one(page, "p[role=alert]")), "ทำไม่สำเร็จ")
    const none = render()
    assert.equal(all(none, "p[role=status]").length, 0)
    assert.equal(all(none, "p[role=alert]").length, 0)
  })
})

describe("ChapterTableView: ตาราง", () => {
  test("หัวคอลัมน์ตาม spec 7.6 + คำบรรยายตาราง (หัวคอลัมน์ติ๊กมีแต่ช่องติ๊กที่มีป้ายเสียง)", () => {
    const page = render()
    const heads = all(one(page, "thead"), "th")
    assert.deepEqual(heads.map((th) => text(th)), ["", "ตอนที่", "ชื่อตอน", "สถานะ", "เผยแพร่", "แปลเมื่อ", "จัดการ"])
    for (const th of heads) assert.equal(th.attrs.scope, "col")
    assert.equal(text(one(page, "caption")), "ตารางตอนของเรื่อง")
    assert.equal(trs(page).length, 5)
  })

  test("ชื่อตอน: ชื่อไทยเป็นลิงก์ไปหน้าแก้ตอน ชื่อต้นฉบับอยู่ใต้ · ไม่มีชื่อไทย → ชื่อต้นฉบับเป็นหลัก ไม่มีบรรทัดรองซ้ำ", () => {
    const [first, second] = trs(render())
    const link = one(first!, "a[class=ad-clink]")
    assert.equal(link.attrs.href, "/admin/novels/7/chapters/10")
    assert.equal(text(link), "บันไดหิน")
    assert.equal(text(one(first!, "span[class=ad-csub]")), "The Stone Stairs")
    assert.equal(text(one(second!, "a[class=ad-clink]")), "Two")
    assert.equal(all(second!, "span[class=ad-csub]").length, 0)
  })

  test("เลขตอนเป็นหัวแถว (th scope=row)", () => {
    const first = trs(render())[0]!
    const th = one(first, "th[scope=row]")
    assert.equal(text(th), "1")
  })

  test("ชิปสถานะ: ข้อความตาม STATUS_LABEL และโทนตามสถานะ", () => {
    const chips = trs(render()).map((tr) => one(tr, "span[class=ad-pill]"))
    assert.deepEqual(chips.map((c) => text(c)), ["แปลเสร็จ", "ร่าง", "ผิดพลาด", "กำลังแปล", "รอคิว"])
    assert.deepEqual(chips.map((c) => c.attrs["data-tone"]), ["ok", "idle", "fail", "live", "warn"])
  })

  test("ตอนที่ผิดพลาดแสดงข้อความผิดพลาดใต้ชื่อ · ตอนอื่นไม่มี", () => {
    const rows = trs(render())
    assert.equal(text(one(rows[2]!, "span[class=ad-cerr]")), "API ล้มเหลว 529")
    for (const i of [0, 1, 3, 4]) assert.equal(all(rows[i]!, "span[class=ad-cerr]").length, 0, String(i))
  })

  test("เวลาแปล: เวลาไทยเมื่อมี · ไม่มี → ขีด", () => {
    const rows = trs(render())
    assert.match(text(all(rows[0]!, "td").at(-2)!), /1 ต\.ค\. 2569 12:30 น\./)
    assert.equal(text(all(rows[1]!, "td").at(-2)!), "—")
  })

  test("ปุ่มท้ายแถว: แก้ไข (ลิงก์) · ลบ ทุกแถว · ลองใหม่เฉพาะตอนผิดพลาด · ป้ายเสียงบอกเลขตอน", () => {
    const rows = trs(render())
    for (const [i, tr] of rows.entries()) {
      const n = i + 1
      assert.equal(one(tr, `a[aria-label=แก้ไขตอนที่ ${n}]`).attrs.href, `/admin/novels/7/chapters/${10 + i}`)
      assert.equal(all(tr, `button[aria-label=ลบตอนที่ ${n}]`).length, 1, `ลบ ${n}`)
      assert.equal(all(tr, `button[aria-label=ลองใหม่ตอนที่ ${n}]`).length, n === 3 ? 1 : 0, `ลองใหม่ ${n}`)
    }
  })
})

describe("ChapterTableView: สวิตช์เผยแพร่", () => {
  const switches = (over: Partial<ChapterTableViewProps> = {}) => findAll(ChapterTableView(props(over)), (e) => e.type === Switch)

  test("ค่าตามตอน · ป้ายมีเลขตอน", () => {
    const sw = switches()
    assert.deepEqual(sw.map((s) => s.props.checked), [true, false, false, false, false])
    assert.equal(sw[0]!.props.label, "เผยแพร่ตอนที่ 1")
  })

  test("ไม่มีคำแปล → สวิตช์ปิด + คำอธิบายที่เห็นในแถว · มีคำแปล → ใช้ได้ ไม่มีคำอธิบาย", () => {
    const sw = switches()
    assert.deepEqual(sw.map((s) => s.props.disabled), [false, true, true, false, true])
    const rows = trs(render())
    assert.match(text(one(rows[1]!, "span[class=ad-cwhy]")), /ยังไม่มีคำแปล/)
    assert.equal(all(rows[0]!, "span[class=ad-cwhy]").length, 0)
  })

  test("ระหว่างทำคำสั่งอยู่ปิดทุกสวิตช์", () => {
    assert.ok(switches({ pending: true }).every((s) => s.props.disabled === true))
  })

  test("กดสวิตช์ → onPublish(แถว, ค่าใหม่)", () => {
    const got: unknown[] = []
    const [sw] = switches({ onPublish: (r, next) => got.push([r.id, next]) })
    ;(sw!.props.onChange as (v: boolean) => void)(false)
    assert.deepEqual(got, [[10, false]])
  })
})

describe("ChapterTableView: เลือกแถวและคำสั่งหลายตอน", () => {
  test("ยังไม่เลือก → ไม่มีแถบคำสั่งหลายตอน", () => {
    assert.equal(all(render(), "div[data-kind=bulk]").length, 0)
  })

  test("ช่องติ๊กแต่ละแถว: ตามที่เลือก · ป้ายเสียงบอกเลขตอน · เปลี่ยนแล้วส่งรหัสตอนให้ผู้เรียก", () => {
    const page = render({ selected: new Set([11]) })
    const boxes = all(one(page, "tbody"), "input[type=checkbox]")
    assert.deepEqual(boxes.map((b) => "checked" in b.attrs), [false, true, false, false, false])
    assert.equal(boxes[1]!.attrs["aria-label"], "เลือกตอนที่ 2")
    const got: number[] = []
    const view = ChapterTableView(props({ onToggle: (id) => got.push(id) }))
    const rowBoxes = findAll(view, (e) => e.type === "input" && String(e.props["aria-label"]).startsWith("เลือกตอนที่"))
    handlerOf(rowBoxes[2]!, "onChange")()
    assert.deepEqual(got, [12])
  })

  test("ช่องเลือกทั้งหมด: ติ๊กเมื่อเลือกครบ · ไม่ครบ = สถานะกึ่งกลาง (indeterminate) · กดแล้ว onToggleAll", () => {
    const ids = ROWS.map((r) => r.id)
    assert.ok("checked" in one(render({ selected: new Set(ids) }), "input[aria-label=เลือกทั้งหมด]").attrs)
    assert.equal("checked" in one(render({ selected: new Set([10]) }), "input[aria-label=เลือกทั้งหมด]").attrs, false)
    let n = 0
    const view = ChapterTableView(props({ selected: new Set([10]), onToggleAll: () => n++ }))
    const head = findTag(view, "input", (e) => e.props["aria-label"] === "เลือกทั้งหมด")
    handlerOf(head, "onChange")()
    assert.equal(n, 1)
    const fake = { indeterminate: false }
    ;(head.props.ref as (el: unknown) => void)(fake)
    assert.equal(fake.indeterminate, true)
    const all2 = findTag(ChapterTableView(props({ selected: new Set(ids) })), "input", (e) => e.props["aria-label"] === "เลือกทั้งหมด")
    const fake2 = { indeterminate: true }
    ;(all2.props.ref as (el: unknown) => void)(fake2)
    assert.equal(fake2.indeterminate, false)
    const none = findTag(ChapterTableView(props()), "input", (e) => e.props["aria-label"] === "เลือกทั้งหมด")
    const fake3 = { indeterminate: true }
    ;(none.props.ref as (el: unknown) => void)(fake3)
    assert.equal(fake3.indeterminate, false)
  })

  test("เลือกแล้ว → แถบแสดงจำนวนและปุ่ม แปล · เผยแพร่ · ซ่อน · ลบ · ล้างการเลือก", () => {
    const page = render({ selected: new Set([10, 11]) })
    const bar = one(page, "div[data-kind=bulk]")
    assert.match(text(bar), /เลือกแล้ว 2 ตอน/)
    assert.deepEqual(all(bar, "button").map((b) => text(b)), ["แปล / แปลใหม่", "เผยแพร่", "ซ่อน", "ลบ", "ล้างการเลือก"])
  })

  test("ป้ายปุ่มแปลตามคำแปลของแถวที่เลือก", () => {
    assert.ok(btn(render({ selected: new Set([11]) }), "แปล"))
    assert.ok(btn(render({ selected: new Set([10]) }), "แปลใหม่"))
  })

  test("ปุ่มในแถบ: แปล/เผยแพร่/ซ่อน → onBulk(action) · ลบ → onDeleteRows(แถวที่เลือกตามลำดับตาราง) · ล้าง → onClear", () => {
    const got: unknown[] = []
    const view = ChapterTableView(
      props({
        selected: new Set([12, 10]),
        onBulk: (a) => got.push(a),
        onDeleteRows: (rows) => got.push(rows.map((r) => r.id)),
        onClear: () => got.push("clear"),
      }),
    )
    for (const act of ["translate", "publish", "hide", "delete", "clear"]) handlerOf(findTag(view, "button", (b) => b.props["data-act"] === act), "onClick")()
    assert.deepEqual(got, ["translate", "publish", "hide", [10, 12], "clear"])
  })

  test("ระหว่างทำคำสั่งอยู่ปิดปุ่มคำสั่งทุกปุ่ม (กดซ้ำไม่ได้)", () => {
    const page = render({ selected: new Set([10]), pending: true })
    for (const b of all(one(page, "div[data-kind=bulk]"), "button").filter((x) => text(x) !== "ล้างการเลือก")) assert.ok("disabled" in b.attrs, text(b))
    for (const tr of trs(page)) for (const b of all(tr, "button")) assert.ok("disabled" in b.attrs, b.attrs["aria-label"])
  })
})

describe("ChapterTableView: ปุ่มต่อแถว", () => {
  test("ลองใหม่ → onRetry(แถว) · ลบ → onDeleteRows([แถว])", () => {
    const got: unknown[] = []
    const view = ChapterTableView(props({ onRetry: (r) => got.push(["retry", r.id]), onDeleteRows: (rows) => got.push(["delete", rows.map((r) => r.id)]) }))
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "ลองใหม่ตอนที่ 3"), "onClick")()
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "ลบตอนที่ 2"), "onClick")()
    assert.deepEqual(got, [["retry", 12], ["delete", [11]]])
  })
})

describe("ChapterTableView — ขอบเขตหลัง mutation sweep", () => {

  test("ข้อความผิดพลาดโชว์เฉพาะแถวสถานะ error (แถวอื่นที่มีข้อความค้างไม่โชว์)", () => {
    const page = renderPage(<ChapterTableView {...props({ rows: [row({ id: 1, status: "queued", error: "ค้างจากครั้งก่อน", hasTranslation: false, published: false })] })} />)
    assert.equal(all(page, "span[class=ad-cerr]").length, 0)
  })
  test("เวลาแปลที่อ่านไม่ได้ → ขีด '—' ไม่ใช่ช่องว่าง", () => {
    const page = renderPage(<ChapterTableView {...props({ rows: [row({ id: 1, translatedAt: "ไม่ใช่เวลา" })] })} />)
    assert.equal(text(one(page, "td[class=ad-ctime]")), "—")
  })
})

