import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { all, one, text } from "../testing/dom"
import { findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { loadedSite } from "../testing/render"
import { Login, LoginView, type LoginViewProps } from "./Login"

/** หน้าล็อกอินหลังบ้าน: ช่องรหัสเดียว · ผิดแล้วบอกตรงนั้น · การเรียกเซิร์ฟเวอร์ทดสอบใน login.test.ts */

const props = (over: Partial<LoginViewProps> = {}): LoginViewProps => ({
  siteName: "นิยายของฉัน",
  password: "",
  busy: false,
  error: null,
  inputId: "pw",
  errorId: "pw-err",
  onPassword() {},
  onSubmit() {},
  ...over,
})
const html = (over: Partial<LoginViewProps> = {}) => renderPage(<LoginView {...props(over)} />)

describe("LoginView", () => {
  test("มีช่องกรอกเดียว: รหัสผ่าน (type=password, autocomplete=current-password) ผูกกับป้ายด้วย for/id", () => {
    const root = html()
    const inputs = all(root, "input")
    assert.equal(inputs.length, 1)
    const input = inputs[0]!
    assert.equal(input.attrs.type, "password")
    assert.equal(input.attrs.autocomplete, "current-password")
    assert.equal(input.attrs.id, "pw")
    assert.equal(input.attrs.name, "password")
    const label = one(root, "label")
    assert.equal(label.attrs.for, "pw")
    assert.equal(text(label), "รหัสผ่าน")
  })

  test("หัวเรื่อง/ชื่อเว็บ/ลิงก์กลับหน้าเว็บ", () => {
    const root = html()
    assert.equal(text(one(root, "h1")), "เข้าสู่ระบบหลังบ้าน")
    assert.equal(text(one(root, ".logo-name")), "นิยายของฉัน")
    const back = all(root, "a").find((a) => a.attrs.href === "/" && text(a).includes("กลับหน้าเว็บ"))
    assert.ok(back, "ต้องมีลิงก์กลับหน้าเว็บ")
  })

  test("ปุ่มส่งเป็นปุ่มเด่นเต็มความกว้าง ข้อความ \"เข้าสู่ระบบ\"", () => {
    const button = one(html(), 'button[type="submit"]')
    assert.equal(button.attrs.class, "btn primary full")
    assert.equal(text(button), "เข้าสู่ระบบ")
    assert.equal(button.attrs.disabled, undefined)
  })

  test("ไม่มี error → ไม่มีกล่องเตือน และช่องไม่ถูกทำเครื่องหมายผิด", () => {
    const root = html()
    assert.equal(all(root, '[role="alert"]').length, 0)
    const input = one(root, "input")
    assert.equal(input.attrs["aria-invalid"], undefined)
    assert.equal(input.attrs["aria-describedby"], undefined)
  })

  test("มี error → แสดงใน role=alert ที่ผูกกับช่อง (aria-describedby) และช่องเป็น aria-invalid", () => {
    const root = html({ error: "รหัสผ่านไม่ถูกต้อง" })
    const alert = one(root, '[role="alert"]')
    assert.equal(text(alert), "รหัสผ่านไม่ถูกต้อง")
    assert.equal(alert.attrs.id, "pw-err")
    const input = one(root, "input")
    assert.equal(input.attrs["aria-invalid"], "true")
    assert.equal(input.attrs["aria-describedby"], "pw-err")
  })

  test("busy → ปุ่มถูกปิดและบอกว่ากำลังเข้า; ช่องอ่านอย่างเดียว (ไม่ปิดช่อง เพื่อไม่ให้โฟกัสหลุด)", () => {
    const root = html({ busy: true })
    const button = one(root, 'button[type="submit"]')
    assert.equal(button.attrs.disabled, "")
    assert.equal(text(button), "กำลังเข้าสู่ระบบ…")
    const input = one(root, "input")
    assert.equal(input.attrs.readonly, "")
    assert.equal(input.attrs.disabled, undefined)
  })

  test("ค่าที่กรอกอยู่ถูกแสดงในช่อง", () => {
    assert.equal(one(html({ password: "abc" }), "input").attrs.value, "abc")
  })

  test("พิมพ์ → onPassword รับข้อความ; กดส่ง → onSubmit (เรียกซ้ำผ่าน Enter ในช่องได้เพราะเป็น <form>)", () => {
    const seen: string[] = []
    let submitted = 0
    const view = LoginView(props({ onPassword: (v) => seen.push(v), onSubmit: () => submitted++ }))
    const input = findTag(view, "input")
    handlerOf(input, "onChange")({ target: { value: "x y" } })
    assert.deepEqual(seen, ["x y"])
    handlerOf(findTag(view, "form"), "onSubmit")({ preventDefault() {} })
    assert.equal(submitted, 1)
  })

  test("เปิดหน้ามาโฟกัสอยู่ที่ช่องรหัสผ่านเลย (หน้านี้มีช่องเดียว)", () => {
    assert.equal(one(html(), "input").attrs.autofocus, "")
  })

  test("ต่อสายจริง: กันการส่งฟอร์มแบบเต็มหน้า, ส่งรหัสผ่านผ่าน attemptLogin, ตั้งชื่อแท็บ, ล้มเหลวแล้วคืนโฟกัสที่ช่อง", () => {
    const src = readFileSync(new URL("./Login.tsx", import.meta.url), "utf8")
    assert.match(src, /event\.preventDefault\(\)/)
    assert.match(src, /attemptLogin\(password\)/)
    assert.match(src, /useDocumentTitle\("เข้าสู่ระบบหลังบ้าน"\)/)
    assert.match(src, /inputRef\.current\?\.focus\(\)/)
    assert.match(src, /onSuccess\(\)/)
  })
})

describe("LoginView: รายละเอียดที่ต้องไม่หลุด", () => {
  test("โลโก้พากลับหน้าเว็บ (หน้านี้ยังไม่มีเมนูหลังบ้าน จึงไม่ชี้ไป /admin ซึ่งก็คือหน้านี้เอง)", () => {
    assert.equal(one(html(), "a.logo").attrs.href, "/")
  })
  test("ฟอร์มไม่ใช้การตรวจของเบราว์เซอร์ (noValidate): ข้อความผิดพลาดมาจากแอปทั้งหมด เป็นภาษาไทย", () => {
    assert.equal(one(html(), "form").attrs.novalidate, "")
  })
})

describe("Login (ตัวมี state): ค่าที่ต่อเข้ามุมมองตอนเรนเดอร์ครั้งแรก", () => {
  test("ชื่อเว็บมาจากข้อมูลเว็บ; ยังโหลดไม่เสร็จ → koymukarnnovel · เริ่มต้นไม่ busy ไม่มีข้อความผิดพลาด", () => {
    const named = renderPage(<Login onSuccess={() => {}} />, { path: "/admin", state: loadedSite({ siteName: "นิยายของฉัน" }) })
    assert.equal(text(one(named, ".logo-name")), "นิยายของฉัน")
    assert.equal(all(named, '[role="alert"]').length, 0)
    assert.equal(text(one(named, 'button[type="submit"]')), "เข้าสู่ระบบ")
    assert.equal(one(named, 'button[type="submit"]').attrs.disabled, undefined)
    assert.equal(one(named, "input").attrs.readonly, undefined)
    const loading = renderPage(<Login onSuccess={() => {}} />, { path: "/admin", state: { site: null, loading: true, error: null } })
    assert.equal(text(one(loading, ".logo-name")), "koymukarnnovel")
  })
})
