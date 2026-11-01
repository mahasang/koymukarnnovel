import { test } from "node:test"
import assert from "node:assert/strict"
import { bool, httpUrl, idParam, int, numberParam, obj, oneOf, parseIdParam, parseNumberParam, str, tags } from "../src/http/validate.js"
import { HttpError } from "../src/util/errors.js"

const THAI = /[฀-๿]/

/** เรียก `fn` ต้องโยน HttpError ตามที่ระบุ (สถานะ + code) และข้อความเป็นภาษาไทยที่มี `mention` ทุกตัว */
function rejects(fn: () => unknown, o: { status?: number; code: string; mention?: (string | number)[] }): HttpError {
  let caught: unknown
  try {
    fn()
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof HttpError, `ต้องโยน HttpError แต่ได้ ${String(caught)}`)
  assert.equal(caught.status, o.status ?? 400)
  assert.equal(caught.code, o.code)
  assert.match(caught.message, THAI)
  for (const m of o.mention ?? []) assert.ok(caught.message.includes(String(m)), `ข้อความ "${caught.message}" ต้องมี "${m}"`)
  return caught
}

const invalid = (fn: () => unknown, ...mention: (string | number)[]) => rejects(fn, { code: "invalid_field", mention })

// ═════════════════════════ obj ═════════════════════════

test("obj: ออบเจ็กต์ธรรมดาผ่านและคืนตัวเดิม (รวมออบเจ็กต์ว่าง)", () => {
  const body = { a: 1 }
  assert.equal(obj(body), body)
  const empty = {}
  assert.equal(obj(empty), empty)
})

test("obj: null / undefined / อาร์เรย์ / ข้อความ / ตัวเลข / บูลีน → 400 bad_request ข้อความไทย", () => {
  for (const v of [null, undefined, [], [1], "x", "", 0, 42, true, false]) {
    rejects(() => obj(v), { code: "bad_request", mention: ["JSON"] })
  }
})

// ═════════════════════════ str ═════════════════════════

test("str: ล้างข้อความที่คัดลอกจากเว็บ (BOM, ZWSP, CRLF, NBSP, ช่องว่างหัวท้าย) ก่อนคืนค่า", () => {
  assert.equal(str("  ﻿a​\r\nb c  ", "ชื่อ", { max: 50 }), "a\nb c")
})

test("str: ความยาวนับหลังล้างข้อความ (ค่าที่เก็บจริง) ไม่ใช่ความยาวดิบ", () => {
  // ดิบ 6 ตัว (\r\n นับสอง) แต่ที่เก็บ "ab\ncd" = 5 ตัว
  assert.equal(str("ab\r\ncd", "ชื่อ", { max: 5 }), "ab\ncd")
  // ช่องว่างหัวท้ายไม่ถูกนับ
  assert.equal(str("   abcde   ", "ชื่อ", { max: 5 }), "abcde")
})

test("str: ไม่ใช่ข้อความ (ตัวเลข null อาร์เรย์ ออบเจ็กต์ บูลีน) → 400 ระบุชื่อฟิลด์", () => {
  for (const v of [123, null, [], ["a"], {}, true]) invalid(() => str(v, "ผู้แต่ง (author)", { max: 10 }), "ผู้แต่ง (author)", "ข้อความ")
})

test("str: ไม่ได้ส่งมา (undefined) → 400 'ต้องระบุ'; optional → คืนข้อความว่าง", () => {
  invalid(() => str(undefined, "ชื่อเรื่อง", { max: 10 }), "ชื่อเรื่อง", "ต้องระบุ")
  assert.equal(str(undefined, "ชื่อเรื่อง", { max: 10, optional: true }), "")
})

test("str: optional ไม่ได้อนุญาต null — มีค่าที่ส่งมาแล้วต้องเป็นข้อความ", () => {
  invalid(() => str(null, "ผู้แต่ง", { max: 10, optional: true }), "ผู้แต่ง")
  assert.equal(str("", "ผู้แต่ง", { max: 10, optional: true }), "")
})

