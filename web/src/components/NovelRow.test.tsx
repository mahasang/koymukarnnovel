import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { NovelCardDto } from "../lib/types"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { NovelRow } from "./NovelRow"

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
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
  chapterCount: 87,
  latestNumber: 87,
  updatedAt: "2026-10-22 09:00:00",
  published: true,
  ...over,
})
const row = (novels: NovelCardDto[]) => renderPage(<NovelRow title="อัปเดตล่าสุด" novels={novels} now={NOW} />)

describe("NovelRow (อัปเดตล่าสุด)", () => {
  test("ไม่มีเรื่อง → ไม่แสดงอะไรเลย", () => {
    assert.equal(all(row([]), "section").length, 0)
  })

  test("ส่วนที่ชื่อตามหัวข้อ มีการ์ดเรียงตามลำดับที่ให้มาในแถวเดียว", () => {
    const root = row([dto(3), dto(1), dto(2)])
    const section = one(root, "section")
    const heading = one(section, "h2.sec-h")
    assert.equal(text(heading), "อัปเดตล่าสุด")
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
    assert.deepEqual(
      all(one(section, ".row"), "a.card").map((card) => card.attrs.href),
      ["/novel/3", "/novel/1", "/novel/2"],
    )
  })

  test("ป้าย 'ใหม่' เมื่ออัปเดตภายใน 3 วัน (นับจากเวลาที่ส่งมา); เกินแล้วไม่มี", () => {
    const root = row([dto(1, { updatedAt: "2026-10-22 09:00:00" }), dto(2, { updatedAt: "2026-10-19 12:00:00" }), dto(3, { updatedAt: "2026-10-19 11:59:59" })])
    const badges = all(root, "a.card").map((card) => all(card, ".b-new").map((el) => text(el)))
    assert.deepEqual(badges, [["ใหม่"], ["ใหม่"], []])
  })

  test("ชิป 'ตอน N' ตามตอนล่าสุด (ตอนที่ 0 ก็แสดง); ยังไม่มีตอนเลย → ไม่มีชิป", () => {
    const root = row([dto(1, { latestNumber: 87 }), dto(2, { latestNumber: 0 }), dto(3, { latestNumber: null })])
    const chips = all(root, "a.card").map((card) => all(card, ".b-ep").map((el) => text(el)))
    assert.deepEqual(chips, [["ตอน 87"], ["ตอน 0"], []])
  })

  test("เวลาในการ์ดคิดจากเวลาที่ส่งมา", () => {
    const meta = all(one(row([dto(1)]), "a.card"), ".meta").map((el) => text(el).trim())
    assert.ok(meta.includes("3 ชั่วโมงที่แล้ว"), JSON.stringify(meta))
  })
})
