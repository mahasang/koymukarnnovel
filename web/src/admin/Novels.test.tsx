import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Switch } from "../components/Switch"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { NovelsView, type NovelsViewProps } from "./Novels"
import type { AdminNovelDto } from "./types"

const novel = (over: Partial<AdminNovelDto> = {}): AdminNovelDto => ({
  id: 7,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Mei Lan",
  synopsis: "",
  synopsisSrc: "",
  tags: [],
  status: "ongoing",
  sourceUrl: "",
  licenseNote: "",
  styleNote: "",
  mode: "translate",
  published: true,
  featured: false,
  hasCover: true,
  coverV: 1700000000,
  chapterCount: 90,
  translatedCount: 87,
  publishedCount: 80,
  createdAt: "2026-10-01 00:00:00",
  updatedAt: "2026-10-02 00:00:00",
  ...over,
})

const props = (over: Partial<NovelsViewProps> = {}): NovelsViewProps => ({
  novels: [novel()],
  busyId: null,
  error: null,
  onToggle: () => {},
  onDelete: () => {},
  ...over,
})

const render = (over: Partial<NovelsViewProps> = {}) => renderPage(<NovelsView {...props(over)} />)

describe("NovelsView: หัวหน้าและรายการว่าง", () => {
  test("หัวข้อ 'นิยาย' และปุ่มเพิ่มเรื่องใหม่ไปหน้าสร้าง", () => {
    const page = render()
    assert.equal(text(one(page, "h1")), "นิยาย")
    const add = all(page, "a").find((a) => text(a).includes("เพิ่มเรื่องใหม่"))
    assert.equal(add?.attrs.href, "/admin/novels/new")
  })

  test("ยังไม่มีนิยาย → หน้าว่างที่ชวนเพิ่มเรื่องแรก (ไม่มีตาราง)", () => {
    const page = render({ novels: [] })
    assert.equal(all(page, "table").length, 0)
    assert.match(text(page), /ยังไม่มีนิยาย/)
    const links = all(page, "a").filter((a) => a.attrs.href === "/admin/novels/new")
    assert.equal(links.length, 2, "ปุ่มหัวหน้า + ปุ่มในหน้าว่าง")
  })
})

describe("NovelsView: ตาราง", () => {
  test("หัวคอลัมน์ตาม spec และมีคำบรรยายตารางสำหรับโปรแกรมอ่านหน้าจอ", () => {
    const page = render()
    assert.deepEqual(all(page, "th").map((th) => text(th)), ["เรื่อง", "สถานะ", "แปลแล้ว / ทั้งหมด", "เผยแพร่", "จัดการ"])
    for (const th of all(page, "th")) assert.equal(th.attrs.scope, "col")
    assert.equal(text(one(page, "caption")), "รายการนิยาย")
  })

  test("แถว: ชื่อไทยเป็นลิงก์ไปหน้าจัดการ ชื่อต้นฉบับอยู่ใต้ · สถานะ · แปลแล้ว/ทั้งหมด และจำนวนที่เผยแพร่", () => {
    const page = render()
    const row = one(page, "tbody")
    const link = one(row, "a[class=ad-nlink]")
    assert.equal(link.attrs.href, "/admin/novels/7")
    assert.match(text(link), /ตะเกียงดวงสุดท้าย/)
    assert.match(text(link), /The Last Lantern/)
    assert.match(text(row), /กำลังอัปเดต/)
    assert.match(text(row), /87 \/ 90/)
    assert.match(text(row), /เผยแพร่ 80 ตอน/)
  })

  test("เรื่องที่จบแล้วขึ้น 'จบแล้ว' · เรื่องที่ไม่มีชื่อไทยแสดงชื่อต้นฉบับอย่างเดียว", () => {
    const row = one(render({ novels: [novel({ status: "completed", titleTh: "" })] }), "tbody")
    assert.match(text(row), /จบแล้ว/)
    const link = one(row, "a[class=ad-nlink]")
    assert.equal(text(link), "The Last Lantern")
  })

  test("ปก: มีปก → รูปจาก /covers/ID?v= · ไม่มี → ปกอัตโนมัติ", () => {
    const withCover = one(render(), "tbody")
    assert.equal(one(withCover, "img").attrs.src, "/covers/7?v=1700000000")
    const without = one(render({ novels: [novel({ hasCover: false, coverV: 0 })] }), "tbody")
    assert.equal(all(without, "img").length, 0)
    assert.equal(all(without, ".cv-placeholder").length, 1)
  })

  test("เรื่องแนะนำมีป้าย 'แนะนำ' · เรื่องทั่วไปไม่มี", () => {
    assert.match(text(one(render({ novels: [novel({ featured: true })] }), "tbody")), /แนะนำ/)
    assert.doesNotMatch(text(one(render(), "tbody")), /แนะนำ/)
  })

  test("หลายเรื่อง: แสดงตามลำดับที่ได้มา", () => {
    const page = render({ novels: [novel({ id: 3, titleTh: "ก" }), novel({ id: 2, titleTh: "ข" }), novel({ id: 1, titleTh: "ค" })] })
    assert.deepEqual(all(page, "a[class=ad-nlink]").map((a) => a.attrs.href), ["/admin/novels/3", "/admin/novels/2", "/admin/novels/1"])
  })
})