test("str: min — ว่าง/ช่องว่างล้วนไม่ผ่านเมื่อ min=1 ('ต้องไม่ว่าง'); min มากกว่า 1 บอกจำนวนตัวอักษร; พอดีขอบผ่าน", () => {
  invalid(() => str("", "ชื่อเรื่อง", { max: 10, min: 1 }), "ชื่อเรื่อง", "ต้องไม่ว่าง")
  invalid(() => str("  \r\n\t ", "ชื่อเรื่อง", { max: 10, min: 1 }), "ชื่อเรื่อง", "ต้องไม่ว่าง")
  assert.equal(str("a", "ชื่อเรื่อง", { max: 10, min: 1 }), "a")
  invalid(() => str("ab", "รหัส", { max: 10, min: 3 }), "รหัส", 3)
  assert.equal(str("abc", "รหัส", { max: 10, min: 3 }), "abc")
  // ไม่ตั้ง min: ข้อความว่างผ่าน
  assert.equal(str("", "หมายเหตุ", { max: 10 }), "")
})

test("str: max — พอดีผ่าน เกิน 1 ตัวไม่ผ่านและบอกตัวเลข; ข้อความไทยนับเป็นตัวอักษร", () => {
  assert.equal(str("x".repeat(300), "ชื่อเรื่อง", { max: 300 }), "x".repeat(300))
  invalid(() => str("x".repeat(301), "ชื่อเรื่อง", { max: 300 }), "ชื่อเรื่อง", 300)
  assert.equal(str("ก".repeat(5), "ชื่อ", { max: 5 }), "ก".repeat(5))
  invalid(() => str("ก".repeat(6), "ชื่อ", { max: 5 }), 5)
})

// ═════════════════════════ int ═════════════════════════

