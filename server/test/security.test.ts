import { test } from "node:test"
import assert from "node:assert/strict"
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express"
import {
  CSP,
  clientIp,
  createFailureLimiter,
  createRateLimiter,
  loopbackHostOnly,
  originGuard,
  securityHeaders,
  warnForwardedOnce,
} from "../src/security.js"
import { memoryLogger, type Logger } from "../src/util/log.js"
import { rawRequest, rawSocketRequest, withServer, type RawResponse } from "./helpers/http.js"

const MINUTE = 60_000
const THAI = /[฀-๿]/

/** นาฬิกาจำลอง: `at(ms)` ย้ายไปที่เวลา start + ms */
function clock(start = 1_700_000_000_000) {
  let t = start
  return { now: () => t, at: (offsetMs: number) => void (t = start + offsetMs) }
}

// ═════════════════════════ createRateLimiter ═════════════════════════

test("ตัวจำกัดอัตรา 120 ครั้ง/นาที: ครั้งที่ 121 ถูกปฏิเสธ และพ้นหน้าต่างแล้วผ่านใหม่", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: MINUTE, max: 120, now: c.now })
  for (let i = 1; i <= 120; i++) assert.deepEqual(rl.hit("203.0.113.7"), { allowed: true, retryAfterSec: 0 }, `ครั้งที่ ${i}`)
  assert.deepEqual(rl.hit("203.0.113.7"), { allowed: false, retryAfterSec: 60 })
  c.at(MINUTE)
  assert.deepEqual(rl.hit("203.0.113.7"), { allowed: true, retryAfterSec: 0 })
})

test("retryAfterSec = เวลาที่เหลือของหน้าต่าง ปัดขึ้นเป็นวินาที และไม่ต่ำกว่า 1 จนกว่าจะหมดหน้าต่าง", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: MINUTE, max: 1, now: c.now })
  assert.equal(rl.hit("k").allowed, true) // เปิดหน้าต่างที่ 0 → หมดอายุที่ 60_000
  const retryAt = (offsetMs: number) => {
    c.at(offsetMs)
    const r = rl.hit("k")
    assert.equal(r.allowed, false, `ที่ ${offsetMs} ms ยังต้องถูกปฏิเสธ`)
    return r.retryAfterSec
  }
  assert.equal(retryAt(20_500), 40, "เหลือ 39.5 วินาที → 40")
  assert.equal(retryAt(30_000), 30, "เหลือ 30.0 พอดี")
  assert.equal(retryAt(58_999), 2, "เหลือ 1.001 → 2")
  assert.equal(retryAt(59_000), 1, "เหลือ 1.000 พอดี")
  assert.equal(retryAt(59_999), 1, "เหลือ 1 มิลลิวินาทีก็ยังเป็น 1 ไม่ใช่ 0")
  c.at(MINUTE)
  assert.deepEqual(rl.hit("k"), { allowed: true, retryAfterSec: 0 }, "หมดอายุเมื่อถึง resetAt พอดี")
})

test("ครั้งที่ถูกปฏิเสธไม่ต่ออายุหน้าต่าง (ยิงถี่แค่ไหนก็ติดไม่เกินหนึ่งหน้าต่าง)", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: MINUTE, max: 2, now: c.now })
  rl.hit("k")
  rl.hit("k")
  for (let at = 1_000; at < MINUTE; at += 1_000) {
    c.at(at)
    assert.equal(rl.hit("k").allowed, false, `ที่ ${at} ms`)
  }
  c.at(MINUTE)
  assert.equal(rl.hit("k").allowed, true)
  assert.equal(rl.hit("k").allowed, true, "หน้าต่างใหม่นับจาก 0 ไม่ใช่นับต่อจากครั้งที่ถูกปฏิเสธ")
  assert.equal(rl.hit("k").allowed, false)
})

test("แต่ละคีย์นับแยกกัน และหน้าต่างของคีย์เริ่มที่ครั้งแรกของคีย์นั้น", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: MINUTE, max: 2, now: c.now })
  rl.hit("a")
  rl.hit("a")
  assert.equal(rl.hit("a").allowed, false)
  assert.equal(rl.hit("b").allowed, true, "คีย์อื่นไม่ถูกกระทบ")
  c.at(30_000)
  rl.hit("c")
  rl.hit("c") // c เปิดหน้าต่างที่ 30_000 → หมดอายุที่ 90_000
  c.at(MINUTE)
  assert.equal(rl.hit("a").allowed, true, "หน้าต่างของ a จบแล้ว")
  assert.deepEqual(rl.hit("c"), { allowed: false, retryAfterSec: 30 }, "หน้าต่างของ c ยังไม่จบ")
})

test("sweep() ล้างเฉพาะคีย์ที่หมดอายุ (นับว่าหมดเมื่อถึง resetAt พอดี) และ size() ลดลง โดยคีย์ที่เหลือยังนับต่อ", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: MINUTE, max: 2, now: c.now })
  rl.hit("old1")
  rl.hit("old2")
  assert.equal(rl.size(), 2)
  c.at(30_000)
  rl.hit("fresh")
  assert.equal(rl.size(), 3)
  c.at(59_999)
  rl.sweep()
  assert.equal(rl.size(), 3, "ยังไม่ถึง resetAt")
  c.at(MINUTE)
  rl.sweep()
  assert.equal(rl.size(), 1, "old1/old2 ถูกล้าง fresh ยังอยู่")
  assert.equal(rl.hit("fresh").allowed, true)
  assert.equal(rl.hit("fresh").allowed, false, "fresh ยังจำครั้งก่อนหน้าได้ (นับ 2 ครั้งแล้ว)")
  c.at(90_000)
  rl.sweep()
  assert.equal(rl.size(), 0)
})

