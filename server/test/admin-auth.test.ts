import { test } from "node:test"
import assert from "node:assert/strict"
import type { Request } from "express"
import { COOKIE_NAME, SESSION_TTL_MS, sessionKey, signSession, verifySession } from "../src/auth.js"
import type { AppDeps } from "../src/app.js"
import type { Config } from "../src/config.js"
import { isAdminRequest } from "../src/http/admin.js"
import { rawRequest } from "./helpers/http.js"
import { TEST_PASSWORD, withTestApp, type Client, type ClientResponse } from "./helpers/app.js"

const THAI = /[฀-๿]/
const MINUTE = 60_000
const DAY = 24 * 3600 * 1000
const LOGIN = "/api/admin/login"
const ME = "/api/admin/me"
const JSON_TYPE = "application/json"

/** นาฬิกาจำลองของแอป: ใช้ทั้งอายุเซสชันและหน้าต่างของตัวจำกัดล็อกอิน */
function clock(startIso = "2026-10-22T05:00:00Z") {
  let t = Date.parse(startIso)
  return { now: () => new Date(t), ms: () => t, advance: (ms: number) => void (t += ms) }
}

/** ส่ง JSON ดิบที่ไม่ผ่านการ stringify ของ Client (ไว้ทดสอบ JSON พัง/ขนาดพอดีขอบ) */
const rawJson = (c: Client, path: string, body: string, origin: string): Promise<ClientResponse> =>
  c.raw(path, { method: "POST", headers: { Origin: origin, "Content-Type": JSON_TYPE }, body })

/** body ล็อกอินที่ยาว `bytes` ไบต์พอดี (ASCII ล้วน) */
function loginBodyOfSize(bytes: number): string {
  const frame = JSON.stringify({ password: "" }).length // {"password":""}
  return JSON.stringify({ password: "p".repeat(bytes - frame) })
}

// ═════════════════════════ /me และการล็อกอิน ═════════════════════════

test("GET /api/admin/me: ไม่มี cookie → 401 ข้อความไทย; หลังล็อกอิน → 200 {admin:true, passwordless:false}", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    const before = await c.get(ME)
    assert.equal(before.status, 401)
    assert.equal(before.json.code, "unauthorized")
    assert.match(before.json.error, THAI)

    const login = await c.login()
    assert.equal(login.status, 200)
    assert.deepEqual(login.json, { admin: true, passwordless: false })

    const me = await c.get(ME)
    assert.equal(me.status, 200)
    assert.deepEqual(me.json, { admin: true, passwordless: false })
  })
})

test("ล็อกอิน: รหัสผิด → 401 ข้อความไทยที่ไม่สะท้อนรหัส และไม่ออก cookie", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    const bad = await c.post(LOGIN, { password: "not-the-password" })
    assert.equal(bad.status, 401)
    assert.equal(bad.json.code, "bad_password")
    assert.match(bad.json.error, THAI)
    assert.ok(!bad.text.includes("not-the-password"))
    assert.equal(bad.headers.get("set-cookie"), null)
    assert.equal((await c.get(ME)).status, 401)
  })
})

test("ล็อกอิน: รหัสที่ต่างจากของจริงแค่ตัวสุดท้าย/ยาวกว่า/สั้นกว่า ก็เข้าไม่ได้", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (const wrong of [TEST_PASSWORD.slice(0, -1), `${TEST_PASSWORD}x`, `${TEST_PASSWORD.slice(0, -1)}4`, TEST_PASSWORD.toUpperCase(), ""]) {
      const r = await c.post(LOGIN, { password: wrong })
      assert.equal(r.status, 401, JSON.stringify(wrong))
    }
  })
})

test("ล็อกอิน: body ที่ไม่มีรหัสผ่านเป็นสตริง → 400 ข้อความไทย ไม่ออก cookie และไม่นับเป็นการเดารหัส", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    const bodies: unknown[] = [undefined, {}, { password: 123 }, { password: null }, { password: ["x"] }, { pass: "x" }, ["x"]]
    for (let round = 0; round < 4; round++) {
      for (const body of bodies) {
        const r = await c.post(LOGIN, body)
        assert.equal(r.status, 400, JSON.stringify(body))
        assert.equal(r.json.code, "bad_request")
        assert.match(r.json.error, THAI)
        assert.equal(r.headers.get("set-cookie"), null)
      }
    }
    // 28 คำขอผิดรูปแบบแล้ว ถ้านับเป็นความผิดจะถูกบล็อกไปแล้ว
    await c.login()
    assert.equal((await c.get(ME)).status, 200)
  })
})

// ═════════════════════════ ตัวจำกัดล็อกอินผิด ═════════════════════════

