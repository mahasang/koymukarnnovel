import { test } from "node:test"
import assert from "node:assert/strict"
import type { TickResult } from "../src/queue.js"
import type { ChapterRow } from "../src/types.js"
import { createClock } from "./helpers/clock.js"
import { withTestApp, type Client, type TestApp } from "./helpers/app.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { getChapter, seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"
import { startStuckTranslation } from "./helpers/stuck.js"

const THAI = /[฀-๿]/
const API = "/api/admin"
const listPath = (novelId: number | string) => `${API}/novels/${novelId}/chapters`
const chapterPath = (id: number | string) => `${API}/chapters/${id}`
const BULK = `${API}/chapters/bulk`
type T = TestApp<FakeAi>
type Method = "get" | "post" | "put" | "patch" | "delete"

/** เวลาเริ่มต้นของ `createClock` ในรูปแบบที่เก็บใน DB */
const NOW = "2026-10-22 01:02:03"

/** คีย์ทั้งหมดของแถวในตารางตอน (spec 7.10) เรียงตามตัวอักษร — ไม่มีต้นฉบับ/คำแปล/คอลัมน์ snake_case หลุดออกไป */
const LIST_KEYS = ["error", "hasTranslation", "id", "number", "published", "publishedAt", "queueSeq", "srcLength", "status", "title", "titleTh", "translatedAt"]

/** คีย์ทั้งหมดของตอนเต็ม (หน้าแก้ตอน) เรียงตามตัวอักษร */
const FULL_KEYS = [
  "autoPublish", "createdAt", "error", "id", "novelId", "number", "published", "publishedAt", "queueSeq", "recap", "sourceText", "status",
  "title", "titleTh", "translatedAt", "translation", "updatedAt",
]

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

const send = (c: Client, method: Method, path: string, body?: unknown) => (method === "get" ? c.get(path) : c[method](path, body))
const rowsOf = (t: T, table: string): string => JSON.stringify(t.db.all(`SELECT * FROM ${table}`))
const snapshot = (t: T): string[] => ["novels", "chapters", "glossary", "usage"].map((table) => rowsOf(t, table))
const count = (t: T, table: string, where = "1"): number => t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)!.n
const chaptersOf = (t: T, novelId: number): ChapterRow[] => t.db.all<ChapterRow>("SELECT * FROM chapters WHERE novel_id = ? ORDER BY number", novelId)
const longText = (n: number): string => "a".repeat(n)

/** ไม่มีอะไรในระบบเปลี่ยน: ข้อมูลเดิมครบ ไม่ยกเลิกคิว ไม่เรียก AI */
function assertNoSideEffects(t: T, before: string[]): void {
  assert.deepEqual(snapshot(t), before)
  assert.deepEqual(t.cancelCalls, [])
  assert.deepEqual(t.ai.calls, [])
}

const item = (number: number, extra: Record<string, unknown> = {}) => ({ number, title: `Chapter ${number}`, text: `Text of chapter ${number}.`, ...extra })

function create(c: Client, novelId: number, chapters: unknown, o: { translate?: boolean; publish?: boolean } = {}) {
  const body: Record<string, unknown> = { chapters }
  if (o.translate !== undefined) body.translate = o.translate
  if (o.publish !== undefined) body.publish = o.publish
  return c.post(listPath(novelId), body)
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: หมดเวลา")
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** หลังลบตอน `doomed` กลางสตรีมแล้ว: tick เดิมจบเร็ว ไม่มีแถวฟื้น ไม่เขียน usage/สรุปตอน และตอน `next` ถูกทำต่อจนเสร็จ */
async function assertCancelledAndQueueContinues(t: T, tick: Promise<TickResult>, startedAt: number, doomed: number, next: number): Promise<void> {
  assert.equal(await tick, "done")
  assert.ok(Date.now() - startedAt < 3500, "สตรีมถูกยกเลิกจริง ไม่ได้รอจนหน่วงครบ 5 วินาที")
  assert.equal(t.db.get("SELECT id FROM chapters WHERE id = ?", doomed), undefined, "ไม่มีแถวฟื้นกลับมา")
  assert.equal(count(t, "usage"), 0)
  assert.equal(t.ai.calls.filter((c) => c.method === "chapterNotes").length, 0)
  assert.equal(t.queue.state().current, null)
  assert.equal(t.queue.state().paused, false)
  t.ai.script.translate = () => "คำแปลตอนถัดไป"
  assert.equal(await t.queue.tick(), "done")
  assert.equal(getChapter(t.db, next).status, "done")
  assert.equal(getChapter(t.db, next).translation, "คำแปลตอนถัดไป")
}

// ═════════════════════════ ต้องล็อกอิน / รูปแบบคำตอบ ═════════════════════════

test("ทุกเส้นทางของตอนต้องล็อกอิน: ไม่มี cookie → 401 และไม่มีผลข้างเคียง (ไม่สร้าง แก้ ลบ เข้าคิว ยกเลิกคิว หรือเรียก AI)", async () => {
  await withTestApp({}, async (t) => {
    const novel = seedNovel(t.db, { published: true })
    const ch = seedChapter(t.db, novel, 1, { status: "done", translation: "x", published: true })
    seedGlossary(t.db, novel, [{ source: "A", thai: "เอ" }])
    const before = snapshot(t)
    const stranger = t.client() // ไม่ล็อกอิน

    const routes: [Method, string, unknown?][] = [
      ["get", listPath(novel)],
      ["post", listPath(novel), { chapters: [item(2)], translate: true }],
      ["get", chapterPath(ch)],
      ["patch", chapterPath(ch), { title: "Hacked", translation: "pwned" }],
      ["delete", chapterPath(ch)],
      ["post", BULK, { ids: [ch], action: "delete" }],
      ["post", BULK, { ids: [ch], action: "translate" }],
      ["post", BULK, { where: "ready", action: "publish" }],
    ]
    for (const [method, path, body] of routes) {
      const r = await send(stranger, method, path, body)
      assert.equal(r.status, 401, `${method.toUpperCase()} ${path}`)
      assert.equal(r.json.code, "unauthorized")
    }
    assertNoSideEffects(t, before)
    assert.equal(t.queue.state().waiting.length, 0)
  })
})

test("คำตอบของเส้นทางตอนเป็น JSON และห้าม cache (Cache-Control: no-store) ทั้งตอนสำเร็จและตอนผิดพลาด", async () => {
  await withTestApp({}, async (t) => {
    const novel = seedNovel(t.db)
    const ch = seedChapter(t.db, novel, 1)
    const c = await adminClient(t)
    const responses = [
      await c.get(listPath(novel)),
      await c.get(chapterPath(ch)),
      await c.get(chapterPath(999)),
      await c.post(BULK, { action: "hide", ids: [ch] }),
      await create(c, novel, []),
    ]
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 404, 200, 400])
    for (const r of responses) {
      assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
      assert.equal(r.headers.get("cache-control"), "no-store")
    }
  })
})

// ═════════════════════════ รายการตอนของเรื่อง ═════════════════════════

test("GET /novels/:id/chapters: แถวเบาคีย์ครบตาม spec เรียงตามเลขตอน (เลข 0 ก่อน) ไม่ส่งต้นฉบับหรือคำแปลมาในรายการ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c3 = seedChapter(t.db, n, 3, { title: "Third", source: "สวัสดี", status: "queued", queueSeq: 7 })
    const c0 = seedChapter(t.db, n, 0, {
      title: "Prologue",
      titleTh: "บทนำ",
      source: "x".repeat(1234),
      translation: "คำแปลลับที่ไม่ควรโผล่ในรายการ",
      status: "done",
      published: true,
      publishedAt: "2026-02-03 04:05:06",
      translatedAt: "2026-02-02 01:00:00",
    })
    const c1 = seedChapter(t.db, n, 1, { title: "One", status: "error", error: "พังจ้า" })
    const r = await (await adminClient(t)).get(listPath(n))

    assert.equal(r.status, 200)
    assert.deepEqual(r.json.map((x: { number: number }) => x.number), [0, 1, 3])
    for (const x of r.json) assert.deepEqual(Object.keys(x).sort(), LIST_KEYS)
    assert.deepEqual(r.json[0], {
      id: c0,
      number: 0,
      title: "Prologue",
      titleTh: "บทนำ",
      status: "done",
      error: "",
      published: true,
      publishedAt: "2026-02-03 04:05:06",
      translatedAt: "2026-02-02 01:00:00",
      queueSeq: null,
      hasTranslation: true,
      srcLength: 1234,
    })
    assert.deepEqual(r.json[1], {
      id: c1,
      number: 1,
      title: "One",
      titleTh: "",
      status: "error",
      error: "พังจ้า",
      published: false,
      publishedAt: null,
      translatedAt: null,
      queueSeq: null,
      hasTranslation: false,
      srcLength: "Source text of chapter 1.".length,
    })
    assert.deepEqual(r.json[2], {
      id: c3,
      number: 3,
      title: "Third",
      titleTh: "",
      status: "queued",
      error: "",
      published: false,
      publishedAt: null,
      translatedAt: null,
      queueSeq: 7,
      hasTranslation: false,
      srcLength: 6,
    })
    assert.ok(!r.text.includes("คำแปลลับ"), "ไม่ส่งคำแปลมาในรายการ")
    assert.ok(!r.text.includes("xxxxxxxxxx"), "ไม่ส่งต้นฉบับมาในรายการ")
  })
})