test("ไม่ใส่ now → ใช้นาฬิกาจริง (Date.now) ทั้งตอนเปิดและหมดหน้าต่าง", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 })
  const rl = createRateLimiter({ windowMs: MINUTE, max: 1 })
  assert.equal(rl.hit("k").allowed, true)
  t.mock.timers.tick(MINUTE - 1)
  assert.deepEqual(rl.hit("k"), { allowed: false, retryAfterSec: 1 })
  t.mock.timers.tick(1)
  assert.equal(rl.hit("k").allowed, true)
})

test("ตัวจำกัดล้างคีย์หมดอายุเองทุก 60 วินาที (timer ถูกสร้างตอน createRateLimiter ไม่ใช่ตอน import)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const c = clock()
  const rl = createRateLimiter({ windowMs: 1_000, max: 5, now: c.now })
  rl.hit("a")
  rl.hit("b")
  c.at(10_000) // ทั้งสองคีย์หมดอายุแล้ว แต่ยังไม่มีใครล้าง
  t.mock.timers.tick(59_999)
  assert.equal(rl.size(), 2, "ยังไม่ถึงรอบ 60 วินาที")
  t.mock.timers.tick(1)
  assert.equal(rl.size(), 0, "ครบ 60 วินาที sweep() ทำงานเอง")
})

test("timer ล้างคีย์ของทั้งตัวจำกัดอัตราและตัวจำกัดความผิดพลาดเป็น unref (ไม่ค้างโปรเซสไว้)", (t) => {
  const created: NodeJS.Timeout[] = []
  const realSetInterval = globalThis.setInterval
  t.mock.method(globalThis, "setInterval", ((handler: () => void, ms?: number) => {
    const handle = realSetInterval(handler, ms)
    created.push(handle)
    return handle
  }) as unknown as typeof setInterval)
  try {
    createRateLimiter({ windowMs: MINUTE, max: 1 })
    createFailureLimiter({ windowMs: MINUTE, max: 1 })
    assert.equal(created.length, 2, "ตัวจำกัดละหนึ่ง timer")
    for (const handle of created) assert.equal(handle.hasRef(), false)
  } finally {
    for (const handle of created) clearInterval(handle)
  }
})

test("maxKeys: ตารางเต็มแล้วล้างคีย์หมดอายุทั้งหมดก่อน แล้วค่อยไล่คีย์อื่นเมื่อจำเป็น", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: 1_000, max: 1, maxKeys: 3, now: c.now })
  rl.hit("a") // หมดอายุที่ 1_000
  c.at(100)
  rl.hit("b") // 1_100
  c.at(900)
  rl.hit("c") // 1_900
  c.at(1_200) // a, b หมดอายุแล้วแต่ยังค้างอยู่ในตาราง
  assert.equal(rl.size(), 3)
  rl.hit("d")
  assert.equal(rl.size(), 2, "ล้าง a และ b ที่หมดอายุทั้งคู่ เหลือ c กับ d")
  assert.equal(rl.hit("c").allowed, false, "c ยังนับต่อ")
})

test("maxKeys: ไม่มีคีย์หมดอายุให้ล้างก็ไล่คีย์ที่จะหมดอายุเร็วที่สุด (แม้คีย์นั้นถูกเปิดหน้าต่างใหม่ทีหลัง)", () => {
  const c = clock()
  const rl = createRateLimiter({ windowMs: 1_000, max: 1, maxKeys: 2, now: c.now })
  rl.hit("a") // หมดอายุที่ 1_000
  c.at(500)
  rl.hit("b") // หมดอายุที่ 1_500
  c.at(1_000)
  assert.equal(rl.hit("a").allowed, true, "a หมดอายุแล้ว เปิดหน้าต่างใหม่ → หมดอายุที่ 2_000")
  assert.equal(rl.size(), 2)
  rl.hit("c") // เต็ม ไม่มีคีย์หมดอายุ → ไล่ b (หมดอายุเร็วที่สุด) ไม่ใช่ a
  assert.equal(rl.size(), 2)
  assert.equal(rl.hit("a").allowed, false, "a ยังอยู่")
  assert.equal(rl.hit("c").allowed, false, "c ยังอยู่")
  assert.equal(rl.hit("b").allowed, true, "b ถูกไล่ไปแล้ว เริ่มนับใหม่")
})

test("maxKeys เริ่มต้น 10,000: คีย์แปลกหน้าไม่ทำให้ตารางโตไม่จำกัด", () => {
  const rl = createRateLimiter({ windowMs: MINUTE, max: 5 })
  for (let i = 0; i < 10_050; i++) rl.hit(`ip-${i}`)
  assert.equal(rl.size(), 10_000)
})

test("ตัวเลือกไม่ถูกต้องถูกปฏิเสธทันทีด้วยข้อความไทย (ไม่ปล่อยให้หน้าต่างเป็น NaN แล้วบล็อกถาวร)", () => {
  const bad: unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60000", undefined]
  for (const make of [createRateLimiter, createFailureLimiter]) {
    for (const v of bad) {
      const label = String(v)
      assert.throws(() => make({ windowMs: v as number, max: 1 }), (e) => e instanceof RangeError && /^windowMs ต้อง/.test(e.message) && THAI.test(e.message), `windowMs=${label}`)
      assert.throws(() => make({ windowMs: 1_000, max: v as number }), (e) => e instanceof RangeError && /^max ต้อง/.test(e.message) && THAI.test(e.message), `max=${label}`)
      if (v !== undefined) {
        assert.throws(() => make({ windowMs: 1_000, max: 1, maxKeys: v as number }), (e) => e instanceof RangeError && /^maxKeys ต้อง/.test(e.message) && THAI.test(e.message), `maxKeys=${label}`)
      }
    }
    assert.doesNotThrow(() => make({ windowMs: 1, max: 1, maxKeys: 1 }))
  }
})

