import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { MESSAGES } from "../i18n/messages"
import type { ChapterPageDto } from "../lib/types"
import { About } from "../pages/About"
import { Contact } from "../pages/Contact"
import { ReaderBodyView, ReaderContent, ReaderNavView } from "../pages/Reader"
import { all, one, text } from "../testing/dom"
import { restoreGlobals } from "../testing/helpers"
import { loadedSite, renderPage } from "../testing/render"
import { ReaderBar, type ReaderBarProps } from "./ReaderBar"
import { ReaderSettingsView, type ReaderSettingsViewProps } from "./ReaderSettings"

afterEach(restoreGlobals)

const { th, en, lo } = MESSAGES
const noop = () => {}
const THAI = /[฀-๿]/

const bar = (over: Partial<ReaderBarProps> = {}) =>
  renderPage(
    <ReaderBar novelId={7} novelTitle="T" number={12} visible pct={40} listenAvailable speechState="idle" rate={1} settingsOpen={false} settingsId="rs" onToggleSettings={noop} onListen={noop} onStop={noop} onPause={noop} onResume={noop} onPrev={noop} onNext={noop} onRate={noop} {...over} />,
  )
const settings = (over: Partial<ReaderSettingsViewProps> = {}) =>
  renderPage(<ReaderSettingsView id="rs" theme="midnight" fontSize={18} font="sarabun" voiceMissing={false} onTheme={noop} onFontSize={noop} onFont={noop} onClose={noop} {...over} />)