test("GET /novels/:id/chapters: เฉพาะตอนของเรื่องนั้น · เรื่องที่ไม่มีตอนได้ [] · ไม่พบเรื่องหรือรหัสผิดรูปแบบ → 404 ไทย", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    const empty = seedNovel(t.db, { title: "Empty" })
    const ca = seedChapter(t.db, a, 1)
    const cb = seedChapter(t.db, b, 1)
    const c = await adminClient(t)

    assert.deepEqual((await c.get(listPath(a))).json.map((x: { id: number }) => x.id), [ca])
    assert.deepEqual((await c.get(listPath(b))).json.map((x: { id: number }) => x.id), [cb])
    const none = await c.get(listPath(empty))
    assert.equal(none.status, 200)
    assert.deepEqual(none.json, [])

    for (const bad of ["999", "0", "-1", "abc", "1.5", "01", "1e2"]) {
      const r = await c.get(listPath(bad))
      assert.equal(r.status, 404, bad)
      assert.equal(r.json.code, "not_found")
      assert.equal(r.json.error, "ไม่พบนิยายเรื่องนี้")
    }
  })
})

// ═════════════════════════ สร้างตอนเป็นชุด ═════════════════════════

test("POST /novels/:id/chapters (translate:false) → 201 {created, queued:0}: เป็นร่าง ค่าเริ่มต้นครบ เวลาเป็นของนาฬิกาแอป และ created ตรงตามลำดับที่ส่งมา", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const r = await create(c, n, [item(5), item(0), { number: 2, text: "No title here." }], { translate: false })

    assert.equal(r.status, 201, r.text)
    assert.deepEqual(Object.keys(r.json).sort(), ["created", "queued"])
    assert.equal(r.json.queued, 0)
    const created: number[] = r.json.created
    assert.equal(created.length, 3)
    assert.equal(new Set(created).size, 3)
    // created[i] คือตอนของ chapters[i] (จับคู่กลับได้ แม้ส่งมาไม่เรียงเลข)
    assert.deepEqual(created.map((id) => getChapter(t.db, id).number), [5, 0, 2])

    assert.deepEqual(
      chaptersOf(t, n).map(({ number, title, source_text }) => ({ number, title, source_text })),
      [
        { number: 0, title: "Chapter 0", source_text: "Text of chapter 0." },
        { number: 2, title: "", source_text: "No title here." },
        { number: 5, title: "Chapter 5", source_text: "Text of chapter 5." },
      ],
    )
    for (const row of chaptersOf(t, n)) {
      assert.equal(row.novel_id, n)
      assert.equal(row.status, "draft")
      assert.equal(row.translation, "")
      assert.equal(row.title_th, "")
      assert.equal(row.recap, null)
      assert.equal(row.error, "")
      assert.equal(row.published, 0)
      assert.equal(row.published_at, null)
      assert.equal(row.auto_publish, 0)
      assert.equal(row.queue_seq, null)
      assert.equal(row.translated_at, null)
      assert.equal(row.created_at, NOW)
      assert.equal(row.updated_at, NOW)
    }
    assert.equal(t.queue.state().waiting.length, 0)
    assert.deepEqual(t.ai.calls, [])
  })
})

test("ไม่ส่ง translate/publish ถือเป็น false (บันทึกเป็นร่าง ไม่เข้าคิว) · ฟิลด์เกินในรายการ (status, published, translation) ไม่มีผล", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const r = await c.post(listPath(n), {
      chapters: [item(1, { status: "done", published: true, translation: "แปลแอบมา", queueSeq: 1, autoPublish: true, novelId: 999 })],
    })
    assert.equal(r.status, 201, r.text)
    assert.equal(r.json.queued, 0)
    const [row] = chaptersOf(t, n)
    assert.equal(row!.status, "draft")
    assert.equal(row!.published, 0)
    assert.equal(row!.translation, "")
    assert.equal(row!.queue_seq, null)
    assert.equal(row!.auto_publish, 0)
    assert.equal(row!.novel_id, n)
  })
})

test("(Review Focus 1) ข้อความจากเว็บที่มี BOM, ZWSP, CRLF, NBSP: ชื่อตอนและต้นฉบับถูกล้างด้วย normalizeText ก่อนเก็บ ไม่มีอักขระล่องหนค้าง", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const raw = "﻿Hello​ world\r\nSecond line  \r\n\r\n\r\n\r\nThird line !\r\n"
    const r = await create(c, n, [{ number: 12, title: "﻿Chapter 12\r\n", text: raw }])
    assert.equal(r.status, 201, r.text)
    const [row] = chaptersOf(t, n)
    assert.equal(row!.title, "Chapter 12")
    assert.equal(row!.source_text, "Hello world\nSecond line\n\nThird line !")
    assert.ok(!/[﻿​\r   ]/.test(row!.source_text + row!.title), "ไม่มีอักขระล่องหนหรือ CR ค้างในข้อมูล")
  })
})

test("translate:true → ทุกตอนเป็น queued เรียงลำดับคิวตามเลขตอนแม้ส่งมากลับด้าน · queued นับตามจริง · เผยแพร่เองปิดไว้ตามค่าเริ่มต้น", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const r = await create(c, n, [item(3), item(1), item(2)], { translate: true })

    assert.equal(r.status, 201, r.text)
    const created: number[] = r.json.created
    assert.deepEqual(created.map((id) => getChapter(t.db, id).number), [3, 1, 2])
    assert.equal(r.json.queued, 3)
    const rows = chaptersOf(t, n)
    assert.deepEqual(rows.map((x) => [x.number, x.status, x.queue_seq]), [
      [1, "queued", 1],
      [2, "queued", 2],
      [3, "queued", 3],
    ])
    assert.deepEqual(rows.map((x) => x.auto_publish), [0, 0, 0])
    assert.deepEqual(rows.map((x) => x.published), [0, 0, 0])
    assert.deepEqual(t.queue.state().waiting.map((w) => w.number), [1, 2, 3], "คิวเห็นลำดับเดียวกัน")
    assert.equal(t.queue.state().waitingTotal, 3)
  })
})

test("publish:true ตั้ง auto_publish เฉพาะเมื่อ translate:true · translate:false + publish:true → เป็นร่าง auto_publish ยัง 0", async () => {
  await withTestApp({}, async (t) => {
    const n1 = seedNovel(t.db, { title: "ตั้ง" })
    const n2 = seedNovel(t.db, { title: "ไม่ตั้ง" })
    const c = await adminClient(t)
    assert.equal((await create(c, n1, [item(1), item(2)], { translate: true, publish: true })).status, 201)
    assert.equal((await create(c, n2, [item(1), item(2)], { translate: false, publish: true })).status, 201)

    assert.deepEqual(chaptersOf(t, n1).map((x) => [x.status, x.auto_publish]), [["queued", 1], ["queued", 1]])
    assert.deepEqual(chaptersOf(t, n2).map((x) => [x.status, x.auto_publish]), [["draft", 0], ["draft", 0]])
  })
})

test("translate:true เข้าคิวจริงผ่าน queue.enqueue (ปลุกลูปทันที): ตอนถูกแปลตามเลขตอน เผยแพร่เองเมื่อ publish:true", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    t.queue.start()
    const c = await adminClient(t)
    const r = await create(c, n, [item(2), item(1)], { translate: true, publish: true })
    assert.equal(r.status, 201, r.text)

    await until(() => count(t, "chapters", "status = 'done'") === 2) // ไม่ปลุก = รอถึง 5 วินาทีจน until หมดเวลา
    assert.deepEqual(chaptersOf(t, n).map((x) => [x.number, x.status, x.published]), [[1, "done", 1], [2, "done", 1]])
    const sent = t.ai.calls.flatMap((call) => (call.method === "translateChunk" ? [call.user] : []))
    assert.equal(sent.length, 2)
    assert.match(sent[0]!, /Text of chapter 1\./, "ตอนเลขน้อยถูกแปลก่อน")
    assert.match(sent[1]!, /Text of chapter 2\./)
  })
})

