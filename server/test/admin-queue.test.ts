import { test } from "node:test"
import assert from "node:assert/strict"
import { AiError } from "../src/ai.js"
import type { TickResult } from "../src/queue.js"
import { withTestApp, type Client, type TestApp } from "./helpers/app.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { getChapter, seedChapter, seedNovel } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const API = "/api/admin"
const QUEUE = `${API}/queue`
const PAUSE = `${QUEUE}/pause`
const RESUME = `${QUEUE}/resume`
type T = TestApp<FakeAi>

const DEFAULT_REASON = "หยุดโดยผู้ดูแล"
const THREE_ERRORS_REASON = "พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API"

/** คีย์ทั้งหมดของคำตอบ GET /queue (= สถานะของคิว + รายการตอนผิดพลาด) เรียงตามตัวอักษร */
const SNAPSHOT_KEYS = ["consecutiveErrors", "current", "errors", "paused", "pausedReason", "waiting", "waitingTotal"]
const CURRENT_KEYS = ["chapterId", "chunkIndex", "chunkTotal", "novelId", "novelTitle", "number", "textTail"]
const WAITING_KEYS = ["id", "novelId", "novelTitle", "number"]
const ERROR_KEYS = ["error", "id", "novelId", "novelTitle", "number"]

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

const snapshotOf = (t: T): string => JSON.stringify([t.db.all("SELECT * FROM chapters ORDER BY id"), t.db.all("SELECT * FROM settings ORDER BY key")])
const sorted = (o: object): string[] => Object.keys(o).sort()
const queued = (t: T, novelId: number, numbers: number[]): number[] => numbers.map((n, i) => seedChapter(t.db, novelId, n, { status: "queued", queueSeq: i + 1 }))

/** ตั้งเวลาแก้ไขล่าสุดของตอน (seedChapter ตั้งทุกตอนเป็นเวลาเดียวกัน) ไว้เรียงรายการผิดพลาด */
const touch = (t: T, id: number, updatedAt: string): void => void t.db.run("UPDATE chapters SET updated_at = ? WHERE id = ?", updatedAt, id)

const boom = (): AiError => new AiError("Claude API ขัดข้อง (HTTP 500)", { fatal: false, status: 500 })

/**
 * เริ่มแปลตอนแรกของ `ids` ด้วยคิวจริงแล้วค้างอยู่กลางชิ้นแรก (ส่งข้อความ `partial` ออกมาแล้วรอ `release()`) คืน promise ของ `tick()` ที่ยังไม่จบ
 * ตัวนี้ไม่ฟัง signal จึงต้องเรียก `release()` เสมอ (ใช้ try/finally) ไม่งั้นการปิดแอปจะรอไม่จบ
 */
function holdTranslation(t: T, ids: number[], partial = "สวัสดี"): { tick: Promise<TickResult>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  t.ai.translateChunk = async ({ onText }) => {
    onText(partial)
    await gate
    return { text: `${partial}ชาวโลก`, usage: { inputTokens: 1, outputTokens: 1 } }
  }
  t.queue.enqueue(ids, { autoPublish: false })
  return { tick: t.queue.tick(), release }
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: หมดเวลา")
    await new Promise((r) => setTimeout(r, 5))
  }
}

// ═════════════════════════ ต้องล็อกอิน / รูปแบบคำตอบ ═════════════════════════

test("ทุกเส้นทางของคิวต้องล็อกอิน: ไม่มี cookie → 401 และไม่หยุด/ไม่ทำต่อคิว ไม่เปิดเผยสถานะ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    queued(t, n, [1])
    const stranger = t.client()

    // คิวกำลังหยุดอยู่: คนแปลกหน้ากด "ทำต่อ" ไม่ได้ และอ่านสถานะ (รวมสาเหตุที่หยุด) ไม่ได้
    t.queue.pause("สาเหตุเดิม")
    let before = snapshotOf(t)
    const resume = await stranger.post(RESUME)
    assert.equal(resume.status, 401)
    assert.equal(resume.json.code, "unauthorized")
    const read = await stranger.get(QUEUE)
    assert.equal(read.status, 401)
    assert.equal(read.json.pausedReason, undefined, "ไม่รั่วสาเหตุที่หยุดให้คนแปลกหน้า")
    assert.equal(t.queue.state().pausedReason, "สาเหตุเดิม")
    assert.equal(snapshotOf(t), before)

    // คิวกำลังทำงานอยู่: คนแปลกหน้าสั่งหยุดไม่ได้
    t.queue.resume()
    before = snapshotOf(t)
    const pause = await stranger.post(PAUSE, { reason: "แกล้ง" })
    assert.equal(pause.status, 401)
    assert.equal(pause.json.code, "unauthorized")
    assert.equal(t.queue.state().paused, false)
    assert.equal(snapshotOf(t), before)
  })
})

