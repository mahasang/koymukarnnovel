import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { FALLBACK_SITE_NAME, formatTitle, shownSiteName, titleFor } from "./title"

const site = (siteName: string, tagline = "") => ({ siteName, tagline })

describe("formatTitle", () => {
  test("มีชื่อหน้า → 'ชื่อหน้า | ชื่อเว็บ' (รูปแบบเดียวกับที่เซิร์ฟเวอร์ใส่ให้ตอนส่งหน้า)", () => {
    assert.equal(formatTitle("เกี่ยวกับเว็บนี้", site("koymukarnnovel")), "เกี่ยวกับเว็บนี้ | koymukarnnovel")
    assert.equal(formatTitle("ตะเกียงดวงสุดท้าย", site("คลังนิยาย", "อ่านฟรี")), "ตะเกียงดวงสุดท้าย | คลังนิยาย")
  })

  test("มีชื่อหน้าแล้วไม่เอาสโลแกนมาต่อ", () => {
    assert.equal(formatTitle("ติดต่อ", site("เว็บ", "สโลแกนยาวๆ")), "ติดต่อ | เว็บ")
  })

  test("ไม่มีชื่อหน้า (หน้าแรก) → 'ชื่อเว็บ — สโลแกน'; ไม่มีสโลแกนก็แค่ชื่อเว็บ", () => {
    assert.equal(formatTitle(undefined, site("คลังนิยาย", "นิยายแปลไทย")), "คลังนิยาย — นิยายแปลไทย")
    assert.equal(formatTitle(undefined, site("คลังนิยาย", "")), "คลังนิยาย")
  })

  test("ชื่อหน้า null / ว่าง / ช่องว่างล้วน นับเป็นไม่มีชื่อหน้า", () => {
    const s = site("เว็บ", "สโลแกน")
    for (const page of [null, undefined, "", " ", "\t\n  "]) {
      assert.equal(formatTitle(page, s), "เว็บ — สโลแกน", JSON.stringify(page))
    }
  })

  test("ชื่อหน้าถูกตัดช่องว่างหัวท้าย ส่วนช่องว่างกลางคงเดิม", () => {
    assert.equal(formatTitle("  ตอนที่ 5  ", site("เว็บ")), "ตอนที่ 5 | เว็บ")
    assert.equal(formatTitle("a  b", site("เว็บ")), "a  b | เว็บ")
  })

  test("สโลแกนที่เป็นช่องว่างล้วนไม่ต่อท้าย; สโลแกนมีช่องว่างหัวท้ายถูกตัด", () => {
    assert.equal(formatTitle(null, site("เว็บ", "   ")), "เว็บ")
    assert.equal(formatTitle(null, site("เว็บ", "  สโลแกน ")), "เว็บ — สโลแกน")
  })

  test("ชื่อเว็บถูกตัดช่องว่างหัวท้าย", () => {
    assert.equal(formatTitle("หน้า", site("  เว็บ  ")), "หน้า | เว็บ")
    assert.equal(formatTitle(null, site("  เว็บ  ", "ส")), "เว็บ — ส")
  })

  test("ยังไม่ได้ข้อมูลเว็บ (null) หรือชื่อเว็บว่าง → ใช้ชื่อสำรอง koymukarnnovel", () => {
    assert.equal(FALLBACK_SITE_NAME, "koymukarnnovel")
    assert.equal(formatTitle(null, null), "koymukarnnovel")
    assert.equal(formatTitle("หน้า", null), "หน้า | koymukarnnovel")
    assert.equal(formatTitle("หน้า", site("")), "หน้า | koymukarnnovel")
    assert.equal(formatTitle("หน้า", site("   ", "สโลแกน")), "หน้า | koymukarnnovel")
    assert.equal(formatTitle(null, site("", "สโลแกน")), "koymukarnnovel — สโลแกน")
  })

  // รูปแบบต้องตรงกับ server/src/http/shell.ts ไม่งั้นชื่อแท็บจะเปลี่ยนไปมาตอนเปิดหน้าครั้งแรก (ข้ามเมื่อไม่มีโฟลเดอร์ server เช่นใน build context ของ Docker)
  const shellPath = fileURLToPath(new URL("../../../server/src/http/shell.ts", import.meta.url))
  test("รูปแบบตรงกับที่เซิร์ฟเวอร์ใช้ใน shell.ts", { skip: !existsSync(shellPath) && "ไม่มี server/ ในสภาพแวดล้อมนี้" }, () => {
    const source = readFileSync(shellPath, "utf8")
    assert.ok(source.includes("| ${s.siteName}`"), "ชื่อหน้า | ชื่อเว็บ")
    assert.ok(source.includes("`${s.siteName} — ${s.tagline}`"), "ชื่อเว็บ — สโลแกน")
  })
})