test("ผิดครบ 10 ครั้งจาก IP เดียว → ครั้งที่ 11 ได้ 429 + Retry-After (รหัสถูกก็เข้าไม่ได้จนกว่าจะหมด 15 นาที)", async () => {
  const k = clock()
  await withTestApp({ now: k.now }, async (t) => {
    const c = t.client()
    for (let i = 1; i <= 10; i++) {
      const r = await c.post(LOGIN, { password: `wrong-${i}` })
      assert.equal(r.status, 401, `ครั้งที่ ${i}`)
      assert.equal(r.headers.get("retry-after"), null)
    }

    const blocked = await c.post(LOGIN, { password: "wrong-11" })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get("retry-after"), "900")
    assert.equal(blocked.json.code, "too_many_attempts")
    assert.equal(blocked.json.retryAfterSec, 900)
    assert.match(blocked.json.error, THAI)
    assert.match(blocked.json.error, /อีก 15 นาที/)

    // ระหว่างถูกบล็อก body ผิดรูปแบบก็ได้ 429 เหมือนกัน (ตรวจการถูกบล็อกก่อนอ่านว่าส่งอะไรมา)
    assert.equal((await c.post(LOGIN, {})).status, 429)

    // ต่อให้ส่งรหัสถูกก็ไม่ผ่านและไม่ออก cookie
    const correct = await c.post(LOGIN, { password: TEST_PASSWORD })
    assert.equal(correct.status, 429)
    assert.equal(correct.headers.get("set-cookie"), null)
    assert.equal((await c.get(ME)).status, 401)

    // เหลือ 1 วินาที: Retry-After = 1 และบอก "1 นาที" (ปัดขึ้น ไม่ใช่ 0)
    k.advance(15 * MINUTE - 1000)
    const almost = await c.post(LOGIN, { password: TEST_PASSWORD })
    assert.equal(almost.status, 429)
    assert.equal(almost.headers.get("retry-after"), "1")
    assert.match(almost.json.error, /อีก 1 นาที/)

    // ครบ 15 นาทีพอดี → ปลดบล็อก
    k.advance(1000)
    const again = await c.login()
    assert.equal(again.status, 200)
  })
})

test("ล็อกอินสำเร็จล้างตัวนับความผิดของ IP นั้น (ผิด 9 → ถูก → ผิดได้อีก 10 ครั้งก่อนโดนบล็อก)", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (let i = 1; i <= 9; i++) assert.equal((await c.post(LOGIN, { password: "nope" })).status, 401)
    await c.login()
    const other = t.client()
    for (let i = 1; i <= 10; i++) assert.equal((await other.post(LOGIN, { password: "nope" })).status, 401, `หลังสำเร็จ ครั้งที่ ${i}`)
    assert.equal((await other.post(LOGIN, { password: "nope" })).status, 429)
  })
})

test("คำขอล็อกอินที่ถูกด่านตรวจ CSRF/ชนิดข้อมูล/ขนาดตีกลับ ไม่นับเป็นการเดารหัส", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (let i = 0; i < 15; i++) {
      assert.equal((await c.post(LOGIN, { password: "nope" }, { headers: { Origin: "https://evil.test" } })).status, 403)
      assert.equal((await c.raw(LOGIN, { method: "POST", headers: { Origin: t.base, "Content-Type": "text/plain" }, body: "password=nope" })).status, 415)
      assert.equal((await rawJson(c, LOGIN, loginBodyOfSize(2000), t.base)).status, 413)
    }
    await c.login()
  })
})

test("ตัวจำกัดล็อกอินนับตาม IP จริงเมื่อ TRUST_PROXY=1 (X-Forwarded-For ต่างกัน = ถังต่างกัน) และไม่เตือนเรื่อง proxy", async () => {
  await withTestApp({ config: { trustProxy: 1 } }, async (t) => {
    const c = t.client()
    const from = (ip: string) => ({ headers: { "X-Forwarded-For": ip } })
    for (let i = 1; i <= 10; i++) assert.equal((await c.post(LOGIN, { password: "nope" }, from("198.51.100.1"))).status, 401)
    assert.equal((await c.post(LOGIN, { password: "nope" }, from("198.51.100.1"))).status, 429)
    assert.equal((await c.post(LOGIN, { password: "nope" }, from("198.51.100.2"))).status, 401)
    // ผู้ใช้อีกคนยังล็อกอินได้ตามปกติ ทั้งที่ IP แรกถูกบล็อก
    assert.equal((await t.client().login(TEST_PASSWORD, from("198.51.100.3"))).status, 200)
    assert.deepEqual(
      t.logs.filter((line) => line.includes("TRUST_PROXY")),
      [],
    )
  })
})