test("คำตอบของคิวเป็น JSON และห้าม cache (Cache-Control: no-store) ทั้งตอนสำเร็จและตอนผิดพลาด", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const responses = [await c.get(QUEUE), await c.post(PAUSE), await c.post(PAUSE, { reason: 5 }), await c.post(RESUME)]
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 400, 200])
    for (const r of responses) {
      assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
      assert.equal(r.headers.get("cache-control"), "no-store")
    }
  })
})

// ═════════════════════════ สถานะคิว ═════════════════════════

test("GET /queue ตอนไม่มีอะไรเลย: ทำงานอยู่ ไม่มีตอนที่กำลังแปล รออยู่ หรือผิดพลาด · คีย์ครบตามที่หน้าเว็บใช้", async () => {
  await withTestApp({}, async (t) => {
    const r = await (await adminClient(t)).get(QUEUE)
    assert.equal(r.status, 200)
    assert.deepEqual(sorted(r.json), SNAPSHOT_KEYS)
    assert.deepEqual(r.json, { paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: 0, current: null, waiting: [], errors: [] })
  })
})

test("GET /queue: รายการที่รออยู่เรียงตามลำดับคิว แสดงชื่อไทยก่อนชื่อเดิม เฉพาะตอนที่ queued · waitingTotal นับทั้งหมด แต่แสดงแค่ 50 ตอนแรก", async () => {
  await withTestApp({}, async (t) => {
    const thai = seedNovel(t.db, { title: "English Title", titleTh: "ชื่อไทย" })
    const plain = seedNovel(t.db, { title: "Plain Title" })
    const late = seedChapter(t.db, plain, 1, { status: "queued", queueSeq: 9 })
    const first = seedChapter(t.db, thai, 12, { status: "queued", queueSeq: 2 })
    const second = seedChapter(t.db, plain, 5, { status: "queued", queueSeq: 4 })
    // สถานะอื่นไม่อยู่ในรายการรอ
    seedChapter(t.db, thai, 1, { status: "draft" })
    seedChapter(t.db, thai, 2, { status: "done", translation: "x" })
    seedChapter(t.db, thai, 3, { status: "error", error: "พัง" })
    seedChapter(t.db, thai, 4, { status: "translating" })
    const c = await adminClient(t)

    const r = await c.get(QUEUE)
    assert.equal(r.status, 200)
    assert.equal(r.json.waitingTotal, 3)
    assert.deepEqual(r.json.waiting, [
      { id: first, novelId: thai, novelTitle: "ชื่อไทย", number: 12 },
      { id: second, novelId: plain, novelTitle: "Plain Title", number: 5 },
      { id: late, novelId: plain, novelTitle: "Plain Title", number: 1 },
    ])
    for (const w of r.json.waiting) assert.deepEqual(sorted(w), WAITING_KEYS)
    assert.equal(r.json.current, null, "ตอนที่ค้างสถานะ translating ในฐานข้อมูลแต่ไม่มีใครแปลอยู่ ไม่นับเป็นตอนที่กำลังแปล")

    // รายการยาว: นับครบ แสดง 50
    const many = seedNovel(t.db, { title: "Many" })
    for (let i = 1; i <= 52; i++) seedChapter(t.db, many, i, { status: "queued", queueSeq: 100 + i })
    const long = await c.get(QUEUE)
    assert.equal(long.json.waitingTotal, 55)
    assert.equal(long.json.waiting.length, 50)
    assert.deepEqual(long.json.waiting.slice(0, 3).map((w: { id: number }) => w.id), [first, second, late])
  })
})

