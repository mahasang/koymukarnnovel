import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { NETWORK_HINT, SERVER_HINT, errorHint } from "./errors"

describe("errorHint", () => {
  test("ไม่ได้คำตอบเลย (status 0 = เครือข่ายล่ม) → ให้ตรวจอินเทอร์เน็ต", () => {
    assert.equal(errorHint(0), NETWORK_HINT)
    assert.equal(NETWORK_HINT, "ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง")
  })

  test("เซิร์ฟเวอร์ผิดพลาดฝั่งตัวเอง (500–599) → ให้ลองใหม่ในอีกสักครู่ รวมทั้งขอบ 500 และ 599", () => {
    for (const status of [500, 501, 502, 503, 504, 599]) assert.equal(errorHint(status), SERVER_HINT, String(status))
    assert.equal(SERVER_HINT, "เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่")
  })

  test("ข้อผิดพลาดอื่น (4xx, 3xx) ไม่มีคำแนะนำเพิ่ม — ข้อความของเซิร์ฟเวอร์บอกอยู่แล้ว; ขอบ 499 และ 600 ไม่นับเป็น 5xx", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 499, 600, 301, 200, -1]) assert.equal(errorHint(status), null, String(status))
  })
})
