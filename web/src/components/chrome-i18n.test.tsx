import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MESSAGES } from "../i18n/messages"
import { THEMES } from "../lib/theme"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { Footer, FooterView } from "./Footer"
import { HeaderView } from "./Header"
import { SearchBoxView } from "./SearchBox"
import { ThemeMenuView } from "./ThemeMenu"

const { th, en, lo } = MESSAGES
const noop = () => {}

describe("แถบบน/ท้ายเว็บ/ค้นหา/ธีม หลายภาษา", () => {
  test("HeaderView อังกฤษ: เมนู Home/About/Contact, ป้ายเมนู, มีเมนูภาษาและเมนูธีม ไม่มีไทยหลงเหลือ", () => {
    const root = renderPage(<HeaderView siteName="koymukarnnovel" isAdmin={true} query="" />, { locale: "en" })
    assert.deepEqual(all(one(root, "nav.nav"), "a").map((a) => text(a).trim()), ["Home", "About", "Contact"])
    assert.equal(one(root, "nav.nav").attrs["aria-label"], en.header.menuLabel)
    assert.equal(text(one(root, "a.admin-link")).trim(), en.header.admin)
    assert.equal(all(root, ".lang-menu").length, 1)
    assert.equal(all(root, ".theme-menu").length, 1)
    assert.equal(one(root, "input[type=search]").attrs.placeholder, en.search.placeholder)
    assert.doesNotMatch(text(root), /[฀-๿]/)
  })

  test("HeaderView ลาว: เมนูเป็นลาว; ลิงก์โลโก้ตอนยังไม่มีชื่อเว็บมีชื่อสำรองตามภาษา", () => {
    const root = renderPage(<HeaderView siteName={null} isAdmin={false} query="" />, { locale: "lo" })
    assert.deepEqual(all(one(root, "nav.nav"), "a").map((a) => text(a).trim()), [lo.header.home, lo.header.about, lo.header.contact])
    assert.equal(one(root, "a.logo").attrs["aria-label"], lo.header.home)
  })

  test("HeaderView ไทย: ข้อความเดิม", () => {
    const root = renderPage(<HeaderView siteName="x" isAdmin={false} query="" />)
    assert.deepEqual(all(one(root, "nav.nav"), "a").map((a) => text(a).trim()), ["หน้าแรก", "เกี่ยวกับ", "ติดต่อ"])
    assert.equal(one(root, "nav.nav").attrs["aria-label"], "เมนูหลัก")
  })

  test("FooterView ลาว/อังกฤษ: หมายเหตุเนื้อหา หัวข้อ และลิงก์ตามภาษา", () => {
    for (const locale of ["lo", "en"] as const) {
      const m = MESSAGES[locale]
      const root = renderPage(<FooterView siteName="k" year={2026} />, { locale })
      assert.equal(text(one(root, ".foot-note")).trim(), m.footer.note)
      assert.deepEqual(all(root, "h2.foot-h").map((h) => text(h).trim()), [m.footer.menu, m.footer.info])
      assert.deepEqual(all(one(root, "nav.foot-nav"), "a").map((a) => text(a).trim()), [m.footer.home, m.footer.about, m.footer.contact])
      assert.equal(one(root, "nav.foot-nav").attrs["aria-label"], m.footer.linksLabel)
    }
    assert.equal(text(one(renderPage(<FooterView siteName={null} year={2026} />), ".foot-note")).trim(), "นิยายแปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม")
  })

  test("Footer ตัวจริงใช้ภาษาที่เลือก", () => {
    const root = renderPage(<Footer />, { locale: "en", state: { site: null, loading: true, error: null } })
    assert.equal(text(one(root, ".foot-note")).trim(), en.footer.note)
  })

  test("SearchBoxView: ช่องค้นหาตามภาษา (ไม่ส่ง m = ไทย)", () => {
    const base = { value: "", onChange: noop, onSubmit: noop }
    const input = (m?: typeof lo) => one(renderPage(<SearchBoxView {...base} m={m} />), "input")
    assert.equal(input(lo).attrs.placeholder, lo.search.placeholder)
    assert.equal(input(lo).attrs["aria-label"], lo.search.label)
    assert.equal(input().attrs.placeholder, "ค้นหาชื่อเรื่อง ผู้แต่ง หมวดหมู่…")
  })

  test("ThemeMenuView ลาว: ป้ายปุ่ม ชื่อเมนู และชื่อธีมเป็นลาว", () => {
    const root = renderPage(<ThemeMenuView current="midnight" open={true} menuId="t1" onToggle={noop} onSelect={noop} onKeyDown={noop} m={lo} />)
    assert.equal(one(root, "button[aria-haspopup]").attrs["aria-label"], lo.theme.change)
    assert.equal(one(root, "[role=menu]").attrs["aria-label"], lo.theme.menu)
    assert.deepEqual(all(root, "[role=menuitemradio]").map((i) => text(i).trim()), THEMES.map((t) => lo.theme.labels[t]))
    assert.notDeepEqual(THEMES.map((t) => lo.theme.labels[t]), THEMES.map((t) => th.theme.labels[t]))
  })

  test("ชื่อธีมครบทุกธีมในทุกภาษา ไม่ซ้ำกันภายในภาษาเดียว", () => {
    for (const m of [th, en, lo]) {
      assert.deepEqual(Object.keys(m.theme.labels).sort(), [...THEMES].sort())
      assert.equal(new Set(Object.values(m.theme.labels)).size, THEMES.length)
    }
  })
})
