import { test } from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import { AiError } from "../src/ai.js"
import { API_CHECK_KEY, readApiCheck, writeApiCheck } from "../src/api-check.js"
import { ACCENTS } from "../src/settings.js"
import { NO_API_KEY_MESSAGE } from "../src/util/errors.js"
import { nowSql } from "../src/util/time.js"
import { withTestApp, TEST_IMPORT_TOKEN, TEST_PASSWORD, type Client, type TestApp } from "./helpers/app.js"
import { createClock } from "./helpers/clock.js"
import type { FakeAi } from "./helpers/fake-ai.js"

const THAI = /[฀-๿]/
const SETTINGS = "/api/admin/settings"
const TEST_API = `${SETTINGS}/test-api`
const DASHBOARD = "/api/admin/dashboard"
type T = TestApp<FakeAi>

const SONNET = "claude-sonnet-5-5"
const HAIKU = "claude-haiku-4-5-20251001"
const API_KEY = "sk-ant-api03-SECRET-KEY-VALUE-123"
const SESSION_SECRET = "session-secret-value-for-the-test-0123456789"

/** คีย์ทั้งหมดของ GET /settings (ช่องตั้งค่า 9 ช่อง + 3 ช่องที่ระบบคำนวณ) เรียงตามตัวอักษร */
const VIEW_KEYS = ["aboutText", "accent", "apiKeySet", "contactText", "importTokenSet", "importUrl", "indexable", "prices", "recapModel", "siteName", "tagline", "translateModel"]

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

const sorted = (o: object): string[] => Object.keys(o).sort()

/** ทุกอย่างที่เส้นทางตั้งค่าอาจเขียนหรือก่อผล: ตารางตั้งค่า ยอดโทเคน และการเรียก Claude */
const stateOf = (t: T): string => JSON.stringify([t.db.all("SELECT * FROM settings ORDER BY key"), t.db.all("SELECT * FROM usage ORDER BY day, model"), t.ai.calls])

/** ส่ง body เป็นข้อความดิบ (ไว้ทดสอบ JSON เสียรูป และคีย์อย่าง `__proto__` ที่ออบเจ็กต์ JavaScript สร้างตรงๆ ไม่ได้) */
const putRaw = (t: T, c: Client, body: string) => c.raw(SETTINGS, { method: "PUT", headers: { Origin: t.base, "Content-Type": "application/json" }, body })

const errorLogs = (t: T): string[] => t.logs.filter((line) => line.startsWith("error:"))
const problemLogs = (t: T): string[] => t.logs.filter((line) => /^(warn|error):/.test(line))

/** GET แบบ HTTP/1.0 ที่ไม่มีหัว Host (ไคลเอนต์ทั่วไปส่ง Host เสมอ จึงต้องคุยผ่านซ็อกเก็ตดิบ) */
function getWithoutHost(port: number, pathname: string, cookie: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1")
    let data = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk) => void (data += chunk))
    socket.on("error", reject)
    socket.on("close", () => {
      const split = data.indexOf("\r\n\r\n")
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1]), body: split < 0 ? "" : data.slice(split + 4) })
    })
    socket.write(`GET ${pathname} HTTP/1.0\r\nCookie: ${cookie}\r\n\r\n`)
  })
}

// ═════════════════════════ ต้องล็อกอิน ═════════════════════════

test("ทุกเส้นทางตั้งค่าต้องล็อกอิน: ไม่มี cookie → 401 ไม่อ่าน ไม่แก้ ไม่เรียก Claude ไม่เก็บผลทดสอบ", async () => {
  await withTestApp({ config: { anthropicApiKey: API_KEY } }, async (t) => {
    const stranger = t.client()
    const before = stateOf(t)
    const responses = [
      await stranger.get(SETTINGS),
      await stranger.put(SETTINGS, { siteName: "ถูกแฮ็ก", accent: "pink" }),
      await stranger.post(TEST_API),
    ]
    for (const r of responses) {
      assert.equal(r.status, 401)
      assert.equal(r.json.code, "unauthorized")
      assert.match(r.json.error, THAI)
      assert.equal(r.json.siteName, undefined, "ไม่รั่วค่าตั้งให้คนแปลกหน้า")
    }
    assert.equal(stateOf(t), before)
    assert.deepEqual(t.ai.calls, [])
    assert.equal(t.settings.get().siteName, "koymukarnnovel")
    assert.equal(t.settings.getInternal(API_CHECK_KEY), "")
  })
})

