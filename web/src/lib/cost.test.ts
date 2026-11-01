import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { estimateCost, estimateTokens } from "./cost"

/** ⌈n × 9 ÷ 20⌉ ด้วยเลขจำนวนเต็มล้วน (= ⌈n ÷ 4 × 1.8⌉ แบบไม่มีทศนิยมเข้ามาเกี่ยว) — ใช้เป็นเฉลยตรวจว่าสูตรทศนิยมไม่คลาดเคลื่อน */
const outputExact = (chars: number) => Math.floor((chars * 9 + 19) / 20)

describe("estimateTokens", () => {
  test("ตัวอย่างจากสเปก: 4,000 ตัวอักษร → เข้า 2,500 ออก 1,800", () => {
    assert.deepEqual(estimateTokens(4000), { input: 2500, output: 1800 })
  })

  test("เข้า = ⌈ตัวอักษร ÷ 4⌉ + 1,500 (คำสั่งระบบ/อภิธานต่อตอน) · ออก = ⌈ตัวอักษร ÷ 4 × 1.8⌉ — เศษปัดขึ้นเสมอ", () => {
    assert.deepEqual(estimateTokens(0), { input: 1500, output: 0 })
    assert.deepEqual(estimateTokens(1), { input: 1501, output: 1 }) // ⌈0.25⌉, ⌈0.45⌉
    assert.deepEqual(estimateTokens(3), { input: 1501, output: 2 }) // ⌈0.75⌉, ⌈1.35⌉
    assert.deepEqual(estimateTokens(4), { input: 1501, output: 2 }) // 1, ⌈1.8⌉
    assert.deepEqual(estimateTokens(5), { input: 1502, output: 3 }) // ⌈1.25⌉, ⌈2.25⌉
    assert.deepEqual(estimateTokens(20), { input: 1505, output: 9 }) // พอดี: 5, 9
  })

  test("ค่าขาออกตรงกับเลขจำนวนเต็มเป๊ะทุกจุด (ทศนิยมไม่ทำให้ปัดขึ้นเกิน): 0–30,000 และค่าใหญ่ๆ", () => {
    for (let chars = 0; chars <= 30_000; chars++) {
      assert.equal(estimateTokens(chars).output, outputExact(chars), `chars=${chars}`)
      assert.equal(estimateTokens(chars).input, Math.ceil(chars / 4) + 1500, `chars=${chars}`)
    }
    for (const chars of [99_999, 200_000, 1_000_000, 7_500_000, 123_456_789]) {
      assert.equal(estimateTokens(chars).output, outputExact(chars), `chars=${chars}`)
    }
  })
})

describe("estimateCost", () => {
  const price = { in: 3, out: 15 }

  test("ตัวอย่างจากสเปก: สองตอน 4,000 ตัวอักษร ราคา 3/15 → เข้า 5,000 ออก 3,600 ราคา 0.069", () => {
    assert.deepEqual(estimateCost([4000, 4000], price), { input: 5000, output: 3600, cost: 0.069 })
  })

  test("ไม่มีราคา → cost เป็น null แต่ยังนับโทเคน", () => {
    assert.deepEqual(estimateCost([4000, 4000], undefined), { input: 5000, output: 3600, cost: null })
  })

  test("คิดทีละตอน: ค่าคำสั่งระบบ 1,500 เกิดซ้ำทุกตอน และปัดเศษทีละตอน (ไม่ได้รวมตัวอักษรก่อน)", () => {
    // สองตอน 1,000 ตัวอักษร ≠ หนึ่งตอน 2,000 ตัวอักษร (เข้า 2,000)
    assert.equal(estimateCost([1000, 1000], undefined).input, 3500)
    assert.equal(estimateCost([2000], undefined).input, 2000)
    // 1 + 1 ตัวอักษร: ออก ⌈0.45⌉ + ⌈0.45⌉ = 2 (ถ้ารวมก่อนจะได้ ⌈0.9⌉ = 1)
    assert.deepEqual(estimateCost([1, 1], undefined), { input: 3002, output: 2, cost: null })
  })

  test("ไม่มีตอนเลย → 0 โทเคน; มีราคา = 0 บาท (ไม่ใช่ null)", () => {
    assert.deepEqual(estimateCost([], undefined), { input: 0, output: 0, cost: null })
    assert.deepEqual(estimateCost([], price), { input: 0, output: 0, cost: 0 })
  })

  test("ราคาเป็นต่อ 1 ล้านโทเคน และไม่สลับขาเข้า/ขาออก", () => {
    assert.equal(estimateCost([4000], { in: 1, out: 0 }).cost, 0.0025) // 2,500 × 1 ÷ 1,000,000
    assert.equal(estimateCost([4000], { in: 0, out: 1 }).cost, 0.0018) // 1,800 × 1 ÷ 1,000,000
    assert.equal(estimateCost([4000], { in: 1_000_000, out: 0 }).cost, 2500)
  })

  test("ราคา 0/0 → cost เป็น 0 (ตั้งราคาไว้แล้วแต่ฟรี) ไม่ใช่ null", () => {
    assert.equal(estimateCost([4000], { in: 0, out: 0 }).cost, 0)
  })

  test("คูณก่อนแล้วหารครั้งเดียว: ได้ทศนิยมสะอาด ไม่มีเศษลอยจากการหารทีละขา (0.006285 ไม่ใช่ 0.006285000000000001)", () => {
    // เลือกค่าที่หารทีละขาแล้วเพี้ยนจริง (ตรวจด้วย IEEE 754): คำนวณเฉลยเป็นจำนวนเต็ม ÷ 1,000,000
    assert.deepEqual(estimateCost([237], price), { input: 1560, output: 107, cost: 0.006285 }) // 1560×3 + 107×15 = 6,285
    assert.deepEqual(estimateCost([1470], price), { input: 1868, output: 662, cost: 0.015534 }) // 15,534
    assert.deepEqual(estimateCost([3388], price), { input: 2347, output: 1525, cost: 0.029916 }) // 29,916
    assert.deepEqual(estimateCost([10_000], { in: 0.8, out: 4 }), { input: 4000, output: 4500, cost: 0.0212 })
  })

  test("ไม่แก้อาร์เรย์ที่ส่งมา", () => {
    const chars = Object.freeze([4000, 4000])
    assert.deepEqual(estimateCost(chars, price).input, 5000)
    assert.deepEqual(chars, [4000, 4000])
  })
})
