import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { isNew, resumePercent, thaiDate } from "./format"

/** `YYYY-MM-DD HH:MM:SS` ที่เซิร์ฟเวอร์ส่งมาเป็นเวลา UTC เสมอ (ไม่ใช่เวลาของเครื่องผู้อ่าน) — เทสต์ทั้งหมดสร้างเวลาปัจจุบันด้วย Date.UTC ไม่พึ่งเขตเวลาของเครื่องที่รัน */

const DAY = 24 * 60 * 60 * 1000
const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s)

describe("isNew", () => {
  test("ปรับปรุงเมื่อ 2 วันก่อน → ใหม่; 4 วันก่อน → ไม่ใหม่", () => {
    const now = Date.UTC(2026, 9, 22)
    assert.equal(isNew("2026-10-20 00:00:00", now), true)
    assert.equal(isNew("2026-10-18 00:00:00", now), false)
  })

  test("เส้นแบ่งคือ 3 วันเต็ม (72 ชั่วโมง) นับรวมขอบ: พอดี 3 วัน → ใหม่, เกินไปแค่ 1 วินาที → ไม่ใหม่", () => {
    const now = utc(2026, 10, 22, 12, 0, 0)
    assert.equal(isNew("2026-10-19 12:00:00", now), true)
    assert.equal(isNew("2026-10-19 11:59:59", now), false)
    assert.equal(isNew("2026-10-19 12:00:01", now), true)
  })

  test("เพิ่งปรับปรุงเมื่อสักครู่ → ใหม่; เวลาเป็นอนาคต (นาฬิกาเครื่องผู้อ่านช้ากว่าเซิร์ฟเวอร์) ก็นับว่าใหม่", () => {
    const now = utc(2026, 10, 22, 12, 0, 0)
    assert.equal(isNew("2026-10-22 12:00:00", now), true)
    assert.equal(isNew("2026-10-22 12:00:01", now), true)
    assert.equal(isNew("2026-10-30 00:00:00", now), true)
  })

  test("ไม่ส่งเวลาปัจจุบัน → ใช้นาฬิกาจริง", () => {
    const sql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ")
    assert.equal(isNew(sql(Date.now() - DAY)), true)
    assert.equal(isNew(sql(Date.now() - 10 * DAY)), false)
  })

  test("รูปแบบเวลาที่ไม่ถูกต้อง → ไม่ใหม่ (ไม่โยน ไม่เดา)", () => {
    const now = utc(2026, 10, 22)
    for (const bad of [
      "",
      "garbage",
      "2026-10-21",
      "2026-10-21T00:00:00Z",
      "2026-10-21 00:00",
      " 2026-10-21 00:00:00",
      "2026-10-21 00:00:00 ",
      "2026-10-21 00:00:00.000",
      "26-10-21 00:00:00",
      "12026-10-21 00:00:00",
      "2026-1-21 00:00:00",
      "2026-10-1 00:00:00",
      "2026-10-21 0:00:00",
      "2026-10-21 00:0:00",
      "2026-10-21 00:00:0",
      "2026-02-30 00:00:00",
      "2026-13-01 00:00:00",
      "2026-00-10 00:00:00",
      "2026-10-00 00:00:00",
      "2026-10-32 00:00:00",
      "2026-10-21 24:00:00",
      "2026-10-21 00:60:00",
      "2026-10-21 00:00:60",
      "0099-10-21 00:00:00",
    ]) {
      assert.equal(isNew(bad, now), false, JSON.stringify(bad))
    }
  })

  test("รูปแบบผิดเป็น false เสมอ ไม่ขึ้นกับนาฬิกา (แม้ตั้ง now เป็น 0)", () => {
    assert.equal(isNew("garbage", 0), false)
    assert.equal(isNew("", 0), false)
  })

  test("ปีอธิกสุรทินถูกต้อง: 29 ก.พ. 2028 มีจริง แต่ 29 ก.พ. 2027 ไม่มี", () => {
    const now = utc(2028, 3, 1)
    assert.equal(isNew("2028-02-29 00:00:00", now), true)
    assert.equal(isNew("2027-02-29 00:00:00", now), false)
  })
})