test("ด่านตรวจ Origin: PUT และ test-api จากเว็บต่างโดเมน → 403 ไม่แก้ค่าตั้ง ไม่เรียก Claude", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const before = stateOf(t)
    const evil = { headers: { Origin: "https://evil.test" } }
    assert.equal((await c.put(SETTINGS, { siteName: "ถูกแฮ็ก" }, evil)).status, 403)
    assert.equal((await c.post(TEST_API, undefined, evil)).status, 403)
    assert.equal(stateOf(t), before)
    assert.deepEqual(t.ai.calls, [])
  })
})

// ═════════════════════════ GET /settings ═════════════════════════

test("GET /settings: ครบทุกช่องของ SiteSettings + apiKeySet / importTokenSet / importUrl · JSON ห้ามแคช · อ่านอย่างเดียว", async () => {
  await withTestApp({}, async (t) => {
    t.settings.update({ siteName: "นิยายของฉัน", accent: "teal", prices: { [HAIKU]: { in: 1, out: 5 } } })
    const before = stateOf(t)
    const r = await (await adminClient(t)).get(SETTINGS)
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
    assert.equal(r.headers.get("cache-control"), "no-store")
    assert.deepEqual(sorted(r.json), VIEW_KEYS)
    assert.deepEqual(r.json, { ...t.settings.get(), apiKeySet: true, importTokenSet: true, importUrl: `${t.base}/api/import` })
    assert.equal(r.json.siteName, "นิยายของฉัน")
    assert.equal(stateOf(t), before)
  })
})

test("GET /settings ค่าตั้งต้นของระบบใหม่: ชื่อเว็บ koymukarnnovel, ชุดสีเริ่มต้น, เปิดให้เสิร์ชเอนจินเห็น, โมเดลตาม config, ยังไม่มีราคา", async () => {
  await withTestApp({ config: { translateModel: "claude-x-1", recapModel: "claude-y-2" } }, async (t) => {
    const r = await (await adminClient(t)).get(SETTINGS)
    assert.equal(r.json.siteName, "koymukarnnovel")
    assert.equal(r.json.accent, "default")
    assert.equal(r.json.indexable, true)
    assert.equal(r.json.translateModel, "claude-x-1")
    assert.equal(r.json.recapModel, "claude-y-2")
    assert.deepEqual(r.json.prices, {})
    assert.equal(r.json.contactText, "")
  })
})

test("apiKeySet ตามว่ามี API key (ai.hasKey) และ importTokenSet ตามว่าตั้ง IMPORT_TOKEN ไว้ — เป็นจริง/เท็จเท่านั้น ไม่ใช่ค่าจริง", async () => {
  await withTestApp({ config: { anthropicApiKey: API_KEY } }, async (t) => {
    const c = await adminClient(t)
    for (const [hasKey, token] of [
      [true, TEST_IMPORT_TOKEN],
      [false, TEST_IMPORT_TOKEN],
      [true, null],
      [false, null],
    ] as const) {
      t.ai.script.hasKey = hasKey
      t.config.importToken = token
      const { apiKeySet, importTokenSet } = (await c.get(SETTINGS)).json
      assert.deepEqual({ apiKeySet, importTokenSet }, { apiKeySet: hasKey, importTokenSet: token !== null }, `key=${hasKey} token=${token !== null}`)
    }
  })
})

test("importUrl: ใช้ PUBLIC_URL ถ้าตั้งไว้ ไม่งั้นอ่านจากที่อยู่ที่ผู้ดูแลเปิดหน้านี้อยู่", async () => {
  await withTestApp({}, async (t) => {
    assert.equal((await (await adminClient(t)).get(SETTINGS)).json.importUrl, `${t.base}/api/import`)
  })
  await withTestApp({ config: { publicUrl: "https://novel.example.test:8443" } }, async (t) => {
    const r = await (await adminClient(t)).get(SETTINGS)
    assert.equal(r.json.importUrl, "https://novel.example.test:8443/api/import")
  })
})