test("GET /queue ระหว่างแปล: current บอกตอน ชิ้นที่ x/y และข้อความที่ไหลออกมาแล้ว · ตอนที่เหลือรออยู่ในรายการรอ · จบแล้ว current เป็น null", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db, { title: "Epic", titleTh: "มหากาพย์" })
    const [one, two] = queued(t, n, [1, 2]) as [number, number]
    const c = await adminClient(t)
    const { tick, release } = holdTranslation(t, [one, two])
    try {
      const r = await c.get(QUEUE)
      assert.equal(r.status, 200)
      assert.deepEqual(sorted(r.json.current), CURRENT_KEYS)
      assert.deepEqual(r.json.current, { chapterId: one, novelId: n, novelTitle: "มหากาพย์", number: 1, chunkIndex: 0, chunkTotal: 1, textTail: "สวัสดี" })
      assert.deepEqual(r.json.waiting, [{ id: two, novelId: n, novelTitle: "มหากาพย์", number: 2 }])
      assert.equal(r.json.waitingTotal, 1)
      assert.equal(r.json.paused, false)
    } finally {
      release()
    }
    assert.equal(await tick, "done")
    const after = await c.get(QUEUE)
    assert.equal(after.json.current, null)
    assert.equal(after.json.waitingTotal, 1)
  })
})

// ═════════════════════════ ตอนผิดพลาด ═════════════════════════

test("GET /queue: errors คือตอนสถานะผิดพลาดล่าสุดก่อน (เวลาแก้ไข แล้วรหัสมากก่อน) พร้อมข้อความและชื่อเรื่อง ไม่รวมตอนสถานะอื่น", async () => {
  await withTestApp({}, async (t) => {
    const thai = seedNovel(t.db, { title: "English Title", titleTh: "ชื่อไทย" })
    const plain = seedNovel(t.db, { title: "Plain Title" })
    // สร้างตอนที่ใหม่สุดก่อน (รหัสน้อยสุด) เพื่อให้ลำดับ "ล่าสุดก่อน" ต่างจากลำดับรหัส
    const newest = seedChapter(t.db, thai, 3, { status: "error", error: "เพิ่งพัง" })
    const tieLow = seedChapter(t.db, plain, 7, { status: "error", error: "พังพร้อมกัน ก" })
    const tieHigh = seedChapter(t.db, plain, 8, { status: "error", error: "พังพร้อมกัน ข" })
    const oldest = seedChapter(t.db, thai, 1, { status: "error", error: "พังเมื่อวาน" })
    seedChapter(t.db, thai, 4, { status: "done", translation: "x", error: "ข้อความเก่าที่ไม่ควรโผล่" })
    seedChapter(t.db, thai, 5, { status: "queued", error: "ข้อความเก่าที่ไม่ควรโผล่" })
    seedChapter(t.db, thai, 6, { status: "draft", error: "ข้อความเก่าที่ไม่ควรโผล่" })
    touch(t, oldest, "2026-10-20 08:00:00")
    touch(t, tieLow, "2026-10-21 08:00:00")
    touch(t, tieHigh, "2026-10-21 08:00:00")
    touch(t, newest, "2026-10-22 08:00:00")

    const r = await (await adminClient(t)).get(QUEUE)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.errors, [
      { id: newest, novelId: thai, novelTitle: "ชื่อไทย", number: 3, error: "เพิ่งพัง" },
      { id: tieHigh, novelId: plain, novelTitle: "Plain Title", number: 8, error: "พังพร้อมกัน ข" },
      { id: tieLow, novelId: plain, novelTitle: "Plain Title", number: 7, error: "พังพร้อมกัน ก" },
      { id: oldest, novelId: thai, novelTitle: "ชื่อไทย", number: 1, error: "พังเมื่อวาน" },
    ])
    for (const e of r.json.errors) assert.deepEqual(sorted(e), ERROR_KEYS)
  })
})

