import path from "node:path"
import { fileURLToPath } from "node:url"

export interface Config {
  host: string
  port: number
  publicUrl: string | null
  trustProxy: number
  dbPath: string
  webDist: string
  adminPassword: string | null
  sessionSecret: string
  importToken: string | null
  anthropicApiKey: string | null
  translateModel: string
  recapModel: string
  isLoopbackHost: boolean
  hsts: boolean
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

// ไฟล์นี้อยู่ที่ server/src (tsx) หรือ server/dist (หลัง build) จึงอ้างอิงตำแหน่งได้เหมือนกันทั้งสองกรณี
const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(here, "..")
const REPO_DIR = path.resolve(here, "../..")

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const MIN_IMPORT_TOKEN = 24
const MIN_PASSWORD_WARN = 10

/** ค่าว่าง ("") นับเป็นไม่ตั้ง */
function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]
  return v === undefined || v === "" ? undefined : v
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number, max: number, hint: string): number {
  const raw = read(env, key)?.trim()
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw) || Number(raw) > max) throw new ConfigError(`${key} ต้องเป็น${hint} (ได้รับ "${raw}")`)
  return Number(raw)
}

export function loadConfig(env: NodeJS.ProcessEnv): { config: Config; warnings: string[] } {
  const warnings: string[] = []

  const host = read(env, "HOST")?.trim() ?? "127.0.0.1"
  const isLoopbackHost = LOOPBACK_HOSTS.has(host.replace(/^\[(.*)\]$/, "$1").toLowerCase())
  const port = readInt(env, "PORT", 8787, 65535, "จำนวนเต็ม 0–65535")
  const trustProxy = readInt(env, "TRUST_PROXY", 0, Number.MAX_SAFE_INTEGER, "จำนวนเต็มตั้งแต่ 0 (จำนวนชั้น proxy หน้าแอป)")

  let publicUrl: string | null = null
  let hsts = false
  const rawUrl = read(env, "PUBLIC_URL")?.trim()
  if (rawUrl) {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new ConfigError(`PUBLIC_URL ไม่ใช่ URL ที่ถูกต้อง (ได้รับ "${rawUrl}")`)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ConfigError(`PUBLIC_URL ต้องขึ้นต้นด้วย http:// หรือ https:// (ได้รับ "${rawUrl}")`)
    }
    publicUrl = rawUrl.replace(/\/+$/, "")
    hsts = url.protocol === "https:"
  }

  const dbPathEnv = read(env, "DB_PATH")?.trim()
  const adminPassword = read(env, "ADMIN_PASSWORD") ?? null
  if (!adminPassword && !isLoopbackHost) {
    throw new ConfigError(`HOST=${host} เปิดให้เครื่องอื่นเข้าถึงได้ จึงต้องตั้ง ADMIN_PASSWORD (ใน server/.env หรือตัวแปรสภาพแวดล้อม) ก่อนเริ่มระบบ`)
  }
  if (!adminPassword) {
    warnings.push("หลังบ้านเปิดโดยไม่ต้องล็อกอิน (ใช้ได้เฉพาะเครื่องนี้) — ตั้ง ADMIN_PASSWORD เพื่อบังคับล็อกอิน")
  } else if (adminPassword.length < MIN_PASSWORD_WARN) {
    warnings.push(`ADMIN_PASSWORD สั้นกว่า ${MIN_PASSWORD_WARN} ตัวอักษร ควรใช้รหัสที่ยาวกว่านี้`)
  }

  let importToken: string | null = null
  const rawToken = read(env, "IMPORT_TOKEN")
  if (rawToken !== undefined) {
    if (rawToken.length < MIN_IMPORT_TOKEN) {
      warnings.push(`IMPORT_TOKEN สั้นกว่า ${MIN_IMPORT_TOKEN} ตัวอักษร จึงปิดช่องทางนำเข้าไว้ — สร้างค่าใหม่ที่ยาวอย่างน้อย ${MIN_IMPORT_TOKEN} ตัว`)
    } else {
      importToken = rawToken
    }
  }

  const config: Config = {
    host,
    port,
    publicUrl,
    trustProxy,
    dbPath: dbPathEnv ? path.resolve(dbPathEnv) : path.join(SERVER_DIR, "data", "koymukarnnovel.db"),
    webDist: path.join(REPO_DIR, "web", "dist"),
    adminPassword,
    sessionSecret: read(env, "SESSION_SECRET") ?? "",
    importToken,
    anthropicApiKey: read(env, "ANTHROPIC_API_KEY") ?? null,
    translateModel: read(env, "TRANSLATE_MODEL")?.trim() ?? "claude-sonnet-5-5",
    recapModel: read(env, "RECAP_MODEL")?.trim() ?? "claude-haiku-4-5-20251001",
    isLoopbackHost,
    hsts,
  }
  return { config, warnings }
}
