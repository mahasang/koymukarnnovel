import { mock, test } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import type { AppDeps } from "../src/app.js"
import { loadConfig, type Config } from "../src/config.js"
import { buildContext } from "../src/context.js"
import type { Db } from "../src/db.js"
import type { GlossaryRow } from "../src/types.js"
import { TEST_IMPORT_TOKEN, TEST_PASSWORD, withTestApp, type Client, type ClientResponse, type TestApp } from "./helpers/app.js"
import { createClock, type Clock } from "./helpers/clock.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { rawRequest, rawSocketRequest } from "./helpers/http.js"
import { getChapter, seedChapter, seedGlossary, seedNovel, type SeedChapter } from "./helpers/seed.js"
import { startStuckTranslation } from "./helpers/stuck.js"

const THAI = /[฀-๿]/
const IMPORT = "/api/import"
const TOKEN = TEST_IMPORT_TOKEN
/** เวลาเริ่มต้นของ `createClock` ในรูปแบบที่เก็บใน DB */
const NOW = "2026-10-22 01:02:03"

type T = TestApp<FakeAi>
type Headers = Record<string, string>

// ═════════════════════════ ข้อมูลทดสอบ ═════════════════════════
//
// aria   เรื่องที่เผยแพร่แล้ว (ตั้งใจให้เห็นว่านำเข้าได้ทั้งที่เรื่องขึ้นเว็บอยู่) · ตอนทุกสถานะ:
//        0 ร่าง+เรื่องย่อเดิม · 1 ร่าง · 2 อยู่ในคิว (auto_publish) · 3 กำลังแปล · 4 แปลแล้ว+เผยแพร่อยู่ · 5 แปลแล้วยังไม่เผยแพร่ (มีชื่อไทย+เรื่องย่อ)
//        6 error+เรื่องย่อเดิม · 7 ร่าง+เรื่องย่อเดิม · 8 อยู่ในคิว (ลำดับที่ 2) · 9 กำลังแปล+เผยแพร่อยู่
// other  เรื่องอื่นที่ซ่อนอยู่ มีตอน 1 ตัวเลขเดียวกับของ aria และอภิธานที่ใช้คำเดียวกัน (ต้องไม่ปนกัน)
// saga   โหมดเล่าเรื่อง ตอน 1–10 มีเรื่องย่อเกือบทุกตอน (ตอน 4 ไม่มี · ตอน 5 มีแต่ช่องว่าง) ไว้ทดสอบเพดาน 5 ตอนของบริบท
// empty  เรื่องที่ยังไม่มีตอน
// ข้อความ SECRET-* คือข้อมูลที่ช่องทางนำเข้าต้องไม่ส่งออกไปเด็ดขาด

const SOURCE_1 = "Aria opened the door.\nShe stepped in."
const SOURCE_2 = "Second chapter source text."
const SOURCE_8 = "Eighth chapter source for the queue."

interface Lib {
  aria: number
  other: number
  saga: number
  empty: number
  /** รหัสตอนของ aria ตามเลขตอน */
  ch: Record<number, number>
  otherCh: number
}

function seedLib(db: Db): Lib {
  const aria = seedNovel(db, {
    title: "Aria's Tale",
    titleTh: "นิทานอาเรีย",
    mode: "translate",
    styleNote: "ใช้ภาษาพูดสบายๆ",
    published: true,
    author: "SECRET-AUTHOR",
    synopsisSrc: "SECRET-SYNOPSIS-SRC",
    licenseNote: "SECRET-LICENSE",
    sourceUrl: "https://example.com/SECRET-URL",
  })
  const chapter = (number: number, o: SeedChapter = {}): number => seedChapter(db, aria, number, o)
  const ch: Record<number, number> = {
    0: chapter(0, { recap: "เรื่องย่อเดิม0" }),
    1: chapter(1, { source: SOURCE_1 }),
    2: chapter(2, { source: SOURCE_2, status: "queued", queueSeq: 1, autoPublish: true }),
    3: chapter(3, { status: "translating" }),
    4: chapter(4, { status: "done", translation: "SECRET-TRANSLATION-4", published: true, publishedAt: "2026-10-01 00:00:00", translatedAt: "2026-09-30 00:00:00" }),
    5: chapter(5, { status: "done", translation: "SECRET-TRANSLATION-5", titleTh: "ชื่อไทยเดิม5", recap: "เรื่องย่อเดิม5", translatedAt: "2026-09-30 00:00:00" }),
    6: chapter(6, { status: "error", error: "SECRET-ERROR-6", recap: "เรื่องย่อเดิม6" }),
    7: chapter(7, { recap: "เรื่องย่อเดิม7" }),
    8: chapter(8, { source: SOURCE_8, status: "queued", queueSeq: 2 }),
    9: chapter(9, { status: "translating", translation: "SECRET-TRANSLATION-9", published: true, publishedAt: "2026-10-02 00:00:00" }),
  }
  seedGlossary(db, aria, [
    { source: "Aria", thai: "อาเรีย", note: "นางเอก" },
    { source: "Bram", thai: "บราม", auto: true },
  ])

  const other = seedNovel(db, { title: "Other Novel", published: false })
  const otherCh = seedChapter(db, other, 1, { source: "Other novel chapter one." })
  seedGlossary(db, other, [{ source: "Aria", thai: "SECRET-OTHER-THAI" }])

  const saga = seedNovel(db, { title: "Long Saga", mode: "story", styleNote: "เล่าเหมือนเล่านิทาน" })
  for (let n = 1; n <= 10; n++) {
    seedChapter(db, saga, n, { source: `Saga source ${n}`, recap: n === 4 ? null : n === 5 ? "  \n " : `เรื่องย่อตอน${n}` })
  }

  const empty = seedNovel(db, { title: "Empty Novel" })
  return { aria, other, saga, empty, ch, otherCh }
}

interface Ctx {
  t: T
  clock: Clock
  lib: Lib
  /** เบราว์เซอร์จำลองที่ยังไม่ล็อกอิน (ช่องทางนำเข้าไม่ใช้ cookie) */
  c: Client
}

async function withLib(fn: (ctx: Ctx) => Promise<void>, config: Partial<Config> = {}): Promise<void> {
  const clock = createClock()
  await withTestApp({ now: clock.now, config }, async (t) => fn({ t, clock, lib: seedLib(t.db), c: t.client() }))
}

// ═════════════════════════ ตัวช่วย ═════════════════════════

const auth = (token: string = TOKEN): Headers => ({ authorization: `Bearer ${token}` })
const xff = (ip: string): Headers => ({ "x-forwarded-for": ip })

const listPath = (novel: number | string) => `${IMPORT}/novels/${novel}/chapters`
const briefPath = (novel: number | string, number: number | string) => `${listPath(novel)}/${number}`
const putPath = (novel: number | string, number: number | string) => `${briefPath(novel, number)}/translation`

const get = (c: Client, path: string, headers: Headers = auth()) => c.raw(path, { method: "GET", headers })

/** ส่ง JSON แบบที่สคริปต์ภายนอกส่ง (ไม่มี Origin ไม่มี cookie) */
const put = (c: Client, novel: number | string, number: number | string, body: unknown, headers: Headers = auth()) =>
  c.raw(putPath(novel, number), { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })

/** ส่ง body ดิบ (ไว้ทดสอบ JSON พัง/ขนาดพอดีขอบ/ชนิดข้อมูล) */
const putRaw = (c: Client, path: string, body: string, headers: Headers) => c.raw(path, { method: "PUT", headers, body })

const JSON_HEADERS = { "content-type": "application/json" }

const rowsOf = (t: T, table: string): string => JSON.stringify(t.db.all(`SELECT * FROM ${table}`))
const snapshot = (t: T): string[] => ["novels", "chapters", "glossary", "usage", "covers"].map((table) => rowsOf(t, table))
const count = (t: T, table: string, where = "1"): number => t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)!.n
const glossaryOf = (t: T, novelId: number): GlossaryRow[] => t.db.all<GlossaryRow>("SELECT * FROM glossary WHERE novel_id = ? ORDER BY id", novelId)
/** ทุกตอนยกเว้นตอนเดียว (ไว้ยืนยันว่านำเข้าตอนหนึ่งไม่แตะตอนอื่น) */
const chaptersExcept = (t: T, id: number): string => JSON.stringify(t.db.all("SELECT * FROM chapters WHERE id <> ?", id))

/** ไม่มีอะไรในระบบเปลี่ยน และไม่มีการเรียก AI */
function assertUntouched(t: T, before: string[]): void {
  assert.deepEqual(snapshot(t), before)
  assert.deepEqual(t.ai.calls, [])
}

const longText = (n: number, ch = "ก"): string => ch.repeat(n)

// ═════════════════════════ ปิดอยู่ ═════════════════════════