test("int: จำนวนเต็ม (รวมศูนย์และติดลบ) ผ่านเมื่อไม่ตั้งขอบเขต", () => {
  for (const v of [0, 1, -5, 42, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) assert.equal(int(v, "เลขตอน"), v)
})

test("int: ไม่ใช่จำนวนเต็มปลอดภัย (ทศนิยม ข้อความ NaN Infinity เกินช่วง null undefined บูลีน) → 400 ระบุฟิลด์", () => {
  for (const v of [1.5, "5", NaN, Infinity, -Infinity, 2 ** 53, null, undefined, true, [1], {}]) {
    invalid(() => int(v, "เลขตอน (number)"), "เลขตอน (number)", "จำนวนเต็ม")
  }
})

test("int: min/max — พอดีขอบผ่าน เลยขอบไม่ผ่านและบอกตัวเลขขอบ", () => {
  assert.equal(int(0, "เลขตอน", { min: 0 }), 0)
  invalid(() => int(-1, "เลขตอน", { min: 0 }), "เลขตอน", 0)
  assert.equal(int(100, "จำนวน", { max: 100 }), 100)
  invalid(() => int(101, "จำนวน", { max: 100 }), "จำนวน", 100)
  assert.equal(int(5, "ช่วง", { min: 5, max: 5 }), 5)
  invalid(() => int(4, "ช่วง", { min: 5, max: 5 }), 5)
  invalid(() => int(6, "ช่วง", { min: 5, max: 5 }), 5)
  // ขอบที่เป็น 0 ก็ต้องถูกตรวจ (ไม่ใช่ falsy ที่ถูกข้าม)
  invalid(() => int(1, "ศูนย์", { max: 0 }), 0)
  assert.equal(int(-3, "ติดลบ", { max: 0 }), -3)
})

// ═════════════════════════ bool ═════════════════════════

test("bool: true/false ผ่าน; ค่าอื่นทุกชนิด (ข้อความ ตัวเลข null undefined) → 400", () => {
  assert.equal(bool(true, "เผยแพร่"), true)
  assert.equal(bool(false, "เผยแพร่"), false)
  for (const v of ["true", "false", "yes", 1, 0, null, undefined, [], {}]) invalid(() => bool(v, "เผยแพร่ (published)"), "เผยแพร่ (published)", "true")
})

// ═════════════════════════ oneOf ═════════════════════════

test("oneOf: ค่าที่อยู่ในรายการผ่านและคืนค่านั้น", () => {
  assert.equal(oneOf("ongoing", "สถานะ", ["ongoing", "completed"] as const), "ongoing")
  assert.equal(oneOf("completed", "สถานะ", ["ongoing", "completed"] as const), "completed")
})

test("oneOf: นอกรายการ (รวมตัวพิมพ์ต่าง ข้อความว่าง ชนิดอื่น ชื่อคุณสมบัติของออบเจ็กต์) → 400 บอกตัวเลือกที่ใช้ได้", () => {
  for (const v of ["summary", "Ongoing", "", " ongoing", 1, null, undefined, ["ongoing"], "toString", "__proto__", "constructor"]) {
    invalid(() => oneOf(v, "สถานะ (status)", ["ongoing", "completed"] as const), "สถานะ (status)", "ongoing", "completed")
  }
  // ชนิดต้องตรงเป๊ะ: ตัวเลข 1 ไม่เท่ากับ "1"
  invalid(() => oneOf(1, "รหัส", ["1"] as const), "รหัส")
})

// ═════════════════════════ tags ═════════════════════════

test("tags: รายการว่างผ่าน; ล้างข้อความ ตัดช่องว่าง ทิ้งแท็กว่าง รักษาลำดับ", () => {
  assert.deepEqual(tags([]), [])
  assert.deepEqual(tags(["  แฟนตาซี ", " ต่างโลก\r\n", "", "   ", "​"]), ["แฟนตาซี", "ต่างโลก"])
  assert.deepEqual(tags(["b", "a", "c"]), ["b", "a", "c"])
})

test("tags: ตัดซ้ำโดยไม่สนตัวพิมพ์ เก็บตัวแรกตามที่สะกด", () => {
  assert.deepEqual(tags(["Fantasy", "fantasy", " FANTASY ", "Isekai", "isekai"]), ["Fantasy", "Isekai"])
  assert.deepEqual(tags(["แฟนตาซี", "แฟนตาซี"]), ["แฟนตาซี"])
})

test("tags: มีได้ 12 แท็กพอดี, 13 → 400; ตัวซ้ำไม่ถูกนับเข้าเพดาน", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `t${i}`)
  assert.deepEqual(tags(twelve), twelve)
  invalid(() => tags([...twelve, "t12"]), "แท็ก", 12)
  // 13 รายการแต่ซ้ำกัน 1 → เหลือ 12
  assert.deepEqual(tags([...twelve, "T0"]), twelve)
  // แท็กว่างไม่นับ
  assert.deepEqual(tags([...twelve, "", "  "]), twelve)
})

test("tags: แท็กยาวได้ 40 ตัวอักษรพอดี (นับหลังตัดช่องว่าง), 41 → 400", () => {
  const forty = "ก".repeat(40)
  assert.deepEqual(tags([forty]), [forty])
  assert.deepEqual(tags([` ${forty} `]), [forty])
  invalid(() => tags(["ก".repeat(41)]), "แท็ก", 40)
})

test("tags: ไม่ใช่อาร์เรย์ หรือมีสมาชิกที่ไม่ใช่ข้อความ → 400", () => {
  for (const v of [undefined, null, "a,b", "a", 5, {}, { length: 1 }]) invalid(() => tags(v), "แท็ก", "รายการ")
  for (const v of [[1], [null], [{}], [["a"]], ["ok", 2], [true]]) invalid(() => tags(v), "แท็ก", "ข้อความ")
})

// ═════════════════════════ httpUrl ═════════════════════════

test("httpUrl: ข้อความว่างหรือช่องว่างล้วน → '' (ไม่มีลิงก์)", () => {
  assert.equal(httpUrl("", "ลิงก์"), "")
  assert.equal(httpUrl("   \r\n ", "ลิงก์"), "")
})