test("เข้าคิวผิดพลาดกลางทาง → ย้อนทั้งหมด: ไม่มีตอนค้างในฐานข้อมูล (สร้างตอนกับเข้าคิวเป็นก้อนเดียว) และตอบ 500 ไทย", async () => {
  await withTestApp({ expectErrorLogs: true }, async (t) => {
    const n = seedNovel(t.db)
    t.queue.enqueue = () => {
      throw new Error("เข้าคิวพัง")
    }
    const c = await adminClient(t)
    const r = await create(c, n, [item(1), item(2)], { translate: true })
    assert.equal(r.status, 500)
    assert.match(r.json.error, THAI)
    assert.equal(count(t, "chapters"), 0)
  })
})

test("เลขตอนซ้ำกันเองในคำขอ → 409 duplicate_numbers พร้อมรายการเลขที่ซ้ำ และไม่สร้างอะไรเลย (แม้ตอนอื่นที่ไม่ซ้ำ) ไม่เข้าคิว", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const before = snapshot(t)
    const c = await adminClient(t)
    const r = await create(c, n, [item(1), item(2), item(2), item(3), item(1), item(1)], { translate: true })

    assert.equal(r.status, 409)
    assert.equal(r.json.code, "duplicate_numbers")
    assert.deepEqual(r.json.conflicts, [1, 2])
    assert.match(r.json.error, THAI)
    assertNoSideEffects(t, before)
    assert.equal(count(t, "chapters"), 0)
    assert.equal(t.queue.state().waiting.length, 0)
  })
})

test("เลขตอนซ้ำกับตอนที่มีอยู่ → 409 พร้อมเฉพาะเลขที่ซ้ำ (เรียงน้อย→มาก ไม่ซ้ำกัน) ตอนเดิมไม่ถูกแตะ และไม่สร้างตอนที่ไม่ซ้ำ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    seedChapter(t.db, n, 2, { source: "ของเดิม 2" })
    seedChapter(t.db, n, 5, { source: "ของเดิม 5" })
    seedChapter(t.db, n, 10, { source: "ของเดิม 10" })
    seedChapter(t.db, other, 7) // เลขเดียวกันในเรื่องอื่นไม่นับ
    const before = snapshot(t)
    const c = await adminClient(t)

    // เรียงเป็นตัวเลข (2, 5, 10) ไม่ใช่ตามตัวอักษร (10, 2, 5)
    const r = await create(c, n, [item(10), item(7), item(5), item(1), item(2), item(3), item(5)])
    assert.equal(r.status, 409)
    assert.equal(r.json.code, "duplicate_numbers")
    assert.deepEqual(r.json.conflicts, [2, 5, 10])
    assertNoSideEffects(t, before)
    assert.equal(count(t, "chapters", `novel_id = ${n}`), 3)
  })
})

test("เลขตอนซ้ำเยอะ: ข้อความไทยโชว์แค่ 10 เลขแรกแล้วบอกว่าเหลืออีกเท่าไร แต่ conflicts ใน JSON ครบทุกเลข", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    for (let i = 1; i <= 12; i++) seedChapter(t.db, n, i)
    const c = await adminClient(t)

    const all = await create(c, n, Array.from({ length: 12 }, (_, i) => item(12 - i)))
    assert.equal(all.status, 409)
    assert.deepEqual(all.json.conflicts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    assert.match(all.json.error, /1, 2, 3, 4, 5, 6, 7, 8, 9, 10 และอีก 2 เลข/)
    assert.doesNotMatch(all.json.error, /11/)

    const exactlyTen = await create(c, n, Array.from({ length: 10 }, (_, i) => item(i + 1)))
    assert.equal(exactlyTen.status, 409)
    assert.match(exactlyTen.json.error, /1, 2, 3, 4, 5, 6, 7, 8, 9, 10 —/)
    assert.doesNotMatch(exactlyTen.json.error, /และอีก/)
    assert.equal(count(t, "chapters"), 12)
  })
})

test("เลขตอนเดียวกันในอีกเรื่องหนึ่งสร้างได้ · เลขซ้ำชนิดผสม (ซ้ำเอง + ซ้ำของเดิม) รายงานรวมกัน", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    seedChapter(t.db, a, 4)
    const c = await adminClient(t)

    assert.equal((await create(c, b, [item(4), item(1)])).status, 201)
    const r = await create(c, a, [item(4), item(6), item(6), item(7)])
    assert.equal(r.status, 409)
    assert.deepEqual(r.json.conflicts, [4, 6])
    assert.equal(count(t, "chapters", `novel_id = ${a}`), 1)
  })
})

const BAD_CREATE: [string, unknown, RegExp][] = [
  ["ไม่มี chapters", {}, /chapters/],
  ["chapters เป็นข้อความ", { chapters: "x" }, /chapters/],
  ["chapters เป็น null", { chapters: null }, /chapters/],
  ["chapters เป็นออบเจ็กต์", { chapters: {} }, /chapters/],
  ["chapters ว่าง", { chapters: [] }, /chapters/],
  ["รายการที่ 2 เป็น null", { chapters: [item(1), null] }, /รายการที่ 2 ต้องเป็นออบเจ็กต์/],
  ["รายการเป็นข้อความ", { chapters: ["x"] }, /รายการที่ 1 ต้องเป็นออบเจ็กต์/],
  ["รายการเป็นอาร์เรย์", { chapters: [[1]] }, /รายการที่ 1 ต้องเป็นออบเจ็กต์/],
  ["ไม่ได้ส่ง number", { chapters: [{ title: "T", text: "x" }] }, /number/],
  ["number เป็น null", { chapters: [item(1, { number: null })] }, /number/],
  ["number เป็นข้อความ", { chapters: [item(1, { number: "1" })] }, /number/],
  ["number เป็นทศนิยม", { chapters: [item(1, { number: 1.5 })] }, /number/],
  ["number ติดลบ (-1) ที่รายการที่ 2", { chapters: [item(1), item(2, { number: -1 })] }, /รายการที่ 2.*number/],
  ["number ใหญ่เกินจำนวนเต็มที่แทนได้เป๊ะ", { chapters: [item(1, { number: 1e16 })] }, /number/],
  ["title ไม่ใช่ข้อความ", { chapters: [item(1, { title: 5 })] }, /title/],
  ["title เป็น null", { chapters: [item(1, { title: null })] }, /title/],
  ["title ยาว 301 ตัวอักษร", { chapters: [item(1, { title: longText(301) })] }, /title.*300/],
  ["ไม่ได้ส่ง text", { chapters: [{ number: 1, title: "T" }] }, /text/],
  ["text เป็น null", { chapters: [item(1, { text: null })] }, /text/],
  ["text เป็นตัวเลข", { chapters: [item(1, { text: 7 })] }, /text/],
  ["text ว่าง", { chapters: [item(1, { text: "" })] }, /text/],
  ["text เหลือว่างหลังล้างช่องว่างและอักขระล่องหน", { chapters: [item(1, { text: " \r\n ﻿​\t " })] }, /text/],
  ["(Review Focus 3) text ยาว 200,001 ตัวอักษรที่รายการที่ 2", { chapters: [item(1), item(2, { text: longText(200_001) })] }, /รายการที่ 2.*text.*200000/],
  ["translate เป็นข้อความ", { chapters: [item(1)], translate: "yes" }, /translate/],
  ["translate เป็น null", { chapters: [item(1)], translate: null }, /translate/],
  ["publish เป็นตัวเลข", { chapters: [item(1)], publish: 1 }, /publish/],
  ["publish เป็น null", { chapters: [item(1)], publish: null }, /publish/],
]

test("สร้างตอนด้วยข้อมูลผิด → 400 invalid_field ข้อความไทยบอกชื่อฟิลด์ (และลำดับรายการ) ไม่สร้างอะไรเลย ไม่เรียก AI", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const [label, body, field] of BAD_CREATE) {
      const r = await c.post(listPath(n), body)
      assert.equal(r.status, 400, `${label}: ${r.text}`)
      assert.equal(r.json.code, "invalid_field", label)
      assert.match(r.json.error, THAI, label)
      assert.match(r.json.error, field, label)
      assertNoSideEffects(t, before)
    }
  })
})

test("body ที่ไม่ใช่ออบเจ็กต์ JSON (ไม่ส่ง, อาร์เรย์) → 400 bad_request ไม่สร้างอะไร", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    for (const body of [undefined, [], [item(1)]]) {
      const r = await c.post(listPath(n), body)
      assert.equal(r.status, 400)
      assert.equal(r.json.code, "bad_request")
      assert.match(r.json.error, THAI)
    }
    assert.equal(count(t, "chapters"), 0)
  })
})

