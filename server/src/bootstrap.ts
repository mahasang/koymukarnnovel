import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { createAi, type Ai } from "./ai.js"
import { createApp } from "./app.js"
import { ConfigError, loadConfig, type Config } from "./config.js"
import { openDb, type Db } from "./db.js"
import { migrate, renameLegacyDb } from "./migrate.js"
import { createQueue, type Queue } from "./queue.js"
import { createSettings } from "./settings.js"
import type { Logger } from "./util/log.js"
import { createViews } from "./views.js"

/**
 * ตรรกะเริ่มระบบ/ปิดระบบทั้งหมดอยู่ที่นี่ ส่วน `index.ts` เป็นแค่ทางเข้า (เรียกใช้แล้วต่อสัญญาณเข้ากับโปรเซสจริง)
 * แยกกันเพื่อให้ทดสอบในโปรเซสเดียวได้ (พอร์ตสุ่ม ฐานข้อมูลชั่วคราว สัญญาณปลอม) โดยไม่ต้องสั่ง process.exit
 */

/** ข้อผิดพลาดตอนเริ่มระบบที่มีข้อความไทยพร้อมแสดงเจ้าของได้เลย (ไม่ต้องพิมพ์ stack) */
export class StartupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "StartupError"
  }
}

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return typeof code === "string" ? code : undefined
}

/** ข้อความที่ log ให้เจ้าของอ่านเมื่อเริ่มระบบไม่สำเร็จ (ConfigError/StartupError ไม่พิมพ์ stack; ข้อผิดพลาดที่ไม่คาดคิดพิมพ์ stack ไว้แจ้งบั๊ก) */
export function describeStartupFailure(e: unknown): string {
  if (e instanceof ConfigError) return `ตั้งค่าไม่ถูกต้อง: ${e.message}`
  if (e instanceof StartupError) return e.message
  return `เริ่มระบบไม่สำเร็จ: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`
}

// ───────────────────────── ฐานข้อมูล ─────────────────────────

// รหัสที่ Windows คืนเมื่อไฟล์ยังถูกโปรแกรมอื่นถือไว้ (ส่วนใหญ่คือโปรแกรมเวอร์ชันเก่าที่ยังเปิดอยู่)
const FILE_IN_USE = new Set(["EBUSY", "EPERM", "EACCES"])

function moveLegacyDb(dbPath: string, log: Logger): void {
  try {
    renameLegacyDb(dbPath, log)
  } catch (e) {
    const code = errorCode(e)
    const hint = code !== undefined && FILE_IN_USE.has(code) ? " — ปิดโปรแกรมเวอร์ชันเก่าที่ยังเปิดอยู่แล้วลองใหม่" : ""
    throw new StartupError(`ย้ายฐานข้อมูลเดิมเป็น ${path.basename(dbPath)} ไม่ได้${code ? ` (${code})` : ""}: ${describeError(e)}${hint}`, { cause: e })
  }
}

/**
 * ทำให้ฐานข้อมูลพร้อมใช้ (ระบบกับ `npm run seed:demo` ใช้ร่วมกัน): ย้ายไฟล์ชื่อเก่ามาเป็นชื่อปัจจุบัน → เปิด → ย้ายโครงเป็นเวอร์ชันล่าสุด
 * ล้มกลางทางแล้วปิดไฟล์คืนก่อนโยน `StartupError` (ไม่ทิ้งไฟล์ล็อกไว้ให้รอบถัดไปชน)
 */
