import { test } from "node:test"
import assert from "node:assert/strict"
import { AiError } from "../src/ai.js"
import { coverVersion, parseTags, toAdminNovelDto, type AdminNovelRow } from "../src/http/dto.js"
import { PNG_RED } from "./fixtures/images.js"
import { createClock } from "./helpers/clock.js"
import { withTestApp, type Client, type TestApp } from "./helpers/app.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const NOVELS = "/api/admin/novels"
type T = TestApp<FakeAi>
type Method = "get" | "post" | "put" | "patch" | "delete"

/** คีย์ทั้งหมดของ AdminNovelDto เรียงตามตัวอักษร — ไม่มีคอลัมน์ snake_case หรือข้อมูลดิบหลุดออกไป */
const DTO_KEYS = [
  "author", "chapterCount", "coverV", "createdAt", "featured", "hasCover", "id", "licenseNote", "mode", "published", "publishedCount",
  "sourceUrl", "status", "styleNote", "synopsis", "synopsisSrc", "tags", "title", "titleTh", "translatedCount", "updatedAt",
]

const FULL = {
  title: "The Beginning After The End",
  titleTh: "จุดจบและจุดเริ่มต้น",
  author: "TurtleMe",
  synopsis: "เรื่องย่อภาษาไทย",
  synopsisSrc: "English synopsis",
  tags: ["แฟนตาซี", "ต่างโลก"],
  status: "completed",
  sourceUrl: "https://example.com/novel/1",
  licenseNote: "ได้รับอนุญาตจากผู้แต่ง",
  styleNote: "ใช้สรรพนามผม/คุณ",
  mode: "story",
  published: true,
  featured: true,
}

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

const send = (c: Client, method: Method, path: string, body?: unknown) => (method === "get" ? c.get(path) : c[method](path, body))
const count = (t: T, table: string): number => t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n
const rowsOf = (t: T, table: string): string => JSON.stringify(t.db.all(`SELECT * FROM ${table}`))
const epoch = (iso: string): number => Math.floor(Date.parse(iso) / 1000)

async function create(c: Client, body: Record<string, unknown>) {
  const r = await c.post(NOVELS, body)
  assert.equal(r.status, 201, r.text)
  return r.json as Record<string, unknown> & { id: number }
}

const putCoverOf = (c: Client, id: number) => c.put(`${NOVELS}/${id}/cover`, { data: PNG_RED })

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: หมดเวลา")
    await new Promise((r) => setTimeout(r, 5))
  }
}

// ═════════════════════════ ต้องล็อกอิน ═════════════════════════

test("ทุกเส้นทางนิยายต้องล็อกอิน: ไม่มี cookie → 401 และไม่มีผลข้างเคียง (ไม่สร้าง ไม่แก้ ไม่ลบ ไม่เรียก AI ไม่ยกเลิกคิว ไม่เขียนปก)", async () => {
  await withTestApp({}, async (t) => {
    const id = seedNovel(t.db, { title: "Keep me", published: true })
    seedChapter(t.db, id, 1, { status: "done", translation: "x", published: true })
    const before = ["novels", "chapters", "covers", "usage"].map((table) => rowsOf(t, table))
    const stranger = t.client() // ไม่ล็อกอิน

    const routes: [Method, string, unknown?][] = [
      ["get", NOVELS],
      ["post", NOVELS, { title: "New" }],
      ["post", `${NOVELS}/ai-fill`, { title: "X" }],
      ["get", `${NOVELS}/${id}`],
      ["patch", `${NOVELS}/${id}`, { title: "Hacked" }],
      ["delete", `${NOVELS}/${id}`],
      ["put", `${NOVELS}/${id}/cover`, { data: PNG_RED }],
      ["delete", `${NOVELS}/${id}/cover`],
    ]
    for (const [method, path, body] of routes) {
      const r = await send(stranger, method, path, body)
      assert.equal(r.status, 401, `${method.toUpperCase()} ${path}`)
      assert.equal(r.json.code, "unauthorized")
    }
    assert.deepEqual(["novels", "chapters", "covers", "usage"].map((table) => rowsOf(t, table)), before)
    assert.deepEqual(t.cancelCalls, [])
    assert.deepEqual(t.ai.calls, [])
  })
})

test("คำตอบของเส้นทางนิยายเป็น JSON และห้าม cache (Cache-Control: no-store)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const r = await c.get(NOVELS)
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
    assert.equal(r.headers.get("cache-control"), "no-store")
  })
})

// ═════════════════════════ สร้างเรื่อง ═════════════════════════

test("POST /novels {title:'T'} → 201 ค่าเริ่มต้นครบ (mode translate, status ongoing, ไม่เผยแพร่, ไม่แนะนำ, tags []) และเวลาเป็นของนาฬิกาแอป", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const r = await c.post(NOVELS, { title: "T" })
    assert.equal(r.status, 201)
    assert.deepEqual(r.json, {
      id: 1,
      title: "T",
      titleTh: "",
      author: "",
      synopsis: "",
      synopsisSrc: "",
      tags: [],
      status: "ongoing",
      sourceUrl: "",
      licenseNote: "",
      styleNote: "",
      mode: "translate",
      published: false,
      featured: false,
      hasCover: false,
      coverV: 0,
      chapterCount: 0,
      translatedCount: 0,
      publishedCount: 0,
      createdAt: "2026-10-22 01:02:03",
      updatedAt: "2026-10-22 01:02:03",
    })
    assert.deepEqual(Object.keys(r.json).sort(), DTO_KEYS)
    assert.equal(count(t, "novels"), 1)
  })
})

