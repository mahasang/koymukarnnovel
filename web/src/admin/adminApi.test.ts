import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { ApiError } from "../lib/api"
import { installFetch, jsonResponse, restoreGlobals } from "../testing/helpers"
import { admin } from "./adminApi"

/** ตัวเรียก API หลังบ้าน: ทุกฟังก์ชันชี้เส้นทาง/เมธอด/body ตรงกับเซิร์ฟเวอร์ (Task 12–15) และคืนของที่เซิร์ฟเวอร์ตอบตามชนิด */

afterEach(restoreGlobals)

interface Case {
  name: keyof typeof admin
  call: () => Promise<unknown>
  method: string
  url: string
  /** body ที่ต้องส่ง (undefined = ไม่ส่ง body เลย) */
  body?: unknown
  /** สิ่งที่เซิร์ฟเวอร์ตอบ */
  reply: unknown
  /** สิ่งที่ฟังก์ชันคืน (ค่าเริ่มต้น = ที่เซิร์ฟเวอร์ตอบ; `void` = คืน undefined แม้เซิร์ฟเวอร์ตอบ {ok:true}) */
  returns?: unknown
}

const OK = { ok: true }
const NOVEL = { id: 7, title: "A" }
const CHAPTER = { id: 70, number: 3 }
const TERM = { id: 5, source: "Kael", thai: "เคล", note: "", auto: false }
const SETTINGS = { siteName: "x", apiKeySet: true }

const cases: Case[] = [
  { name: "me", call: () => admin.me(), method: "GET", url: "/api/admin/me", reply: { admin: true, passwordless: false } },
  { name: "login", call: () => admin.login("ลับ pass"), method: "POST", url: "/api/admin/login", body: { password: "ลับ pass" }, reply: { admin: true, passwordless: false }, returns: undefined },
  { name: "logout", call: () => admin.logout(), method: "POST", url: "/api/admin/logout", reply: OK, returns: undefined },
  { name: "dashboard", call: () => admin.dashboard(), method: "GET", url: "/api/admin/dashboard", reply: { counts: {} } },
  { name: "queue", call: () => admin.queue(), method: "GET", url: "/api/admin/queue", reply: { paused: false, errors: [] } },
  { name: "pause", call: () => admin.pause("พักก่อน"), method: "POST", url: "/api/admin/queue/pause", body: { reason: "พักก่อน" }, reply: { paused: true }, returns: undefined },
  { name: "resume", call: () => admin.resume(), method: "POST", url: "/api/admin/queue/resume", reply: { paused: false }, returns: undefined },
  { name: "novels", call: () => admin.novels(), method: "GET", url: "/api/admin/novels", reply: [NOVEL] },
  { name: "novel", call: () => admin.novel(7), method: "GET", url: "/api/admin/novels/7", reply: NOVEL },
  { name: "createNovel", call: () => admin.createNovel({ title: "A", mode: "story" }), method: "POST", url: "/api/admin/novels", body: { title: "A", mode: "story" }, reply: NOVEL },
  { name: "patchNovel", call: () => admin.patchNovel(7, { published: true }), method: "PATCH", url: "/api/admin/novels/7", body: { published: true }, reply: NOVEL },
  { name: "deleteNovel", call: () => admin.deleteNovel(7), method: "DELETE", url: "/api/admin/novels/7", reply: OK, returns: undefined },
  { name: "putCover", call: () => admin.putCover(7, "QUJD"), method: "PUT", url: "/api/admin/novels/7/cover", body: { data: "QUJD" }, reply: { coverV: 1760000000 } },
  { name: "deleteCover", call: () => admin.deleteCover(7), method: "DELETE", url: "/api/admin/novels/7/cover", reply: OK, returns: undefined },
  {
    name: "aiFill",
    call: () => admin.aiFill({ title: "T", synopsisSrc: "S", author: "W" }),
    method: "POST",
    url: "/api/admin/novels/ai-fill",
    body: { title: "T", synopsisSrc: "S", author: "W" },
    reply: { titleTh: "ท", synopsis: "ย่อ", tags: ["แฟนตาซี"] },
  },
  { name: "chapters", call: () => admin.chapters(7), method: "GET", url: "/api/admin/novels/7/chapters", reply: [CHAPTER] },
  {
    name: "createChapters",
    call: () => admin.createChapters(7, { chapters: [{ number: 1, title: "One", text: "Hello" }], translate: true, publish: false }),
    method: "POST",
    url: "/api/admin/novels/7/chapters",
    body: { chapters: [{ number: 1, title: "One", text: "Hello" }], translate: true, publish: false },
    reply: { created: [70], queued: 1 },
  },
  { name: "chapter", call: () => admin.chapter(70), method: "GET", url: "/api/admin/chapters/70", reply: CHAPTER },
  { name: "patchChapter", call: () => admin.patchChapter(70, { translation: "แปล" }), method: "PATCH", url: "/api/admin/chapters/70", body: { translation: "แปล" }, reply: CHAPTER },
  { name: "deleteChapter", call: () => admin.deleteChapter(70), method: "DELETE", url: "/api/admin/chapters/70", reply: OK, returns: undefined },
  { name: "bulk", call: () => admin.bulk({ ids: [1, 2], action: "translate" }), method: "POST", url: "/api/admin/chapters/bulk", body: { ids: [1, 2], action: "translate" }, reply: { queued: 2 } },
  { name: "glossary", call: () => admin.glossary(7), method: "GET", url: "/api/admin/novels/7/glossary", reply: [TERM] },
  { name: "addTerm", call: () => admin.addTerm(7, { source: "Kael", thai: "เคล" }), method: "POST", url: "/api/admin/novels/7/glossary", body: { source: "Kael", thai: "เคล" }, reply: TERM },
  { name: "patchTerm", call: () => admin.patchTerm(5, { thai: "เคลล์" }), method: "PATCH", url: "/api/admin/glossary/5", body: { thai: "เคลล์" }, reply: TERM },
  { name: "deleteTerm", call: () => admin.deleteTerm(5), method: "DELETE", url: "/api/admin/glossary/5", reply: OK, returns: undefined },
  { name: "settings", call: () => admin.settings(), method: "GET", url: "/api/admin/settings", reply: SETTINGS },
  { name: "putSettings", call: () => admin.putSettings({ siteName: "ใหม่" }), method: "PUT", url: "/api/admin/settings", body: { siteName: "ใหม่" }, reply: SETTINGS },
  { name: "testApi", call: () => admin.testApi(), method: "POST", url: "/api/admin/settings/test-api", reply: { ok: true, message: "ใช้งานได้" } },
]

