import assert from "node:assert/strict"
import fs from "node:fs"
import { describe, test } from "node:test"
import { WINDOWS, spawnNode, within, type Child } from "./helpers/boot.js"

/**
 * `e2e/server.ts` (เซิร์ฟเวอร์ที่ e2e/shot.mjs และ e2e/run.mjs เปิดใช้): ระบบจริง + ฐานข้อมูลชั่วคราว + ข้อมูลตัวอย่าง + AI ปลอม
 * ตรวจเฉพาะส่วนที่ไฟล์นี้เพิ่มเอง (การเริ่ม/ปิดระบบจริงทดสอบใน bootstrap*.test.ts แล้ว):
 * บรรทัด READY, ข้อมูลตัวอย่าง, ฉีด AI ปลอม, ไม่อ่านตัวแปรสภาพแวดล้อมของเครื่อง, รหัสผ่านหลังบ้าน, ลบโฟลเดอร์ชั่วคราวตอนปิด
 */

const LISTENING = /^READY (http:\/\/127\.0\.0\.1:(\d+))$/m
/** ค่าของเครื่องผู้รันที่ต้องไม่ไหลเข้าไปในเซิร์ฟเวอร์ e2e — ถ้าไหลเข้า พอร์ต/ที่อยู่/ฐานข้อมูล/รหัส/ช่องทางนำเข้าจะผิดจากที่ตรวจด้านล่าง */
const MACHINE_ENV = {
  HOST: "0.0.0.0",
  PORT: "9",
  DB_PATH: "/nonexistent-machine-dir/real.db",
  ADMIN_PASSWORD: "machine-admin-password",
  SESSION_SECRET: "machine-session-secret-0123456789",
  IMPORT_TOKEN: "machine-import-token-0123456789-abcdef",
  ANTHROPIC_API_KEY: "machine-api-key-for-tests-9f8e7d6c",
  PUBLIC_URL: "https://machine.example.com",
}

function e2eEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...MACHINE_ENV, ...extra }
  if (extra.E2E_ADMIN_PASSWORD === undefined) delete env.E2E_ADMIN_PASSWORD
  return env
}

async function using<T>(child: Child, fn: (child: Child, url: string) => Promise<T>): Promise<T> {
  try {
    const [, url] = await child.waitFor(LISTENING)
    return await fn(child, url)
  } finally {
    await stop(child)
  }
}

/** ปิดเซิร์ฟเวอร์ด้วยสัญญาณปกติให้มันลบโฟลเดอร์ชั่วคราวเอง (ไม่ปิดภายใน 5 วินาทีค่อยฆ่า) — ไม่งั้นรอบทดสอบแต่ละรอบทิ้งโฟลเดอร์ไว้ใน /tmp */
async function stop(child: Child): Promise<void> {
  child.kill(WINDOWS ? "SIGKILL" : "SIGTERM")
  try {
    await within(child.exited, 5000, "e2e server ปิดตัว")
  } catch {
    child.kill("SIGKILL")
    await child.exited
  }
}

