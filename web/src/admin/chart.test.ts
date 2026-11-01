import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { barGeometry, chartSummary, dayOfMonth, totalViews } from "./chart"

describe("barGeometry", () => {
  it("สูงตามสัดส่วนของค่าสูงสุด: แท่งสูงสุดเต็มความสูง ครึ่งหนึ่งได้ครึ่ง ศูนย์ได้ 0", () => {
    const bars = barGeometry([0, 5, 10], 300, 100)
    assert.equal(bars.length, 3)
    assert.equal(bars[0].h, 0)
    assert.equal(bars[1].h, 50)
    assert.equal(bars[2].h, 100)
  })

  it("ทุกแท่งตั้งบนเส้นฐานเดียวกัน (y + h = ความสูง)", () => {
    for (const bar of barGeometry([0, 5, 10], 300, 100)) assert.equal(bar.y + bar.h, 100)
    for (const bar of barGeometry([3, 1, 4, 1, 5, 9, 2, 6], 320, 80, 4)) assert.ok(Math.abs(bar.y + bar.h - 80) < 1e-9)
  })

  it("แท่งไม่ซ้อนกัน อยู่ในกรอบ และเรียงซ้ายไปขวา", () => {
    const bars = barGeometry([0, 5, 10], 300, 100)
    for (let i = 0; i < bars.length; i++) {
      assert.ok(bars[i].w > 0)
      assert.ok(bars[i].x >= 0)
      assert.ok(bars[i].x + bars[i].w <= 300)
      if (i > 0) assert.ok(bars[i - 1].x + bars[i - 1].w <= bars[i].x, `แท่ง ${i - 1} ซ้อนแท่ง ${i}`)
    }
  })

  it("ช่องว่าง (gap) คือระยะระหว่างแท่ง และแท่งอยู่กลางช่องของตัวเอง (ให้ป้ายวันที่ใต้กราฟตรงแท่ง)", () => {
    const [a, b] = barGeometry([1, 1], 200, 50, 10)
    assert.equal(a.w, 90)
    assert.equal(b.x - (a.x + a.w), 10)
    assert.equal(a.x, 5)
    assert.equal(b.x + b.w, 195)
  })

  it("ค่าเริ่มต้นของ gap คือ 8", () => {
    const [a, b] = barGeometry([1, 1], 200, 50)
    assert.equal(b.x - (a.x + a.w), 8)
  })

  it("ศูนย์ทั้งหมด: ไม่มี NaN และทุกแท่งสูง 0", () => {
    const bars = barGeometry([0, 0], 300, 100)
    assert.equal(bars.length, 2)
    for (const bar of bars) {
      for (const value of [bar.x, bar.y, bar.w, bar.h]) assert.ok(Number.isFinite(value), `ได้ ${value}`)
      assert.equal(bar.h, 0)
      assert.equal(bar.y, 100)
    }
  })

  it("ไม่มีข้อมูลเลย → ไม่มีแท่ง", () => {
    assert.deepEqual(barGeometry([], 300, 100), [])
  })

  it("ค่าที่ใช้ไม่ได้ (ลบ NaN อินฟินิตี้) นับเป็น 0 ไม่ทำให้แท่งอื่นเพี้ยน", () => {
    const bars = barGeometry([-5, Number.NaN, Number.POSITIVE_INFINITY, 10], 400, 100)
    assert.deepEqual(
      bars.map((bar) => bar.h),
      [0, 0, 0, 100]
    )
    for (const bar of bars) for (const value of [bar.x, bar.y, bar.w, bar.h]) assert.ok(Number.isFinite(value))
  })

  it("gap ที่กว้างเกินช่อง ไม่ทำให้แท่งหายหรือติดลบ", () => {
    for (const bar of barGeometry([1, 2, 3], 30, 10, 50)) {
      assert.ok(bar.w > 0)
      assert.ok(bar.x >= 0)
    }
    for (const bar of barGeometry([1, 2, 3], 300, 10, -5)) assert.ok(bar.w > 0)
  })

  it("ขนาดผิดปกติ (กว้าง/สูง 0 หรือ NaN) ไม่ทำให้เกิด NaN", () => {
    for (const [w, h] of [
      [0, 0],
      [Number.NaN, 100],
      [100, Number.NaN]
    ]) {
      for (const bar of barGeometry([1, 2, 3], w, h)) for (const value of [bar.x, bar.y, bar.w, bar.h]) assert.ok(Number.isFinite(value), `${w}x${h} ได้ ${value}`)
    }
  })

  it("ค่าเล็กสุด 1 ก็ได้แท่งที่มองเห็น (ไม่ถูกปัดเป็น 0) และสัดส่วนตรงตามจริง", () => {
    const bars = barGeometry([1, 2], 100, 10, 0)
    assert.deepEqual(
      bars.map((bar) => bar.h),
      [5, 10]
    )
    assert.equal(barGeometry([1], 100, 10)[0].h, 10)
  })

  it("gap: 0 คือไม่เว้นเลย · ค่าติดลบ/NaN ถือเป็น 0 (ไม่ใช่ค่าเริ่มต้น) · gap ที่ใหญ่เกินถูกตรึงที่ครึ่งช่อง", () => {
    const exact = (gap: number) => barGeometry([1, 1], 100, 10, gap).map((bar) => [bar.x, bar.w])
    assert.deepEqual(exact(0), [[0, 50], [50, 50]])
    assert.deepEqual(exact(-10), [[0, 50], [50, 50]])
    assert.deepEqual(exact(Number.NaN), [[0, 50], [50, 50]])
    assert.deepEqual(exact(1000), [[12.5, 25], [62.5, 25]]) // ช่องละ 50 → เว้นสูงสุด 25
  })

  it("กรอบกว้าง/สูงที่ใช้ไม่ได้ (NaN, อินฟินิตี้, ติดลบ) ได้กรอบขนาด 0 ไม่ใช่ค่าเพี้ยน", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -50]) {
      assert.deepEqual(barGeometry([1, 2], bad, 100), [
        { x: 0, y: 50, w: 0, h: 50 },
        { x: 0, y: 0, w: 0, h: 100 }
      ])
      assert.deepEqual(barGeometry([1, 2], 100, bad), [
        { x: 4, y: 0, w: 42, h: 0 },
        { x: 54, y: 0, w: 42, h: 0 }
      ])
    }
  })

  it("ไม่แก้อาร์เรย์ที่ส่งเข้ามา", () => {
    const counts = [3, 0, 7]
    barGeometry(counts, 300, 100)
    assert.deepEqual(counts, [3, 0, 7])
  })
})