test("TRUST_PROXY=1 เชื่อเฉพาะที่อยู่ที่ proxy ต่อท้าย: ค่านำหน้าใน X-Forwarded-For ที่ผู้ใช้ปลอมมาเลี่ยงตัวจำกัดล็อกอินไม่ได้", async () => {
  await withTestApp({ config: { trustProxy: 1 } }, async (t) => {
    const c = t.client()
    // proxy ของเราต่อ IP จริง (198.51.100.1) ไว้ท้ายสุด ส่วนที่นำหน้าเป็นของที่ผู้ใช้ปลอมมาเอง
    for (let i = 1; i <= 10; i++) {
      const r = await c.post(LOGIN, { password: "nope" }, { headers: { "X-Forwarded-For": `203.0.113.${i}, 198.51.100.1` } })
      assert.equal(r.status, 401, `ครั้งที่ ${i}`)
    }
    const spoofed = await c.post(LOGIN, { password: "nope" }, { headers: { "X-Forwarded-For": "203.0.113.200, 198.51.100.1" } })
    assert.equal(spoofed.status, 429)
  })
})

test("TRUST_PROXY=0: เมินหัว X-Forwarded-For (ทุกคนคือ IP เดียว) และเตือนใน log ครั้งเดียวให้ตั้ง TRUST_PROXY", async () => {
  await withTestApp({ config: { trustProxy: 0 } }, async (t) => {
    const c = t.client()
    for (let i = 1; i <= 10; i++) {
      const r = await c.post(LOGIN, { password: "nope" }, { headers: { "X-Forwarded-For": `198.51.100.${i}` } })
      assert.equal(r.status, 401)
    }
    const blocked = await c.post(LOGIN, { password: "nope" }, { headers: { "X-Forwarded-For": "203.0.113.99" } })
    assert.equal(blocked.status, 429)
    const warnings = t.logs.filter((line) => line.startsWith("warn:") && line.includes("TRUST_PROXY"))
    assert.equal(warnings.length, 1)
  })
})

// ═════════════════════════ cookie ═════════════════════════

test("cookie ล็อกอิน: ชื่อ/ค่า/อายุ 30 วัน และ HttpOnly, SameSite=Lax, Path=/ แต่ไม่มี Secure บน http", async () => {
  const k = clock()
  await withTestApp({ now: k.now }, async (t) => {
    const c = t.client()
    const r = await c.login()
    const header = r.headers.get("set-cookie")!
    const [pair, ...attributes] = header.split("; ")
    assert.ok(pair!.startsWith(`${COOKIE_NAME}=`))
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) assert.ok(attributes.includes(attribute), `${attribute} ← ${header}`)
    assert.ok(!attributes.includes("Secure"))
    assert.equal(r.headers.getSetCookie().length, 1)

    // ค่าใน cookie คือ session ที่ลงนามด้วยกุญแจของรหัสผ่านนี้ และหมดอายุ 30 วันนับจากเวลาของแอป (ไม่ใช่เวลาจริงของเครื่อง)
    const token = pair!.slice(COOKIE_NAME.length + 1)
    assert.equal(verifySession(sessionKey(TEST_PASSWORD, ""), token, k.ms()), true)
    assert.equal(Number(Buffer.from(token.split(".")[0]!, "base64url").toString()), k.ms() + SESSION_TTL_MS)
    assert.equal(c.cookies.get(COOKIE_NAME), token)
  })
})

test("cookie มี Secure เมื่อ TRUST_PROXY=1 และ proxy ส่ง X-Forwarded-Proto: https; ไม่มีเมื่อเป็น http หรือไม่ไว้ใจ proxy", async () => {
  const secure = async (trustProxy: number, proto?: string): Promise<boolean> =>
    withTestApp({ config: { trustProxy } }, async (t) => {
      const r = await t.client().login(TEST_PASSWORD, proto === undefined ? {} : { headers: { "X-Forwarded-Proto": proto } })
      return r.headers.get("set-cookie")!.split("; ").includes("Secure")
    })
  assert.equal(await secure(1, "https"), true)
  assert.equal(await secure(1, "http"), false)
  assert.equal(await secure(1), false)
  assert.equal(await secure(0, "https"), false)
})

// ═════════════════════════ ออกจากระบบ ═════════════════════════

test("logout: ล้าง cookie (Max-Age=0 ด้วย Path/แฟล็กชุดเดียวกัน) แล้ว /me ได้ 401; ออกซ้ำตอนไม่ได้ล็อกอินก็ 200", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    await c.login()
    assert.equal(c.cookies.has(COOKIE_NAME), true)

    const out = await c.post("/api/admin/logout")
    assert.equal(out.status, 200)
    assert.deepEqual(out.json, { ok: true })
    assert.equal(out.headers.get("set-cookie"), `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
    assert.equal(c.cookies.has(COOKIE_NAME), false)
    assert.equal((await c.get(ME)).status, 401)

    const again = await c.post("/api/admin/logout")
    assert.equal(again.status, 200)
    assert.equal(again.headers.get("set-cookie"), `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
  })
})