test("ขอบเขตที่ผ่านได้: 100 ตอนต่อครั้ง · ตอนยาว 200,000 ตัวอักษร · number 0 · title ยาว 300 · 101 ตอนไม่ผ่าน (400 ไทย ไม่สร้างอะไร)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const hundred = Array.from({ length: 100 }, (_, i) => ({ number: i, title: "t", text: `body ${i}` }))

    const tooMany = await create(c, n, [...hundred, item(100)])
    assert.equal(tooMany.status, 400)
    assert.equal(tooMany.json.code, "invalid_field")
    assert.match(tooMany.json.error, THAI)
    assert.match(tooMany.json.error, /100/)
    assert.equal(count(t, "chapters"), 0)

    const ok = await create(c, n, hundred)
    assert.equal(ok.status, 201, ok.text)
    assert.equal(ok.json.created.length, 100)
    assert.equal(count(t, "chapters"), 100)

    const m = seedNovel(t.db, { title: "Long" })
    const long = await create(c, m, [{ number: 0, title: longText(300), text: longText(200_000) }])
    assert.equal(long.status, 201, long.text)
    const [row] = chaptersOf(t, m)
    assert.equal(row!.number, 0)
    assert.equal(row!.title.length, 300)
    assert.equal(row!.source_text.length, 200_000)
  })
})

test("translate:true โดยไม่มี API key → 400 no_api_key ไม่สร้างอะไรเลย · translate:false ไม่ต้องมี key (บันทึกเป็นร่างได้)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    t.ai.script.hasKey = false
    const before = snapshot(t)
    const c = await adminClient(t)

    const r = await create(c, n, [item(1), item(2)], { translate: true, publish: true })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, "no_api_key")
    assert.match(r.json.error, /ANTHROPIC_API_KEY/)
    assertNoSideEffects(t, before)

    const draft = await create(c, n, [item(1), item(2)], { translate: false })
    assert.equal(draft.status, 201, draft.text)
    assert.deepEqual(chaptersOf(t, n).map((x) => x.status), ["draft", "draft"])
  })
})

test("สร้างตอนในเรื่องที่ไม่มี/รหัสผิดรูปแบบ → 404 ไทย (ตรวจก่อน body จึง 404 แม้ body ผิด) ไม่สร้างอะไร", async () => {
  await withTestApp({}, async (t) => {
    seedNovel(t.db)
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const bad of ["999", "0", "abc", "-1", "01"]) {
      for (const body of [{ chapters: [item(1)] }, { chapters: "ผิด" }, {}]) {
        const r = await c.post(listPath(bad), body)
        assert.equal(r.status, 404, `${bad} ${JSON.stringify(body)}`)
        assert.equal(r.json.code, "not_found")
        assert.equal(r.json.error, "ไม่พบนิยายเรื่องนี้")
      }
    }
    assertNoSideEffects(t, before)
  })
})

test("(Review Focus 3) body ใหญ่เกิน 8MB → 413 too_large เป็น JSON ไทย ไม่สร้างอะไร และเซิร์ฟเวอร์ยังรับคำขอถัดไปได้", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const c = await adminClient(t)
    const r = await c.post(listPath(n), { chapters: [{ number: 1, title: "Big", text: "a".repeat(9 * 1024 * 1024) }] })
    assert.equal(r.status, 413)
    assert.equal(r.json.code, "too_large")
    assert.match(r.json.error, THAI)
    assert.equal(count(t, "chapters"), 0)

    const after = await create(c, n, [item(1)])
    assert.equal(after.status, 201, after.text)
  })
})

// ═════════════════════════ อ่านตอนเดียว ═════════════════════════

test("GET /chapters/:id ให้ตอนเต็ม (ต้นฉบับ+คำแปล+เรื่องย่อ) คีย์ camelCase ครบ ธงเป็น boolean เรื่องย่อที่ไม่มีเป็นข้อความว่าง", async () => {
  await withTestApp({}, async (t) => {
    // เรื่องและตอนอื่นมาก่อน เพื่อให้รหัสตอน รหัสเรื่อง และเลขตอนไม่ซ้ำกันเลย (สลับฟิลด์กันแล้วเทสต์ต้องเห็น)
    const filler = seedNovel(t.db, { title: "Filler" })
    seedChapter(t.db, filler, 1)
    seedChapter(t.db, filler, 2)
    const n = seedNovel(t.db)
    const full = seedChapter(t.db, n, 4, {
      title: "Four",
      titleTh: "สี่",
      source: "Original text",
      translation: "คำแปล",
      recap: "สรุปสั้น",
      status: "done",
      published: true,
      publishedAt: "2026-03-01 10:00:00",
      translatedAt: "2026-03-01 09:00:00",
      autoPublish: false,
    })
    const bare = seedChapter(t.db, n, 5, { status: "queued", queueSeq: 3, autoPublish: true })
    t.db.run("UPDATE chapters SET created_at = '2026-01-02 03:04:05', updated_at = '2026-02-03 04:05:06' WHERE id = ?", full)
    assert.ok(new Set([full, n, 4]).size === 3, "รหัสตอน / รหัสเรื่อง / เลขตอนต้องต่างกัน")
    const c = await adminClient(t)

    const a = await c.get(chapterPath(full))
    assert.equal(a.status, 200)
    assert.deepEqual(Object.keys(a.json).sort(), FULL_KEYS)
    assert.deepEqual(a.json, {
      id: full,
      novelId: n,
      number: 4,
      title: "Four",
      titleTh: "สี่",
      sourceText: "Original text",
      translation: "คำแปล",
      recap: "สรุปสั้น",
      status: "done",
      error: "",
      published: true,
      publishedAt: "2026-03-01 10:00:00",
      translatedAt: "2026-03-01 09:00:00",
      queueSeq: null,
      autoPublish: false,
      createdAt: "2026-01-02 03:04:05",
      updatedAt: "2026-02-03 04:05:06",
    })

    const b = await c.get(chapterPath(bare))
    assert.equal(b.json.recap, "")
    assert.equal(b.json.published, false)
    assert.equal(b.json.autoPublish, true)
    assert.equal(b.json.publishedAt, null)
    assert.equal(b.json.queueSeq, 3)
    assert.equal(b.json.status, "queued")
  })
})

test("GET/PATCH/DELETE /chapters/:id ที่ไม่มีหรือรหัสผิดรูปแบบ → 404 ไทย ไม่มีผลข้างเคียง (404 มาก่อน 400 ของ body)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedChapter(t.db, n, 1)
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const bad of ["999", "0", "-1", "abc", "1.5", "01", "1e2"]) {
      for (const [method, body] of [["get", undefined], ["patch", { title: "ok" }], ["patch", { title: 5 }], ["delete", undefined]] as [Method, unknown][]) {
        const r = await send(c, method, chapterPath(bad), body)
        assert.equal(r.status, 404, `${method} ${bad} ${JSON.stringify(body)}`)
        assert.equal(r.json.code, "not_found")
        assert.equal(r.json.error, "ไม่พบตอนที่ระบุ")
      }
    }
    assertNoSideEffects(t, before)
  })
})

// ═════════════════════════ แก้ตอน ═════════════════════════

test("PATCH แก้ชื่อ/ชื่อไทย/ต้นฉบับ/เรื่องย่อ: เก็บค่าที่ล้างแล้ว คืนตอนเต็ม ไม่เปลี่ยนสถานะ ไม่เข้าคิว ไม่เรียก AI และเฉพาะฟิลด์ที่ส่งมาเท่านั้นที่เปลี่ยน", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 3, {
      title: "Old",
      titleTh: "เก่า",
      source: "Old source",
      translation: "คำแปลเดิม",
      recap: "สรุปเดิม",
      status: "done",
      published: true,
      publishedAt: "2026-02-01 00:00:00",
      translatedAt: "2026-02-01 00:00:00",
    })
    const c = await adminClient(t)

    const r = await c.patch(chapterPath(id), { title: "﻿New title\r\n", titleTh: "ใหม่", sourceText: "New\r\nsource​  \r\n\r\n\r\n\r\ntext", recap: "﻿  สรุปใหม่\r\nบรรทัดสอง  " })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(Object.keys(r.json).sort(), FULL_KEYS)
    const row = getChapter(t.db, id)
    assert.equal(row.title, "New title")
    assert.equal(row.title_th, "ใหม่")
    assert.equal(row.source_text, "New\nsource\n\ntext")
    assert.equal(row.recap, "สรุปใหม่\nบรรทัดสอง")
    assert.equal(row.updated_at, NOW)
    // ที่ไม่ได้ส่งมา ไม่เปลี่ยน
    assert.equal(row.translation, "คำแปลเดิม")
    assert.equal(row.status, "done")
    assert.equal(row.published, 1)
    assert.equal(row.published_at, "2026-02-01 00:00:00")
    assert.equal(row.translated_at, "2026-02-01 00:00:00")
    assert.equal(row.number, 3)
    assert.equal(row.created_at, "2026-01-01 00:00:00")
    assert.equal(r.json.title, "New title")
    assert.equal(r.json.recap, "สรุปใหม่\nบรรทัดสอง")
    assert.equal(r.json.updatedAt, NOW)
    assert.equal(t.queue.state().waiting.length, 0)
    assert.deepEqual(t.ai.calls, [])

    // ส่งฟิลด์เดียว: ฟิลด์อื่นไม่ขยับ
    clock.advance(60_000)
    assert.equal((await c.patch(chapterPath(id), { titleTh: "สาม" })).status, 200)
    const again = getChapter(t.db, id)
    assert.equal(again.title_th, "สาม")
    assert.equal(again.title, "New title")
    assert.equal(again.source_text, "New\nsource\n\ntext")
    assert.equal(again.updated_at, "2026-10-22 01:03:03")
  })
})