test("importUrl เมื่อคำขอไม่มีหัว Host (HTTP/1.0) และไม่ได้ตั้ง PUBLIC_URL → localhost กับพอร์ตที่ตั้งไว้", async () => {
  await withTestApp({ config: { port: 8787 } }, async (t) => {
    const c = await adminClient(t)
    const cookie = [...c.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
    const r = await getWithoutHost(t.port, SETTINGS, cookie)
    assert.equal(r.status, 200, r.body)
    assert.equal(JSON.parse(r.body).importUrl, "http://localhost:8787/api/import")
  })
})

test("ไม่มีความลับในคำตอบ ในฐานข้อมูล หรือใน log: รหัสผ่านผู้ดูแล, ANTHROPIC_API_KEY, IMPORT_TOKEN, ความลับของเซสชัน — ทั้งตอนอ่าน แก้ และทดสอบ API", async () => {
  const secrets = [API_KEY, TEST_PASSWORD, TEST_IMPORT_TOKEN, SESSION_SECRET]
  await withTestApp({ config: { anthropicApiKey: API_KEY, sessionSecret: SESSION_SECRET } }, async (t) => {
    const c = await adminClient(t)
    const responses = [
      await c.get(SETTINGS),
      await c.put(SETTINGS, { siteName: "ชื่อใหม่", accent: "pink" }),
      await c.put(SETTINGS, { accent: "ไม่มีชุดสีนี้" }),
      await c.post(TEST_API),
      await c.get(DASHBOARD),
    ]
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 400, 200, 200])
    const stored = JSON.stringify(["settings", "usage", "views", "novels", "chapters", "glossary"].map((table) => t.db.all(`SELECT * FROM ${table}`)))
    for (const secret of secrets) {
      const label = `${secret.slice(0, 8)}…`
      for (const r of responses) assert.ok(!r.text.includes(secret), `คำตอบรั่ว ${label}`)
      assert.ok(!stored.includes(secret), `ฐานข้อมูลมี ${label}`)
      assert.ok(!t.logs.join("\n").includes(secret), `log มี ${label}`)
    }
  })
})

// ═════════════════════════ PUT /settings ═════════════════════════

test("PUT /settings: บันทึกทุกช่อง ล้างข้อความให้เรียบร้อย ตอบชุดใหม่ในรูปแบบเดียวกับ GET และอ่านซ้ำได้เหมือนกัน", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const prices = { [SONNET]: { in: 3, out: 15 }, [HAIKU]: { in: 1, out: 5 } }
    const r = await c.put(SETTINGS, {
      siteName: "  นิยายของฉัน  ",
      tagline: " อ่านเพลิน ",
      aboutText: "บรรทัดหนึ่ง\r\n\r\n\r\n\r\nบรรทัดสอง  ",
      contactText: "ติดต่อ me@example.com ",
      accent: "teal",
      indexable: false,
      translateModel: "claude-test-translate-1",
      recapModel: "claude-test-recap_2.0",
      prices,
    })
    assert.equal(r.status, 200, r.text)
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/)
    assert.deepEqual(r.json, {
      siteName: "นิยายของฉัน",
      tagline: "อ่านเพลิน",
      aboutText: "บรรทัดหนึ่ง\n\nบรรทัดสอง",
      contactText: "ติดต่อ me@example.com",
      accent: "teal",
      indexable: false,
      translateModel: "claude-test-translate-1",
      recapModel: "claude-test-recap_2.0",
      prices,
      apiKeySet: true,
      importTokenSet: true,
      importUrl: `${t.base}/api/import`,
    })
    assert.deepEqual((await c.get(SETTINGS)).json, r.json)
    const { apiKeySet: _a, importTokenSet: _i, importUrl: _u, ...saved } = r.json
    assert.deepEqual(saved, t.settings.get())
  })
})

