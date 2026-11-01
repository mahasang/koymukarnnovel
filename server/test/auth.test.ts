import { test, mock } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import { COOKIE_NAME, SESSION_TTL_MS, clearCookieHeader, cookieHeader, parseCookies, passwordMatches, sessionKey, signSession, verifySession } from "../src/auth.js"

const NOW = Date.UTC(2026, 9, 22, 5, 0, 0)
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest()

// ───────────────────────── sessionKey ─────────────────────────

test("ค่าคงที่: ชื่อ cookie และอายุเซสชัน 30 วัน", () => {
  assert.equal(COOKIE_NAME, "koymukarnnovel_admin")
  assert.equal(SESSION_TTL_MS, 30 * 24 * 3600 * 1000)
})

test("sessionKey = sha256 ของ \"koymukarnnovel-session-v1\\0\" + secret + \"\\0\" + password", () => {
  const key = sessionKey("รหัสผ่านทดสอบ", "ความลับ")
  assert.equal(key.length, 32)
  assert.ok(key.equals(sha256("koymukarnnovel-session-v1\0ความลับ\0รหัสผ่านทดสอบ")))
})

test("sessionKey: เปลี่ยนรหัสผ่านหรือ secret ก็ได้กุญแจใหม่ และรอยต่อของสองช่องไม่ชนกัน", () => {
  const base = sessionKey("pw", "s")
  assert.ok(!base.equals(sessionKey("pw2", "s")))
  assert.ok(!base.equals(sessionKey("pw", "s2")))
  assert.ok(!sessionKey("c", "ab").equals(sessionKey("bc", "a")), "ย้ายตัวอักษรข้ามรอยต่อต้องไม่ได้กุญแจเดิม")
  assert.ok(sessionKey("pw", "s").equals(base), "ค่าเดิมได้กุญแจเดิม")
  assert.equal(sessionKey("pw", "").length, 32, "ไม่ตั้ง SESSION_SECRET ก็ใช้ได้")
})

// ───────────────────────── signSession / verifySession ─────────────────────────

test("เซ็นแล้วตรวจผ่านจนถึงวินาทีสุดท้ายของอายุ แล้วไม่ผ่านที่ +1 มิลลิวินาที", () => {
  const key = sessionKey("pw", "s")
  const token = signSession(key, NOW)
  assert.equal(verifySession(key, token, NOW), true)
  assert.equal(verifySession(key, token, NOW + 1000), true)
  assert.equal(verifySession(key, token, NOW + SESSION_TTL_MS), true)
  assert.equal(verifySession(key, token, NOW + SESSION_TTL_MS + 1), false)
  assert.equal(verifySession(key, token, NOW + 2 * SESSION_TTL_MS), false)
})

test("รูปแบบ token: base64url(เวลาหมดอายุ) + \".\" + HMAC-SHA256 ของส่วนแรก (base64url)", () => {
  const key = sessionKey("pw", "s")
  const token = signSession(key, NOW)
  const parts = token.split(".")
  assert.equal(parts.length, 2)
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(Buffer.from(parts[0]!, "base64url").toString("utf8"), String(NOW + SESSION_TTL_MS))
  assert.equal(parts[1], crypto.createHmac("sha256", key).update(parts[0]!).digest("base64url"))
  assert.equal(signSession(key, NOW), token, "เวลาเดียวกันได้ token เดิม (ไม่มีสถานะในเซิร์ฟเวอร์)")
  assert.notEqual(signSession(key, NOW + 1), token)
})

test("แก้ token แม้ตัวอักษรเดียว ณ ตำแหน่งใดก็ตาม → ไม่ผ่าน", () => {
  const key = sessionKey("pw", "s")
  const token = signSession(key, NOW)
  for (let i = 0; i < token.length; i++) {
    const swap = token[i] === "A" ? "B" : "A"
    const tampered = token.slice(0, i) + swap + token.slice(i + 1)
    assert.equal(verifySession(key, tampered, NOW), false, `ตำแหน่ง ${i}`)
  }
})

test("ขยะ / undefined / รูปแบบผิด → ไม่ผ่าน และไม่ throw", () => {
  const key = sessionKey("pw", "s")
  const token = signSession(key, NOW)
  const [payload, sig] = token.split(".") as [string, string]
  const bad: (string | undefined)[] = [
    undefined,
    "",
    ".",
    "garbage",
    "a.b",
    `${payload}`,
    `${payload}.`,
    `.${sig}`,
    `${token}.x`,
    `${token}x`,
    `${payload}.${sig}.${sig}`,
    ` ${token}`,
    `${token} `,
    "ก.ข",
    "\0",
    "x".repeat(10_000),
    `${payload}.${"ก".repeat(sig.length)}`, // ยาว 43 "ตัวอักษร" เท่าลายเซ็นจริงแต่ไบต์ไม่เท่า — timingSafeEqual จะ throw ถ้าเทียบตรงๆ
    `${payload}.${"é".repeat(sig.length)}`,
  ]
  for (const t of bad) assert.equal(verifySession(key, t, NOW), false, JSON.stringify(t))
  assert.equal(verifySession(key, 123 as unknown as string, NOW), false)
  assert.equal(verifySession(key, { toString: () => token } as unknown as string, NOW), false)
})

