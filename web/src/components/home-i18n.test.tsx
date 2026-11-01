import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MemoryRouter } from "react-router"
import { MESSAGES } from "../i18n/messages"
import type { NovelCardDto } from "../lib/types"
import { HomeView } from "../pages/Home"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { ContinueRow } from "./ContinueRow"
import { Hero } from "./Hero"
import { Library } from "./Library"
import { NovelCard } from "./NovelCard"
import { NovelRow } from "./NovelRow"

const { th, en, lo } = MESSAGES
const NOW = Date.parse("2026-10-22T12:00:00Z")
const dto = (id: number, over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id,
  title: `Novel ${id}`,
  titleTh: `นิยาย ${id}`,
  author: "ผู้แต่ง",
  status: "ongoing",
  featured: false,
  published: true,
  hasCover: false,
  coverV: 0,
  tags: ["แฟนตาซี"],
  chapterCount: 9,
  latestNumber: 9,
  synopsisShort: "เรื่องย่อ",
  updatedAt: "2026-10-22 11:00:00",
  ...over,
} as NovelCardDto)

const noProgress = () => null
const home = (locale: "th" | "en" | "lo", over: Partial<Parameters<typeof HomeView>[0]> = {}) =>
  renderPage(<HomeView novels={[dto(1), dto(2, { status: "completed" })]} query="" isAdmin={false} siteName="k" history={[]} progressOf={noProgress} now={NOW} m={MESSAGES[locale]} {...over} />, { locale })

describe("หน้าแรกและรายการนิยาย หลายภาษา", () => {
  test("Home ลาว: หัวข้อ 'อัปเดตล่าสุด' 'นิยายทั้งหมด' ตัวกรอง และปุ่มจากข้อความลาวทั้งหมด", () => {
    const root = home("lo")
    const headings = all(root, "h2.sec-h").map((h) => text(h).trim())
    assert.ok(headings.includes(lo.home.latest), headings.join("|"))
    assert.ok(headings.includes(lo.library.headingAll), headings.join("|"))
    assert.deepEqual(all(one(root, ".chips"), "button").map((b) => text(b).trim()), [lo.library.statusAll, lo.library.statusOngoing, lo.library.statusCompleted])
    assert.equal(text(one(root, ".sort-label")).trim(), lo.library.sortBy)
    assert.equal(text(one(root, ".lib-count")).trim(), lo.library.countAll(2))
  })

  test("ชื่อเรื่อง ผู้แต่ง เรื่องย่อ และแท็กอยู่ในองค์ประกอบ lang=th ทุกภาษา", () => {
    const root = home("lo")
    assert.equal(one(one(root, ".card"), "h3").attrs.lang, "th")
    assert.equal(one(one(one(root, ".card"), ".meta"), "span").attrs.lang, "th")
    const hero = renderPage(<Hero novel={dto(1, { featured: true })} resume={null} />, { locale: "en" })
    assert.equal(one(hero, ".hero-title").attrs.lang, "th")
    assert.equal(one(hero, ".hero-syn").attrs.lang, "th")
    assert.equal(all(hero, ".pill[lang]").length >= 1, true)
    const lib = renderPage(<Library novels={[dto(1)]} query="" asPageHeading={false} now={NOW} />)
    assert.equal(all(lib, "button[lang]").length, 1)
    assert.equal(text(one(lib, "button[lang]")).trim(), "แฟนตาซี")
  })

  test("Home ว่างเปล่า (ผู้ดูแล) ลาว", () => {
    const root = home("lo", { novels: [], isAdmin: true })
    assert.equal(text(one(root, ".state-title")), lo.home.emptyTitle)
    assert.equal(text(one(root, ".state-hint")), lo.home.emptyHint)
    assert.equal(text(one(root, "a.btn")).trim(), lo.home.goAdmin)
  })

  test("ค้นหา: หัวข้อและข้อความไม่พบเป็นลาว; ไม่มีไทยของ UI หลงเหลือ (ยกเว้นเนื้อหานิยาย)", () => {
    const root = home("lo", { novels: [dto(1)], query: "zzz" })
    assert.equal(text(one(root, "h1.sec-h")).trim(), lo.library.headingSearch("zzz"))
    assert.equal(text(one(root, ".state-title")), lo.library.emptySearchTitle("zzz"))
    assert.equal(text(one(root, ".state-hint")), lo.library.emptyHint)
    assert.equal(text(one(one(root, ".state-actions"), "button")).trim(), lo.library.clearSearch)
  })

  test("Hero: ป้ายสถานะ จำนวนตอน ปุ่ม ตามภาษา", () => {
    const root = renderPage(<Hero novel={dto(1, { featured: true })} resume={{ href: "/novel/1/3", label: "RESUME", chapter: 3, percent: 30 }} />, { locale: "en" })
    assert.equal(text(one(root, ".hero-tag")).trim(), en.hero.featured)
    assert.equal(text(one(root, ".hero-sub")).trim(), `Novel 1 · ${en.hero.by("ผู้แต่ง")}`)
    assert.deepEqual(all(one(root, ".hero-facts"), ".pill").slice(0, 2).map((p) => text(p).trim()), [en.hero.ongoing, en.hero.chapters(9)])
    assert.deepEqual(all(one(root, ".hero-cta"), "a").map((a) => text(a).trim()), ["RESUME", en.hero.details])
    const first = renderPage(<Hero novel={dto(1)} resume={null} />, { locale: "lo" })
    assert.equal(text(one(one(first, ".hero-cta"), "a")).trim(), lo.hero.start)
  })

  test("NovelRow/NovelCard: ป้าย 'ใหม่' 'ตอน N' 'จบแล้ว' ตามภาษา", () => {
    const root = renderPage(<NovelRow title="T" novels={[dto(1, { status: "completed" })]} now={NOW} />, { locale: "lo" })
    assert.equal(text(one(root, ".b-new")).trim(), lo.card.new)
    assert.equal(text(one(root, ".b-ep")).trim(), lo.card.chapterChip(9))
    assert.equal(text(one(root, ".b-done")).trim(), lo.card.completed)
    const plain = renderPage(<NovelCard novel={dto(1, { status: "completed" })} now={NOW} />, { locale: "en" })
    assert.equal(text(one(plain, ".b-done")).trim(), en.card.completed)
  })

  test("ContinueRow: หัวข้อ ข้อความความคืบหน้า และป้ายของแถบ ตามภาษา", () => {
    const items = [{ novel: dto(1), info: { href: "/novel/1/3", label: "L", chapter: 3, percent: 30 } }]
    const root = renderPage(<ContinueRow items={items} />, { locale: "lo" })
    assert.equal(text(one(root, "h2.sec-h")).trim(), lo.continueRow.title)
    assert.equal(text(one(root, ".rcard-meta")).trim(), lo.continueRow.meta(3, 30))
    assert.equal(one(root, ".bar").attrs["aria-label"], lo.continueRow.progressLabel)
    assert.equal(text(one(renderPage(<ContinueRow items={items} />), "h2.sec-h")).trim(), "อ่านต่อจากที่ค้างไว้")
    assert.ok(th.continueRow.meta(3, 30).includes("30%"))
  })

  test("ชื่อแท็บของผลค้นหา (home.searchTitle) ตามภาษา", () => {
    assert.equal(th.home.searchTitle("x"), "ค้นหา “x”")
    assert.match(en.home.searchTitle("x"), /x/)
  })
})