test("PUT /settings ส่งบางช่อง: เปลี่ยนเฉพาะช่องที่ส่ง ช่องอื่นคงเดิม (รวมช่องที่เจ้าของตั้งเป็นค่าว่างเอง) · {} = ไม่เปลี่ยนอะไรแต่ตอบ 200", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    assert.equal((await c.put(SETTINGS, { tagline: "", siteName: "ชื่อแรก" })).status, 200)
    const before = stateOf(t)
    const noop = await c.put(SETTINGS, {})
    assert.equal(noop.status, 200)
    assert.equal(noop.json.siteName, "ชื่อแรก")
    assert.equal(stateOf(t), before)

    const r = await c.put(SETTINGS, { accent: "pink" })
    assert.equal(r.status, 200)
    assert.equal(r.json.accent, "pink")
    assert.equal(r.json.siteName, "ชื่อแรก")
    assert.equal(r.json.tagline, "", "ช่องที่เจ้าของเว้นว่างเองยังว่าง ไม่กลับเป็นค่าตั้งต้น")
  })
})

test("PUT /settings: ชุดสีทุกแบบในรายการใช้ได้ (6 แบบ)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    assert.equal(ACCENTS.length, 6)
    for (const accent of ACCENTS) {
      const r = await c.put(SETTINGS, { accent })
      assert.equal(r.status, 200, accent)
      assert.equal(r.json.accent, accent)
      assert.equal((await c.get(SETTINGS)).json.accent, accent)
    }
  })
})

test("PUT /settings prices: แทนที่ทั้งชุด (ไม่ผสมกับของเดิม) และส่ง {} เพื่อล้างราคาได้", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const first = { [SONNET]: { in: 3, out: 15 }, [HAIKU]: { in: 1, out: 5 } }
    const second = { [HAIKU]: { in: 0.8, out: 4 } }
    assert.deepEqual((await c.put(SETTINGS, { prices: first })).json.prices, first)
    assert.deepEqual((await c.put(SETTINGS, { prices: second })).json.prices, second)
    assert.deepEqual((await c.get(SETTINGS)).json.prices, second)
    assert.deepEqual((await c.put(SETTINGS, { prices: {} })).json.prices, {})
  })
})

/** ค่าที่ผิดของแต่ละช่อง (ทุกช่องต้องปฏิเสธ `null` ด้วย) */
const BAD: Record<string, unknown[]> = {
  siteName: ["", "   ", "x".repeat(81), 5, null],
  tagline: ["x".repeat(161), 5, null],
  aboutText: ["x".repeat(5001), ["a"], null],
  contactText: ["x".repeat(2001), {}, null],
  accent: ["rainbow", "", "Default", 1, null],
  indexable: ["true", 1, 0, null],
  translateModel: ["", "has space", "bad/slash", "x".repeat(101), 5, null],
  recapModel: ["", "has space", "bad/slash", "x".repeat(101), 5, null],
  prices: [[], "x", 5, null, { m: { in: -1, out: 1 } }, { m: { in: 1 } }, { m: { in: "3", out: 1 } }, { "bad model": { in: 1, out: 1 } }, { m: null }],
}

test("PUT /settings ค่าที่ผิด → 400 invalid_field บอกช่องที่ผิดด้วยข้อความไทยเฉพาะช่อง · ผิดข้อเดียวไม่บันทึกอะไรเลย แม้ช่องอื่นถูกต้อง", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.settings.update({ siteName: "ชื่อเดิม" })
    const before = stateOf(t)
    const messages = new Map<string, string>()
    for (const [field, values] of Object.entries(BAD)) {
      const companion = field === "tagline" ? { siteName: "ชื่อที่ถูกต้อง" } : { tagline: "สโลแกนที่ถูกต้อง" }
      for (const value of values) {
        const label = `${field} = ${JSON.stringify(value)?.slice(0, 40)}`
        const r = await c.put(SETTINGS, { ...companion, [field]: value })
        assert.equal(r.status, 400, label)
        assert.equal(r.json.code, "invalid_field", label)
        assert.equal(r.json.field, field, label)
        assert.match(r.json.error, THAI, label)
        assert.equal(stateOf(t), before, `${label}: ต้องไม่บันทึกอะไรเลย`)
        messages.set(field, r.json.error)
      }
    }
    assert.deepEqual([...messages.keys()].sort(), Object.keys(BAD).sort())
    assert.equal(new Set(messages.values()).size, Object.keys(BAD).length, "แต่ละช่องมีข้อความผิดพลาดของตัวเอง")
    assert.equal(t.settings.get().siteName, "ชื่อเดิม")
  })
})

