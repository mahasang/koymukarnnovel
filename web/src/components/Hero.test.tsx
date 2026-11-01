import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ResumeInfo } from "../lib/library"
import type { NovelCardDto } from "../lib/types"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { MESSAGES } from "../i18n/messages"

const DRAFT_LABEL = MESSAGES.th.draft.label
import { Hero } from "./Hero"

const dto = (over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id: 12,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Elmer Quill",
  synopsisShort: "ทุกดวงไฟของโลกดับลงในคืนเดียว",
  tags: ["แฟนตาซี", "ผจญภัย", "มืดหม่น", "ตะวันออก"],
  status: "ongoing",
  featured: true,
  hasCover: false,
  coverV: 0,
  chapterCount: 87,
  latestNumber: 87,
  updatedAt: "2026-10-22 09:00:00",
  published: true,
  ...over,
})
const resume = (over: Partial<ResumeInfo> = {}): ResumeInfo => ({ href: "/novel/12/5", label: "อ่านต่อ ตอนที่ 5", chapter: 5, percent: 6, ...over })
const hero = (novel: NovelCardDto, info: ResumeInfo | null = null) => one(renderPage(<Hero novel={novel} resume={info} />), "section.hero")

describe("Hero", () => {
  test("เป็นส่วนของหน้า (section) ที่ชื่อโดยหัวเรื่องของตัวเอง; หัวเรื่องคือชื่อที่แสดง (ไทยก่อน)", () => {
    const section = hero(dto())
    const heading = one(section, "h2.hero-title")
    assert.equal(text(heading), "ตะเกียงดวงสุดท้าย")
    assert.ok(heading.attrs.id)
    assert.equal(section.attrs["aria-labelledby"], heading.attrs.id)
    assert.equal(text(one(hero(dto({ titleTh: "" })), "h2.hero-title")), "The Last Lantern")
  })

  test("บรรทัดรอง: ชื่อต้นฉบับ · โดยผู้แต่ง — ไม่มีชื่อไทย (ชื่อต้นฉบับเป็นหัวเรื่องแล้ว) แสดงเฉพาะผู้แต่ง", () => {
    assert.equal(text(one(hero(dto()), ".hero-sub")), "The Last Lantern · โดย Elmer Quill")
    assert.equal(text(one(hero(dto({ titleTh: "" })), ".hero-sub")), "โดย Elmer Quill")
    assert.equal(text(one(hero(dto({ author: "  " })), ".hero-sub")), "The Last Lantern")
    assert.equal(all(hero(dto({ titleTh: "", author: "" })), ".hero-sub").length, 0)
  })

  test("ชื่อไทยที่มีแต่ช่องว่างนับว่าไม่มี: ใช้ชื่อต้นฉบับเป็นหัวเรื่อง และไม่ซ้ำชื่อเดิมอีกในบรรทัดรอง", () => {
    const section = hero(dto({ titleTh: "   " }))
    assert.equal(text(one(section, "h2.hero-title")), "The Last Lantern")
    assert.equal(text(one(section, ".hero-sub")), "โดย Elmer Quill")
  })

  test("ป้ายหัวการ์ด: เรื่องแนะนำ → 'เรื่องแนะนำ'; ไม่ใช่เรื่องแนะนำ (เลือกเพราะอัปเดตล่าสุด) → 'อัปเดตล่าสุด'", () => {
    assert.equal(text(one(hero(dto({ featured: true })), ".hero-tag")).trim(), "เรื่องแนะนำ")
    assert.equal(text(one(hero(dto({ featured: false })), ".hero-tag")).trim(), "อัปเดตล่าสุด")
    assert.equal(one(one(hero(dto()), ".hero-tag"), "svg").attrs["aria-hidden"], "true")
  })

  test("ข้อมูลสั้น: สถานะ (ยังไม่จบ ไฮไลต์ / จบแล้ว) จำนวนตอน และแท็กไม่เกิน 3 อัน", () => {
    const pills = (novel: NovelCardDto) => all(one(hero(novel), ".hero-facts"), ".pill").map((pill) => text(pill).trim())
    assert.deepEqual(pills(dto()), ["ยังไม่จบ", "87 ตอน", "แฟนตาซี", "ผจญภัย", "มืดหม่น"])
    assert.deepEqual(pills(dto({ status: "completed", tags: [] })), ["จบแล้ว", "87 ตอน"])
    assert.deepEqual(pills(dto({ chapterCount: 1, tags: [] })), ["ยังไม่จบ", "1 ตอน"]) // มีตอนเดียวก็ต้องบอก
    assert.equal(text(one(hero(dto()), ".pill.st")).trim(), "ยังไม่จบ")
    assert.equal(all(hero(dto({ status: "completed" })), ".pill.st").length, 0)
  })

  test("ยังไม่มีตอนเลย (chapterCount 0) → ไม่แสดง '0 ตอน'", () => {
    assert.ok(!all(hero(dto({ chapterCount: 0, latestNumber: null })), ".pill").some((pill) => text(pill).includes("ตอน")))
  })

  test("เรื่องย่อสั้น: แสดงเมื่อมี (CSS ตัดที่ 3 บรรทัด) ไม่มี → ไม่มีย่อหน้าว่าง", () => {
    assert.equal(text(one(hero(dto()), "p.hero-syn")), "ทุกดวงไฟของโลกดับลงในคืนเดียว")
    assert.equal(all(hero(dto({ synopsisShort: "" })), "p.hero-syn").length, 0)
    assert.equal(all(hero(dto({ synopsisShort: "   " })), "p.hero-syn").length, 0)
  })

  test("ยังไม่เคยอ่าน: ปุ่มหลัก 'เริ่มอ่าน' ไปหน้าเรื่อง และไม่มีปุ่มรายละเอียดซ้ำ (ปลายทางเดียวกัน)", () => {
    const section = hero(dto())
    const primary = one(section, "a.btn.primary")
    assert.equal(text(primary).trim(), "เริ่มอ่าน")
    assert.equal(primary.attrs.href, "/novel/12")
    assert.equal(all(section, "a.btn.ghost").length, 0)
  })

  test("เคยอ่านแล้ว: ปุ่มหลักตามข้อมูลอ่านต่อ (ตอนที่ค้างไว้) และมีปุ่ม 'รายละเอียด' ไปหน้าเรื่อง", () => {
    const section = hero(dto(), resume())
    const primary = one(section, "a.btn.primary")
    assert.equal(text(primary).trim(), "อ่านต่อ ตอนที่ 5")
    assert.equal(primary.attrs.href, "/novel/12/5")
    const ghost = one(section, "a.btn.ghost")
    assert.equal(text(ghost).trim(), "รายละเอียด")
    assert.equal(ghost.attrs.href, "/novel/12")
  })

  test("เคยอ่านแล้วแต่ปลายทางคือหน้าเรื่อง (มีตอนใหม่ / อ่านทันแล้ว) → ปุ่มเดียว ไม่ซ้ำ", () => {
    const section = hero(dto(), resume({ href: "/novel/12", label: "มีตอนใหม่" }))
    assert.equal(text(one(section, "a.btn.primary")).trim(), "มีตอนใหม่")
    assert.equal(one(section, "a.btn.primary").attrs.href, "/novel/12")
    assert.equal(all(section, "a.btn.ghost").length, 0)
  })

  test("ไอคอนในปุ่มหลักเป็นภาพประดับ", () => {
    assert.equal(one(one(hero(dto()), "a.btn.primary"), "svg").attrs["aria-hidden"], "true")
  })

  test("ปก: โปสเตอร์ด้านข้างและพื้นหลังเบลอใช้ปกเรื่องเดียวกัน (ภาพประดับ ไม่อ่านชื่อซ้ำ)", () => {
    const section = hero(dto({ hasCover: true, coverV: 7 }))
    assert.equal(one(one(section, ".poster"), "img").attrs.src, "/covers/12?v=7")
    assert.equal(one(one(section, ".hero-bg"), "img").attrs.src, "/covers/12?v=7")
    for (const img of all(section, "img")) assert.equal(img.attrs.alt, "")
    assert.equal(one(section, ".hero-bg").attrs["aria-hidden"], "true")
    assert.equal(one(section, ".hero-shade").attrs["aria-hidden"], "true")
  })

  test("ไม่มีรูปปก → ใช้ปกอัตโนมัติ (เขียนชื่อที่แสดง) ทั้งโปสเตอร์และพื้นหลัง", () => {
    const section = hero(dto({ hasCover: false }))
    assert.equal(all(section, "img").length, 0)
    assert.equal(text(one(one(section, ".poster"), ".cv-title")), "ตะเกียงดวงสุดท้าย")
    assert.equal(text(one(one(section, ".hero-bg"), ".cv-title")), "ตะเกียงดวงสุดท้าย")
  })

  test("เรื่องที่ยังไม่เผยแพร่ (ผู้ดูแลเห็น) มีป้ายร่างเต็ม; เผยแพร่แล้วไม่มี", () => {
    assert.equal(text(one(hero(dto({ published: false })), ".draft")), DRAFT_LABEL)
    assert.equal(all(hero(dto({ published: true })), ".draft").length, 0)
  })

  test("ข้อความที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const section = hero(dto({ titleTh: "<b>x</b>", author: "<i>a</i>", synopsisShort: "<u>s</u>", tags: ["<s>t</s>"] }))
    for (const tag of ["b", "i", "u", "s"]) assert.equal(all(section, tag).length, 0, tag)
    assert.equal(text(one(section, "h2.hero-title")), "<b>x</b>")
  })
})