// ═════════════════════════ createFailureLimiter ═════════════════════════

test("ตัวจำกัดความผิดพลาด 10 ครั้ง/15 นาที: ผิดครบ 10 ครั้งจึงถูกบล็อก และครบ 15 นาทีแล้วปลดเอง", () => {
  const c = clock()
  const fl = createFailureLimiter({ windowMs: 15 * MINUTE, max: 10, now: c.now })
  assert.deepEqual(fl.check("1.2.3.4"), { blocked: false, retryAfterSec: 0 }, "ยังไม่เคยผิด")
  for (let i = 1; i <= 9; i++) {
    fl.recordFailure("1.2.3.4")
    assert.deepEqual(fl.check("1.2.3.4"), { blocked: false, retryAfterSec: 0 }, `ผิด ${i} ครั้ง`)
  }
  fl.recordFailure("1.2.3.4")
  assert.deepEqual(fl.check("1.2.3.4"), { blocked: true, retryAfterSec: 900 })
  c.at(15 * MINUTE - 1)
  assert.deepEqual(fl.check("1.2.3.4"), { blocked: true, retryAfterSec: 1 })
  c.at(15 * MINUTE)
  assert.deepEqual(fl.check("1.2.3.4"), { blocked: false, retryAfterSec: 0 })
})

test("หน้าต่างนับจากความผิดครั้งแรก ไม่ต่ออายุเมื่อผิดซ้ำ แม้ถูกบล็อกอยู่แล้ว", () => {
  const c = clock()
  const fl = createFailureLimiter({ windowMs: 15 * MINUTE, max: 3, now: c.now })
  fl.recordFailure("k") // 0 → เปิดหน้าต่าง หมดอายุที่ 15 นาที
  c.at(5 * MINUTE)
  fl.recordFailure("k")
  c.at(10 * MINUTE)
  fl.recordFailure("k")
  assert.deepEqual(fl.check("k"), { blocked: true, retryAfterSec: 300 }, "เหลือ 15 − 10 = 5 นาที")
  c.at(12 * MINUTE)
  fl.recordFailure("k") // ผิดซ้ำตอนถูกบล็อก ต้องไม่ยืดเวลา
  assert.deepEqual(fl.check("k"), { blocked: true, retryAfterSec: 180 })
  c.at(15 * MINUTE)
  assert.deepEqual(fl.check("k"), { blocked: false, retryAfterSec: 0 })
})

test("ความผิดหลังหมดหน้าต่างเริ่มนับใหม่จาก 1 (ไม่นับต่อจากรอบก่อน)", () => {
  const c = clock()
  const fl = createFailureLimiter({ windowMs: MINUTE, max: 3, now: c.now })
  fl.recordFailure("k")
  fl.recordFailure("k")
  c.at(MINUTE)
  fl.recordFailure("k")
  assert.equal(fl.check("k").blocked, false, "รอบใหม่ผิดแค่ 1 ครั้ง")
  fl.recordFailure("k")
  assert.equal(fl.check("k").blocked, false, "2 ครั้ง")
  fl.recordFailure("k")
  assert.deepEqual(fl.check("k"), { blocked: true, retryAfterSec: 60 }, "3 ครั้งในรอบใหม่")
})

test("reset ล้างเฉพาะคีย์นั้น (แล้วเริ่มนับใหม่) ส่วนคีย์อื่นและคีย์ที่ไม่เคยมีไม่ถูกกระทบ", () => {
  const c = clock()
  const fl = createFailureLimiter({ windowMs: MINUTE, max: 2, now: c.now })
  for (const k of ["a", "b"]) {
    fl.recordFailure(k)
    fl.recordFailure(k)
  }
  assert.equal(fl.check("a").blocked, true)
  assert.equal(fl.check("b").blocked, true)
  fl.reset("a")
  assert.equal(fl.check("a").blocked, false)
  assert.equal(fl.check("b").blocked, true, "คีย์ต่างกันไม่กระทบกัน")
  fl.recordFailure("a")
  assert.equal(fl.check("a").blocked, false, "หลัง reset นับใหม่จาก 1")
  assert.doesNotThrow(() => fl.reset("never-seen"))
  assert.equal(fl.size(), 2, "check/reset คีย์ที่ไม่มีไม่สร้างรายการ")
  assert.equal(fl.check("never-seen").blocked, false)
  assert.equal(fl.size(), 2)
})

test("ตัวจำกัดความผิดพลาด: sweep()/size()/maxKeys ทำงานเหมือนตัวจำกัดอัตรา และล้างเองทุก 60 วินาที", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const c = clock()
  const fl = createFailureLimiter({ windowMs: 1_000, max: 1, maxKeys: 2, now: c.now })
  fl.recordFailure("a")
  fl.recordFailure("b")
  assert.equal(fl.size(), 2)
  fl.recordFailure("c") // เต็ม → ไล่ a (หมดอายุเร็วที่สุด)
  assert.equal(fl.size(), 2)
  assert.equal(fl.check("a").blocked, false, "a ถูกไล่ไปแล้ว")
  assert.equal(fl.check("b").blocked, true)
  assert.equal(fl.check("c").blocked, true)
  c.at(1_000)
  fl.sweep()
  assert.equal(fl.size(), 0, "sweep() ล้างคีย์หมดอายุ")
  fl.recordFailure("d")
  c.at(10_000)
  t.mock.timers.tick(59_999)
  assert.equal(fl.size(), 1)
  t.mock.timers.tick(1)
  assert.equal(fl.size(), 0, "ครบ 60 วินาที ล้างเอง")
})