test("POST /novels ครบทุกฟิลด์: เก็บและตอบค่าที่ล้างข้อความแล้ว (CRLF, NBSP, ช่องว่าง, แท็กซ้ำ/ว่าง) ใน DB เก็บ tags เป็น JSON และธง 0/1", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const r = await c.post(NOVELS, {
      ...FULL,
      title: "  The Beginning After The End\r\n",
      synopsis: "บรรทัดหนึ่ง\r\nบรรทัดสอง  ",
      synopsisSrc: "Line one\r\n\r\n\r\n\r\nLine two",
      tags: [" แฟนตาซี ", "ต่างโลก", "แฟนตาซี", "", "   "],
      sourceUrl: " https://example.com/novel/1 ",
    })
    assert.equal(r.status, 201, r.text)
    assert.deepEqual({ ...r.json, id: undefined, createdAt: undefined, updatedAt: undefined }, { ...FULL, synopsis: "บรรทัดหนึ่ง\nบรรทัดสอง", synopsisSrc: "Line one\n\nLine two", id: undefined, createdAt: undefined, updatedAt: undefined, hasCover: false, coverV: 0, chapterCount: 0, translatedCount: 0, publishedCount: 0 })

    const row = t.db.get<Record<string, unknown>>("SELECT * FROM novels WHERE id = ?", r.json.id)!
    assert.equal(row.tags, '["แฟนตาซี","ต่างโลก"]')
    assert.equal(row.published, 1)
    assert.equal(row.featured, 1)
    assert.equal(row.mode, "story")
    assert.equal(row.status, "completed")
    assert.equal(row.source_url, "https://example.com/novel/1")
    assert.equal(row.title_th, FULL.titleTh)
    assert.equal(row.synopsis_src, "Line one\n\nLine two")
    assert.equal(row.license_note, FULL.licenseNote)
    assert.equal(row.style_note, FULL.styleNote)
  })
})

test("POST /novels: ขีดจำกัดพอดีผ่าน (title 300, titleTh 300, author 200, synopsis 10000, synopsisSrc 10000, licenseNote 2000, styleNote 3000, แท็ก 12 อัน อันละ 40, ลิงก์ 2000)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const limits: [string, number][] = [
      ["title", 300],
      ["titleTh", 300],
      ["author", 200],
      ["synopsis", 10_000],
      ["synopsisSrc", 10_000],
      ["licenseNote", 2000],
      ["styleNote", 3000],
    ]
    for (const [field, limit] of limits) {
      const r = await c.post(NOVELS, { title: "T", [field]: "ก".repeat(limit) })
      assert.equal(r.status, 201, `${field} ${limit} ตัว: ${r.text}`)
      assert.equal(r.json[field].length, limit)
    }
    const tags = Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(40, "ข"))
    const withTags = await c.post(NOVELS, { title: "T", tags })
    assert.equal(withTags.status, 201, withTags.text)
    assert.deepEqual(withTags.json.tags, tags)

    const prefix = "https://example.com/"
    const url = prefix + "x".repeat(2000 - prefix.length)
    const withUrl = await c.post(NOVELS, { title: "T", sourceUrl: url })
    assert.equal(withUrl.status, 201, withUrl.text)
    assert.equal(withUrl.json.sourceUrl, url)
  })
})

test("POST /novels: ข้อมูลไม่ถูกต้อง → 400 invalid_field ข้อความไทยที่บอกชื่อฟิลด์ และไม่สร้างอะไรเลย", async () => {
  const urlPrefix = "https://example.com/"
  const invalid: [name: string, body: Record<string, unknown>, mention: string][] = [
    ["ไม่มี title", {}, "(title)"],
    ["title ว่าง", { title: "" }, "(title)"],
    ["title ช่องว่างล้วน", { title: "  \r\n " }, "(title)"],
    ["title ไม่ใช่ข้อความ", { title: 123 }, "(title)"],
    ["title null", { title: null }, "(title)"],
    ["title 301 ตัว", { title: "x".repeat(301) }, "300"],
    ["titleTh 301 ตัว", { title: "T", titleTh: "ก".repeat(301) }, "(titleTh)"],
    ["author 201 ตัว", { title: "T", author: "a".repeat(201) }, "(author)"],
    ["author เป็น null", { title: "T", author: null }, "(author)"],
    ["synopsis 10001 ตัว", { title: "T", synopsis: "ก".repeat(10_001) }, "(synopsis)"],
    ["synopsisSrc 10001 ตัว", { title: "T", synopsisSrc: "a".repeat(10_001) }, "(synopsisSrc)"],
    ["licenseNote 2001 ตัว", { title: "T", licenseNote: "ก".repeat(2001) }, "(licenseNote)"],
    ["styleNote 3001 ตัว", { title: "T", styleNote: "ก".repeat(3001) }, "(styleNote)"],
    ["แท็ก 13 อัน", { title: "T", tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, "แท็ก"],
    ["แท็กยาว 41 ตัว", { title: "T", tags: ["ก".repeat(41)] }, "แท็ก"],
    ["tags ไม่ใช่อาร์เรย์", { title: "T", tags: "a,b" }, "แท็ก"],
    ["tags มีสมาชิกไม่ใช่ข้อความ", { title: "T", tags: ["ok", 2] }, "แท็ก"],
    ["sourceUrl javascript:", { title: "T", sourceUrl: "javascript:alert(1)" }, "(sourceUrl)"],
    ["sourceUrl data:", { title: "T", sourceUrl: "data:text/html,<script>alert(1)</script>" }, "(sourceUrl)"],
    ["sourceUrl ไม่มีสกีม", { title: "T", sourceUrl: "example.com/novel" }, "(sourceUrl)"],
    ["sourceUrl 2001 ตัว", { title: "T", sourceUrl: urlPrefix + "x".repeat(2001 - urlPrefix.length) }, "(sourceUrl)"],
    ["sourceUrl ไม่ใช่ข้อความ", { title: "T", sourceUrl: 5 }, "(sourceUrl)"],
    ["mode summary", { title: "T", mode: "summary" }, "(mode)"],
    ["mode ว่าง", { title: "T", mode: "" }, "(mode)"],
    ["status ผิด", { title: "T", status: "paused" }, "(status)"],
    ["published เป็นข้อความ", { title: "T", published: "yes" }, "(published)"],
    ["published เป็น null", { title: "T", published: null }, "(published)"],
    ["featured เป็นตัวเลข", { title: "T", featured: 1 }, "(featured)"],
  ]
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    for (const [name, body, mention] of invalid) {
      const r = await c.post(NOVELS, body)
      assert.equal(r.status, 400, name)
      assert.equal(r.json.code, "invalid_field", name)
      assert.match(r.json.error, THAI, name)
      assert.ok(r.json.error.includes(mention), `${name}: ข้อความ "${r.json.error}" ต้องมี "${mention}"`)
    }
    assert.equal(count(t, "novels"), 0, "ไม่มีอะไรถูกสร้าง")

    // ฟิลด์ที่ถูกอยู่ก่อนฟิลด์ที่ผิด ก็ไม่ถูกสร้างครึ่งๆ กลางๆ
    const mixed = await c.post(NOVELS, { title: "Good title", author: "Good", mode: "bad" })
    assert.equal(mixed.status, 400)
    assert.equal(count(t, "novels"), 0)
  })
})

