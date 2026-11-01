import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Route, Routes } from "react-router"
import { all, one, text, type El } from "../testing/dom"
import { loadedSite, renderPage } from "../testing/render"
import { Layout } from "./Layout"

const page = (path = "/", state = loadedSite()) =>
  renderPage(
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<p className="page-body">เนื้อหาหน้าแรก</p>} />
        <Route path="about" element={<p className="page-body">เนื้อหาเกี่ยวกับ</p>} />
      </Route>
    </Routes>,
    { path, state },
  )
const elementChildren = (el: El) => el.children.filter((child): child is El => typeof child !== "string")

describe("Layout", () => {
  test("โครงหน้า: ลิงก์ข้ามไปเนื้อหา → แถบบน → เนื้อหาหลัก → ท้ายเว็บ (ตามลำดับ)", () => {
    const root = page()
    const top = elementChildren(root).map((el) => el.tag)
    assert.deepEqual(top, ["a", "header", "main", "footer"])
  })

  test("ลิงก์ข้ามไปเนื้อหาเป็นสิ่งแรกที่ Tab ถึง และชี้ไปที่ main (ผู้ใช้คีย์บอร์ดไม่ต้อง Tab ผ่านเมนูทุกหน้า)", () => {
    const skip = one(page(), "a.skip-link")
    assert.equal(skip.attrs.href, "#main")
    assert.equal(text(skip).trim(), "ข้ามไปยังเนื้อหาหลัก")
    const main = one(page(), "main")
    assert.equal(main.attrs.id, "main")
    assert.equal(main.attrs.tabindex, "-1") // โฟกัสได้ด้วยโปรแกรมแต่ไม่อยู่ในลำดับ Tab
  })

  test("มี landmark อย่างละหนึ่ง (banner, main, contentinfo)", () => {
    const root = page()
    assert.equal(all(root, "header").length, 1)
    assert.equal(all(root, "main").length, 1)
    assert.equal(all(root, "footer").length, 1)
  })

  test("หน้าลูกที่เข้ากับที่อยู่ปัจจุบันถูกวางในเนื้อหาหลัก (ไม่ใช่ในแถบบนหรือท้ายเว็บ)", () => {
    const root = page("/")
    assert.equal(text(one(one(root, "main"), "p.page-body")), "เนื้อหาหน้าแรก")
    assert.equal(all(one(root, "header"), "p.page-body").length, 0)
    assert.equal(all(one(root, "footer"), "p.page-body").length, 0)
    assert.equal(text(one(one(page("/about"), "main"), "p.page-body")), "เนื้อหาเกี่ยวกับ")
  })

  test("เนื้อหาหลักอยู่ในกรอบกว้างมาตรฐานของเว็บ (คลาส wrap)", () => {
    assert.match(one(page(), "main").attrs.class ?? "", /\bwrap\b/)
  })

  test("แถบบนกับท้ายเว็บใช้ข้อมูลเว็บชุดเดียวกัน", () => {
    const root = page("/", loadedSite({ siteName: "คลังนิยาย" }))
    assert.deepEqual(
      all(root, "span.logo-name").map((n) => text(n)),
      ["คลังนิยาย", "คลังนิยาย"],
    )
  })
})