test("GET /queue: errors มีไม่เกิน 20 ตอนล่าสุด (ตอนเก่ากว่าถูกตัด ไม่ใช่ตอนใหม่)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const ids: number[] = []
    for (let i = 1; i <= 25; i++) {
      const id = seedChapter(t.db, n, i, { status: "error", error: `พังตอน ${i}` })
      touch(t, id, `2026-10-22 08:${String(i).padStart(2, "0")}:00`)
      ids.push(id)
    }
    const r = await (await adminClient(t)).get(QUEUE)
    assert.equal(r.json.errors.length, 20)
    assert.deepEqual(r.json.errors.map((e: { number: number }) => e.number), Array.from({ length: 20 }, (_, i) => 25 - i))
    assert.equal(r.json.errors[0].id, ids[24])
  })
})

test("ข้อผิดพลาดชั่วคราวติดกัน 3 ตอน: คิวหยุดเองพร้อมสาเหตุ · GET /queue เห็นตัวนับ สาเหตุ และตอนที่ผิดพลาด · กด \"ทำต่อ\" ล้างสาเหตุและตัวนับ (ตอนที่ผิดพลาดยังอยู่ให้ลองใหม่)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const ids = queued(t, n, [1, 2, 3, 4])
    t.ai.script.translate = () => {
      throw boom()
    }
    assert.equal(await t.queue.tick(), "error")
    const c = await adminClient(t)
    const one = await c.get(QUEUE)
    assert.equal(one.json.consecutiveErrors, 1)
    assert.equal(one.json.paused, false)
    assert.deepEqual(one.json.errors.map((e: { id: number }) => e.id), [ids[0]])

    assert.equal(await t.queue.tick(), "error")
    assert.equal(await t.queue.tick(), "paused")
    const paused = await c.get(QUEUE)
    assert.equal(paused.json.paused, true)
    assert.equal(paused.json.pausedReason, THREE_ERRORS_REASON)
    assert.equal(paused.json.consecutiveErrors, 3)
    assert.equal(paused.json.waitingTotal, 1)
    assert.equal(paused.json.errors.length, 3)
    assert.ok(paused.json.errors.every((e: { error: string }) => e.error === "Claude API ขัดข้อง (HTTP 500)"))

    const resumed = await c.post(RESUME)
    assert.equal(resumed.status, 200)
    assert.equal(resumed.json.paused, false)
    assert.equal(resumed.json.pausedReason, "")
    assert.equal(resumed.json.consecutiveErrors, 0)
    assert.equal(resumed.json.errors.length, 3, "ตอนที่ผิดพลาดยังอยู่ ให้เจ้าของกดลองใหม่เอง")
    assert.equal(resumed.json.waitingTotal, 1)
  })
})

// ═════════════════════════ หยุด ═════════════════════════

test("POST /queue/pause: ไม่ส่งสาเหตุ → \"หยุดโดยผู้ดูแล\" · คืนสถานะใหม่ครบ · เก็บไว้ในคิวจริง", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db, { title: "Epic" })
    const [one] = queued(t, n, [1]) as [number]
    const c = await adminClient(t)

    const r = await c.post(PAUSE) // ไม่มี body เลย
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(sorted(r.json), SNAPSHOT_KEYS)
    assert.equal(r.json.paused, true)
    assert.equal(r.json.pausedReason, DEFAULT_REASON)
    assert.deepEqual(r.json.waiting, [{ id: one, novelId: n, novelTitle: "Epic", number: 1 }])
    assert.deepEqual(t.queue.state().pausedReason, DEFAULT_REASON)
    assert.equal((await c.get(QUEUE)).json.pausedReason, DEFAULT_REASON)

    t.queue.resume()
    for (const body of [{}, { reason: "" }, { reason: " \r\n ﻿​\t " }, { reason: undefined }]) {
      assert.equal((await c.post(PAUSE, body)).json.pausedReason, DEFAULT_REASON, JSON.stringify(body))
      t.queue.resume()
    }
  })
})

