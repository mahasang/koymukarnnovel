import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  apiStatus,
  chapterPath,
  chunkProgress,
  formatUsd,
  isNearBottom,
  onboardingComplete,
  onboardingItems,
  progressPercent,
  publishNotice,
  queueIdleNote,
  queueSignature,
  thaiDateTime,
  usageTotals,
  waitingRows,
} from "./dashboard-logic"
import type { QueueError, QueueState } from "./types"

const state = (over: Partial<QueueState> = {}): QueueState => ({
  paused: false,
  pausedReason: "",
  consecutiveErrors: 0,
  waitingTotal: 0,
  current: null,
  waiting: [],
  ...over,
})
const current = (over: Partial<NonNullable<QueueState["current"]>> = {}): NonNullable<QueueState["current"]> => ({
  chapterId: 7,
  novelId: 2,
  novelTitle: "เรื่องหนึ่ง",
  number: 12,
  chunkIndex: 0,
  chunkTotal: 3,
  textTail: "",
  ...over,
})
const error = (id: number): QueueError => ({ id, novelId: 2, novelTitle: "เรื่องหนึ่ง", number: id, error: "แปลไม่สำเร็จ" })

describe("onboardingItems: เริ่มต้นใช้งาน 3 ข้อ", () => {
  test("ครบ 3 ข้อตามลำดับ: รหัส API → ช่องทางติดต่อ → นิยายเรื่องแรก และพาไปหน้าที่ทำข้อนั้นได้", () => {
    const items = onboardingItems({ apiKey: false, contact: false, firstNovel: false })
    assert.deepEqual(
      items.map((item) => item.id),
      ["api-key", "contact", "first-novel"],
    )
    assert.deepEqual(
      items.map((item) => item.to),
      ["/admin/settings", "/admin/settings", "/admin/novels/new"],
    )
    for (const item of items) {
      assert.notEqual(item.title.trim(), "")
      assert.notEqual(item.hint.trim(), "")
      assert.equal(item.done, false)
    }
  })

  test("ข้อช่องทางติดต่อที่ยังไม่ทำเท่านั้นที่เตือนสีเด่น (warn)", () => {
    const todo = onboardingItems({ apiKey: false, contact: false, firstNovel: false })
    assert.deepEqual(
      todo.map((item) => item.warn),
      [false, true, false],
    )
    const done = onboardingItems({ apiKey: true, contact: true, firstNovel: true })
    assert.deepEqual(
      done.map((item) => item.warn),
      [false, false, false],
    )
  })

  test("done ตามค่าของแต่ละข้อ", () => {
    const items = onboardingItems({ apiKey: true, contact: false, firstNovel: true })
    assert.deepEqual(
      items.map((item) => item.done),
      [true, false, true],
    )
    // แต่ละธงเป็นของข้อตัวเองข้อเดียว
    const only = (flags: Partial<{ apiKey: boolean; contact: boolean; firstNovel: boolean }>) =>
      onboardingItems({ apiKey: false, contact: false, firstNovel: false, ...flags }).map((item) => item.done)
    assert.deepEqual(only({ apiKey: true }), [true, false, false])
    assert.deepEqual(only({ contact: true }), [false, true, false])
    assert.deepEqual(only({ firstNovel: true }), [false, false, true])
  })

  test("ข้อความของแต่ละข้อ (ชื่อและคำแนะนำ) ตรงตามที่ออกแบบ", () => {
    const items = onboardingItems({ apiKey: false, contact: false, firstNovel: false })
    assert.deepEqual(
      items.map((item) => item.title),
      ["ตั้งรหัส API สำหรับแปล", "กรอกช่องทางติดต่อเจ้าของลิขสิทธิ์", "สร้างนิยายเรื่องแรก"],
    )
    assert.deepEqual(
      items.map((item) => item.hint),
      [
        "ตั้ง ANTHROPIC_API_KEY ให้เซิร์ฟเวอร์ — หรือตั้ง IMPORT_TOKEN ถ้าจะส่งคำแปลเข้ามาจากภายนอก แล้วดูสถานะในหน้าตั้งค่า",
        "ให้เจ้าของผลงานติดต่อขอแก้ไขหรือถอดเรื่องได้ — ข้อความนี้แสดงในหน้า “ติดต่อ” ของเว็บ",
        "ใส่ชื่อเรื่อง แล้ววางตอนภาษาอังกฤษเพื่อให้ AI แปลเป็นไทย",
      ],
    )
  })

  test("onboardingComplete: ครบทั้งสามข้อจึงเป็นจริง (ขาดข้อเดียวก็ยังไม่ครบ)", () => {
    assert.equal(onboardingComplete({ apiKey: true, contact: true, firstNovel: true }), true)
    assert.equal(onboardingComplete({ apiKey: false, contact: true, firstNovel: true }), false)
    assert.equal(onboardingComplete({ apiKey: true, contact: false, firstNovel: true }), false)
    assert.equal(onboardingComplete({ apiKey: true, contact: true, firstNovel: false }), false)
  })
})