test("logout ผ่าน https (TRUST_PROXY=1) ล้าง cookie ด้วยแฟล็ก Secure ชุดเดียวกับตอนตั้ง", async () => {
  await withTestApp({ config: { trustProxy: 1 } }, async (t) => {
    const out = await t.client().post("/api/admin/logout", undefined, { headers: { "X-Forwarded-Proto": "https" } })
    assert.equal(out.headers.get("set-cookie"), `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`)
  })
})

// ═════════════════════════ CSRF ═════════════════════════

test("CSRF: POST ที่ Origin ต่างโฮสต์ → 403 (ล็อกอินและ logout ก็เช่นกัน และ logout ข้ามเว็บไม่ล้าง cookie)", async () => {
  await withTestApp({}, async (t) => {
    const evil = { headers: { Origin: "https://evil.test" } }
    const c = t.client()
    const login = await c.post(LOGIN, { password: TEST_PASSWORD }, evil)
    assert.equal(login.status, 403)
    assert.equal(login.json.code, "forbidden_origin")
    assert.match(login.json.error, THAI)
    assert.equal(login.headers.get("set-cookie"), null)

    await c.login()
    const out = await c.post("/api/admin/logout", undefined, evil)
    assert.equal(out.status, 403)
    assert.equal(out.headers.get("set-cookie"), null)
    assert.equal((await c.get(ME)).status, 200)
  })
})

test("CSRF: body ที่ไม่ใช่ application/json (text/plain, ฟอร์ม) → 415 และไม่ออก cookie", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await c.raw(LOGIN, { method: "POST", headers: { Origin: t.base, "Content-Type": type }, body: `password=${TEST_PASSWORD}` })
      assert.equal(r.status, 415, type)
      assert.equal(r.json.code, "unsupported_media_type")
      assert.match(r.json.error, THAI)
      assert.equal(r.headers.get("set-cookie"), null)
    }
  })
})

test("ด่านตรวจ Origin มาก่อนด่านล็อกอิน: ยังไม่ล็อกอิน + Origin ต่างโฮสต์ = 403 แต่ Origin ปกติ = 401", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    assert.equal((await c.post("/api/admin/novels", { title: "x" }, { headers: { Origin: "https://evil.test" } })).status, 403)
    assert.equal((await c.post("/api/admin/novels", { title: "x" })).status, 401)
    assert.equal((await c.put("/api/admin/settings", {})).status, 401)
    assert.equal((await c.patch("/api/admin/novels/1", {})).status, 401)
    assert.equal((await c.delete("/api/admin/novels/1")).status, 401)
  })
})

test("PUBLIC_URL: Origin ที่เป็นโดเมนสาธารณะผ่านด่าน CSRF แม้ proxy เขียนหัว Host ใหม่; โดเมนอื่นยังโดน 403", async () => {
  await withTestApp({ config: { publicUrl: "https://novel.example.test:8443" } }, async (t) => {
    const c = t.client()
    const evil = await c.post(LOGIN, { password: TEST_PASSWORD }, { headers: { Origin: "https://evil.test" } })
    assert.equal(evil.status, 403)
    // ต่างพอร์ต/ต่างโดเมนของโดเมนสาธารณะก็ไม่ผ่าน
    assert.equal((await c.post(LOGIN, { password: TEST_PASSWORD }, { headers: { Origin: "https://novel.example.test" } })).status, 403)
    assert.equal((await c.post(LOGIN, { password: TEST_PASSWORD }, { headers: { Origin: "https://x.novel.example.test:8443" } })).status, 403)
    const ok = await c.post(LOGIN, { password: TEST_PASSWORD }, { headers: { Origin: "https://novel.example.test:8443" } })
    assert.equal(ok.status, 200)
  })
  // ไม่ตั้ง PUBLIC_URL: โดเมนนั้นไม่ได้รับสิทธิ์พิเศษ
  await withTestApp({}, async (t) => {
    const r = await t.client().post(LOGIN, { password: TEST_PASSWORD }, { headers: { Origin: "https://novel.example.test:8443" } })
    assert.equal(r.status, 403)
  })
})

// ═════════════════════════ โหมดไม่มีรหัสผ่าน ═════════════════════════

test("โหมดไม่มีรหัสผ่าน (loopback): /me ผ่านโดยไม่มี cookie → {admin:true, passwordless:true}", async () => {
  await withTestApp({ config: { adminPassword: null } }, async (t) => {
    const r = await t.client().get(ME)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { admin: true, passwordless: true })
  })
})

