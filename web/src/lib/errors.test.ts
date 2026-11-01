import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MESSAGES } from "../i18n/messages"
import { errorHint, errorText } from "./errors"

const th = MESSAGES.th

describe("errorHint", () => {
  test("ไม่ได้คำตอบเลย (status 0 = เครือข่ายล่ม) → ให้ตรวจอินเทอร์เน็ต", () => {
    assert.equal(errorHint(0, th), th.errors.networkHint)
    assert.equal(th.errors.networkHint, "ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง")
  })

  test("เซิร์ฟเวอร์ผิดพลาดฝั่งตัวเอง (500–599) → ให้ลองใหม่ในอีกสักครู่ รวมทั้งขอบ 500 และ 599", () => {
    for (const status of [500, 501, 502, 503, 504, 599]) assert.equal(errorHint(status, th), th.errors.serverHint, String(status))
    assert.equal(th.errors.serverHint, "เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่")
  })

  test("ข้อผิดพลาดอื่น (4xx, 3xx) ไม่มีคำแนะนำเพิ่ม — ข้อความของเซิร์ฟเวอร์บอกอยู่แล้ว; ขอบ 499 และ 600 ไม่นับเป็น 5xx", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 499, 600, 301, 200, -1]) assert.equal(errorHint(status, th), null, String(status))
  })
})

describe("errorHint (หลายภาษา)", () => {
  test("คำแนะนำตามภาษาของผู้อ่าน", () => {
    assert.equal(errorHint(0, MESSAGES.lo), MESSAGES.lo.errors.networkHint)
    assert.equal(errorHint(503, MESSAGES.en), MESSAGES.en.errors.serverHint)
    assert.notEqual(MESSAGES.lo.errors.networkHint, th.errors.networkHint)
    assert.equal(errorHint(404, MESSAGES.lo), null)
  })
})

describe("errorText", () => {
  const server = { code: "not_found", message: "ไม่พบนิยายเรื่องนี้" }
  test("ไทย: แสดงข้อความไทยของเซิร์ฟเวอร์ตามเดิมเสมอ แม้รหัสอยู่ในตาราง (ข้อความของรหัสเดียวกันต่างกันได้)", () => {
    assert.equal(errorText(server, th), "ไม่พบนิยายเรื่องนี้")
  })
  test("อังกฤษ/ลาว: รหัสที่รู้จักได้ข้อความตามภาษา", () => {
    assert.equal(errorText(server, MESSAGES.en), MESSAGES.en.errors.byCode.not_found)
    assert.equal(errorText(server, MESSAGES.lo), MESSAGES.lo.errors.byCode.not_found)
    assert.notEqual(MESSAGES.lo.errors.byCode.not_found, server.message)
  })
  test("รหัสที่ไม่รู้จักหรือไม่มีรหัส → ข้อความไทยของเซิร์ฟเวอร์ ไม่เป็นข้อความว่าง", () => {
    assert.equal(errorText({ code: "weird_new_code", message: "ข้อความไทย" }, MESSAGES.lo), "ข้อความไทย")
    assert.equal(errorText({ message: "ข้อความไทย" }, MESSAGES.en), "ข้อความไทย")
  })
  test("ตารางรหัสครอบคลุมรหัสที่ผู้อ่านพบได้ และรหัสที่เว็บสร้างเอง", () => {
    for (const code of ["not_found", "rate_limited", "internal_error", "bad_request", "method_not_allowed", "web_not_built", "network", "unknown_reply", "http_error", "load_failed"]) {
      assert.ok(code in MESSAGES.th.errors.byCode, code)
    }
  })
})
