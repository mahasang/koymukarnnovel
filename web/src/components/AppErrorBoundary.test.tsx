import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { all, one, parse, text } from "../testing/dom"
import { findTag, handlerOf, type AnyElement } from "../testing/elements"
import { AppErrorBoundary, CrashFallback } from "./AppErrorBoundary"

const noop = () => {}
type Props = ConstructorParameters<typeof AppErrorBoundary>[0]
const make = (over: Partial<Props> = {}) => new AppErrorBoundary({ resetKey: "/", children: <p>ปกติ</p>, ...over })

describe("CrashFallback (หน้าแจ้งปัญหาแทนหน้าขาว)", () => {
  test("แจ้งแบบ alert พร้อมคำแนะนำและปุ่มโหลดใหม่ — ไม่ปล่อยข้อความทางเทคนิคให้ผู้อ่าน", () => {
    const root = parse(renderToStaticMarkup(<CrashFallback onReload={noop} />))
    const box = one(root, "div.state.state-error")
    assert.equal(box.attrs.role, "alert")
    assert.equal(one(box, "div.state-icon").attrs["aria-hidden"], "true")
    assert.equal(text(one(box, "h2.state-title")), "หน้านี้แสดงผลไม่สำเร็จ")
    assert.match(text(one(box, "p.state-message")), /โหลดหน้านี้ใหม่/)
    const buttons = all(box, "button")
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0]?.attrs.type, "button")
    assert.equal(text(buttons[0]!).trim(), "โหลดหน้านี้ใหม่")
  })

  test("กดปุ่ม → onReload", () => {
    let reloads = 0
    const element = CrashFallback({ onReload: () => reloads++ })
    handlerOf(findTag(element, "button"), "onClick")()
    assert.equal(reloads, 1)
  })

  test("อยู่ในกรอบกว้างมาตรฐาน (คลาส wrap) เพราะอาจแสดงโดยไม่มีแถบบน/Layout", () => {
    assert.match(one(parse(renderToStaticMarkup(<CrashFallback onReload={noop} />)), "div.wrap").attrs.class ?? "", /\bwrap\b/)
  })
})

describe("AppErrorBoundary", () => {
  test("ไม่มีปัญหา → แสดงลูกตามเดิม ไม่มีอะไรเพิ่ม", () => {
    assert.equal(
      renderToStaticMarkup(
        <AppErrorBoundary resetKey="/">
          <p>ปกติ</p>
        </AppErrorBoundary>,
      ),
      "<p>ปกติ</p>",
    )
  })

  test("เริ่มต้นยังไม่มี error", () => {
    assert.equal(make().state.error, null)
  })

  test("getDerivedStateFromError เก็บ Error ที่เกิด (ค่าที่ไม่ใช่ Error ถูกห่อเป็น Error)", () => {
    const boom = new Error("boom")
    assert.equal(AppErrorBoundary.getDerivedStateFromError(boom).error, boom)
    const wrapped = AppErrorBoundary.getDerivedStateFromError("ข้อความ").error
    assert.ok(wrapped instanceof Error)
    assert.equal(wrapped.message, "ข้อความ")
  })

  test("มี error → แสดงหน้าแจ้งปัญหาแทนลูก; ปุ่มโหลดใหม่เรียก onReload ที่ส่งมา", () => {
    let reloads = 0
    const boundary = make({ onReload: () => reloads++ })
    boundary.state = { error: new Error("x") }
    const element = boundary.render() as AnyElement
    assert.equal(element.type, CrashFallback)
    assert.notEqual(element.props.children, boundary.props.children)
    handlerOf(element, "onReload")()
    assert.equal(reloads, 1)
  })

  test("ไม่ส่ง onReload → ปุ่มโหลดใหม่สั่งเบราว์เซอร์โหลดหน้านี้ใหม่ (window.location.reload)", () => {
    const g = globalThis as { window?: unknown }
    const before = g.window
    let reloads = 0
    g.window = { location: { reload: () => reloads++ } }
    try {
      const boundary = make()
      boundary.state = { error: new Error("x") }
      handlerOf(boundary.render() as AnyElement, "onReload")()
      assert.equal(reloads, 1)
    } finally {
      if (before === undefined) delete g.window
      else g.window = before
    }
  })

  test("ไม่มี error → render() คืนลูกที่ได้รับ", () => {
    const children = <p>ปกติ</p>
    assert.equal(make({ children }).render(), children)
  })

  test("เปลี่ยนที่อยู่ (resetKey) ตอนมี error → ล้าง error ให้ลองหน้าใหม่ได้", () => {
    const boundary = make({ resetKey: "/novel/1" })
    boundary.state = { error: new Error("x") }
    const calls: unknown[] = []
    boundary.setState = ((update: unknown) => calls.push(update)) as typeof boundary.setState
    boundary.componentDidUpdate({ resetKey: "/", children: null })
    assert.deepEqual(calls, [{ error: null }])
  })

  test("ที่อยู่เดิม หรือไม่มี error → ไม่ล้างอะไร (กันวนเรนเดอร์ซ้ำ)", () => {
    const boundary = make({ resetKey: "/a" })
    const calls: unknown[] = []
    boundary.setState = ((update: unknown) => calls.push(update)) as typeof boundary.setState
    boundary.state = { error: new Error("x") }
    boundary.componentDidUpdate({ resetKey: "/a", children: null }) // ที่อยู่เดิม
    boundary.state = { error: null }
    boundary.componentDidUpdate({ resetKey: "/b", children: null }) // เปลี่ยนที่อยู่แต่ไม่มี error
    assert.deepEqual(calls, [])
  })
})
