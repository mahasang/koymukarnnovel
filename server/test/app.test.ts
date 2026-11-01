import { test } from "node:test"
import assert from "node:assert/strict"
import express, { type ErrorRequestHandler, type Express } from "express"
import { errorHandler } from "../src/app.js"
import { HttpError } from "../src/util/errors.js"
import { memoryLogger } from "../src/util/log.js"
import { rawRequest, withServer, type RawResponse } from "./helpers/http.js"
import { TEST_PASSWORD, withTestApp } from "./helpers/app.js"

const THAI = /[฀-๿]/
const GENERIC_500 = { error: "เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้งภายหลัง", code: "internal_error" }

/**
 * แอปเล็กๆ ที่มีเฉพาะเส้นทางทดสอบ + ตัวจัดการ error ตัวจริง + ตัวดักท้ายสุดที่เก็บ error ที่หลุดออกมาจากตัวจัดการเอง
 * (เช่น ตอบซ้ำหลังตอบไปแล้วเพราะลืม return — คำตอบฝั่งลูกค้าดูปกติแต่เบื้องหลังมี exception)
 */
function buildApp(setup: (app: Express) => void) {
  const { logger, lines } = memoryLogger()
  const escaped: unknown[] = []
  const app = express()
  setup(app)
  app.use(errorHandler(logger))
  app.use(((err, _req, _res, _next) => void escaped.push(err)) as ErrorRequestHandler)
  return { app, lines, escaped }
}

/** ส่งคำขอหนึ่งครั้งไปยังแอปจาก `buildApp` แล้วคืนคำตอบกับ log (ล้มถ้ามี error หลุดจากตัวจัดการ) */
async function probe(
  setup: (app: Express) => void,
  request: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ res: RawResponse; lines: string[] }> {
  const { app, lines, escaped } = buildApp(setup)
  const res = await withServer(app, ({ port }) => rawRequest({ port, path: "/boom", ...request }))
  assert.deepEqual(escaped, [], "ตัวจัดการ error ไม่ควรมี exception หลุดออกมา")
  return { res, lines }
}

// ═════════════════════════ errorHandler ═════════════════════════

test("errorHandler: HttpError → สถานะและ {error, code, ...extra} ตามที่โยน ไม่เขียน log", async () => {
  const { res, lines } = await probe((app) =>
    app.get("/boom", () => {
      throw new HttpError(409, "เลขตอนซ้ำ", "duplicate_number", { duplicates: [3, 4] })
    }),
  )
  assert.equal(res.status, 409)
  assert.deepEqual(res.json, { error: "เลขตอนซ้ำ", code: "duplicate_number", duplicates: [3, 4] })
  assert.match(res.headers["content-type"]!, /^application\/json/)
  assert.deepEqual(lines, [])
})

test("errorHandler: HttpError ที่ไม่มี code ไม่ใส่ฟิลด์ code; extra ทับ error/code ไม่ได้", async () => {
  const plain = await probe((app) =>
    app.get("/boom", () => {
      throw new HttpError(404, "ไม่พบข้อมูลที่ต้องการ")
    }),
  )
  assert.equal(plain.res.status, 404)
  assert.deepEqual(plain.res.json, { error: "ไม่พบข้อมูลที่ต้องการ" })

  const sneaky = await probe((app) =>
    app.get("/boom", () => {
      throw new HttpError(400, "ข้อความจริง", "real_code", { error: "ปลอม", code: "fake", note: "คงอยู่" })
    }),
  )
  assert.deepEqual(sneaky.res.json, { error: "ข้อความจริง", code: "real_code", note: "คงอยู่" })

  // ไม่มี code ใน HttpError ก็ไม่มี code ในคำตอบ แม้ extra จะพยายามใส่มา (ฟิลด์ error/code มาจากตัว HttpError เท่านั้น)
  const sneakyNoCode = await probe((app) =>
    app.get("/boom", () => {
      throw new HttpError(400, "ข้อความจริง", undefined, { code: "fake" })
    }),
  )
  assert.deepEqual(sneakyNoCode.res.json, { error: "ข้อความจริง" })
})

test("errorHandler: handler แบบ async ที่ reject ก็มาถึงตัวจัดการนี้ (Express 5)", async () => {
  const { res } = await probe((app) =>
    app.get("/boom", async () => {
      await Promise.resolve()
      throw new HttpError(403, "ไม่อนุญาต", "forbidden")
    }),
  )
  assert.equal(res.status, 403)
  assert.deepEqual(res.json, { error: "ไม่อนุญาต", code: "forbidden" })
})

