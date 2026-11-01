import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { RATE_MAX, RATE_MIN } from "../lib/reader-prefs"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf, type AnyElement } from "../testing/elements"
import { renderPage } from "../testing/render"
import { ReaderBar, type ReaderBarProps } from "./ReaderBar"

/** แถบบนของหน้าอ่าน: โครงสร้าง สถานะซ่อน/โผล่ ปุ่มฟัง แถวควบคุมเสียง และการผูก handler */

const noop = () => {}
const props = (over: Partial<ReaderBarProps> = {}): ReaderBarProps => ({
  novelId: 7,
  novelTitle: "ฤดูกระจก",
  number: 12,
  visible: true,
  pct: 42.4,
  listenAvailable: true,
  speechState: "idle",
  rate: 1,
  settingsOpen: false,
  settingsId: "rs-1",
  onToggleSettings: noop,
  onListen: noop,
  onStop: noop,
  onPause: noop,
  onResume: noop,
  onPrev: noop,
  onNext: noop,
  onRate: noop,
  ...over,
})
const html = (over: Partial<ReaderBarProps> = {}) => renderPage(<ReaderBar {...props(over)} />)
const tree = (over: Partial<ReaderBarProps> = {}) => ReaderBar(props(over))
const buttonByLabel = (node: AnyElement, label: string) => findTag(node, "button", (el) => el.props["aria-label"] === label)

describe("ReaderBar — โครงและสถานะ", () => {
  test("เป็น <header> ชั้นเดียว: เห็นอยู่ = rb · ซ่อน = rb hidden", () => {
    assert.equal(one(html(), "header").attrs.class, "rb")
    assert.equal(one(html({ visible: false }), "header").attrs.class, "rb hidden")
  })

  test("ชื่อเรื่องและ 'ตอนที่ N' แสดงในแถบ", () => {
    const root = html()
    assert.equal(text(one(root, "span.rb-novel")), "ฤดูกระจก")
    assert.equal(text(one(root, "span.rb-chapter")), "ตอนที่ 12")
  })

  test("เส้นบอกความคืบหน้า: progressbar ที่ค่าปัดเป็นจำนวนเต็มและความกว้างตามเปอร์เซ็นต์จริง", () => {
    const bar = one(html(), "div.rb-progress")
    assert.equal(bar.attrs.role, "progressbar")
    assert.equal(bar.attrs["aria-label"], "อ่านไปแล้ว")
    assert.equal(bar.attrs["aria-valuemin"], "0")
    assert.equal(bar.attrs["aria-valuemax"], "100")
    assert.equal(bar.attrs["aria-valuenow"], "42")
    assert.equal(one(bar, "span.rb-fill").attrs.style, "width:42.4%")
    assert.equal(one(html({ pct: 0 }), "div.rb-progress").attrs["aria-valuenow"], "0")
    assert.equal(one(html({ pct: 100 }), "span.rb-fill").attrs.style, "width:100%")
  })

  test("ลิงก์กลับหน้านิยายและสารบัญชี้ไปหน้านิยายของเรื่องนี้ พร้อมชื่อที่โปรแกรมอ่านหน้าจออ่านได้", () => {
    const links = all(html(), "a")
    assert.equal(links.length, 2)
    assert.deepEqual(
      links.map((link) => [link.attrs.href, link.attrs["aria-label"]]),
      [
        ["/novel/7", "กลับไปหน้านิยาย"],
        ["/novel/7", "สารบัญตอน"],
      ],
    )
  })

  test("ไอคอนทุกอันซ่อนจากโปรแกรมอ่านหน้าจอ (ปุ่มมีชื่อจาก aria-label)", () => {
    const root = html({ speechState: "playing" })
    for (const svg of all(root, "svg")) assert.equal(svg.attrs["aria-hidden"], "true")
    for (const control of [...all(root, "button"), ...all(root, "a")]) assert.ok((control.attrs["aria-label"] ?? "").length > 0)
  })
})