const login = (url: string, password: string) =>
  fetch(`${url}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) })

describe("e2e/server.ts", { concurrency: 3 }, () => {
  test("พิมพ์ READY <url> บน 127.0.0.1 (พอร์ตสุ่ม) แล้ว /healthz ตอบ ok และมีนิยายตัวอย่างที่เผยแพร่แล้ว 1 เรื่อง 3 ตอน", async () => {
    await using(spawnNode(["../e2e/server.ts"], e2eEnv({ E2E_ADMIN_PASSWORD: "pw-for-e2e-test" })), async (_child, url) => {
      assert.notEqual(new URL(url).port, "9")
      assert.equal(await (await fetch(`${url}/healthz`)).text(), "ok")
      const list = (await (await fetch(`${url}/api/public/novels`)).json()) as { title: string; titleTh: string; chapterCount: number }[]
      assert.equal(list.length, 1)
      assert.equal(list[0].title, "Ledger of the Lantern Tide")
      assert.match(list[0].titleTh, /\(ตัวอย่าง\)/)
      assert.equal(list[0].chapterCount, 3)
    })
  })

  test("ไม่ใช้ตัวแปรสภาพแวดล้อมของเครื่อง: HOST/PORT/DB_PATH/ADMIN_PASSWORD/IMPORT_TOKEN/ANTHROPIC_API_KEY ที่ตั้งไว้ถูกเมินทั้งหมด", async () => {
    await using(spawnNode(["../e2e/server.ts"], e2eEnv({ E2E_ADMIN_PASSWORD: "pw-for-e2e-test" })), async (child, url) => {
      assert.match(child.out(), /ฐานข้อมูล: .*koymukarnnovel-e2e-/) // ไม่ใช่ DB_PATH ของเครื่อง
      assert.doesNotMatch(child.out() + child.err(), /machine-|nonexistent-machine-dir/)
      // รหัสผ่านของเครื่องเข้าไม่ได้ รหัสของ e2e เข้าได้
      assert.equal((await login(url, MACHINE_ENV.ADMIN_PASSWORD)).status, 401)
      assert.equal((await login(url, "pw-for-e2e-test")).status, 200)
      // ช่องทางนำเข้าปิดอยู่ (IMPORT_TOKEN ของเครื่องไม่ถูกใช้): ไม่มีเส้นทางให้ ต่างจากเปิดอยู่ที่จะตอบ 401/อื่น
      const imported = await fetch(`${url}/api/import/novels/1/chapters/1`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${MACHINE_ENV.IMPORT_TOKEN}` },
        body: "{}",
      })
      assert.equal(imported.status, 404)
      assert.match(child.out(), /ช่องทางนำเข้า=ปิด/)
    })
  })

  test("ฉีด AI ปลอมที่ถือว่ามี key (ทั้งที่ ANTHROPIC_API_KEY ของระบบว่าง) — หลังบ้านเห็นว่าตั้ง key แล้ว คิวไม่ถูกหยุดเพราะไม่มี key", async () => {
    await using(spawnNode(["../e2e/server.ts"], e2eEnv({ E2E_ADMIN_PASSWORD: "pw-for-e2e-test" })), async (child, url) => {
      assert.match(child.out(), /Claude API key=ไม่มี/) // ค่าตั้งของระบบ: ไม่มี key
      const cookie = (await login(url, "pw-for-e2e-test")).headers.getSetCookie()[0].split(";")[0]
      const settings = (await (await fetch(`${url}/api/admin/settings`, { headers: { cookie } })).json()) as { apiKeySet: boolean; importTokenSet: boolean }
      assert.equal(settings.apiKeySet, true)
      assert.equal(settings.importTokenSet, false)
    })
  })

  test("ไม่ตั้ง E2E_ADMIN_PASSWORD → ใช้รหัสผ่านเริ่มต้น e2e-admin-password", async () => {
    await using(spawnNode(["../e2e/server.ts"], e2eEnv()), async (_child, url) => {
      assert.equal((await login(url, "e2e-admin-password")).status, 200)
      assert.equal((await login(url, "something-else")).status, 401)
    })
  })

  test("E2E_ADMIN_PASSWORD เป็นค่าว่าง (export ทิ้งไว้) → ใช้รหัสเริ่มต้นเหมือนไม่ตั้ง ไม่ใช่เปิดหลังบ้านไร้รหัส", async () => {
    await using(spawnNode(["../e2e/server.ts"], e2eEnv({ E2E_ADMIN_PASSWORD: "" })), async (_child, url) => {
      assert.equal((await login(url, "e2e-admin-password")).status, 200)
      assert.equal((await login(url, "something-else")).status, 401)
    })
  })

  test("SIGTERM → ปิดเรียบร้อย exit 0 และลบโฟลเดอร์ฐานข้อมูลชั่วคราวทิ้ง", { skip: WINDOWS && "Windows ไม่มีสัญญาณ POSIX จริง" }, async () => {
    const child = spawnNode(["../e2e/server.ts"], e2eEnv())
    try {
      await child.waitFor(LISTENING)
      const dbPath = child.out().match(/ฐานข้อมูล: (\S+koymukarnnovel\.db)/)?.[1]
      assert.ok(dbPath, child.out())
      const dir = dbPath.replace(/[\\/]data[\\/]koymukarnnovel\.db$/, "")
      assert.ok(fs.existsSync(dir), "โฟลเดอร์ชั่วคราวต้องมีอยู่ระหว่างทำงาน")
      child.kill("SIGTERM")
      assert.equal(await within(child.exited, 10_000, "ปิดระบบ"), 0, `${child.out()}\n${child.err()}`)
      assert.match(child.out(), /info: ปิดระบบเรียบร้อย/)
      assert.equal(fs.existsSync(dir), false, `โฟลเดอร์ชั่วคราว ${dir} ยังไม่ถูกลบ`)
    } finally {
      await stop(child)
    }
  })
})