test("POST /queue/pause {reason}: เก็บสาเหตุที่ล้างแล้ว (ตัดช่องว่าง/อักขระล่องหน) · ฟิลด์เกินถูกเมิน · ขอบ 200 ตัวอักษรผ่าน", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const cases: [string, string][] = [
      ["  ขอพักก่อน ค่า API ใกล้หมด  ", "ขอพักก่อน ค่า API ใกล้หมด"],
      ["﻿บรรทัดแรก\r\nบรรทัดสอง ต่อ​", "บรรทัดแรก\nบรรทัดสอง ต่อ"],
      ["ก".repeat(200), "ก".repeat(200)],
    ]
    for (const [reason, stored] of cases) {
      const r = await c.post(PAUSE, { reason, paused: false, pausedReason: "ห้ามใช้", junk: 1 })
      assert.equal(r.status, 200, r.text)
      assert.equal(r.json.paused, true)
      assert.equal(r.json.pausedReason, stored)
      assert.equal(t.queue.state().pausedReason, stored)
      assert.ok(t.logs.includes(`warn: คิวแปลหยุด: ${stored}`), "หยุดผ่าน queue.pause จริง (คิวบันทึก log การหยุดพร้อมสาเหตุ)")
      t.queue.resume()
    }
  })
})

test("POST /queue/pause ด้วยข้อมูลผิด → 400 ข้อความไทยบอกชื่อฟิลด์ ไม่หยุดคิว · body ที่ไม่ใช่ออบเจ็กต์ → bad_request/bad_json", async () => {
  await withTestApp({}, async (t) => {
    const before = snapshotOf(t)
    const c = await adminClient(t)

    for (const reason of [5, null, true, ["ก"], { a: 1 }, "ก".repeat(201)]) {
      const r = await c.post(PAUSE, { reason })
      assert.equal(r.status, 400, JSON.stringify(reason).slice(0, 30))
      assert.equal(r.json.code, "invalid_field")
      assert.match(r.json.error, THAI)
      assert.match(r.json.error, /reason/)
    }
    assert.match((await c.post(PAUSE, { reason: "ก".repeat(201) })).json.error, /200/)

    for (const [body, code] of [[[], "bad_request"], ["x", "bad_json"], [5, "bad_json"], [null, "bad_json"]] as const) {
      const r = await c.post(PAUSE, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, code, JSON.stringify(body))
      assert.match(r.json.error, THAI)
    }
    assert.equal(t.queue.state().paused, false)
    assert.equal(snapshotOf(t), before)
  })
})

test("หยุดซ้ำตอนคิวหยุดอยู่แล้ว: ไม่ระบุสาเหตุ → คงสาเหตุเดิมไว้ (แท็บเก่าที่ยังเห็นปุ่มหยุดไม่ลบสาเหตุจริงของระบบ) · ระบุสาเหตุใหม่ → ใช้สาเหตุใหม่", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.queue.pause("API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)")

    const bare = await c.post(PAUSE)
    assert.equal(bare.status, 200)
    assert.equal(bare.json.pausedReason, "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)")
    assert.equal((await c.post(PAUSE, {})).json.pausedReason, "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)")
    assert.equal((await c.post(PAUSE, { reason: "  " })).json.pausedReason, "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)")

    const explicit = await c.post(PAUSE, { reason: "ผู้ดูแลพักงาน" })
    assert.equal(explicit.json.pausedReason, "ผู้ดูแลพักงาน")
    assert.equal(t.queue.state().pausedReason, "ผู้ดูแลพักงาน")
  })
})

test("หยุดคิวจริง: ตอนที่รออยู่ไม่ถูกหยิบไปแปล (tick → paused, ไม่เรียก AI) · ทำต่อแล้วแปลต่อได้", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const [one] = queued(t, n, [1]) as [number]
    const c = await adminClient(t)

    assert.equal((await c.post(PAUSE)).status, 200)
    assert.equal(await t.queue.tick(), "paused")
    assert.deepEqual(t.ai.calls, [])
    assert.equal(getChapter(t.db, one).status, "queued")
    assert.equal((await c.get(QUEUE)).json.waitingTotal, 1)

    assert.equal((await c.post(RESUME)).status, 200)
    t.ai.script.translate = () => "คำแปลหลังทำต่อ"
    assert.equal(await t.queue.tick(), "done")
    assert.equal(getChapter(t.db, one).status, "done")
    assert.equal(getChapter(t.db, one).translation, "คำแปลหลังทำต่อ")
  })
})

