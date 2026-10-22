import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import type { Ai } from "../../src/ai.js"
import { createApp } from "../../src/app.js"
import type { Config } from "../../src/config.js"
import { openDb, type Db } from "../../src/db.js"
import { migrate } from "../../src/migrate.js"
import { createQueue, type Queue } from "../../src/queue.js"
import { createSettings, type Settings } from "../../src/settings.js"
import { memoryLogger } from "../../src/util/log.js"
import { createViews } from "../../src/views.js"
import { createFakeAi, type FakeAi } from "./fake-ai.js"

/**
 * เปิดแอปจริงทั้งตัว (Express + DB ในหน่วยความจำ + AI ปลอม) บน 127.0.0.1 พอร์ตสุ่ม ให้เทสต์ HTTP ของทุกงานใช้ร่วมกัน
 * `Client` เป็นเบราว์เซอร์จำลอง: จำ cookie, ใส่ `Origin` = base และ JSON ให้ทุกคำขอที่แก้ข้อมูล (ผ่านด่านตรวจ CSRF เหมือนหน้าเว็บจริง)
 */

export const TEST_PASSWORD = "test-password-123"
export const TEST_IMPORT_TOKEN = "test-import-token-0123456789abcdef"

// โฟลเดอร์ที่ไม่มีอยู่จริง: เทสต์ที่ต้องการหน้าเว็บส่ง `webDist` ของตัวเองมา
const NO_WEB_DIST = path.join(os.tmpdir(), "koymukarnnovel-test-no-web-dist")

export interface ClientResponse {
  status: number
  headers: Headers
  /** เนื้อหาที่แปลงเป็น JSON ได้ ไม่งั้น undefined (any เพื่อให้เทสต์เขียน `r.json.items[0]` ได้ตรงๆ) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any
  text: string
}

export interface RequestExtras {
  /** หัวที่เพิ่ม/ทับค่าเริ่มต้นของ Client (เช่น `Origin` ปลอม, `X-Forwarded-For`) */
  headers?: Record<string, string>
}

export interface Client {
  get(path: string, extras?: RequestExtras): Promise<ClientResponse>
  post(path: string, body?: unknown, extras?: RequestExtras): Promise<ClientResponse>
  put(path: string, body?: unknown, extras?: RequestExtras): Promise<ClientResponse>
  patch(path: string, body?: unknown, extras?: RequestExtras): Promise<ClientResponse>
  delete(path: string, body?: unknown, extras?: RequestExtras): Promise<ClientResponse>
  /** ล็อกอินด้วยรหัสผ่านทดสอบ (หรือที่ระบุ) ต้องสำเร็จ 200 ไม่งั้นโยน error เพื่อไม่ให้เทสต์ถัดไปล้มแบบงงๆ */
  login(password?: string, extras?: RequestExtras): Promise<ClientResponse>
  /** ส่งตามที่ให้ทุกอย่าง (ไม่เติม Origin/Content-Type/body) แต่ยังแนบและเก็บ cookie ให้ */
  raw(path: string, init?: RequestInit): Promise<ClientResponse>
  /** cookie ที่จำไว้ตอนนี้ (ชื่อ → ค่า) */
  readonly cookies: ReadonlyMap<string, string>
}

export interface TestApp<A extends Ai = FakeAi> {
  base: string
  port: number
  db: Db
  settings: Settings
  ai: A
  queue: Queue
  config: Config
  /** บรรทัด log ของแอป (ขึ้นต้น `info: `/`warn: `/`error: `) */
  logs: string[]
  /** อาร์กิวเมนต์ของทุกครั้งที่มีการเรียก `queue.cancelIfCurrent` (ห่อคิวจริงไว้ จึงยกเลิกจริงด้วย) */
  cancelCalls: number[][]
  /** เบราว์เซอร์จำลองใหม่ (cookie jar ว่าง) ทุกครั้งที่เรียก */
  client(): Client
  close(): Promise<void>
}

export interface TestAppOptions<A extends Ai> {
  config?: Partial<Config>
  ai?: A
  now?: () => Date
  webDist?: string
  /** เทสต์ที่ตั้งใจให้เซิร์ฟเวอร์เจอข้อผิดพลาดภายใน (log ระดับ error) ใส่ true; ไม่งั้น `withTestApp` ถือว่ามี error ใน log = บั๊ก */
  expectErrorLogs?: boolean
}