test("PATCH {} (ไม่มีฟิลด์ที่แก้) → 200 คืนตอนเดิม ไม่แตะแถวและไม่ขยับเวลาแก้ไข · ฟิลด์ที่ไม่ใช่ของ PATCH (number, status, published, queueSeq, novelId…) ถูกเมิน", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    const id = seedChapter(t.db, n, 3, { status: "draft" })
    const before = rowsOf(t, "chapters")
    const c = await adminClient(t)

    const empty = await c.patch(chapterPath(id), {})
    assert.equal(empty.status, 200)
    assert.equal(empty.json.id, id)
    assert.equal(rowsOf(t, "chapters"), before)

    const sneaky = await c.patch(chapterPath(id), {
      number: 99,
      status: "done",
      published: true,
      publishedAt: "2030-01-01 00:00:00",
      queueSeq: 5,
      novelId: other,
      autoPublish: true,
      translatedAt: "2030-01-01 00:00:00",
      error: "x",
      id: 12345,
    })
    assert.equal(sneaky.status, 200)
    assert.equal(rowsOf(t, "chapters"), before)
  })
})

test("PATCH เรื่องย่อ: ข้อความว่าง/มีแต่ช่องว่าง = ล้างเรื่องย่อ (เก็บเป็น NULL, คืนเป็น \"\")", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1, { recap: "มีอยู่" })
    const c = await adminClient(t)
    const r = await c.patch(chapterPath(id), { recap: "  \r\n   " })
    assert.equal(r.status, 200)
    assert.equal(r.json.recap, "")
    assert.equal(getChapter(t.db, id).recap, null)
  })
})

const BAD_PATCH: [string, Record<string, unknown>, RegExp][] = [
  ["title ยาว 301", { title: longText(301) }, /title.*300/],
  ["title ไม่ใช่ข้อความ", { title: 5 }, /title/],
  ["title เป็น null", { title: null }, /title/],
  ["titleTh ยาว 301", { titleTh: longText(301) }, /titleTh.*300/],
  ["titleTh ไม่ใช่ข้อความ", { titleTh: 5 }, /titleTh/],
  ["sourceText ว่าง", { sourceText: "" }, /sourceText/],
  ["sourceText เหลือว่างหลังล้าง", { sourceText: " \n\t ﻿ " }, /sourceText/],
  ["sourceText ยาว 200,001", { sourceText: longText(200_001) }, /sourceText.*200000/],
  ["sourceText ไม่ใช่ข้อความ", { sourceText: 7 }, /sourceText/],
  ["translation ยาว 400,001", { translation: longText(400_001) }, /translation.*400000/],
  ["translation ไม่ใช่ข้อความ", { translation: 7 }, /translation/],
  ["translation เป็น null", { translation: null }, /translation/],
  ["recap ยาว 2,001", { recap: longText(2001) }, /recap.*2000/],
  ["recap ไม่ใช่ข้อความ", { recap: 7 }, /recap/],
  ["recap เป็น null", { recap: null }, /recap/],
]

test("PATCH ด้วยข้อมูลผิด → 400 invalid_field ข้อความไทยบอกชื่อฟิลด์ แถวไม่เปลี่ยน · ผิดข้อเดียว = ไม่แก้อะไรเลย (ฟิลด์อื่นที่ถูกในคำขอเดียวกันก็ไม่ถูกเขียน)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1, { title: "Keep", titleTh: "เดิม", source: "Source", status: "draft" })
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const [label, body, field] of BAD_PATCH) {
      for (const withGoodField of [false, true]) {
        const r = await c.patch(chapterPath(id), withGoodField ? { title: "Changed", ...body } : body)
        assert.equal(r.status, 400, `${label}: ${r.text}`)
        assert.equal(r.json.code, "invalid_field", label)
        assert.match(r.json.error, THAI, label)
        assert.match(r.json.error, field, label)
        assertNoSideEffects(t, before)
      }
    }
    // ไม่ใช่ออบเจ็กต์: อาร์เรย์ผ่านตัวอ่าน JSON มาถึง `obj` (bad_request) ส่วนข้อความ/ตัวเลข/null ตัวอ่าน JSON ปฏิเสธเองตั้งแต่แรก (bad_json)
    for (const [body, code] of [[[], "bad_request"], ["x", "bad_json"], [5, "bad_json"], [null, "bad_json"]] as const) {
      const r = await c.patch(chapterPath(id), body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, code, JSON.stringify(body))
      assert.match(r.json.error, THAI)
    }
    assert.equal((await c.patch(chapterPath(id))).status, 400, "ไม่ส่ง body เลย")
    assertNoSideEffects(t, before)
  })
})

test("ขอบเขตที่ PATCH ผ่านได้: title/titleTh 300 · sourceText 200,000 · translation 400,000 · recap 2,000", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1)
    const c = await adminClient(t)
    const r = await c.patch(chapterPath(id), {
      title: longText(300),
      titleTh: "ก".repeat(300),
      sourceText: longText(200_000),
      translation: "ข".repeat(400_000),
      recap: longText(2000),
    })
    assert.equal(r.status, 200, r.text.slice(0, 200))
    const row = getChapter(t.db, id)
    assert.deepEqual(
      [row.title.length, row.title_th.length, row.source_text.length, row.translation.length, row.recap?.length],
      [300, 300, 200_000, 400_000, 2000],
    )
  })
})

test("วางคำแปลเองให้ตอนที่ยังว่าง (draft/queued/error) → done, ตั้ง translated_at, ล้าง error, ออกจากคิว, ไม่เผยแพร่ (แม้ auto_publish), ไม่เรียก AI ไม่เขียน usage", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const draft = seedChapter(t.db, n, 1)
    const queued = seedChapter(t.db, n, 2, { status: "queued", queueSeq: 1, autoPublish: true })
    const failed = seedChapter(t.db, n, 3, { status: "error", error: "ล้มเหลวเมื่อกี้" })
    const c = await adminClient(t)
    assert.deepEqual(t.queue.state().waiting.map((w) => w.id), [queued])

    for (const id of [draft, queued, failed]) {
      const r = await c.patch(chapterPath(id), { translation: "﻿คำแปลที่วาง\r\nบรรทัดสอง  " })
      assert.equal(r.status, 200, r.text)
      const row = getChapter(t.db, id)
      assert.equal(row.translation, "คำแปลที่วาง\nบรรทัดสอง")
      assert.equal(row.status, "done")
      assert.equal(row.translated_at, NOW)
      assert.equal(row.error, "")
      assert.equal(row.queue_seq, null)
      assert.equal(row.published, 0, "ไม่เผยแพร่เอง")
      assert.equal(row.published_at, null)
      assert.equal(row.updated_at, NOW)
      assert.equal(r.json.status, "done")
      assert.equal(r.json.translatedAt, NOW)
      assert.equal(r.json.published, false)
    }
    assert.deepEqual(t.queue.state().waiting, [], "ตอนที่อยู่ในคิวออกจากคิวแล้ว")
    assert.deepEqual(t.ai.calls, [])
    assert.equal(count(t, "usage"), 0)
  })
})

test("วางคำแปลพร้อมแก้ชื่อ/เรื่องย่อในคำขอเดียว: ชื่อไทยที่เจ้าของส่งมาชนะเสมอ เรื่องย่อถูกเก็บ ไม่มีอะไรเขียนทับ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1, { titleTh: "ชื่อเดิม", recap: "สรุปเดิม" })
    const c = await adminClient(t)
    const r = await c.patch(chapterPath(id), { translation: "แปล", titleTh: "ชื่อใหม่", recap: "สรุปใหม่", title: "T" })
    assert.equal(r.status, 200, r.text)
    const row = getChapter(t.db, id)
    assert.deepEqual([row.status, row.translation, row.title_th, row.recap, row.title], ["done", "แปล", "ชื่อใหม่", "สรุปใหม่", "T"])

    // ไม่ส่ง recap ตอนวางคำแปล → เรื่องย่อเดิมอยู่
    const other = seedChapter(t.db, n, 2, { recap: "อยู่ต่อ", titleTh: "ไทยเดิม" })
    assert.equal((await c.patch(chapterPath(other), { translation: "แปลสอง" })).status, 200)
    assert.deepEqual([getChapter(t.db, other).recap, getChapter(t.db, other).title_th], ["อยู่ต่อ", "ไทยเดิม"])
  })
})

