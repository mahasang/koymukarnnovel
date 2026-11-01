import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { FONTS } from "../lib/reader-prefs"
import { THEMES, THEME_LABELS, type ThemeId } from "../lib/theme"
import { all, one, parse, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { FONT_LABELS, ReaderSettings, ReaderSettingsView, type ReaderSettingsViewProps } from "./ReaderSettings"

/** แผงตั้งค่าการอ่าน: ธีม ขนาดตัวอักษร ฟอนต์ คำอธิบายเมื่อไม่มีเสียงไทย */

const noop = () => {}
const props = (over: Partial<ReaderSettingsViewProps> = {}): ReaderSettingsViewProps => ({
  id: "rs-1",
  theme: "midnight",
  fontSize: 18,
  font: "sarabun",
  voiceMissing: false,
  onTheme: noop,
  onFontSize: noop,
  onFont: noop,
  onClose: noop,
  ...over,
})
const html = (over: Partial<ReaderSettingsViewProps> = {}) => parse(renderToStaticMarkup(<ReaderSettingsView {...props(over)} />))
const tree = (over: Partial<ReaderSettingsViewProps> = {}) => ReaderSettingsView(props(over))

describe("ReaderSettingsView — โครง", () => {
  test("แผงเป็น dialog ที่มีชื่อและ id ให้ปุ่ม Aa ผูก aria-controls; มีฉากมืดหลังแผง (แสดงเฉพาะจอแคบด้วย CSS) ซ่อนจากโปรแกรมอ่านหน้าจอ", () => {
    const root = html({ id: "rs-5" })
    const panel = one(root, "section.rs")
    assert.equal(panel.attrs.role, "dialog")
    assert.equal(panel.attrs["aria-label"], "ตั้งค่าการอ่าน")
    assert.equal(panel.attrs.id, "rs-5")
    assert.equal(one(root, "div.rs-scrim").attrs["aria-hidden"], "true")
    assert.equal(text(one(root, "h2.rs-title")), "ตั้งค่าการอ่าน")
  })

  test("ปุ่มปิดมีชื่อและเรียก onClose", () => {
    let closed = 0
    const button = findTag(tree({ onClose: () => closed++ }), "button", (el) => el.props["aria-label"] === "ปิดการตั้งค่า")
    handlerOf(button, "onClick")()
    assert.equal(closed, 1)
    assert.equal(one(html(), "button[aria-label=ปิดการตั้งค่า]").attrs.type, "button")
  })

  test("ส่ง ref ของแผงต่อให้ <section>", () => {
    const panelRef = { current: null }
    const section = findTag(tree({ panelRef }), "section")
    assert.equal((section as unknown as { ref: unknown }).ref, panelRef)
  })
})

describe("ReaderSettingsView — ธีม", () => {
  test("มีครบทุกธีมตามลำดับ พร้อมป้ายไทยและตัวหมายสีที่ซ่อนจากโปรแกรมอ่านหน้าจอ", () => {
    const buttons = all(html(), "button.rs-theme")
    assert.deepEqual(
      buttons.map((button) => text(button).trim()),
      THEMES.map((theme) => THEME_LABELS[theme]),
    )
    assert.deepEqual(
      buttons.map((button) => button.attrs["data-t"]),
      [...THEMES],
    )
    for (const button of buttons) assert.equal(one(button, "span.rs-swatch").attrs["aria-hidden"], "true")
  })

  test("เฉพาะธีมปัจจุบันถูกกด (aria-pressed) และเด่น (on)", () => {
    for (const current of THEMES) {
      for (const button of all(html({ theme: current }), "button.rs-theme")) {
        const isCurrent = button.attrs["data-t"] === current
        assert.equal(button.attrs["aria-pressed"], String(isCurrent), `${current}/${button.attrs["data-t"]}`)
        assert.equal((button.attrs.class ?? "").split(" ").includes("on"), isCurrent)
      }
    }
  })

  test("กดธีม → onTheme ด้วยธีมนั้น", () => {
    const chosen: ThemeId[] = []
    const buttons = findAll(tree({ onTheme: (theme) => chosen.push(theme) }), (el) => el.type === "button" && typeof el.props["data-t"] === "string")
    assert.equal(buttons.length, THEMES.length)
    for (const button of buttons) handlerOf(button, "onClick")()
    assert.deepEqual(chosen, [...THEMES])
  })

  test("กลุ่มธีมมีชื่อกลุ่ม (aria-labelledby ชี้ป้าย 'ธีม')", () => {
    const root = html({ id: "x" })
    const group = all(root, "div[role=group]")[0]
    assert.equal(group.attrs["aria-labelledby"], "x-theme")
    assert.equal(text(one(root, "span[id=x-theme]")), "ธีม")
  })
})

describe("ReaderSettingsView — ขนาดตัวอักษร", () => {
  test("แถบเลื่อน 16–26 ขั้นละ 2 ที่ค่าปัจจุบัน พร้อมป้ายผูกกับช่องและข้อความบอกค่า", () => {
    const root = html({ id: "x", fontSize: 22 })
    const input = one(root, "input.rs-range")
    assert.equal(input.attrs.type, "range")
    assert.equal(input.attrs.min, "16")
    assert.equal(input.attrs.max, "26")
    assert.equal(input.attrs.step, "2")
    assert.equal(input.attrs.value, "22")
    assert.equal(input.attrs["aria-valuetext"], "22 พิกเซล")
    assert.equal(input.attrs.id, "x-size")
    assert.equal(one(root, "label.rs-label").attrs.for, "x-size")
    assert.equal(text(one(root, "label.rs-label")), "ขนาดตัวอักษร")
    assert.equal(text(one(root, "output.rs-value")), "22")
    assert.equal(one(root, "output.rs-value").attrs.for, "x-size")
  })

  test("เลื่อน → onFontSize ด้วยขนาดที่ปรับเข้าช่วย (คู่ใกล้สุด 16–26)", () => {
    const sizes: number[] = []
    const input = findTag(tree({ onFontSize: (size) => sizes.push(size) }), "input")
    for (const value of ["20", "26", "16", "19", "99", "-3", "abc"]) handlerOf(input, "onChange")({ currentTarget: { value } })
    assert.deepEqual(sizes, [20, 26, 16, 20, 26, 16, 18])
  })
})

describe("ReaderSettingsView — ฟอนต์", () => {
  test("มีทุกฟอนต์ตามลำดับ ชื่อฟอนต์จริง; เฉพาะฟอนต์ปัจจุบันถูกกด", () => {
    assert.deepEqual(FONT_LABELS, { sarabun: "Sarabun", serif: "Noto Serif Thai" })
    for (const current of FONTS) {
      const buttons = all(html({ font: current }), "button.rs-font")
      assert.deepEqual(
        buttons.map((button) => text(button).trim()),
        FONTS.map((font) => FONT_LABELS[font]),
      )
      assert.deepEqual(
        buttons.map((button) => button.attrs["aria-pressed"]),
        FONTS.map((font) => String(font === current)),
      )
      assert.deepEqual(
        buttons.map((button) => button.attrs["data-f"]),
        [...FONTS],
      )
    }
  })

  test("กดฟอนต์ → onFont", () => {
    const chosen: string[] = []
    const buttons = findAll(tree({ onFont: (font) => chosen.push(font) }), (el) => el.type === "button" && typeof el.props["data-f"] === "string")
    for (const button of buttons) handlerOf(button, "onClick")()
    assert.deepEqual(chosen, [...FONTS])
  })
})

describe("ReaderSettingsView — ช่องว่างที่ mutation พบ", () => {
  test("เฉพาะฟอนต์ปัจจุบันเด่น (on)", () => {
    for (const current of FONTS) {
      for (const button of all(html({ font: current }), "button.rs-font")) {
        assert.equal((button.attrs.class ?? "").split(" ").includes("on"), button.attrs["data-f"] === current, `${current}/${button.attrs["data-f"]}`)
      }
    }
  })

  test("กลุ่มฟอนต์มีชื่อกลุ่ม (aria-labelledby ชี้ป้าย 'ฟอนต์') และต่างจากกลุ่มธีม", () => {
    const root = html({ id: "x" })
    const groups = all(root, "div[role=group]")
    assert.equal(groups.length, 2)
    assert.equal(groups[1].attrs["aria-labelledby"], "x-font")
    assert.equal(text(one(root, "span[id=x-font]")), "ฟอนต์")
  })

  test("ก ตัวเล็ก/ตัวใหญ่ข้างแถบขนาดเป็นของตกแต่ง ซ่อนจากโปรแกรมอ่านหน้าจอ", () => {
    const root = html()
    assert.equal(one(root, "span.rs-size-small").attrs["aria-hidden"], "true")
    assert.equal(one(root, "span.rs-size-big").attrs["aria-hidden"], "true")
  })
})

describe("ReaderSettingsView — ไม่มีเสียงไทย", () => {
  test("มีเสียงไทย → ไม่มีคำอธิบาย · ไม่มีเสียงไทย/ไม่รองรับ → อธิบายสั้นๆ ว่าทำไมไม่มีปุ่มฟัง", () => {
    assert.equal(all(html(), "p.rs-note").length, 0)
    const note = text(one(html({ voiceMissing: true }), "p.rs-note"))
    assert.match(note, /เสียงอ่านภาษาไทย/)
    assert.match(note, /ไม่มีปุ่มฟัง/)
  })
})

describe("ReaderSettings (ตัวห่อพฤติกรรม)", () => {
  const wrapperProps = (open: boolean) => ({ ...props(), open, toggleRef: { current: null } })

  test("ปิดอยู่ → ไม่วาดอะไรเลย · เปิดอยู่ → วาดแผง", () => {
    assert.equal(renderToStaticMarkup(<ReaderSettings {...wrapperProps(false)} />), "")
    const root = parse(renderToStaticMarkup(<ReaderSettings {...wrapperProps(true)} />))
    assert.equal(one(root, "section.rs").attrs.role, "dialog")
  })
})