test("httpUrl: http/https ผ่าน คืนข้อความตามที่กรอก (ตัดช่องว่างหัวท้าย ไม่แก้ตัวพิมพ์/ไม่เติม /)", () => {
  assert.equal(httpUrl("http://example.com", "ลิงก์"), "http://example.com")
  assert.equal(httpUrl("https://example.com/a/b?c=d#e", "ลิงก์"), "https://example.com/a/b?c=d#e")
  assert.equal(httpUrl("  https://www.royalroad.com/fiction/12345/some-title \n", "ลิงก์"), "https://www.royalroad.com/fiction/12345/some-title")
  assert.equal(httpUrl("HTTPS://Example.COM/Path", "ลิงก์"), "HTTPS://Example.COM/Path")
  assert.equal(httpUrl("http://localhost:3000/x", "ลิงก์"), "http://localhost:3000/x")
  assert.equal(httpUrl("https://[::1]:8080/", "ลิงก์"), "https://[::1]:8080/")
  assert.equal(httpUrl("https://ตัวอย่าง.ไทย/นิยาย", "ลิงก์"), "https://ตัวอย่าง.ไทย/นิยาย")
})

test("httpUrl: ล้างอักขระล่องหนที่ติดมากับการคัดลอก (ZWSP, BOM) ก่อนตรวจและเก็บ", () => {
  assert.equal(httpUrl("https://example.com/a\u200bb\ufeff", "ลิงก์"), "https://example.com/ab")
  assert.equal(httpUrl("\u200bhttps://example.com/x\u00a0", "ลิงก์"), "https://example.com/x")
})

test("httpUrl: สกีมอื่น/ไม่มีสกีม/รูปแปลก → 400 (กัน javascript: และ data:)", () => {
  const bad = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:x",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "//example.com/x",
    "/relative/path",
    "example.com",
    "www.example.com/x",
    "http:/example.com",
    "http:example.com",
    "https:",
    "http://",
    "httpx://example.com",
    "xhttp://example.com",
    "http//example.com",
  ]
  for (const url of bad) invalid(() => httpUrl(url, "ลิงก์ต้นฉบับ (sourceUrl)"), "ลิงก์ต้นฉบับ (sourceUrl)", "http")
})

test("httpUrl: มีช่องว่าง/อักขระควบคุมแทรกกลาง หรือ URL ที่อ่านไม่ได้ → 400", () => {
  for (const url of ["https://exa mple.com", "https://example.com/a b", "https://example.com/\nx", "https://example.com/\tx", "https://example.com/\u0000", "https://example.com/\u007f", "https://example.com/\u0007", "https://example.com/ x", "http://a.com:99999", "http://[::1", "http://exa mple.com:80"]) {
    invalid(() => httpUrl(url, "ลิงก์"), "ลิงก์")
  }
})

test("httpUrl: ยาวได้ 2000 ตัวอักษรพอดี, 2001 → 400; ไม่ใช่ข้อความ → 400", () => {
  const prefix = "https://example.com/"
  const ok = prefix + "x".repeat(2000 - prefix.length)
  assert.equal(ok.length, 2000)
  assert.equal(httpUrl(ok, "ลิงก์"), ok)
  invalid(() => httpUrl(ok + "x", "ลิงก์"), "ลิงก์", 2000)
  for (const v of [123, null, undefined, [], {}, true]) invalid(() => httpUrl(v, "ลิงก์"), "ลิงก์", "ข้อความ")
})

// ═════════════════════════ idParam ═════════════════════════

test("idParam: เลขจำนวนเต็มบวกรูปแบบมาตรฐานผ่าน", () => {
  assert.equal(idParam("1", "นิยายเรื่องนี้"), 1)
  assert.equal(idParam("42", "นิยายเรื่องนี้"), 42)
  assert.equal(idParam("9007199254740991", "นิยายเรื่องนี้"), Number.MAX_SAFE_INTEGER)
})

test("idParam: รูปแบบอื่นทุกแบบ (ศูนย์ ติดลบ ทศนิยม ศูนย์นำหน้า เครื่องหมายบวก เลขยกกำลัง ช่องว่าง ว่าง เกินช่วงปลอดภัย ไม่ใช่ข้อความ) → 404 not_found บอกว่าไม่พบอะไร", () => {
  for (const v of ["0", "-1", "1.5", "007", "+7", "1e3", "0x10", " 1", "1 ", "", "abc", "1a", "９", "9007199254740992", "9".repeat(400), undefined, null, 1, ["1"]]) {
    rejects(() => idParam(v, "ตอนนี้"), { status: 404, code: "not_found", mention: ["ตอนนี้"] })
  }
})