test("ปิดอยู่เมื่อไม่ตั้ง IMPORT_TOKEN: ทุกเส้นทาง ทุกเมธอดตอบ 404 body เดียวกับ /api/ไม่มีอยู่ (แม้ส่ง Bearer มา) และไม่เปลี่ยนข้อมูล", async () => {
  await withLib(
    async ({ t, lib, c }) => {
      const missing = await c.get("/api/ไม่มีอยู่")
      assert.equal(missing.status, 404)
      assert.equal(missing.json.code, "not_found")
      const before = snapshot(t)

      const body = JSON.stringify({ translation: "ข้อความ" })
      const probes: [string, string, string | undefined][] = [
        ["GET", listPath(lib.aria), undefined],
        ["GET", briefPath(lib.aria, 1), undefined],
        ["PUT", putPath(lib.aria, 1), body],
        ["PUT", putPath(lib.aria, 99), body],
        ["POST", `${IMPORT}/novels`, "{}"],
        ["DELETE", briefPath(lib.aria, 1), undefined],
        ["GET", IMPORT, undefined],
        ["GET", `${IMPORT}/`, undefined],
        ["GET", `${IMPORT}/ไม่มีอยู่`, undefined],
      ]
      for (const [method, path, payload] of probes) {
        for (const headers of [{ ...JSON_HEADERS, ...auth() }, JSON_HEADERS, {}]) {
          const r = await c.raw(path, { method, headers, body: payload })
          assert.equal(r.status, 404, `${method} ${path}`)
          assert.equal(r.text, missing.text, `${method} ${path}`)
          assert.equal(r.headers.get("www-authenticate"), null, `${method} ${path}`)
        }
      }
      assertUntouched(t, before)
    },
    { importToken: null },
  )
})

test("โทเค็นสั้นกว่า 24 ตัว (ผ่าน loadConfig) ปิดช่องทาง 404 · ยาว 24 ตัวพอดีเปิด (ผิด → 401 ถูก → ใช้ได้)", async () => {
  for (const [length, enabled] of [
    [23, false],
    [24, true],
  ] as const) {
    const token = "k".repeat(length)
    const { config } = loadConfig({ IMPORT_TOKEN: token })
    await withTestApp({ config: { importToken: config.importToken } }, async (t) => {
      const novel = seedNovel(t.db)
      const c = t.client()
      const right = await get(c, listPath(novel), auth(token))
      const wrong = await get(c, listPath(novel), auth("w".repeat(length)))
      assert.equal(right.status, enabled ? 200 : 404, `โทเค็น ${length} ตัว`)
      assert.equal(wrong.status, enabled ? 401 : 404, `โทเค็น ${length} ตัว`)
    })
  }
})

test("createImportRouter ไม่ยอมถูกสร้างเมื่อไม่ได้ตั้ง IMPORT_TOKEN (การตัดสินใจ mount อยู่ที่ createApp)", async () => {
  const { createImportRouter } = await import("../src/http/import.js")
  assert.throws(() => createImportRouter({ config: { importToken: null } } as unknown as AppDeps), /IMPORT_TOKEN/)
})

// ═════════════════════════ ยืนยันตัวตน ═════════════════════════

test("ไม่มี Authorization → 401 JSON ไทย + WWW-Authenticate: Bearer ทุกเส้นทาง รวมที่ไม่มีอยู่จริง (ไม่เฉลยว่ามีเส้นทางไหน) · ไม่เปลี่ยนข้อมูล", async () => {
  await withLib(
    async ({ t, lib, c }) => {
      const before = snapshot(t)
      const probes: [string, string, string | undefined][] = [
        ["GET", listPath(lib.aria), undefined],
        ["GET", briefPath(lib.aria, 1), undefined],
        ["PUT", putPath(lib.aria, 1), JSON.stringify({ translation: "ข้อความ" })],
        ["PUT", putPath(9999, 9999), JSON.stringify({})],
        ["GET", `${IMPORT}/ไม่มีอยู่`, undefined],
        ["POST", `${IMPORT}/novels`, "{}"],
        ["DELETE", briefPath(lib.aria, 1), undefined],
        ["GET", IMPORT, undefined],
      ]
      let ip = 0
      for (const [method, path, body] of probes) {
        const r = await c.raw(path, { method, headers: { ...JSON_HEADERS, ...xff(`198.51.100.${++ip}`) }, body })
        assert.equal(r.status, 401, `${method} ${path}`)
        assert.equal(r.json.code, "unauthorized")
        assert.match(r.json.error, THAI)
        assert.equal(r.headers.get("www-authenticate"), 'Bearer realm="koymukarnnovel-import"')
      }
      assertUntouched(t, before)
    },
    { trustProxy: 1 },
  )
})

test("หัว Authorization ที่ไม่ใช่ Bearer <โทเค็นถูก> เป๊ะๆ → 401 (ชื่อ scheme ไม่สนตัวพิมพ์ แต่ตัวโทเค็นต้องตรงทุกตัวอักษร)", async () => {
  await withLib(
    async ({ lib, c }) => {
      const bad: [string, string][] = [
        ["ไม่ใช่ Bearer (Basic)", `Basic ${TOKEN}`],
        ["ไม่ใช่ Bearer (Token)", `Token ${TOKEN}`],
        ["Bearer ไม่มีโทเค็น", "Bearer"],
        ["โทเค็นเปล่าๆ ไม่มีชื่อ scheme", TOKEN],
        ["โทเค็นถูกแต่มีตัวต่อท้าย", `Bearer ${TOKEN}x`],
        ["โทเค็นถูกแต่ขาดตัวสุดท้าย", `Bearer ${TOKEN.slice(0, -1)}`],
        ["โทเค็นถูกตามด้วยคำอื่น", `Bearer ${TOKEN} extra`],
        ["โทเค็นตัวพิมพ์ใหญ่", `Bearer ${TOKEN.toUpperCase()}`],
        ["โทเค็นสั้นมาก", "Bearer x"],
        ["โทเค็นยาวมาก", `Bearer ${"x".repeat(5000)}`],
        ["Bearer สองครั้ง", `Bearer Bearer ${TOKEN}`],
        ["Bearer ติดกับโทเค็นไม่มีช่องว่างคั่น", `Bearer${TOKEN}`],
        ["ค่าว่าง", ""],
      ]
      let ip = 0
      for (const [label, header] of bad) {
        const r = await get(c, listPath(lib.aria), { authorization: header, ...xff(`198.51.100.${++ip}`) })
        assert.equal(r.status, 401, label)
        assert.equal(r.json.code, "unauthorized", label)
      }
      for (const header of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `BEARER ${TOKEN}`, `Bearer   ${TOKEN}`]) {
        const r = await get(c, listPath(lib.aria), { authorization: header })
        assert.equal(r.status, 200, header)
      }
    },
    { trustProxy: 1 },
  )
})

test("โทเค็นรับทางหัว Authorization เท่านั้น: ใน query string, cookie, body หรือหัวอื่นไม่ได้ผล → 401", async () => {
  await withLib(
    async ({ t, lib, c }) => {
      const before = snapshot(t)
      let ip = 0
      const from = (): Headers => xff(`198.51.100.${++ip}`)
      const attempts: [string, () => Promise<ClientResponse>][] = [
        ["query token", () => get(c, `${listPath(lib.aria)}?token=${TOKEN}`, from())],
        ["query access_token", () => get(c, `${listPath(lib.aria)}?access_token=${TOKEN}`, from())],
        ["query authorization", () => get(c, `${briefPath(lib.aria, 1)}?authorization=Bearer%20${TOKEN}`, from())],
        ["cookie", () => get(c, listPath(lib.aria), { cookie: `import_token=${TOKEN}; token=${TOKEN}`, ...from() })],
        ["หัว X-Import-Token", () => get(c, listPath(lib.aria), { "x-import-token": TOKEN, ...from() })],
        ["หัว Proxy-Authorization", () => get(c, listPath(lib.aria), { "proxy-authorization": `Bearer ${TOKEN}`, ...from() })],
        ["ใน body ของ PUT", () => put(c, lib.aria, 1, { translation: "ข้อความ", token: TOKEN, authorization: `Bearer ${TOKEN}` }, from())],
      ]
      for (const [label, send] of attempts) {
        const r = await send()
        assert.equal(r.status, 401, label)
        assert.equal(r.json.code, "unauthorized", label)
      }
      assertUntouched(t, before)
    },
    { trustProxy: 1 },
  )
})

test("cookie ผู้ดูแลที่ล็อกอินแล้วอย่างเดียวไม่พอ → 401 ทั้ง GET และ PUT · และโทเค็นนำเข้าก็เปิดหลังบ้านไม่ได้", async () => {
  await withLib(async ({ t, lib }) => {
    const admin = t.client()
    await admin.login()
    assert.equal((await admin.get("/api/admin/me")).status, 200, "ล็อกอินจริง")
    const before = snapshot(t)

    assert.equal((await get(admin, listPath(lib.aria), {})).status, 401)
    assert.equal((await get(admin, briefPath(lib.aria, 1), {})).status, 401)
    assert.equal((await put(admin, lib.aria, 1, { translation: "ข้อความ" }, {})).status, 401)
    assertUntouched(t, before)

    const outsider = t.client()
    assert.equal((await outsider.raw("/api/admin/me", { headers: auth() })).status, 401)
    assert.equal((await outsider.raw("/api/admin/novels", { headers: auth() })).status, 401)
  })
})

test("เทียบโทเค็นด้วย timingSafeEqual บนแฮช 32 ไบต์ทั้งสองฝั่ง: โทเค็นยาวสั้นต่างกันก็ไม่ throw (401 ไม่ใช่ 500)", async () => {
  await withLib(async ({ lib, c }) => {
    const spy = mock.method(crypto, "timingSafeEqual")
    try {
      const wrong = await get(c, listPath(lib.aria), auth("short"))
      assert.equal(wrong.status, 401)
      assert.equal(spy.mock.callCount(), 1)
      const [given, wanted] = spy.mock.calls[0]!.arguments as unknown as [Buffer, Buffer]
      assert.equal(given.length, 32)
      assert.equal(wanted.length, 32)

      const right = await get(c, listPath(lib.aria))
      assert.equal(right.status, 200)
      assert.equal(spy.mock.callCount(), 2)
    } finally {
      spy.mock.restore()
    }
  })
})

