import { test } from "node:test"
import assert from "node:assert/strict"
import { API_CHECK_KEY } from "../src/api-check.js"
import { recordUsage } from "../src/usage.js"
import { withTestApp, TEST_IMPORT_TOKEN, TEST_PASSWORD, type Client, type TestApp } from "./helpers/app.js"
import { createClock } from "./helpers/clock.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { getChapter, seedChapter, seedNovel, type SeedChapter } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const DASHBOARD = "/api/admin/dashboard"
const BULK = "/api/admin/chapters/bulk"
type T = TestApp<FakeAi>

const SONNET = "claude-sonnet-5-5"
const HAIKU = "claude-haiku-4-5-20251001"

/** คีย์ทั้งหมดของ Dashboard เรียงตามตัวอักษร */
const TOP_KEYS = ["api", "counts", "estimate", "onboarding", "progress", "queue", "usage", "views"]
const COUNT_KEYS = ["errors", "publishedChapters", "publishedNovels", "queued", "readyToPublish", "totalNovels"]

const sorted = (o: object): string[] => Object.keys(o).sort()

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

/** ทุกตารางที่ Dashboard อ่าน: ใช้ยืนยันว่าการเปิดหน้าไม่เขียนอะไร */
const tables = (t: T): string => JSON.stringify(["novels", "chapters", "glossary", "settings", "usage", "views"].map((name) => t.db.all(`SELECT * FROM ${name}`)))

const seedViews = (t: T, rows: [day: string, novelId: number, count: number][]): void => {
  for (const [day, novelId, count] of rows) t.db.run("INSERT INTO views (day, novel_id, count) VALUES (?, ?, ?)", day, novelId, count)
}

const addDays = (day: string, k: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10)
/** `n` วันที่ลงท้ายที่ `last` เรียงเก่า→ใหม่ */
const dayList = (last: string, n = 14): string[] => Array.from({ length: n }, (_, i) => addDays(last, i - (n - 1)))

const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens })

// ═════════════════════════ ต้องล็อกอิน / รูปแบบคำตอบ ═════════════════════════

test("GET /dashboard ต้องล็อกอิน: ไม่มี cookie → 401 ไม่เปิดเผยข้อมูลและไม่เปลี่ยนอะไร", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db, { title: "Secret Novel" })
    seedChapter(t.db, n, 1, { status: "error", error: "ข้อความลับของตอน" })
    const before = tables(t)
    const r = await t.client().get(DASHBOARD)
    assert.equal(r.status, 401)
    assert.equal(r.json.code, "unauthorized")
    assert.match(r.json.error, THAI)
    assert.doesNotMatch(r.text, /Secret Novel|ข้อความลับของตอน/)
    assert.equal(tables(t), before)
  })
})

test("GET /dashboard เป็น JSON ห้าม cache และไม่แก้ข้อมูล ไม่เรียก AI ไม่แตะคิว", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedChapter(t.db, n, 1, { status: "queued", queueSeq: 1 })
    seedChapter(t.db, n, 2, { status: "done", translation: "x" })
    recordUsage(t.db, "2026-10-22", SONNET, usage(10, 5))
    seedViews(t, [["2026-10-22", n, 3]])
    const before = tables(t)
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
    assert.equal(r.headers.get("cache-control"), "no-store")
    assert.equal(tables(t), before)
    assert.deepEqual(t.ai.calls, [])
    assert.equal(t.queue.state().waitingTotal, 1)
  })
})

test("Dashboard ไม่มีความลับในคำตอบ: ไม่มีรหัสผ่านผู้ดูแล API key หรือ IMPORT_TOKEN", async () => {
  await withTestApp({ config: { anthropicApiKey: "sk-ant-api03-SECRET-KEY-VALUE-123" } }, async (t) => {
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.equal(r.status, 200)
    for (const secret of ["sk-ant-api03-SECRET-KEY-VALUE-123", TEST_PASSWORD, TEST_IMPORT_TOKEN]) assert.ok(!r.text.includes(secret), `ห้ามมี ${secret.slice(0, 8)}… ในคำตอบ`)
  })
})

// ═════════════════════════ ระบบว่างเปล่า ═════════════════════════