test("ตัวจำกัดความผิดพลาด ไม่ใส่ now → ใช้นาฬิกาจริง", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 9_000_000 })
  const fl = createFailureLimiter({ windowMs: MINUTE, max: 1 })
  fl.recordFailure("k")
  t.mock.timers.tick(MINUTE - 1)
  assert.deepEqual(fl.check("k"), { blocked: true, retryAfterSec: 1 })
  t.mock.timers.tick(1)
  assert.deepEqual(fl.check("k"), { blocked: false, retryAfterSec: 0 })
})

// ═════════════════════════ securityHeaders ═════════════════════════

const CSP_LITERAL =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

function headerApp(hsts: boolean) {
  const app = express()
  app.use(securityHeaders({ hsts }))
  app.get("/ok", (_req, res) => void res.send("ตอบได้"))
  app.use((_req, res) => void res.status(404).json({ error: "ไม่พบ" })) // เหมือน 404 ของแอปจริง (ไม่ปล่อยให้ finalhandler ของ Express ตอบแทน)
  return app
}

test("CSP ตรงกับ Global Constraints ทุกตัวอักษร (สคริปต์ห้าม inline, unsafe-inline เฉพาะสไตล์)", () => {
  assert.equal(CSP, CSP_LITERAL)
})

test("securityHeaders: ทุกคำตอบมีหัวความปลอดภัยครบ ทั้งหน้าที่มีและ 404 และเรียก next() ต่อ", async () => {
  await withServer(headerApp(false), async ({ port }) => {
    for (const path of ["/ok", "/missing", "/api/missing"]) {
      const r = await rawRequest({ port, path })
      assert.equal(r.headers["content-security-policy"], CSP_LITERAL, path)
      assert.equal(r.headers["x-content-type-options"], "nosniff", path)
      assert.equal(r.headers["referrer-policy"], "strict-origin-when-cross-origin", path)
      assert.equal(r.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()", path)
    }
    const ok = await rawRequest({ port, path: "/ok" })
    assert.equal(ok.status, 200)
    assert.equal(ok.text, "ตอบได้", "ตัวจัดการถัดไปต้องทำงาน")
    assert.equal((await rawRequest({ port, path: "/missing" })).status, 404)
  })
})

test("securityHeaders: Strict-Transport-Security เฉพาะเมื่อ hsts:true (180 วัน ไม่รวมซับโดเมน)", async () => {
  await withServer(headerApp(false), async ({ port }) => {
    assert.equal((await rawRequest({ port, path: "/ok" })).headers["strict-transport-security"], undefined)
  })
  await withServer(headerApp(true), async ({ port }) => {
    assert.equal((await rawRequest({ port, path: "/ok" })).headers["strict-transport-security"], "max-age=15552000")
  })
})

test("securityHeaders: X-Robots-Tag: noindex เฉพาะ /api และ /admin (ตาม segment, ไม่สนตัวพิมพ์, ไม่นับ query)", async () => {
  const noindex = ["/api", "/api/", "/api/public/novels", "/api?x=1", "/admin", "/admin/", "/admin/novels/3", "/API/x", "/Admin"]
  const indexable = ["/", "/novel/12", "/apiary", "/administrator", "/api-docs", "/x/api", "/x/admin", "/?next=/admin", "/?next=/api/x"]
  await withServer(headerApp(false), async ({ port }) => {
    for (const path of noindex) assert.equal((await rawRequest({ port, path })).headers["x-robots-tag"], "noindex", path)
    for (const path of indexable) assert.equal((await rawRequest({ port, path })).headers["x-robots-tag"], undefined, path)
  })
})

// ═════════════════════════ ด่านตรวจคำขอ (originGuard / loopbackHostOnly) ═════════════════════════

/**
 * `guardApp` / `loopbackApp` เก็บข้อผิดพลาดท้ายสายไว้ใน `app.locals.errors` — middleware ที่ตอบไปแล้วแต่ลืม `return` แล้วไหลต่อ
 * จะเกิด "headers already sent" ซึ่งไม่เห็นจากสถานะ/เนื้อหาที่ลูกค้าได้รับ `serve` จึงตรวจว่าหลังจบเทสต์ไม่มีข้อผิดพลาดเลย
 */
async function serve<T>(app: express.Express, fn: (s: { port: number }) => Promise<T>): Promise<T> {
  const result = await withServer(app, fn)
  assert.deepEqual(app.locals["errors"], [], "middleware ที่ตอบแล้วต้องไม่ไหลต่อ (ลืม return จะเกิด headers already sent)")
  return result
}

// ═════════════════════════ originGuard ═════════════════════════

interface ErrorBody {
  error: string
  code: string
}
const errorBody = (r: RawResponse) => r.json as ErrorBody

function guardApp(o: { allowedHosts?: string[] } = {}, onReach: () => void = () => {}) {
  const app = express()
  const errors: unknown[] = []
  app.locals["errors"] = errors
  app.use(originGuard(o))
  app.use((req, res) => {
    onReach()
    res.json({ ok: true, method: req.method })
  })
  app.use(((err, _req, _res, _next) => void errors.push(err)) as ErrorRequestHandler)
  return app
}

test("originGuard: POST ที่ Origin ต่างโฮสต์ → 403 ข้อความไทย และไม่ถึงตัวจัดการ", async () => {
  let reached = 0
  await serve(guardApp({}, () => reached++), async ({ port }) => {
    const r = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: "localhost:8787", Origin: "http://evil.test" } })
    assert.equal(r.status, 403)
    assert.deepEqual(Object.keys(errorBody(r)).sort(), ["code", "error"])
    assert.equal(errorBody(r).code, "forbidden_origin")
    assert.match(errorBody(r).error, THAI)
    assert.match(String(r.headers["content-type"]), /^application\/json/)
  })
  assert.equal(reached, 0)
})