describe("queueSignature: เปลี่ยนเมื่อตัวเลขบนแดชบอร์ดน่าจะเปลี่ยน", () => {
  test("เหมือนเดิมเมื่อแค่ส่วนที่แปลอยู่/ข้อความที่ไหลเปลี่ยน (ไม่โหลดแดชบอร์ดใหม่ทุกครั้งที่ข้อความไหล)", () => {
    const a = queueSignature(state({ current: current({ chunkIndex: 0, textTail: "ก" }) }), [])
    const b = queueSignature(state({ current: current({ chunkIndex: 2, textTail: "กขค" }) }), [])
    assert.equal(a, b)
  })

  test("เปลี่ยนเมื่อ: ตอนที่กำลังแปลเปลี่ยน/จบ, จำนวนที่รอ, หยุด/ทำต่อ, รายการผิดพลาด", () => {
    const base = queueSignature(state({ current: current(), waitingTotal: 3 }), [error(1)])
    const variants = [
      queueSignature(state({ current: current({ chapterId: 8 }), waitingTotal: 3 }), [error(1)]),
      queueSignature(state({ current: null, waitingTotal: 3 }), [error(1)]),
      queueSignature(state({ current: current(), waitingTotal: 2 }), [error(1)]),
      queueSignature(state({ current: current(), waitingTotal: 3, paused: true }), [error(1)]),
      queueSignature(state({ current: current(), waitingTotal: 3 }), [error(1), error(2)]),
      queueSignature(state({ current: current(), waitingTotal: 3 }), [error(2)]),
      queueSignature(state({ current: current(), waitingTotal: 3 }), []),
    ]
    for (const variant of variants) assert.notEqual(variant, base)
    assert.equal(new Set(variants).size, variants.length)
  })

  test("ยังไม่เคยได้สถานะ (null) ต่างจากทุกสถานะจริง", () => {
    assert.notEqual(queueSignature(null, []), queueSignature(state(), []))
    assert.equal(queueSignature(null, []), "pending")
  })

  test("รูปแบบลายเซ็นตายตัว: หยุด/ทำงาน | ตอนที่แปลอยู่ (- ถ้าไม่มี) | จำนวนที่รอ | id ผิดพลาดเรียงจากน้อยไปมาก", () => {
    assert.equal(queueSignature(state(), []), "running|-|0|")
    assert.equal(queueSignature(state({ paused: true, waitingTotal: 3 }), []), "paused|-|3|")
    assert.equal(queueSignature(state({ current: current({ chapterId: 7 }), waitingTotal: 2 }), [error(10), error(9)]), "running|7|2|9,10")
  })

  test("รายการผิดพลาดชุดเดิมที่เรียงต่างกันได้ลายเซ็นเดียวกัน แต่ id ต่างกันไม่ชนกัน (1,23 ≠ 1,2,3)", () => {
    assert.equal(queueSignature(state(), [error(1), error(2)]), queueSignature(state(), [error(2), error(1)]))
    assert.notEqual(queueSignature(state(), [error(1), error(23)]), queueSignature(state(), [error(1), error(2), error(3)]))
    assert.notEqual(queueSignature(state(), [error(12), error(3)]), queueSignature(state(), [error(1), error(23)]))
  })
})