test("โหมดไม่มีรหัสผ่าน: หัว Host ต้องเป็น localhost/127.0.0.1/[::1] เท่านั้น (กัน DNS rebinding) ทุกเส้นทางใต้ /api/admin", async () => {
  await withTestApp({ config: { adminPassword: null } }, async (t) => {
    const get = (host: string, path = ME, method = "GET") => rawRequest({ port: t.port, method, path, headers: { Host: host } })
    for (const host of ["localhost", `localhost:${t.port}`, "127.0.0.1", `127.0.0.1:${t.port}`, `[::1]:${t.port}`, "LOCALHOST:3000"]) {
      assert.equal((await get(host)).status, 200, host)
    }
    for (const host of ["evil.test", "localhost.evil.test", "127.0.0.1.evil.test", "evil.test:80", "192.168.1.5", "localhost@evil.test"]) {
      const r = await get(host)
      assert.equal(r.status, 403, host)
      assert.equal((r.json as { code: string }).code, "forbidden_host")
    }
    // ทุกเส้นทางใต้ /api/admin รวมที่ไม่มีอยู่จริง โดนด่าน Host ก่อนถึงตัวจัดการ (ไม่เฉลยว่ามีหรือไม่มี)
    assert.equal((await get("evil.test", "/api/admin/no-such-route")).status, 403)
    assert.equal((await get("evil.test", "/api/admin/novels", "DELETE")).status, 403)
  })
})

test("โหมดไม่มีรหัสผ่าน: ล็อกอินไม่ได้ (400 ไม่ออก cookie ที่เซ็นด้วยกุญแจเปล่า) แต่ออกจากระบบได้ 200", async () => {
  await withTestApp({ config: { adminPassword: null } }, async (t) => {
    const c = t.client()
    for (const password of ["", "anything", TEST_PASSWORD]) {
      const r = await c.post(LOGIN, { password })
      assert.equal(r.status, 400, JSON.stringify(password))
      assert.equal(r.json.code, "passwordless")
      assert.match(r.json.error, THAI)
      assert.equal(r.headers.get("set-cookie"), null)
    }
    assert.equal((await c.post("/api/admin/logout")).status, 200)
  })
})

test("รหัสผ่านเป็นสตริงว่างใน Config ถือเป็นไม่ตั้งรหัส: cookie ที่เซ็นด้วยกุญแจรหัสว่างปลอมเข้าไม่ได้ และ Host แปลกหน้าโดน 403", async () => {
  await withTestApp({ config: { adminPassword: "" } }, async (t) => {
    const forged = signSession(sessionKey("", ""), Date.now())
    const evil = await rawRequest({ port: t.port, path: ME, headers: { Host: "evil.test", Cookie: `${COOKIE_NAME}=${forged}` } })
    assert.equal(evil.status, 403)
    const local = await t.client().get(ME)
    assert.deepEqual(local.json, { admin: true, passwordless: true })
    assert.equal((await t.client().post(LOGIN, { password: "" })).status, 400)
  })
})

// ═════════════════════════ cache และเส้นทางที่ไม่มี ═════════════════════════

test("ทุกคำตอบใต้ /api/admin มี Cache-Control: no-store (สำเร็จ ล้มเหลว ถูกด่านตีกลับ ไม่พบ body ใหญ่)", async () => {
  await withTestApp({}, async (t) => {
    const anon = t.client()
    const c = t.client()
    const cases: [string, number, () => Promise<ClientResponse>][] = [
      ["ยังไม่ล็อกอิน", 401, () => anon.get(ME)],
      ["รหัสผิด", 401, () => anon.post(LOGIN, { password: "nope" })],
      ["body ล็อกอินไม่ถูกรูปแบบ", 400, () => anon.post(LOGIN, {})],
      ["Origin ต่างโฮสต์", 403, () => anon.post(LOGIN, { password: "x" }, { headers: { Origin: "https://evil.test" } })],
      ["text/plain", 415, () => anon.raw(LOGIN, { method: "POST", headers: { Origin: t.base, "Content-Type": "text/plain" }, body: "x" })],
      ["body ล็อกอินใหญ่เกิน", 413, () => rawJson(anon, LOGIN, loginBodyOfSize(2000), t.base)],
      ["เส้นทางที่ไม่มี (ยังไม่ล็อกอิน)", 401, () => anon.get("/api/admin/ไม่มีอยู่")],
      ["ล็อกอินสำเร็จ", 200, () => c.login()],
      ["/me", 200, () => c.get(ME)],
      ["เส้นทางที่ไม่มี (ล็อกอินแล้ว)", 404, () => c.get("/api/admin/ไม่มีอยู่")],
      ["JSON พัง", 400, () => rawJson(c, ME, "{bad", t.base)],
      ["body 9MB", 413, () => rawJson(c, ME, JSON.stringify({ pad: "x".repeat(9 * 1024 * 1024) }), t.base)],
      ["logout", 200, () => c.post("/api/admin/logout")],
    ]
    for (const [label, status, send] of cases) {
      const r = await send()
      assert.equal(r.status, status, label)
      assert.equal(r.headers.get("cache-control"), "no-store", label)
    }
  })
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (let i = 0; i < 10; i++) await c.post(LOGIN, { password: "nope" })
    const blocked = await c.post(LOGIN, { password: "nope" })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get("cache-control"), "no-store")
  })
  await withTestApp({ config: { adminPassword: null } }, async (t) => {
    const r = await rawRequest({ port: t.port, path: ME, headers: { Host: "evil.test" } })
    assert.equal(r.status, 403)
    assert.equal(r.headers["cache-control"], "no-store")
  })
})

