import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LOCALES, LOCALE_NAMES, type Locale } from "../i18n/types"
import { MESSAGES } from "../i18n/messages"
import { all, one, parse, text } from "../testing/dom"
import { findAll, handlerOf, type AnyElement } from "../testing/elements"
import { renderPage } from "../testing/render"
import { LanguageMenu, LanguageMenuView } from "./LanguageMenu"

const noop = () => {}
const props = (over: Partial<Parameters<typeof LanguageMenuView>[0]> = {}) => ({
  locale: "th" as Locale,
  open: false,
  menuId: "lm-1",
  onToggle: noop,
  onSelect: noop,
  onKeyDown: noop,
  ...over,
})
const render = (over: Partial<Parameters<typeof LanguageMenuView>[0]> = {}) => parse(renderToStaticMarkup(<LanguageMenuView {...props(over)} />))

describe("LanguageMenuView", () => {
  test("ปิดอยู่: มีแค่ปุ่มเปิดเมนู (ป้ายตามภาษาปัจจุบัน แสดงรหัสภาษาย่อ)", () => {
    const root = render({ locale: "en", m: MESSAGES.en })
    const button = one(root, "button")
    assert.equal(button.attrs["aria-label"], "Language")
    assert.equal(button.attrs["aria-haspopup"], "menu")
    assert.equal(button.attrs["aria-expanded"], "false")
    assert.equal(text(one(root, ".lang-code")).trim(), "EN")
    assert.equal(all(root, "[role=menuitemradio]").length, 0)
  })

  test("เปิดอยู่: มีครบสามภาษา ชื่อภาษาเขียนด้วยภาษาของตัวเอง พร้อม lang ของแต่ละรายการ", () => {
    const items = all(render({ open: true }), "[role=menuitemradio]")
    assert.deepEqual(
      items.map((item) => text(item).trim()),
      ["ไทย", "English", "ລາວ"],
    )
    assert.deepEqual(
      items.map((item) => one(item, "span[lang]").attrs.lang),
      [...LOCALES],
    )
    assert.deepEqual([...LOCALES].map((l) => LOCALE_NAMES[l]), ["ไทย", "English", "ລາວ"])
  })

  test("เฉพาะภาษาปัจจุบันที่ถูกติ๊ก รับ Tab และเด่น (เหมือนเมนูธีม)", () => {
    for (const current of LOCALES) {
      const items = all(render({ open: true, locale: current }), "[role=menuitemradio]")
      items.forEach((item, index) => {
        const isCurrent = LOCALES[index] === current
        assert.equal(item.attrs["aria-checked"], String(isCurrent))
        assert.equal(item.attrs.tabindex, isCurrent ? "0" : "-1")
        assert.equal(/\bon\b/.test(item.attrs.class ?? ""), isCurrent)
      })
    }
  })

  test("กดรายการ → onSelect ด้วยภาษานั้น; กดปุ่ม → onToggle; ผูก onKeyDown ที่กรอบ", () => {
    const selected: Locale[] = []
    let toggles = 0
    const keys = () => {}
    const element = LanguageMenuView(props({ open: true, onSelect: (l: Locale) => selected.push(l), onToggle: () => toggles++, onKeyDown: keys })) as AnyElement
    const items = findAll(element, (node) => node.props?.role === "menuitemradio")
    items.forEach((item) => handlerOf(item, "onClick")())
    assert.deepEqual(selected, [...LOCALES])
    handlerOf(findAll(element, (node) => node.type === "button" && node.props?.["aria-haspopup"] === "menu")[0]!, "onClick")()
    assert.equal(toggles, 1)
    assert.equal(element.props.onKeyDown, keys)
  })

  test("LanguageMenu (ตัวจริง) ใต้ภาษาลาว: ป้ายปุ่มเป็นลาว", () => {
    const root = renderPage(<LanguageMenu />, { locale: "lo" })
    assert.equal(one(root, "button").attrs["aria-label"], MESSAGES.lo.lang.menuLabel)
    assert.equal(text(one(root, ".lang-code")).trim(), "LO")
  })
})
