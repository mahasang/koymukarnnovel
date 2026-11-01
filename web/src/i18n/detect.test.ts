import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { detectLocale, initialLocale, isLocale } from "./detect"

describe("isLocale", () => {
  test("รับเฉพาะ th / en / lo", () => {
    assert.equal(isLocale("th"), true)
    assert.equal(isLocale("en"), true)
    assert.equal(isLocale("lo"), true)
    assert.equal(isLocale("fr"), false)
    assert.equal(isLocale("TH"), false)
    assert.equal(isLocale({}), false)
    assert.equal(isLocale(null), false)
  })
})

describe("detectLocale", () => {
  test("เอาตัวแรกในรายการภาษาเบราว์เซอร์ที่ขึ้นต้น th / lo / en", () => {
    assert.equal(detectLocale(["th-TH", "en"]), "th")
    assert.equal(detectLocale(["fr", "lo-LA"]), "lo")
    assert.equal(detectLocale(["en-US"]), "en")
    assert.equal(detectLocale(["LO", "en"]), "lo")
  })
  test("ไม่ตรงเลข → null (ผู้เรียกใช้ไทย)", () => {
    assert.equal(detectLocale(["fr"]), null)
    assert.equal(detectLocale([]), null)
    assert.equal(detectLocale(undefined), null)
  })
  test("ไม่ใช่รหัสภาษาที่แค่ขึ้นต้นเหมือนกัน (thx, english)", () => {
    assert.equal(detectLocale(["thx"]), null)
    assert.equal(detectLocale(["english"]), null)
  })
})

describe("initialLocale", () => {
  test("ค่าที่จำไว้ชนะการตรวจจับ", () => {
    assert.equal(initialLocale("lo", ["th"]), "lo")
  })
  test("ค่าที่จำไว้ใช้ไม่ได้ (ไม่ใช่ locale / ไม่ใช่ข้อความ) → ตรวจจับใหม่", () => {
    assert.equal(initialLocale("fr", ["en"]), "en")
    assert.equal(initialLocale({}, ["lo"]), "lo")
  })
  test("ตรวจจับไม่ได้ด้วย → ไทย", () => {
    assert.equal(initialLocale({}, undefined), "th")
    assert.equal(initialLocale(null, ["fr"]), "th")
  })
})