test("แก้คำแปลของตอนที่มีคำแปลแล้ว: เปลี่ยนแค่ข้อความ สถานะ/เผยแพร่/เวลาแปล/คิวคงเดิม (done+เผยแพร่, error+คำแปลเก่า, queued+คำแปลเก่า)", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const live = seedChapter(t.db, n, 1, { status: "done", translation: "เก่า 1", published: true, publishedAt: "2026-02-01 00:00:00", translatedAt: "2026-02-01 00:00:00" })
    const failed = seedChapter(t.db, n, 2, { status: "error", error: "แปลใหม่ไม่สำเร็จ", translation: "เก่า 2", translatedAt: "2026-02-02 00:00:00" })
    const waiting = seedChapter(t.db, n, 3, { status: "queued", queueSeq: 4, autoPublish: true, translation: "เก่า 3", translatedAt: "2026-02-03 00:00:00" })
    const c = await adminClient(t)

    for (const id of [live, failed, waiting]) {
      const before = getChapter(t.db, id)
      const r = await c.patch(chapterPath(id), { translation: `แก้แล้ว ${id}\r\n` })
      assert.equal(r.status, 200, r.text)
      const after = getChapter(t.db, id)
      assert.equal(after.translation, `แก้แล้ว ${id}`)
      assert.equal(after.updated_at, NOW)
      assert.deepEqual(
        [after.status, after.error, after.published, after.published_at, after.translated_at, after.queue_seq, after.auto_publish],
        [before.status, before.error, before.published, before.published_at, before.translated_at, before.queue_seq, before.auto_publish],
        `ตอน ${id}`,
      )
    }
    assert.deepEqual(t.queue.state().waiting.map((w) => w.id), [waiting], "ยังรอคิวอยู่")
    assert.deepEqual(t.ai.calls, [])
  })
})

test("ตอนที่กำลังแปล (translating): ส่งคำแปลหรือต้นฉบับ → 409 translating ไม่แก้อะไรเลย (รวมฟิลด์อื่นในคำขอเดียวกัน) · แก้ชื่อ/ชื่อไทย/เรื่องย่อได้ตามปกติ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1, { status: "translating", title: "T", titleTh: "ท", source: "Src", recap: "ร" })
    const before = snapshot(t)
    const c = await adminClient(t)

    for (const body of [{ translation: "วางมา" }, { sourceText: "new src" }, { title: "Changed", translation: "x" }, { titleTh: "ใหม่", sourceText: "x" }]) {
      const r = await c.patch(chapterPath(id), body)
      assert.equal(r.status, 409, JSON.stringify(body))
      assert.equal(r.json.code, "translating")
      assert.match(r.json.error, THAI)
      assertNoSideEffects(t, before)
    }

    const ok = await c.patch(chapterPath(id), { title: "T2", titleTh: "ท2", recap: "ร2" })
    assert.equal(ok.status, 200, ok.text)
    const row = getChapter(t.db, id)
    assert.deepEqual([row.title, row.title_th, row.recap, row.status, row.source_text], ["T2", "ท2", "ร2", "translating", "Src"])
  })
})

test("ล้างคำแปล (translation เป็นข้อความว่าง): ตอนที่เผยแพร่อยู่ → 400 (ให้ซ่อนก่อน) ไม่แก้อะไร · ตอนที่ยังไม่เผยแพร่ล้างได้: done → draft + ล้าง translated_at, error/queued คงสถานะ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const live = seedChapter(t.db, n, 1, { status: "done", translation: "กำลังเผยแพร่", published: true, publishedAt: "2026-02-01 00:00:00", translatedAt: "2026-02-01 00:00:00" })
    const done = seedChapter(t.db, n, 2, { status: "done", translation: "แปลเสร็จแต่ซ่อน", translatedAt: "2026-02-02 00:00:00", recap: "สรุป" })
    const failed = seedChapter(t.db, n, 3, { status: "error", error: "พัง", translation: "คำแปลเก่า", translatedAt: "2026-02-03 00:00:00" })
    const waiting = seedChapter(t.db, n, 4, { status: "queued", queueSeq: 2, translation: "คำแปลเก่า 4", translatedAt: "2026-02-04 00:00:00" })
    const c = await adminClient(t)

    const before = snapshot(t)
    const refused = await c.patch(chapterPath(live), { title: "x", translation: "" })
    assert.equal(refused.status, 400)
    assert.equal(refused.json.code, "published")
    assert.match(refused.json.error, THAI)
    assert.equal((await c.patch(chapterPath(live), { translation: "  \r\n  " })).status, 400, "ข้อความที่เหลือว่างหลังล้างก็คือการล้าง")
    assertNoSideEffects(t, before)

    const d = await c.patch(chapterPath(done), { translation: "" })
    assert.equal(d.status, 200, d.text)
    assert.deepEqual(
      (({ translation, status, translated_at, recap, published }) => ({ translation, status, translated_at, recap, published }))(getChapter(t.db, done)),
      { translation: "", status: "draft", translated_at: null, recap: "สรุป", published: 0 },
    )
    assert.deepEqual([d.json.translation, d.json.status, d.json.translatedAt], ["", "draft", null])

    assert.equal((await c.patch(chapterPath(failed), { translation: "" })).status, 200)
    const failedAfter = getChapter(t.db, failed)
    assert.deepEqual([failedAfter.translation, failedAfter.status, failedAfter.error, failedAfter.translated_at], ["", "error", "พัง", null])
    assert.equal((await c.patch(chapterPath(waiting), { translation: "" })).status, 200)
    const waitingAfter = getChapter(t.db, waiting)
    assert.deepEqual([waitingAfter.translation, waitingAfter.status, waitingAfter.queue_seq, waitingAfter.translated_at], ["", "queued", 2, null])
  })
})

test("ล้างคำแปลที่ว่างอยู่แล้ว = ไม่มีอะไรเปลี่ยน (ไม่ขยับสถานะ/เวลาแก้ไข) · ล้างพร้อมแก้ชื่อ → แก้ชื่ออย่างเดียว", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const id = seedChapter(t.db, n, 1, { status: "error", error: "ค้าง" })
    const before = rowsOf(t, "chapters")
    const c = await adminClient(t)
    assert.equal((await c.patch(chapterPath(id), { translation: "" })).status, 200)
    assert.equal(rowsOf(t, "chapters"), before)

    assert.equal((await c.patch(chapterPath(id), { translation: "", title: "ชื่อใหม่" })).status, 200)
    const row = getChapter(t.db, id)
    assert.deepEqual([row.title, row.status, row.error, row.translation, row.updated_at], ["ชื่อใหม่", "error", "ค้าง", "", NOW])
  })
})

// ═════════════════════════ ลบตอน ═════════════════════════

test("DELETE /chapters/:id: ลบตอนนั้นตอนเดียว (ตอนอื่นและอภิธานอยู่ครบ) ยกเลิกคิวเรียกด้วยรหัสตอนนั้น", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const gone = seedChapter(t.db, n, 1, { status: "done", translation: "x", published: true })
    const stay = seedChapter(t.db, n, 2)
    seedGlossary(t.db, n, [{ source: "A", thai: "เอ" }])
    const c = await adminClient(t)

    const r = await c.delete(chapterPath(gone))
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true })
    assert.deepEqual(t.cancelCalls, [[gone]])
    assert.equal(t.db.get("SELECT id FROM chapters WHERE id = ?", gone), undefined)
    assert.deepEqual(chaptersOf(t, n).map((x) => x.id), [stay])
    assert.equal(count(t, "glossary"), 1)
    assert.equal((await c.get(chapterPath(gone))).status, 404)
  })
})

test("(Review Focus 2) DELETE ตอนที่กำลังแปลอยู่ → ยกเลิกสตรีมจริง ไม่มีแถวฟื้น ไม่เขียน usage/สรุปตอน คิวไปทำตอนถัดไปต่อ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const doomed = seedChapter(t.db, n, 1)
    const next = seedChapter(t.db, n, 2)
    const c = await adminClient(t)
    const startedAt = Date.now()
    const { tick } = await startStuckTranslation(t, [doomed, next])
    assert.equal(t.queue.state().current?.chapterId, doomed)
    assert.equal(getChapter(t.db, doomed).status, "translating")

    const r = await c.delete(chapterPath(doomed))
    assert.equal(r.status, 200)
    assert.deepEqual(t.cancelCalls, [[doomed]])
    await assertCancelledAndQueueContinues(t, tick, startedAt, doomed, next)
    assert.equal(getChapter(t.db, next).published, 1, "ตอนถัดไปทำตามที่ตั้งตอนเข้าคิว (เผยแพร่เอง)")
  })
})