// ═════════════════════════ ตัวจำกัด ═════════════════════════

test("โทเค็นผิดครบ 10 ครั้งใน 15 นาที → คำขอถัดไป 429 + Retry-After แม้โทเค็นถูก (ทั้ง GET และ PUT) · ครบ 15 นาทีนับใหม่", async () => {
  await withLib(async ({ t, clock, lib, c }) => {
    for (let i = 1; i <= 10; i++) {
      const r = await get(c, listPath(lib.aria), auth(`wrong-token-${i}`))
      assert.equal(r.status, 401, `ครั้งที่ ${i}`)
      assert.equal(r.headers.get("retry-after"), null)
    }
    const before = snapshot(t)

    const blocked = await get(c, listPath(lib.aria))
    assert.equal(blocked.status, 429)
    assert.equal(blocked.json.code, "too_many_attempts")
    assert.equal(blocked.json.retryAfterSec, 900)
    assert.equal(blocked.headers.get("retry-after"), "900")
    assert.match(blocked.json.error, THAI)
    assert.match(blocked.json.error, /15 นาที/)
    assert.equal((await put(c, lib.aria, 1, { translation: "ข้อความ" })).status, 429)
    assertUntouched(t, before)

    // เหลือ 500 วินาที = 8.33 นาที → บอก "9 นาที" (ปัดขึ้น: ไม่บอกสั้นกว่าที่ต้องรอจริง)
    clock.advance(400_000)
    const middle = await get(c, listPath(lib.aria))
    assert.equal(middle.status, 429)
    assert.equal(middle.json.retryAfterSec, 500)
    assert.equal(middle.headers.get("retry-after"), "500")
    assert.match(middle.json.error, /9 นาที/)

    clock.advance(499_000)
    const still = await get(c, listPath(lib.aria))
    assert.equal(still.status, 429)
    assert.equal(still.headers.get("retry-after"), "1")
    assert.equal(still.json.retryAfterSec, 1)
    assert.match(still.json.error, /1 นาที/, "เหลือ 1 วินาทียังบอก 1 นาที ไม่ใช่ 0")

    clock.advance(1_000)
    assert.equal((await get(c, listPath(lib.aria))).status, 200, "ครบ 15 นาที นับใหม่")
    assert.equal((await get(c, listPath(lib.aria), auth("wrong-again"))).status, 401, "ผิดครั้งแรกของรอบใหม่ยังไม่ถูกบล็อก")
  })
})

test("ถังนับความผิดแยกจากการล็อกอินหลังบ้าน: ล็อกอินผิดจนโดนบล็อกไม่กระทบช่องทางนำเข้า · โทเค็นนำเข้าผิดจนโดนบล็อกไม่กระทบการล็อกอิน", async () => {
  await withLib(async ({ t, lib }) => {
    const c = t.client()
    for (let i = 0; i < 10; i++) assert.equal((await c.post("/api/admin/login", { password: "nope" })).status, 401)
    assert.equal((await c.post("/api/admin/login", { password: "nope" })).status, 429, "ล็อกอินถูกบล็อก")
    assert.equal((await get(c, listPath(lib.aria))).status, 200, "ช่องทางนำเข้ายังใช้ได้")
  })
  await withLib(async ({ t, lib }) => {
    const c = t.client()
    for (let i = 0; i < 10; i++) assert.equal((await get(c, listPath(lib.aria), auth(`wrong-${i}`))).status, 401)
    assert.equal((await get(c, listPath(lib.aria))).status, 429, "ช่องทางนำเข้าถูกบล็อก")
    const login = await c.post("/api/admin/login", { password: TEST_PASSWORD })
    assert.equal(login.status, 200, "ล็อกอินยังใช้ได้")
  })
})

test("คำขอที่โทเค็นถูกไม่นับเป็นความผิด แม้ตอบ 404/400/409: ทำซ้ำเกิน 10 ครั้งก็ไม่โดนบล็อก", async () => {
  await withLib(async ({ lib, c }) => {
    for (let i = 0; i < 4; i++) {
      assert.equal((await get(c, listPath(9999))).status, 404)
      assert.equal((await put(c, lib.aria, 1, {})).status, 400)
      assert.equal((await put(c, lib.aria, 4, { translation: "ข้อความ" })).status, 409)
    }
    assert.equal((await get(c, listPath(lib.aria), auth("wrong"))).status, 401, "โทเค็นผิดครั้งแรกจริงๆ ยังไม่ถูกบล็อก")
    assert.equal((await get(c, listPath(lib.aria))).status, 200)
  })
})

test("คำขอที่โทเค็นถูกไม่ล้างความผิดที่สะสมอยู่: คนที่ใช้ IP เดียวกันกับเจ้าของ (เช่นหลัง NAT) เดาต่อโดยอาศัยคำขอสำเร็จของเจ้าของไม่ได้", async () => {
  await withLib(async ({ lib, c }) => {
    for (let i = 1; i <= 9; i++) assert.equal((await get(c, listPath(lib.aria), auth(`wrong-${i}`))).status, 401, `ผิดครั้งที่ ${i}`)
    assert.equal((await get(c, listPath(lib.aria))).status, 200, "เจ้าของเรียกสำเร็จคั่นกลาง")
    assert.equal((await get(c, listPath(lib.aria), auth("wrong-10"))).status, 401, "ผิดครั้งที่ 10 (ยังนับต่อจาก 9 ครั้งก่อนหน้า)")
    assert.equal((await get(c, listPath(lib.aria))).status, 429, "ครบ 10 ครั้งแล้ว บล็อก แม้คั่นด้วยคำขอที่สำเร็จ")
  })
})

test("Review Focus 4: TRUST_PROXY=0 เมินหัว X-Forwarded-For (ปลอมเพื่อเปลี่ยนถังนับไม่ได้) · TRUST_PROXY=1 นับแยกตาม IP จริง", async () => {
  await withLib(
    async ({ lib, c }) => {
      for (let i = 1; i <= 10; i++) {
        const r = await get(c, listPath(lib.aria), { ...auth(`wrong-${i}`), ...xff(`203.0.113.${i}`) })
        assert.equal(r.status, 401, `ครั้งที่ ${i}`)
      }
      const spoofed = await get(c, listPath(lib.aria), { ...auth(), ...xff("203.0.113.200") })
      assert.equal(spoofed.status, 429, "หัวปลอมไม่ได้ถังใหม่")
    },
    { trustProxy: 0 },
  )
  await withLib(
    async ({ lib, c }) => {
      for (let i = 1; i <= 10; i++) assert.equal((await get(c, listPath(lib.aria), { ...auth(`wrong-${i}`), ...xff("203.0.113.1") })).status, 401)
      assert.equal((await get(c, listPath(lib.aria), { ...auth(), ...xff("203.0.113.1") })).status, 429, "IP เดิมถูกบล็อก")
      assert.equal((await get(c, listPath(lib.aria), { ...auth(), ...xff("203.0.113.2") })).status, 200, "IP อื่นมีถังของตัวเอง")
    },
    { trustProxy: 1 },
  )
})

test("จำกัดอัตรา 60 คำขอ/นาที/IP: ครั้งที่ 61 → 429 + Retry-After แม้โทเค็นถูก · ก่อนตรวจโทเค็น (ไม่มีโทเค็นก็ได้ 429) · ไม่นับเป็นความผิดของโทเค็น", async () => {
  await withLib(
    async ({ clock, lib, c }) => {
      const hit = (headers: Headers = auth(), ip = "198.51.100.1") => get(c, listPath(lib.aria), { ...headers, ...xff(ip) })
      for (let i = 1; i <= 60; i++) {
        const r = await hit()
        assert.equal(r.status, 200, `คำขอที่ ${i}`)
        assert.equal(r.headers.get("retry-after"), null)
      }

      const blocked = await hit()
      assert.equal(blocked.status, 429)
      assert.equal(blocked.json.code, "rate_limited")
      assert.equal(blocked.json.retryAfterSec, 60)
      assert.equal(blocked.headers.get("retry-after"), "60")
      assert.match(blocked.json.error, THAI)
      assert.match(blocked.json.error, /60 วินาที/)

      // ด่านจำกัดอัตราอยู่หน้าด่านโทเค็น: ไม่มีโทเค็น/โทเค็นผิด ก็ได้ 429 และไม่ถูกนับเป็นความผิดของโทเค็น
      assert.equal((await hit({})).status, 429)
      assert.equal((await hit(auth("wrong-1"))).status, 429)
      assert.equal((await hit(auth("wrong-2"))).status, 429)
      assert.equal((await hit(auth(), "198.51.100.2")).status, 200, "IP อื่นมีโควตาของตัวเอง")

      clock.advance(59_000)
      const still = await hit()
      assert.equal(still.status, 429)
      assert.equal(still.headers.get("retry-after"), "1")
      assert.match(still.json.error, /1 วินาที/)

      clock.advance(1_000)
      assert.equal((await hit()).status, 200, "ครบ 60 วินาทีนับใหม่")

      // ความผิดที่ถูกตัดด้วยอัตราข้างบนไม่ถูกนับ: ต้องผิดจริงครบ 10 ครั้งถึงจะโดนบล็อก
      for (let i = 1; i <= 10; i++) assert.equal((await hit(auth(`wrong-${i}`))).status, 401, `ผิดครั้งที่ ${i}`)
      assert.equal((await hit()).json.code, "too_many_attempts")
    },
    { trustProxy: 1 },
  )
})