test("originGuard: Origin ตรงกับ Host ผ่าน (ไม่สนตัวพิมพ์เล็กใหญ่/http-https/พอร์ตมาตรฐาน) และไม่มี Origin ก็ผ่าน", async () => {
  const pairs: [host: string, origin: string][] = [
    ["localhost:8787", "http://localhost:8787"],
    ["localhost:8787", "http://LocalHost:8787"],
    ["localhost:8787", "HTTP://LOCALHOST:8787"],
    ["EXAMPLE.com", "https://example.com"],
    ["example.com", "http://example.com"],
    ["example.com", "https://example.com:443"],
    ["example.com:8443", "https://example.com:8443"],
    ["[::1]:8787", "http://[::1]:8787"],
  ]
  let reached = 0
  await serve(guardApp({}, () => reached++), async ({ port }) => {
    for (const [host, origin] of pairs) {
      const r = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: host, Origin: origin } })
      assert.equal(r.status, 200, `Host ${host} ← Origin ${origin}`)
    }
    const none = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: "localhost:8787" } })
    assert.equal(none.status, 200, "ไม่มี Origin (curl / สคริปต์) ผ่าน")
  })
  assert.equal(reached, pairs.length + 1)
})

test("originGuard: Origin ที่ไม่ตรง ผิดรูปแบบ หรือไม่ใช่ http(s) ถูกปฏิเสธทั้งหมด", async () => {
  const bad = [
    "http://evil.test",
    "null",
    "",
    "not a url",
    "http://",
    "http://localhost:9999",
    "http://localhost",
    "https://localhost:8787.evil.test",
    "http://localhost.evil.test:8787",
    "http://localhost:8787@evil.test",
    "http://evil.test#localhost:8787",
    "http://evil.test, http://localhost:8787",
    "ftp://localhost:8787",
    "chrome-extension://localhost:8787",
    "file://",
    "javascript:alert(1)",
  ]
  await serve(guardApp(), async ({ port }) => {
    for (const origin of bad) {
      const r = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: "localhost:8787", Origin: origin } })
      assert.equal(r.status, 403, JSON.stringify(origin))
      assert.equal(errorBody(r).code, "forbidden_origin", JSON.stringify(origin))
    }
  })
})

test("originGuard: Origin ที่มีแต่ Host ไม่ตรง ว่าง หรือไม่มีเลย ก็ปฏิเสธ (ช่องว่างไม่ใช่ตัวแทนของโฮสต์ใดๆ)", async () => {
  await serve(guardApp(), async ({ port }) => {
    const mismatch = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: "other.test", Origin: "http://localhost:8787" } })
    assert.equal(mismatch.status, 403)
    const emptyHost = await rawSocketRequest(port, "POST /x HTTP/1.1\r\nHost: \r\nOrigin: http://localhost:8787\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    assert.equal(emptyHost.status, 403, "Host ว่าง")
    const noHost = await rawSocketRequest(port, "POST /x HTTP/1.0\r\nOrigin: http://localhost:8787\r\nContent-Length: 0\r\n\r\n")
    assert.equal(noHost.status, 403, "ไม่มีหัว Host")
  })
})

test("originGuard: allowedHosts เพิ่มโฮสต์ที่ยอมรับ (กรณี proxy เขียนหัว Host ใหม่) โดยไม่ตัดสิทธิ์โฮสต์เดิม", async () => {
  const send = (port: number, origin: string, host = "internal:8787") =>
    rawRequest({ port, method: "POST", path: "/x", headers: { Host: host, Origin: origin } })
  await serve(guardApp(), async ({ port }) => {
    assert.equal((await send(port, "https://novel.example")).status, 403, "ไม่ตั้ง allowedHosts → ไม่ผ่าน")
  })
  await serve(guardApp({ allowedHosts: ["Novel.Example", "other.example:8443"] }), async ({ port }) => {
    assert.equal((await send(port, "https://novel.example")).status, 200)
    assert.equal((await send(port, "https://NOVEL.example")).status, 200, "ไม่สนตัวพิมพ์เล็กใหญ่ทั้งสองฝั่ง")
    assert.equal((await send(port, "https://other.example:8443")).status, 200, "ระบุพอร์ตได้")
    assert.equal((await send(port, "https://other.example")).status, 403, "พอร์ตไม่ตรง")
    assert.equal((await send(port, "https://evil.test")).status, 403)
    assert.equal((await send(port, "http://internal:8787")).status, 200, "Host เดิมยังใช้ได้")
  })
})

test("originGuard: ตรวจเฉพาะ POST/PUT/PATCH/DELETE — GET/HEAD/OPTIONS ที่ Origin ต่างโฮสต์ผ่าน", async () => {
  await serve(guardApp(), async ({ port }) => {
    const evil = { Host: "localhost:8787", Origin: "http://evil.test" }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await rawRequest({ port, method, path: "/x", headers: evil })
      assert.equal(r.status, 403, method)
      assert.equal(errorBody(r).code, "forbidden_origin", method)
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const r = await rawRequest({ port, method, path: "/x", headers: evil })
      assert.equal(r.status, 200, method)
    }
    const withBody = await rawRequest({ port, method: "GET", path: "/x", headers: { ...evil, "Content-Type": "text/plain" }, body: "hello" })
    assert.equal(withBody.status, 200, "GET ไม่ตรวจชนิดเนื้อหา")
  })
})