test("Dashboard ตอนยังไม่มีอะไรเลย: ตัวเลขเป็นศูนย์ รายการว่าง ยอดอ่าน 14 วันเป็นศูนย์ ประเมินค่าใช้จ่ายไม่ได้ และยังไม่เริ่มต้นใช้งาน", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now, config: { importToken: null } }, async (t) => {
    t.ai.script.hasKey = false
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(sorted(r.json), TOP_KEYS)
    assert.deepEqual(r.json.onboarding, { apiKey: false, contact: false, firstNovel: false })
    assert.deepEqual(r.json.counts, { publishedNovels: 0, totalNovels: 0, publishedChapters: 0, queued: 0, errors: 0, readyToPublish: 0 })
    assert.deepEqual(r.json.queue, { paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: 0, current: null, waiting: [] })
    assert.deepEqual(r.json.views, dayList("2026-10-22").map((day) => ({ day, count: 0 })))
    assert.deepEqual(r.json.progress, [])
    assert.deepEqual(r.json.usage, { today: [], last30: [] })
    assert.deepEqual(r.json.estimate, { today: null, last30: null })
    assert.deepEqual(r.json.api, { hasKey: false, lastOk: null })
  })
})

// ═════════════════════════ ตัวเลข ═════════════════════════

test("counts จากข้อมูลตัวอย่าง: เรื่องที่เผยแพร่/ทั้งหมด · ตอนที่เผยแพร่ (นับตามธงของตอน) · ตอนในคิว · ตอนผิดพลาด · ตอนที่แปลแล้วแต่ยังไม่เผยแพร่ (ทุกตัวเลขต่างกัน จึงสลับช่องกันไม่ได้)", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A", published: true })
    const b = seedNovel(t.db, { title: "B", published: true })
    const c = seedNovel(t.db, { title: "C" }) // ยังไม่เผยแพร่
    const add = (novelId: number, first: number, count: number, o: SeedChapter): void => {
      for (let i = 0; i < count; i++) seedChapter(t.db, novelId, first + i, o)
    }
    add(a, 1, 3, { status: "done", translation: "x", published: true }) // เผยแพร่แล้ว 3
    add(a, 4, 4, { status: "done", translation: "x" }) // พร้อมเผยแพร่ 4
    add(a, 8, 1, { status: "queued", queueSeq: 1 }) // ในคิว 1
    add(a, 9, 1, { status: "translating" }) // กำลังแปล: ไม่นับเป็น "ในคิว"
    add(b, 1, 3, { status: "error", error: "พัง" }) // ผิดพลาดและยังไม่เผยแพร่ 3
    add(b, 4, 2, { status: "error", error: "พัง", translation: "คำแปลเดิม", published: true }) // แปลใหม่ล้มเหลวแต่ยังเผยแพร่อยู่ 2 → ผิดพลาดรวม 5, เผยแพร่รวม 5
    add(b, 6, 2, { status: "draft" })
    add(c, 1, 1, { status: "done", translation: "x", published: true }) // ธงเผยแพร่ของตอนนับ แม้เรื่องยังไม่เผยแพร่ → เผยแพร่รวม 6
    add(c, 2, 1, { status: "done", translation: "" }) // ไม่มีคำแปล ไม่ถือว่าพร้อมเผยแพร่

    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.deepEqual(sorted(r.json.counts), COUNT_KEYS)
    assert.deepEqual(r.json.counts, { publishedNovels: 2, totalNovels: 3, publishedChapters: 6, queued: 1, errors: 5, readyToPublish: 4 })
  })
})

test("readyToPublish คือจำนวนที่ปุ่ม \"เผยแพร่ทั้งหมด\" (bulk where:ready) จะเผยแพร่จริง · หลังกดแล้วเหลือ 0 และตอนที่เผยแพร่เพิ่มตามนั้น", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B", published: true })
    seedChapter(t.db, a, 1, { status: "done", translation: "x" })
    seedChapter(t.db, b, 1, { status: "done", translation: "x" })
    seedChapter(t.db, b, 2, { status: "done", translation: "x" })
    seedChapter(t.db, b, 3, { status: "done", translation: "x", published: true })
    seedChapter(t.db, b, 4, { status: "error", translation: "x" })
    seedChapter(t.db, b, 5, { status: "queued", queueSeq: 1 })
    const c = await adminClient(t)

    const before = (await c.get(DASHBOARD)).json.counts
    assert.equal(before.readyToPublish, 3)
    const bulk = await c.post(BULK, { action: "publish", where: "ready" })
    assert.equal(bulk.status, 200)
    assert.equal(bulk.json.changed, before.readyToPublish)

    const after = (await c.get(DASHBOARD)).json.counts
    assert.equal(after.readyToPublish, 0)
    assert.equal(after.publishedChapters, before.publishedChapters + before.readyToPublish)
  })
})