// ═════════════════════════ หัวคำตอบ ═════════════════════════

test("ทุกคำตอบของช่องทางนำเข้า (สำเร็จและผิดพลาด) เป็น Cache-Control: no-store และไม่มีหัว CORS · preflight จากเว็บอื่นก็ไม่ได้หัวอนุญาต", async () => {
  await withLib(async ({ lib, c }) => {
    const responses: [string, ClientResponse][] = []
    const note = async (label: string, r: Promise<ClientResponse>): Promise<void> => void responses.push([label, await r])

    await note("list 200", get(c, listPath(lib.aria)))
    await note("brief 200", get(c, briefPath(lib.aria, 1)))
    await note("put 200", put(c, lib.aria, 1, { translation: "ข้อความ" }))
    await note("401", get(c, listPath(lib.aria), {}))
    await note("404 เรื่อง", get(c, listPath(9999)))
    await note("404 เส้นทาง", get(c, `${IMPORT}/ไม่มีอยู่`))
    await note("400", put(c, lib.aria, 7, {}))
    await note("409", put(c, lib.aria, 4, { translation: "ข้อความ" }))
    await note("415", putRaw(c, putPath(lib.aria, 7), "x", { ...auth(), "content-type": "text/plain" }))
    await note("413", putRaw(c, putPath(lib.aria, 7), JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) }), { ...auth(), ...JSON_HEADERS }))
    const preflight = { origin: "https://evil.example", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" }
    await note("preflight ไม่มีโทเค็น", c.raw(putPath(lib.aria, 7), { method: "OPTIONS", headers: preflight }))
    await note("preflight มีโทเค็น", c.raw(putPath(lib.aria, 7), { method: "OPTIONS", headers: { ...preflight, ...auth() } }))

    assert.deepEqual(
      responses.map(([, r]) => r.status),
      [200, 200, 200, 401, 404, 404, 400, 409, 415, 413, 401, 200],
    )
    for (const [label, r] of responses) {
      assert.equal(r.headers.get("cache-control"), "no-store", label)
      assert.deepEqual(
        [...r.headers.keys()].filter((name) => name.startsWith("access-control-")),
        [],
        label,
      )
    }
  })
})

// ═════════════════════════ PUT สำเร็จ ═════════════════════════

test("PUT สำเร็จกับตอนร่าง: คำแปลผ่าน normalizeText · done · translated_at · ล้าง error · ไม่เผยแพร่ · ไม่เขียน usage · ไม่เรียก AI (แม้ไม่มี API key) · ตอนอื่นไม่ถูกแตะ", async () => {
  await withLib(async ({ t, lib, c }) => {
    t.ai.script.hasKey = false
    const id = lib.ch[1]!
    const others = chaptersExcept(t, id)
    const glossaryBefore = rowsOf(t, "glossary")

    // BOM + CRLF + NBSP + ช่องว่างท้ายบรรทัด + บรรทัดว่างติดกันหลายบรรทัด (Review Focus 1)
    const raw = "﻿บรรทัดแรก  \r\n\r\n\r\n\r\nบรรทัดที่สอง ต่อ\r\n"
    const r = await put(c, lib.aria, 1, { translation: raw })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true, chapter: { number: 1, status: "done", published: false } })

    const row = getChapter(t.db, id)
    assert.equal(row.translation, "บรรทัดแรก\n\nบรรทัดที่สอง ต่อ")
    assert.equal(row.status, "done")
    assert.equal(row.translated_at, NOW)
    assert.equal(row.updated_at, NOW)
    assert.equal(row.error, "")
    assert.equal(row.queue_seq, null)
    assert.equal(row.published, 0)
    assert.equal(row.published_at, null)
    assert.equal(row.recap, null)
    assert.equal(row.title_th, "")
    assert.equal(row.source_text, SOURCE_1, "ต้นฉบับไม่ถูกแตะ")

    assert.equal(count(t, "usage"), 0)
    assert.deepEqual(t.ai.calls, [])
    assert.equal(chaptersExcept(t, id), others)
    assert.equal(rowsOf(t, "glossary"), glossaryBefore)
  })
})

test("PUT: log หนึ่งบรรทัดต่อการนำเข้า (เรื่อง ตอน ความยาว) ไม่มีเนื้อหาและไม่มีโทเค็น · คำขอที่ล้มเหลวไม่เขียน log", async () => {
  await withLib(async ({ t, lib, c }) => {
    assert.equal((await put(c, lib.aria, 4, { translation: "ข้อความ" })).status, 409)
    assert.equal((await put(c, lib.aria, 1, {})).status, 400)
    assert.equal((await put(c, 9999, 1, { translation: "ข้อความ" })).status, 404)
    assert.equal((await put(c, lib.aria, 1, { translation: "ข้อความ" }, auth("wrong"))).status, 401)
    assert.deepEqual(t.logs.slice(), [], "ล้มเหลวหมด ยังไม่มี log") // slice: deepEqual ที่ narrow ตัว t.logs เป็น never[] จะทำให้บรรทัดถัดไปอ่านไม่ได้

    const translation = "SECRET-CONTENT เนื้อหาของตอน ".repeat(10).trim()
    const ok = await put(c, lib.aria, 1, {
      translation,
      titleTh: "SECRET-TITLE",
      recap: "SECRET-RECAP",
      terms: [{ source: "SECRET-TERM", thai: "SECRET-THAI", note: "SECRET-NOTE" }],
    })
    assert.equal(ok.status, 200)

    assert.equal(t.logs.length, 1)
    const line = t.logs[0]!
    assert.ok(line.startsWith("info: "), line)
    assert.ok(line.includes("นำเข้า"), line)
    assert.ok(line.includes("นิทานอาเรีย"), "ชื่อเรื่อง (ไทยก่อน) เหมือน log ของคิว")
    assert.match(line, /ตอนที่ 1\b/)
    assert.ok(line.includes(String(translation.length)), `ความยาว ${translation.length}`)
    const everything = t.logs.join("\n")
    for (const secret of ["SECRET", TOKEN, "wrong", TEST_PASSWORD]) assert.ok(!everything.includes(secret), `log ต้องไม่มี ${secret}`)
  })
})

test("PUT titleTh: ใส่ให้เฉพาะตอนที่ชื่อไทยยังว่าง (ล้างช่องว่างแล้ว) · ชื่อที่มีอยู่แล้วไม่ถูกทับ", async () => {
  await withLib(async ({ t, lib, c }) => {
    assert.equal((await put(c, lib.aria, 1, { translation: "ข้อความ", titleTh: "  ชื่อใหม่\r\n" })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[1]!).title_th, "ชื่อใหม่")

    assert.equal((await put(c, lib.aria, 5, { translation: "ข้อความใหม่", titleTh: "ชื่อที่ส่งมา", overwrite: true })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[5]!).title_th, "ชื่อไทยเดิม5", "ค่าที่เจ้าของตั้งไว้ชนะเสมอ")

    assert.equal((await put(c, lib.aria, 7, { translation: "ข้อความ" })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[7]!).title_th, "", "ไม่ส่งชื่อไทยก็ยังว่าง")
  })
})

test("PUT recap: บันทึกที่ส่งมา (ล้างช่องว่าง) · ไม่ส่ง/ส่งว่าง/มีแต่ช่องว่าง → NULL (ล้างของเดิม ไม่ใช่ 'ไม่แตะ')", async () => {
  await withLib(async ({ t, lib, c }) => {
    assert.equal((await put(c, lib.aria, 1, { translation: "ข้อความ", recap: "  เรื่องย่อ\r\nสองบรรทัด  " })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[1]!).recap, "เรื่องย่อ\nสองบรรทัด")

    assert.equal(getChapter(t.db, lib.ch[7]!).recap, "เรื่องย่อเดิม7")
    assert.equal((await put(c, lib.aria, 7, { translation: "ข้อความ" })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[7]!).recap, null, "ไม่ส่ง recap = ไม่มีเรื่องย่อ")

    assert.equal(getChapter(t.db, lib.ch[0]!).recap, "เรื่องย่อเดิม0")
    assert.equal((await put(c, lib.aria, 0, { translation: "ข้อความ", recap: "" })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[0]!).recap, null)

    assert.equal(getChapter(t.db, lib.ch[6]!).recap, "เรื่องย่อเดิม6")
    assert.equal((await put(c, lib.aria, 6, { translation: "ข้อความ", recap: " \n\t " })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[6]!).recap, null)
  })
})

