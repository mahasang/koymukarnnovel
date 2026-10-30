import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { Route, Routes, matchRoutes } from "react-router"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { AdminShellView, adminRoutes, shellPhase, type MeView } from "./AdminShell"
import { ApiError } from "../lib/api"

/** เปลือกหลังบ้าน: ตรวจสิทธิ์ (me) → ล็อกอิน / ข้อผิดพลาด / โครง + เส้นทางทั้งเจ็ด */

const ready: MeView = { data: { admin: true, passwordless: false }, error: null, loading: false }
const noop = () => {}

describe("shellPhase", () => {
  test("ตาราง: 401 → login (แม้ยังมีข้อมูลเก่าค้าง = เซสชันหมดอายุ) · ข้อผิดพลาดอื่น → error · มีข้อมูล → ready · ไม่มีอะไร → loading", () => {
    const e401 = new ApiError(401, "ต้องเข้าสู่ระบบ", "unauthorized")
    const e500 = new ApiError(500, "พัง")
    const e0 = new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
    const e403 = new ApiError(403, "ห้าม", "forbidden_host")
    const me = { admin: true as const, passwordless: false }
    assert.equal(shellPhase({ data: null, error: e401, loading: false }), "login")
    assert.equal(shellPhase({ data: me, error: e401, loading: false }), "login")
    assert.equal(shellPhase({ data: null, error: e500, loading: false }), "error")
    assert.equal(shellPhase({ data: null, error: e0, loading: false }), "error")
    assert.equal(shellPhase({ data: null, error: e403, loading: false }), "error")
    assert.equal(shellPhase({ data: me, error: e500, loading: false }), "error")
    assert.equal(shellPhase({ data: me, error: null, loading: false }), "ready")
    assert.equal(shellPhase({ data: me, error: null, loading: true }), "ready", "ตรวจซ้ำอยู่เบื้องหลัง ยังใช้งานต่อได้")
    assert.equal(shellPhase({ data: null, error: null, loading: true }), "loading")
    assert.equal(shellPhase({ data: null, error: null, loading: false }), "loading")
  })
})

describe("adminRoutes: เจ็ดเส้นทางตามสเปก + ไม่พบ", () => {
  const match = (path: string) => {
    const m = matchRoutes(adminRoutes, path)
    assert.ok(m && m.length === 1, `ไม่ตรงเส้นทางใดเลย: ${path}`)
    return { page: (m[0]!.route.handle as { page: string }).page, params: m[0]!.params }
  }
  test("แต่ละที่อยู่ชี้ถูกหน้าและได้พารามิเตอร์ครบ", () => {
    assert.deepEqual(match("/"), { page: "dashboard", params: {} })
    assert.deepEqual(match("/novels"), { page: "novels", params: {} })
    assert.deepEqual(match("/novels/new"), { page: "novel-new", params: {} })
    assert.deepEqual(match("/novels/7"), { page: "novel", params: { id: "7" } })
    assert.deepEqual(match("/novels/7/chapters/70"), { page: "chapter", params: { id: "7", chapterId: "70" } })
    assert.deepEqual(match("/add"), { page: "add", params: {} })
    assert.deepEqual(match("/settings"), { page: "settings", params: {} })
  })
  test("\"new\" ไม่ถูกอ่านเป็นรหัสเรื่อง; ท้ายด้วย / ก็ตรง", () => {
    assert.equal(match("/novels/new").page, "novel-new")
    assert.equal(match("/novels/7/").page, "novel")
    assert.equal(match("/novels/").page, "novels")
  })
  test("ที่อยู่อื่น → ไม่พบ", () => {
    for (const path of ["/nope", "/novels/7/chapters", "/novels/7/chapters/70/x", "/settings/x", "/add/1"]) assert.equal(match(path).page, "not-found", path)
  })
})

