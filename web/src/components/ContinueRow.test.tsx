import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ContinueItem } from "../lib/library"
import type { NovelCardDto } from "../lib/types"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { ContinueRow } from "./ContinueRow"

const dto = (id: number, over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id,
  title: `Novel ${id}`,
  titleTh: `นิยาย ${id}`,
  author: "A",
  synopsisShort: "",
  tags: [],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 30,
  latestNumber: 30,
  updatedAt: "2026-10-22 09:00:00",
  published: true,
  ...over,
})
const item = (id: number, over: Partial<ContinueItem["info"]> = {}, novel: Partial<NovelCardDto> = {}): ContinueItem => ({
  novel: dto(id, novel),
  info: { href: `/novel/${id}/12`, label: "อ่านต่อ ตอนที่ 12", chapter: 12, percent: 40, ...over },
})
const row = (items: ContinueItem[]) => renderPage(<ContinueRow items={items} />)

describe("ContinueRow", () => {
  test("ไม่มีรายการ → ไม่แสดงอะไรเลย (ซ่อนทั้งส่วน รวมหัวข้อ)", () => {
    const root = row([])
    assert.equal(all(root, "section").length, 0)
    assert.equal(all(root, "h2").length, 0)
  })

  test("ส่วนที่ชื่อ 'อ่านต่อจากที่ค้างไว้' มีหนึ่งการ์ดต่อเรื่อง ตามลำดับที่ให้มา", () => {
    const root = row([item(3), item(1), item(2)])
    const section = one(root, "section")
    const heading = one(section, "h2.sec-h")
    assert.equal(text(heading), "อ่านต่อจากที่ค้างไว้")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
    assert.deepEqual(
      all(section, "a.rcard").map((card) => card.attrs.href),
      ["/novel/3/12", "/novel/1/12", "/novel/2/12"],
    )
  })

  test("การ์ด: ชื่อเรื่อง · ตอนที่อ่านถึงและเปอร์เซ็นต์ · ข้อความปุ่ม", () => {
    const card = one(row([item(7, { chapter: 31, percent: 72, label: "อ่านต่อ ตอนที่ 32" })]), "a.rcard")
    assert.equal(text(one(card, "h3")), "นิยาย 7")
    assert.equal(text(one(card, ".rcard-meta")), "ตอนที่ 31 · อ่านแล้ว 72%")
    assert.equal(text(one(card, ".go")).trim(), "อ่านต่อ ตอนที่ 32")
  })

  test("ไม่มีชื่อไทย → ใช้ชื่อต้นฉบับ", () => {
    assert.equal(text(one(row([item(7, {}, { titleTh: "" })]), "h3")), "Novel 7")
  })

  test("แถบความคืบหน้าบอกโปรแกรมอ่านหน้าจอได้ (progressbar 0–100) และความกว้างตามเปอร์เซ็นต์", () => {
    const bar = one(row([item(7, { percent: 40 })]), ".bar")
    assert.equal(bar.attrs.role, "progressbar")
    assert.equal(bar.attrs["aria-valuemin"], "0")
    assert.equal(bar.attrs["aria-valuemax"], "100")
    assert.equal(bar.attrs["aria-valuenow"], "40")
    assert.equal(bar.attrs["aria-label"], "ความคืบหน้าการอ่าน")
    assert.match(one(bar, "i").attrs.style, /width:\s*40%/)
    assert.match(one(one(row([item(7, { percent: 0 })]), ".bar"), "i").attrs.style, /width:\s*0%/)
    assert.match(one(one(row([item(7, { percent: 100 })]), ".bar"), "i").attrs.style, /width:\s*100%/)
  })

  test("ปกเล็กในการ์ดเป็นภาพประดับ (ชื่อเรื่องอยู่ข้างๆ แล้ว); มีรูปปกใช้รูปจากเซิร์ฟเวอร์", () => {
    const withCover = one(row([item(7, {}, { hasCover: true, coverV: 3 })]), ".rcard-th")
    assert.equal(one(withCover, "img").attrs.src, "/covers/7?v=3")
    assert.equal(one(withCover, "img").attrs.alt, "")
    const bare = one(row([item(7)]), ".rcard-th")
    assert.equal(one(bare, ".cv").attrs["aria-hidden"], "true")
  })

  test("ไอคอนลูกศรของปุ่มเป็นภาพประดับ", () => {
    assert.equal(one(one(row([item(7)]), ".go"), "svg").attrs["aria-hidden"], "true")
  })

  test("ชื่อที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const root = row([item(7, {}, { titleTh: "<b>x</b>" })])
    assert.equal(all(root, "b").length, 0)
    assert.equal(text(one(root, "h3")), "<b>x</b>")
  })
})