test("PUT terms: เข้าอภิธานของเรื่องนั้นเป็น auto=1 · ไม่ทับคำเดิม · ซ้ำกันเองเก็บอันแรก · ล้างช่องว่าง · note ไม่ส่งได้ · เรื่องอื่นไม่ถูกแตะ", async () => {
  await withLib(async ({ t, lib, c }) => {
    const otherBefore = JSON.stringify(glossaryOf(t, lib.other))

    const r = await put(c, lib.aria, 1, {
      translation: "ข้อความ",
      terms: [
        { source: "Aria", thai: "อาเรีย-ใหม่", note: "ไม่ควรทับ" },
        { source: "  Cole  ", thai: " โคล ", note: " นักดาบ " },
        { source: "Cole", thai: "คำซ้ำ" },
        { source: "Dara", thai: "ดารา" },
      ],
    })
    assert.equal(r.status, 200)

    const rows = glossaryOf(t, lib.aria).map(({ source, thai, note, auto }) => ({ source, thai, note, auto }))
    assert.deepEqual(rows, [
      { source: "Aria", thai: "อาเรีย", note: "นางเอก", auto: 0 },
      { source: "Bram", thai: "บราม", note: "", auto: 1 },
      { source: "Cole", thai: "โคล", note: "นักดาบ", auto: 1 },
      { source: "Dara", thai: "ดารา", note: "", auto: 1 },
    ])
    assert.equal(JSON.stringify(glossaryOf(t, lib.other)), otherBefore)
  })
})

test("PUT ตอนที่อยู่ในคิว: ออกจากคิวจริง (คิวไม่หยิบมาแปลอีก) แม้ตั้ง auto_publish ไว้ก็ไม่เผยแพร่ · ตอนอื่นในคิวยังอยู่และทำต่อได้", async () => {
  await withLib(async ({ t, lib, c }) => {
    const queued = lib.ch[2]!
    const waiting = lib.ch[8]!
    assert.equal(getChapter(t.db, queued).auto_publish, 1)

    const r = await put(c, lib.aria, 2, { translation: "คำแปลที่นำเข้า" })
    assert.equal(r.status, 200)
    const row = getChapter(t.db, queued)
    assert.equal(row.status, "done")
    assert.equal(row.queue_seq, null)
    assert.equal(row.published, 0, "ช่องทางนำเข้าไม่เผยแพร่เอง แม้ auto_publish=1")
    assert.equal(row.published_at, null)
    assert.equal(row.translation, "คำแปลที่นำเข้า")
    assert.equal(getChapter(t.db, waiting).status, "queued")
    assert.equal(getChapter(t.db, waiting).queue_seq, 2)

    t.ai.script.translate = () => "คำแปลจากคิว"
    assert.equal(await t.queue.tick(), "done")
    const translated = t.ai.calls.filter((call) => call.method === "translateChunk")
    assert.equal(translated.length, 1, "คิวแปลแค่ตอนเดียว")
    assert.ok(translated[0]!.user.includes(SOURCE_8))
    assert.ok(!translated[0]!.user.includes(SOURCE_2))
    assert.equal(getChapter(t.db, waiting).translation, "คำแปลจากคิว")
    assert.equal(getChapter(t.db, queued).translation, "คำแปลที่นำเข้า", "ไม่ถูกคิวทับ")
    assert.equal(await t.queue.tick(), "idle")
  })
})

test("PUT ตอนเลข 0 และตอนสถานะ error นำเข้าได้ · ตอนของเรื่องอื่นที่เลขเดียวกันไม่ถูกแตะ", async () => {
  await withLib(async ({ t, lib, c }) => {
    assert.equal((await put(c, lib.aria, 0, { translation: "ตอนศูนย์" })).json.chapter.number, 0)
    assert.equal(getChapter(t.db, lib.ch[0]!).translation, "ตอนศูนย์")

    assert.equal((await put(c, lib.aria, 6, { translation: "ตอนที่เคย error" })).status, 200)
    const failed = getChapter(t.db, lib.ch[6]!)
    assert.equal(failed.status, "done")
    assert.equal(failed.error, "", "ล้างข้อความผิดพลาดเดิม")

    assert.equal((await put(c, lib.aria, 1, { translation: "ของ aria" })).status, 200)
    assert.equal(getChapter(t.db, lib.otherCh).translation, "", "ตอน 1 ของเรื่องอื่นไม่ถูกแตะ")
    assert.equal(getChapter(t.db, lib.otherCh).status, "draft")

    assert.equal((await put(c, lib.other, 1, { translation: "ของ other" })).status, 200)
    assert.equal(getChapter(t.db, lib.otherCh).translation, "ของ other")
    assert.equal(getChapter(t.db, lib.ch[1]!).translation, "ของ aria")
  })
})

test("PUT ค่าเต็มขอบทุกฟิลด์ผ่าน (translation 400,000 · titleTh 300 · recap 2,000 · terms 30 · source/thai 200 · note 300) — นับเป็นตัวอักษร ไม่ใช่ไบต์", async () => {
  await withLib(async ({ t, lib, c }) => {
    const terms = Array.from({ length: 30 }, (_, i) => ({
      source: `${String(i).padStart(2, "0")}${longText(198)}`,
      thai: longText(200, "ข"),
      note: longText(300, "ค"),
    }))
    const body = { translation: longText(400_000), titleTh: longText(300), recap: longText(2000), terms }
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 2 * 1024 * 1024, "ภายใต้เพดาน body 2MB แม้เป็นอักษรไทยสามไบต์")

    const r = await put(c, lib.aria, 1, body)
    assert.equal(r.status, 200)
    const row = getChapter(t.db, lib.ch[1]!)
    assert.equal(row.translation.length, 400_000)
    assert.equal(row.title_th.length, 300)
    assert.equal(row.recap!.length, 2000)
    assert.equal(glossaryOf(t, lib.aria).length, 2 + 30)
    assert.ok(glossaryOf(t, lib.aria).some((g) => g.source.length === 200 && g.thai.length === 200 && g.note.length === 300))
  })
})

// ═════════════════════════ PUT ถูกปฏิเสธ ═════════════════════════

test("409: กำลังแปล (translating) · เผยแพร่อยู่ (published) · มีคำแปลแล้วไม่ส่ง overwrite (has_translation) — overwrite ไม่ช่วยสองกรณีแรก · ไม่เปลี่ยนข้อมูล", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = snapshot(t)
    const cases: [string, number, Record<string, unknown>, string][] = [
      ["กำลังแปล", 3, {}, "translating"],
      ["กำลังแปล + overwrite", 3, { overwrite: true }, "translating"],
      ["เผยแพร่อยู่", 4, {}, "published"],
      ["เผยแพร่อยู่ + overwrite", 4, { overwrite: true }, "published"],
      ["ทั้งกำลังแปลและเผยแพร่อยู่ → translating ก่อน", 9, { overwrite: true }, "translating"],
      ["มีคำแปลแล้ว", 5, {}, "has_translation"],
      ["มีคำแปลแล้ว overwrite:false", 5, { overwrite: false }, "has_translation"],
    ]
    for (const [label, number, extra, code] of cases) {
      const r = await put(c, lib.aria, number, { translation: "คำแปลใหม่", ...extra })
      assert.equal(r.status, 409, label)
      assert.equal(r.json.code, code, label)
      assert.match(r.json.error, THAI, label)
    }
    assertUntouched(t, before)
  })
})

test("overwrite: true ทับคำแปลเดิมของตอนที่ยังไม่เผยแพร่ได้ (ชื่อไทยเดิมอยู่ครบ เรื่องย่อเดิมถูกล้าง ยังไม่เผยแพร่ เวลาแปลใหม่) · ใช้กับตอนที่ยังไม่มีคำแปลได้เหมือนกัน", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = getChapter(t.db, lib.ch[5]!)
    assert.equal(before.translated_at, "2026-09-30 00:00:00")

    const r = await put(c, lib.aria, 5, { translation: "คำแปลใหม่ของตอน 5", overwrite: true })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true, chapter: { number: 5, status: "done", published: false } })
    const row = getChapter(t.db, lib.ch[5]!)
    assert.equal(row.translation, "คำแปลใหม่ของตอน 5")
    assert.equal(row.title_th, "ชื่อไทยเดิม5")
    assert.equal(row.recap, null)
    assert.equal(row.status, "done")
    assert.equal(row.published, 0)
    assert.equal(row.translated_at, NOW)

    assert.equal((await put(c, lib.aria, 1, { translation: "ตอนใหม่", overwrite: true })).status, 200)
    assert.equal(getChapter(t.db, lib.ch[1]!).translation, "ตอนใหม่")
  })
})

test("(Review Focus 2) ตอนที่คิวกำลังแปลอยู่จริง → 409 translating การแปลเดิมไม่กระทบ (ช่องทางนำเข้าไม่แย่งงานกับ worker)", async () => {
  await withLib(async ({ t, lib, c }) => {
    const id = lib.ch[2]! // ตอนแรกในคิว (ลำดับที่ 1) จึงเป็นตอนที่ worker หยิบ
    await startStuckTranslation(t, [id])
    assert.equal(getChapter(t.db, id).status, "translating")
    const before = snapshot(t)

    for (const overwrite of [false, true]) {
      const r = await put(c, lib.aria, 2, { translation: "คำแปลที่นำเข้า", overwrite })
      assert.equal(r.status, 409)
      assert.equal(r.json.code, "translating")
    }
    assert.deepEqual(snapshot(t), before)
    assert.equal(t.queue.state().current?.chapterId, id, "คิวยังแปลตอนนี้อยู่")
  })
})