describe("ReaderBar — ปุ่มฟังเสียง", () => {
  test("ไม่มีเสียงไทย/ไม่รองรับ (listenAvailable เท็จ) → ไม่มีปุ่มฟัง และไม่มีแถวควบคุมแม้ state ไม่ใช่ idle", () => {
    const root = html({ listenAvailable: false })
    assert.equal(all(root, "button").length, 1) // เหลือแค่ปุ่ม Aa
    assert.equal(all(root, "div.rb-player").length, 0)
  })

  test("ยังไม่ฟัง: ปุ่ม 'ฟังเสียงอ่าน' ไม่ถูกกด กดแล้วเริ่มฟัง · ไม่มีแถวควบคุม", () => {
    let started = 0
    const node = tree({ onListen: () => started++ })
    const button = buttonByLabel(node, "ฟังเสียงอ่าน")
    assert.equal(button.props["aria-pressed"], false)
    assert.equal(button.props.className, "iconbtn")
    handlerOf(button, "onClick")()
    assert.equal(started, 1)
    assert.equal(all(html(), "div.rb-player").length, 0)
  })

  test("กำลังฟัง (เล่นหรือหยุดชั่วคราว): ปุ่มเปลี่ยนเป็น 'หยุดฟัง' (กดอยู่) กดแล้วหยุด · มีแถวควบคุม", () => {
    for (const speechState of ["playing", "paused"] as const) {
      let stopped = 0
      const node = tree({ speechState, onStop: () => stopped++ })
      const button = buttonByLabel(node, "หยุดฟัง")
      assert.equal(button.props["aria-pressed"], true)
      assert.equal(button.props.className, "iconbtn on")
      handlerOf(button, "onClick")()
      assert.equal(stopped, 1)
      assert.equal(all(html({ speechState }), "div.rb-player").length, 1)
    }
  })
})

describe("ReaderBar — แถวควบคุมเสียง", () => {
  test("กลุ่มควบคุมมีชื่อ · ปุ่มย่อหน้าก่อน/ถัดไปผูกกับ onPrev/onNext", () => {
    const root = html({ speechState: "playing" })
    assert.equal(one(root, "div.rb-player").attrs.role, "group")
    assert.equal(one(root, "div.rb-player").attrs["aria-label"], "ควบคุมเสียงอ่าน")
    const calls: string[] = []
    const node = tree({ speechState: "playing", onPrev: () => calls.push("prev"), onNext: () => calls.push("next") })
    handlerOf(buttonByLabel(node, "ย่อหน้าก่อนหน้า"), "onClick")()
    handlerOf(buttonByLabel(node, "ย่อหน้าถัดไป"), "onClick")()
    assert.deepEqual(calls, ["prev", "next"])
  })

  test("กำลังเล่น: ปุ่มกลางคือ 'หยุดชั่วคราว' → onPause · หยุดชั่วคราวอยู่: 'เล่นต่อ' → onResume", () => {
    const calls: string[] = []
    const handlers = { onPause: () => calls.push("pause"), onResume: () => calls.push("resume") }
    handlerOf(buttonByLabel(tree({ speechState: "playing", ...handlers }), "หยุดชั่วคราว"), "onClick")()
    handlerOf(buttonByLabel(tree({ speechState: "paused", ...handlers }), "เล่นต่อ"), "onClick")()
    assert.deepEqual(calls, ["pause", "resume"])
    assert.equal(all(html({ speechState: "playing" }), "button[aria-label=เล่นต่อ]").length, 0)
    assert.equal(all(html({ speechState: "paused" }), "button[aria-label=หยุดชั่วคราว]").length, 0)
  })

  test("แถบเลื่อนความเร็ว: ช่วง RATE_MIN–RATE_MAX ขั้น 0.1 ค่าปัจจุบัน และข้อความอ่านง่าย", () => {
    const root = html({ speechState: "playing", rate: 1.2 })
    const input = one(root, "input.rb-range")
    assert.equal(input.attrs.type, "range")
    assert.equal(input.attrs.min, String(RATE_MIN))
    assert.equal(input.attrs.max, String(RATE_MAX))
    assert.equal(input.attrs.step, "0.1")
    assert.equal(input.attrs.value, "1.2")
    assert.equal(input.attrs["aria-valuetext"], "1.2 เท่า")
    assert.equal(text(one(root, "output.rb-rate-value")), "1.2×")
    assert.equal(one(root, "label.rb-rate").children.some((child) => typeof child !== "string" && child.tag === "input"), true) // ป้ายครอบช่อง = ผูกกับช่อง
    assert.equal(text(one(root, "span.rb-rate-label")), "ความเร็ว")
  })

  test("เลื่อนแถบ → onRate ด้วยค่าตัวเลข", () => {
    const rates: number[] = []
    const input = findTag(tree({ speechState: "playing", onRate: (rate) => rates.push(rate) }), "input")
    handlerOf(input, "onChange")({ currentTarget: { value: "1.3" } })
    handlerOf(input, "onChange")({ currentTarget: { value: "0.8" } })
    assert.deepEqual(rates, [1.3, 0.8])
  })

  test("ความเร็วแสดงทศนิยมหนึ่งตำแหน่งเสมอ (1 → 1.0×)", () => {
    assert.equal(text(one(html({ speechState: "playing", rate: 1 }), "output.rb-rate-value")), "1.0×")
  })
})