test("errorHandler: error ที่ไม่คาดคิด → 500 ข้อความไทยทั่วไปไม่รั่วรายละเอียด; log บันทึกวิธีเรียก/เส้นทาง (ไม่มี query) และ stack", async () => {
  const { res, lines } = await probe(
    (app) =>
      app.get("/boom", () => {
        throw new Error("secret-detail-xyz")
      }),
    { path: "/boom?token=abc123" },
  )
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, GENERIC_500)
  assert.ok(!res.text.includes("secret-detail-xyz"))
  assert.equal(lines.length, 1)
  const line = lines[0]!
  assert.ok(line.startsWith("error: "))
  assert.ok(line.includes("GET /boom"), line)
  assert.ok(line.includes("secret-detail-xyz"), line)
  assert.ok(!line.includes("abc123"), line)
  assert.match(line, /\n\s+at /) // stack
})

test("errorHandler: log ใช้เส้นทางเต็มของคำขอ แม้ตัวจัดการถูกต่อไว้ใน router ย่อยที่ตัดคำนำหน้าเส้นทางไปแล้ว", async () => {
  const { logger, lines } = memoryLogger()
  const app = express()
  const sub = express.Router()
  sub.get("/boom", () => {
    throw new Error("nested-failure")
  })
  sub.use(errorHandler(logger))
  app.use("/api/nested", sub)
  const res = await withServer(app, ({ port }) => rawRequest({ port, path: "/api/nested/boom?x=1" }))
  assert.equal(res.status, 500)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.includes("GET /api/nested/boom: "), lines[0])
})

test("errorHandler: ค่าที่ไม่ใช่ Error ถูกโยนมา (สตริง) ก็เป็น 500 และบันทึกค่านั้น", async () => {
  const { res, lines } = await probe((app) =>
    app.get("/boom", () => {
      throw "plain-string-failure"
    }),
  )
  assert.equal(res.status, 500)
  assert.deepEqual(res.json, GENERIC_500)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.includes("plain-string-failure"))
})

test("errorHandler: ความผิดของ body จาก express.json → 413 too_large / 400 bad_json ข้อความไทย โดยไม่ถือเป็น error ของระบบ", async () => {
  const setup = (app: Express) => {
    app.use(express.json({ limit: "10b" }))
    app.post("/boom", (_req, res) => void res.json({ ok: true }))
  }
  const headers = { "Content-Type": "application/json" }
  const tooLarge = await probe(setup, { method: "POST", headers, body: '{"a":"0123456789"}' })
  assert.equal(tooLarge.res.status, 413)
  assert.deepEqual(tooLarge.res.json, { error: "ข้อมูลที่ส่งมาใหญ่เกินกำหนด", code: "too_large" })
  assert.deepEqual(tooLarge.lines, [])

  const broken = await probe(setup, { method: "POST", headers, body: "{x" })
  assert.equal(broken.res.status, 400)
  assert.equal((broken.res.json as { code: string }).code, "bad_json")
  assert.match((broken.res.json as { error: string }).error, THAI)
  assert.ok(!broken.res.text.includes("Unexpected"), "ไม่ส่งข้อความภาษาอังกฤษของตัวแปล JSON ออกไป")
  assert.deepEqual(broken.lines, [])

  const fine = await probe(setup, { method: "POST", headers, body: '{"a":1}' })
  assert.equal(fine.res.status, 200)
})

test("errorHandler: error ที่มีสถานะ 4xx จากไลบรารี (charset/encoding ไม่รองรับ ฯลฯ) คงสถานะเดิม + ข้อความไทยทั่วไป ไม่บันทึกเป็น error", async () => {
  const fails = (props: object) => (app: Express) =>
    app.get("/boom", () => {
      throw Object.assign(new Error('unsupported charset "ISO-8859-1"'), props)
    })

  const charset = await probe(fails({ status: 415, type: "charset.unsupported" }))
  assert.equal(charset.res.status, 415)
  assert.equal((charset.res.json as { code: string }).code, "unsupported_media_type")
  assert.match((charset.res.json as { error: string }).error, THAI)
  assert.ok(!charset.res.text.includes("ISO-8859-1"))
  assert.deepEqual(charset.lines, [])

  const aborted = await probe(fails({ status: 400, type: "request.aborted" }))
  assert.equal(aborted.res.status, 400)
  assert.equal((aborted.res.json as { code: string }).code, "bad_request")
  assert.match((aborted.res.json as { error: string }).error, THAI)
  assert.deepEqual(aborted.lines, [])

  const viaStatusCode = await probe(fails({ statusCode: 418 }))
  assert.equal(viaStatusCode.res.status, 418)
  assert.equal((viaStatusCode.res.json as { code: string }).code, "bad_request")
  assert.deepEqual(viaStatusCode.lines, [])

  const last4xx = await probe(fails({ status: 499 }))
  assert.equal(last4xx.res.status, 499)
})