describe("resumePercent", () => {
  test("round(เลขตอน ÷ ตอนล่าสุด × 100): 5/20 = 25", () => {
    assert.equal(resumePercent(5, 20), 25)
    assert.equal(resumePercent(20, 20), 100)
    assert.equal(resumePercent(0, 20), 0)
  })

  test("เกินตอนล่าสุดถูกตรึงที่ 100 (30/20 = 100)", () => {
    assert.equal(resumePercent(30, 20), 100)
  })

  test("ยังไม่มีตอนเลย (ตอนล่าสุดเป็น 0) → 0 ไม่ใช่ Infinity/NaN", () => {
    assert.equal(resumePercent(1, 0), 0)
    assert.equal(resumePercent(0, 0), 0)
  })

  test("ปัดเศษแบบมาตรฐาน (ครึ่งปัดขึ้น)", () => {
    assert.equal(resumePercent(1, 3), 33)
    assert.equal(resumePercent(2, 3), 67)
    assert.equal(resumePercent(1, 8), 13)
    assert.equal(resumePercent(1, 200), 1)
  })

  test("ค่าที่ไม่สมเหตุสมผล → ตรึงในช่วง 0–100: เลขตอนติดลบ → 0, ตอนล่าสุดติดลบ → 0, NaN → 0", () => {
    assert.equal(resumePercent(-3, 20), 0)
    assert.equal(resumePercent(5, -20), 0)
    assert.equal(resumePercent(Number.NaN, 20), 0)
    assert.equal(resumePercent(5, Number.NaN), 0)
  })
})

describe("thaiDate", () => {
  test("วัน เดือนย่อ ปี พ.ศ. เช่น 22 ต.ค. 2569", () => {
    assert.equal(thaiDate("2026-10-22 03:00:00"), "22 ต.ค. 2569")
  })

  test("ชื่อเดือนย่อครบทั้ง 12 เดือน", () => {
    const expected = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    expected.forEach((name, i) => {
      const month = String(i + 1).padStart(2, "0")
      assert.equal(thaiDate(`2026-${month}-15 00:00:00`), `15 ${name} 2569`)
    })
  })

  test("วันที่ไม่เติมศูนย์นำหน้า", () => {
    assert.equal(thaiDate("2026-11-05 03:00:00"), "5 พ.ย. 2569")
    assert.equal(thaiDate("2026-11-01 03:00:00"), "1 พ.ย. 2569")
  })

  test("แปลงจาก UTC เป็นเวลาไทย (UTC+7) ก่อนนับวัน: 17:00 UTC ขึ้นวันใหม่ตามเวลาไทย", () => {
    assert.equal(thaiDate("2026-10-22 16:59:59"), "22 ต.ค. 2569")
    assert.equal(thaiDate("2026-10-22 17:00:00"), "23 ต.ค. 2569")
    assert.equal(thaiDate("2026-10-22 23:59:59"), "23 ต.ค. 2569")
    assert.equal(thaiDate("2026-10-23 00:00:00"), "23 ต.ค. 2569")
  })

  test("ข้ามเดือน ข้ามปี และปีอธิกสุรทินถูกต้อง", () => {
    assert.equal(thaiDate("2026-10-31 17:00:00"), "1 พ.ย. 2569")
    assert.equal(thaiDate("2026-12-31 16:59:59"), "31 ธ.ค. 2569")
    assert.equal(thaiDate("2026-12-31 17:00:00"), "1 ม.ค. 2570")
    assert.equal(thaiDate("2028-02-28 17:00:00"), "29 ก.พ. 2571")
    assert.equal(thaiDate("2028-02-29 17:00:00"), "1 มี.ค. 2571")
    assert.equal(thaiDate("2027-02-28 17:00:00"), "1 มี.ค. 2570")
  })

  test("รูปแบบเวลาที่ไม่ถูกต้อง → สตริงว่าง (ไม่แสดงอะไรดีกว่าแสดงข้อความมั่ว) ไม่โยน", () => {
    for (const bad of ["", "garbage", "2026-10-22", "2026-10-22T03:00:00Z", "2026-02-30 00:00:00", "2026-13-01 00:00:00", "2026-10-22 24:00:00", "0099-10-22 03:00:00", "12026-10-22 03:00:00", "undefined", "null"]) {
      assert.equal(thaiDate(bad), "", JSON.stringify(bad))
    }
  })
})
