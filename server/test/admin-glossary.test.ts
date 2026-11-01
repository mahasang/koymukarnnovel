import { test } from "node:test"
import assert from "node:assert/strict"
import type { GlossaryRow } from "../src/types.js"
import { withTestApp, type Client, type TestApp } from "./helpers/app.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"

const THAI = /[\u0E00-\u0E7F]/
const API = "/api/admin"
const listPath = (novelId: number | string, query = "") => `${API}/novels/${novelId}/glossary${query}`
const termPath = (id: number | string) => `${API}/glossary/${id}`
type T = TestApp<FakeAi>
type Method = "get" | "post" | "put" | "patch" | "delete"

/** คีย์ทั้งหมดของหนึ่งคำศัพท์ในคำตอบ เรียงตามตัวอักษร */
const TERM_KEYS = ["auto", "id", "note", "source", "thai"]

const NOVEL_404 = "ไม่พบนิยายเรื่องนี้"
const TERM_404 = "ไม่พบคำศัพท์ที่ระบุ"

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

const send = (c: Client, method: Method, path: string, body?: unknown) => (method === "get" ? c.get(path) : c[method](path, body))
const snapshot = (t: T): string => JSON.stringify([t.db.all("SELECT * FROM glossary ORDER BY id"), t.db.all("SELECT * FROM novels ORDER BY id")])
const count = (t: T, where = "1"): number => t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM glossary WHERE ${where}`)!.n
const termsOf = (t: T, novelId: number): GlossaryRow[] => t.db.all<GlossaryRow>("SELECT * FROM glossary WHERE novel_id = ? ORDER BY id", novelId)
const termRow = (t: T, id: number): GlossaryRow => t.db.get<GlossaryRow>("SELECT * FROM glossary WHERE id = ?", id)!
const idOf = (t: T, novelId: number, source: string): number =>
  t.db.get<{ id: number }>("SELECT id FROM glossary WHERE novel_id = ? AND source = ?", novelId, source)!.id
const longText = (n: number): string => "a".repeat(n)

// ═════════════════════════ ต้องล็อกอิน ═════════════════════════

test("ทุกเส้นทางของอภิธานศัพท์ต้องล็อกอิน: ไม่มี cookie → 401 และไม่มีผลข้างเคียง", async () => {
  await withTestApp({}, async (t) => {
    const novel = seedNovel(t.db)
    seedGlossary(t.db, novel, [{ source: "Mana", thai: "มานา", auto: true }])
    const term = idOf(t, novel, "Mana")
    const before = snapshot(t)
    const stranger = t.client()

    const routes: [Method, string, unknown?][] = [
      ["get", listPath(novel)],
      ["get", listPath(novel, "?auto=1")],
      ["post", listPath(novel), { source: "Kai", thai: "ไค" }],
      ["patch", termPath(term), { thai: "Hacked" }],
      ["delete", termPath(term)],
    ]
    for (const [method, path, body] of routes) {
      const r = await send(stranger, method, path, body)
      assert.equal(r.status, 401, `${method.toUpperCase()} ${path}`)
      assert.equal(r.json.code, "unauthorized")
    }
    assert.equal(snapshot(t), before)
  })
})

test("คำตอบของอภิธานศัพท์เป็น JSON และห้าม cache (Cache-Control: no-store)", async () => {
  await withTestApp({}, async (t) => {
    const novel = seedNovel(t.db)
    const c = await adminClient(t)
    const responses = [await c.get(listPath(novel)), await c.get(listPath(999)), await c.post(listPath(novel), { source: "A", thai: "เอ" })]
    assert.deepEqual(responses.map((r) => r.status), [200, 404, 201])
    for (const r of responses) {
      assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
      assert.equal(r.headers.get("cache-control"), "no-store")
    }
  })
})

// ═════════════════════════ รายการ ═════════════════════════

test("GET /novels/:id/glossary: คีย์ครบ (auto เป็น boolean) · เรียงตามคำต้นฉบับแบบไม่สนตัวพิมพ์ แล้วตามรหัส · เฉพาะของเรื่องนั้น", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    const empty = seedNovel(t.db, { title: "Empty" })
    // ตัวพิมพ์ใหญ่ตามหลังตัวพิมพ์เล็กได้ (ถ้าเรียงแบบไบนารี "Zed" จะมาก่อน "alpha") · "mana" กับ "Mana" เท่ากันเมื่อไม่สนตัวพิมพ์ → ตามรหัส
    seedGlossary(t.db, a, [
      { source: "Zed", thai: "เซด" },
      { source: "alpha", thai: "อัลฟา", note: "ตัวละครหลัก" },
      { source: "mana", thai: "มานา", auto: true },
      { source: "Beta", thai: "เบตา" },
      { source: "Mana", thai: "มานา (ใหญ่)" },
    ])
    seedGlossary(t.db, b, [{ source: "OtherNovel", thai: "เรื่องอื่น" }])
    const c = await adminClient(t)

    const r = await c.get(listPath(a))
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.map((x: { source: string }) => x.source), ["alpha", "Beta", "mana", "Mana", "Zed"])
    for (const x of r.json) assert.deepEqual(Object.keys(x).sort(), TERM_KEYS)
    assert.deepEqual(r.json[0], { id: idOf(t, a, "alpha"), source: "alpha", thai: "อัลฟา", note: "ตัวละครหลัก", auto: false })
    assert.deepEqual(r.json[2], { id: idOf(t, a, "mana"), source: "mana", thai: "มานา", note: "", auto: true })

    assert.deepEqual((await c.get(listPath(b))).json.map((x: { source: string }) => x.source), ["OtherNovel"])
    const none = await c.get(listPath(empty))
    assert.equal(none.status, 200)
    assert.deepEqual(none.json, [])
  })
})

test("GET /novels/:id/glossary?auto=1 กรองเฉพาะคำที่ AI เพิ่ม · ค่าอื่นของ auto → 400 (ไม่เงียบๆ แสดงทั้งหมดแทน)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [
      { source: "mana", thai: "มานา", auto: true },
      { source: "Aether", thai: "อีเธอร์" },
      { source: "Kai", thai: "ไค", auto: true },
    ])
    const c = await adminClient(t)

    const only = await c.get(listPath(n, "?auto=1"))
    assert.equal(only.status, 200)
    assert.deepEqual(only.json.map((x: { source: string }) => x.source), ["Kai", "mana"])
    assert.ok(only.json.every((x: { auto: boolean }) => x.auto === true))
    assert.equal((await c.get(listPath(n))).json.length, 3, "ไม่ส่ง auto = ทั้งหมด")

    for (const bad of ["?auto=0", "?auto=true", "?auto=", "?auto=1&auto=1", "?auto=%201", "?auto=2"]) {
      const r = await c.get(listPath(n, bad))
      assert.equal(r.status, 400, bad)
      assert.equal(r.json.code, "invalid_field", bad)
      assert.match(r.json.error, /auto/, bad)
      assert.match(r.json.error, THAI, bad)
    }
    // เรื่องที่ไม่มีมาก่อนการตรวจ query
    assert.equal((await c.get(listPath(999, "?auto=zzz"))).status, 404)
  })
})

test("รายการ/สร้างคำศัพท์ในเรื่องที่ไม่มีหรือรหัสผิดรูปแบบ → 404 ไทย (ตรวจก่อน body) ไม่สร้างอะไร", async () => {
  await withTestApp({}, async (t) => {
    seedNovel(t.db)
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const bad of ["999", "0", "-1", "abc", "1.5", "01", "1e2"]) {
      const list = await c.get(listPath(bad))
      assert.equal(list.status, 404, bad)
      assert.equal(list.json.code, "not_found")
      assert.equal(list.json.error, NOVEL_404)
      for (const body of [{ source: "A", thai: "เอ" }, { source: 5 }, {}, [], undefined]) {
        const r = await c.post(listPath(bad), body)
        assert.equal(r.status, 404, `${bad} ${JSON.stringify(body)}`)
        assert.equal(r.json.error, NOVEL_404)
      }
    }
    assert.equal(snapshot(t), before)
  })
})

// ═════════════════════════ เพิ่ม ═════════════════════════

test("POST /novels/:id/glossary → 201 คืนคำศัพท์ที่สร้าง (auto=false) · หมายเหตุไม่ส่ง = ว่าง · ค่าที่เก็บผ่านการล้างข้อความ · ฟิลด์เกินถูกเมิน", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    const c = await adminClient(t)

    const plain = await c.post(listPath(n), { source: "Mana", thai: "มานา" })
    assert.equal(plain.status, 201, plain.text)
    assert.deepEqual(Object.keys(plain.json).sort(), TERM_KEYS)
    assert.deepEqual(plain.json, { id: idOf(t, n, "Mana"), source: "Mana", thai: "มานา", note: "", auto: false })
    assert.deepEqual(
      (({ novel_id, source, thai, note, auto }) => ({ novel_id, source, thai, note, auto }))(termRow(t, plain.json.id)),
      { novel_id: n, source: "Mana", thai: "มานา", note: "", auto: 0 },
    )

    const messy = await c.post(listPath(n), {
      source: "﻿Mana Core\r\n",
      thai: " มานา​คอร์ ",
      note: "  หมายเหตุ\r\n\r\n\r\nบรรทัดสอง  ",
      auto: true, // ผู้ดูแลเพิ่มเองเสมอ ห้ามอ้างว่า AI เพิ่ม
      novelId: other,
      id: 424242,
    })
    assert.equal(messy.status, 201, messy.text)
    const row = termRow(t, messy.json.id)
    assert.deepEqual([row.source, row.thai, row.note, row.auto, row.novel_id], ["Mana Core", "มานาคอร์", "หมายเหตุ\n\nบรรทัดสอง", 0, n])
    assert.notEqual(row.id, 424242)
    assert.equal(count(t, `novel_id = ${other}`), 0)
  })
})

const BAD_CREATE: [string, unknown, RegExp][] = [
  ["ไม่มี source", { thai: "ก" }, /source/],
  ["ไม่มี thai", { source: "A" }, /thai/],
  ["source ไม่ใช่ข้อความ", { source: 5, thai: "ก" }, /source/],
  ["source เป็น null", { source: null, thai: "ก" }, /source/],
  ["thai ไม่ใช่ข้อความ", { source: "A", thai: 5 }, /thai/],
  ["thai เป็น null", { source: "A", thai: null }, /thai/],
  ["source ว่าง", { source: "", thai: "ก" }, /source/],
  ["source เหลือว่างหลังล้างช่องว่างและอักขระล่องหน", { source: " \r\n ﻿​\t ", thai: "ก" }, /source/],
  ["thai ว่าง", { source: "A", thai: "" }, /thai/],
  ["thai เหลือว่างหลังล้าง", { source: "A", thai: "   " }, /thai/],
  ["source ยาว 201", { source: longText(201), thai: "ก" }, /source.*200/],
  ["thai ยาว 201", { source: "A", thai: "ก".repeat(201) }, /thai.*200/],
  ["note ยาว 301", { source: "A", thai: "ก", note: longText(301) }, /note.*300/],
  ["note ไม่ใช่ข้อความ", { source: "A", thai: "ก", note: 5 }, /note/],
  ["note เป็น null", { source: "A", thai: "ก", note: null }, /note/],
]

test("เพิ่มคำศัพท์ด้วยข้อมูลผิด → 400 invalid_field ข้อความไทยบอกชื่อฟิลด์ ไม่สร้างอะไร · ขอบ 200/200/300 ผ่านได้", async () => {
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
      assert.equal(snapshot(t), before, label)
    }

    const edge = await c.post(listPath(n), { source: longText(200), thai: "ก".repeat(200), note: "ข".repeat(300) })
    assert.equal(edge.status, 201, edge.text)
    assert.deepEqual([edge.json.source.length, edge.json.thai.length, edge.json.note.length], [200, 200, 300])
  })
})

test("body ที่ไม่ใช่ออบเจ็กต์ → 400 (อาร์เรย์/ไม่ส่ง = bad_request, ข้อความ/ตัวเลข/null = bad_json จากตัวอ่าน JSON)", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const id = (seedGlossary(t.db, n, [{ source: "Keep", thai: "เก็บ" }]), idOf(t, n, "Keep"))
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const [body, code] of [[undefined, "bad_request"], [[], "bad_request"], ["x", "bad_json"], [5, "bad_json"], [null, "bad_json"]] as const) {
      for (const [label, path, send] of [
        ["POST", listPath(n), (p: string) => c.post(p, body)],
        ["PATCH", termPath(id), (p: string) => c.patch(p, body)],
      ] as const) {
        const r = await send(path)
        assert.equal(r.status, 400, `${label} ${JSON.stringify(body)}`)
        assert.equal(r.json.code, code, `${label} ${JSON.stringify(body)}`)
        assert.match(r.json.error, THAI)
      }
    }
    assert.equal(snapshot(t), before)
  })
})

test("คำต้นฉบับซ้ำในเรื่องเดียวกัน (รวมคำที่ AI เพิ่ม) → 409 code duplicate ไม่สร้างอะไร · เรื่องอื่น/ตัวพิมพ์ต่างกันถือเป็นคนละคำ · ซ้ำหลังล้างช่องว่างก็ซ้ำ", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา" }, { source: "Kai", thai: "ไค", auto: true }])
    const before = snapshot(t)
    const c = await adminClient(t)

    for (const source of ["Mana", "Kai", "  Mana ", "﻿Kai\r\n"]) {
      const r = await c.post(listPath(n), { source, thai: "ซ้ำ" })
      assert.equal(r.status, 409, source)
      assert.equal(r.json.code, "duplicate")
      assert.match(r.json.error, THAI)
      assert.match(r.json.error, /Mana|Kai/)
      assert.equal(snapshot(t), before)
    }

    assert.equal((await c.post(listPath(other), { source: "Mana", thai: "มานา" })).status, 201, "เรื่องอื่น")
    assert.equal((await c.post(listPath(n), { source: "mana", thai: "มานา (เล็ก)" })).status, 201, "ตัวพิมพ์ต่างกัน")
    assert.equal(count(t, `novel_id = ${n}`), 3)
  })
})

// ═════════════════════════ แก้ ═════════════════════════

test("PATCH แก้ source/thai/note: เก็บค่าที่ล้างแล้ว แก้เฉพาะฟิลด์ที่ส่งมา คืนคำศัพท์ที่แก้แล้ว · note ว่างล้างหมายเหตุ · ฟิลด์เกินถูกเมิน", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา", note: "เดิม" }, { source: "Other", thai: "อื่น" }])
    const id = idOf(t, n, "Mana")
    const other = idOf(t, n, "Other")
    const c = await adminClient(t)

    const thaiOnly = await c.patch(termPath(id), { thai: "﻿มานา ใหม่\r\n" })
    assert.equal(thaiOnly.status, 200, thaiOnly.text)
    assert.deepEqual(Object.keys(thaiOnly.json).sort(), TERM_KEYS)
    assert.deepEqual(thaiOnly.json, { id, source: "Mana", thai: "มานา ใหม่", note: "เดิม", auto: false })

    const noteOnly = await c.patch(termPath(id), { note: "  โน้ตใหม่\r\n\r\n\r\nสอง  " })
    assert.deepEqual(noteOnly.json, { id, source: "Mana", thai: "มานา ใหม่", note: "โน้ตใหม่\n\nสอง", auto: false })

    const sourceOnly = await c.patch(termPath(id), { source: " Mana Core " })
    assert.deepEqual(sourceOnly.json, { id, source: "Mana Core", thai: "มานา ใหม่", note: "โน้ตใหม่\n\nสอง", auto: false })

    const cleared = await c.patch(termPath(id), { note: "" })
    assert.equal(cleared.json.note, "")

    const all = await c.patch(termPath(id), { source: "Mana3", thai: "มานา3", note: "n3", auto: true, novelId: 99, id: 777 })
    assert.deepEqual(all.json, { id, source: "Mana3", thai: "มานา3", note: "n3", auto: false })
    assert.equal(termRow(t, id).novel_id, n)
    assert.deepEqual(termRow(t, other), { id: other, novel_id: n, source: "Other", thai: "อื่น", note: "", auto: 0 }, "แถวอื่นไม่ถูกแตะ")
  })
})

test("แก้ source/thai/note ของคำที่ AI เพิ่ม → auto เป็น 0 (เจ้าของยืนยันแล้ว) แม้ค่าเท่าเดิม · PATCH {} และฟิลด์ที่ไม่ใช่ของ PATCH ไม่ทำให้ auto เปลี่ยน", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [
      { source: "a-thai", thai: "ไทย", auto: true },
      { source: "b-note", thai: "ไทย", auto: true },
      { source: "c-source", thai: "ไทย", auto: true },
      { source: "d-same", thai: "ไทย", auto: true },
      { source: "e-empty", thai: "ไทย", auto: true },
    ])
    const ids = ["a-thai", "b-note", "c-source", "d-same", "e-empty"].map((s) => idOf(t, n, s))
    const c = await adminClient(t)
    const autoOf = (id: number) => termRow(t, id).auto

    assert.deepEqual(ids.map(autoOf), [1, 1, 1, 1, 1])
    const empty = await c.patch(termPath(ids[4]!), {})
    assert.equal(empty.status, 200)
    assert.equal(empty.json.auto, true)
    const ignored = await c.patch(termPath(ids[4]!), { auto: false, novelId: 5, unknown: "x" })
    assert.equal(ignored.status, 200)
    assert.equal(ignored.json.auto, true)
    assert.equal(autoOf(ids[4]!), 1)

    assert.equal((await c.patch(termPath(ids[0]!), { thai: "ไทยใหม่" })).json.auto, false)
    assert.equal((await c.patch(termPath(ids[1]!), { note: "โน้ต" })).json.auto, false)
    assert.equal((await c.patch(termPath(ids[2]!), { source: "c-source-2" })).json.auto, false)
    assert.equal((await c.patch(termPath(ids[3]!), { thai: "ไทย" })).json.auto, false, "บันทึกค่าเดิม = ยืนยันแล้วเช่นกัน")
    assert.deepEqual(ids.map(autoOf), [0, 0, 0, 0, 1])
  })
})

test("PATCH เปลี่ยน source ไปซ้ำกับคำอื่นของเรื่องเดียวกัน → 409 duplicate ไม่แก้อะไรเลย (รวมฟิลด์อื่นในคำขอเดียวกัน, ไม่ล้าง auto) · ใช้ source เดิมของตัวเอง/ของเรื่องอื่นได้", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา", auto: true }, { source: "Kai", thai: "ไค" }])
    seedGlossary(t.db, other, [{ source: "Rin", thai: "ริน" }])
    const mana = idOf(t, n, "Mana")
    const c = await adminClient(t)
    const before = snapshot(t)

    for (const source of ["Kai", " Kai "]) {
      const r = await c.patch(termPath(mana), { source, thai: "ควรไม่ถูกแก้", note: "ไม่ควรถูกแก้" })
      assert.equal(r.status, 409, source)
      assert.equal(r.json.code, "duplicate")
      assert.match(r.json.error, THAI)
      assert.equal(snapshot(t), before)
    }

    const self = await c.patch(termPath(mana), { source: "Mana", thai: "มานาใหม่" })
    assert.equal(self.status, 200, self.text)
    assert.deepEqual([self.json.source, self.json.thai, self.json.auto], ["Mana", "มานาใหม่", false])
    assert.equal((await c.patch(termPath(mana), { source: "Rin" })).status, 200, "ซ้ำกับเรื่องอื่นได้")
    assert.equal(termRow(t, mana).source, "Rin")
  })
})

const BAD_PATCH: [string, Record<string, unknown>, RegExp][] = [
  ["source ว่าง", { source: "" }, /source/],
  ["source เหลือว่างหลังล้าง", { source: "  ﻿ " }, /source/],
  ["source ไม่ใช่ข้อความ", { source: 5 }, /source/],
  ["source เป็น null", { source: null }, /source/],
  ["source ยาว 201", { source: longText(201) }, /source.*200/],
  ["thai ว่าง (ห้ามล้างคำไทย)", { thai: "" }, /thai/],
  ["thai ไม่ใช่ข้อความ", { thai: 5 }, /thai/],
  ["thai เป็น null", { thai: null }, /thai/],
  ["thai ยาว 201", { thai: "ก".repeat(201) }, /thai.*200/],
  ["note ไม่ใช่ข้อความ", { note: 5 }, /note/],
  ["note เป็น null", { note: null }, /note/],
  ["note ยาว 301", { note: longText(301) }, /note.*300/],
]

test("PATCH ด้วยข้อมูลผิด → 400 invalid_field ข้อความไทยบอกชื่อฟิลด์ แถวไม่เปลี่ยน · ผิดข้อเดียว = ไม่แก้อะไรเลย (แม้ฟิลด์อื่นในคำขอเดียวกันถูกต้อง) · ขอบ 200/200/300 ผ่านได้", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา", note: "เดิม", auto: true }])
    const id = idOf(t, n, "Mana")
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const [label, body, field] of BAD_PATCH) {
      for (const withGoodField of [false, true]) {
        const r = await c.patch(termPath(id), withGoodField ? { note: "ถูกต้อง", thai: "ถูกต้อง", ...body } : body)
        assert.equal(r.status, 400, `${label}: ${r.text}`)
        assert.equal(r.json.code, "invalid_field", label)
        assert.match(r.json.error, THAI, label)
        assert.match(r.json.error, field, label)
        assert.equal(snapshot(t), before, label)
      }
    }

    const edge = await c.patch(termPath(id), { source: longText(200), thai: "ก".repeat(200), note: "ข".repeat(300) })
    assert.equal(edge.status, 200, edge.text.slice(0, 100))
    assert.deepEqual([edge.json.source.length, edge.json.thai.length, edge.json.note.length], [200, 200, 300])
  })
})

test("PATCH/DELETE คำศัพท์ที่ไม่มีหรือรหัสผิดรูปแบบ → 404 ไทย (404 มาก่อน 400 ของ body) ไม่มีผลข้างเคียง", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา" }])
    const before = snapshot(t)
    const c = await adminClient(t)
    for (const bad of ["999", "0", "-1", "abc", "1.5", "01", "1e2"]) {
      for (const [method, body] of [["patch", { thai: "ok" }], ["patch", { thai: 5 }], ["patch", undefined], ["delete", undefined]] as [Method, unknown][]) {
        const r = await send(c, method, termPath(bad), body)
        assert.equal(r.status, 404, `${method} ${bad} ${JSON.stringify(body)}`)
        assert.equal(r.json.code, "not_found")
        assert.equal(r.json.error, TERM_404)
      }
    }
    assert.equal(snapshot(t), before)
  })
})

// ═════════════════════════ ลบ ═════════════════════════

test("DELETE /glossary/:id ลบคำนั้นคำเดียว (คำอื่น เรื่องอื่น เรื่องนั้นเองอยู่ครบ) · ลบซ้ำ → 404", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    const other = seedNovel(t.db, { title: "Other" })
    seedGlossary(t.db, n, [{ source: "Mana", thai: "มานา", auto: true }, { source: "Kai", thai: "ไค" }])
    seedGlossary(t.db, other, [{ source: "Mana", thai: "มานา" }])
    const mana = idOf(t, n, "Mana")
    const c = await adminClient(t)

    const r = await c.delete(termPath(mana))
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true })
    assert.deepEqual(termsOf(t, n).map((x) => x.source), ["Kai"])
    assert.deepEqual(termsOf(t, other).map((x) => x.source), ["Mana"])
    assert.equal(count(t), 2)
    assert.equal(t.db.get("SELECT id FROM novels WHERE id = ?", n) !== undefined, true)

    const again = await c.delete(termPath(mana))
    assert.equal(again.status, 404)
    assert.equal(again.json.error, TERM_404)
    // ลบแล้วเพิ่มคำเดิมได้ใหม่
    assert.equal((await c.post(listPath(n), { source: "Mana", thai: "มานาใหม่" })).status, 201)
  })
})

// ═════════════════════════ ต่อกับระบบแปลจริง ═════════════════════════

test("คำที่ผู้ดูแลเพิ่ม/แก้ถูกส่งเข้า prompt ของการแปลครั้งถัดไป และคำที่ AI เสนอภายหลังไม่ทับคำที่ผู้ดูแลแก้ไว้", async () => {
  await withTestApp({}, async (t) => {
    const n = seedNovel(t.db)
    seedGlossary(t.db, n, [{ source: "Kai", thai: "ไค", auto: true }])
    const ch = seedChapter(t.db, n, 1, { source: "Mana met Kai." })
    const c = await adminClient(t)

    assert.equal((await c.post(listPath(n), { source: "Mana", thai: "มานา", note: "ตัวเอก" })).status, 201)
    assert.equal((await c.patch(termPath(idOf(t, n, "Kai")), { thai: "ไค (แก้แล้ว)" })).status, 200)

    // AI เสนอคำที่มีอยู่แล้วทั้งสองคำด้วยคำไทยอื่น + คำใหม่หนึ่งคำ
    t.ai.script.notes = () => ({
      terms: [
        { source: "Mana", thai: "มะนะ" },
        { source: "Kai", thai: "ไคซ์" },
        { source: "Rin", thai: "ริน" },
      ],
    })
    t.queue.enqueue([ch], { autoPublish: false })
    assert.equal(await t.queue.tick(), "done")

    const sent = t.ai.calls.find((call) => call.method === "translateChunk")
    assert.ok(sent && sent.method === "translateChunk")
    assert.match(sent.system, /- Mana → มานา \(ตัวเอก\)/)
    assert.match(sent.system, /- Kai → ไค \(แก้แล้ว\)/)
    const notes = t.ai.calls.find((call) => call.method === "chapterNotes")
    assert.ok(notes && notes.method === "chapterNotes")
    assert.deepEqual([...(notes.knownTerms ?? [])].sort(), ["Kai", "Mana"])

    const after = new Map(termsOf(t, n).map((x) => [x.source, x]))
    assert.deepEqual([after.get("Mana")!.thai, after.get("Mana")!.auto], ["มานา", 0])
    assert.deepEqual([after.get("Kai")!.thai, after.get("Kai")!.auto], ["ไค (แก้แล้ว)", 0])
    assert.deepEqual([after.get("Rin")!.thai, after.get("Rin")!.auto], ["ริน", 1])
    const aiOnly = await c.get(listPath(n, "?auto=1"))
    assert.deepEqual(aiOnly.json.map((x: { source: string }) => x.source), ["Rin"])
  })
})

test("ลบเรื่อง → อภิธานของเรื่องนั้นหายไปด้วย แต่ของเรื่องอื่นอยู่ (ผ่านเส้นทางลบเรื่อง)", async () => {
  await withTestApp({}, async (t) => {
    const a = seedNovel(t.db, { title: "A" })
    const b = seedNovel(t.db, { title: "B" })
    seedGlossary(t.db, a, [{ source: "X", thai: "เอ็กซ์" }])
    seedGlossary(t.db, b, [{ source: "Y", thai: "วาย" }])
    const c = await adminClient(t)
    assert.equal((await c.delete(`${API}/novels/${a}`)).status, 200)
    assert.equal(count(t, `novel_id = ${a}`), 0)
    assert.equal(count(t, `novel_id = ${b}`), 1)
    assert.equal((await c.get(listPath(a))).status, 404)
  })
})