test("POST /novels: body ไม่ใช่ออบเจ็กต์ (อาร์เรย์ / ไม่มี body) → 400 bad_request", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    for (const body of [[], [{ title: "T" }]]) {
      const r = await c.post(NOVELS, body)
      assert.equal(r.status, 400)
      assert.equal(r.json.code, "bad_request")
      assert.match(r.json.error, THAI)
    }
    const none = await c.post(NOVELS)
    assert.equal(none.status, 400)
    assert.equal(none.json.code, "bad_request")
    assert.equal(count(t, "novels"), 0)
  })
})

test("POST /novels: ฟิลด์ที่ไม่รู้จักหรืออ่านอย่างเดียว (id, hasCover, chapterCount, createdAt, __proto__) ถูกเมิน ไม่ถูกเขียนลงข้อมูล", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const body = JSON.parse(
      '{"title":"T","id":99,"hasCover":true,"coverV":5,"chapterCount":7,"createdAt":"2000-01-01 00:00:00","updatedAt":"2000-01-01 00:00:00","extra":1,"__proto__":{"title":"pwn","polluted":true},"constructor":{"x":1}}',
    )
    const r = await c.post(NOVELS, body)
    assert.equal(r.status, 201, r.text)
    assert.notEqual(r.json.id, 99)
    assert.equal(r.json.title, "T")
    assert.equal(r.json.hasCover, false)
    assert.equal(r.json.coverV, 0)
    assert.equal(r.json.chapterCount, 0)
    assert.notEqual(r.json.createdAt, "2000-01-01 00:00:00")
    assert.deepEqual(Object.keys(r.json).sort(), DTO_KEYS)
    assert.equal(({} as { polluted?: boolean }).polluted, undefined)
  })
})

// ═════════════════════════ อ่านรายการ / รายเรื่อง ═════════════════════════

test("GET /novels: ไม่มีเรื่อง → []", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const r = await c.get(NOVELS)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, [])
  })
})

test("GET /novels: เรื่องใหม่สุดขึ้นก่อน และ chapterCount/translatedCount/publishedCount นับถูกแยกตามเรื่อง (ตอนที่มีคำแปลเดิมระหว่างแปลใหม่ยังนับ)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const a = seedNovel(t.db, { title: "A", published: true })
    const b = seedNovel(t.db, { title: "B" })
    const empty = seedNovel(t.db, { title: "C-empty" })
    seedChapter(t.db, a, 1, { status: "draft" }) //                                            ยังไม่แปล
    seedChapter(t.db, a, 2, { status: "done", translation: "t2", published: true }) //         แปลแล้ว + เผยแพร่
    seedChapter(t.db, a, 3, { status: "done", translation: "t3" }) //                          แปลแล้ว ยังไม่เผยแพร่
    seedChapter(t.db, a, 4, { status: "queued", translation: "old", queueSeq: 1, published: true }) // แปลใหม่ แต่คำแปลเดิมยังอยู่
    seedChapter(t.db, a, 5, { status: "error", error: "x" }) //                                ล้มเหลว ไม่มีคำแปล
    seedChapter(t.db, b, 1, { status: "done", translation: "b1", published: true })
    t.db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', x'89504e47', '2026-03-04 05:06:07')", b)

    const r = await c.get(NOVELS)
    assert.equal(r.status, 200)
    const list = r.json as Record<string, unknown>[]
    assert.deepEqual(list.map((n) => n.id), [empty, b, a], "เรียงเรื่องที่สร้างทีหลังก่อน")
    for (const n of list) assert.deepEqual(Object.keys(n).sort(), DTO_KEYS)

    const byId = new Map(list.map((n) => [n.id, n]))
    const counts = (id: number) => {
      const n = byId.get(id)!
      return [n.chapterCount, n.translatedCount, n.publishedCount]
    }
    assert.deepEqual(counts(a), [5, 3, 2])
    assert.deepEqual(counts(b), [1, 1, 1])
    assert.deepEqual(counts(empty), [0, 0, 0])

    assert.equal(byId.get(b)!.hasCover, true)
    assert.equal(byId.get(b)!.coverV, epoch("2026-03-04T05:06:07Z"))
    assert.equal(byId.get(a)!.hasCover, false)
    assert.equal(byId.get(a)!.coverV, 0)
    assert.equal(byId.get(a)!.published, true)
    assert.equal(byId.get(b)!.published, false)
    assert.equal(byId.get(a)!.title, "A")
  })
})

test("GET /novels/:id: คืน DTO เดียวกับในรายการ; ไม่มีเรื่อง / รหัสผิดรูป → 404 not_found ข้อความไทย", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const created = await create(c, FULL)
    const chapter = seedChapter(t.db, created.id, 1, { status: "done", translation: "x", published: true })
    assert.ok(chapter)
    const one = await c.get(`${NOVELS}/${created.id}`)
    assert.equal(one.status, 200)
    assert.deepEqual(one.json, { ...created, chapterCount: 1, translatedCount: 1, publishedCount: 1 })
    assert.deepEqual((await c.get(NOVELS)).json, [one.json])

    for (const bad of ["999", "0", "-1", "abc", "1.5", "007", "ai-fill", "99999999999999999999"]) {
      const r = await c.get(`${NOVELS}/${bad}`)
      assert.equal(r.status, 404, bad)
      assert.equal(r.json.code, "not_found", bad)
      assert.match(r.json.error, THAI, bad)
    }
  })
})

