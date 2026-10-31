import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  bulkNotice,
  deleteMessage,
  hasLive,
  idsOf,
  POLL_MS,
  publishSwitch,
  readyCount,
  selectionAfter,
  STATUS_TONE,
  summaryText,
  toggleAll,
  toggleOne,
  translateLabel,
} from "./chapter-logic"
import type { AdminChapterRow, ChapterStatus } from "./types"

const row = (over: Partial<AdminChapterRow> = {}): AdminChapterRow => ({
  id: 1,
  number: 1,
  title: "T",
  titleTh: "",
  status: "done",
  error: "",
  published: false,
  publishedAt: null,
  translatedAt: null,
  queueSeq: null,
  hasTranslation: true,
  srcLength: 100,
  ...over,
})

describe("hasLive / POLL_MS — ดึงซ้ำเมื่อมีตอนที่ยังไม่นิ่ง", () => {
  test("มีตอน queued หรือ translating → true · นอกนั้น false", () => {
    for (const status of ["queued", "translating"] as ChapterStatus[]) assert.equal(hasLive([row(), row({ status })]), true, status)
    for (const status of ["draft", "done", "error"] as ChapterStatus[]) assert.equal(hasLive([row({ status })]), false, status)
    assert.equal(hasLive([]), false)
  })
  test("ทุก 2 วินาที", () => assert.equal(POLL_MS, 2000))
})

describe("STATUS_TONE", () => {
  test("แต่ละสถานะมีโทนของตัวเอง (ผิดพลาด=fail แปลเสร็จ=ok ร่าง=idle)", () => {
    assert.deepEqual(STATUS_TONE, { draft: "idle", queued: "warn", translating: "live", done: "ok", error: "fail" })
  })
})

describe("readyCount / summaryText", () => {
  test("พร้อมเผยแพร่ = แปลเสร็จ + มีคำแปล + ยังไม่เผยแพร่ (ตรงกับ READY_TO_PUBLISH_SQL)", () => {
    const rows = [
      row({ id: 1 }),
      row({ id: 2, published: true }),
      row({ id: 3, status: "draft" }),
      row({ id: 4, hasTranslation: false }),
      row({ id: 5, status: "translating" }),
      row({ id: 6, status: "error" }),
    ]
    assert.equal(readyCount(rows), 1)
  })
  test("สรุป: ทั้งหมด · แปลแล้ว (done) · เผยแพร่", () => {
    const rows = [row({ id: 1, published: true }), row({ id: 2 }), row({ id: 3, status: "draft", hasTranslation: false })]
    assert.equal(summaryText(rows), "ทั้งหมด 3 ตอน · แปลแล้ว 2 · เผยแพร่ 1")
    assert.equal(summaryText([]), "ทั้งหมด 0 ตอน · แปลแล้ว 0 · เผยแพร่ 0")
  })
  test("หลักพันมีจุลภาค", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => row({ id: i + 1 }))
    assert.match(summaryText(rows), /^ทั้งหมด 1,200 ตอน · แปลแล้ว 1,200/)
  })
})

describe("publishSwitch", () => {
  test("มีคำแปล → ใช้ได้ ไม่มีคำอธิบาย", () => assert.deepEqual(publishSwitch(row()), { disabled: false, reason: null }))
  test("ไม่มีคำแปล → ปิดพร้อมคำอธิบาย", () => {
    const s = publishSwitch(row({ hasTranslation: false }))
    assert.equal(s.disabled, true)
    assert.match(s.reason!, /ยังไม่มีคำแปล/)
  })
})

describe("การเลือกแถว", () => {
  const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]
  test("toggleOne เพิ่ม/เอาออก ไม่แก้ของเดิม", () => {
    const base = new Set([1])
    const a = toggleOne(base, 2)
    assert.deepEqual([...a].sort(), [1, 2])
    assert.equal(base.size, 1)
    assert.deepEqual([...toggleOne(a, 1)], [2])
  })
  test("toggleAll: ไม่ครบ → เลือกทั้งหมด · ครบแล้ว → ล้าง", () => {
    assert.deepEqual([...toggleAll(new Set([1]), rows)].sort(), [1, 2, 3])
    assert.equal(toggleAll(new Set([1, 2, 3]), rows).size, 0)
    assert.equal(toggleAll(new Set(), []).size, 0)
  })
  test("selectionAfter ตัดรหัสที่ไม่มีในรายการแล้ว (ถูกลบ/รายการใหม่) · ไม่มีอะไรหาย → คืนตัวเดิม", () => {
    const sel = new Set([1, 9])
    assert.deepEqual([...selectionAfter(sel, rows)], [1])
    const same = new Set([1, 2])
    assert.equal(selectionAfter(same, rows), same)
  })
  test("idsOf เรียงตามเลขตอนในตาราง ไม่ใช่ลำดับที่เลือก", () => {
    const r = [row({ id: 10, number: 1 }), row({ id: 20, number: 2 }), row({ id: 30, number: 3 })]
    assert.deepEqual(idsOf(new Set([30, 10]), r), [10, 30])
  })
})

describe("translateLabel", () => {
  test("ทุกตอนยังไม่มีคำแปล → แปล · ทุกตอนมีคำแปล → แปลใหม่ · ปน → แปล / แปลใหม่", () => {
    assert.equal(translateLabel([row({ hasTranslation: false })]), "แปล")
    assert.equal(translateLabel([row(), row()]), "แปลใหม่")
    assert.equal(translateLabel([row(), row({ hasTranslation: false })]), "แปล / แปลใหม่")
    assert.equal(translateLabel([]), "แปล / แปลใหม่")
  })
})