test("ลายเซ็นถูกต้องแต่ payload ไม่ใช่ตัวเลขล้วนที่เป็นจำนวนเต็มปลอดภัย → ไม่ผ่าน (ไม่ตีความ hex / Infinity / เว้นวรรค)", () => {
  const key = sessionKey("pw", "s")
  const forge = (text: string) => {
    const payload = Buffer.from(text).toString("base64url")
    return `${payload}.${crypto.createHmac("sha256", key).update(payload).digest("base64url")}`
  }
  assert.equal(verifySession(key, forge(String(NOW + 1000)), NOW), true, "ตัวช่วยเซ็นเองใช้ได้เมื่อ payload ถูกรูปแบบ")
  for (const text of ["Infinity", "1e21", "0x7fffffffffff", " 99999999999999", "99999999999999 ", "-1", "1.5", "", "abc", "9".repeat(16)]) {
    assert.equal(verifySession(key, forge(text), NOW), false, JSON.stringify(text))
  }
})

test("ปลอมวันหมดอายุไม่ได้: เปลี่ยน payload เป็นอนาคตแล้วใช้ลายเซ็นเดิม → ไม่ผ่าน", () => {
  const key = sessionKey("pw", "s")
  const [, sig] = signSession(key, NOW).split(".") as [string, string]
  const forged = `${Buffer.from(String(NOW + 10 * SESSION_TTL_MS)).toString("base64url")}.${sig}`
  assert.equal(verifySession(key, forged, NOW), false)
})

test("ลายเซ็นต้องเป็นรูปแบบมาตรฐานเท่านั้น: ตัวอักษรท้ายที่ถอดรหัสได้เท่าเดิมก็ไม่ผ่าน", () => {
  const key = sessionKey("pw", "s")
  // base64url ของ 32 ไบต์มี 43 ตัวอักษร ตัวท้ายใช้แค่ 4 บิต อีก 2 บิตเป็นศูนย์ ตัวที่ต่างกันแค่บิตท้ายถอดรหัสได้ไบต์เดิม
  for (const ts of [NOW, NOW + 1, NOW + 2, NOW + 3, NOW + 4, NOW + 5, NOW + 6, NOW + 7]) {
    const token = signSession(key, ts)
    const sig = token.split(".")[1]!
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const lastIndex = alphabet.indexOf(sig.at(-1)!)
    const sibling = alphabet[lastIndex ^ 1]! // ต่างกันที่บิตต่ำสุด (ซึ่งเป็นบิตเกิน)
    const variant = token.slice(0, -1) + sibling
    assert.deepEqual(Buffer.from(variant.split(".")[1]!, "base64url"), Buffer.from(sig, "base64url"), "ตัวอย่างนี้ต้องถอดรหัสได้ไบต์เท่าเดิม")
    assert.equal(verifySession(key, variant, ts), false)
  }
})

test("เปลี่ยนรหัสผ่านหรือ SESSION_SECRET → token เก่าไม่ผ่านทันที", () => {
  const token = signSession(sessionKey("pw", "s"), NOW)
  assert.equal(verifySession(sessionKey("pw", "s"), token, NOW), true)
  assert.equal(verifySession(sessionKey("pw2", "s"), token, NOW), false)
  assert.equal(verifySession(sessionKey("pw", "s2"), token, NOW), false)
  assert.equal(verifySession(sessionKey("pw", ""), token, NOW), false)
})

test("verifySession เทียบลายเซ็นด้วย timingSafeEqual (เวลาคงที่) และไม่เทียบเมื่อความยาวต่างกัน", () => {
  const key = sessionKey("pw", "s")
  const token = signSession(key, NOW)
  const spy = mock.method(crypto, "timingSafeEqual")
  try {
    assert.equal(verifySession(key, token, NOW), true)
    assert.equal(spy.mock.callCount(), 1)
    const [a, b] = spy.mock.calls[0]!.arguments as [Buffer, Buffer]
    assert.equal(a.length, b.length)
    assert.equal(verifySession(key, token.slice(0, -2), NOW), false, "ลายเซ็นสั้นไป ต้องไม่ throw")
    assert.equal(spy.mock.callCount(), 1, "ความยาวต่างกันตัดสินได้เลย ไม่ต้องเรียก timingSafeEqual (ซึ่งจะ throw)")
  } finally {
    spy.mock.restore()
  }
})

// ───────────────────────── passwordMatches ─────────────────────────