export function prepareDb(dbPath: string, log: Logger): { db: Db; migratedPrototype: boolean } {
  moveLegacyDb(dbPath, log)
  let db: Db | undefined
  try {
    db = openDb(dbPath)
    const { migratedPrototype } = migrate(db)
    if (migratedPrototype) log.info("แปลงข้อมูลจากฐานข้อมูลรุ่นต้นแบบแล้ว — ทุกเรื่องถูกซ่อนไว้ (ยังไม่เผยแพร่) เข้าหลังบ้านแล้วกดเผยแพร่เรื่องที่ต้องการ")
    return { db, migratedPrototype }
  } catch (e) {
    try {
      db?.close()
    } catch {
      // ปิดไม่ได้ก็ไม่มีอะไรให้ทำต่อ ข้อผิดพลาดตัวจริงสำคัญกว่า
    }
    throw new StartupError(`เปิดฐานข้อมูล ${dbPath} ไม่ได้: ${describeError(e)}`, { cause: e })
  }
}

// ───────────────────────── พอร์ต ─────────────────────────

const bareHost = (host: string): string => host.replace(/^\[(.*)\]$/, "$1")

/** URL ของเซิร์ฟเวอร์ที่ฟังอยู่ที่ `host:port` (IPv6 ใส่วงเล็บ) */
export function listenUrl(host: string, port: number): string {
  const bare = bareHost(host)
  return `http://${bare.includes(":") ? `[${bare}]` : bare}:${port}`
}

/** แปลข้อผิดพลาดของ `listen` เป็นคำแนะนำภาษาไทยที่บอกว่าต้องแก้ค่าไหน */
export function explainListenError(e: unknown, o: { host: string; port: number }): StartupError {
  const code = errorCode(e)
  switch (code) {
    case "EADDRINUSE":
      return new StartupError(`พอร์ต ${o.port} ถูกใช้งานอยู่แล้ว (อาจเปิดโปรแกรมนี้ค้างไว้อีกหน้าต่าง หรือมีโปรแกรมอื่นใช้พอร์ตนี้) — ปิดตัวเก่า หรือเปลี่ยน PORT ใน server/.env`, { cause: e })
    case "EACCES":
      return new StartupError(`ไม่มีสิทธิ์เปิดพอร์ต ${o.port} (พอร์ตต่ำกว่า 1024 มักต้องใช้สิทธิ์ผู้ดูแล) — เปลี่ยน PORT ใน server/.env`, { cause: e })
    case "EADDRNOTAVAIL":
      return new StartupError(`HOST=${o.host} ไม่ใช่ที่อยู่ของเครื่องนี้ — ตรวจค่า HOST ใน server/.env`, { cause: e })
    default:
      return new StartupError(`เปิดพอร์ต ${o.port} ไม่สำเร็จ${code ? ` (${code})` : ""}: ${describeError(e)}`, { cause: e })
  }
}

function listen(server: http.Server, config: Pick<Config, "host" | "port">): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(explainListenError(e, config))
    server.once("error", onError)
    server.listen(config.port, bareHost(config.host), () => {
      server.off("error", onError)
      resolve()
    })
  })
}

// ───────────────────────── เริ่มระบบ ─────────────────────────

const DEFAULT_GRACE_MS = 3000

export interface StartOptions {
  log: Logger
  now?: () => Date
  /** เวลาผ่อนผันให้คำขอที่ค้างอยู่ตอนปิดระบบ ก่อนตัดการเชื่อมต่อ (ms) ค่าเริ่มต้น 3000 */
  graceMs?: number
  /** ใช้ AI ตัวอื่นแทนของจริง (เทสต์/e2e) */
  ai?: Ai
}

export interface RunningServer {
  url: string
  port: number
  config: Config
  db: Db
  ai: Ai
  queue: Queue
  /** หยุดรับคำขอ → รอคำขอที่ค้าง (ตัดทิ้งเมื่อพ้น `graceMs`) → หยุดคิว (คืนตอนที่กำลังแปลเข้าคิว) → ปิดฐานข้อมูล · เรียกซ้ำได้ */
  close(): Promise<void>
}

