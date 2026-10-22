import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { loadConfig, ConfigError } from "../src/config.js"

const PW = "correct-horse-battery" // 21 chars, long enough to avoid the short-password warning
const isConfigError = (re?: RegExp) => (e: unknown) => e instanceof ConfigError && (re ? re.test(e.message) : true)

test("ค่าเริ่มต้น", () => {
  const { config, warnings } = loadConfig({})
  assert.equal(config.host, "127.0.0.1")
  assert.equal(config.port, 8787)
  assert.equal(config.trustProxy, 0)
  assert.equal(config.adminPassword, null)
  assert.equal(config.importToken, null)
  assert.equal(config.publicUrl, null)
  assert.equal(config.anthropicApiKey, null)
  assert.equal(config.sessionSecret, "")
  assert.equal(config.translateModel, "claude-sonnet-5-5")
  assert.equal(config.recapModel, "claude-haiku-4-5-20251001")
  assert.equal(config.isLoopbackHost, true)
  assert.equal(config.hsts, false)
  assert.ok(config.dbPath.endsWith(path.join("server", "data", "koymukarnnovel.db")), config.dbPath)
  assert.ok(config.webDist.endsWith(path.join("web", "dist")), config.webDist)
  assert.ok(warnings.some((w) => w.includes("หลังบ้านเปิดโดยไม่ต้องล็อกอิน")))
})

test("ค่า env ว่าง นับเป็นไม่ตั้ง", () => {
  const empty = Object.fromEntries(
    ["HOST", "PORT", "PUBLIC_URL", "TRUST_PROXY", "DB_PATH", "ADMIN_PASSWORD", "ANTHROPIC_API_KEY", "SESSION_SECRET", "IMPORT_TOKEN", "TRANSLATE_MODEL", "RECAP_MODEL"].map((k) => [k, ""]),
  )
  assert.deepEqual(loadConfig(empty), loadConfig({}))
})

test("HOST ที่ไม่ใช่ loopback ต้องมี ADMIN_PASSWORD", () => {
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }), isConfigError(/ADMIN_PASSWORD/))
  const { config } = loadConfig({ HOST: "0.0.0.0", ADMIN_PASSWORD: PW })
  assert.equal(config.isLoopbackHost, false)
  assert.equal(config.adminPassword, PW)
})

test("loopback คือ 127.0.0.1, localhost และ ::1 เท่านั้น", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
    assert.equal(loadConfig({ HOST: host }).config.isLoopbackHost, true, host)
  }
  assert.throws(() => loadConfig({ HOST: "192.168.1.5" }), isConfigError(/ADMIN_PASSWORD/))
})

test("IMPORT_TOKEN ต้องยาวอย่างน้อย 24 ตัวอักษร", () => {
  const short = loadConfig({ ADMIN_PASSWORD: PW, IMPORT_TOKEN: "t".repeat(23) })
  assert.equal(short.config.importToken, null)
  assert.ok(short.warnings.some((w) => w.includes("IMPORT_TOKEN")))
  const ok = loadConfig({ ADMIN_PASSWORD: PW, IMPORT_TOKEN: "t".repeat(24) })
  assert.equal(ok.config.importToken, "t".repeat(24))
  assert.ok(!ok.warnings.some((w) => w.includes("IMPORT_TOKEN")))
})

test("ADMIN_PASSWORD สั้นกว่า 10 ตัวอักษร ใช้ได้แต่เตือน", () => {
  const short = loadConfig({ ADMIN_PASSWORD: "123456789" })
  assert.equal(short.config.adminPassword, "123456789")
  assert.ok(short.warnings.some((w) => w.includes("ADMIN_PASSWORD")))
  assert.ok(!loadConfig({ ADMIN_PASSWORD: "1234567890" }).warnings.some((w) => w.includes("ADMIN_PASSWORD")))
})

test("TRUST_PROXY เป็นจำนวนเต็มไม่ติดลบ", () => {
  assert.equal(loadConfig({ TRUST_PROXY: "2" }).config.trustProxy, 2)
  for (const bad of ["x", "-1", "1.5"]) assert.throws(() => loadConfig({ TRUST_PROXY: bad }), isConfigError(/TRUST_PROXY/), bad)
})

test("PUBLIC_URL ตัด / ท้ายและเปิด HSTS เฉพาะ https", () => {
  const https = loadConfig({ PUBLIC_URL: "https://a.example/" }).config
  assert.equal(https.publicUrl, "https://a.example")
  assert.equal(https.hsts, true)
  const http = loadConfig({ PUBLIC_URL: "http://a.example" }).config
  assert.equal(http.publicUrl, "http://a.example")
  assert.equal(http.hsts, false)
  assert.throws(() => loadConfig({ PUBLIC_URL: "ftp://x" }), isConfigError(/PUBLIC_URL/))
  assert.throws(() => loadConfig({ PUBLIC_URL: "not a url" }), isConfigError(/PUBLIC_URL/))
})

test("PORT อยู่ในช่วง 0–65535", () => {
  assert.equal(loadConfig({ PORT: "0" }).config.port, 0)
  assert.equal(loadConfig({ PORT: "65535" }).config.port, 65535)
  for (const bad of ["70000", "-1", "abc", "80.5"]) assert.throws(() => loadConfig({ PORT: bad }), isConfigError(/PORT/), bad)
})

test("DB_PATH และชื่อโมเดลจาก env", () => {
  const { config } = loadConfig({ DB_PATH: "/tmp/koymukarnnovel/x.db", TRANSLATE_MODEL: "m-translate", RECAP_MODEL: "m-recap", SESSION_SECRET: "s", ANTHROPIC_API_KEY: "k" })
  assert.equal(config.dbPath, "/tmp/koymukarnnovel/x.db")
  assert.equal(config.translateModel, "m-translate")
  assert.equal(config.recapModel, "m-recap")
  assert.equal(config.sessionSecret, "s")
  assert.equal(config.anthropicApiKey, "k")
  assert.equal(loadConfig({ DB_PATH: "data/x.db" }).config.dbPath, path.resolve("data/x.db"))
})

test("ความลับไม่ปรากฏในคำเตือน", () => {
  const secrets = { ADMIN_PASSWORD: "short-pw", ANTHROPIC_API_KEY: "sk-ant-very-secret", IMPORT_TOKEN: "tooshort", SESSION_SECRET: "sess-secret" }
  const text = loadConfig(secrets).warnings.join("\n")
  for (const v of Object.values(secrets)) assert.ok(!text.includes(v), v)
})