describe("isNearBottom: เลื่อนตามข้อความที่ไหลเฉพาะตอนผู้ใช้อยู่ท้ายกล่อง", () => {
  test("อยู่ท้ายสุดพอดี หรือเหลือไม่เกินเกณฑ์ → จริง", () => {
    assert.equal(isNearBottom(400, 100, 500), true)
    assert.equal(isNearBottom(376, 100, 500), true) // เหลือ 24
    assert.equal(isNearBottom(0, 100, 100), true) // ไม่มีอะไรให้เลื่อน
  })

  test("เหลือมากกว่าเกณฑ์ → เท็จ (ผู้ใช้เลื่อนขึ้นไปอ่านเอง ห้ามดึงกลับ)", () => {
    assert.equal(isNearBottom(375, 100, 500), false) // เหลือ 25
    assert.equal(isNearBottom(0, 100, 500), false)
  })

  test("เกณฑ์ปรับได้ และเลื่อนเลยท้าย (overscroll/ทศนิยม) ก็ยังนับว่าอยู่ท้าย", () => {
    assert.equal(isNearBottom(300, 100, 500, 100), true)
    assert.equal(isNearBottom(300, 100, 500, 99), false)
    assert.equal(isNearBottom(401, 100, 500), true)
  })

  test("ค่าที่ใช้ไม่ได้ (NaN) → จริง (ถือว่าตามท้ายเหมือนเดิม) ไม่ว่าค่าไหนเป็น NaN", () => {
    assert.equal(isNearBottom(Number.NaN, 100, 500), true)
    assert.equal(isNearBottom(0, Number.NaN, 500), true)
    assert.equal(isNearBottom(0, 100, Number.NaN), true)
    assert.equal(isNearBottom(0, 100, 500, Number.NaN), true)
  })
})

describe("chunkProgress", () => {
  test("บอกส่วนที่กำลังแปล (นับจาก 1) และสัดส่วนส่วนที่แปลเสร็จแล้ว", () => {
    assert.deepEqual(chunkProgress({ chunkIndex: 1, chunkTotal: 3 }), { label: "กำลังแปล ส่วนที่ 2 จาก 3", percent: 33 })
    assert.deepEqual(chunkProgress({ chunkIndex: 0, chunkTotal: 4 }), { label: "กำลังแปล ส่วนที่ 1 จาก 4", percent: 0 })
    assert.deepEqual(chunkProgress({ chunkIndex: 2, chunkTotal: 3 }), { label: "กำลังแปล ส่วนที่ 3 จาก 3", percent: 67 })
  })

  test("ลำดับส่วนที่อ่านไม่ได้ (NaN/อินฟินิตี้) ถือเป็นส่วนแรก ไม่ใช่ NaN", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(chunkProgress({ chunkIndex: bad, chunkTotal: 4 }), { label: "กำลังแปล ส่วนที่ 1 จาก 4", percent: 0 })
    }
  })

  test("ยังไม่รู้จำนวนส่วน (0) → ไม่หารด้วยศูนย์ ไม่มี NaN", () => {
    assert.deepEqual(chunkProgress({ chunkIndex: 0, chunkTotal: 0 }), { label: "กำลังเตรียมแปล", percent: 0 })
  })

  test("ค่าเกินช่วงถูกตรึงไว้ (ส่วนที่ไม่เกินจำนวนส่วน, 0–100%)", () => {
    assert.deepEqual(chunkProgress({ chunkIndex: 9, chunkTotal: 3 }), { label: "กำลังแปล ส่วนที่ 3 จาก 3", percent: 100 })
    assert.equal(chunkProgress({ chunkIndex: -2, chunkTotal: 3 }).percent, 0)
    assert.equal(chunkProgress({ chunkIndex: -2, chunkTotal: 3 }).label, "กำลังแปล ส่วนที่ 1 จาก 3")
  })
})