/** สถานะข้อมูลเว็บแบบเดียวกับ useSite(): site ยังเป็น null ได้ทั้งตอนกำลังโหลดและตอนโหลดไม่สำเร็จ */
const state = (loaded: { siteName: string; tagline: string } | null, loading = false) => ({ site: loaded, loading })
const LOADING = state(null, true)
const FAILED = state(null, false)

describe("shownSiteName (ชื่อเว็บในหัว/ท้ายหน้า)", () => {
  test("โหลดแล้ว → ชื่อเว็บ (ตัดช่องว่างหัวท้าย)", () => {
    assert.equal(shownSiteName(state(site("คลังนิยาย"))), "คลังนิยาย")
    assert.equal(shownSiteName(state(site("  คลังนิยาย  "))), "คลังนิยาย")
  })

  test("โหลดแล้วแต่เจ้าของยังไม่ตั้งชื่อ (ว่าง/ช่องว่างล้วน) → ชื่อสำรอง", () => {
    assert.equal(shownSiteName(state(site(""))), FALLBACK_SITE_NAME)
    assert.equal(shownSiteName(state(site("   "))), FALLBACK_SITE_NAME)
  })

  test("กำลังโหลดครั้งแรก → null (ไม่โชว์ชื่อสำรองแล้วเปลี่ยนเป็นชื่อจริงทีหลังจนเห็นเป็นภาพวาบ)", () => {
    assert.equal(shownSiteName(LOADING), null)
  })

  test("โหลดไม่สำเร็จ → ชื่อสำรอง (เว็บยังใช้ได้ ไม่เว้นช่องว่างถาวร)", () => {
    assert.equal(shownSiteName(FAILED), FALLBACK_SITE_NAME)
  })

  test("มีข้อมูลเว็บแล้วแต่ยังโหลดซ้ำอยู่ → ใช้ชื่อที่มี (ไม่หายวับ)", () => {
    assert.equal(shownSiteName(state(site("คลังนิยาย"), true)), "คลังนิยาย")
  })
})

describe("titleFor (ชื่อแท็บของหน้า ตามสถานะข้อมูลเว็บ)", () => {
  test("โหลดแล้ว → เหมือน formatTitle", () => {
    assert.equal(titleFor("เกี่ยวกับเว็บนี้", state(site("คลังนิยาย", "อ่านฟรี"))), "เกี่ยวกับเว็บนี้ | คลังนิยาย")
    assert.equal(titleFor(null, state(site("คลังนิยาย", "อ่านฟรี"))), "คลังนิยาย — อ่านฟรี") // null = ไม่มีชื่อหน้า (หน้าแรก)
    assert.equal(titleFor("", state(site(""))), FALLBACK_SITE_NAME)
  })

  test("หน้ายังไม่พร้อม (undefined เช่น กำลังโหลดชื่อเรื่อง) → null ไม่เปลี่ยนชื่อแท็บ ไม่ว่าข้อมูลเว็บจะเป็นอย่างไร", () => {
    assert.equal(titleFor(undefined, state(site("คลังนิยาย", "อ่านฟรี"))), null)
    assert.equal(titleFor(undefined, LOADING), null)
    assert.equal(titleFor(undefined, FAILED), null)
  })

  test("กำลังโหลดครั้งแรก → null (คงชื่อแท็บที่เซิร์ฟเวอร์ใส่มาไว้ ไม่ทับด้วยชื่อสำรองก่อน)", () => {
    assert.equal(titleFor("เกี่ยวกับเว็บนี้", LOADING), null)
    assert.equal(titleFor(null, LOADING), null)
  })

  test("โหลดไม่สำเร็จ → ใช้ชื่อสำรอง", () => {
    assert.equal(titleFor("เกี่ยวกับเว็บนี้", FAILED), "เกี่ยวกับเว็บนี้ | koymukarnnovel")
    assert.equal(titleFor(null, FAILED), "koymukarnnovel")
  })

  test("มีข้อมูลเว็บแล้วแม้ยังโหลดซ้ำ → ใช้ข้อมูลที่มี", () => {
    assert.equal(titleFor("หน้า", state(site("เว็บ"), true)), "หน้า | เว็บ")
  })
})