describe("ReaderBar — ปุ่มตั้งค่า (Aa)", () => {
  test("ปิดอยู่: บอกว่ามีแผงแบบ dialog ซ่อนอยู่ ไม่ผูก aria-controls · กดแล้วสลับแผง", () => {
    let toggled = 0
    const node = tree({ onToggleSettings: () => toggled++ })
    const button = buttonByLabel(node, "ตั้งค่าการอ่าน")
    assert.equal(button.props["aria-haspopup"], "dialog")
    assert.equal(button.props["aria-expanded"], false)
    assert.equal(button.props["aria-controls"], undefined)
    assert.equal(button.props.className, "iconbtn")
    handlerOf(button, "onClick")()
    assert.equal(toggled, 1)
  })

  test("เปิดอยู่: ขยายแล้ว ชี้ไปที่ id ของแผง และเด่น (on)", () => {
    const button = buttonByLabel(tree({ settingsOpen: true, settingsId: "rs-9" }), "ตั้งค่าการอ่าน")
    assert.equal(button.props["aria-expanded"], true)
    assert.equal(button.props["aria-controls"], "rs-9")
    assert.equal(button.props.className, "iconbtn on")
  })

  test("ส่ง ref ของกรอบแถบและปุ่ม Aa ต่อให้ element (หน้าอ่านวัดความสูงแถบ/แผงตั้งค่าย้ายโฟกัสกลับ)", () => {
    const rootRef = { current: null }
    const buttonRef = { current: null }
    const node = ReaderBar(props({ rootRef, settingsButtonRef: buttonRef }))
    assert.equal((node as unknown as { ref: unknown }).ref, rootRef)
    assert.equal((buttonByLabel(node, "ตั้งค่าการอ่าน") as unknown as { ref: unknown }).ref, buttonRef)
  })

  test("ปุ่มทุกปุ่มเป็น type=button (ไม่ส่งฟอร์มโดยไม่ตั้งใจ)", () => {
    for (const button of findAll(tree({ speechState: "playing" }), (el) => el.type === "button")) assert.equal(button.props.type, "button")
  })
})

describe("ReaderBar — ช่องว่างที่ mutation พบ", () => {
  test("aria-valuenow ปัดเศษ (49.6 → 50 ไม่ใช่ 49)", () => {
    assert.equal(one(html({ pct: 49.6 }), "div.rb-progress").attrs["aria-valuenow"], "50")
    assert.equal(one(html({ pct: 49.4 }), "div.rb-progress").attrs["aria-valuenow"], "49")
  })

  test("aria-valuetext ของความเร็วมีทศนิยมหนึ่งตำแหน่งเสมอ (1 → 1.0 เท่า)", () => {
    assert.equal(one(html({ speechState: "playing", rate: 1 }), "input.rb-range").attrs["aria-valuetext"], "1.0 เท่า")
  })

  test("ไอคอนปุ่มกลาง: เล่นอยู่ = หยุดชั่วคราว (pause) · หยุดอยู่ = เล่นต่อ (play)", () => {
    const icon = (state: "playing" | "paused") => one(html({ speechState: state }), "button.rb-play").children.find((child) => typeof child !== "string" && child.tag === "svg")
    assert.match(String(icon("playing") && (icon("playing") as { attrs: Record<string, string> }).attrs.class), /lucide-pause/)
    assert.match(String(icon("paused") && (icon("paused") as { attrs: Record<string, string> }).attrs.class), /lucide-play\b/)
  })
})