describe("waitingRows", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, novelId: 1, novelTitle: "ก", number: i + 1 }))

  test("แสดงไม่เกินเพดาน ที่เหลือบอกเป็น 'และอีก N ตอน' (นับจากจำนวนรอทั้งหมด ไม่ใช่แค่ 50 แถวที่ส่งมา)", () => {
    const small = waitingRows(state({ waiting: rows(12), waitingTotal: 12 }), 8)
    assert.equal(small.rows.length, 8)
    assert.equal(small.more, 4)
    const big = waitingRows(state({ waiting: rows(50), waitingTotal: 130 }), 8)
    assert.equal(big.rows.length, 8)
    assert.equal(big.more, 122)
  })

  test("น้อยกว่าเพดานแสดงหมด ไม่มีส่วนเกิน; ค่าเริ่มต้นเพดานคือ 8", () => {
    const few = waitingRows(state({ waiting: rows(3), waitingTotal: 3 }))
    assert.equal(few.rows.length, 3)
    assert.equal(few.more, 0)
    assert.equal(waitingRows(state({ waiting: rows(20), waitingTotal: 20 })).rows.length, 8)
  })

  test("จำนวนรวมที่น้อยกว่าแถวที่ส่งมา (ข้อมูลเหลื่อมกัน) ไม่ทำให้ได้ค่าติดลบ; ว่าง → ไม่มีอะไร", () => {
    assert.equal(waitingRows(state({ waiting: rows(10), waitingTotal: 2 }), 8).more, 0)
    assert.deepEqual(waitingRows(state(), 8), { rows: [], more: 0 })
  })
})

describe("formatUsd", () => {
  test("ประเมินไม่ได้ (null) → null (หน้าจอแสดงข้อความแนะนำแทนตัวเลข)", () => {
    assert.equal(formatUsd(null), null)
  })

  test("ตั้งแต่ 1 ดอลลาร์ขึ้นไป 2 ตำแหน่งทศนิยม แบ่งหลักพัน", () => {
    assert.equal(formatUsd(1), "$1.00")
    assert.equal(formatUsd(1.234), "$1.23")
    assert.equal(formatUsd(12.5), "$12.50")
    assert.equal(formatUsd(1234.5), "$1,234.50")
  })

  test("ต่ำกว่า 1 ดอลลาร์เก็บทศนิยมถึง 4 ตำแหน่ง ตัดศูนย์ท้าย (แต่ไม่ต่ำกว่า 2 ตำแหน่ง)", () => {
    assert.equal(formatUsd(0.5), "$0.50")
    assert.equal(formatUsd(0.123), "$0.123")
    assert.equal(formatUsd(0.0042), "$0.0042")
    assert.equal(formatUsd(0.99996), "$1.00")
  })

  test("ศูนย์ = ยังไม่ได้ใช้ → $0.00 · เล็กกว่าที่แสดงได้ → <$0.0001 (ขอบอยู่ที่ 0.0001 พอดี)", () => {
    assert.equal(formatUsd(0), "$0.00")
    assert.equal(formatUsd(0.00001), "<$0.0001")
    assert.equal(formatUsd(0.00009), "<$0.0001")
    assert.equal(formatUsd(0.0001), "$0.0001")
    assert.equal(formatUsd(0.0005), "$0.0005")
  })

  test("ขอบ 1 ดอลลาร์: 0.9999 ยังเป็น $0.9999 · 0.99996 ปัดขึ้นเป็น $1.00 (ไม่ใช่ $1.0000)", () => {
    assert.equal(formatUsd(0.9999), "$0.9999")
    assert.equal(formatUsd(0.99996), "$1.00")
    assert.equal(formatUsd(1), "$1.00")
    assert.equal(formatUsd(9.999), "$10.00")
  })

  test("ค่าที่ใช้ไม่ได้ (ลบ NaN อินฟินิตี้) → null", () => {
    assert.equal(formatUsd(-1), null)
    assert.equal(formatUsd(Number.NaN), null)
    assert.equal(formatUsd(Number.POSITIVE_INFINITY), null)
  })
})

describe("thaiDateTime: เวลา UTC จากเซิร์ฟเวอร์ → วันที่และเวลาไทย (UTC+7)", () => {
  test("ข้ามเที่ยงคืนไปวันถัดไป", () => {
    assert.equal(thaiDateTime("2026-10-30 17:28:00"), "31 ต.ค. 2569 00:28 น.")
    assert.equal(thaiDateTime("2026-01-05 03:04:59"), "5 ม.ค. 2569 10:04 น.")
  })

  test("รูปแบบผิดหรือวันที่ไม่มีจริง → สตริงว่าง", () => {
    assert.equal(thaiDateTime(""), "")
    assert.equal(thaiDateTime("เมื่อวาน"), "")
    assert.equal(thaiDateTime("2026-02-30 10:00:00"), "")
  })
})