test("หยุดระหว่างที่กำลังแปล: ตอนที่ทำอยู่ทำจนจบ (ไม่ถูกตัด) แล้วไม่หยิบตอนถัดไป", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const [one, two] = queued(t, n, [1, 2]) as [number, number]
    const c = await adminClient(t)
    const { tick, release } = holdTranslation(t, [one, two])
    try {
      const r = await c.post(PAUSE, { reason: "พักหลังตอนนี้" })
      assert.equal(r.status, 200)
      assert.equal(r.json.paused, true)
      assert.equal(r.json.current.chapterId, one, "ตอนที่ทำอยู่ยังแสดงเป็นตอนที่กำลังแปล")
      assert.equal(r.json.current.textTail, "สวัสดี")
    } finally {
      release()
    }
    assert.equal(await tick, "done")
    assert.equal(getChapter(t.db, one).status, "done")
    assert.equal(getChapter(t.db, one).translation, "สวัสดีชาวโลก")
    assert.equal(getChapter(t.db, two).status, "queued")
    assert.equal(await t.queue.tick(), "paused")
    assert.equal(getChapter(t.db, two).status, "queued")
  })
})

// ═════════════════════════ ทำต่อ ═════════════════════════

test("POST /queue/resume: ล้างสาเหตุที่หยุด · คืนสถานะใหม่ · เรียกซ้ำตอนไม่ได้หยุดอยู่ก็ไม่ผิดพลาด · ไม่สนใจ body", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    queued(t, n, [1, 2])
    const c = await adminClient(t)
    t.queue.pause("สาเหตุเดิม")

    const r = await c.post(RESUME)
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(sorted(r.json), SNAPSHOT_KEYS)
    assert.equal(r.json.paused, false)
    assert.equal(r.json.pausedReason, "")
    assert.equal(r.json.waitingTotal, 2)
    assert.equal(t.queue.state().paused, false)
    assert.equal(t.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'queue_paused_reason'")?.value, "", "ล้างค่าที่เก็บไว้จริง ไม่ใช่แค่ซ่อน")

    const again = await c.post(RESUME, { reason: "ไม่ใช้", junk: [1, 2] })
    assert.equal(again.status, 200)
    assert.equal(again.json.paused, false)
  })
})

test("ทำต่อปลุกลูปคิวทันที (ไม่ต้องรอรอบ 5 วินาที): คิวที่หยุดอยู่และมีตอนรออยู่ เริ่มแปลภายในไม่กี่ร้อยมิลลิวินาทีหลังกดทำต่อ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const [one] = queued(t, n, [1]) as [number]
    const c = await adminClient(t)
    t.ai.script.translate = () => "แปลหลังถูกปลุก"

    assert.equal((await c.post(PAUSE)).status, 200)
    t.queue.start()
    await new Promise((r) => setTimeout(r, 50)) // ให้ลูปรอบแรกเห็นว่าหยุดอยู่แล้วเข้าสู่การรอ
    assert.equal(getChapter(t.db, one).status, "queued")

    assert.equal((await c.post(RESUME)).status, 200)
    await until(() => getChapter(t.db, one).status === "done", 2500)
    assert.equal(getChapter(t.db, one).translation, "แปลหลังถูกปลุก")
  })
})

test("ทำต่อหลังหยุดเพราะไม่มี API key: เจ้าของเพิ่ม key แล้วกดทำต่อ คิวแปลต่อได้ · ถ้ายังไม่มี key คิวหยุดอีกพร้อมสาเหตุเดิม (ไม่ค้างว่าทำงานอยู่)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const [one] = queued(t, n, [1]) as [number]
    const c = await adminClient(t)
    t.ai.script.hasKey = false

    assert.equal(await t.queue.tick(), "paused")
    const stuck = await c.get(QUEUE)
    assert.equal(stuck.json.paused, true)
    assert.match(stuck.json.pausedReason, /ANTHROPIC_API_KEY/)
    assert.deepEqual(t.ai.calls, [])

    assert.equal((await c.post(RESUME)).json.paused, false)
    assert.equal(await t.queue.tick(), "paused", "ยังไม่มี key: หยุดอีกครั้ง")
    assert.match((await c.get(QUEUE)).json.pausedReason, /ANTHROPIC_API_KEY/)

    t.ai.script.hasKey = true
    assert.equal((await c.post(RESUME)).json.paused, false)
    assert.equal(await t.queue.tick(), "done")
    assert.equal(getChapter(t.db, one).status, "done")
  })
})