test("รหัสเรื่องในพาธต้องเป็นรูปแบบมาตรฐานในทุกเส้นทาง: 01, 1.0, 1e0, +1 ไม่ใช่เรื่อง 1 (ไม่อ่าน ไม่แก้ ไม่ลบ ไม่แตะปก)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, { title: "Only one", published: true })
    assert.equal(n.id, 1)
    assert.equal((await putCoverOf(c, 1)).status, 200)
    seedChapter(t.db, 1, 1)
    const before = ["novels", "chapters", "covers"].map((table) => rowsOf(t, table))

    for (const odd of ["01", "1.0", "1e0", "+1", "%201", "1%20", "1abc"]) {
      const routes: [Method, string, unknown?][] = [
        ["get", `${NOVELS}/${odd}`],
        ["patch", `${NOVELS}/${odd}`, { title: "Hijacked" }],
        ["delete", `${NOVELS}/${odd}`],
        ["put", `${NOVELS}/${odd}/cover`, { data: PNG_RED }],
        ["delete", `${NOVELS}/${odd}/cover`],
      ]
      for (const [method, path, body] of routes) {
        const r = await send(c, method, path, body)
        assert.equal(r.status, 404, `${method.toUpperCase()} ${path}`)
        assert.equal(r.json.code, "not_found")
      }
    }
    assert.deepEqual(["novels", "chapters", "covers"].map((table) => rowsOf(t, table)), before)
    assert.deepEqual(t.cancelCalls, [])
  })
})

// ═════════════════════════ แก้ไขเรื่อง ═════════════════════════

test("PATCH: ส่งบางฟิลด์ได้ — แก้เฉพาะที่ส่งและล้างข้อความ, ที่เหลือคงเดิม, ตอบ DTO เต็ม, updatedAt ขยับ ส่วน createdAt คงเดิม", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    let prev: Record<string, unknown> = await create(c, { ...FULL, featured: false, published: false })
    const id = prev.id as number

    const steps: [field: string, value: unknown, stored: unknown][] = [
      ["title", "  New title \r\n", "New title"],
      ["titleTh", "ชื่อไทยใหม่", "ชื่อไทยใหม่"],
      ["author", "Author Two", "Author Two"],
      ["synopsis", "เรื่องย่อใหม่\r\nบรรทัดสอง", "เรื่องย่อใหม่\nบรรทัดสอง"],
      ["synopsisSrc", "New English synopsis ", "New English synopsis"],
      ["tags", ["ใหม่", "Isekai", "isekai", ""], ["ใหม่", "Isekai"]],
      ["tags", [], []],
      ["status", "ongoing", "ongoing"],
      ["sourceUrl", " https://example.org/n/2 ", "https://example.org/n/2"],
      ["sourceUrl", "", ""],
      ["licenseNote", "ใบอนุญาตใหม่", "ใบอนุญาตใหม่"],
      ["styleNote", "สไตล์ใหม่", "สไตล์ใหม่"],
      ["mode", "translate", "translate"],
      ["published", true, true],
      ["published", false, false],
      ["featured", true, true],
      ["featured", false, false],
    ]
    for (const [field, value, stored] of steps) {
      clock.advance(60_000)
      const expectedUpdatedAt = clock.now().toISOString().slice(0, 19).replace("T", " ")
      const r = await c.patch(`${NOVELS}/${id}`, { [field]: value })
      assert.equal(r.status, 200, `${field}: ${r.text}`)
      assert.deepEqual(r.json, { ...prev, [field]: stored, updatedAt: expectedUpdatedAt }, `PATCH ${field}`)
      assert.deepEqual((await c.get(`${NOVELS}/${id}`)).json, r.json, `GET หลัง PATCH ${field}`)
      prev = r.json
    }
    assert.equal(prev.createdAt, "2026-10-22 01:02:03")
    assert.notEqual(prev.updatedAt, prev.createdAt)
  })
})

test("PATCH หลายฟิลด์พร้อมกันได้ในคำขอเดียว", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, { title: "Old" })
    const r = await c.patch(`${NOVELS}/${n.id}`, { title: "New", titleTh: "ใหม่", tags: ["a"], published: true, mode: "story", sourceUrl: "https://example.com/x" })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ...n, title: "New", titleTh: "ใหม่", tags: ["a"], published: true, mode: "story", sourceUrl: "https://example.com/x" })
  })
})

test("PATCH: มีฟิลด์ผิดแม้ตัวเดียว → 400 และไม่แก้อะไรเลย (รวมฟิลด์ที่ถูกในคำขอเดียวกัน)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, FULL)
    const path = `${NOVELS}/${n.id}`
    const bad: [string, Record<string, unknown>, string][] = [
      ["title ว่าง", { title: "" }, "(title)"],
      ["title 301", { title: "x".repeat(301) }, "(title)"],
      ["title ไม่ใช่ข้อความ", { title: 5 }, "(title)"],
      ["mode ผิดพร้อม title ที่ถูก", { title: "Changed", mode: "summary" }, "(mode)"],
      ["status ผิด", { author: "Changed", status: "paused" }, "(status)"],
      ["แท็ก 13", { titleTh: "Changed", tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, "แท็ก"],
      ["sourceUrl javascript:", { sourceUrl: "javascript:alert(1)" }, "(sourceUrl)"],
      ["featured ไม่ใช่ boolean", { published: false, featured: "yes" }, "(featured)"],
      ["published เป็น null", { published: null }, "(published)"],
    ]
    for (const [name, body, mention] of bad) {
      const r = await c.patch(path, body)
      assert.equal(r.status, 400, name)
      assert.equal(r.json.code, "invalid_field", name)
      assert.ok(r.json.error.includes(mention), `${name}: "${r.json.error}"`)
      assert.deepEqual((await c.get(path)).json, n, `${name}: ข้อมูลต้องไม่เปลี่ยน`)
    }
  })
})