const summarize = (c: Config): string =>
  `ตั้งค่า: หลังบ้าน=${c.adminPassword ? "ต้องล็อกอิน" : "ไม่ต้องล็อกอิน"} · ช่องทางนำเข้า=${c.importToken ? "เปิด" : "ปิด"} · Claude API key=${c.anthropicApiKey ? "มี" : "ไม่มี"} · โมเดลแปล=${c.translateModel}`

/**
 * ลำดับ: config (ผิดก็หยุดก่อนแตะดิสก์) → ฐานข้อมูล → ต่อชิ้นส่วนเข้าด้วยกัน → เปิดพอร์ต → คืนตอนที่ค้าง `translating` เข้าคิว → เริ่มคิว
 * แตะข้อมูลของคิวหลังได้พอร์ตแล้วเท่านั้น: ถ้าพอร์ตชน แปลว่าอาจมีอีกโปรเซสกำลังแปลตอนนั้นอยู่จริง การคืนเข้าคิวจะทำให้งานของมันถูกทิ้ง
 * (ไม่มีคำขอใดแทรกระหว่างพอร์ตเปิดกับ `recoverOnStart` เพราะทั้งสองอยู่ในจังหวะเดียวกันของ event loop)
 */
export async function startServer(env: NodeJS.ProcessEnv, o: StartOptions): Promise<RunningServer> {
  const { log } = o
  const now = o.now ?? (() => new Date())
  const graceMs = o.graceMs ?? DEFAULT_GRACE_MS

  const { config, warnings } = loadConfig(env)
  for (const warning of warnings) log.warn(warning)

  const { db } = prepareDb(config.dbPath, log)
  let server: http.Server | undefined
  try {
    log.info(`ฐานข้อมูล: ${config.dbPath}`)
    log.info(summarize(config))
    const settings = createSettings(db, config)
    const ai = o.ai ?? createAi(config.anthropicApiKey)
    const queue = createQueue({ db, settings, ai, now, log })
    const views = createViews({ db, now, log })
    const app = createApp({ config, db, settings, ai, queue, views, now, log })

    const httpServer = http.createServer(app)
    server = httpServer
    await listen(httpServer, config)
    queue.recoverOnStart()
    queue.start()

    const port = (httpServer.address() as AddressInfo).port
    const url = listenUrl(config.host, port)
    log.info(`listening on ${url}`)

    let closing: Promise<void> | undefined
    const close = (): Promise<void> => {
      closing ??= (async () => {
        // close() หยุดรับการเชื่อมต่อใหม่และตัดการเชื่อมต่อที่ว่างอยู่ทันที ส่วนคำขอที่ยังทำอยู่ได้เวลาผ่อนผันก่อนถูกตัด
        const stopped = new Promise<void>((resolve) => httpServer.close(() => resolve()))
        const force = setTimeout(() => httpServer.closeAllConnections(), graceMs)
        try {
          await stopped
        } finally {
          clearTimeout(force)
        }
        // หยุดคิวก่อนปิดฐานข้อมูล: การยกเลิกสตรีมต้องเขียนสถานะ queued คืนลง DB
        try {
          await queue.stop()
        } finally {
          try {
            db.close()
          } catch (e) {
            log.warn(`ปิดฐานข้อมูลไม่สำเร็จ: ${describeError(e)}`)
          }
        }
      })()
      return closing
    }
    return { url, port, config, db, ai, queue, close }
  } catch (e) {
    server?.close()
    try {
      db.close()
    } catch {
      // ข้อผิดพลาดตัวจริงสำคัญกว่า
    }
    throw e
  }
}

// ───────────────────────── ปิดระบบ ─────────────────────────

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8000 // Docker รอ 10 วินาทีหลัง SIGTERM ก่อนฆ่า
const FORCE_EXIT_AFTER_MS = 2000
const SIGNALS = ["SIGTERM", "SIGINT"] as const

