import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { SEARCH_MAX_LENGTH, queryOf, searchPath } from "./search"

/** ครึ่งตัวของอีโมจิ (surrogate เดี่ยว) — เกิดได้เมื่อ maxLength ตัดกลางตัวอักษรสองหน่วย UTF-16 */
const LONE_HIGH = String.fromCharCode(0xd83d)
const LONE_LOW = String.fromCharCode(0xde00)
/** ผู้อ่านพารามิเตอร์ q กลับจากเส้นทางที่ได้ */
const readBack = (path: string) => new URL(path, "https://example.test").searchParams.get("q")

describe("searchPath", () => {
  test("คำค้นทั่วไป → /?q=คำค้น", () => {
    assert.equal(searchPath("lantern"), "/?q=lantern")
  })

  test("ช่องว่างหัวท้ายถูกตัด; ว่างหรือช่องว่างล้วนหรือขึ้นบรรทัดล้วน → '/' (ล้างผลค้นหา)", () => {
    assert.equal(searchPath("  lantern  "), "/?q=lantern")
    for (const empty of ["", " ", "   ", "\t", "\n", " \t\n "]) assert.equal(searchPath(empty), "/", JSON.stringify(empty))
  })

  test("ภาษาไทยเข้ารหัสแบบ percent-encoding UTF-8", () => {
    assert.equal(searchPath("นิยาย"), "/?q=%E0%B8%99%E0%B8%B4%E0%B8%A2%E0%B8%B2%E0%B8%A2")
  })

  test("ช่องว่างกลางคำค้นคงอยู่ (เป็น %20 ไม่ใช่ +)", () => {
    assert.equal(searchPath("the last  lantern"), "/?q=the%20last%20%20lantern")
  })

  test("อักขระที่มีความหมายใน URL ถูกเข้ารหัสทั้งหมด จึงไม่หลุดไปเป็นพารามิเตอร์อื่น", () => {
    assert.equal(searchPath("a&b=c#d?e+f%g/h"), "/?q=a%26b%3Dc%23d%3Fe%2Bf%25g%2Fh")
    assert.equal(searchPath("&q=evil"), "/?q=%26q%3Devil")
  })

  test("อ่านกลับด้วย URLSearchParams ได้คำเดิมเป๊ะ (round trip) รวมอักขระพิเศษ ไทย และอีโมจิ", () => {
    for (const q of ["lantern", "นิยายแฟนตาซี", "a&b=c#d?e+f%g/h", "ใส่ 100% & ไม่ใส่ + ", "😀 smile", 'quote " and \' and <tag>', "ก\u{200b}ข"]) {
      assert.equal(readBack(searchPath(q)), q.trim(), JSON.stringify(q))
    }
  })

  test("อีโมจิ (สองหน่วย UTF-16) ผ่านครบทั้งตัว", () => {
    assert.equal(searchPath("😀"), "/?q=%F0%9F%98%80")
  })

  test("ครึ่งตัวของอีโมจิไม่ทำให้โยน URIError → แทนด้วยตัวอักษรแทนที่ U+FFFD", () => {
    assert.equal(searchPath(`ab${LONE_HIGH}`), "/?q=ab%EF%BF%BD")
    assert.equal(searchPath(`${LONE_LOW}ab`), "/?q=%EF%BF%BDab")
    assert.equal(searchPath(`a${LONE_HIGH}${LONE_HIGH}b`), "/?q=a%EF%BF%BD%EF%BF%BDb")
    assert.equal(searchPath(`😀${LONE_HIGH}`), "/?q=%F0%9F%98%80%EF%BF%BD") // ตัวเต็มยังอยู่ ครึ่งตัวถูกแทน
    assert.equal(searchPath(`${LONE_LOW}😀`), "/?q=%EF%BF%BD%F0%9F%98%80")
  })

  test("ขอบของช่วง surrogate: ตัวแรกสุด (U+D800) และตัวสุดท้าย (U+DFFF) ก็ถูกแทน แต่ตัวที่อยู่ติดนอกช่วง (U+D7FF, U+E000) ไม่ถูกแทน", () => {
    const first = String.fromCharCode(0xd800)
    const last = String.fromCharCode(0xdfff)
    assert.equal(searchPath(`a${first}b`), "/?q=a%EF%BF%BDb")
    assert.equal(searchPath(`a${last}b`), "/?q=a%EF%BF%BDb")
    assert.equal(searchPath(String.fromCharCode(0xd7ff)), "/?q=%ED%9F%BF")
    assert.equal(searchPath(String.fromCharCode(0xe000)), "/?q=%EE%80%80")
  })

  test("อีโมจิที่ถูกตัดแล้วเหลือแต่ครึ่งตัวท้ายคำค้น ยังค้นต่อได้ (ไม่ทำให้ช่องค้นหาพังเงียบ)", () => {
    assert.doesNotThrow(() => searchPath("x".repeat(99) + LONE_HIGH))
  })

  test("ความยาวสูงสุดของช่องค้นหาคือ 100 ตัวอักษร (ช่องกรอกใช้ค่านี้เป็น maxLength)", () => {
    assert.equal(SEARCH_MAX_LENGTH, 100)
  })
})