test("PATCH {} → 200 ไม่มีอะไรเปลี่ยน (updatedAt คงเดิม); ฟิลด์ที่ไม่รู้จัก/อ่านอย่างเดียวถูกเมิน", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, FULL)
    const path = `${NOVELS}/${n.id}`
    clock.advance(3_600_000)

    const empty = await c.patch(path, {})
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, n)

    const ignored = JSON.parse(
      '{"id":99,"hasCover":true,"coverV":5,"chapterCount":7,"translatedCount":7,"publishedCount":7,"createdAt":"2000-01-01 00:00:00","updatedAt":"2000-01-01 00:00:00","extra":1,"__proto__":{"title":"pwn","polluted":true},"constructor":{"x":1}}',
    )
    const r = await c.patch(path, ignored)
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, n)
    assert.equal(count(t, "novels"), 1)
    assert.equal(({} as { polluted?: boolean }).polluted, undefined)
  })
})

test("PATCH: body ไม่ใช่ออบเจ็กต์ → 400 bad_request; ไม่มีเรื่อง/รหัสผิดรูป → 404 (ตรวจเรื่องก่อนตรวจ body)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, { title: "T" })
    for (const body of [[], [{ title: "x" }]]) {
      const r = await c.patch(`${NOVELS}/${n.id}`, body)
      assert.equal(r.status, 400)
      assert.equal(r.json.code, "bad_request")
    }
    assert.equal((await c.patch(`${NOVELS}/${n.id}`)).status, 400)

    for (const id of ["999", "0", "abc", "1.5", "007"]) {
      const valid = await c.patch(`${NOVELS}/${id}`, { title: "x" })
      assert.equal(valid.status, 404, id)
      assert.equal(valid.json.code, "not_found", id)
      assert.match(valid.json.error, THAI, id)
      const invalid = await c.patch(`${NOVELS}/${id}`, { title: "" })
      assert.equal(invalid.status, 404, `${id} + body ผิด`)
      assert.equal((await c.patch(`${NOVELS}/${id}`, [])).status, 404, `${id} + body ไม่ใช่ออบเจ็กต์`)
      assert.equal((await c.patch(`${NOVELS}/${id}`)).status, 404, `${id} + ไม่มี body`)
    }
    assert.equal((await c.get(`${NOVELS}/${n.id}`)).json.title, "T")
  })
})

// ═════════════════════════ เรื่องแนะนำมีได้เรื่องเดียว ═════════════════════════

test("featured: ตั้งเรื่อง B เป็นแนะนำ → เรื่อง A ถูกปลด (ทั้งตอนสร้างและตอน PATCH); มีได้เรื่องเดียวเสมอ", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const featuredIds = () => t.db.all<{ id: number }>("SELECT id FROM novels WHERE featured = 1 ORDER BY id").map((r) => r.id)

    const a = await create(c, { title: "A", featured: true })
    assert.deepEqual(featuredIds(), [a.id])

    clock.advance(60_000)
    const b = await create(c, { title: "B", featured: true }) // สร้างใหม่แล้วแนะนำ → A ถูกปลด
    assert.deepEqual(featuredIds(), [b.id])
    assert.equal((await c.get(`${NOVELS}/${a.id}`)).json.featured, false)
    assert.equal((await c.get(`${NOVELS}/${a.id}`)).json.updatedAt, "2026-10-22 01:03:03", "เรื่องที่ถูกปลดก็นับว่าถูกแก้")

    const third = await create(c, { title: "C" }) // ไม่ได้ขอแนะนำ → ไม่กระทบ
    assert.deepEqual(featuredIds(), [b.id])

    clock.advance(60_000)
    assert.equal((await c.patch(`${NOVELS}/${a.id}`, { featured: true })).status, 200) // PATCH ตั้งเรื่อง A กลับ → B ถูกปลด
    assert.deepEqual(featuredIds(), [a.id])
    assert.equal((await c.get(`${NOVELS}/${b.id}`)).json.featured, false)
    assert.equal((await c.get(`${NOVELS}/${b.id}`)).json.updatedAt, "2026-10-22 01:04:03", "เรื่องที่ถูกปลดนับว่าถูกแก้")
    assert.equal((await c.get(`${NOVELS}/${third.id}`)).json.updatedAt, "2026-10-22 01:03:03", "เรื่องที่ไม่ได้แนะนำอยู่ไม่ถูกแตะเลย")

    // ตั้งซ้ำเรื่องที่แนะนำอยู่แล้ว ต้องยังแนะนำอยู่ (ไม่ปลดตัวเอง)
    assert.equal((await c.patch(`${NOVELS}/${a.id}`, { featured: true })).json.featured, true)
    assert.deepEqual(featuredIds(), [a.id])

    // PATCH ฟิลด์อื่น / featured:false ของเรื่องอื่น ไม่แตะเรื่องที่แนะนำอยู่
    await c.patch(`${NOVELS}/${third.id}`, { title: "C2" })
    await c.patch(`${NOVELS}/${third.id}`, { featured: false })
    await c.patch(`${NOVELS}/${b.id}`, { published: true })
    assert.deepEqual(featuredIds(), [a.id])

    // ปลดเอง → ไม่มีเรื่องแนะนำ
    assert.equal((await c.patch(`${NOVELS}/${a.id}`, { featured: false })).json.featured, false)
    assert.deepEqual(featuredIds(), [])
  })
})