describe("progressPercent", () => {
  test("ปัดเศษเป็นเปอร์เซ็นต์ของตอนที่แปลแล้วต่อตอนทั้งหมด", () => {
    assert.equal(progressPercent(45, 120), 38)
    assert.equal(progressPercent(1, 3), 33) // ปัดเศษ ไม่ใช่ปัดขึ้น
    assert.equal(progressPercent(2, 3), 67)
    assert.equal(progressPercent(60, 60), 100)
    assert.equal(progressPercent(0, 10), 0)
  })

  test("เรื่องที่ยังไม่มีตอน (0) ไม่หารด้วยศูนย์; ค่าเกินช่วง/ใช้ไม่ได้ถูกตรึง 0–100", () => {
    assert.equal(progressPercent(0, 0), 0)
    assert.equal(progressPercent(5, 0), 0)
    assert.equal(progressPercent(130, 120), 100)
    assert.equal(progressPercent(-1, 10), 0)
    assert.equal(progressPercent(Number.NaN, 10), 0)
  })
})

describe("usageTotals", () => {
  test("รวมโทเคนเข้า ออก และจำนวนครั้งเรียก ของทุกโมเดล", () => {
    assert.deepEqual(
      usageTotals([
        { model: "a", tokensIn: 100, tokensOut: 50, calls: 2 },
        { model: "b", tokensIn: 1000, tokensOut: 400, calls: 5 },
      ]),
      { tokensIn: 1100, tokensOut: 450, calls: 7 },
    )
  })

  test("ไม่มีรายการ → ศูนย์ทั้งหมด", () => {
    assert.deepEqual(usageTotals([]), { tokensIn: 0, tokensOut: 0, calls: 0 })
  })
})

describe("apiStatus", () => {
  const checked = { at: "2026-10-30 17:28:00", ok: true, message: "" }

  test("ไม่ได้ตั้งรหัส → เตือน (แม้เคยทดสอบผ่านตอนยังมีรหัส)", () => {
    assert.equal(apiStatus({ hasKey: false, lastOk: null }).tone, "warn")
    assert.equal(apiStatus({ hasKey: false, lastOk: checked }).tone, "warn")
    assert.match(apiStatus({ hasKey: false, lastOk: null }).label, /ยังไม่ได้ตั้งรหัส/)
  })

  test("ข้อความเต็มของสถานะ: ไม่มีรหัส · ตั้งรหัสแล้วแต่ไม่เคยทดสอบ", () => {
    assert.deepEqual(apiStatus({ hasKey: false, lastOk: null }), { tone: "warn", label: "ยังไม่ได้ตั้งรหัส API", detail: "แปลด้วย AI ไม่ได้จนกว่าจะตั้งรหัส" })
    assert.deepEqual(apiStatus({ hasKey: true, lastOk: null }), { tone: "idle", label: "ตั้งรหัสแล้ว", detail: "ยังไม่เคยทดสอบการเชื่อมต่อ" })
  })

  test("ตั้งรหัสแล้วแต่ไม่เคยทดสอบ → กลางๆ", () => {
    const status = apiStatus({ hasKey: true, lastOk: null })
    assert.equal(status.tone, "idle")
    assert.match(status.detail, /ยังไม่เคยทดสอบ/)
  })

  test("ทดสอบล่าสุดผ่าน → พร้อมใช้งาน พร้อมเวลาไทย", () => {
    const status = apiStatus({ hasKey: true, lastOk: checked })
    assert.equal(status.tone, "ok")
    assert.equal(status.label, "API พร้อมใช้งาน")
    assert.match(status.detail, /31 ต\.ค\. 2569 00:28 น\./)
    assert.equal(status.detail, "ทดสอบล่าสุด 31 ต.ค. 2569 00:28 น.")
  })

  test("ทดสอบล่าสุดไม่ผ่าน → ล้มเหลว พร้อมข้อความที่เซิร์ฟเวอร์ส่งมา", () => {
    const status = apiStatus({ hasKey: true, lastOk: { at: "2026-10-30 17:28:00", ok: false, message: "รหัสไม่ถูกต้อง" } })
    assert.equal(status.tone, "fail")
    assert.match(status.detail, /รหัสไม่ถูกต้อง/)
    assert.match(status.detail, /31 ต\.ค\. 2569/)
    assert.deepEqual(status, { tone: "fail", label: "เชื่อมต่อ API ไม่สำเร็จ", detail: "31 ต.ค. 2569 00:28 น. · รหัสไม่ถูกต้อง" })
  })

  test("เวลาที่อ่านไม่ได้ → ข้ามส่วนเวลา ไม่แสดงขยะ", () => {
    const status = apiStatus({ hasKey: true, lastOk: { at: "???", ok: false, message: "หมดเวลา" } })
    assert.equal(status.detail, "หมดเวลา")
    assert.equal(apiStatus({ hasKey: true, lastOk: { at: "???", ok: true, message: "" } }).detail, "")
  })
})