test("/api/public รับเฉพาะ GET/HEAD: เมธอดอื่น → 405 JSON ไทย พร้อม Allow", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (const method of ["post", "put", "patch", "delete"] as const) {
      const r = await c[method]("/api/public/novels", {})
      assert.equal(r.status, 405, method)
      assert.equal(r.headers.get("allow"), "GET, HEAD")
      assert.equal(r.json.code, "method_not_allowed")
      assert.match(r.json.error, THAI)
    }
    const options = await c.raw("/api/public/novels", { method: "OPTIONS" })
    assert.equal(options.status, 405)
    // GET และ HEAD ผ่านด่านนี้ไป: เส้นทางสาธารณะที่ไม่มีอยู่ยังเป็น 404 ตามปกติ ไม่ใช่ 405 (และไม่มีหัว Allow)
    const get = await c.get("/api/public/ไม่มีอยู่")
    assert.equal(get.status, 404)
    assert.equal(get.headers.get("allow"), null)
    const head = await c.raw("/api/public/ไม่มีอยู่", { method: "HEAD" })
    assert.equal(head.status, 404)
    assert.equal(head.headers.get("allow"), null)
  })
})

test("/api/<ไม่มีอยู่> → 404 JSON ไทย (ไม่ใช่หน้า HTML) ทุกเมธอด และยังมีหัวความปลอดภัย + noindex", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (const path of ["/api/ไม่มีอยู่", "/api", "/api/", "/api/x/y/z"]) {
      const r = await c.get(path)
      assert.equal(r.status, 404, path)
      assert.match(r.headers.get("content-type")!, /^application\/json/)
      assert.deepEqual(Object.keys(r.json).sort(), ["code", "error"])
      assert.equal(r.json.code, "not_found")
      assert.match(r.json.error, THAI)
      assert.equal(r.headers.get("x-robots-tag"), "noindex")
      assert.match(r.headers.get("content-security-policy")!, /^default-src 'self'/)
    }
    assert.equal((await c.post("/api/ไม่มีอยู่", { a: 1 })).status, 404)
    assert.equal((await c.delete("/api/ไม่มีอยู่")).status, 404)
  })
})

test("เส้นทางใต้ /api/admin ที่ไม่มี: ยังไม่ล็อกอิน → 401 (ไม่เฉลยว่ามีหรือไม่); ล็อกอินแล้ว → 404 JSON", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    assert.equal((await c.get("/api/admin/ไม่มีอยู่")).status, 401)
    await c.login()
    const r = await c.get("/api/admin/ไม่มีอยู่")
    assert.equal(r.status, 404)
    assert.equal(r.json.code, "not_found")
    // /me รับ GET เท่านั้น
    assert.equal((await c.post(ME, {})).status, 404)
    assert.equal((await c.delete(ME)).status, 404)
  })
})

// ═════════════════════════ JSON พัง / ขนาด body ═════════════════════════

test("JSON พัง → 400 ข้อความไทย (ทั้งที่ตัวล็อกอินและหลังล็อกอิน) และ JSON ที่ไม่ใช่ออบเจ็กต์/อาร์เรย์ก็ไม่รับ", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    for (const body of ["{bad json", '{"password": ', '"just a string"', "42", "null"]) {
      const r = await rawJson(c, LOGIN, body, t.base)
      assert.equal(r.status, 400, body)
      assert.equal(r.json.code, "bad_json")
      assert.match(r.json.error, THAI)
    }
    // ยังไม่ล็อกอิน: ด่านล็อกอินมาก่อนการอ่าน body → 401 ไม่ใช่ 400
    assert.equal((await rawJson(c, "/api/admin/novels", "{bad json", t.base)).status, 401)

    await c.login()
    for (const body of ["{bad json", '"just a string"']) {
      const r = await rawJson(c, "/api/admin/novels", body, t.base)
      assert.equal(r.status, 400, body)
      assert.equal(r.json.code, "bad_json")
    }
    assert.equal((await c.get(ME)).status, 200)
  })
})