test("featured: คำขอที่ล้มเหลว (400 / 404) ไม่ปลดเรื่องที่แนะนำอยู่", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const a = await create(c, { title: "A", featured: true })
    const b = await create(c, { title: "B" })
    assert.equal((await c.patch(`${NOVELS}/${b.id}`, { featured: true, mode: "bad" })).status, 400)
    assert.equal((await c.post(NOVELS, { title: "", featured: true })).status, 400)
    assert.equal((await c.patch(`${NOVELS}/999`, { featured: true })).status, 404)
    assert.equal((await c.get(`${NOVELS}/${a.id}`)).json.featured, true)
    assert.equal((await c.get(`${NOVELS}/${b.id}`)).json.featured, false)
  })
})

// ═════════════════════════ ลบเรื่อง (Review Focus 2) ═════════════════════════

test("DELETE /novels/:id: ยกเลิกคิวด้วยรหัสตอนทั้งหมดของเรื่อง แล้วลบตอน/อภิธาน/ปกตามไป โดยไม่แตะเรื่องอื่น (ยอดอ่านเก็บไว้)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const doomed = seedNovel(t.db, { title: "Doomed", published: true })
    const keep = seedNovel(t.db, { title: "Keep", published: true })
    const doomedChapters = [
      seedChapter(t.db, doomed, 1),
      seedChapter(t.db, doomed, 2, { status: "done", translation: "x", published: true }),
      seedChapter(t.db, doomed, 3, { status: "queued", queueSeq: 1 }),
    ]
    const keepChapter = seedChapter(t.db, keep, 1, { status: "done", translation: "y", published: true })
    seedGlossary(t.db, doomed, [{ source: "A", thai: "เอ" }, { source: "B", thai: "บี" }])
    seedGlossary(t.db, keep, [{ source: "A", thai: "เอ" }])
    for (const id of [doomed, keep]) {
      t.db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', x'89504e47', '2026-01-01 00:00:00')", id)
      t.db.run("INSERT INTO views (day, novel_id, count) VALUES ('2026-10-22', ?, 5)", id)
    }

    const r = await c.delete(`${NOVELS}/${doomed}`)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true })

    assert.equal(t.cancelCalls.length, 1, "ยกเลิกคิวหนึ่งครั้งต่อการลบหนึ่งเรื่อง")
    assert.deepEqual([...t.cancelCalls[0]!].sort((x, y) => x - y), doomedChapters)

    assert.equal(t.db.get("SELECT id FROM novels WHERE id = ?", doomed), undefined)
    assert.equal(count(t, "novels"), 1)
    assert.deepEqual(t.db.all("SELECT id FROM chapters"), [{ id: keepChapter }])
    assert.deepEqual(t.db.all("SELECT novel_id FROM glossary"), [{ novel_id: keep }])
    assert.deepEqual(t.db.all("SELECT novel_id FROM covers"), [{ novel_id: keep }])
    assert.deepEqual(t.db.all("SELECT novel_id FROM views ORDER BY novel_id"), [{ novel_id: doomed }, { novel_id: keep }], "ประวัติยอดอ่านไม่ถูกลบ")

    assert.equal((await c.get(`${NOVELS}/${doomed}`)).status, 404)
    assert.equal((await c.get(`${NOVELS}/${keep}`)).status, 200)
    assert.equal((await new Response((await fetch(`${t.base}/covers/${doomed}`)).body).text()).includes("not_found"), true)
  })
})

test("DELETE: เรื่องที่ไม่มีตอนก็ลบได้; ไม่มีเรื่อง/รหัสผิดรูป → 404 และไม่ยกเลิกคิว; ลบซ้ำ → 404", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const n = await create(c, { title: "Empty" })
    const keep = await create(c, { title: "Keep" })
    for (const bad of ["999", "0", "abc", "1.5", "007"]) {
      const r = await c.delete(`${NOVELS}/${bad}`)
      assert.equal(r.status, 404, bad)
      assert.equal(r.json.code, "not_found", bad)
    }
    assert.deepEqual(t.cancelCalls, [])
    assert.equal(count(t, "novels"), 2)

    assert.equal((await c.delete(`${NOVELS}/${n.id}`)).status, 200)
    assert.equal((await c.delete(`${NOVELS}/${n.id}`)).status, 404)
    assert.equal(count(t, "novels"), 1)
    assert.equal((await c.get(`${NOVELS}/${keep.id}`)).status, 200)
    assert.equal(t.cancelCalls.length, 1)
    assert.deepEqual(t.cancelCalls[0], [])
  })
})

test("DELETE ระหว่างที่ตอนของเรื่องนั้นกำลังแปลอยู่ (คิวจริง): สตรีมถูกยกเลิก ไม่มีแถวกลับมา ไม่เขียน usage และ tick จบโดยไม่ล้ม", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.ai.script.translate = () => ({ pieces: ["ก", "ข", "ค", "ง"], delayMs: 300 })
    const novelId = seedNovel(t.db, { title: "Doomed", published: true })
    const first = seedChapter(t.db, novelId, 1)
    const second = seedChapter(t.db, novelId, 2)
    t.queue.enqueue([first, second], { autoPublish: false })

    const tick = t.queue.tick()
    await until(() => t.queue.state().current?.chapterId === first)
    const r = await c.delete(`${NOVELS}/${novelId}`)
    assert.equal(r.status, 200)
    assert.equal(await tick, "done")

    assert.deepEqual([...t.cancelCalls[0]!].sort((x, y) => x - y), [first, second])
    assert.equal(count(t, "novels"), 0)
    assert.equal(count(t, "chapters"), 0, "ไม่มีแถวตอนฟื้นกลับมาหลังสตรีมถูกยกเลิก")
    assert.equal(count(t, "usage"), 0)
    assert.equal(count(t, "glossary"), 0)
    assert.equal(t.queue.state().current, null)
    assert.equal(await t.queue.tick(), "idle", "คิวไม่เหลืองาน")
    assert.equal(t.ai.calls.filter((call) => call.method === "translateChunk").length, 1, "ไม่มีการแปลตอนที่สองต่อ")
  })
})

// ═════════════════════════ ให้ AI ช่วยกรอก ═════════════════════════

