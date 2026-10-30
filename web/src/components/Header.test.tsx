import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text, type El } from "../testing/dom"
import { loadedSite, renderPage } from "../testing/render"
import { Header, HeaderView, type HeaderViewProps } from "./Header"

const view = (over: Partial<HeaderViewProps> = {}, path = "/") => renderPage(<HeaderView siteName="koymukarnnovel" isAdmin={false} query="" {...over} />, { path })
const links = (root: El) => all(one(root, "nav"), "a").map((a) => [a.attrs.href, text(a).trim()])

describe("HeaderView", () => {
  test("แถบบนเป็น landmark banner ติดขอบบน (คลาส top) มีโลโก้ เมนู ช่องค้นหา และปุ่มธีม ตามลำดับ", () => {
    const root = view()
    const header = one(root, "header.top")
    const inner = one(header, ".in")
    const order = inner.children.filter((child): child is El => typeof child !== "string").map((child) => child.tag + (child.attrs.class ? `.${child.attrs.class.split(" ")[0]}` : ""))
    assert.deepEqual(order, ["a.logo", "nav.nav", "form.search", "div.theme-menu"])
  })

  test("โลโก้: ตัว K ในสี่เหลี่ยม (ภาพประดับ) + ชื่อเว็บ ลิงก์กลับหน้าแรก", () => {
    const logo = one(view({ siteName: "คลังนิยาย" }), "a.logo")
    assert.equal(logo.attrs.href, "/")
    const mark = one(logo, "span.mark")
    assert.equal(text(mark), "K")
    assert.equal(mark.attrs["aria-hidden"], "true")
    assert.equal(text(one(logo, "span.logo-name")), "คลังนิยาย")
    assert.equal(logo.attrs["aria-label"], undefined) // ชื่อที่เห็นเป็นชื่อของลิงก์อยู่แล้ว ไม่ซ้ำด้วยป้ายอื่น
  })

  test("ยังไม่รู้ชื่อเว็บ (siteName เป็น null ตอนกำลังโหลด) → ไม่เขียนชื่อใดๆ แต่ลิงก์ยังมีชื่อว่า 'หน้าแรก'", () => {
    const logo = one(view({ siteName: null }), "a.logo")
    assert.equal(all(logo, "span.logo-name").length, 0)
    assert.equal(logo.attrs["aria-label"], "หน้าแรก")
    assert.equal(text(one(logo, "span.mark")), "K")
  })

  test("ชื่อเว็บที่มีอักขระพิเศษของ HTML ถูก escape", () => {
    const root = view({ siteName: '<img src=x onerror="alert(1)"> & Co' })
    assert.equal(all(root, "img").length, 0)
    assert.equal(text(one(root, "span.logo-name")), '<img src=x onerror="alert(1)"> & Co')
  })

  test("เมนูหลัก: หน้าแรก เกี่ยวกับ ติดต่อ (เรียงตามนี้)", () => {
    const nav = one(view(), "nav")
    assert.equal(nav.attrs["aria-label"], "เมนูหลัก")
    assert.deepEqual(links(view()), [
      ["/", "หน้าแรก"],
      ["/about", "เกี่ยวกับ"],
      ["/contact", "ติดต่อ"],
    ])
  })

  test("หน้าปัจจุบันของเมนูถูกทำเครื่องหมาย (aria-current=page + คลาส on) เพียงรายการเดียว", () => {
    const current = (path: string) =>
      all(one(view({}, path), "nav"), "a")
        .filter((a) => a.attrs["aria-current"] === "page")
        .map((a) => [a.attrs.href, /\bon\b/.test(a.attrs.class ?? "")])
    assert.deepEqual(current("/"), [["/", true]])
    assert.deepEqual(current("/about"), [["/about", true]])
    assert.deepEqual(current("/contact"), [["/contact", true]])
    assert.deepEqual(current("/novel/3"), []) // หน้านิยายไม่ใช่รายการเมนูใด
    assert.deepEqual(current("/?q=abc"), [["/", true]]) // ค้นหาแล้วยังอยู่หน้าแรก
  })

  test("รายการเมนูที่ไม่ใช่หน้าปัจจุบันไม่มีคลาส on และไม่มี aria-current", () => {
    const others = all(one(view({}, "/about"), "nav"), "a").filter((a) => a.attrs.href !== "/about")
    assert.equal(others.length, 2)
    for (const a of others) {
      assert.equal(a.attrs["aria-current"], undefined)
      assert.equal(/\bon\b/.test(a.attrs.class ?? ""), false)
    }
  })

  test("ลิงก์หลังบ้านโผล่เฉพาะผู้ดูแล (ไปที่ /admin)", () => {
    assert.equal(all(view({ isAdmin: false }), "a[href=\"/admin\"]").length, 0)
    const admin = one(view({ isAdmin: true }), "a[href=\"/admin\"]")
    assert.match(text(admin), /หลังบ้าน/)
    assert.equal(admin.attrs.class, "admin-link")
    assert.equal(text(one(admin, "span")), "หลังบ้าน") // ข้อความอยู่ใน span: จอแคบ CSS ซ่อนเหลือแต่ไอคอน (อ่านออกเสียงได้)
    assert.equal(all(admin, "svg").length, 1)
    assert.equal(one(admin, "svg").attrs["aria-hidden"], "true")
  })

  test("ช่องค้นหาเริ่มด้วยคำค้นที่ส่งมา และมีเพียงช่องเดียวในหน้า", () => {
    const root = view({ query: "ดาวเคราะห์" })
    assert.equal(all(root, "form[role=search]").length, 1)
    assert.equal(one(root, "input[name=q]").attrs.value, "ดาวเคราะห์")
    assert.equal(one(view(), "input[name=q]").attrs.value, "")
  })

  test("ปุ่มเปลี่ยนธีมอยู่ท้ายแถบ", () => {
    const menu = one(view(), "div.theme-menu")
    assert.equal(one(menu, "button").attrs["aria-label"], "เปลี่ยนธีม")
  })
})