test("PUT /settings ผิดหลายช่องพร้อมกัน: บอกช่องแรกตามลำดับในหน้าตั้งค่า (ชื่อเว็บ → … → ชุดสี → … → ราคา)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const r = await c.put(SETTINGS, { prices: "x", accent: "rainbow", recapModel: "bad/slash" })
    assert.equal(r.status, 400)
    assert.equal(r.json.field, "accent")
    const r2 = await c.put(SETTINGS, { prices: "x", recapModel: "bad/slash" })
    assert.equal(r2.json.field, "recapModel")
  })
})

test("PUT /settings เมินคีย์ที่ไม่รู้จัก โดยเฉพาะความลับและค่าภายในของระบบ: ไม่เขียนลงฐานข้อมูล ไม่เปลี่ยนค่าตั้งของเซิร์ฟเวอร์ ไม่เปลี่ยนรหัสผ่าน", async () => {
  await withTestApp({ config: { anthropicApiKey: API_KEY } }, async (t) => {
    const c = await adminClient(t)
    const forged = JSON.stringify({ at: "2030-01-01 00:00:00", ok: true, message: "ปลอม" })
    const r = await c.put(SETTINGS, {
      siteName: "ชื่อที่ถูกต้อง",
      adminPassword: "hacked-password-123",
      ADMIN_PASSWORD: "hacked-password-123",
      anthropicApiKey: "sk-ant-api03-HACKED-KEY-0000",
      importToken: "hacked-import-token-0123456789abcdef",
      sessionSecret: "hacked",
      apiKeySet: false,
      importTokenSet: false,
      importUrl: "https://evil.example/api/import",
      queue_paused_reason: "ถูกหยุดโดยแฮ็กเกอร์",
      [API_CHECK_KEY]: forged,
    })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.siteName, "ชื่อที่ถูกต้อง")
    assert.equal(r.json.apiKeySet, true)
    assert.equal(r.json.importTokenSet, true)
    assert.equal(r.json.importUrl, `${t.base}/api/import`)
    assert.deepEqual(sorted(r.json), VIEW_KEYS)

    assert.deepEqual(t.db.all("SELECT key FROM settings ORDER BY key"), [{ key: "siteName" }])
    assert.equal(t.queue.state().paused, false)
    assert.equal(t.settings.getInternal(API_CHECK_KEY), "")
    assert.equal(t.config.adminPassword, TEST_PASSWORD)
    assert.equal(t.config.anthropicApiKey, API_KEY)
    assert.equal(t.config.importToken, TEST_IMPORT_TOKEN)
    assert.equal(t.config.sessionSecret, "")
    assert.equal((await t.client().post("/api/admin/login", { password: "hacked-password-123" })).status, 401)
    assert.equal((await t.client().post("/api/admin/login", { password: TEST_PASSWORD })).status, 200)
  })
})

test("PUT /settings: __proto__ และ constructor ในข้อมูลไม่ทำให้ Object.prototype หรือค่าตั้งเพี้ยน", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const body = '{"__proto__":{"accent":"pink","siteName":"แฮ็ก"},"constructor":{"prototype":{"accent":"pink"}},"tagline":"สโลแกนใหม่"}'
    const r = await putRaw(t, c, body)
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.tagline, "สโลแกนใหม่")
    assert.equal(r.json.accent, "default")
    assert.equal(r.json.siteName, "koymukarnnovel")
    assert.equal(({} as Record<string, unknown>).accent, undefined)
    assert.deepEqual(t.db.all("SELECT key FROM settings ORDER BY key"), [{ key: "tagline" }])
  })
})

test("PUT /settings body ต้องเป็นออบเจ็กต์ JSON: อาร์เรย์/ไม่มี body → 400 bad_request · JSON เสียรูปหรือไม่ใช่ออบเจ็กต์ → 400 bad_json · ไม่บันทึกอะไร", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const before = stateOf(t)
    for (const body of [[], undefined]) {
      const r = await c.put(SETTINGS, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, "bad_request")
      assert.match(r.json.error, THAI)
    }
    for (const raw of ['"x"', "5", "null", "{oops"]) {
      const r = await putRaw(t, c, raw)
      assert.equal(r.status, 400, raw)
      assert.equal(r.json.code, "bad_json", raw)
    }
    assert.equal(stateOf(t), before)
  })
})