test("404: ไม่พบเรื่อง · ไม่พบตอน · พาธผิดรูปแบบ — ทั้ง GET และ PUT (ตรวจก่อนเนื้อหา: body ผิดก็ได้ 404) และช่องทางนี้สร้างตอนไม่ได้", async () => {
  await withLib(async ({ t, clock, lib, c }) => {
    const before = snapshot(t)
    const NO_NOVEL = "ไม่พบนิยายเรื่องนี้"
    const NO_CHAPTER = "ไม่พบตอนที่ระบุในนิยายเรื่องนี้"
    const cases: [string, string | number, string | number, string][] = [
      ["เรื่องไม่มีอยู่", 9999, 1, NO_NOVEL],
      ["รหัสเรื่องเป็นข้อความ", "abc", 1, NO_NOVEL],
      ["รหัสเรื่อง 0", 0, 1, NO_NOVEL],
      ["รหัสเรื่องติดลบ", -1, 1, NO_NOVEL],
      ["รหัสเรื่องมีศูนย์นำหน้า", "01", 1, NO_NOVEL],
      ["รหัสเรื่องทศนิยม", "1.5", 1, NO_NOVEL],
      ["รหัสเรื่องเลขยกกำลัง", "1e2", 1, NO_NOVEL],
      ["รหัสเรื่องเกินช่วงปลอดภัย", "9".repeat(30), 1, NO_NOVEL],
      ["ไม่มีตอนนั้นในเรื่อง", lib.aria, 99, NO_CHAPTER],
      ["ตอนมีแต่ในเรื่องอื่น", lib.other, 2, NO_CHAPTER],
      ["ตอนเลข 0 ที่ไม่มีในเรื่อง (ต้องไม่เลื่อนไปตอนถัดไปที่มีอยู่)", lib.other, 0, NO_CHAPTER],
      ["เลขตอนเป็นข้อความ", lib.aria, "abc", NO_CHAPTER],
      ["เลขตอนติดลบ", lib.aria, "-1", NO_CHAPTER],
      ["เลขตอนมีศูนย์นำหน้า", lib.aria, "01", NO_CHAPTER],
      ["เลขตอน 00", lib.aria, "00", NO_CHAPTER],
      ["เลขตอนทศนิยม", lib.aria, "1.5", NO_CHAPTER],
      ["เลขตอนเลขยกกำลัง", lib.aria, "1e2", NO_CHAPTER],
      ["เลขตอนฐานสิบหก", lib.aria, "0x1", NO_CHAPTER],
      ["เลขตอนมีเครื่องหมายบวก", lib.aria, "+1", NO_CHAPTER],
      ["เลขตอนใหญ่เกินช่วงปลอดภัย", lib.aria, "9007199254740993", NO_CHAPTER],
      ["เลขตอนยาวจนล้นเป็น Infinity", lib.aria, "9".repeat(400), NO_CHAPTER],
    ]
    for (const [label, novel, number, message] of cases) {
      const brief = await get(c, briefPath(novel, number))
      assert.equal(brief.status, 404, `GET ${label}`)
      assert.equal(brief.json.code, "not_found", `GET ${label}`)
      assert.equal(brief.json.error, message, `GET ${label}`)
      // PUT: body ผิดรูปแบบก็ยังได้ 404 (ตรวจว่ามีตอนนั้นก่อน)
      for (const body of [{ translation: "ข้อความ" }, {}]) {
        const r = await put(c, novel, number, body)
        assert.equal(r.status, 404, `PUT ${label}`)
        assert.equal(r.json.error, message, `PUT ${label}`)
      }
      clock.advance(61_000) // 3 คำขอต่อกรณี × 21 กรณี = 63 เกินเพดาน 60 คำขอ/นาที จึงเปิดหน้าต่างใหม่ทุกกรณี
    }
    for (const novel of ["abc", 0, -1, "01", 9999]) {
      const r = await get(c, listPath(novel))
      assert.equal(r.status, 404, `list ${novel}`)
      assert.equal(r.json.error, NO_NOVEL)
    }
    assertUntouched(t, before)
    assert.equal(count(t, "chapters", `novel_id = ${lib.aria}`), 10, "ไม่มีตอนใหม่เกิดขึ้น")
  })
})

// ═════════════════════════ ตรวจข้อมูล · ชนิด · ขนาด ═════════════════════════

const BAD_BODIES: [string, unknown, RegExp][] = [
  ["ไม่ส่ง translation", {}, /translation/],
  ["translation เป็น null", { translation: null }, /translation/],
  ["translation เป็นตัวเลข", { translation: 5 }, /translation/],
  ["translation เป็นอาร์เรย์", { translation: ["x"] }, /translation/],
  ["translation ว่าง", { translation: "" }, /translation/],
  ["translation มีแต่ช่องว่างกับ BOM", { translation: " \n\t﻿  " }, /translation/],
  ["translation เกิน 400,000", { translation: longText(400_001) }, /translation/],
  ["titleTh เกิน 300", { translation: "ข", titleTh: longText(301) }, /titleTh/],
  ["titleTh เป็นตัวเลข", { translation: "ข", titleTh: 5 }, /titleTh/],
  ["titleTh เป็น null", { translation: "ข", titleTh: null }, /titleTh/],
  ["recap เกิน 2,000", { translation: "ข", recap: longText(2001) }, /recap/],
  ["recap เป็นอาร์เรย์", { translation: "ข", recap: ["x"] }, /recap/],
  ["recap เป็น null", { translation: "ข", recap: null }, /recap/],
  ["terms เป็นข้อความ", { translation: "ข", terms: "Aria" }, /terms/],
  ["terms เป็นออบเจ็กต์", { translation: "ข", terms: {} }, /terms/],
  ["terms เป็น null", { translation: "ข", terms: null }, /terms/],
  ["terms เกิน 30 รายการ", { translation: "ข", terms: Array.from({ length: 31 }, (_, i) => ({ source: `s${i}`, thai: `ท${i}` })) }, /terms/],
  ["term เป็นข้อความ", { translation: "ข", terms: ["Aria"] }, /terms.*รายการที่ 1.*ออบเจ็กต์/],
  ["term เป็นตัวเลข", { translation: "ข", terms: [5] }, /terms.*รายการที่ 1.*ออบเจ็กต์/],
  ["term เป็น null", { translation: "ข", terms: [null] }, /terms.*รายการที่ 1.*ออบเจ็กต์/],
  ["term เป็นอาร์เรย์", { translation: "ข", terms: [["a", "ก"]] }, /terms.*รายการที่ 1.*ออบเจ็กต์/],
  ["term ไม่มี source", { translation: "ข", terms: [{ thai: "ท" }] }, /source/],
  ["term ไม่มี thai", { translation: "ข", terms: [{ source: "s" }] }, /thai/],
  ["term source ว่าง", { translation: "ข", terms: [{ source: " \n ", thai: "ท" }] }, /source/],
  ["term thai ว่าง", { translation: "ข", terms: [{ source: "s", thai: "" }] }, /thai/],
  ["term source เกิน 200", { translation: "ข", terms: [{ source: longText(201), thai: "ท" }] }, /source/],
  ["term thai เกิน 200", { translation: "ข", terms: [{ source: "s", thai: longText(201) }] }, /thai/],
  ["term note เกิน 300", { translation: "ข", terms: [{ source: "s", thai: "ท", note: longText(301) }] }, /note/],
  ["term source เป็นตัวเลข", { translation: "ข", terms: [{ source: 5, thai: "ท" }] }, /source/],
  ["term note เป็น null", { translation: "ข", terms: [{ source: "s", thai: "ท", note: null }] }, /note/],
  ["term ที่ 2 ผิด (ที่ 1 ถูก) ไม่เขียนอะไรเลย แม้ translation ถูก", { translation: "ข", terms: [{ source: "ok", thai: "ได้" }, { source: "", thai: "ท" }] }, /รายการที่ 2/],
  ["overwrite เป็นข้อความ", { translation: "ข", overwrite: "true" }, /overwrite/],
  ["overwrite เป็นตัวเลข", { translation: "ข", overwrite: 1 }, /overwrite/],
  ["overwrite เป็น null", { translation: "ข", overwrite: null }, /overwrite/],
]

test("400: ตรวจทุกฟิลด์ฝั่งเซิร์ฟเวอร์ — ชนิด ความยาว (ทั้งขอบล่างและบน) ผิดข้อเดียวไม่เขียนอะไรเลย ข้อความไทยบอกชื่อฟิลด์", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = snapshot(t)
    for (const [label, body, mention] of BAD_BODIES) {
      const r = await put(c, lib.aria, 1, body)
      assert.equal(r.status, 400, label)
      assert.equal(r.json.code, "invalid_field", label)
      assert.match(r.json.error, THAI, label)
      assert.match(r.json.error, mention, label)
    }
    assertUntouched(t, before)
  })
})