describe("publishNotice", () => {
  test("บอกจำนวนที่เผยแพร่ และที่ข้าม (ถ้ามี)", () => {
    assert.equal(publishNotice({ changed: 5 }), "เผยแพร่แล้ว 5 ตอน")
    assert.equal(publishNotice({ changed: 1200, skipped: 2 }), "เผยแพร่แล้ว 1,200 ตอน · ข้าม 2 ตอน")
  })

  test("ขอบเขต: เผยแพร่ 1 ตอน · ข้าม 1 ตอน · ข้ามหลักพัน · ข้าม 0 ไม่ต้องพูดถึง", () => {
    assert.equal(publishNotice({ changed: 1 }), "เผยแพร่แล้ว 1 ตอน")
    assert.equal(publishNotice({ changed: 3, skipped: 1 }), "เผยแพร่แล้ว 3 ตอน · ข้าม 1 ตอน")
    assert.equal(publishNotice({ changed: 3, skipped: 1500 }), "เผยแพร่แล้ว 3 ตอน · ข้าม 1,500 ตอน")
    assert.equal(publishNotice({ changed: 3, skipped: 0 }), "เผยแพร่แล้ว 3 ตอน")
    assert.equal(publishNotice({ changed: 1200 }), "เผยแพร่แล้ว 1,200 ตอน")
  })

  test("ไม่มีอะไรเปลี่ยน → บอกตรงๆ (ไม่ใช่ 'เผยแพร่แล้ว 0 ตอน')", () => {
    assert.equal(publishNotice({ changed: 0 }), "ไม่มีตอนที่ต้องเผยแพร่เพิ่ม")
    assert.equal(publishNotice({}), "ไม่มีตอนที่ต้องเผยแพร่เพิ่ม")
  })
})

describe("chapterPath", () => {
  test("ลิงก์ไปหน้าแก้ตอนของเรื่องนั้น", () => {
    assert.equal(chapterPath(3, 17), "/admin/novels/3/chapters/17")
  })
})

describe("queueIdleNote: ข้อความในแผงคิวเมื่อไม่มีตอนที่กำลังแปล", () => {
  test("มีตอนกำลังแปล → ไม่ต้องมีข้อความ (แสดงตอนนั้นแทน)", () => {
    assert.equal(queueIdleNote(state({ current: current(), waitingTotal: 5 })), null)
    assert.equal(queueIdleNote(state({ current: current(), paused: true })), null)
  })

  test("คิวหยุด → บอกวิธีทำต่อ (แม้มีตอนค้างหรือไม่มี)", () => {
    assert.match(queueIdleNote(state({ paused: true, waitingTotal: 3 })) ?? "", /คิวหยุดอยู่/)
    assert.match(queueIdleNote(state({ paused: true })) ?? "", /ทำต่อ/)
  })

  test("ไม่หยุดแต่มีตอนรอ → กำลังเตรียมแปลตอนถัดไป", () => {
    assert.equal(queueIdleNote(state({ waitingTotal: 2 })), "กำลังเตรียมแปลตอนถัดไป…")
    assert.equal(queueIdleNote(state({ waitingTotal: 1 })), "กำลังเตรียมแปลตอนถัดไป…")
  })

  test("ไม่มีอะไรเลย → คิวว่าง", () => {
    assert.equal(queueIdleNote(state()), "คิวว่าง — ยังไม่มีตอนรอแปล")
  })
})