// ═════════════════════════ POST /settings/test-api ═════════════════════════

test("test-api สำเร็จ: ตอบ ok:true ข้อความไทยบอกโมเดล · ping ด้วยโมเดลสรุป (ไม่รับโมเดลจาก body) · บันทึกโทเคนของวันนี้ · เก็บผลไว้ให้ Dashboard", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    t.ai.script.ping = () => ({ usage: { inputTokens: 7, outputTokens: 3 } })
    const c = await adminClient(t)

    const r = await c.post(TEST_API, { model: "claude-evil-9" })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(sorted(r.json), ["message", "ok"])
    assert.equal(r.json.ok, true)
    assert.match(r.json.message, THAI)
    assert.ok(r.json.message.includes(HAIKU), r.json.message)
    assert.deepEqual(t.ai.calls, [{ method: "ping", model: HAIKU }])
    assert.deepEqual(t.db.all("SELECT day, model, tokens_in, tokens_out, calls FROM usage"), [{ day: "2026-10-22", model: HAIKU, tokens_in: 7, tokens_out: 3, calls: 1 }])
    assert.deepEqual((await c.get(DASHBOARD)).json.api.lastOk, { at: "2026-10-22 01:02:03", ok: true, message: r.json.message })

    // ครั้งที่สอง: ยอดโทเคนสะสม และเวลา/ผลล่าสุดถูกแทนที่
    clock.advance(90_000)
    assert.equal((await c.post(TEST_API)).json.ok, true)
    assert.deepEqual(t.db.all("SELECT tokens_in, tokens_out, calls FROM usage"), [{ tokens_in: 14, tokens_out: 6, calls: 2 }])
    assert.equal((await c.get(DASHBOARD)).json.api.lastOk.at, "2026-10-22 01:03:33")
    assert.deepEqual(problemLogs(t), [])
  })
})

test("test-api ใช้โมเดลสรุปที่ตั้งไว้ในหน้าตั้งค่าตอนนั้น (เปลี่ยนแล้วมีผลทันที) และบันทึกโทเคนให้โมเดลนั้น", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    assert.equal((await c.put(SETTINGS, { recapModel: "claude-test-recap-2", translateModel: "claude-test-translate-2" })).status, 200)
    const r = await c.post(TEST_API)
    assert.equal(r.json.ok, true)
    assert.ok(r.json.message.includes("claude-test-recap-2"), r.json.message)
    assert.deepEqual(t.ai.calls, [{ method: "ping", model: "claude-test-recap-2" }])
    assert.deepEqual(t.db.all("SELECT model FROM usage"), [{ model: "claude-test-recap-2" }])
  })
})

test("test-api ที่ Claude ตอบผิดพลาด (AiError ทั้ง fatal และไม่ fatal) → HTTP 200 {ok:false, message ไทยของ AiError} เก็บเป็นผลล่าสุด ไม่นับโทเคน ไม่ใช่ error ของระบบ", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const failures = [
      new AiError("API key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้โมเดลนี้ (HTTP 401)", { fatal: true, status: 401 }),
      new AiError("Claude API ขัดข้อง (HTTP 529) ลองใหม่ภายหลัง", { fatal: false, status: 529 }),
    ]
    for (const failure of failures) {
      t.ai.script.ping = () => {
        throw failure
      }
      const at = nowSql(clock.now())
      const r = await c.post(TEST_API)
      assert.equal(r.status, 200)
      assert.deepEqual(r.json, { ok: false, message: failure.message })
      assert.deepEqual((await c.get(DASHBOARD)).json.api.lastOk, { at, ok: false, message: failure.message })
      clock.advance(1000)
    }
    assert.deepEqual(t.db.all("SELECT * FROM usage"), [], "ล้มเหลวแล้วไม่มีโทเคนให้นับ")
    assert.deepEqual(problemLogs(t), [])

    // ทดสอบใหม่แล้วผ่าน → ผลล่าสุดเปลี่ยนเป็นสำเร็จ
    t.ai.script.ping = () => undefined
    assert.equal((await c.post(TEST_API)).json.ok, true)
    assert.equal((await c.get(DASHBOARD)).json.api.lastOk.ok, true)
  })
})