test("onboarding: apiKey เป็นจริงเมื่อมี API key หรือ IMPORT_TOKEN อย่างใดอย่างหนึ่ง · contact เมื่อข้อความติดต่อไม่ว่าง · firstNovel เมื่อมีเรื่องแล้ว", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const onboarding = async () => (await c.get(DASHBOARD)).json.onboarding

    // apiKey: key / token / ทั้งคู่ / ไม่มีเลย
    for (const [hasKey, importToken, expected] of [
      [true, null, true],
      [false, TEST_IMPORT_TOKEN, true],
      [true, TEST_IMPORT_TOKEN, true],
      [false, null, false],
    ] as const) {
      t.ai.script.hasKey = hasKey
      t.config.importToken = importToken
      assert.equal((await onboarding()).apiKey, expected, `key=${hasKey} token=${importToken !== null}`)
    }

    // contact: ว่าง / เหลือแต่ช่องว่าง = ยังไม่กรอก
    assert.equal((await onboarding()).contact, false)
    t.settings.update({ contactText: "  \r\n   " })
    assert.equal((await onboarding()).contact, false)
    t.settings.update({ contactText: "แจ้งลบเนื้อหาได้ที่ owner@example.com" })
    assert.equal((await onboarding()).contact, true)

    // firstNovel
    assert.equal((await onboarding()).firstNovel, false)
    seedNovel(t.db)
    assert.equal((await onboarding()).firstNovel, true)
    assert.deepEqual(await onboarding(), { apiKey: false, contact: true, firstNovel: true })
  })
})

test("queue ใน Dashboard คือสถานะคิวสดชุดเดียวกับ queue.state() (หยุดอยู่ เหตุผล ตอนที่รออยู่)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db, { title: "Epic", titleTh: "มหากาพย์" })
    seedChapter(t.db, n, 1, { status: "queued", queueSeq: 1 })
    seedChapter(t.db, n, 2, { status: "queued", queueSeq: 2 })
    t.queue.pause("ขอพักก่อน")
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.deepEqual(r.json.queue, t.queue.state())
    assert.equal(r.json.queue.paused, true)
    assert.equal(r.json.queue.pausedReason, "ขอพักก่อน")
    assert.equal(r.json.queue.waitingTotal, 2)
    assert.equal(r.json.queue.waiting[0].novelTitle, "มหากาพย์")
    assert.equal(r.json.counts.queued, r.json.queue.waitingTotal)
  })
})

// ═════════════════════════ ยอดอ่าน 14 วัน ═════════════════════════

test("views: 14 วันเรียงเก่า→ใหม่ เติมศูนย์ รวมทุกเรื่อง (รวมเรื่องที่ถูกลบไปแล้ว) ไม่นับก่อนหน้าหน้าต่างหรือวันในอนาคต", async () => {
  const clock = createClock("2026-10-22T01:02:03Z") // UTC+7 = 08:02 วันที่ 22
  await withTestApp({ now: clock.now }, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    seedViews(t, [
      ["2026-10-22", a, 5],
      ["2026-10-22", b, 7],
      ["2026-10-21", a, 3],
      ["2026-10-15", 9999, 2], // เรื่องที่ถูกลบไปแล้ว ยอดอ่านยังอยู่ในประวัติ
      ["2026-10-09", a, 4], // วันแรกของหน้าต่าง
      ["2026-10-08", a, 100], // เก่ากว่าหน้าต่าง
      ["2026-10-23", a, 50], // วันในอนาคต
    ])
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.equal(r.json.views.length, 14)
    assert.deepEqual(r.json.views.map((v: { day: string }) => v.day), dayList("2026-10-22"))
    for (const v of r.json.views) assert.deepEqual(sorted(v), ["count", "day"])
    const byDay = Object.fromEntries(r.json.views.map((v: { day: string; count: number }) => [v.day, v.count]))
    assert.deepEqual(
      Object.entries(byDay).filter(([, count]) => count !== 0),
      [["2026-10-09", 4], ["2026-10-15", 2], ["2026-10-21", 3], ["2026-10-22", 12]],
    )
  })
})