test("originGuard: มี body แล้วต้องเป็น application/json เท่านั้น ไม่งั้น 415 ข้อความไทย (ทุกเมธอดที่ตรวจ)", async () => {
  const accepted = ["application/json", "application/json; charset=utf-8", "application/json ; charset=utf-8", "APPLICATION/JSON", "Application/Json;charset=UTF-8"]
  const rejected = [
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonx",
    "application/vnd.api+json",
    "application/json-patch+json",
    "text/json",
    "json",
  ]
  let reached = 0
  await serve(guardApp({}, () => reached++), async ({ port }) => {
    const send = (method: string, headers: Record<string, string>, body?: string) =>
      rawRequest({ port, method, path: "/x", headers: { Host: "localhost:8787", Origin: "http://localhost:8787", ...headers }, body })
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const type of accepted) assert.equal((await send(method, { "Content-Type": type }, '{"a":1}')).status, 200, `${method} ${type}`)
      for (const type of rejected) {
        const r = await send(method, { "Content-Type": type }, '{"a":1}')
        assert.equal(r.status, 415, `${method} ${type}`)
        assert.equal(errorBody(r).code, "unsupported_media_type")
        assert.match(errorBody(r).error, THAI)
      }
      assert.equal((await send(method, {}, '{"a":1}')).status, 415, `${method} ไม่มี Content-Type`)
    }
    assert.equal(reached, 4 * accepted.length)
    // ไม่มี Origin: ยังบังคับชนิดเนื้อหา (กันฟอร์ม/สคริปต์ที่ข้ามด่าน Origin)
    const noOrigin = await rawRequest({ port, method: "POST", path: "/x", headers: { Host: "localhost:8787", "Content-Type": "text/plain" }, body: "x" })
    assert.equal(noOrigin.status, 415)
  })
})

test("originGuard: ไม่มี body (Content-Length: 0) ผ่านแม้ไม่มีหรือเป็นชนิดอื่น; body แบบ chunked ก็ต้องเป็น JSON", async () => {
  await serve(guardApp(), async ({ port }) => {
    const send = (headers: Record<string, string>, body?: string) =>
      rawRequest({ port, method: "POST", path: "/x", headers: { Host: "localhost:8787", ...headers }, body })
    assert.equal((await send({})).status, 200, "POST ว่างๆ (เช่น logout)")
    assert.equal((await send({ "Content-Type": "text/plain" })).status, 200, "ไม่มี body ชนิดไม่สำคัญ")
    assert.equal((await send({ "Content-Length": "0", "Content-Type": "text/plain" })).status, 200)
    assert.equal((await send({ "Transfer-Encoding": "chunked", "Content-Type": "text/plain" }, "hello")).status, 415)
    assert.equal((await send({ "Transfer-Encoding": "chunked" }, "hello")).status, 415)
    assert.equal((await send({ "Transfer-Encoding": "chunked", "Content-Type": "application/json" }, "{}")).status, 200)
  })
})

test("originGuard: ตรวจ Origin ก่อนชนิดเนื้อหา (Origin ผิด + text/plain → 403 ไม่ใช่ 415)", async () => {
  await serve(guardApp(), async ({ port }) => {
    const r = await rawRequest({
      port,
      method: "POST",
      path: "/x",
      headers: { Host: "localhost:8787", Origin: "http://evil.test", "Content-Type": "text/plain" },
      body: "a=1",
    })
    assert.equal(r.status, 403)
    assert.equal(errorBody(r).code, "forbidden_origin")
  })
})

// ═════════════════════════ loopbackHostOnly ═════════════════════════

function loopbackApp() {
  const app = express()
  const errors: unknown[] = []
  app.locals["errors"] = errors
  app.use(loopbackHostOnly())
  app.use((_req, res) => void res.json({ ok: true }))
  app.use(((err, _req, _res, _next) => void errors.push(err)) as ErrorRequestHandler)
  return app
}

test("loopbackHostOnly: ผ่านเฉพาะ localhost / 127.0.0.1 / [::1] (มี :port ได้ ไม่สนตัวพิมพ์)", async () => {
  await serve(loopbackApp(), async ({ port }) => {
    for (const host of ["localhost", "localhost:8787", "LOCALHOST:8787", "Localhost", "127.0.0.1", "127.0.0.1:1", "127.0.0.1:65535", "[::1]", "[::1]:80"]) {
      const r = await rawRequest({ port, path: "/", headers: { Host: host } })
      assert.equal(r.status, 200, host)
    }
  })
})

test("loopbackHostOnly: โฮสต์อื่นทั้งหมด → 403 ข้อความไทย (กัน DNS rebinding) ทุกเมธอด", async () => {
  const bad = [
    "evil.test",
    "evil.test:8787",
    "localhost.evil.test",
    "localhost.evil.test:8787",
    "evil.localhost",
    "127.0.0.1.evil.test",
    "127a0b0c1",
    "127.0.0.2",
    "0.0.0.0",
    "192.168.1.5:8787",
    "localhost:",
    "localhost:abc",
    "localhost:123456",
    "localhost:80:80",
    "localhost.",
    "localhost@evil.test",
    "localhost/evil",
    "[::2]",
    "[::1",
    "::1",
  ]
  await serve(loopbackApp(), async ({ port }) => {
    for (const host of bad) {
      for (const method of ["GET", "POST"]) {
        const r = await rawRequest({ port, method, path: "/", headers: { Host: host } })
        assert.equal(r.status, 403, `${method} ${JSON.stringify(host)}`)
        assert.deepEqual(Object.keys(errorBody(r)).sort(), ["code", "error"])
        assert.equal(errorBody(r).code, "forbidden_host")
        assert.match(errorBody(r).error, THAI)
      }
    }
  })
})

