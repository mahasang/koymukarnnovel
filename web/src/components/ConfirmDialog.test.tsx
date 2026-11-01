import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { findAll, findTag, handlerOf, type AnyElement } from "../testing/elements"
import { renderToStaticMarkup } from "react-dom/server"
import { ConfirmDialog, ConfirmDialogView, type ConfirmDialogViewProps } from "./ConfirmDialog"

/** กล่องยืนยันที่ทำเอง (ไม่ใช้ confirm() ของเบราว์เซอร์): ส่วนแสดงผลทดสอบตรงนี้ · โฟกัส/Esc/ล็อกการเลื่อนจริงตรวจในเบราว์เซอร์ */

const noop = () => {}
const view = (over: Partial<ConfirmDialogViewProps> = {}) =>
  ConfirmDialogView({
    title: "ลบนิยายนี้?",
    message: "ลบแล้วกู้คืนไม่ได้",
    confirmLabel: "ลบนิยาย",
    cancelLabel: "ยกเลิก",
    danger: true,
    busy: false,
    error: null,
    titleId: "t1",
    descId: "d1",
    onConfirm: noop,
    onCancel: noop,
    onKeyDown: noop,
    ...over,
  })

const buttons = (v: AnyElement) => findAll(v, (el) => el.type === "button")
const classOf = (el: AnyElement) => String(el.props.className)
const scrim = (v: AnyElement) => findTag(v, "div", (el) => classOf(el) === "ad-scrim")
const dialogEl = (v: AnyElement) => findTag(v, "div", (el) => el.props.role === "alertdialog")

describe("ConfirmDialogView: โครงและ ARIA", () => {
  test("เป็น alertdialog แบบ modal ที่ผูกชื่อกับหัวเรื่อง และคำอธิบายกับข้อความ", () => {
    const v = view()
    const dialog = dialogEl(v)
    assert.equal(dialog.props["aria-modal"], "true")
    assert.equal(dialog.props["aria-labelledby"], "t1")
    assert.equal(dialog.props["aria-describedby"], "d1")
    assert.equal(dialog.props.tabIndex, -1, "โฟกัสที่ตัวกล่องได้ (ไว้ตอนกำลังทำงาน) แต่ไม่อยู่ในลำดับ Tab")
    const title = findTag(v, "h2")
    assert.equal(title.props.id, "t1")
    assert.equal(title.props.children, "ลบนิยายนี้?")
    assert.equal(findTag(v, "div", (el) => el.props.id === "d1").props.children, "ลบแล้วกู้คืนไม่ได้")
  })

  test("ปุ่มสองปุ่ม ยกเลิกมาก่อนยืนยัน (Tab ไปถึงปุ่มอันตรายทีหลัง) ทั้งคู่เป็น type=button", () => {
    const [cancel, confirm] = buttons(view())
    assert.equal(buttons(view()).length, 2)
    assert.equal(cancel!.props.children, "ยกเลิก")
    assert.equal(confirm!.props.children, "ลบนิยาย")
    assert.equal(cancel!.props.type, "button")
    assert.equal(confirm!.props.type, "button")
    assert.equal(classOf(cancel!), "btn ghost")
  })

  test("danger → ปุ่มยืนยันสีแดง (btn danger); ไม่ danger → ปุ่มเด่นปกติ (btn primary)", () => {
    assert.equal(classOf(buttons(view({ danger: true }))[1]!), "btn danger")
    assert.equal(classOf(buttons(view({ danger: false }))[1]!), "btn primary")
  })

  test("ปุ่มยกเลิกและยืนยันเรียก handler ของตัวเอง", () => {
    const calls: string[] = []
    const [cancel, confirm] = buttons(view({ onCancel: () => calls.push("cancel"), onConfirm: () => calls.push("confirm") }))
    handlerOf(cancel!, "onClick")()
    handlerOf(confirm!, "onClick")()
    assert.deepEqual(calls, ["cancel", "confirm"])
  })

  test("ข้อความเป็น ReactNode ได้ (ใส่ชื่อเรื่องเป็นตัวหนาได้)", () => {
    const v = view({ message: <span className="x">เรื่อง A</span> })
    assert.equal(findAll(v, (el) => el.props.className === "x").length, 1)
  })
})

describe("ConfirmDialogView: กำลังทำงาน และข้อผิดพลาด", () => {
  test("busy → ทั้งสองปุ่มถูกปิด และปุ่มยืนยันบอกว่ากำลังทำ", () => {
    const [cancel, confirm] = buttons(view({ busy: true }))
    assert.equal(cancel!.props.disabled, true)
    assert.equal(confirm!.props.disabled, true)
    assert.equal(confirm!.props.children, "กำลังดำเนินการ…")
    const [cancel2, confirm2] = buttons(view({ busy: false }))
    assert.equal(cancel2!.props.disabled, false)
    assert.equal(confirm2!.props.disabled, false)
  })

  test("มี error → แสดงใน role=alert; ไม่มี → ไม่มีกล่องนั้น", () => {
    const withError = findAll(view({ error: "ลบไม่สำเร็จ" }), (el) => el.props.role === "alert")
    assert.equal(withError.length, 1)
    assert.equal(withError[0]!.props.children, "ลบไม่สำเร็จ")
    assert.equal(findAll(view({ error: null }), (el) => el.props.role === "alert").length, 0)
  })
})