test("errorHandler: สถานะที่ไม่ใช่ 4xx จริงๆ (5xx, 200, สตริง, ทศนิยม) ถือเป็น 500 ที่ไม่คาดคิด และบันทึก error", async () => {
  for (const props of [{ status: 500 }, { status: 503 }, { status: 200 }, { status: 399 }, { status: "400" }, { status: 404.5 }, { statusCode: 302 }]) {
    const { res, lines } = await probe((app) =>
      app.get("/boom", () => {
        throw Object.assign(new Error("upstream broke"), props)
      }),
    )
    assert.equal(res.status, 500, JSON.stringify(props))
    assert.deepEqual(res.json, GENERIC_500, JSON.stringify(props))
    assert.equal(lines.length, 1, JSON.stringify(props))
    assert.ok(lines[0]!.startsWith("error: "))
  }
})

test("errorHandler: error หลังเริ่มส่งคำตอบไปแล้ว → บันทึก error แล้วตัดการเชื่อมต่อ (ไม่ปล่อยคำขอค้าง)", async () => {
  for (const failure of [new Error("late-failure"), new HttpError(409, "ช้าไปแล้ว", "too_late")]) {
    const { app, lines, escaped } = buildApp((a) =>
      a.get("/boom", (_req, res, next) => {
        res.write("partial")
        next(failure)
      }),
    )
    await withServer(app, async ({ port }) => {
      await assert.rejects(rawRequest({ port, path: "/boom" }))
    })
    assert.deepEqual(escaped, [], failure.message)
    assert.equal(lines.length, 1, failure.message)
    assert.ok(lines[0]!.startsWith("error: "))
    assert.ok(lines[0]!.includes("GET /boom"))
    assert.ok(lines[0]!.includes(failure.message))
  }
})

// ═════════════════════════ createApp ═════════════════════════

test("/healthz ตอบ ok (text/plain) ไม่ติดด่านหลังบ้านแม้ Host แปลกในโหมดไม่มีรหัส และ HEAD ก็ได้", async () => {
  await withTestApp({ config: { adminPassword: null } }, async (t) => {
    const get = await t.client().get("/healthz")
    assert.equal(get.status, 200)
    assert.equal(get.text, "ok")
    assert.match(get.headers.get("content-type")!, /^text\/plain/)

    const evil = await rawRequest({ port: t.port, path: "/healthz", headers: { Host: "evil.test" } })
    assert.equal(evil.status, 200)
    assert.equal(evil.text, "ok")

    const head = await rawRequest({ port: t.port, method: "HEAD", path: "/healthz" })
    assert.equal(head.status, 200)
    assert.equal(head.text, "")
  })
})

test("ทุกคำตอบของแอปมีหัวความปลอดภัย (CSP, nosniff ฯลฯ) ไม่เปิดเผย X-Powered-By และ HSTS มีเฉพาะเมื่อตั้ง hsts", async () => {
  for (const hsts of [false, true]) {
    await withTestApp({ config: { hsts } }, async (t) => {
      const c = t.client()
      for (const path of ["/healthz", "/api/ไม่มีอยู่", "/api/admin/me", "/api/public/x"]) {
        const r = await c.get(path)
        assert.match(r.headers.get("content-security-policy")!, /^default-src 'self'; script-src 'self'/, path)
        assert.equal(r.headers.get("x-content-type-options"), "nosniff", path)
        assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin", path)
        assert.equal(r.headers.get("x-powered-by"), null, path)
        assert.equal(r.headers.get("strict-transport-security"), hsts ? "max-age=15552000" : null, path)
      }
    })
  }
})

test("แอปบีบอัดคำตอบ (compression อยู่ในสายงาน: คำตอบ JSON มี Vary: Accept-Encoding)", async () => {
  await withTestApp({}, async (t) => {
    const r = await t.client().get("/api/ไม่มีอยู่")
    assert.match(r.headers.get("vary") ?? "", /Accept-Encoding/i)
  })
})

test("body ที่ประกาศ charset ที่ไม่รองรับ → 415 ข้อความไทยทั้งที่ล็อกอินและหลังล็อกอิน ไม่ใช่ 500 และไม่บันทึกเป็น error", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    const send = (path: string) =>
      c.raw(path, {
        method: "POST",
        headers: { Origin: t.base, "Content-Type": "application/json; charset=iso-8859-1" },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      })
    const login = await send("/api/admin/login")
    assert.equal(login.status, 415)
    assert.equal(login.json.code, "unsupported_media_type")
    assert.match(login.json.error, THAI)
    await c.login()
    assert.equal((await send("/api/admin/ไม่มีอยู่")).status, 415)
    assert.deepEqual(
      t.logs.filter((line) => line.startsWith("error:")),
      [],
    )
  })
})