test("views: \"วันนี้\" นับตามเวลา UTC+7 (เลยเที่ยงคืนไทยแล้วเป็นวันถัดไป) และข้ามเดือนได้", async () => {
  // 17:30 UTC = 00:30 ของวันที่ 23 ในไทย
  const late = createClock("2026-10-22T17:30:00Z")
  await withTestApp({ now: late.now }, async (t) => {
    const n = seedNovel(t.db)
    seedViews(t, [["2026-10-22", n, 1], ["2026-10-23", n, 9], ["2026-10-09", n, 40], ["2026-10-10", n, 2]])
    const views = (await (await adminClient(t)).get(DASHBOARD)).json.views
    assert.deepEqual(views.map((v: { day: string }) => v.day), dayList("2026-10-23"))
    assert.equal(views.at(-1).count, 9)
    assert.equal(views.at(-2).count, 1)
    assert.equal(views[0].day, "2026-10-10")
    assert.equal(views[0].count, 2, "2026-10-09 อยู่นอกหน้าต่างแล้ว")
  })

  const marchFirst = createClock("2026-03-02T05:00:00Z") // ข้ามเดือนกุมภาพันธ์ (28 วัน)
  await withTestApp({ now: marchFirst.now }, async (t) => {
    const n = seedNovel(t.db)
    seedViews(t, [["2026-02-17", n, 6], ["2026-02-16", n, 60], ["2026-03-01", n, 8]])
    const views = (await (await adminClient(t)).get(DASHBOARD)).json.views
    assert.deepEqual(views.map((v: { day: string }) => v.day), [...dayList("2026-02-28", 12), "2026-03-01", "2026-03-02"])
    assert.equal(views[0].day, "2026-02-17")
    assert.deepEqual(views.filter((v: { count: number }) => v.count !== 0).map((v: { day: string }) => v.day), ["2026-02-17", "2026-03-01"])
  })
})

// ═════════════════════════ ความคืบหน้ารายเรื่อง ═════════════════════════

test("progress: รายเรื่องเรียงตามรหัส ใช้ชื่อไทยก่อนชื่อเดิม นับแปลแล้ว/ทั้งหมด/เผยแพร่ถูก · เรื่องที่ยังไม่มีตอนเป็นศูนย์", async () => {
  await withTestApp({}, async (t) => {
    const one = seedNovel(t.db, { title: "English One", titleTh: "ไทยหนึ่ง" })
    const two = seedNovel(t.db, { title: "Plain Two" })
    const three = seedNovel(t.db, { title: "Empty Three", titleTh: "ว่างสาม" })
    seedChapter(t.db, one, 1, { status: "done", translation: "แปลแล้ว", published: true })
    seedChapter(t.db, one, 2, { status: "done", translation: "แปลแล้ว" })
    seedChapter(t.db, one, 3, { status: "queued", queueSeq: 1 })
    seedChapter(t.db, one, 4, { status: "error", error: "พัง", translation: "คำแปลเดิม", published: true })
    seedChapter(t.db, two, 1, { status: "draft" })
    seedChapter(t.db, two, 2, { status: "done", translation: "x" })
    // อีกเรื่องหนึ่งไม่ปะปนกัน
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.deepEqual(r.json.progress, [
      { novelId: one, title: "ไทยหนึ่ง", translated: 3, total: 4, published: 2 },
      { novelId: two, title: "Plain Two", translated: 1, total: 2, published: 0 },
      { novelId: three, title: "ว่างสาม", translated: 0, total: 0, published: 0 },
    ])
    for (const p of r.json.progress) assert.deepEqual(sorted(p), ["novelId", "published", "title", "total", "translated"])
  })
})

// ═════════════════════════ การใช้โทเคนและค่าประมาณ ═════════════════════════

