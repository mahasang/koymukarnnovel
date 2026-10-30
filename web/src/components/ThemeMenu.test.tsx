import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { THEMES, THEME_LABELS, type ThemeId } from "../lib/theme"
import { all, one, parse, text } from "../testing/dom"
import { findAll, findTag, handlerOf, type AnyElement } from "../testing/elements"
import { ThemeMenu, ThemeMenuView } from "./ThemeMenu"

const noop = () => {}
const props = (over: Partial<Parameters<typeof ThemeMenuView>[0]> = {}) => ({
  current: "midnight" as ThemeId,
  open: false,
  menuId: "theme-menu-1",
  onToggle: noop,
  onSelect: noop,
  onKeyDown: noop,
  ...over,
})
const render = (over: Partial<Parameters<typeof ThemeMenuView>[0]> = {}) => parse(renderToStaticMarkup(<ThemeMenuView {...props(over)} />))

describe("ThemeMenuView", () => {
  test("ปิดอยู่: มีแต่ปุ่ม (บอกว่ามีเมนูซ่อนอยู่ ยังไม่ขยาย) ไม่มีรายการ", () => {
    const root = render()
    const button = one(root, "button.iconbtn")
    assert.equal(button.attrs.type, "button")
    assert.equal(button.attrs["aria-label"], "เปลี่ยนธีม")
    assert.equal(button.attrs["aria-haspopup"], "menu")
    assert.equal(button.attrs["aria-expanded"], "false")
    assert.equal(button.attrs["aria-controls"], undefined) // ชี้ไปที่ element ที่ยังไม่มีไม่ได้
    assert.equal(all(root, "[role=menu]").length, 0)
    assert.equal(all(root, "button").length, 1)
  })

  test("เปิดอยู่: ปุ่มบอกว่าขยายแล้วและผูก aria-controls กับเมนูที่ id ตรงกัน", () => {
    const root = render({ open: true, menuId: "tm-7" })
    const button = one(root, "button.iconbtn")
    assert.equal(button.attrs["aria-expanded"], "true")
    assert.equal(button.attrs["aria-controls"], "tm-7")
    const menu = one(root, "[role=menu]")
    assert.equal(menu.attrs.id, "tm-7")
    assert.equal(menu.attrs["aria-label"], "ธีม")
    assert.equal(menu.attrs.class, "theme-list")
  })

  test("เมนูมีครบทุกธีมตามลำดับ พร้อมป้ายภาษาไทย", () => {
    const items = all(render({ open: true }), "[role=menuitemradio]")
    assert.deepEqual(
      items.map((item) => text(item).trim()),
      THEMES.map((theme) => THEME_LABELS[theme]),
    )
    for (const item of items) assert.equal(item.tag, "button")
    for (const item of items) assert.equal(item.attrs.type, "button")
  })

  test("เฉพาะธีมปัจจุบันที่ถูกติ๊ก (aria-checked), รับโฟกัสด้วย Tab (tabindex 0) และเด่น (คลาส on) — ที่เหลือเลือกด้วยลูกศร", () => {
    for (const current of THEMES) {
      const items = all(render({ open: true, current }), "[role=menuitemradio]")
      items.forEach((item, index) => {
        const isCurrent = THEMES[index] === current
        assert.equal(item.attrs["aria-checked"], String(isCurrent), `${current} / ${THEMES[index]}`)
        assert.equal(item.attrs.tabindex, isCurrent ? "0" : "-1", `${current} / ${THEMES[index]}`)
        assert.equal(/\bon\b/.test(item.attrs.class ?? ""), isCurrent, `${current} / ${THEMES[index]}`)
      })
    }
  })

  test("เครื่องหมายถูกอยู่เฉพาะรายการปัจจุบัน (ไอคอนประดับ ซ่อนจากโปรแกรมอ่านหน้าจอ)", () => {
    const items = all(render({ open: true, current: "sepia" }), "[role=menuitemradio]")
    items.forEach((item, index) => {
      assert.equal(one(item, "span.theme-check").attrs["aria-hidden"], "true", THEMES[index]) // ช่องเครื่องหมายถูก (ว่างในรายการอื่น) ก็ซ่อนทั้งช่อง
      const icons = all(item, "svg")
      assert.equal(icons.length, THEMES[index] === "sepia" ? 1 : 0, THEMES[index])
      for (const icon of icons) assert.equal(icon.attrs["aria-hidden"], "true")
    })
  })

  test("ไอคอนบนปุ่มเป็นภาพประดับ (ป้ายอ่านออกเสียงอยู่ที่ aria-label)", () => {
    const icons = all(one(render(), "button"), "svg")
    assert.equal(icons.length, 1)
    assert.equal(icons[0]?.attrs["aria-hidden"], "true")
  })

  test("กดปุ่ม → onToggle; กดรายการ → onSelect ด้วยธีมของรายการนั้น (ไม่ปะปนกัน)", () => {
    let toggles = 0
    const selected: ThemeId[] = []
    const element = ThemeMenuView(props({ open: true, onToggle: () => toggles++, onSelect: (theme: ThemeId) => selected.push(theme) }))
    handlerOf(findTag(element, "button", (el) => el.props["aria-haspopup"] === "menu"), "onClick")()
    assert.equal(toggles, 1)
    assert.equal(selected.length, 0)
    for (const item of findAll(element, (el) => el.props.role === "menuitemradio")) handlerOf(item, "onClick")()
    assert.deepEqual(selected, [...THEMES])
    assert.equal(toggles, 1)
  })

  test("ตัวดักคีย์บอร์ดผูกที่กรอบนอก (ได้ยินคีย์ทั้งจากปุ่มและจากรายการเมนู)", () => {
    const onKeyDown = () => {}
    const element = ThemeMenuView(props({ onKeyDown })) as AnyElement
    assert.equal(element.type, "div")
    assert.equal(handlerOf(element, "onKeyDown"), onKeyDown)
  })

  test("กรอบนอกมีคลาส theme-menu และรับ rootRef ที่ผู้เรียกส่งมา (ไว้หาตำแหน่งโฟกัส/คลิกนอกเมนู)", () => {
    const rootRef = { current: null }
    const element = ThemeMenuView(props({ rootRef })) as AnyElement
    assert.equal(element.props.className, "theme-menu")
    assert.equal(element.props.ref, rootRef)
  })
})

describe("ThemeMenu (ตัวที่มี state)", () => {
  test("เริ่มปิดอยู่ ไม่มีรายการ", () => {
    const root = parse(renderToStaticMarkup(<ThemeMenu />))
    assert.equal(one(root, "button.iconbtn").attrs["aria-expanded"], "false")
    assert.equal(all(root, "[role=menu]").length, 0)
  })
})