describe("ConfirmDialogView: คลิกฉากหลัง", () => {
  const press = (v: AnyElement, target: unknown, currentTarget: unknown) => {
    const log = { prevented: 0 }
    handlerOf(scrim(v), "onMouseDown")({ target, currentTarget, preventDefault: () => log.prevented++ })
    return log
  }

  test("กดที่ฉากหลังเอง → ยกเลิก และกันไม่ให้โฟกัสหลุดออกจากกล่อง", () => {
    let cancelled = 0
    const v = view({ onCancel: () => cancelled++ })
    const scrimNode = {}
    const log = press(v, scrimNode, scrimNode)
    assert.equal(cancelled, 1)
    assert.equal(log.prevented, 1)
  })

  test("กดข้างในกล่อง (ฟองขึ้นมาถึงฉากหลัง) → ไม่ยกเลิก และไม่กันพฤติกรรมปกติ (พิมพ์/เลือกข้อความ/คลิกปุ่มได้)", () => {
    let cancelled = 0
    const v = view({ onCancel: () => cancelled++ })
    const log = press(v, {}, {})
    assert.equal(cancelled, 0)
    assert.equal(log.prevented, 0)
  })

  test("ระหว่างกำลังทำงาน กดฉากหลังไม่ยกเลิก (แต่ยังกันโฟกัสหลุด)", () => {
    let cancelled = 0
    const v = view({ busy: true, onCancel: () => cancelled++ })
    const node = {}
    const log = press(v, node, node)
    assert.equal(cancelled, 0)
    assert.equal(log.prevented, 1)
  })
})

describe("ConfirmDialogView: แป้นพิมพ์", () => {
  test("onKeyDown อยู่ที่ตัวกล่อง (ครอบทุกอย่างข้างใน)", () => {
    let seen = 0
    const v = view({ onKeyDown: () => seen++ })
    handlerOf(dialogEl(v), "onKeyDown")()
    assert.equal(seen, 1)
  })
})

describe("ConfirmDialog (ตัวมี state)", () => {
  test("เรนเดอร์ครั้งแรก: มีกล่อง alertdialog ผูก id ที่ไม่ซ้ำกัน และไม่ busy", () => {
    const html = renderToStaticMarkup(<ConfirmDialog title="ลบ?" message="แน่ใจไหม" confirmLabel="ลบ" danger onConfirm={noop} onCancel={noop} />)
    assert.ok(html.includes('role="alertdialog"'))
    assert.ok(html.includes('aria-modal="true"'))
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)![1]!
    const described = /aria-describedby="([^"]+)"/.exec(html)![1]!
    assert.notEqual(labelled, described)
    assert.ok(html.includes(`id="${labelled}"`))
    assert.ok(html.includes(`id="${described}"`))
    assert.ok(!html.includes("disabled"))
  })

  test("ต่อสายจริง: ล็อกการเลื่อนหน้า, คืนโฟกัสให้ผู้เปิด, เฝ้า focusin, ยกเลิกด้วย Esc ผ่าน dialogKeyAction, ใช้ปุ่มยกเลิกเป็นโฟกัสแรกเมื่ออันตราย", () => {
    const src = readFileSync(new URL("./ConfirmDialog.tsx", import.meta.url), "utf8")
    assert.match(src, /document\.body\.style\.overflow = "hidden"/)
    assert.match(src, /document\.body\.style\.overflow = overflow/)
    assert.match(src, /opener\.focus\(\)/)
    assert.match(src, /addEventListener\("focusin"/)
    assert.match(src, /removeEventListener\("focusin"/)
    assert.match(src, /dialogKeyAction\(/)
    assert.match(src, /\(danger \? cancelRef : confirmRef\)\.current\?\.focus\(\)/)
    assert.match(src, /await onConfirm\(\)/)
  })
})

describe("ConfirmDialog (ตัวมี state): ค่าเริ่มต้นและค่าที่ส่งต่อ", () => {
  const render = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) =>
    renderToStaticMarkup(<ConfirmDialog title="ชื่อ" message="ข้อความ" confirmLabel="ตกลง" onConfirm={noop} onCancel={noop} {...props} />)

  test("ไม่ระบุอะไรเพิ่ม: ปุ่มยกเลิกชื่อ \"ยกเลิก\" และไม่ใช่การกระทำอันตราย (ปุ่มยืนยันเป็นปุ่มเด่น ไม่ใช่สีแดง)", () => {
    const html = render()
    assert.match(html, /<button[^>]*class="btn ghost"[^>]*>ยกเลิก<\/button>/)
    assert.match(html, /<button[^>]*class="btn primary"[^>]*>ตกลง<\/button>/)
    assert.ok(!html.includes("btn danger"))
  })

  test("danger → ปุ่มยืนยันสีแดง · cancelLabel ตั้งเองได้", () => {
    const html = render({ danger: true, cancelLabel: "ปิด" })
    assert.match(html, /<button[^>]*class="btn danger"[^>]*>ตกลง<\/button>/)
    assert.match(html, /<button[^>]*class="btn ghost"[^>]*>ปิด<\/button>/)
  })
})