test("ai-fill: เรียก fillNovel ด้วยโมเดลแปลจากตั้งค่า → {titleTh, synopsis, tags} บันทึก usage ตามวัน UTC+7 และไม่เขียนนิยาย", async () => {
  const clock = createClock("2026-10-22T18:00:00Z") // 23 ต.ค. 01:00 เวลา UTC+7
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    seedNovel(t.db, { title: "Existing" })
    const novelsBefore = rowsOf(t, "novels")
    t.ai.script.fill = () => ({ titleTh: "ฤๅษีดันเจี้ยน", synopsis: "เรื่องย่อไทย", tags: ["แฟนตาซี", "ผจญภัย"], usage: { inputTokens: 321, outputTokens: 123 } })

    const r = await c.post(`${NOVELS}/ai-fill`, { title: "  Dungeon Hermit \r\n", synopsisSrc: "A hermit in a dungeon.", author: "Someone" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json, { titleTh: "ฤๅษีดันเจี้ยน", synopsis: "เรื่องย่อไทย", tags: ["แฟนตาซี", "ผจญภัย"] })
    assert.deepEqual(t.ai.calls, [{ method: "fillNovel", model: "claude-sonnet-5-5", title: "Dungeon Hermit", synopsisSrc: "A hermit in a dungeon.", author: "Someone" }])
    assert.deepEqual(t.db.all("SELECT * FROM usage"), [{ day: "2026-10-23", model: "claude-sonnet-5-5", tokens_in: 321, tokens_out: 123, calls: 1 }])
    assert.equal(rowsOf(t, "novels"), novelsBefore, "ai-fill ไม่เขียนนิยาย")

    // ครั้งที่สองบวกเพิ่มในแถวเดิม
    await c.post(`${NOVELS}/ai-fill`, { title: "Another" })
    assert.deepEqual(t.db.all("SELECT * FROM usage"), [{ day: "2026-10-23", model: "claude-sonnet-5-5", tokens_in: 642, tokens_out: 246, calls: 2 }])
  })
})

test("ai-fill: ฟิลด์ที่ไม่ส่งมาเป็นข้อความว่าง; ใช้โมเดลแปลที่ตั้งไว้ในตั้งค่า ณ ตอนเรียก (ไม่ใช่โมเดลสรุป) และ usage ลงโมเดลนั้น", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const first = await c.post(`${NOVELS}/ai-fill`, { title: "Only Title" })
    assert.equal(first.status, 200)
    assert.deepEqual(t.ai.calls[0], { method: "fillNovel", model: "claude-sonnet-5-5", title: "Only Title", synopsisSrc: "", author: "" })

    t.settings.update({ translateModel: "claude-custom-9", recapModel: "claude-recap-1" })
    await c.post(`${NOVELS}/ai-fill`, { title: "Second" })
    assert.equal((t.ai.calls[1] as { model: string }).model, "claude-custom-9")
    assert.deepEqual(t.db.all<{ model: string; calls: number }>("SELECT model, calls FROM usage ORDER BY model"), [
      { model: "claude-custom-9", calls: 1 },
      { model: "claude-sonnet-5-5", calls: 1 },
    ])
  })
})

test("ai-fill: ไม่มี ANTHROPIC_API_KEY → 400 no_api_key ข้อความไทยที่บอกชื่อตัวแปร และไม่เรียก AI ไม่เขียน usage", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.ai.script.hasKey = false
    const r = await c.post(`${NOVELS}/ai-fill`, { title: "Dungeon Hermit" })
    assert.equal(r.status, 400)
    assert.equal(r.json.code, "no_api_key")
    assert.match(r.json.error, THAI)
    assert.ok(r.json.error.includes("ANTHROPIC_API_KEY"))
    assert.deepEqual(t.ai.calls, [])
    assert.equal(count(t, "usage"), 0)
  })
})

test("ai-fill: ข้อมูลที่ส่งมาไม่ถูกต้อง → 400 invalid_field และไม่เรียก AI", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const bad: [string, Record<string, unknown>, string][] = [
      ["ไม่มี title", {}, "(title)"],
      ["title ว่าง", { title: "  " }, "(title)"],
      ["title 301 ตัว", { title: "x".repeat(301) }, "(title)"],
      ["synopsisSrc ไม่ใช่ข้อความ", { title: "T", synopsisSrc: 5 }, "(synopsisSrc)"],
      ["synopsisSrc 10001 ตัว", { title: "T", synopsisSrc: "a".repeat(10_001) }, "(synopsisSrc)"],
      ["author เป็น null", { title: "T", author: null }, "(author)"],
      ["author 201 ตัว", { title: "T", author: "a".repeat(201) }, "(author)"],
    ]
    for (const [name, body, mention] of bad) {
      const r = await c.post(`${NOVELS}/ai-fill`, body)
      assert.equal(r.status, 400, name)
      assert.equal(r.json.code, "invalid_field", name)
      assert.ok(r.json.error.includes(mention), `${name}: "${r.json.error}"`)
    }
    const arr = await c.post(`${NOVELS}/ai-fill`, [])
    assert.equal(arr.status, 400)
    assert.equal(arr.json.code, "bad_request")
    assert.deepEqual(t.ai.calls, [])
    assert.equal(count(t, "usage"), 0)

    // เรื่องย่อยาว 10000 พอดีผ่าน
    const ok = await c.post(`${NOVELS}/ai-fill`, { title: "T", synopsisSrc: "a".repeat(10_000) })
    assert.equal(ok.status, 200)
  })
})

test("ai-fill: Claude ตอบผิดพลาด (AiError ทั้งแบบชั่วคราวและแบบร้ายแรง) → 502 ai_error พร้อมข้อความไทยของ AiError และไม่บันทึก usage", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const errors = [
      new AiError("Claude API ไม่ว่างหรือถูกจำกัดอัตราชั่วคราว (HTTP 429)", { fatal: false, status: 429 }),
      new AiError("API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)", { fatal: true, status: 401 }),
    ]
    for (const err of errors) {
      t.ai.script.fill = () => {
        throw err
      }
      const r = await c.post(`${NOVELS}/ai-fill`, { title: "T" })
      assert.equal(r.status, 502, err.message)
      assert.equal(r.json.code, "ai_error")
      assert.equal(r.json.error, err.message)
    }
    assert.equal(count(t, "usage"), 0)
  })
})