test("400: body ที่ไม่ใช่ออบเจ็กต์ JSON / JSON พัง / ไม่มี body (แม้ส่งเป็น application/json) · ตรวจก่อนค้นหาตอน", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = snapshot(t)
    const headers = { ...auth(), ...JSON_HEADERS }
    const cases: [string, string | undefined, string][] = [
      ["อาร์เรย์", "[]", "bad_request"],
      ["JSON พัง", "{bad", "bad_json"],
      ["ข้อความ JSON", '"x"', "bad_json"],
      ["ตัวเลข JSON", "5", "bad_json"],
      ["null", "null", "bad_json"],
      ["ไม่มี body (Content-Length: 0 ตัวอ่าน JSON ถือเป็น {})", undefined, "invalid_field"],
    ]
    for (const [label, body, code] of cases) {
      const r = await c.raw(putPath(lib.aria, 1), { method: "PUT", headers, body })
      assert.equal(r.status, 400, label)
      assert.equal(r.json.code, code, label)
      assert.match(r.json.error, THAI, label)

      // ตอน 99 ไม่มีอยู่: JSON ที่อ่านไม่ออกถูกตัดสินก่อนค้นหาตอน (ตัวอ่าน JSON มาก่อนเส้นทาง) · ส่วนออบเจ็กต์ที่ผิดชนิดถูกตรวจหลังค้นหา → 404
      const missing = await c.raw(putPath(lib.aria, 99), { method: "PUT", headers, body })
      assert.equal(missing.status, code === "bad_json" ? 400 : 404, `${label} (ตอนที่ไม่มี)`)
    }

    // ไม่มีทั้งหัวบอกขนาดและ body: ตัวอ่าน JSON ข้ามไป `req.body` เป็น undefined → ไม่ใช่ออบเจ็กต์
    const bare = await rawSocketRequest(
      t.port,
      `PUT ${putPath(lib.aria, 1)} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n`,
    )
    assert.equal(bare.status, 400)
    assert.equal(JSON.parse(bare.text).code, "bad_request")
    assertUntouched(t, before)
  })
})

test("415: Content-Type ไม่ใช่ JSON (หรือไม่ระบุแต่มี body) → 415 ข้อความไทย · application/json; charset=utf-8 ผ่าน · ตรวจหลังโทเค็น", async () => {
  await withLib(
    async ({ t, lib, c }) => {
      const before = snapshot(t)
      const body = JSON.stringify({ translation: "ข้อความ" })
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/xml", "text/json"]) {
        const r = await putRaw(c, putPath(lib.aria, 1), body, { ...auth(), "content-type": type })
        assert.equal(r.status, 415, type)
        assert.equal(r.json.code, "unsupported_media_type", type)
        assert.match(r.json.error, THAI, type)
      }
      // fetch เติม text/plain ให้ body ที่เป็นข้อความเอง จึงส่งด้วย node:http เพื่อให้ไม่มีหัว Content-Type จริงๆ
      const noType = await rawRequest({ port: t.port, method: "PUT", path: putPath(lib.aria, 1), headers: auth(), body })
      assert.equal(noType.status, 415, "ไม่ระบุ Content-Type แต่มี body")
      assert.match((noType.json as { error: string }).error, THAI)
      assertUntouched(t, before)

      const wrongToken = await putRaw(c, putPath(lib.aria, 1), body, { authorization: "Bearer wrong", "content-type": "text/plain", ...xff("198.51.100.9") })
      assert.equal(wrongToken.status, 401, "ตรวจโทเค็นก่อนชนิดข้อมูล")

      const ok = await putRaw(c, putPath(lib.aria, 1), body, { ...auth(), "content-type": "application/json; charset=utf-8" })
      assert.equal(ok.status, 200)
    },
    { trustProxy: 1 },
  )
})

test("Review Focus 3: body เกิน 2MB → 413 JSON ไทย (เซิร์ฟเวอร์ไม่ล้ม ไม่มี error ใน log ไม่เปลี่ยนข้อมูล) · 2MB พอดีอ่านได้ถึงตัวตรวจฟิลด์ · คนแปลกหน้าสั่งให้อ่าน body ไม่ได้", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = snapshot(t)
    const limit = 2 * 1024 * 1024
    const frame = JSON.stringify({ pad: "" }).length
    const jsonOfSize = (bytes: number): string => JSON.stringify({ pad: "x".repeat(bytes - frame) })
    const headers = { ...auth(), ...JSON_HEADERS }

    const exactly = jsonOfSize(limit)
    assert.equal(Buffer.byteLength(exactly), limit)
    const ok = await putRaw(c, putPath(lib.aria, 1), exactly, headers)
    assert.equal(ok.status, 400, "อ่านได้ครบ แล้วไปติดที่ไม่มี translation")
    assert.equal(ok.json.code, "invalid_field")

    for (const bytes of [limit + 1, 9 * 1024 * 1024]) {
      const over = await putRaw(c, putPath(lib.aria, 1), jsonOfSize(bytes), headers)
      assert.equal(over.status, 413, `${bytes} ไบต์`)
      assert.equal(over.json.code, "too_large")
      assert.equal(over.json.error, "ข้อมูลที่ส่งมาใหญ่เกินกำหนด")
    }

    const anonymous = await putRaw(c, putPath(lib.aria, 1), jsonOfSize(3 * 1024 * 1024), JSON_HEADERS)
    assert.equal(anonymous.status, 401, "ยังไม่ยืนยันตัวตน = ยังไม่อ่าน body")

    assert.equal((await get(c, listPath(lib.aria))).status, 200, "เซิร์ฟเวอร์ยังทำงานต่อ")
    assertUntouched(t, before)
  })
})

test("ลำดับด่าน: จำกัดอัตรา → โทเค็น → ชนิดข้อมูล → อ่าน JSON → ค้นหา (404) → ตรวจฟิลด์ (400) → สถานะ (409)", async () => {
  await withLib(async ({ lib, c }) => {
    const plain = { ...auth(), "content-type": "text/plain" }
    // ชนิดข้อมูลผิดบนตอนที่ไม่มีอยู่ → 415 (ชนิดมาก่อนค้นหา)
    assert.equal((await putRaw(c, putPath(lib.aria, 99), "x", plain)).status, 415)
    // ตอนไม่มีอยู่ + ฟิลด์ผิด → 404 (ค้นหามาก่อนตรวจฟิลด์)
    assert.equal((await put(c, lib.aria, 99, { translation: 5 })).status, 404)
    // ตอนเผยแพร่อยู่ + ฟิลด์ผิด → 400 (ตรวจฟิลด์มาก่อนสถานะ)
    assert.equal((await put(c, lib.aria, 4, { translation: 5 })).status, 400)
    assert.equal((await put(c, lib.aria, 3, { translation: 5 })).status, 400)
    // ฟิลด์ถูก → 409
    assert.equal((await put(c, lib.aria, 4, { translation: "ข้อความ" })).status, 409)
  })
})

test("ช่องทางนำเข้าทำได้แค่ 3 เส้นทาง: สร้าง/ลบ/แก้/เผยแพร่ตอนไม่ได้ (เมธอดหรือเส้นทางอื่นที่ผ่านโทเค็นแล้วได้ 404 ไม่เปลี่ยนข้อมูล)", async () => {
  await withLib(async ({ t, lib, c }) => {
    const before = snapshot(t)
    const attempts: [string, string, unknown?][] = [
      ["POST", listPath(lib.aria), { chapters: [{ number: 50, title: "x", text: "y" }] }],
      ["PUT", listPath(lib.aria), { chapters: [] }],
      ["POST", briefPath(lib.aria, 1), {}],
      ["PUT", briefPath(lib.aria, 1), { translation: "ข้อความ" }],
      ["PATCH", briefPath(lib.aria, 1), { title: "x" }],
      ["DELETE", briefPath(lib.aria, 1)],
      ["GET", putPath(lib.aria, 1)],
      ["POST", putPath(lib.aria, 1), { translation: "ข้อความ" }],
      ["PATCH", putPath(lib.aria, 1), { translation: "ข้อความ" }],
      ["DELETE", putPath(lib.aria, 1)],
      ["PUT", `${briefPath(lib.aria, 1)}/publish`, {}],
      ["POST", `${briefPath(lib.aria, 1)}/publish`, {}],
      ["GET", `${IMPORT}/novels`],
      ["GET", `${IMPORT}/novels/${lib.aria}`],
      ["PUT", `${IMPORT}/novels/${lib.aria}`, { title: "x" }],
      ["DELETE", `${IMPORT}/novels/${lib.aria}`],
      ["GET", `${IMPORT}/glossary`],
    ]
    for (const [method, path, body] of attempts) {
      const r = await c.raw(path, { method, headers: { ...auth(), ...JSON_HEADERS }, body: body === undefined ? undefined : JSON.stringify(body) })
      assert.equal(r.status, 404, `${method} ${path}`)
      assert.equal(r.json.code, "not_found", `${method} ${path}`)
    }
    assertUntouched(t, before)
  })
})

// ═════════════════════════ GET (ส่วนเสริม) ═════════════════════════