function storeCookies(jar: Map<string, string>, setCookies: string[]): void {
  for (const line of setCookies) {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim())
    const eq = pair.indexOf("=")
    if (eq < 1) continue
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute))
    const expired = value === "" || (maxAge !== undefined && Number(maxAge.split("=")[1]) <= 0)
    if (expired) jar.delete(name)
    else jar.set(name, value)
  }
}

function createClient(base: string, password: string): Client {
  const jar = new Map<string, string>()

  async function send(path: string, init: RequestInit): Promise<ClientResponse> {
    const headers = new Headers(init.headers)
    if (jar.size > 0 && !headers.has("cookie")) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "))
    const res = await fetch(base + path, { ...init, headers, redirect: "manual" })
    storeCookies(jar, res.headers.getSetCookie())
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: res.status, headers: res.headers, json, text }
  }

  const write = (method: string) => (path: string, body?: unknown, extras: RequestExtras = {}) =>
    send(path, {
      method,
      headers: { Origin: base, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extras.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const client: Client = {
    get: (path, extras = {}) => send(path, { method: "GET", headers: extras.headers }),
    post: write("POST"),
    put: write("PUT"),
    patch: write("PATCH"),
    delete: write("DELETE"),
    async login(pass = password, extras) {
      const res = await client.post("/api/admin/login", { password: pass }, extras)
      if (res.status !== 200) throw new Error(`login ล้มเหลว: ${res.status} ${res.text}`)
      return res
    },
    raw: (path, init = {}) => send(path, init),
    cookies: jar,
  }
  return client
}

export async function startTestApp<A extends Ai = FakeAi>(o: TestAppOptions<A> = {}): Promise<TestApp<A>> {
  const config: Config = {
    host: "127.0.0.1",
    port: 0,
    publicUrl: null,
    trustProxy: 0,
    dbPath: ":memory:",
    webDist: o.webDist ?? NO_WEB_DIST,
    adminPassword: TEST_PASSWORD,
    sessionSecret: "",
    importToken: TEST_IMPORT_TOKEN,
    anthropicApiKey: null,
    translateModel: "claude-sonnet-5-5",
    recapModel: "claude-haiku-4-5-20251001",
    isLoopbackHost: true,
    hsts: false,
    ...o.config,
  }
  const db = openDb(":memory:")
  migrate(db)
  const settings = createSettings(db, config)
  const ai = (o.ai ?? createFakeAi()) as A
  const now = o.now ?? (() => new Date())
  const { logger, lines } = memoryLogger()

  const realQueue = createQueue({ db, settings, ai, now, log: logger })
  const cancelCalls: number[][] = []
  const queue: Queue = {
    ...realQueue,
    cancelIfCurrent(ids) {
      cancelCalls.push([...ids])
      return realQueue.cancelIfCurrent(ids)
    },
  }
  const views = createViews({ db, now, log: logger })

  const app = createApp({ config, db, settings, ai, queue, views, now, log: logger })
  const server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`

  let closed = false
  return {
    base,
    port,
    db,
    settings,
    ai,
    queue,
    config,
    logs: lines,
    cancelCalls,
    client: () => createClient(base, config.adminPassword ?? TEST_PASSWORD),
    async close() {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await queue.stop()
      db.close()
    },
  }
}

/**
 * เปิดแอป รัน `fn` แล้วปิดเสมอ (แม้ `fn` ล้ม) · ถ้า `fn` ผ่านแต่ log ของแอปมีบรรทัด `error:` ถือว่าเทสต์ล้ม
 * (ดักบั๊กที่คำตอบถูกแต่เบื้องหลังมี exception เช่น ลืม return หลังตอบไปแล้ว) เว้นแต่ตั้ง `expectErrorLogs`
 */
export async function withTestApp<T, A extends Ai = FakeAi>(o: TestAppOptions<A>, fn: (app: TestApp<A>) => Promise<T>): Promise<T> {
  const app = await startTestApp(o)
  try {
    const result = await fn(app)
    const errors = app.logs.filter((line) => line.startsWith("error:"))
    if (!o.expectErrorLogs && errors.length > 0) throw new Error(`log ของแอปมี error ระหว่างเทสต์:\n${errors.join("\n")}`)
    return result
  } finally {
    await app.close()
  }
}