test("passwordMatches: ตรงกันเป๊ะเท่านั้น (รวมภาษาไทยและตัวพิมพ์เล็กใหญ่)", () => {
  assert.equal(passwordMatches("correct horse", "correct horse"), true)
  assert.equal(passwordMatches("รหัสผ่านภาษาไทย๑๒๓", "รหัสผ่านภาษาไทย๑๒๓"), true)
  assert.equal(passwordMatches("Correct horse", "correct horse"), false)
  assert.equal(passwordMatches("correct horse ", "correct horse"), false)
  assert.equal(passwordMatches("", "correct horse"), false)
})

test("passwordMatches: ความยาวต่างกันไม่ throw (แฮชก่อนเทียบ) และรหัสที่ตั้งไว้ว่างไม่มีวันตรง", () => {
  assert.equal(passwordMatches("a", "a".repeat(10_000)), false)
  assert.equal(passwordMatches("a".repeat(10_000), "a"), false)
  assert.equal(passwordMatches("", ""), false, "ไม่ได้ตั้งรหัสผ่านต้องไม่ล็อกอินด้วยรหัสว่างได้")
  assert.equal(passwordMatches("x", ""), false)
})

test("passwordMatches เทียบ sha256 ของทั้งสองฝั่งด้วย timingSafeEqual (ได้ 32 ไบต์เท่ากันแม้ความยาวต่าง)", () => {
  const spy = mock.method(crypto, "timingSafeEqual")
  try {
    assert.equal(passwordMatches("short", "a much longer expected password"), false)
    assert.equal(spy.mock.callCount(), 1)
    const [a, b] = spy.mock.calls[0]!.arguments as [Buffer, Buffer]
    assert.ok(a.equals(sha256("short")) && b.equals(sha256("a much longer expected password")))
  } finally {
    spy.mock.restore()
  }
})

// ───────────────────────── cookie ─────────────────────────

test("cookieHeader: รูปแบบตรงตัว และต่อท้าย Secure เมื่อ HTTPS", () => {
  assert.equal(cookieHeader("t.k", false), "koymukarnnovel_admin=t.k; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax")
  assert.equal(cookieHeader("t.k", true), "koymukarnnovel_admin=t.k; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure")
})

test("clearCookieHeader: ล้าง cookie ด้วย Max-Age=0 (path/flags เดียวกับตอนตั้ง) และ Secure เมื่อ HTTPS", () => {
  assert.equal(clearCookieHeader(false), "koymukarnnovel_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax")
  assert.equal(clearCookieHeader(true), "koymukarnnovel_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure")
})

test("parseCookies: แยกหัว Cookie เป็นคู่ชื่อ-ค่า", () => {
  assert.deepEqual(parseCookies("a=1; koymukarnnovel_admin=xyz; b=2"), { a: "1", koymukarnnovel_admin: "xyz", b: "2" })
  assert.equal(parseCookies("a=1; koymukarnnovel_admin=xyz; b=2")[COOKIE_NAME], "xyz")
  assert.deepEqual(parseCookies(undefined), {})
  assert.deepEqual(parseCookies(""), {})
  assert.deepEqual(parseCookies("   "), {})
  assert.deepEqual(parseCookies("a=1;b=2;  c = 3 "), { a: "1", b: "2", c: "3" })
})

test("parseCookies: ค่าที่มี = ในตัว, เปอร์เซ็นต์เอนโค้ด, เครื่องหมายคำพูดครอบ และชิ้นที่เสียถูกข้าม", () => {
  assert.deepEqual(parseCookies("t=a=b=c"), { t: "a=b=c" })
  assert.deepEqual(parseCookies("n=%E0%B8%81%E0%B8%82"), { n: "กข" })
  assert.deepEqual(parseCookies("n=%E0%B8"), { n: "%E0%B8" }, "เอนโค้ดเสียคงไว้ตามเดิม ไม่ throw")
  assert.deepEqual(parseCookies('q="quoted value"'), { q: "quoted value" })
  assert.deepEqual(parseCookies('q="'), { q: '"' }, "เครื่องหมายคำพูดตัวเดียวไม่ใช่การครอบ")
  assert.deepEqual(parseCookies('q=""'), { q: "" })
  assert.deepEqual(parseCookies('q="abc'), { q: '"abc' }, "ครอบด้วยเครื่องหมายคำพูดต้องมีทั้งหน้าและหลัง")
  assert.deepEqual(parseCookies('q=abc"'), { q: 'abc"' })
  assert.deepEqual(parseCookies("novalue; =x; ; a=1;;"), { a: "1" })
  assert.deepEqual(parseCookies("e="), { e: "" })
})

test("parseCookies: ชื่อซ้ำใช้ตัวแรก และ __proto__ ไม่ทำให้ prototype เปลี่ยน", () => {
  assert.deepEqual(parseCookies("a=first; a=second"), { a: "first" })
  const parsed = parseCookies("__proto__=evil; polluted=yes; constructor=x; toString=y")
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype)
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined)
  assert.equal(parsed["polluted"], "yes")
  assert.ok(!Object.keys(parsed).includes("__proto__"))
  assert.equal(parsed["constructor"], "x")
  assert.equal(parsed["toString"], "y")
})
