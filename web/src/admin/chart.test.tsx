import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { BarChart, type DayViews } from "./chart"

/** กราฟแท่ง (SVG ล้วน): ส่วนแสดงผลไม่มี hook เรนเดอร์แล้วตรวจโครง · ตำแหน่งแท่งตรวจละเอียดใน chart.test.ts */

const days = (counts: number[], first = 18): DayViews[] => counts.map((count, i) => ({ day: `2026-10-${String(first + i).padStart(2, "0")}`, count }))
const render = (views: DayViews[]) => renderPage(<BarChart views={views} />)

describe("BarChart", () => {
  test("SVG ยืดตามกล่อง (viewBox + preserveAspectRatio none) มีชื่อบอกโปรแกรมอ่านหน้าจอเป็นสรุปยอด", () => {
    const svg = one(render(days([3, 9, 0])), "svg")
    assert.equal(svg.attrs.viewbox, "0 0 120 120") // ช่องละ 40 × 3 วัน, สูง 120
    assert.equal(svg.attrs.preserveaspectratio, "none")
    assert.equal(svg.attrs.role, "img")
    assert.match(svg.attrs["aria-label"] ?? "", /ยอดอ่าน 3 วันล่าสุด รวม 12 ครั้ง สูงสุด 9 ครั้ง วันที่ 19/)
  })

  test("หนึ่งแท่งต่อวัน: ความสูงตามสัดส่วนของค่าสูงสุด ตั้งบนเส้นฐาน และมีคำอธิบายเมื่อชี้ (วัน: จำนวน)", () => {
    const rects = all(render(days([0, 5, 10])), "rect")
    assert.equal(rects.length, 3)
    assert.deepEqual(rects.map((r) => Number(r.attrs.height)), [0, 60, 120])
    for (const r of rects) assert.equal(Number(r.attrs.y) + Number(r.attrs.height), 120)
    assert.deepEqual(rects.map((r) => text(one(r, "title"))), ["18: 0 ครั้ง", "19: 5 ครั้ง", "20: 10 ครั้ง"])
    // แท่งอยู่กลางช่องของตัวเอง ไม่ซ้อนกัน
    const xs = rects.map((r) => Number(r.attrs.x))
    const ws = rects.map((r) => Number(r.attrs.width))
    for (let i = 1; i < rects.length; i++) assert.ok(xs[i - 1] + ws[i - 1] <= xs[i])
  })

  test("ป้ายวันที่ใต้กราฟ: เลขวันของเดือนทีละช่อง ตารางแบ่งช่องเท่ากันตามจำนวนวัน ซ่อนจากโปรแกรมอ่านหน้าจอ (สรุปอยู่ที่ชื่อของ SVG แล้ว)", () => {
    const list = one(render(days([1, 2, 3, 4], 28)), "ol")
    assert.deepEqual(all(list, "li").map(text), ["28", "29", "30", "31"])
    assert.equal(list.attrs["aria-hidden"], "true")
    assert.equal(list.attrs.style, "grid-template-columns:repeat(4, minmax(0, 1fr))")
  })

  test("ข้ามเดือน: ป้ายวันที่ตามปฏิทินจริง", () => {
    const views: DayViews[] = [
      { day: "2026-10-30", count: 1 },
      { day: "2026-10-31", count: 1 },
      { day: "2026-11-01", count: 1 },
    ]
    assert.deepEqual(all(one(render(views), "ol"), "li").map(text), ["30", "31", "1"])
  })

  test("ศูนย์ทั้งหมด: บอกว่ายังไม่มียอดอ่าน (แท่งสูง 0 ดูเหมือนกราฟพัง)", () => {
    const root = render(days([0, 0, 0]))
    assert.equal(text(one(root, "p.ad-chart-empty")), "ยังไม่มียอดอ่านใน 3 วันนี้")
    assert.match(one(root, "svg").attrs["aria-label"] ?? "", /ยังไม่มียอดอ่าน/)
  })

  test("มียอดอ่านแล้ว: ไม่มีข้อความ 'ยังไม่มียอดอ่าน'", () => {
    assert.equal(all(render(days([0, 1])), "p.ad-chart-empty").length, 0)
  })

  test("ไม่มีข้อมูลวันเลย: ไม่พัง (ไม่มีแท่ง ไม่มี NaN)", () => {
    const root = render([])
    assert.equal(all(root, "rect").length, 0)
    assert.equal(one(root, "svg").attrs.viewbox, "0 0 40 120")
    assert.doesNotMatch(JSON.stringify(root), /NaN/)
  })

  test("ไล่สีของแท่งอ้างถึง gradient ที่มีอยู่ในกราฟเอง", () => {
    const root = render(days([1, 2]))
    const gradient = one(root, "linearGradient".toLowerCase())
    assert.equal(gradient.attrs.id, "ad-bar-fill")
    assert.equal(all(gradient, "stop").length, 2)
  })

  test("โครงของ SVG: คลาสของกราฟ เส้นฐานกว้างเต็มกรอบที่ก้นกราฟ แท่งมุมมน และ gradient ไล่จากบนลงล่าง", () => {
    const root = render(days([2, 4]))
    assert.equal(one(root, "div.ad-chart").attrs.class, "ad-chart")
    assert.equal(one(root, "svg").attrs.class, "ad-chart-svg")
    const base = one(root, "line")
    assert.equal(base.attrs.class, "ad-chart-base")
    assert.deepEqual([base.attrs.x1, base.attrs.y1, base.attrs.x2, base.attrs.y2], ["0", "120", "80", "120"])
    for (const rect of all(root, "rect")) {
      assert.equal(rect.attrs.class, "ad-bar")
      assert.equal(rect.attrs.rx, "3")
    }
    const gradient = one(root, "lineargradient")
    assert.deepEqual([gradient.attrs.x1, gradient.attrs.y1, gradient.attrs.x2, gradient.attrs.y2], ["0", "0", "0", "1"])
    const [top, bottom] = all(gradient, "stop")
    assert.deepEqual([top.attrs.class, top.attrs.offset], ["ad-bar-top", "0"])
    assert.deepEqual([bottom.attrs.class, bottom.attrs.offset], ["ad-bar-bottom", "1"])
    assert.equal(one(root, "ol").attrs.class, "ad-chart-days")
  })

  test("ตัวเลขในคำอธิบายเมื่อชี้แบ่งหลักพัน", () => {
    const root = render([{ day: "2026-10-31", count: 12345 }])
    assert.equal(text(one(one(root, "rect"), "title")), "31: 12,345 ครั้ง")
  })

  test("ไม่มีข้อมูลวันเลย: ตารางป้ายวันที่ยังมี 1 ช่อง (ไม่ใช่ repeat(0))", () => {
    assert.equal(one(render([]), "ol").attrs.style, "grid-template-columns:repeat(1, minmax(0, 1fr))")
  })
})