test("Review Focus 3: JSON 9MB หลังล็อกอิน → 413 too_large ข้อความไทย แล้วคำขอถัดไปยังตอบ 200 (เซิร์ฟเวอร์ไม่ล้ม)", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    await c.login()
    const big = await rawJson(c, ME, JSON.stringify({ pad: "x".repeat(9 * 1024 * 1024) }), t.base)
    assert.equal(big.status, 413)
    assert.equal(big.json.code, "too_large")
    assert.equal(big.json.error, "ข้อมูลที่ส่งมาใหญ่เกินกำหนด")
    const me = await c.get(ME)
    assert.equal(me.status, 200)
    assert.deepEqual(me.json, { admin: true, passwordless: false })
    assert.deepEqual(
      t.logs.filter((line) => line.startsWith("error:")),
      [],
    )
  })
})

test("เพดาน body หลังล็อกอิน 8MB พอดี: เท่าเพดานอ่านได้ (ไปถึงเส้นทาง → 404) เกินไป 1 ไบต์ → 413", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    await c.login()
    const limit = 8 * 1024 * 1024
    const frame = JSON.stringify({ pad: "" }).length
    const exactly = JSON.stringify({ pad: "x".repeat(limit - frame) })
    assert.equal(Buffer.byteLength(exactly), limit)
    assert.equal((await rawJson(c, "/api/admin/ไม่มีอยู่", exactly, t.base)).status, 404)
    const over = JSON.stringify({ pad: "x".repeat(limit - frame + 1) })
    assert.equal((await rawJson(c, "/api/admin/ไม่มีอยู่", over, t.base)).status, 413)
  })
})

test("ยังไม่ล็อกอิน: body 9MB ได้ 401 (ด่านล็อกอินมาก่อนการอ่าน body จึงไม่เสียหน่วยความจำให้คนแปลกหน้า)", async () => {
  await withTestApp({}, async (t) => {
    const r = await rawJson(t.client(), "/api/admin/novels", JSON.stringify({ pad: "x".repeat(9 * 1024 * 1024) }), t.base)
    assert.equal(r.status, 401)
  })
})

test("ตัวล็อกอินรับ body ไม่เกิน 1KB: 2KB → 413 ข้อความไทย; ขอบเขต 1024 ไบต์ผ่าน (รหัสผิด → 401) 1025 → 413", async () => {
  await withTestApp({}, async (t) => {
    const c = t.client()
    const big = await rawJson(c, LOGIN, loginBodyOfSize(2048), t.base)
    assert.equal(big.status, 413)
    assert.equal(big.json.code, "too_large")
    assert.match(big.json.error, THAI)

    assert.equal(Buffer.byteLength(loginBodyOfSize(1024)), 1024)
    assert.equal((await rawJson(c, LOGIN, loginBodyOfSize(1024), t.base)).status, 401)
    assert.equal((await rawJson(c, LOGIN, loginBodyOfSize(1025), t.base)).status, 413)
    await c.login()
  })
})

// ═════════════════════════ อายุเซสชันและกุญแจ ═════════════════════════

test("เซสชันอยู่ได้ 30 วันพอดี (ถึงมิลลิวินาทีสุดท้าย) แล้วหมดอายุ → 401 ล็อกอินใหม่ได้", async () => {
  const k = clock()
  await withTestApp({ now: k.now }, async (t) => {
    const c = t.client()
    await c.login()
    k.advance(30 * DAY)
    assert.equal((await c.get(ME)).status, 200)
    k.advance(1)
    assert.equal((await c.get(ME)).status, 401)
    await c.login()
    assert.equal((await c.get(ME)).status, 200)
  })
})

test("cookie ที่ลงนามด้วยกุญแจอื่น/แก้ไข/ผิดชื่อ/ผิดรูป เข้าไม่ได้ (เปลี่ยนรหัสผ่านหรือ SESSION_SECRET แล้ว session เก่าใช้ไม่ได้)", async () => {
  const k = clock()
  await withTestApp({ now: k.now }, async (t) => {
    const probe = (cookie: string) => t.client().raw(ME, { headers: { Cookie: cookie } })
    const good = signSession(sessionKey(TEST_PASSWORD, ""), k.ms())
    assert.equal((await probe(`${COOKIE_NAME}=${good}`)).status, 200)
    assert.equal((await probe(`${COOKIE_NAME}=${signSession(sessionKey("another-password", ""), k.ms())}`)).status, 401)
    assert.equal((await probe(`${COOKIE_NAME}=${signSession(sessionKey(TEST_PASSWORD, "added-secret"), k.ms())}`)).status, 401)
    const [payload, signature] = good.split(".") as [string, string]
    const tampered = `${Buffer.from(String(k.ms() + 999 * DAY)).toString("base64url")}.${signature}`
    assert.equal((await probe(`${COOKIE_NAME}=${tampered}`)).status, 401)
    assert.equal((await probe(`${COOKIE_NAME}=${payload}`)).status, 401)
    assert.equal((await probe(`${COOKIE_NAME}=`)).status, 401)
    assert.equal((await probe(`${COOKIE_NAME}=garbage`)).status, 401)
    assert.equal((await probe(`some_other_cookie=${good}`)).status, 401)
    assert.equal((await probe(`${COOKIE_NAME}=${good}x`)).status, 401)
  })
})