describe("ตัวช่วยของกราฟ", () => {
  it("dayOfMonth: เลขวันที่ของเดือนจาก YYYY-MM-DD (ไม่มีศูนย์นำหน้า)", () => {
    assert.equal(dayOfMonth("2026-10-31"), "31")
    assert.equal(dayOfMonth("2026-10-05"), "5")
    assert.equal(dayOfMonth("2026-01-01"), "1")
  })

  it("dayOfMonth: รูปแบบผิด → สตริงว่าง", () => {
    assert.equal(dayOfMonth(""), "")
    assert.equal(dayOfMonth("31/10/2026"), "")
    assert.equal(dayOfMonth("2026-13-45"), "")
  })

  it("dayOfMonth: ต้องตรงรูปแบบ 4-2-2 หลักทั้งสตริง และเป็นวันที่ที่มีจริงในปฏิทิน", () => {
    for (const bad of ["x2026-10-05", "2026-10-05x", "2026-10-05 ", " 2026-10-05", "2026-1-05", "2026-10-5", "26-10-05", "2026-02-30", "2026-04-31", "2026-00-10", "2026-10-00", "0099-01-05"]) {
      assert.equal(dayOfMonth(bad), "", bad)
    }
    assert.equal(dayOfMonth("2028-02-29"), "29") // ปีอธิกสุรทิน
    assert.equal(dayOfMonth("2026-02-28"), "28")
  })

  it("totalViews: รวมทุกวัน และข้ามค่าที่ใช้ไม่ได้", () => {
    assert.equal(totalViews([]), 0)
    assert.equal(
      totalViews([
        { day: "2026-10-30", count: 4 },
        { day: "2026-10-31", count: 11 }
      ]),
      15
    )
    assert.equal(totalViews([{ day: "x", count: Number.NaN }, { day: "y", count: -3 }, { day: "z", count: 2 }]), 2)
  })

  it("chartSummary: บอกยอดรวมและวันที่สูงสุดเป็นข้อความให้โปรแกรมอ่านหน้าจอ", () => {
    const text = chartSummary([
      { day: "2026-10-29", count: 3 },
      { day: "2026-10-30", count: 9 },
      { day: "2026-10-31", count: 0 }
    ])
    assert.match(text, /ยอดอ่าน 3 วัน/)
    assert.match(text, /รวม 12 ครั้ง/)
    assert.match(text, /สูงสุด 9 ครั้ง วันที่ 30/)
  })

  it("chartSummary: ถ้าสูงสุดซ้ำกันหลายวัน เลือกวันล่าสุด; ศูนย์ทั้งหมดบอกว่ายังไม่มียอดอ่าน", () => {
    const tie = chartSummary([
      { day: "2026-10-29", count: 9 },
      { day: "2026-10-30", count: 9 }
    ])
    assert.match(tie, /วันที่ 30/)
    assert.match(chartSummary([{ day: "2026-10-31", count: 0 }]), /ยังไม่มียอดอ่าน/)
    assert.match(chartSummary([]), /ยังไม่มียอดอ่าน/)
  })

  it("จำนวนในข้อความแบ่งหลักพันด้วยจุลภาค (ทั้งยอดรวมและยอดสูงสุด)", () => {
    assert.match(chartSummary([{ day: "2026-10-31", count: 12345 }]), /รวม 12,345 ครั้ง/)
    assert.equal(
      chartSummary([
        { day: "2026-10-30", count: 1234 },
        { day: "2026-10-31", count: 5 }
      ]),
      "ยอดอ่าน 2 วันล่าสุด รวม 1,239 ครั้ง สูงสุด 1,234 ครั้ง วันที่ 30"
    )
  })

  it("chartSummary: ข้อความเต็ม (ไม่ใช่แค่บางส่วน)", () => {
    assert.equal(
      chartSummary([
        { day: "2026-10-29", count: 3 },
        { day: "2026-10-30", count: 9 },
        { day: "2026-10-31", count: 0 }
      ]),
      "ยอดอ่าน 3 วันล่าสุด รวม 12 ครั้ง สูงสุด 9 ครั้ง วันที่ 30"
    )
    assert.equal(chartSummary([{ day: "2026-10-31", count: 0 }]), "ยอดอ่าน 1 วันล่าสุด ยังไม่มียอดอ่าน")
    assert.equal(chartSummary([]), "ยอดอ่าน 0 วันล่าสุด ยังไม่มียอดอ่าน")
  })
})