// ═════════════════════════ numberParam ═════════════════════════

test("numberParam: จำนวนเต็มไม่ติดลบรูปแบบมาตรฐานผ่าน — ตอนเลข 0 มีได้ (ต่างจาก idParam)", () => {
  assert.equal(numberParam("0", "ตอนนี้"), 0)
  assert.equal(numberParam("7", "ตอนนี้"), 7)
  assert.equal(numberParam("10", "ตอนนี้"), 10)
  assert.equal(numberParam("120", "ตอนนี้"), 120)
  assert.equal(numberParam("9007199254740991", "ตอนนี้"), Number.MAX_SAFE_INTEGER)
})

test("numberParam: รูปแบบอื่นทุกแบบ (ว่าง ศูนย์นำหน้า ติดลบ ทศนิยม เลขยกกำลัง ฐานสิบหก เครื่องหมายบวก ช่องว่าง ตัวเลขไทย/เต็มความกว้าง ไม่ใช่ข้อความ) → 404 not_found บอกว่าไม่พบอะไร", () => {
  const bad: unknown[] = ["", "00", "01", "007", "-1", "-0", "1.5", "1.", ".5", "1e3", "0x1", "+1", " 1", "1 ", "1\n", "abc", "1a", "๑", "１", "1๑", "1１", "1٣", undefined, null, 5, 0, ["1"], { toString: () => "1" }]
  for (const v of bad) rejects(() => numberParam(v, "ตอนนี้"), { status: 404, code: "not_found", mention: ["ตอนนี้"] })
})

test("numberParam: ข้อความที่ถามถึงสิ่งที่ไม่พบมาจากพารามิเตอร์ what (ไม่ใช่ข้อความตายตัว)", () => {
  assert.equal(rejects(() => numberParam("x", "ตอนที่ระบุ"), { status: 404, code: "not_found" }).message, "ไม่พบตอนที่ระบุ")
  assert.equal(rejects(() => numberParam("x", "หน้านั้น"), { status: 404, code: "not_found" }).message, "ไม่พบหน้านั้น")
})

// ═════════════════════════ parseIdParam / parseNumberParam (ตัวเดียวกับข้างบนแต่ไม่ throw) ═════════════════════════

test("parseIdParam: ค่าที่ idParam รับ → ตัวเลขเดียวกัน · ค่าที่ idParam ปฏิเสธทุกแบบ → null (ไม่ throw)", () => {
  for (const v of ["1", "42", "9007199254740991"]) assert.equal(parseIdParam(v), idParam(v, "x"))
  for (const v of ["0", "-1", "1.5", "007", "+7", "1e3", "0x10", " 1", "1 ", "", "abc", "1a", "９", "9007199254740992", "9".repeat(400), undefined, null, 1, ["1"]]) {
    assert.equal(parseIdParam(v), null, String(v))
  }
})

test("parseNumberParam: ค่าที่ numberParam รับ (รวม 0) → ตัวเลขเดียวกัน · ค่าที่ numberParam ปฏิเสธทุกแบบ → null (ไม่ throw)", () => {
  for (const v of ["0", "7", "10", "120", "9007199254740991"]) assert.equal(parseNumberParam(v), numberParam(v, "x"))
  assert.equal(parseNumberParam("9".repeat(400)), Infinity, "เลขยาวเกินที่ JS แทนได้ไม่ถูกกันแยก (ไม่ตรงตอนไหนเอง)")
  for (const v of ["", "00", "01", "-1", "-0", "1.5", "1.", ".5", "1e3", "0x1", "+1", " 1", "1 ", "1\n", "abc", "1a", "๑", "１", undefined, null, 5, 0, ["1"]]) {
    assert.equal(parseNumberParam(v), null, String(v))
  }
})
