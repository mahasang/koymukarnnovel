import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MESSAGES } from "../i18n/messages"
import type { ChapterItemDto, NovelDetailDto } from "../lib/types"
import { NovelView } from "../pages/Novel"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { CreditBox } from "./CreditBox"
import { DraftBadge } from "./DraftBadge"
import { SynopsisView } from "./Synopsis"
import { ChapterListView } from "./ChapterList"

const { th, en, lo } = MESSAGES
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const chapter = (number: number, over: Partial<ChapterItemDto> = {}): ChapterItemDto => ({
  number,
  title: `Chapter ${number}`,
  titleTh: `ตอน ${number}`,
  publishedAt: "2026-10-21 09:00:00",
  published: true,
  ...over,
})
const detail = (over: Partial<NovelDetailDto> = {}): NovelDetailDto =>
  ({
    id: 7,
    title: "The Last Lantern",
    titleTh: "ตะเกียงดวงสุดท้าย",
    author: "Elmer Quill",
    synopsis: "เรื่องย่อของนิยาย",
    synopsisShort: "สั้นๆ",
    tags: ["แฟนตาซี"],
    status: "ongoing",
    featured: false,
    hasCover: false,
    coverV: 0,
    chapterCount: 3,
    latestNumber: 3,
    updatedAt: "2026-10-21 09:00:00",
    published: true,
    sourceUrl: "https://example.com/novel",
    licenseNote: "ได้รับอนุญาตแล้ว",
    chapters: [chapter(1), chapter(2), chapter(3)],
    ...over,
  }) as NovelDetailDto

describe("หน้าเรื่องหลายภาษา", () => {
  test("NovelView ลาว: ปุ่ม ป้าย หัวข้อ และกล่องเครดิตเป็นลาว; เนื้อหานิยายกำกับ lang=th", () => {
    const root = renderPage(<NovelView novel={detail()} progress={null} now={NOW} />, { locale: "lo" })
    assert.equal(one(root, "h1.nv-title").attrs.lang, "th")
    assert.equal(text(one(root, ".nv-author")).trim(), `${lo.novel.by} Elmer Quill`)
    assert.equal(one(one(root, ".nv-author"), "span").attrs.lang, "th")
    assert.deepEqual(all(one(root, ".nv-cta"), "a").map((a) => text(a).trim().replace(/\s+/g, " ")), [lo.chapters.readStart, `${lo.novel.latest} ${lo.novel.latestSr(3)}`])
    assert.equal(one(one(root, ".nv-tags"), ".pill").attrs.lang, "th")
    const headings = all(root, "h2.nv-h").map((h) => text(h).replace(/\s*\(\d+\)\s*$/, "").trim())
    assert.deepEqual(headings, [lo.synopsis.title, lo.credit.title, lo.chapters.title])
    assert.equal(one(root, ".nv-syn").attrs.lang, "th")
    assert.equal(all(root, ".ch-title").every((el) => el.attrs.lang === "th"), true)
    assert.equal(text(one(root, ".ai-badge")).trim(), lo.credit.aiBadge)
    assert.equal(text(one(root, ".credit-report")).trim(), lo.credit.report)
    assert.equal(text(one(root, ".ch-num")).trim(), lo.chapters.chapterN(3))
  })

  test("ChapterListView (m) ลาว: ที่ว่าง ฟอร์มข้าม ตัวแบ่งหน้า ป้ายอ่านล่าสุด", () => {
    const base = { novelId: 7, state: { order: "desc" as const, page: 1, jump: null, jumps: 0 }, lastRead: 30, jumpValue: "", jumpError: null, onJumpValue: () => {}, onJumpSubmit: () => {}, dispatch: () => {}, m: lo }
    const empty = renderPage(<>{ChapterListView({ ...base, chapters: [] })}</>)
    assert.equal(text(one(empty, ".ch-empty")), lo.chapters.empty)
    assert.equal(text(one(empty, "h2.nv-h")).trim(), lo.chapters.title)
    const many = Array.from({ length: 60 }, (_, i) => chapter(i + 1))
    const root = renderPage(<>{ChapterListView({ ...base, chapters: many })}</>)
    assert.equal(one(root, ".ch-orders").attrs["aria-label"], lo.chapters.orderGroup)
    assert.equal(text(one(root, "label")).trim(), lo.chapters.jumpLabel)
    assert.equal(text(one(root, ".ch-tag")).trim(), lo.chapters.lastRead)
    assert.equal(one(root, "nav.ch-pager").attrs["aria-label"], lo.chapters.pagerLabel)
    assert.equal(text(one(root, ".ch-page")).trim(), lo.chapters.pageInfo(1, 2, "11–60"))
    assert.deepEqual(all(one(root, "nav.ch-pager"), "button").map((b) => text(b).trim()), [lo.chapters.prev, lo.chapters.next])
    assert.deepEqual(all(root, ".ch-date").map((d) => text(d)).slice(0, 1), ["21 ຕຸລາ 2026"])
  })

  test("SynopsisView (m): หัวข้อและปุ่มขยาย/ย่อตามภาษา", () => {
    const view = (expanded: boolean, m = lo) => renderPage(<>{SynopsisView({ text: "x", expanded, overflowing: true, onToggle: () => {}, m })}</>)
    assert.equal(text(one(view(false), "h2")).trim(), lo.synopsis.title)
    assert.equal(text(one(view(false), "button")).trim(), lo.synopsis.more)
    assert.equal(text(one(view(true), "button")).trim(), lo.synopsis.less)
    assert.equal(text(one(view(false, th), "button")).trim(), "อ่านเพิ่ม")
  })

  test("CreditBox: ป้ายตามภาษา; ไม่ระบุ; ลิงก์เปิดแท็บใหม่; บันทึกสิทธิ์ lang=th", () => {
    const root = renderPage(<CreditBox author="" sourceUrl="https://example.com/x" licenseNote="ใช้ได้" />, { locale: "en" })
    assert.deepEqual(all(root, "dt").map((d) => text(d).trim()), [en.credit.author, en.credit.source, en.credit.license])
    assert.equal(text(all(root, "dd")[0]!).trim(), en.credit.notSpecified)
    assert.equal(text(one(one(root, "a"), ".sr-only")).trim(), en.credit.newTab)
    assert.equal(one(root, ".credit-license").attrs.lang, "th")
  })

  test("DraftBadge: ป้ายเต็มและแบบย่อตามภาษา", () => {
    assert.equal(text(one(renderPage(<DraftBadge />, { locale: "lo" }), ".draft")).trim(), lo.draft.label)
    const compact = one(renderPage(<DraftBadge compact />, { locale: "en" }), ".draft")
    assert.equal(compact.attrs.title, en.draft.label)
    assert.equal(text(one(compact, "span[aria-hidden]")).trim(), en.draft.short)
    assert.equal(th.draft.label, "ร่าง — เห็นเฉพาะผู้ดูแล")
  })
})