test("test-api เมื่อยังไม่ได้ตั้ง ANTHROPIC_API_KEY → {ok:false} บอกให้ตั้งค่า (HTTP 200) และเก็บเป็นผลล่าสุด", async () => {
  await withTestApp({}, async (t) => {
    t.ai.script.hasKey = false
    const c = await adminClient(t)
    const r = await c.post(TEST_API)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: false, message: NO_API_KEY_MESSAGE })
    assert.deepEqual(t.db.all("SELECT * FROM usage"), [])
    const api = (await c.get(DASHBOARD)).json.api
    assert.equal(api.hasKey, false)
    assert.equal(api.lastOk.ok, false)
    assert.equal(api.lastOk.message, NO_API_KEY_MESSAGE)
  })
})

test("test-api เจอข้อผิดพลาดที่ไม่คาดคิด (ไม่ใช่ AiError) → {ok:false} ข้อความไทยทั่วไป ไม่รั่วรายละเอียด แต่บันทึก error ใน log ให้ผู้ดูแลตามได้", async () => {
  await withTestApp({ expectErrorLogs: true }, async (t) => {
    t.ai.script.ping = () => {
      throw new TypeError("boom-internal-detail")
    }
    const c = await adminClient(t)
    const r = await c.post(TEST_API)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, false)
    assert.match(r.json.message, THAI)
    assert.doesNotMatch(r.text, /boom-internal-detail|TypeError/)
    assert.equal(errorLogs(t).length, 1)
    assert.match(errorLogs(t)[0] as string, /boom-internal-detail/)
    const lastOk = (await c.get(DASHBOARD)).json.api.lastOk
    assert.deepEqual({ ok: lastOk.ok, message: lastOk.message }, { ok: false, message: r.json.message })
  })
})

test("test-api: บันทึกโทเคนไม่สำเร็จไม่ทำให้การทดสอบล้ม (ยังตอบ ok:true) แต่เตือนใน log", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    t.db.exec("DROP TABLE usage")
    const r = await c.post(TEST_API)
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.deepEqual(errorLogs(t), [])
    const warnings = t.logs.filter((line) => line.startsWith("warn:"))
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] as string, /โทเคน/)
    assert.equal(readApiCheck(t.settings)?.ok, true)
  })
})

test("test-api: ข้อความยาวเกิน 500 ตัวอักษรถูกตัด (ทั้งที่ตอบและที่เก็บ)", async () => {
  await withTestApp({}, async (t) => {
    t.ai.script.ping = () => {
      throw new AiError("ก".repeat(900), { fatal: false })
    }
    const c = await adminClient(t)
    const r = await c.post(TEST_API)
    assert.equal(r.json.ok, false)
    assert.equal(r.json.message, "ก".repeat(500))
    assert.equal(readApiCheck(t.settings)?.message, "ก".repeat(500))
  })
})

// ═════════════════════════ ผลทดสอบ API ที่เก็บไว้ (api-check) ═════════════════════════

test("api-check: เขียนแล้วอ่านกลับได้เหมือนเดิม (เวลาเป็น UTC รูปแบบฐานข้อมูล) · ยังไม่เคยเขียน = null · เขียนใหม่ทับของเก่า", async () => {
  await withTestApp({}, async (t) => {
    assert.equal(readApiCheck(t.settings), null)
    const first = writeApiCheck(t.settings, true, "เชื่อมต่อได้", new Date("2026-10-22T01:02:03.456Z"))
    assert.deepEqual(first, { at: "2026-10-22 01:02:03", ok: true, message: "เชื่อมต่อได้" })
    assert.deepEqual(readApiCheck(t.settings), first)
    const second = writeApiCheck(t.settings, false, "พัง", new Date("2026-10-23T00:00:00Z"))
    assert.deepEqual(readApiCheck(t.settings), second)
    assert.deepEqual(t.db.all("SELECT key FROM settings"), [{ key: API_CHECK_KEY }], "เก็บเป็นแถวเดียวในค่าภายใน")
  })
})