test("GET รายการตอน: เรียงตามเลข (เริ่มที่ 0) ทุกสถานะ · มีเฉพาะ 6 ฟิลด์ตามสัญญา · chars คือความยาวต้นฉบับ · เรื่องที่ยังไม่มีตอน → []", async () => {
  await withLib(async ({ lib, c }) => {
    const r = await get(c, listPath(lib.aria))
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type")!, /^application\/json/)
    assert.deepEqual(
      r.json.map((x: { number: number }) => x.number),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    )
    assert.deepEqual(r.json[1], { number: 1, title: "Chapter 1", status: "draft", hasTranslation: false, chars: SOURCE_1.length, published: false })
    assert.deepEqual(r.json[4], { number: 4, title: "Chapter 4", status: "done", hasTranslation: true, chars: "Source text of chapter 4.".length, published: true })
    assert.deepEqual(r.json[5], { number: 5, title: "Chapter 5", status: "done", hasTranslation: true, chars: "Source text of chapter 5.".length, published: false })
    assert.equal(r.json[2].status, "queued")
    assert.equal(r.json[3].status, "translating")
    assert.equal(r.json[6].status, "error")
    assert.deepEqual(
      r.json.map((x: { hasTranslation: boolean }) => x.hasTranslation),
      [false, false, false, false, true, true, false, false, false, true],
    )
    for (const item of r.json) assert.deepEqual(Object.keys(item).sort(), ["chars", "hasTranslation", "number", "published", "status", "title"])

    const empty = await get(c, listPath(lib.empty))
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, [])
    const other = await get(c, listPath(lib.other))
    assert.deepEqual(
      other.json.map((x: { number: number }) => x.number),
      [1],
      "ไม่ปนกับตอนของเรื่องอื่น แม้เรื่องที่ซ่อนอยู่",
    )
  })
})

test("GET รายการตอน: เรียงตามเลขตอนเสมอ แม้ตอนถูกสร้างสลับลำดับ (ทั้งแบบไม่กรองและกรอง ?status=)", async () => {
  await withLib(async ({ t, c }) => {
    const novel = seedNovel(t.db, { title: "Shuffled" })
    for (const n of [5, 3, 9, 1, 7, 0, 4]) seedChapter(t.db, novel, n, { status: n % 2 === 0 ? "queued" : "draft" })
    const numbers = async (query: string): Promise<number[]> => (await get(c, `${listPath(novel)}${query}`)).json.map((x: { number: number }) => x.number)
    assert.deepEqual(await numbers(""), [0, 1, 3, 4, 5, 7, 9])
    assert.deepEqual(await numbers("?status=draft"), [1, 3, 5, 7, 9])
    assert.deepEqual(await numbers("?status=queued"), [0, 4])
  })
})

test("GET รายการตอน ?status=: กรองตามสถานะ · สถานะนอกรายการ/ว่าง/ซ้ำ/ตัวพิมพ์ใหญ่ → 400 · พารามิเตอร์อื่นไม่มีผล", async () => {
  await withLib(async ({ lib, c }) => {
    const numbers = async (query: string): Promise<number[]> => {
      const r = await get(c, `${listPath(lib.aria)}${query}`)
      assert.equal(r.status, 200, query)
      return r.json.map((x: { number: number }) => x.number)
    }
    assert.deepEqual(await numbers("?status=draft"), [0, 1, 7])
    assert.deepEqual(await numbers("?status=queued"), [2, 8])
    assert.deepEqual(await numbers("?status=translating"), [3, 9])
    assert.deepEqual(await numbers("?status=done"), [4, 5])
    assert.deepEqual(await numbers("?status=error"), [6])
    assert.deepEqual(await numbers("?foo=bar"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.deepEqual(await numbers(""), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

    for (const query of ["?status=", "?status=publish", "?status=DRAFT", "?status=draft,done", "?status=draft&status=done", "?status=%20draft"]) {
      const r = await get(c, `${listPath(lib.aria)}${query}`)
      assert.equal(r.status, 400, query)
      assert.equal(r.json.code, "invalid_field", query)
      assert.match(r.json.error, THAI)
      assert.match(r.json.error, /status/)
    }
    assert.equal((await get(c, `${listPath(lib.empty)}?status=done`)).status, 200)
    assert.equal((await get(c, `${listPath(9999)}?status=bogus`)).status, 404, "ไม่พบเรื่องมาก่อนตรวจ query")
  })
})

test("GET โจทย์ของตอน: ต้นฉบับ + บริบทชุดเดียวกับที่คิวใช้ — systemPrompt เท่ากับ buildContext(...).system เป๊ะ · อภิธานครบ · ฟิลด์ตามสัญญาเท่านั้น", async () => {
  await withLib(async ({ t, lib, c }) => {
    const r = await get(c, briefPath(lib.aria, 1))
    assert.equal(r.status, 200)
    const ctx = buildContext(t.db, lib.ch[1]!)!
    assert.deepEqual(r.json, {
      novel: { id: lib.aria, title: "Aria's Tale", titleTh: "นิทานอาเรีย", mode: "translate", styleNote: "ใช้ภาษาพูดสบายๆ" },
      chapter: { number: 1, title: "Chapter 1", sourceText: SOURCE_1, status: "draft", hasTranslation: false },
      glossary: [
        { source: "Aria", thai: "อาเรีย", note: "นางเอก" },
        { source: "Bram", thai: "บราม", note: "" },
      ],
      recaps: [{ number: 0, recap: "เรื่องย่อเดิม0" }],
      systemPrompt: ctx.system,
    })
    for (const needle of ["Aria", "อาเรีย", "บราม", "ใช้ภาษาพูดสบายๆ", "เรื่องย่อเดิม0", "Aria's Tale"]) {
      assert.ok(r.json.systemPrompt.includes(needle), `systemPrompt ต้องมี ${needle}`)
    }
    assert.deepEqual(Object.keys(r.json).sort(), ["chapter", "glossary", "novel", "recaps", "systemPrompt"])
    assert.deepEqual(Object.keys(r.json.novel).sort(), ["id", "mode", "styleNote", "title", "titleTh"])
    assert.deepEqual(Object.keys(r.json.chapter).sort(), ["hasTranslation", "number", "sourceText", "status", "title"])
  })
})

test("GET โจทย์ของตอน: เรื่องย่อบริบทไม่เกิน 5 ตอนก่อนหน้าที่มีเรื่องย่อจริง เรียงน้อย→มาก (ข้ามตอนที่ไม่มี/มีแต่ช่องว่าง ไม่เอาตอนหลัง) · โหมดเล่าเรื่องได้ prompt ของโหมดนั้น", async () => {
  await withLib(async ({ t, lib, c }) => {
    const sagaChapter = (number: number): number => t.db.get<{ id: number }>("SELECT id FROM chapters WHERE novel_id = ? AND number = ?", lib.saga, number)!.id

    const r = await get(c, briefPath(lib.saga, 9))
    assert.equal(r.status, 200)
    assert.deepEqual(
      r.json.recaps,
      [2, 3, 6, 7, 8].map((n) => ({ number: n, recap: `เรื่องย่อตอน${n}` })),
    )
    assert.equal(r.json.systemPrompt, buildContext(t.db, sagaChapter(9))!.system)
    assert.equal(r.json.novel.mode, "story")
    assert.ok(r.json.systemPrompt.includes("เรื่องย่อตอน2"))
    assert.ok(!r.json.systemPrompt.includes("เรื่องย่อตอน1"), "ไม่มีทั้งตอน 1 (เกินเพดาน 5 ตอน) และตอน 10 (อยู่หลังตอนนี้)")

    const first = await get(c, briefPath(lib.saga, 1))
    assert.deepEqual(first.json.recaps, [])
    assert.equal(first.json.systemPrompt, buildContext(t.db, sagaChapter(1))!.system)

    const sixth = await get(c, briefPath(lib.saga, 6))
    assert.deepEqual(
      sixth.json.recaps.map((x: { number: number }) => x.number),
      [1, 2, 3],
      "ตอน 4 ไม่มีเรื่องย่อ · ตอน 5 มีแต่ช่องว่าง",
    )
  })
})

test("GET โจทย์ของตอนที่แปลแล้ว: บอกแค่ hasTranslation (ไม่ส่งคำแปลเดิมกลับ) · ใช้ได้กับทุกสถานะ รวมตอนที่เผยแพร่อยู่", async () => {
  await withLib(async ({ lib, c }) => {
    const done = await get(c, briefPath(lib.aria, 5))
    assert.equal(done.status, 200)
    assert.deepEqual(done.json.chapter, { number: 5, title: "Chapter 5", sourceText: "Source text of chapter 5.", status: "done", hasTranslation: true })
    for (const number of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      assert.equal((await get(c, briefPath(lib.aria, number))).status, 200, `ตอน ${number}`)
    }
  })
})

test("GET ไม่ส่งข้อมูลหลังบ้านอื่นออกไปเลย: ผู้เขียน เรื่องย่อต้นฉบับ ลิขสิทธิ์ ลิงก์ที่มา คำแปลเดิม ข้อความผิดพลาด อภิธานของเรื่องอื่น · และไม่มีโทเค็น/รหัสผ่าน", async () => {
  await withLib(async ({ lib, c }) => {
    const responses: ClientResponse[] = []
    for (const novel of [lib.aria, lib.other, lib.saga, lib.empty]) responses.push(await get(c, listPath(novel)))
    for (let number = 0; number <= 9; number++) responses.push(await get(c, briefPath(lib.aria, number)))
    responses.push(await get(c, briefPath(lib.saga, 9)))
    assert.ok(responses.every((r) => r.status === 200))

    const everything = responses.map((r) => r.text).join("\n")
    for (const secret of ["SECRET", "example.com", TOKEN, TEST_PASSWORD, "Bearer"]) {
      assert.ok(!everything.includes(secret), `คำตอบต้องไม่มี ${secret}`)
    }
    for (const response of responses.slice(4)) {
      assert.ok(!("published" in response.json.novel), "ไม่บอกสถานะเผยแพร่ของเรื่อง")
      assert.ok(!("chapterCount" in response.json.novel))
    }
  })
})
