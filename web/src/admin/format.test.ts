import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { STATUS_LABEL, queueSummary, retryWaitPhrase } from "./format"
import type { ChapterStatus, QueueState } from "./types"

const state = (over: Partial<QueueState> = {}): QueueState => ({
  paused: false,
  pausedReason: "",
  consecutiveErrors: 0,
  waitingTotal: 0,
  current: null,
  waiting: [],
  ...over,
})
const current = { chapterId: 1, novelId: 2, novelTitle: "เรื่อง", number: 12, chunkIndex: 0, chunkTotal: 3, textTail: "" }

describe("STATUS_LABEL", () => {
  test("ป้ายสถานะตอนเป็นภาษาไทยตามสเปก ครบทั้งห้าสถานะ", () => {
    assert.deepEqual(STATUS_LABEL, { draft: "ร่าง", queued: "รอคิว", translating: "กำลังแปล", done: "แปลเสร็จ", error: "ผิดพลาด" })
    const statuses: ChapterStatus[] = ["draft", "queued", "translating", "done", "error"]
    assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...statuses].sort())
  })
})

describe("retryWaitPhrase: วลีบอกเวลารอหลังลองรหัสผ่านผิดเกินกำหนด (จาก data.retryAfterSec ของ 429)", () => {
  test("น้อยกว่า 1 นาที → วินาที (ปัดขึ้น)", () => {
    assert.equal(retryWaitPhrase(1), "รอ 1 วินาที")
    assert.equal(retryWaitPhrase(45), "รอ 45 วินาที")
    assert.equal(retryWaitPhrase(44.2), "รอ 45 วินาที")
    assert.equal(retryWaitPhrase(59), "รอ 59 วินาที")
  })
  test("ตั้งแต่ 1 นาที → นาที (ปัดขึ้น ไม่บอกน้อยกว่าจริง)", () => {
    assert.equal(retryWaitPhrase(60), "รอ 1 นาที")
    assert.equal(retryWaitPhrase(61), "รอ 2 นาที")
    assert.equal(retryWaitPhrase(90), "รอ 2 นาที")
    assert.equal(retryWaitPhrase(900), "รอ 15 นาที")
  })
  test("ค่าที่ใช้ไม่ได้ (ไม่ใช่ตัวเลข ≤ 0 NaN Infinity ไม่มี) → รอสักครู่", () => {
    for (const bad of [undefined, null, "30", NaN, Infinity, -Infinity, 0, -5, {}]) assert.equal(retryWaitPhrase(bad), "รอสักครู่", String(bad))
  })
})

describe("queueSummary: บรรทัดสถานะคิวใต้เมนูข้าง", () => {
  test("ยังไม่ได้สถานะ → กำลังตรวจคิว", () => {
    assert.equal(queueSummary(null), "กำลังตรวจคิว…")
  })
  test("ดึงไม่สำเร็จ (offline) → บอกว่าเชื่อมต่อไม่ได้ ชนะทุกสถานะ (ที่เห็นอาจเก่า)", () => {
    assert.equal(queueSummary(null, true), "เชื่อมต่อไม่ได้ · กำลังลองใหม่")
    assert.equal(queueSummary(state({ current, waitingTotal: 2 }), true), "เชื่อมต่อไม่ได้ · กำลังลองใหม่")
    assert.equal(queueSummary(state({ paused: true }), true), "เชื่อมต่อไม่ได้ · กำลังลองใหม่")
    assert.equal(queueSummary(state(), false), "คิวว่าง")
  })
  test("ไม่มีอะไรเลย → คิวว่าง", () => {
    assert.equal(queueSummary(state()), "คิวว่าง")
  })
  test("กำลังแปล: บอกเลขตอน และจำนวนที่รอเมื่อมี", () => {
    assert.equal(queueSummary(state({ current })), "กำลังแปลตอนที่ 12")
    assert.equal(queueSummary(state({ current, waitingTotal: 4 })), "กำลังแปลตอนที่ 12 · รอ 4 ตอน")
  })
  test("มีตอนรอแต่ยังไม่เริ่ม (คิวกำลังตื่น) → รอ N ตอน", () => {
    assert.equal(queueSummary(state({ waitingTotal: 3 })), "รอคิว 3 ตอน")
  })
  test("หยุดอยู่ → บอกว่าหยุด (ชนะทุกอย่าง) พร้อมจำนวนที่ค้าง", () => {
    assert.equal(queueSummary(state({ paused: true })), "คิวหยุดอยู่")
    assert.equal(queueSummary(state({ paused: true, waitingTotal: 5 })), "คิวหยุดอยู่ · ค้าง 5 ตอน")
    assert.equal(queueSummary(state({ paused: true, current, waitingTotal: 5 })), "คิวหยุดอยู่ · ค้าง 5 ตอน")
  })
})

describe("queueSummary: ขอบ \"มีตอนรอ\" (1 ตอนก็นับ)", () => {
  test("รอ/ค้างเพียงตอนเดียวก็แสดงจำนวน ในทั้งสามสถานะ (หยุด · กำลังแปล · รอคิว)", () => {
    assert.equal(queueSummary(state({ paused: true, waitingTotal: 1 })), "คิวหยุดอยู่ · ค้าง 1 ตอน")
    assert.equal(queueSummary(state({ current, waitingTotal: 1 })), "กำลังแปลตอนที่ 12 · รอ 1 ตอน")
    assert.equal(queueSummary(state({ waitingTotal: 1 })), "รอคิว 1 ตอน")
  })
})