// ═════════════════════════ สั่งหลายตอน (bulk) ═════════════════════════

const BAD_BULK: [string, unknown, RegExp][] = [
  ["ไม่ส่ง body", undefined, /ออบเจ็กต์/],
  ["body เป็นอาร์เรย์", [], /ออบเจ็กต์/],
  ["ไม่ส่ง action", { ids: [1] }, /action/],
  ["action ไม่อยู่ในรายการ", { ids: [1], action: "explode" }, /action/],
  ["action ตัวพิมพ์ใหญ่", { ids: [1], action: "TRANSLATE" }, /action/],
  ["action เป็นตัวเลข", { ids: [1], action: 5 }, /action/],
  ["ไม่ส่ง ids หรือ where", { action: "hide" }, /ids.*where|where.*ids/],
  ["ส่งทั้ง ids และ where", { ids: [1], where: "ready", action: "publish" }, /ids.*where|where.*ids/],
  ["ids เป็นข้อความ", { ids: "1", action: "hide" }, /ids/],
  ["ids เป็น null", { ids: null, action: "hide" }, /ids/],
  ["ids เป็นออบเจ็กต์", { ids: {}, action: "hide" }, /ids/],
  ["ids ว่าง", { ids: [], action: "hide" }, /ids/],
  ["ids มี 0", { ids: [1, 0], action: "hide" }, /ids/],
  ["ids มีเลขติดลบ", { ids: [-1], action: "hide" }, /ids/],
  ["ids มีทศนิยม", { ids: [1.5], action: "hide" }, /ids/],
  ["ids มีข้อความตัวเลข", { ids: ["1"], action: "hide" }, /ids/],
  ["ids มี null", { ids: [null], action: "hide" }, /ids/],
  ["ids มีเลขใหญ่เกินที่แทนได้เป๊ะ", { ids: [1e16], action: "hide" }, /ids/],
  ["ids 501 รหัส", { ids: Array.from({ length: 501 }, (_, i) => i + 1), action: "hide" }, /500/],
  ["where ไม่ใช่ ready", { where: "all", action: "publish" }, /where/],
  ["where ตัวพิมพ์ใหญ่", { where: "READY", action: "publish" }, /where/],
  ["where เป็นตัวเลข", { where: 1, action: "publish" }, /where/],
  ["where ใช้กับ hide ไม่ได้", { where: "ready", action: "hide" }, /where/],
  ["where ใช้กับ delete ไม่ได้ (กันลบทั้งชุดโดยพลาด)", { where: "ready", action: "delete" }, /where/],
  ["where ใช้กับ translate ไม่ได้", { where: "ready", action: "translate" }, /where/],
  ["novelId ใช้คู่กับ ids ไม่ได้", { ids: [1], novelId: 1, action: "hide" }, /novelId/],
  ["novelId เป็นข้อความ", { where: "ready", novelId: "1", action: "publish" }, /novelId/],
  ["novelId เป็น 0", { where: "ready", novelId: 0, action: "publish" }, /novelId/],
  ["novelId ติดลบ", { where: "ready", novelId: -1, action: "publish" }, /novelId/],
  ["novelId เป็นทศนิยม", { where: "ready", novelId: 1.5, action: "publish" }, /novelId/],
  ["autoPublish เป็นข้อความ", { ids: [1], action: "translate", autoPublish: "yes" }, /autoPublish/],
  ["autoPublish เป็นตัวเลข", { ids: [1], action: "hide", autoPublish: 1 }, /autoPublish/],
]

test("bulk ด้วยคำขอผิด → 400 ข้อความไทยบอกชื่อฟิลด์ ไม่มีอะไรเปลี่ยน ไม่ยกเลิกคิว ไม่เรียก AI (รวม where:\"ready\" ใช้ได้กับ publish เท่านั้น)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedChapter(t.db, n, 1, { status: "done", translation: "x" })
    seedChapter(t.db, n, 2)
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const [label, body, field] of BAD_BULK) {
      const r = await c.post(BULK, body)
      assert.equal(r.status, 400, `${label}: ${r.text}`)
      assert.ok(["invalid_field", "bad_request"].includes(r.json.code), `${label}: ${r.json.code}`)
      assert.match(r.json.error, THAI, label)
      assert.match(r.json.error, field, label)
      assertNoSideEffects(t, before)
    }
  })
})

test("bulk publish: เผยแพร่เฉพาะตอนที่มีคำแปล · ตอนไม่มีคำแปลและรหัสที่ไม่มีนับเป็น skipped · ตอนที่เผยแพร่อยู่แล้วไม่ถูกแตะและไม่นับ · published_at ตั้งเมื่อเผยแพร่ครั้งแรก", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const fresh = seedChapter(t.db, n, 1, { status: "done", translation: "ก", translatedAt: "2026-02-01 00:00:00" })
    const live = seedChapter(t.db, n, 2, { status: "done", translation: "ข", published: true, publishedAt: "2026-01-05 00:00:00" })
    const draft = seedChapter(t.db, n, 3)
    const retry = seedChapter(t.db, n, 4, { status: "error", translation: "เก่า" })
    const c = await adminClient(t)

    const r = await c.post(BULK, { ids: [fresh, live, draft, retry, 99999], action: "publish" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { changed: 2, skipped: 2 })
    assert.deepEqual(
      [fresh, live, draft, retry].map((id) => [getChapter(t.db, id).published, getChapter(t.db, id).published_at]),
      [[1, NOW], [1, "2026-01-05 00:00:00"], [0, null], [1, NOW]],
    )
    assert.deepEqual(t.ai.calls, [])
    assert.deepEqual(t.cancelCalls, [])
  })
})

test("bulk hide: ซ่อนตอนที่เผยแพร่อยู่ (published_at เดิมอยู่) · ที่ซ่อนอยู่แล้วไม่นับ · รหัสที่ไม่มีนับเป็น skipped · ซ่อนแล้วเผยแพร่ใหม่ไม่เปลี่ยน published_at", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const n = seedNovel(t.db)
    const live = seedChapter(t.db, n, 1, { status: "done", translation: "ก", published: true, publishedAt: "2026-01-05 00:00:00" })
    const hidden = seedChapter(t.db, n, 2, { status: "done", translation: "ข" })
    const c = await adminClient(t)

    const r = await c.post(BULK, { ids: [live, hidden, 99999], action: "hide" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { changed: 1, skipped: 1 })
    assert.deepEqual([getChapter(t.db, live).published, getChapter(t.db, live).published_at], [0, "2026-01-05 00:00:00"])
    assert.equal(getChapter(t.db, hidden).published, 0)

    clock.advance(3_600_000)
    assert.deepEqual((await c.post(BULK, { ids: [live], action: "publish" })).json, { changed: 1, skipped: 0 })
    assert.deepEqual([getChapter(t.db, live).published, getChapter(t.db, live).published_at], [1, "2026-01-05 00:00:00"])
  })
})

