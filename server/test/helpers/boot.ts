import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { openDb, type Db } from "../../src/db.js"
import { migrate } from "../../src/migrate.js"

/**
 * ตัวช่วยเทสต์การเริ่มระบบ (bootstrap.test.ts ในโปรเซสเดียว, bootstrap-process.test.ts แบบ child process)
 * หลักการ: ทุกเทสต์ใช้โฟลเดอร์ชั่วคราวของตัวเองและตั้ง `DB_PATH` เสมอ — ลืมตั้งเมื่อไรระบบจะไปเขียน `server/data` จริงของเครื่องนั้น
 */

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const WINDOWS = process.platform === "win32"

/**
 * ตัวแปรสภาพแวดล้อมทั้งหมดที่ `config.ts` อ่าน (มีเทสต์ตรวจว่าครบ) · เทสต์ตั้งทุกตัวเป็น "" ก่อนเสมอ
 * เพราะ `process.loadEnvFile` ไม่ทับตัวแปรที่มีอยู่แล้ว (แม้เป็นค่าว่าง) จึงกันไม่ให้ `server/.env` จริงของเครื่องที่รันเทสต์ไหลเข้ามา
 */
export const CONFIG_KEYS = [
  "HOST",
  "PORT",
  "TRUST_PROXY",
  "PUBLIC_URL",
  "DB_PATH",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "IMPORT_TOKEN",
  "ANTHROPIC_API_KEY",
  "TRANSLATE_MODEL",
  "RECAP_MODEL",
] as const

/** โฟลเดอร์ชั่วคราวที่ลบทิ้งเสมอ (แม้ `fn` ล้ม) */
export async function withDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-boot-"))
  try {
    return await fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** ที่ตั้งฐานข้อมูลของเทสต์ (อยู่ในโฟลเดอร์ย่อย `data` เพื่อให้ทดสอบการสร้างโฟลเดอร์แม่ด้วย) */
export const dbFileOf = (dir: string): string => path.join(dir, "data", "koymukarnnovel.db")

/** env ของเทสต์: ทุกตัวแปรของระบบว่างเปล่า ยกเว้น HOST/PORT/DB_PATH และที่ `extra` ระบุ */
export function envFor(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const blank: Record<string, string> = Object.fromEntries(CONFIG_KEYS.map((key) => [key, ""]))
  return { ...blank, HOST: "127.0.0.1", PORT: "0", DB_PATH: dbFileOf(dir), ...extra }
}

/** เปิดไฟล์ฐานข้อมูล (สร้าง/ย้ายโครงถ้ายังไม่มี) ให้ `fn` ใช้ แล้วปิดเสมอ — ใช้เตรียมข้อมูลก่อนเริ่มระบบและตรวจผลหลังปิดระบบ */
export function withDbFile<T>(file: string, fn: (db: Db) => T): T {
  const db = openDb(file)
  try {
    migrate(db)
    return fn(db)
  } finally {
    db.close()
  }
}

/** รอจน `check()` เป็นจริง (ตรวจทุก 10 ms) ไม่ทันก็โยน error */
export async function waitUntil(check: () => boolean, ms = 5000, what = "เงื่อนไข"): Promise<void> {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`รอ${what}ไม่ทันภายใน ${ms} ms`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** รอ `p` ไม่เกิน `ms` ไม่งั้นโยน error (กันเทสต์ค้างเมื่อโค้ดที่ทดสอบไม่ยอมจบ) */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} ไม่เสร็จภายใน ${ms} ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

export interface Child {
  proc: ChildProcess
  /** stdout / stderr ที่ได้รับจนถึงตอนนี้ */
  out(): string
  err(): string
  /** รหัสออก (null = ถูกฆ่าด้วยสัญญาณ) — resolve หลังอ่านท่อ stdout/stderr จนหมดแล้ว */
  exited: Promise<number | null>
  /** รอจน stdout มีข้อความตรง `re` ถ้าโปรเซสจบก่อนหรือไม่ทันเวลาก็โยน error พร้อมแนบ output ทั้งหมด */
  waitFor(re: RegExp, ms?: number): Promise<RegExpMatchArray>
  kill(signal?: NodeJS.Signals): void
}

/** รัน node + tsx ใน `server/` (ตัวเลือกเดียวกับที่ใช้รันเทสต์) แล้วอ่านผลทางท่อ */
export function spawnNode(args: string[], env: NodeJS.ProcessEnv): Child {
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", ...args], {
    cwd: SERVER_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let out = ""
  let err = ""
  proc.stdout.setEncoding("utf8")
  proc.stderr.setEncoding("utf8")
  proc.stdout.on("data", (chunk: string) => (out += chunk))
  proc.stderr.on("data", (chunk: string) => (err += chunk))
  const exited = new Promise<number | null>((resolve) => proc.once("close", (code) => resolve(code)))
  const dump = () => `\n--- stdout ---\n${out}\n--- stderr ---\n${err}`

  return {
    proc,
    out: () => out,
    err: () => err,
    exited,
    kill: (signal = "SIGKILL") => void proc.kill(signal),
    waitFor(re, ms = 20_000) {
      return new Promise((resolve, reject) => {
        const started = Date.now()
        const timer = setInterval(() => {
          const match = out.match(re)
          if (match) {
            clearInterval(timer)
            resolve(match)
          } else if (proc.exitCode !== null || proc.signalCode !== null) {
            clearInterval(timer)
            reject(new Error(`โปรเซสจบก่อนจะเห็น ${re}${dump()}`))
          } else if (Date.now() - started > ms) {
            clearInterval(timer)
            reject(new Error(`รอ ${re} ไม่ทันภายใน ${ms} ms${dump()}`))
          }
        }, 20)
      })
    },
  }
}