test("loopbackHostOnly: Host ว่าง หรือไม่มีหัว Host เลย (HTTP/1.0) → 403", async () => {
  await serve(loopbackApp(), async ({ port }) => {
    const empty = await rawSocketRequest(port, "GET / HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n")
    assert.equal(empty.status, 403, "Host ว่าง")
    assert.equal((JSON.parse(empty.text) as ErrorBody).code, "forbidden_host")
    const missing = await rawSocketRequest(port, "GET / HTTP/1.0\r\n\r\n")
    assert.equal(missing.status, 403, "ไม่มีหัว Host")
    assert.equal((JSON.parse(missing.text) as ErrorBody).code, "forbidden_host")
    const control = await rawSocketRequest(port, "GET / HTTP/1.0\r\nHost: localhost:8787\r\n\r\n")
    assert.equal(control.status, 200, "HTTP/1.0 ที่มี Host ถูกต้องยังผ่าน (กันเทสต์ผ่านเพราะรูปแบบคำขอเพี้ยน)")
  })
})

// ═════════════════════════ clientIp ═════════════════════════

const fakeReq = (ip: string | undefined, remote?: string) => ({ ip, socket: { remoteAddress: remote } }) as unknown as Request

test("clientIp: ใช้ req.ip ก่อน แล้วที่อยู่ซ็อกเก็ต และ \"unknown\" ถ้าไม่มีทั้งคู่", () => {
  assert.equal(clientIp(fakeReq("198.51.100.4", "10.0.0.1")), "198.51.100.4")
  assert.equal(clientIp(fakeReq(undefined, "10.0.0.1")), "10.0.0.1")
  assert.equal(clientIp(fakeReq(undefined, undefined)), "unknown")
})