test("bulk publish where:\"ready\": เผยแพร่ทุกตอน done ที่ยังไม่เผยแพร่ (จำกัดเรื่องด้วย novelId ถ้าส่ง) · ตอนสถานะอื่นที่มีคำแปลเก่าไม่ถูกแตะ · เรื่องที่ไม่มี → 404", async () => {
  const clock = createClock()
  await withTestApp({ now: clock.now }, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    const a1 = seedChapter(t.db, a, 1, { status: "done", translation: "ก" })
    const a2 = seedChapter(t.db, a, 2, { status: "done", translation: "ข" })
    const a3 = seedChapter(t.db, a, 3, { status: "done", translation: "ค", published: true, publishedAt: "2026-01-05 00:00:00" })
    const a4 = seedChapter(t.db, a, 4)
    const a5 = seedChapter(t.db, a, 5, { status: "error", translation: "คำแปลเก่า" })
    const a6 = seedChapter(t.db, a, 6, { status: "queued", queueSeq: 1, translation: "คำแปลเก่า" })
    const b1 = seedChapter(t.db, b, 1, { status: "done", translation: "ง" })
    const b2 = seedChapter(t.db, b, 2, { status: "done", translation: "จ" })
    const everything = [a1, a2, a3, a4, a5, a6, b1, b2]
    const published = () => everything.map((id) => getChapter(t.db, id).published)
    const c = await adminClient(t)

    const missing = await c.post(BULK, { where: "ready", novelId: 99999, action: "publish" })
    assert.equal(missing.status, 404)
    assert.equal(missing.json.code, "not_found")
    assert.equal(missing.json.error, "ไม่พบนิยายเรื่องนี้")
    assert.deepEqual(published(), [0, 0, 1, 0, 0, 0, 0, 0])

    // เรื่อง A: a1 a2 เท่านั้น (a5 error / a6 queued มีคำแปลเก่าแต่ไม่ใช่ done ห้ามถูกเผยแพร่) เรื่อง B ไม่ถูกแตะ
    const scopedA = await c.post(BULK, { where: "ready", novelId: a, action: "publish" })
    assert.deepEqual(scopedA.json, { changed: 2, skipped: 0 })
    assert.deepEqual(published(), [1, 1, 1, 0, 0, 0, 0, 0])

    const scopedB = await c.post(BULK, { where: "ready", novelId: b, action: "publish" })
    assert.deepEqual(scopedB.json, { changed: 2, skipped: 0 })
    assert.deepEqual(published(), [1, 1, 1, 0, 0, 0, 1, 1])
    assert.equal(getChapter(t.db, a1).published_at, NOW)
    assert.equal(getChapter(t.db, b2).published_at, NOW)
    assert.equal(getChapter(t.db, a3).published_at, "2026-01-05 00:00:00", "ตอนที่เผยแพร่อยู่แล้วไม่ถูกแตะ")

    // ไม่ส่ง novelId = ทุกเรื่อง
    const a7 = seedChapter(t.db, a, 7, { status: "done", translation: "ฉ" })
    const b3 = seedChapter(t.db, b, 3, { status: "done", translation: "ช" })
    clock.advance(60_000)
    const all = await c.post(BULK, { where: "ready", action: "publish" })
    assert.equal(all.status, 200, all.text)
    assert.deepEqual(all.json, { changed: 2, skipped: 0 })
    assert.deepEqual([a7, b3].map((id) => getChapter(t.db, id).published_at), ["2026-10-22 01:03:03", "2026-10-22 01:03:03"])
    assert.deepEqual(published(), [1, 1, 1, 0, 0, 0, 1, 1])

    assert.deepEqual((await c.post(BULK, { where: "ready", action: "publish" })).json, { changed: 0, skipped: 0 }, "ไม่เหลืออะไรให้เผยแพร่")
  })
})

test("bulk translate ไม่มี API key → 400 no_api_key ไม่เข้าคิวอะไรเลย", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const a = seedChapter(t.db, n, 1)
    const b = seedChapter(t.db, n, 2, { status: "done", translation: "x" })
    t.ai.script.hasKey = false
    const before = snapshot(t)
    const c = await adminClient(t)
    const r = await c.post(BULK, { ids: [a, b], action: "translate", autoPublish: true })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, "no_api_key")
    assert.match(r.json.error, /ANTHROPIC_API_KEY/)
    assertNoSideEffects(t, before)
    assert.deepEqual(t.queue.state().waiting, [])
  })
})

test("bulk translate: เข้าคิวตามเลขตอน (ต่อจากคิวเดิม) ข้ามตอนที่ queued/translating และรหัสที่ไม่มี · done/error แปลใหม่ได้โดยคำแปลเดิมและสถานะเผยแพร่อยู่ · บันทึก autoPublish", async () => {
  await withTestApp({}, async (t) => {
    const n1 = seedNovel(t.db, { title: "N1" })
    const n2 = seedNovel(t.db, { title: "N2" })
    const a = seedChapter(t.db, n1, 1)
    const b = seedChapter(t.db, n1, 2, { status: "done", translation: "แปลเก่า", published: true, publishedAt: "2026-02-01 00:00:00", translatedAt: "2026-02-01 00:00:00" })
    const e = seedChapter(t.db, n1, 3, { status: "error", error: "ผิดพลาดเดิม" })
    const q = seedChapter(t.db, n1, 4, { status: "queued", queueSeq: 5, autoPublish: false })
    const tr = seedChapter(t.db, n1, 5, { status: "translating" })
    const f = seedChapter(t.db, n2, 1)
    const c = await adminClient(t)

    const r = await c.post(BULK, { ids: [e, f, b, q, a, tr, 99999, a], action: "translate", autoPublish: true })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { queued: 4, skipped: 3 })
    assert.deepEqual(t.queue.state().waiting.map((w) => w.id), [q, a, b, e, f], "คิวเดิมก่อน แล้วเรียงเรื่อง→เลขตอน ไม่ใช่ตามลำดับที่ส่งมา")
    assert.deepEqual([a, b, e, f].map((id) => getChapter(t.db, id).queue_seq), [6, 7, 8, 9])
    for (const id of [a, b, e, f]) {
      assert.equal(getChapter(t.db, id).status, "queued")
      assert.equal(getChapter(t.db, id).auto_publish, 1)
    }
    const kept = getChapter(t.db, b)
    assert.deepEqual([kept.translation, kept.published, kept.published_at, kept.translated_at], ["แปลเก่า", 1, "2026-02-01 00:00:00", "2026-02-01 00:00:00"])
    assert.equal(getChapter(t.db, e).error, "")
    assert.deepEqual([getChapter(t.db, q).queue_seq, getChapter(t.db, q).auto_publish], [5, 0], "ตอนที่รออยู่แล้วไม่ถูกแตะ")
    assert.equal(getChapter(t.db, tr).status, "translating")

    // ไม่ส่ง autoPublish = false
    const g = seedChapter(t.db, n2, 2)
    assert.deepEqual((await c.post(BULK, { ids: [g], action: "translate" })).json, { queued: 1, skipped: 0 })
    assert.equal(getChapter(t.db, g).auto_publish, 0)
  })
})

test("bulk translate ปลุกคิวจริง: ตอนที่สั่งแปลถูกแปลเสร็จเอง (ผ่าน queue.enqueue)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const a = seedChapter(t.db, n, 1)
    t.queue.start()
    const c = await adminClient(t)
    assert.deepEqual((await c.post(BULK, { ids: [a], action: "translate", autoPublish: true })).json, { queued: 1, skipped: 0 })
    await until(() => getChapter(t.db, a).status === "done")
    assert.equal(getChapter(t.db, a).published, 1)
  })
})

test("bulk delete: ลบเฉพาะตอนที่เลือก คืนจำนวนที่ลบจริง (รหัสที่ไม่มีไม่นับ) ยกเลิกคิวด้วยรหัสที่ส่งมา (ไม่ซ้ำ) ตอนอื่น/อภิธานอยู่ครบ", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    const a1 = seedChapter(t.db, a, 1, { status: "done", translation: "x", published: true })
    const a2 = seedChapter(t.db, a, 2)
    const a3 = seedChapter(t.db, a, 3)
    const b1 = seedChapter(t.db, b, 1)
    seedGlossary(t.db, a, [{ source: "A", thai: "เอ" }])
    const c = await adminClient(t)

    const r = await c.post(BULK, { ids: [a1, b1, 99999, a1], action: "delete" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { deleted: 2 })
    assert.deepEqual(t.cancelCalls, [[a1, b1, 99999]])
    assert.deepEqual(t.db.all<{ id: number }>("SELECT id FROM chapters ORDER BY id").map((x) => x.id), [a2, a3])
    assert.equal(count(t, "glossary"), 1)
    assert.equal(count(t, "novels"), 2)
  })
})

test("(Review Focus 2) bulk delete ตอนที่กำลังแปลอยู่ → ยกเลิกสตรีมจริง ไม่มีแถวฟื้น ไม่เขียน usage/สรุปตอน คิวไปทำตอนถัดไปต่อ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const doomed = seedChapter(t.db, n, 1)
    const next = seedChapter(t.db, n, 2)
    const c = await adminClient(t)
    const startedAt = Date.now()
    const { tick } = await startStuckTranslation(t, [doomed, next])
    assert.equal(t.queue.state().current?.chapterId, doomed)

    const r = await c.post(BULK, { ids: [doomed], action: "delete" })
    assert.deepEqual(r.json, { deleted: 1 })
    assert.deepEqual(t.cancelCalls, [[doomed]])
    await assertCancelledAndQueueContinues(t, tick, startedAt, doomed, next)
  })
})

test("bulk: รหัสซ้ำในคำขอนับครั้งเดียว · ขอบเขต 500 รหัสต่อครั้งผ่านได้ (ที่เหลือที่ไม่มีนับเป็น skipped)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const a = seedChapter(t.db, n, 1, { status: "done", translation: "x" })
    const c = await adminClient(t)

    assert.deepEqual((await c.post(BULK, { ids: [a, a, a], action: "publish" })).json, { changed: 1, skipped: 0 })

    const five00 = [a, ...Array.from({ length: 499 }, (_, i) => 100_000 + i)]
    const r = await c.post(BULK, { ids: five00, action: "hide" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { changed: 1, skipped: 499 })
  })
})