test("usage: วันนี้ vs 30 วัน (รวมวันนี้ย้อนไป 29 วัน) รวมต่อโมเดลเรียงตามชื่อ · ไม่นับ 30 วันก่อนหรือวันในอนาคต", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    recordUsage(t.db, "2026-10-22", SONNET, usage(1000, 500))
    recordUsage(t.db, "2026-10-22", SONNET, usage(1000, 500))
    recordUsage(t.db, "2026-10-22", HAIKU, usage(100, 50))
    recordUsage(t.db, "2026-10-21", SONNET, usage(10, 5))
    recordUsage(t.db, "2026-09-23", SONNET, usage(1, 1)) // 29 วันก่อน: ยังอยู่ในหน้าต่าง
    recordUsage(t.db, "2026-09-22", SONNET, usage(1_000_000, 1_000_000)) // 30 วันก่อน: ออกแล้ว
    recordUsage(t.db, "2026-10-23", SONNET, usage(7_000_000, 7_000_000)) // อนาคต

    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.deepEqual(r.json.usage.today, [
      { model: HAIKU, tokensIn: 100, tokensOut: 50, calls: 1 },
      { model: SONNET, tokensIn: 2000, tokensOut: 1000, calls: 2 },
    ])
    assert.deepEqual(r.json.usage.last30, [
      { model: HAIKU, tokensIn: 100, tokensOut: 50, calls: 1 },
      { model: SONNET, tokensIn: 2011, tokensOut: 1006, calls: 4 },
    ])
    for (const row of [...r.json.usage.today, ...r.json.usage.last30]) assert.deepEqual(sorted(row), ["calls", "model", "tokensIn", "tokensOut"])
  })
})

test("usage: \"วันนี้\" ใช้เวลา UTC+7 เหมือนที่คิวบันทึกยอด", async () => {
  const clock = createClock("2026-10-22T17:30:00Z") // ไทย 00:30 วันที่ 23
  await withTestApp({ now: clock.now }, async (t) => {
    recordUsage(t.db, "2026-10-22", SONNET, usage(5, 5))
    recordUsage(t.db, "2026-10-23", SONNET, usage(7, 7))
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.deepEqual(r.json.usage.today.map((u: { tokensIn: number }) => u.tokensIn), [7])
    assert.deepEqual(r.json.usage.last30.map((u: { tokensIn: number }) => u.tokensIn), [12])
  })
})

test("estimate: ไม่ได้กรอกราคา = null · กรอกแล้วคิดต่อโมเดล (1,000,000 เข้า × 3 + 1,000,000 ออก × 15) / 1e6 = 18 · คิดเฉพาะโมเดลที่มีราคา", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    recordUsage(t.db, "2026-10-22", SONNET, usage(1_000_000, 1_000_000))
    recordUsage(t.db, "2026-10-22", HAIKU, usage(500, 500)) // โมเดลนี้ไม่มีราคา ไม่ถูกนับ
    recordUsage(t.db, "2026-09-23", SONNET, usage(1_000_000, 0)) // อยู่ใน 30 วันแต่ไม่ใช่วันนี้

    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: null, last30: null })

    t.settings.update({ prices: { [SONNET]: { in: 3, out: 15 } } })
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: 18, last30: 21 })

    t.settings.update({ prices: { [SONNET]: { in: 3, out: 15 }, [HAIKU]: { in: 1, out: 5 } } })
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: 18.003, last30: 21.003 })
  })
})

test("estimate: ตั้งราคาแล้วแต่ยังไม่มีการใช้ = 0 · ใช้แต่โมเดลที่ไม่มีราคา = ประเมินไม่ได้ (null ไม่ใช่ 0) · ราคา 0 บาท/ฟรี นับเป็นมีราคา", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    t.settings.update({ prices: { [SONNET]: { in: 3, out: 15 } } })
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: 0, last30: 0 })

    recordUsage(t.db, "2026-10-22", HAIKU, usage(1000, 1000))
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: null, last30: null }, "ใช้แต่โมเดลที่ไม่มีราคา")

    recordUsage(t.db, "2026-10-22", SONNET, usage(123, 456))
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: 0.007209, last30: 0.007209 }, "(123 × 3 + 456 × 15) / 1e6")

    t.settings.update({ prices: { [SONNET]: { in: 3, out: 15 }, [HAIKU]: { in: 0, out: 0 } } })
    assert.deepEqual((await c.get(DASHBOARD)).json.estimate, { today: 0.007209, last30: 0.007209 }, "โมเดลราคา 0 ไม่เพิ่มยอดแต่ไม่ทำให้ประเมินไม่ได้")
  })
})