describe("bulkNotice", () => {
  test("แปล: ส่งเข้าคิว + ข้ามที่อยู่ในคิว", () => {
    assert.equal(bulkNotice("translate", { queued: 3, skipped: 0 }), "ส่งเข้าคิวแปลแล้ว 3 ตอน")
    assert.equal(bulkNotice("translate", { queued: 3, skipped: 2 }), "ส่งเข้าคิวแปลแล้ว 3 ตอน · ข้าม 2 ตอน (อยู่ในคิวหรือกำลังแปลอยู่แล้ว)")
    assert.match(bulkNotice("translate", { queued: 0, skipped: 2 }), /^ไม่มีตอนที่ส่งเข้าคิวเพิ่ม — 2 ตอน/)
    assert.equal(bulkNotice("translate", {}), "ไม่มีตอนที่ต้องส่งเข้าคิว")
  })
  test("เผยแพร่: เปลี่ยนกี่ตอน ข้ามกี่ตอนเพราะไม่มีคำแปล", () => {
    assert.equal(bulkNotice("publish", { changed: 4, skipped: 0 }), "เผยแพร่แล้ว 4 ตอน")
    assert.equal(bulkNotice("publish", { changed: 4, skipped: 1 }), "เผยแพร่แล้ว 4 ตอน · ข้าม 1 ตอน (ยังไม่มีคำแปล)")
    assert.equal(bulkNotice("publish", { changed: 0, skipped: 3 }), "ไม่ได้เผยแพร่ — ข้าม 3 ตอนที่ยังไม่มีคำแปล")
    assert.equal(bulkNotice("publish", { changed: 0, skipped: 0 }), "ตอนที่เลือกเผยแพร่อยู่แล้ว")
  })
  test("ซ่อน / ลบ", () => {
    assert.equal(bulkNotice("hide", { changed: 2 }), "ซ่อนแล้ว 2 ตอน")
    assert.equal(bulkNotice("hide", { changed: 0 }), "ตอนที่เลือกซ่อนอยู่แล้ว")
    assert.equal(bulkNotice("delete", { deleted: 5 }), "ลบแล้ว 5 ตอน")
    assert.equal(bulkNotice("delete", {}), "ไม่มีตอนที่ถูกลบ")
  })
  test("หลักพันมีจุลภาค", () => assert.equal(bulkNotice("delete", { deleted: 1234 }), "ลบแล้ว 1,234 ตอน"))
})

describe("deleteMessage", () => {
  test("ตอนเดียว: บอกเลขตอนและชื่อ + เตือนว่าถาวร", () => {
    const m = deleteMessage([row({ number: 7, titleTh: "ชื่อไทย", title: "Eng" })])
    assert.match(m, /ตอนที่ 7/)
    assert.match(m, /ชื่อไทย/)
    assert.match(m, /ถาวร/)
  })
  test("หลายตอน: จำนวน + เลขตอนไม่เกิน 5 ที่เหลือเป็น 'และอีก N ตอน'", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: i + 1, number: i + 1 }))
    const m = deleteMessage(rows)
    assert.match(m, /8 ตอน/)
    assert.match(m, /ตอนที่ 1, 2, 3, 4, 5 และอีก 3 ตอน/)
    assert.doesNotMatch(m, /6,/)
  })
  test("มีตอนที่กำลังแปล → เตือนว่าจะยกเลิกการแปล · ไม่มี → ไม่เตือน", () => {
    assert.match(deleteMessage([row({ status: "translating" })]), /ยกเลิกการแปล/)
    assert.doesNotMatch(deleteMessage([row()]), /ยกเลิกการแปล/)
  })
  test("ชื่อว่าง (ไม่มีทั้งไทยและต้นฉบับ) ไม่ทิ้งเครื่องหมายค้าง", () => {
    assert.doesNotMatch(deleteMessage([row({ number: 3, title: "", titleTh: "" })]), /“”|""/)
  })
})

describe("ขอบเขตที่ทดสอบเพิ่มหลัง mutation sweep", () => {
  test("สรุป 'แปลแล้ว' นับจากสถานะ done เท่านั้น (ตอนที่รอคิวแต่ยังมีคำแปลเก่าไม่นับ)", () => {
    const rows = [row({ id: 1, status: "done" }), row({ id: 2, status: "queued", hasTranslation: true }), row({ id: 3, status: "error", hasTranslation: true })]
    assert.equal(summaryText(rows), "ทั้งหมด 3 ตอน · แปลแล้ว 1 · เผยแพร่ 0")
  })
  test("ลบพอดี 5 ตอน: ไม่มีท่อน 'และอีก' · 6 ตอน: และอีก 1 ตอน", () => {
    const five = Array.from({ length: 5 }, (_, i) => row({ id: i + 1, number: i + 1 }))
    assert.doesNotMatch(deleteMessage(five), /และอีก/)
    assert.match(deleteMessage(five), /\(ตอนที่ 1, 2, 3, 4, 5\)/)
    assert.match(deleteMessage([...five, row({ id: 6, number: 6 })]), /และอีก 1 ตอน/)
  })
  test("ชื่อว่าง: ข้อความตรงตัว ไม่มีช่องว่างเกินก่อนเครื่องหมายคำถาม", () => {
    assert.equal(deleteMessage([row({ number: 3, title: "", titleTh: "" })]), "ลบตอนที่ 3? ต้นฉบับและคำแปลของตอนที่ลบจะหายถาวร กู้คืนไม่ได้")
  })
})