describe("NovelsView: การกระทำต่อแถว", () => {
  test("ปุ่มแก้ไขเป็นลิงก์ และปุ่มลบมีชื่อเรื่องในป้ายเสียง (โปรแกรมอ่านหน้าจอแยกแถวได้)", () => {
    const row = one(render(), "tbody")
    const edit = all(row, "a").find((a) => a.attrs["aria-label"] === "แก้ไข ตะเกียงดวงสุดท้าย")
    assert.equal(edit?.attrs.href, "/admin/novels/7")
    const del = all(row, "button").find((b) => b.attrs["aria-label"] === "ลบ ตะเกียงดวงสุดท้าย")
    assert.equal(del?.attrs.type, "button")
  })

  test("สวิตช์เผยแพร่: ค่าตามเรื่อง ป้ายมีชื่อเรื่อง กดแล้วส่งเรื่องนั้นให้ผู้เรียก", () => {
    const got: AdminNovelDto[] = []
    const n = novel({ published: false })
    const view = NovelsView(props({ novels: [n], onToggle: (x) => got.push(x) }))
    const [sw] = findAll(view, (e) => e.type === Switch)
    assert.equal(sw!.props.checked, false)
    assert.equal(sw!.props.label, "เผยแพร่ ตะเกียงดวงสุดท้าย")
    ;(sw!.props.onChange as (v: boolean) => void)(true)
    assert.deepEqual(got, [n])
  })

  test("กดปุ่มลบส่งเรื่องนั้นให้ผู้เรียก", () => {
    const got: AdminNovelDto[] = []
    const n = novel()
    const view = NovelsView(props({ novels: [n], onDelete: (x) => got.push(x) }))
    handlerOf(findTag(view, "button", (b) => b.props["aria-label"] === "ลบ ตะเกียงดวงสุดท้าย"), "onClick")()
    assert.deepEqual(got, [n])
  })

  test("แถวที่กำลังบันทึกปิดสวิตช์ของแถวนั้นเท่านั้น", () => {
    const view = NovelsView(props({ novels: [novel({ id: 1 }), novel({ id: 2 })], busyId: 2 }))
    const switches = findAll(view, (e) => e.type === Switch)
    assert.deepEqual(switches.map((s) => s.props.disabled), [false, true])
  })

  test("ข้อผิดพลาดของการสั่งเป็น role=alert เหนือตาราง · ไม่มี = ไม่มีกล่อง", () => {
    const page = render({ error: "ตะเกียงดวงสุดท้าย: บันทึกไม่สำเร็จ" })
    assert.equal(text(one(page, "p[role=alert]")), "ตะเกียงดวงสุดท้าย: บันทึกไม่สำเร็จ")
    assert.equal(all(render(), "p[role=alert]").length, 0)
  })
})

describe("NovelsView: ชื่อรองและปกอัตโนมัติ", () => {
  test("ไม่มีชื่อไทย → ไม่มีบรรทัดชื่อรองเลย (ไม่ใช่บรรทัดว่าง) · มีชื่อไทย → ชื่อต้นฉบับเป็นบรรทัดรอง", () => {
    assert.equal(all(one(render({ novels: [novel({ titleTh: "" })] }), "tbody"), ".ad-nsub").length, 1) // เหลือเฉพาะบรรทัด "เผยแพร่ N ตอน" ของคอลัมน์ตอน
    assert.equal(text(one(one(render(), "tbody"), "span[class=ad-nsub]")), "The Last Lantern")
  })

  test("ปกอัตโนมัติเขียนชื่อที่แสดงเป็นหลัก (ชื่อไทย) ไม่ใช่ชื่อรอง", () => {
    const row = one(render({ novels: [novel({ hasCover: false, coverV: 0 })] }), "tbody")
    assert.equal(text(one(row, ".cv-title")), "ตะเกียงดวงสุดท้าย")
  })
})