test("estimate: ปัดเป็น 6 ตำแหน่ง (ไมโครดอลลาร์) ไม่มีเศษทศนิยมลอยจากการบวกเลขทศนิยม", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    // 0.1 + 0.2 ใน JavaScript ได้ 0.30000000000000004 ถ้าไม่ปัด
    recordUsage(t.db, "2026-10-22", SONNET, usage(100_000, 0)) // 100,000 × 1 / 1e6 = 0.1
    recordUsage(t.db, "2026-10-22", HAIKU, usage(200_000, 0)) // 200,000 × 1 / 1e6 = 0.2
    t.settings.update({ prices: { [SONNET]: { in: 1, out: 1 }, [HAIKU]: { in: 1, out: 1 } } })
    const r = await (await adminClient(t)).get(DASHBOARD)
    assert.equal(r.json.estimate.today, 0.3)
    assert.equal(r.json.estimate.last30, 0.3)

    // ต่ำกว่าหนึ่งไมโครดอลลาร์ปัดลงเป็น 0 / ปัดขึ้นเมื่อเกินครึ่ง
    t.db.run("DELETE FROM usage")
    recordUsage(t.db, "2026-10-22", SONNET, usage(1, 0)) // 1 × 0.4 / 1e6 = 0.0000004 → 0
    t.settings.update({ prices: { [SONNET]: { in: 0.4, out: 1 } } })
    assert.equal((await (await adminClient(t)).get(DASHBOARD)).json.estimate.today, 0)
    t.settings.update({ prices: { [SONNET]: { in: 0.6, out: 1 } } }) // 0.0000006 → 0.000001
    assert.equal((await (await adminClient(t)).get(DASHBOARD)).json.estimate.today, 0.000001)
  })
})

// ═════════════════════════ สถานะ API ═════════════════════════

test("api: hasKey ตาม ai.hasKey() · lastOk เป็น null จนกว่าจะทดสอบ · ค่าที่เก็บเสียรูป (แก้นอกระบบ) ถือว่าไม่มี ไม่ทำให้หน้าพัง", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.ai.script.hasKey = true
    assert.deepEqual((await c.get(DASHBOARD)).json.api, { hasKey: true, lastOk: null })
    t.ai.script.hasKey = false
    assert.deepEqual((await c.get(DASHBOARD)).json.api, { hasKey: false, lastOk: null })

    const good = { at: "2026-10-22 01:02:03", ok: true, message: "เชื่อมต่อได้" }
    t.settings.setInternal(API_CHECK_KEY, JSON.stringify(good))
    assert.deepEqual((await c.get(DASHBOARD)).json.api.lastOk, good)

    for (const broken of ["{not json", "null", "[]", "5", JSON.stringify({ at: 1, ok: true, message: "x" }), JSON.stringify({ at: "t", ok: "yes", message: "x" }), JSON.stringify({ at: "t", ok: true })]) {
      t.settings.setInternal(API_CHECK_KEY, broken)
      const r = await c.get(DASHBOARD)
      assert.equal(r.status, 200, broken)
      assert.equal(r.json.api.lastOk, null, broken)
    }
  })
})

test("การเปิด Dashboard ไม่ทำให้ตอนที่กำลังแปลหรือคิวเปลี่ยน (อ่านอย่างเดียว) แม้คิวหยุดอยู่", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const ch = seedChapter(t.db, n, 1, { status: "queued", queueSeq: 1 })
    t.queue.pause("หยุดไว้")
    const c = await adminClient(t)
    for (let i = 0; i < 3; i++) assert.equal((await c.get(DASHBOARD)).status, 200)
    assert.equal(getChapter(t.db, ch).status, "queued")
    assert.equal(t.queue.state().pausedReason, "หยุดไว้")
    assert.deepEqual(t.ai.calls, [])
  })
})