describe("Header (ตัวที่ดึงข้อมูลเว็บและที่อยู่ปัจจุบัน)", () => {
  const withSite = (over: Parameters<typeof loadedSite>[0], path = "/") => renderPage(<Header />, { state: loadedSite(over), path })
  const logoName = (root: El) => all(root, "span.logo-name").map((n) => text(n))

  test("โหลดข้อมูลเว็บแล้ว → ใช้ชื่อเว็บของเจ้าของ", () => {
    assert.deepEqual(logoName(withSite({ siteName: "คลังนิยาย" })), ["คลังนิยาย"])
  })

  test("ยังไม่ได้ตั้งชื่อ (ว่าง) → ชื่อสำรอง koymukarnnovel", () => {
    assert.deepEqual(logoName(withSite({ siteName: "  " })), ["koymukarnnovel"])
  })

  test("กำลังโหลดข้อมูลเว็บ → ไม่เขียนชื่อ (กันชื่อสำรองวาบก่อนชื่อจริง)", () => {
    const root = renderPage(<Header />, { state: { site: null, loading: true, error: null } })
    assert.deepEqual(logoName(root), [])
    assert.equal(one(root, "a.logo").attrs["aria-label"], "หน้าแรก")
  })

  test("โหลดข้อมูลเว็บไม่สำเร็จ → ใช้ชื่อสำรอง และไม่มีลิงก์หลังบ้าน", () => {
    const root = renderPage(<Header />, { state: { site: null, loading: false, error: null } })
    assert.deepEqual(logoName(root), ["koymukarnnovel"])
    assert.equal(all(root, "a[href=\"/admin\"]").length, 0)
  })

  test("ผู้ดูแลที่ล็อกอินอยู่เห็นลิงก์หลังบ้าน; ผู้อ่านทั่วไปไม่เห็น", () => {
    assert.equal(all(withSite({ isAdmin: true }), "a[href=\"/admin\"]").length, 1)
    assert.equal(all(withSite({ isAdmin: false }), "a[href=\"/admin\"]").length, 0)
  })

  test("หน้าแรกที่ค้นอยู่ (?q=) → ช่องค้นหาแสดงคำค้นนั้น", () => {
    const root = withSite({}, "/?q=%E0%B8%94%E0%B8%B2%E0%B8%A7")
    assert.equal(one(root, "input[name=q]").attrs.value, "ดาว")
  })

  test("หน้าอื่นที่ URL มี ?q= → ช่องค้นหาว่าง (ค้นหาเริ่มจากหน้าแรกเท่านั้น)", () => {
    assert.equal(one(withSite({}, "/about?q=abc"), "input[name=q]").attrs.value, "")
    assert.equal(one(withSite({}, "/novel/3?q=abc"), "input[name=q]").attrs.value, "")
  })

  test("หน้าแรกที่ไม่ได้ค้น → ช่องว่าง", () => {
    assert.equal(one(withSite({}, "/"), "input[name=q]").attrs.value, "")
  })
})