test("clientIp: IPv4 ไม่เปลี่ยน, IPv4-mapped แกะเป็น IPv4, IPv6 ย่อเหลือ /64 (ตัด zone id, ไม่สนตัวพิมพ์/การย่อ ::)", () => {
  const cases: [input: string, expected: string][] = [
    ["203.0.113.7", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["0:0:0:0:0:ffff:cb00:7107", "203.0.113.7"],
    ["::ffff:0.0.0.0", "0.0.0.0"],
    ["::ffff:203.200.113.250", "203.200.113.250"],
    ["::ffff:cbc8:71fa", "203.200.113.250"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:0001:0002::1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8:0:0:1::", "2001:db8:0:0::/64"],
    ["1::2:3:4:5:6:7", "1:0:2:3::/64"],
    ["::ffff:203.0.113.7%eth0", "203.0.113.7"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["1::", "1:0:0:0::/64"],
    ["1:2:3:4:5:6:7::", "1:2:3:4::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    ["::fffe:cb00:7107", "0:0:0:0::/64"],
    ["0:0:0:0:1:ffff:cb00:7107", "0:0:0:0::/64"],
    ["unknown", "unknown"],
    ["not-an-ip", "not-an-ip"],
    ["1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8:9"],
  ]
  for (const [input, expected] of cases) assert.equal(clientIp(fakeReq(input)), expected, input)
  assert.equal(clientIp(fakeReq(undefined, "::ffff:203.0.113.7")), "203.0.113.7", "ที่อยู่จากซ็อกเก็ตก็ผ่านการปรับรูปเหมือนกัน")
})

test("clientIp: ที่อยู่ IPv6 ใน /64 เดียวกันได้คีย์เดียวกัน (สลับ privacy address ก็ไม่หลุดลิมิต) ส่วนต่าง /64 ได้คีย์ต่างกัน", () => {
  const same = [clientIp(fakeReq("2001:db8:1:2::1")), clientIp(fakeReq("2001:db8:1:2:ffff:ffff:ffff:ffff")), clientIp(fakeReq("2001:DB8:1:2:0:0:0:99"))]
  assert.equal(new Set(same).size, 1)
  for (const other of ["2001:db8:1:3::1", "2001:db8:2:2::1", "2001:db9:1:2::1", "2002:db8:1:2::1"]) {
    assert.notEqual(clientIp(fakeReq(other)), same[0], other)
  }
  assert.notEqual(clientIp(fakeReq("::ffff:203.0.113.7")), clientIp(fakeReq("::ffff:203.0.113.8")), "IPv4 คนละเครื่องไม่ถูกรวมกัน")
})

// ═════════════════════════ warnForwardedOnce ═════════════════════════

function runWarn(mw: RequestHandler, headers: Record<string, string>): number {
  let nexted = 0
  mw({ headers } as unknown as Request, {} as Response, () => void nexted++)
  return nexted
}

test("warnForwardedOnce: TRUST_PROXY=0 แล้วเจอหัว X-Forwarded-For → เตือนครั้งเดียว (มีคำว่า TRUST_PROXY) และเรียก next ทุกครั้ง", () => {
  const { logger, lines } = memoryLogger()
  const mw = warnForwardedOnce({ trustProxy: 0, log: logger })
  assert.equal(runWarn(mw, {}), 1)
  assert.deepEqual(lines, [], "ยังไม่มีหัว proxy → ไม่เตือน")
  assert.equal(runWarn(mw, { "x-forwarded-for": "1.2.3.4" }), 1)
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /^warn: /)
  assert.match(lines[0]!, /TRUST_PROXY/)
  assert.match(lines[0]!, THAI)
  for (let i = 0; i < 5; i++) assert.equal(runWarn(mw, { "x-forwarded-for": `1.2.3.${i}` }), 1)
  assert.equal(lines.length, 1, "เตือนครั้งเดียวตลอดอายุ middleware")
})

test("warnForwardedOnce: หัว Forwarded และ X-Real-IP ก็นับ (แต่ละ middleware เตือนของตัวเองครั้งเดียว)", () => {
  for (const header of ["forwarded", "x-real-ip"]) {
    const { logger, lines } = memoryLogger()
    const mw = warnForwardedOnce({ trustProxy: 0, log: logger })
    runWarn(mw, { [header]: "for=1.2.3.4" })
    assert.equal(lines.length, 1, header)
    assert.match(lines[0]!, /TRUST_PROXY/)
  }
  const a = memoryLogger()
  const b = memoryLogger()
  const mwA = warnForwardedOnce({ trustProxy: 0, log: a.logger })
  const mwB = warnForwardedOnce({ trustProxy: 0, log: b.logger })
  runWarn(mwA, { "x-forwarded-for": "1.2.3.4" })
  runWarn(mwB, { "x-forwarded-for": "1.2.3.4" })
  assert.equal(a.lines.length, 1)
  assert.equal(b.lines.length, 1)
})

test("warnForwardedOnce: TRUST_PROXY ≥ 1 ไม่เตือนเลย (หัว proxy เป็นเรื่องปกติ) แต่ยังเรียก next", () => {
  for (const trustProxy of [1, 2, 5]) {
    const { logger, lines } = memoryLogger()
    const mw = warnForwardedOnce({ trustProxy, log: logger })
    assert.equal(runWarn(mw, { "x-forwarded-for": "1.2.3.4", forwarded: "for=1.2.3.4", "x-real-ip": "1.2.3.4" }), 1)
    assert.deepEqual(lines, [], `trustProxy=${trustProxy}`)
  }
})

test("warnForwardedOnce: เขียนระดับ warn เท่านั้น (ไม่ใช่ info/error)", () => {
  const seen: string[] = []
  const log: Logger = { info: () => void seen.push("info"), warn: () => void seen.push("warn"), error: () => void seen.push("error") }
  runWarn(warnForwardedOnce({ trustProxy: 0, log }), { "x-forwarded-for": "1.2.3.4" })
  assert.deepEqual(seen, ["warn"])
})

// ═════════════════════════ Review Focus 4: ตัวจำกัดความผิดพลาดกับ X-Forwarded-For ═════════════════════════

/** แอปทดลองเลียนแบบ POST /login: ผิดเสมอ นับตามที่อยู่ที่ clientIp ให้ */
function loginApp(trustProxy: number, log: Logger) {
  const failures = createFailureLimiter({ windowMs: 15 * MINUTE, max: 10 })
  const app = express()
  app.set("trust proxy", trustProxy)
  app.use(warnForwardedOnce({ trustProxy, log }))
  app.post("/login", (req, res) => {
    const key = clientIp(req)
    const gate = failures.check(key)
    if (gate.blocked) {
      res.status(429).json({ error: "ลองใหม่ภายหลัง", retryAfterSec: gate.retryAfterSec })
      return
    }
    failures.recordFailure(key)
    res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" })
  })
  return app
}

test("(Review Focus 4) TRUST_PROXY=0: เปลี่ยน X-Forwarded-For ทุกครั้งก็หนีลิมิตไม่ได้ — ผิดครั้งที่ 11 ได้ 429 และมีคำเตือนครั้งเดียว", async () => {
  const { logger, lines } = memoryLogger()
  await withServer(loginApp(0, logger), async ({ port }) => {
    const statuses: number[] = []
    let last: RawResponse | undefined
    for (let i = 1; i <= 11; i++) {
      last = await rawRequest({ port, method: "POST", path: "/login", headers: { "X-Forwarded-For": `198.51.100.${i}` } })
      statuses.push(last.status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429])
    const retry = (last!.json as { retryAfterSec: number }).retryAfterSec
    assert.ok(retry >= 1 && retry <= 900, `retryAfterSec=${retry}`)
  })
  assert.equal(lines.length, 1, "คำเตือนเขียนครั้งเดียว ไม่ใช่ทุกคำขอ")
  assert.match(lines[0]!, /^warn: /)
  assert.match(lines[0]!, /TRUST_PROXY/)
})

test("(Review Focus 4) TRUST_PROXY=1: ค่า X-Forwarded-For ต่างกันแยกถังจริง ไม่มีคำเตือน; ค่าเดียวกันครบ 10 ก็ถูกบล็อก", async () => {
  const { logger, lines } = memoryLogger()
  await withServer(loginApp(1, logger), async ({ port }) => {
    for (let i = 1; i <= 11; i++) {
      const r = await rawRequest({ port, method: "POST", path: "/login", headers: { "X-Forwarded-For": `198.51.100.${i}` } })
      assert.equal(r.status, 401, `ผู้ใช้คนที่ ${i} มีถังของตัวเอง`)
    }
    const statuses: number[] = []
    for (let i = 1; i <= 11; i++) {
      statuses.push((await rawRequest({ port, method: "POST", path: "/login", headers: { "X-Forwarded-For": "203.0.113.9" } })).status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429])
  })
  assert.deepEqual(lines, [])
})

test("(Review Focus 4) TRUST_PROXY=1: ค่าที่ผู้ใช้ปลอมไว้ซ้ายสุดของ X-Forwarded-For ไม่ทำให้แยกถัง (นับตามที่ proxy เห็นจริง)", async () => {
  await withServer(loginApp(1, memoryLogger().logger), async ({ port }) => {
    const statuses: number[] = []
    for (let i = 1; i <= 11; i++) {
      const r = await rawRequest({ port, method: "POST", path: "/login", headers: { "X-Forwarded-For": `10.9.8.${i}, 203.0.113.50` } })
      statuses.push(r.status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429])
  })
})
