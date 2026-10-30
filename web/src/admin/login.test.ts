import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { installFetch, jsonResponse, restoreGlobals } from "../testing/helpers"
import { attemptLogin } from "./login"

/** ล็อกอินจริงผ่าน admin.login (fetch ปลอม): ข้อความที่ผู้ใช้เห็นของแต่ละผลลัพธ์ */

afterEach(restoreGlobals)

describe("attemptLogin", () => {
  test("สำเร็จ → ok และส่งรหัสไปที่ POST /api/admin/login", async () => {
    const calls = installFetch(() => jsonResponse({ admin: true, passwordless: false }))
    assert.deepEqual(await attemptLogin("รหัสลับ"), { ok: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, "/api/admin/login")
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { password: "รหัสลับ" })
  })

  test("ช่องว่าง → บอกให้กรอก โดยไม่เรียกเซิร์ฟเวอร์ (ไม่เปลืองโควตาลองรหัสผิด)", async () => {
    const calls = installFetch(() => jsonResponse({}))
    assert.deepEqual(await attemptLogin(""), { ok: false, message: "กรอกรหัสผ่านก่อน" })
    assert.equal(calls.length, 0)
  })

  test("รหัสที่มีแต่ช่องว่างถือว่ากรอกแล้ว (รหัสผ่านจริงขึ้นต้น/ลงท้ายด้วยช่องว่างได้) → ส่งไปตามจริง", async () => {
    const calls = installFetch(() => jsonResponse({ admin: true, passwordless: false }))
    assert.deepEqual(await attemptLogin("   "), { ok: true })
    assert.equal(calls.length, 1)
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { password: "   " }, "ส่งตามจริง ไม่ตัดช่องว่าง")
    assert.deepEqual(await attemptLogin("  รหัส มีช่องว่าง "), { ok: true })
    assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { password: "  รหัส มีช่องว่าง " })
  })

  test("401 → \"รหัสผ่านไม่ถูกต้อง\" (ข้อความตามสเปก ไม่ว่าเซิร์ฟเวอร์เขียนว่าอะไร)", async () => {
    installFetch(() => jsonResponse({ error: "something else", code: "bad_password" }, 401))
    assert.deepEqual(await attemptLogin("ผิด"), { ok: false, message: "รหัสผ่านไม่ถูกต้อง" })
  })

  test("429 → บอกให้รอตาม retryAfterSec (วินาที/นาที)", async () => {
    installFetch(() => jsonResponse({ error: "x", code: "too_many_attempts", retryAfterSec: 45 }, 429))
    assert.deepEqual(await attemptLogin("ผิด"), { ok: false, message: "ลองรหัสผ่านผิดหลายครั้งเกินไป รอ 45 วินาที แล้วลองใหม่" })
    installFetch(() => jsonResponse({ error: "x", code: "too_many_attempts", retryAfterSec: 600 }, 429))
    assert.deepEqual(await attemptLogin("ผิด"), { ok: false, message: "ลองรหัสผ่านผิดหลายครั้งเกินไป รอ 10 นาที แล้วลองใหม่" })
  })

  test("429 ที่ไม่มีเวลารอ → รอสักครู่", async () => {
    installFetch(() => jsonResponse({ error: "x", code: "too_many_attempts" }, 429))
    assert.deepEqual(await attemptLogin("ผิด"), { ok: false, message: "ลองรหัสผ่านผิดหลายครั้งเกินไป รอสักครู่ แล้วลองใหม่" })
  })

  test("เครือข่ายล่ม → ข้อความของ ApiError (เชื่อมต่อเซิร์ฟเวอร์ไม่ได้)", async () => {
    installFetch(() => {
      throw new TypeError("fetch failed")
    })
    assert.deepEqual(await attemptLogin("x"), { ok: false, message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" })
  })

  test("ข้อผิดพลาดอื่นของเซิร์ฟเวอร์ → แสดงข้อความของเซิร์ฟเวอร์ (ภาษาไทยอยู่แล้ว)", async () => {
    installFetch(() => jsonResponse({ error: "เซิร์ฟเวอร์นี้ไม่ได้ตั้งรหัสผ่าน", code: "passwordless" }, 400))
    assert.deepEqual(await attemptLogin("x"), { ok: false, message: "เซิร์ฟเวอร์นี้ไม่ได้ตั้งรหัสผ่าน" })
  })
})