describe("AdminShellView", () => {
  const at = (me: MeView, path = "/admin") =>
    renderPage(
      <Routes>
        <Route path="/admin/*" element={<AdminShellView me={me} reload={noop} />} />
      </Routes>,
      { path },
    )

  test("ยังไม่รู้สิทธิ์ → โครงกำลังโหลด (ไม่ใช่หน้าล็อกอิน ไม่กะพริบ)", () => {
    const root = at({ data: null, error: null, loading: true })
    assert.equal(all(root, ".skeleton").length, 1)
    assert.equal(all(root, ".skeleton-lines").length, 1, "โครงแบบบรรทัด (ไม่ใช่ตารางการ์ดของหน้าบ้าน)")
    assert.equal(all(root, "form").length, 0)
    assert.equal(all(root, "aside").length, 0)
  })

  test("401 → หน้าล็อกอิน (ไม่มีเมนูหลังบ้านให้เห็น)", () => {
    const root = at({ data: null, error: new ApiError(401, "ต้องเข้าสู่ระบบ", "unauthorized"), loading: false })
    assert.equal(text(one(root, "h1")), "เข้าสู่ระบบหลังบ้าน")
    assert.equal(all(root, "aside").length, 0)
    assert.equal(all(root, 'input[type="password"]').length, 1)
  })

  test("ข้อผิดพลาดอื่น → แสดงข้อความของเซิร์ฟเวอร์พร้อมปุ่มลองใหม่ (ไม่ใช่หน้าล็อกอิน)", () => {
    const root = at({ data: null, error: new ApiError(403, "หลังบ้านแบบไม่มีรหัสผ่านเปิดได้เฉพาะเครื่องนี้", "forbidden_host"), loading: false })
    assert.equal(text(one(root, ".state-message")), "หลังบ้านแบบไม่มีรหัสผ่านเปิดได้เฉพาะเครื่องนี้")
    assert.equal(text(one(root, "button")), "ลองใหม่")
    assert.equal(all(root, "form").length, 0)
  })

  test("ผ่านแล้ว → โครงหลังบ้าน + หน้าตามที่อยู่ + สถานะคิวกำลังตรวจ", () => {
    const root = at(ready, "/admin/novels")
    assert.equal(all(root, "aside.ad-side").length, 1)
    assert.equal(text(one(root, "h1")), "นิยาย")
    assert.equal(text(one(root, ".ad-queue")), "กำลังตรวจคิว…")
    assert.equal(all(root, "form").length, 0)
  })

  test("ผ่านแล้วที่ /admin → หน้าแดชบอร์ด; ที่อยู่ที่ไม่มี → \"ไม่พบหน้านี้\" ในโครงเดิมพร้อมลิงก์กลับ", () => {
    assert.equal(text(one(at(ready, "/admin"), "h1")), "แดชบอร์ด")
    const nf = at(ready, "/admin/ไม่มี")
    assert.equal(all(nf, "aside.ad-side").length, 1)
    assert.equal(text(one(nf, "h1")), "ไม่พบหน้านี้ในหลังบ้าน")
    assert.ok(all(nf, "a").some((a) => a.attrs.href === "/admin" && text(a) === "กลับแดชบอร์ด"))
  })

  test("ทุกเส้นทางที่ยังเป็นที่ว่าง: หัวเรื่องตรงหน้านั้น + ข้อความ \"ยังไม่พร้อมใช้งาน\" (ขั้นถัดไปแทนที่ทีละหน้า)", () => {
    const titles: [string, string][] = [
      ["/admin", "แดชบอร์ด"],
      ["/admin/novels", "นิยาย"],
      ["/admin/novels/new", "เพิ่มนิยายใหม่"],
      ["/admin/novels/7", "จัดการนิยาย"],
      ["/admin/novels/7/chapters/70", "แก้ไขตอน"],
      ["/admin/add", "เพิ่มตอน"],
      ["/admin/settings", "ตั้งค่า"],
    ]
    for (const [path, title] of titles) {
      const root = at(ready, path)
      assert.equal(text(one(root, "h1")), title, path)
      assert.equal(text(one(root, ".state-title")), "หน้านี้ยังไม่พร้อมใช้งาน", path)
    }
  })

  test("โหมดไม่มีรหัสผ่านส่งต่อให้โครง (ไม่มีปุ่มออกจากระบบ)", () => {
    const root = at({ ...ready, data: { admin: true, passwordless: true } })
    assert.equal(all(root, "button.ad-it").length, 0)
    assert.equal(all(at(ready), "button.ad-it").length, 1)
  })
})

describe("ต่อสายจริง", () => {
  test("AdminShell: ตรวจสิทธิ์ผ่าน admin.me, ล็อกอิน/ออกจากระบบ/คิวหมดอายุ ล้วนตรวจสิทธิ์ใหม่", () => {
    const src = readFileSync(new URL("./AdminShell.tsx", import.meta.url), "utf8")
    assert.match(src, /useFetch\("admin:me", \(\) => admin\.me\(\)\)/)
    assert.match(src, /<AdminShellView me=\{me\} reload=\{reload\} \/>/)
    assert.match(src, /<Login onSuccess=\{reload\} \/>/)
    assert.match(src, /<QueueProvider onUnauthorized=\{reload\}>/)
    assert.match(src, /onLoggedOut=\{reload\}/)
    assert.match(src, /onRetry=\{reload\}/)
  })

  test("AdminApp: แค่โหลด CSS หลังบ้านแล้วส่งออก AdminShell เป็น default (App โหลดแบบ lazy)", () => {
    const src = readFileSync(new URL("./AdminApp.tsx", import.meta.url), "utf8")
    assert.match(src, /import "\.\.\/styles\/admin\.css"/)
    assert.match(src, /export \{ AdminShell as default \} from "\.\/AdminShell"/)
    assert.equal(src.split("\n").filter((l) => /^(import|export)/.test(l)).length, 2, "ไม่มีตรรกะอื่นปนใน AdminApp")
  })
})
