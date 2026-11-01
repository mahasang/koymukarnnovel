import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { NovelCardDto } from "../lib/types"
import { all, one, text, type El } from "../testing/dom"
import { renderPage } from "../testing/render"
import { DRAFT_LABEL } from "./DraftBadge"
import { NovelCard } from "./NovelCard"

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0) // 22 ต.ค. 2026 12:00 UTC

const dto = (over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id: 12,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Elmer Quill",
  synopsisShort: "…",
  tags: ["แฟนตาซี"],
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
const card = (novel: NovelCardDto, props: { badge?: string | null; chip?: string | null } = {}) =>
  one(renderPage(<NovelCard novel={novel} now={NOW} {...props} />), "a.card")

describe("NovelCard", () => {
  test("ลิงก์ไปหน้านิยาย /novel/<id> ทั้งใบ", () => {
    assert.equal(card(dto({ id: 12 })).attrs.href, "/novel/12")
    assert.equal(card(dto({ id: 3 })).attrs.href, "/novel/3")
  })

  test("หัวข้อเป็นชื่อไทย; ยังไม่มีชื่อไทยใช้ชื่อต้นฉบับ", () => {
    assert.equal(text(one(card(dto()), "h3")), "ตะเกียงดวงสุดท้าย")
    assert.equal(text(one(card(dto({ titleTh: "" })), "h3")), "The Last Lantern")
  })

  test("มีรูปปก → รูปจาก /covers/<id>?v=; ไม่มี → ปกอัตโนมัติที่เขียนชื่อเรื่องที่แสดง", () => {
    const withCover = card(dto({ hasCover: true, coverV: 5 }))
    assert.equal(one(withCover, "img").attrs.src, "/covers/12?v=5")
    const bare = card(dto({ hasCover: false }))
    assert.equal(all(bare, "img").length, 0)
    assert.equal(text(one(bare, ".cv-title")), "ตะเกียงดวงสุดท้าย")
    assert.equal(text(one(card(dto({ hasCover: false, titleTh: "" })), ".cv-title")), "The Last Lantern")
  })

  test("ปกเป็นภาพประดับในการ์ด (ไม่อ่านชื่อซ้ำ)", () => {
    assert.equal(one(card(dto({ hasCover: true })), "img").attrs.alt, "")
    assert.equal(one(card(dto({ hasCover: false })), ".cv").attrs["aria-hidden"], "true")
  })

  test("ป้ายมุมซ้ายบน (badge) และชิปมุมขวาบน (chip) แสดงเมื่อผู้เรียกส่งมาเท่านั้น", () => {
    const plain = card(dto())
    assert.equal(all(plain, ".b-new").length, 0)
    assert.equal(all(plain, ".b-ep").length, 0)
    const decorated = card(dto(), { badge: "ใหม่", chip: "ตอน 87" })
    assert.equal(text(one(decorated, ".b-new")), "ใหม่")
    assert.equal(text(one(decorated, ".b-ep")), "ตอน 87")
  })

  test("ป้ายบนกับชิปอยู่ในแถบ .b-top เดียวกันเรียงซ้าย→ขวา (CSS ห่อบรรทัดเมื่อปกแคบ ไม่ทับกัน); ไม่มีทั้งคู่ → ไม่มีแถบ", () => {
    const classes = (el: El) => el.children.filter((child): child is El => typeof child !== "string").map((child) => child.attrs.class)
    assert.deepEqual(classes(one(card(dto(), { badge: "ใหม่", chip: "ตอน 87" }), ".b-top")), ["b-new", "b-ep"])
    assert.deepEqual(classes(one(card(dto(), { chip: "ตอน 87" }), ".b-top")), ["b-ep"])
    assert.deepEqual(classes(one(card(dto(), { badge: "ใหม่" }), ".b-top")), ["b-new"])
    assert.equal(all(card(dto()), ".b-top").length, 0)
    assert.equal(all(card(dto(), { badge: "", chip: null }), ".b-top").length, 0)
  })

  test("ป้ายมุมล่าง (จบแล้ว/ร่าง) อยู่นอกแถบ .b-top", () => {
    const c = card(dto({ status: "completed", published: false }), { badge: "ใหม่", chip: "ตอน 1" })
    const top = one(c, ".b-top")
    assert.equal(all(top, ".b-done").length, 0)
    assert.equal(all(top, ".b-draft").length, 0)
  })

  test("badge/chip ว่าง หรือ null ไม่แสดง", () => {
    for (const empty of [null, undefined, ""]) {
      const c = card(dto(), { badge: empty, chip: empty })
      assert.equal(all(c, ".b-new").length, 0, JSON.stringify(empty))
      assert.equal(all(c, ".b-ep").length, 0, JSON.stringify(empty))
    }
  })

  test("เรื่องที่จบแล้วมีป้าย 'จบแล้ว' มุมซ้ายล่าง; กำลังอัปเดตไม่มี", () => {
    assert.equal(text(one(card(dto({ status: "completed" })), ".b-done")), "จบแล้ว")
    assert.equal(all(card(dto({ status: "ongoing" })), ".b-done").length, 0)
  })

  test("เรื่องที่ยังไม่เผยแพร่ (ผู้ดูแลเห็น) มีป้ายร่างแบบย่อ; เรื่องที่เผยแพร่แล้วไม่มี", () => {
    const draft = one(card(dto({ published: false })), ".b-draft")
    assert.equal(text(one(draft, ".sr-only")), DRAFT_LABEL)
    assert.equal(all(card(dto({ published: true })), ".b-draft").length, 0)
  })

  test("ผู้แต่งและเวลาที่ผ่านมา (นับจากเวลาอัปเดต) ใต้ชื่อเรื่อง", () => {
    const metas = all(card(dto()), ".meta").map((m) => text(m).trim())
    assert.deepEqual(metas, ["Elmer Quill", "3 ชั่วโมงที่แล้ว"])
  })

  test("ไม่มีชื่อผู้แต่ง → ไม่แสดงบรรทัดผู้แต่ง แต่ยังแสดงเวลา", () => {
    const metas = all(card(dto({ author: "" })), ".meta").map((m) => text(m).trim())
    assert.deepEqual(metas, ["3 ชั่วโมงที่แล้ว"])
    assert.deepEqual(all(card(dto({ author: "   " })), ".meta").map((m) => text(m).trim()), ["3 ชั่วโมงที่แล้ว"])
  })

  test("เวลาอัปเดตที่อ่านไม่ได้ → ไม่แสดงบรรทัดเวลา (ไม่แสดงข้อความมั่ว)", () => {
    const metas = all(card(dto({ updatedAt: "not a date" })), ".meta").map((m) => text(m).trim())
    assert.deepEqual(metas, ["Elmer Quill"])
  })

  test("บรรทัดผู้แต่ง/เวลามีไอคอนประดับนำหน้า (ซ่อนจากโปรแกรมอ่านหน้าจอ) ขนาด 13px", () => {
    for (const meta of all(card(dto()), ".meta")) {
      const icon = one(meta, "svg")
      assert.equal(icon.attrs["aria-hidden"], "true")
      assert.equal(icon.attrs.width, "13")
      assert.equal(icon.attrs.height, "13")
    }
  })

  test("กรอบปก (คลาส box) ครอบปกและป้ายทั้งหมด — CSS ใช้คลาสนี้ตัดมุม/วางป้าย", () => {
    const box = one(card(dto({ status: "completed", published: false })), "div.box")
    one(box, ".cv")
    one(box, ".b-done")
    one(box, ".b-draft")
  })

  test("ชื่อที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const c = card(dto({ titleTh: "<b>x</b> & y", author: "<i>a</i>" }))
    assert.equal(all(c, "b").length, 0)
    assert.equal(all(c, "i").length, 0)
    assert.equal(text(one(c, "h3")), "<b>x</b> & y")
  })

  test("ไม่ส่ง now → ใช้เวลาปัจจุบัน (เรื่องที่เพิ่งอัปเดตเมื่อสักครู่)", () => {
    const sql = new Date().toISOString().slice(0, 19).replace("T", " ")
    const c = one(renderPage(<NovelCard novel={dto({ updatedAt: sql })} />), "a.card")
    assert.deepEqual(all(c, ".meta").map((m) => text(m).trim()), ["Elmer Quill", "เมื่อสักครู่"])
  })
})