describe("queryOf (คำค้นที่แสดงในช่องค้นหา)", () => {
  test("หน้าแรกที่มี ?q= → คำค้น (ถอดรหัสแล้ว)", () => {
    assert.equal(queryOf("/", "?q=abc"), "abc")
    assert.equal(queryOf("/", "?q=%E0%B8%94%E0%B8%B2%E0%B8%A7"), "ดาว")
    assert.equal(queryOf("/", "?q=a%20b"), "a b")
    assert.equal(queryOf("/", "?q=a+b"), "a b")
  })

  test("ไม่มี q หรือ q ว่าง → ข้อความว่าง", () => {
    assert.equal(queryOf("/", ""), "")
    assert.equal(queryOf("/", "?"), "")
    assert.equal(queryOf("/", "?q="), "")
    assert.equal(queryOf("/", "?x=1"), "")
  })

  test("หน้าอื่นไม่แสดงคำค้น แม้ URL มี ?q= (ช่องค้นหานอกหน้าแรกเริ่มว่างเสมอ)", () => {
    assert.equal(queryOf("/about", "?q=abc"), "")
    assert.equal(queryOf("/novel/5", "?q=abc"), "")
    assert.equal(queryOf("/admin", "?q=abc"), "")
    assert.equal(queryOf("", "?q=abc"), "")
  })

  test("ข้อความคงตามที่พิมพ์ (ไม่ตัดช่องว่าง) — การตัดเป็นหน้าที่ของผู้ใช้ค่า", () => {
    assert.equal(queryOf("/", "?q=%20abc%20"), " abc ")
  })

  test("q ซ้ำหลายตัว → ตัวแรก; พารามิเตอร์อื่นปนมาไม่กระทบ", () => {
    assert.equal(queryOf("/", "?q=one&q=two"), "one")
    assert.equal(queryOf("/", "?sort=name&q=abc&page=2"), "abc")
  })

  test("อ่านกลับจาก searchPath ได้ค่าเดิม (ไป-กลับครบวง)", () => {
    for (const query of ["ดาวเคราะห์", "a&b=c", "100%", "x y", "😀", "ก ข"]) {
      const [pathname, search] = searchPath(query).split("?")
      assert.equal(queryOf(pathname, `?${search}`), query, query)
    }
  })

  test("ค่า q ที่ถอดรหัสไม่ได้ (% เดี่ยว) ไม่ทำให้พัง", () => {
    assert.doesNotThrow(() => queryOf("/", "?q=%E0%A4%A"))
    assert.equal(queryOf("/", "?q=100%"), "100%")
  })
})