describe("admin API: เส้นทาง เมธอด body และค่าที่คืน", () => {
  for (const c of cases) {
    test(`${c.name} → ${c.method} ${c.url}`, async () => {
      const calls = installFetch(() => jsonResponse(c.reply))
      const result = await c.call()
      assert.equal(calls.length, 1, "ต้องเรียกเซิร์ฟเวอร์ครั้งเดียว")
      assert.equal(calls[0]!.url, c.url)
      assert.equal(calls[0]!.init.method, c.method)
      if (c.body === undefined) assert.equal(calls[0]!.init.body, undefined, "ไม่ควรส่ง body")
      else assert.deepEqual(JSON.parse(calls[0]!.init.body as string), c.body)
      assert.deepEqual(result, "returns" in c ? c.returns : c.reply)
    })
  }

  test("ตารางครอบคลุมทุกฟังก์ชันของ admin พอดี (เพิ่มฟังก์ชันแล้วลืมเทสต์ = ล้ม)", () => {
    assert.deepEqual(cases.map((c) => c.name).sort(), Object.keys(admin).sort())
    assert.equal(new Set(cases.map((c) => c.name)).size, cases.length)
  })
})

describe("admin API: รายละเอียดเฉพาะฟังก์ชัน", () => {
  test("pause ไม่ระบุสาเหตุ → ส่ง {} (เซิร์ฟเวอร์ถือเป็นหยุดโดยไม่มีสาเหตุ)", async () => {
    const calls = installFetch(() => jsonResponse({ paused: true }))
    await admin.pause()
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), {})
  })

  test("glossary: autoOnly=true ต่อ ?auto=1, false/ไม่ระบุ ไม่ต่อ", async () => {
    const calls = installFetch(() => jsonResponse([]))
    await admin.glossary(7, true)
    await admin.glossary(7, false)
    await admin.glossary(7)
    assert.deepEqual(
      calls.map((c) => c.url),
      ["/api/admin/novels/7/glossary?auto=1", "/api/admin/novels/7/glossary", "/api/admin/novels/7/glossary"],
    )
  })

  test("bulk ส่ง body ตามที่รับมาทั้งก้อน รวมแบบ where:ready ที่ไม่มี ids", async () => {
    const calls = installFetch(() => jsonResponse({ changed: 4, skipped: 1 }))
    const result = await admin.bulk({ where: "ready", action: "publish", novelId: 7, autoPublish: true })
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { where: "ready", action: "publish", novelId: 7, autoPublish: true })
    assert.deepEqual(result, { changed: 4, skipped: 1 })
  })

  test("ข้อความรหัสผ่านถูกส่งตรงตัว ไม่ตัดช่องว่าง", async () => {
    const calls = installFetch(() => jsonResponse({ admin: true, passwordless: false }))
    await admin.login("  a b  ")
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { password: "  a b  " })
  })
})

describe("admin API: ข้อผิดพลาดผ่านขึ้นไปครบ", () => {
  test("401 จาก me → ApiError(401) ให้ AdminApp แยกไปหน้าล็อกอิน", async () => {
    installFetch(() => jsonResponse({ error: "ต้องเข้าสู่ระบบ", code: "unauthorized" }, 401))
    await assert.rejects(admin.me(), (e) => e instanceof ApiError && e.status === 401 && e.code === "unauthorized")
  })

  test("429 จาก login → ApiError ที่ data.retryAfterSec ยังอยู่ (หน้าล็อกอินใช้บอกเวลารอ)", async () => {
    installFetch(() => jsonResponse({ error: "ลองผิดหลายครั้งเกินไป", code: "too_many_attempts", retryAfterSec: 90 }, 429))
    await assert.rejects(admin.login("x"), (e) => e instanceof ApiError && e.status === 429 && (e.data as { retryAfterSec: number }).retryAfterSec === 90)
  })

  test("เครือข่ายล่ม → ApiError(0)", async () => {
    installFetch(() => {
      throw new TypeError("fetch failed")
    })
    await assert.rejects(admin.queue(), (e) => e instanceof ApiError && e.status === 0)
  })
})
