import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { shouldResetScroll } from "./scroll"

describe("shouldResetScroll (เมื่อไหร่ควรเลื่อนขึ้นบนสุดตอนเปลี่ยนหน้า)", () => {
  test("กดลิงก์ไปหน้าอื่น (PUSH) → เลื่อนขึ้นบนสุด", () => {
    assert.equal(shouldResetScroll("/", "/novel/3", "PUSH"), true)
    assert.equal(shouldResetScroll("/novel/3", "/novel/3/12", "PUSH"), true)
  })

  test("แทนที่หน้า (REPLACE) → เลื่อนขึ้นบนสุด", () => {
    assert.equal(shouldResetScroll("/about", "/contact", "REPLACE"), true)
  })

  test("ย้อนกลับ/เดินหน้า (POP) → ไม่แตะ ให้เบราว์เซอร์คืนตำแหน่งเดิมที่ผู้อ่านเลื่อนค้างไว้เอง", () => {
    assert.equal(shouldResetScroll("/novel/3", "/", "POP"), false)
    assert.equal(shouldResetScroll("/", "/novel/3", "POP"), false)
  })

  test("ยังอยู่หน้าเดิม (เช่น พิมพ์ค้นหาแล้วเปลี่ยนแค่ ?q=) → ไม่เลื่อน", () => {
    assert.equal(shouldResetScroll("/", "/", "PUSH"), false)
    assert.equal(shouldResetScroll("/", "/", "REPLACE"), false)
    assert.equal(shouldResetScroll("/", "/", "POP"), false)
  })

  test("ชื่อชนิดการนำทางที่ไม่รู้จักถือเป็นการไปหน้าใหม่ (ปลอดภัยกว่าค้างกลางหน้า)", () => {
    assert.equal(shouldResetScroll("/", "/about", "SOMETHING_NEW"), true)
    assert.equal(shouldResetScroll("/", "/about", ""), true)
  })

  test("ตัวพิมพ์เล็กไม่ใช่ POP (ค่าจริงของ react-router เป็นตัวพิมพ์ใหญ่เสมอ)", () => {
    assert.equal(shouldResetScroll("/", "/about", "pop"), true)
  })
})