test("ai-fill: ข้อผิดพลาดที่ไม่ใช่ของ Claude (บั๊กภายใน) → 500 ข้อความทั่วไปไม่รั่วรายละเอียด และมี error ใน log", async () => {
  await withTestApp({ expectErrorLogs: true }, async (t) => {
    const c = await adminClient(t)
    t.ai.script.fill = () => {
      throw new Error("secret internal boom")
    }
    const r = await c.post(`${NOVELS}/ai-fill`, { title: "T" })
    assert.equal(r.status, 500)
    assert.equal(r.json.code, "internal_error")
    assert.ok(!r.text.includes("secret internal boom"))
    assert.ok(t.logs.some((line) => line.startsWith("error:") && line.includes("secret internal boom")))
  })
})

test("ai-fill: บันทึก usage ไม่สำเร็จ → ยังส่งผลที่ได้มาให้ผู้ดูแล (ไม่ทิ้งงานที่เสียเงินไปแล้ว) พร้อมเตือนใน log", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.db.exec("DROP TABLE usage")
    t.ai.script.fill = () => ({ titleTh: "ชื่อ", synopsis: "ย่อ", tags: ["ก"] })
    const r = await c.post(`${NOVELS}/ai-fill`, { title: "T" })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { titleTh: "ชื่อ", synopsis: "ย่อ", tags: ["ก"] })
    assert.ok(t.logs.some((line) => line.startsWith("warn:") && line.includes("usage")), t.logs.join("\n"))
  })
})

test("ai-fill ไม่ถูกจับเป็นรหัสเรื่อง: POST /novels/ai-fill ทำงาน แต่ GET /novels/ai-fill → 404", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    assert.equal((await c.post(`${NOVELS}/ai-fill`, { title: "T" })).status, 200)
    assert.equal((await c.get(`${NOVELS}/ai-fill`)).status, 404)
  })
})

// ═════════════════════════ DTO (ฟังก์ชันล้วน) ═════════════════════════

const ROW: AdminNovelRow = {
  id: 7,
  title: "T",
  title_th: "ชื่อ",
  author: "A",
  synopsis: "S",
  synopsis_src: "SS",
  tags: '["x","y"]',
  status: "completed",
  source_url: "https://e.com",
  license_note: "L",
  style_note: "N",
  mode: "story",
  published: 1,
  featured: 1,
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-02 00:00:00",
  cover_updated_at: "2026-10-22 01:02:03",
  chapter_count: 5,
  translated_count: 3,
  published_count: 2,
}

test("toAdminNovelDto: แปลงทุกฟิลด์เป็น camelCase, 0/1 เป็นบูลีน, tags เป็นอาร์เรย์, มีปกจาก cover_updated_at; ไม่มีฟิลด์เกิน", () => {
  assert.deepEqual(toAdminNovelDto(ROW), {
    id: 7,
    title: "T",
    titleTh: "ชื่อ",
    author: "A",
    synopsis: "S",
    synopsisSrc: "SS",
    tags: ["x", "y"],
    status: "completed",
    sourceUrl: "https://e.com",
    licenseNote: "L",
    styleNote: "N",
    mode: "story",
    published: true,
    featured: true,
    hasCover: true,
    coverV: epoch("2026-10-22T01:02:03Z"),
    chapterCount: 5,
    translatedCount: 3,
    publishedCount: 2,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-02 00:00:00",
  })
  const off = toAdminNovelDto({ ...ROW, published: 0, featured: 0, status: "ongoing", mode: "translate", cover_updated_at: null, tags: "[]" })
  assert.equal(off.published, false)
  assert.equal(off.featured, false)
  assert.equal(off.hasCover, false)
  assert.equal(off.coverV, 0)
  assert.deepEqual(off.tags, [])
  // ธงทั้งสองเป็นอิสระต่อกัน
  assert.deepEqual([toAdminNovelDto({ ...ROW, published: 1, featured: 0 }).published, toAdminNovelDto({ ...ROW, published: 1, featured: 0 }).featured], [true, false])
  assert.deepEqual([toAdminNovelDto({ ...ROW, published: 0, featured: 1 }).published, toAdminNovelDto({ ...ROW, published: 0, featured: 1 }).featured], [false, true])
})

test("parseTags: JSON array ของข้อความ → ตามนั้น; ข้อมูลเสียรูป (JSON พัง, ไม่ใช่อาร์เรย์, ว่าง) → []; สมาชิกที่ไม่ใช่ข้อความถูกทิ้ง", () => {
  assert.deepEqual(parseTags('["a","ข"]'), ["a", "ข"])
  assert.deepEqual(parseTags("[]"), [])
  for (const raw of ["", "not json", "{", '{"a":1}', '"x"', "5", "null", "true"]) assert.deepEqual(parseTags(raw), [], raw)
  assert.deepEqual(parseTags('["a",1,null,{"x":1},["b"],"c",true]'), ["a", "c"])
})

test("coverVersion: เวลาแก้ปก (UTC) เป็นวินาที epoch; ไม่มีปก/ค่าเสีย → 0", () => {
  assert.equal(coverVersion("2026-10-22 01:02:03"), epoch("2026-10-22T01:02:03Z"))
  assert.equal(coverVersion("1970-01-01 00:00:00"), 0)
  assert.equal(coverVersion("1970-01-01 00:00:01"), 1)
  assert.equal(coverVersion("1970-01-02 00:00:00"), 86_400)
  assert.equal(coverVersion(null), 0)
  for (const bad of ["", "garbage", "2026-13-45 99:99:99", "2026-10-22"]) assert.equal(coverVersion(bad), 0, bad)
})