test("SESSION_SECRET ผสมเข้ากุญแจ: ตั้งแล้ว cookie ที่ลงนามด้วยกุญแจไม่มี secret เข้าไม่ได้ และที่ลงด้วย secret ตรงกันเข้าได้", async () => {
  const k = clock()
  await withTestApp({ now: k.now, config: { sessionSecret: "deploy-secret-1" } }, async (t) => {
    const probe = (cookie: string) => t.client().raw(ME, { headers: { Cookie: cookie } })
    assert.equal((await probe(`${COOKIE_NAME}=${signSession(sessionKey(TEST_PASSWORD, "deploy-secret-1"), k.ms())}`)).status, 200)
    assert.equal((await probe(`${COOKIE_NAME}=${signSession(sessionKey(TEST_PASSWORD, ""), k.ms())}`)).status, 401)
    // และ cookie ที่แอปออกให้เองก็ใช้ได้ (ล็อกอินกับตรวจใช้กุญแจเดียวกัน)
    const c = t.client()
    await c.login()
    assert.equal((await c.get(ME)).status, 200)
    assert.equal(verifySession(sessionKey(TEST_PASSWORD, "deploy-secret-1"), c.cookies.get(COOKIE_NAME), k.ms()), true)
  })
})

// ═════════════════════════ isAdminRequest ═════════════════════════

function depsWith(config: Partial<Config>, nowMs = Date.parse("2026-10-22T05:00:00Z")): AppDeps {
  return { config: { adminPassword: TEST_PASSWORD, sessionSecret: "", ...config }, now: () => new Date(nowMs) } as unknown as AppDeps
}
const reqWith = (headers: { host?: string; cookie?: string }): Request => ({ headers }) as unknown as Request

test("isAdminRequest (มีรหัสผ่าน): ต้องมี cookie ที่ลงนามถูกและยังไม่หมดอายุ", () => {
  const now = Date.parse("2026-10-22T05:00:00Z")
  const deps = depsWith({}, now)
  const key = sessionKey(TEST_PASSWORD, "")
  const withCookie = (token: string, name = COOKIE_NAME) => reqWith({ host: "127.0.0.1:8787", cookie: `a=1; ${name}=${token}; b=2` })
  assert.equal(isAdminRequest(deps, withCookie(signSession(key, now))), true)
  assert.equal(isAdminRequest(deps, withCookie(signSession(key, now - SESSION_TTL_MS))), true) // หมดอายุที่ now พอดี ยังใช้ได้
  assert.equal(isAdminRequest(deps, withCookie(signSession(key, now - SESSION_TTL_MS - 1))), false)
  assert.equal(isAdminRequest(deps, withCookie(signSession(sessionKey("other-password", ""), now))), false)
  assert.equal(isAdminRequest(deps, withCookie(signSession(key, now), "not_our_cookie")), false)
  assert.equal(isAdminRequest(deps, reqWith({ host: "127.0.0.1:8787" })), false)
  assert.equal(isAdminRequest(deps, reqWith({})), false)
  // โหมดมีรหัสผ่านไม่สนหัว Host (อยู่หลังโดเมนจริงได้)
  assert.equal(isAdminRequest(deps, reqWith({ host: "novel.example.com", cookie: `${COOKIE_NAME}=${signSession(key, now)}` })), true)
})

test("isAdminRequest (ไม่มีรหัสผ่าน): เป็นผู้ดูแลเมื่อ Host เป็น loopback เท่านั้น — เว็บอื่นที่ชี้ DNS มาที่เครื่องนี้ไม่ได้สิทธิ์ผู้ดูแล", () => {
  for (const adminPassword of [null, ""]) {
    const deps = depsWith({ adminPassword })
    for (const host of ["localhost", "localhost:8787", "127.0.0.1:8787", "[::1]:8787"]) assert.equal(isAdminRequest(deps, reqWith({ host })), true, host)
    for (const host of ["evil.test", "localhost.evil.test", "192.168.1.5:8787", ""]) assert.equal(isAdminRequest(deps, reqWith({ host })), false, host)
    assert.equal(isAdminRequest(deps, reqWith({})), false)
    // cookie ที่เซ็นด้วยกุญแจรหัสว่างก็ไม่ทำให้ Host แปลกหน้าเป็นผู้ดูแล
    const forged = signSession(sessionKey("", ""), Date.parse("2026-10-22T05:00:00Z"))
    assert.equal(isAdminRequest(deps, reqWith({ host: "evil.test", cookie: `${COOKIE_NAME}=${forged}` })), false)
  }
})