/**
 * ออกจากโปรเซสด้วย `code`: ตั้ง exitCode แล้วปล่อยให้โปรเซสจบเองเมื่อไม่มีอะไรค้าง (log ที่เพิ่งเขียนไม่ถูกตัดกลางคันเหมือน process.exit ทันที
 * ซึ่งบน Windows อาจตัดข้อความ) และมีตัวจับเวลา unref คอยบังคับออกถ้ามีอะไรค้างอยู่จนไม่ยอมจบ
 */
export function exitProcess(code: number): void {
  process.exitCode = code
  setTimeout(() => process.exit(code), FORCE_EXIT_AFTER_MS).unref()
}

export interface SignalSource {
  on(signal: (typeof SIGNALS)[number], listener: () => void): unknown
  off(signal: (typeof SIGNALS)[number], listener: () => void): unknown
}

export interface ShutdownOptions {
  log: Logger
  /** แหล่งสัญญาณ (ค่าเริ่มต้น process) */
  signals?: SignalSource
  /** ออกจากโปรเซส (ค่าเริ่มต้น `exitProcess`) */
  exit?: (code: number) => void
  /** ปิดไม่เสร็จภายในเวลานี้ให้บังคับออกด้วยรหัส 1 (ms) */
  timeoutMs?: number
}

/**
 * SIGTERM/SIGINT → `running.close()` แล้วออกด้วยรหัส 0 · ปิดไม่สำเร็จหรือไม่ทันกำหนดออกด้วยรหัส 1
 * สัญญาณที่มาซ้ำระหว่างกำลังปิดถูกข้าม (ไม่ปิดซ้ำ ไม่ออกซ้ำ) คืนฟังก์ชันถอดตัวดักสัญญาณออก
 */
export function installShutdown(running: Pick<RunningServer, "close">, o: ShutdownOptions): () => void {
  const { log } = o
  const signals = o.signals ?? process
  const exit = o.exit ?? exitProcess
  const timeoutMs = o.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  let shuttingDown = false

  const installed = SIGNALS.map((signal) => {
    const onSignal = (): void => {
      if (shuttingDown) {
        log.info(`ได้รับ ${signal} อีกครั้ง แต่กำลังปิดอยู่แล้ว รอสักครู่`)
        return
      }
      shuttingDown = true
      log.info(`ได้รับ ${signal} กำลังปิดระบบ…`)

      // `finished` กันผลที่มาทีหลัง (close() เสร็จหลังบังคับออกไปแล้ว) ไม่ให้ log ซ้ำหรือออกซ้ำ · finish เรียกครั้งเดียวเสมอ
      // เพราะตัวจับเวลาเลิกตอน finish และทั้งสองทาง callback เช็ก `finished` ก่อน
      let finished = false
      const finish = (code: number): void => {
        finished = true
        clearTimeout(timer)
        exit(code)
      }
      // ไม่ unref: นี่คือตัวกันเหนียว ถ้า close() ค้างตลอดไปจนไม่มีอะไรค้างในโปรเซสเหลือ ตัวจับเวลาต้องยังเดินอยู่
      // เพื่อ log แล้วออกด้วยรหัส 1 (ถ้า unref โปรเซสจะจบเงียบๆ ด้วยรหัส 0) · ไม่ทำให้ค้างเพราะเลิกตัวจับเวลาทุกทางออก
      const timer = setTimeout(() => {
        log.error(`ปิดระบบไม่เสร็จภายใน ${timeoutMs} มิลลิวินาที จึงบังคับออก`)
        finish(1)
      }, timeoutMs)

      running.close().then(
        () => {
          if (finished) return
          log.info("ปิดระบบเรียบร้อย")
          finish(0)
        },
        (e: unknown) => {
          if (finished) return
          log.error(`ปิดระบบไม่สำเร็จ: ${describeError(e)}`)
          finish(1)
        },
      )
    }
    signals.on(signal, onSignal)
    return { signal, onSignal }
  })

  return () => {
    for (const { signal, onSignal } of installed) signals.off(signal, onSignal)
  }
}