describe("หน้าอ่านหลายภาษา", () => {
  test("ReaderBar ลาว: ป้ายปุ่ม ความคืบหน้า และแถวควบคุมเสียงเป็นลาว ไม่มีไทย", () => {
    const m = lo
    const root = bar({ m, speechState: "playing" })
    assert.equal(one(root, ".rb-progress").attrs["aria-label"], m.reader.bar.progress)
    assert.equal(text(one(root, ".rb-chapter")).trim(), m.reader.bar.chapter(12))
    const labels = all(root, "[aria-label]").map((el) => el.attrs["aria-label"])
    for (const expected of [m.reader.bar.back, m.reader.bar.toc, m.reader.bar.stopListen, m.reader.bar.settings, m.reader.bar.player, m.reader.bar.prevPara, m.reader.bar.pause, m.reader.bar.nextPara]) {
      assert.ok(labels.includes(expected), expected)
    }
    assert.equal(text(one(root, ".rb-rate-label")).trim(), m.reader.bar.speed)
    assert.equal(one(root, "input.rb-range").attrs["aria-valuetext"], m.reader.bar.rateValue(1))
    assert.doesNotMatch(labels.join("|") + text(root), THAI)
  })

  test("ReaderBar อังกฤษ (หยุดชั่วคราว → ปุ่มเล่นต่อ) และไทยเป็นค่าเริ่มต้น", () => {
    assert.ok(all(bar({ m: en, speechState: "paused" }), "button").some((b) => b.attrs["aria-label"] === en.reader.bar.resume))
    assert.equal(one(bar(), ".rb-chapter").children.length > 0, true)
    assert.equal(text(one(bar(), ".rb-chapter")).trim(), "ตอนที่ 12")
  })

  test("ReaderSettingsView ลาว: ชื่อแผง ธีม ขนาด ฟอนต์ ปุ่มปิด และคำอธิบายเสียงไทย", () => {
    const root = settings({ m: lo, voiceMissing: true })
    assert.equal(one(root, "section.rs").attrs["aria-label"], lo.settings.title)
    assert.equal(text(one(root, "h2.rs-title")).trim(), lo.settings.title)
    assert.deepEqual(all(root, ".rs-label").map((l) => text(l).trim()), [lo.settings.theme, lo.settings.fontSize, lo.settings.font])
    assert.deepEqual(all(root, "button.rs-theme").map((b) => text(b).trim()), ["midnight", "paper", "sepia", "black"].map((t) => lo.theme.labels[t as "midnight"]))
    assert.equal(one(root, "input.rs-range").attrs["aria-valuetext"], lo.settings.sizeValue(18))
    assert.equal(text(one(root, ".rs-note")).trim(), lo.settings.voiceMissing)
    assert.equal(text(one(root, ".rs-size-small")).trim(), lo.settings.sizeGlyph)
    assert.doesNotMatch(text(root) + all(root, "[aria-label]").map((e) => e.attrs["aria-label"]).join(), THAI)
    assert.equal(text(one(settings(), "h2.rs-title")).trim(), "ตั้งค่าการอ่าน")
  })

  test("ReaderBodyView/ReaderNavView ภายใต้ภาษา: เนื้อหาตอนเป็น lang=th ข้อความอื่นตามภาษา", () => {
    const body = renderPage(<ReaderBodyView heading="H" draft={false} paragraphs={[]} activeIndex={null} fontSize={18} font="sarabun" m={lo} />, { locale: "lo" })
    assert.equal(one(body, ".rd-text").attrs.lang, "th")
    assert.equal(text(one(body, ".rd-empty")).trim(), lo.reader.empty)
    const nav = renderPage(<ReaderNavView novelId={7} prev={2} next={null} />, { locale: "lo" })
    assert.equal(one(nav, "nav").attrs["aria-label"], lo.reader.navLabel)
    assert.deepEqual([text(one(nav, "a.rd-prev")).trim(), text(one(nav, "a.rd-toc")).trim(), text(one(nav, "span.rd-next")).trim()], [lo.reader.prev, lo.reader.toc, lo.reader.noNext])
    const first = renderPage(<ReaderNavView novelId={7} prev={null} next={4} />, { locale: "en" })
    assert.deepEqual([text(one(first, "span.rd-prev")).trim(), text(one(first, "a.rd-next")).trim()], [en.reader.noPrev, en.reader.next])
  })

  test("ReaderContent ลาว: หัวตอน ชื่อแท็บ (ผ่าน h1) และแถบ/ปุ่มตอนเป็นลาว; ข้อความตอนยังเป็นไทย lang=th", () => {
    const page: ChapterPageDto = {
      novel: { id: 7, title: "Glass Season", titleTh: "ฤดูกระจก" },
      chapter: { number: 3, title: "The Door", titleTh: "ประตู", text: "ย่อหน้าแรก\n\nย่อหน้าสอง", published: true },
      prev: 2,
      next: 4,
    }
    const root = renderPage(<ReaderContent id={7} number={3} data={page} error={null} onRetry={noop} />, { path: "/novel/7/3", locale: "lo" })
    assert.equal(text(one(root, "h1.rd-heading")), lo.reader.headingNamed(3, "ประตู"))
    assert.equal(one(root, ".rd-text").attrs.lang, "th")
    assert.equal(text(one(root, ".rb-chapter")).trim(), lo.reader.bar.chapter(3))
    assert.equal(text(one(root, "a.rd-next")).trim(), lo.reader.next)
  })

  test("About/Contact ลาว: หัวข้อและข้อความสถานะเป็นลาว; ข้อความของเจ้าของเป็น lang=th", () => {
    const a = renderPage(<About />, { path: "/about", state: loadedSite({ aboutText: "ข้อความของเจ้าของ" }), locale: "lo" })
    assert.equal(text(one(a, "h1")), lo.about.aboutTitle)
    assert.equal(one(a, "p.prose-text").attrs.lang, "th")
    const empty = renderPage(<About />, { path: "/about", state: loadedSite({ aboutText: "" }), locale: "lo" })
    assert.equal(text(one(empty, "h2.state-title")), lo.about.aboutEmptyTitle)
    assert.equal(text(one(empty, ".state-hint")), lo.about.aboutEmptyHint)
    const c = renderPage(<Contact />, { path: "/contact", state: loadedSite({ contactText: "" }), locale: "en" })
    assert.equal(text(one(c, "h1")), en.about.contactTitle)
    assert.equal(text(one(c, "h2.state-title")), en.about.contactEmptyTitle)
    assert.equal(text(one(c, ".state-hint")), en.about.contactEmptyHint)
    assert.equal(th.about.contactTitle, "ติดต่อ / แจ้งลบเนื้อหา")
  })
})
