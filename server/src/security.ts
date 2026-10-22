import net from "node:net"
import type { Request, RequestHandler } from "express"
import type { Logger } from "./util/log.js"

/** ตรงกับ Global Constraints ของแผน — สคริปต์ห้าม inline; `unsafe-inline` เฉพาะสไตล์เพราะ React ใส่ style attribute */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

// ───────────────────────── ตัวจำกัด ─────────────────────────

const SWEEP_INTERVAL_MS = 60_000
const DEFAULT_MAX_KEYS = 10_000

export interface LimiterOptions {
  /** ความยาวหน้าต่าง (ms) นับจากครั้งแรกของแต่ละคีย์ */
  windowMs: number
  /** จำนวนครั้งสูงสุดต่อหน้าต่าง */
  max: number
  now?: () => number
  /** จำนวนคีย์สูงสุดที่จำไว้พร้อมกัน (กันตารางโตไม่จำกัดเมื่อมีคีย์แปลกหน้าไหลเข้ามา) */
  maxKeys?: number
}

export interface RateLimiter {
  hit(key: string): { allowed: boolean; retryAfterSec: number }
  sweep(): void
  size(): number
}

export interface FailureLimiter {
  check(key: string): { blocked: boolean; retryAfterSec: number }
  recordFailure(key: string): void
  reset(key: string): void
  sweep(): void
  size(): number
}

interface Entry {
  count: number
  resetAt: number
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} ต้องเป็นจำนวนเต็มบวก (ได้ ${String(value)})`)
}

const secondsLeft = (entry: Entry, nowMs: number): number => Math.ceil((entry.resetAt - nowMs) / 1000)

/** ตารางนับแบบหน้าต่างคงที่ที่ตัวจำกัดสองแบบใช้ร่วมกัน (หน้าต่างของคีย์เริ่มที่ครั้งแรกของคีย์ และหมดอายุเมื่อถึง resetAt พอดี) */
function createStore(o: LimiterOptions) {
  requirePositiveInteger("windowMs", o.windowMs)
  requirePositiveInteger("max", o.max)
  const maxKeys = o.maxKeys ?? DEFAULT_MAX_KEYS
  requirePositiveInteger("maxKeys", maxKeys)
  const now = o.now ?? Date.now
  const entries = new Map<string, Entry>()

  const sweep = (): void => {
    const t = now()
    for (const [key, entry] of entries) if (t >= entry.resetAt) entries.delete(key)
  }
  // สร้างที่นี่ (ไม่ใช่ module scope) และ unref เพื่อไม่ให้ค้างโปรเซสไว้
  setInterval(sweep, SWEEP_INTERVAL_MS).unref()

  return {
    now,
    sweep,
    size: (): number => entries.size,
    /** รายการของคีย์ที่ยังไม่หมดอายุ ณ เวลา `t` */
    live(key: string, t: number): Entry | undefined {
      const entry = entries.get(key)
      return entry !== undefined && t < entry.resetAt ? entry : undefined
    },
    /** นับเพิ่มหนึ่งครั้ง ถ้าไม่มีหรือหมดอายุแล้วเปิดหน้าต่างใหม่ (ไม่ต่ออายุหน้าต่างที่ยังอยู่) */
    bump(key: string, t: number): void {
      const entry = entries.get(key)
      if (entry !== undefined && t < entry.resetAt) {
        entry.count++
        return
      }
      if (entry === undefined && entries.size >= maxKeys) {
        sweep()
        // ยังเต็มอยู่ → ไล่คีย์ที่เข้ามาก่อนสุด ซึ่งคือคีย์ที่จะหมดอายุเร็วที่สุด (Map เรียงตามลำดับที่ใส่)
        if (entries.size >= maxKeys) entries.delete(entries.keys().next().value as string)
      }
      entries.delete(key) // ใส่ใหม่ท้ายสุด เพื่อให้ลำดับในตารางตรงกับลำดับหมดอายุ
      entries.set(key, { count: 1, resetAt: t + o.windowMs })
    },
    remove(key: string): void {
      entries.delete(key)
    },
  }
}

/** ตัวจำกัดอัตรา: ครั้งที่ `max + 1` ในหน้าต่างเดียวกันถูกปฏิเสธ (ครั้งที่ถูกปฏิเสธไม่ต่ออายุหน้าต่าง) */
export function createRateLimiter(o: LimiterOptions): RateLimiter {
  const store = createStore(o)
  return {
    hit(key) {
      const t = store.now()
      const entry = store.live(key, t)
      if (entry !== undefined && entry.count >= o.max) return { allowed: false, retryAfterSec: secondsLeft(entry, t) }
      store.bump(key, t)
      return { allowed: true, retryAfterSec: 0 }
    },
    sweep: store.sweep,
    size: store.size,
  }
}

/** ตัวจำกัดความผิดพลาด (เช่น ล็อกอินผิด): ผิดครบ `max` ครั้งในหน้าต่างที่เริ่มจากความผิดครั้งแรก → ถูกบล็อกจนหมดหน้าต่าง */
export function createFailureLimiter(o: LimiterOptions): FailureLimiter {
  const store = createStore(o)
  return {
    check(key) {
      const t = store.now()
      const entry = store.live(key, t)
      if (entry !== undefined && entry.count >= o.max) return { blocked: true, retryAfterSec: secondsLeft(entry, t) }
      return { blocked: false, retryAfterSec: 0 }
    },
    recordFailure(key) {
      store.bump(key, store.now())
    },
    reset(key) {
      store.remove(key)
    },
    sweep: store.sweep,
    size: store.size,
  }
}

// ───────────────────────── หัวความปลอดภัย ─────────────────────────

/** `/api` และ `/admin` ตามขอบเขตของ segment (ไม่รวม `/apiary` หรือ `/administrator`) ไม่สนตัวพิมพ์ — Express จับเส้นทางแบบไม่สนตัวพิมพ์เหมือนกัน */
const NOINDEX_PATH = /^\/(api|admin)(\/|$)/i
const HSTS_VALUE = "max-age=15552000" // 180 วัน ไม่รวมซับโดเมน (ไม่รู้ว่าโดเมนอื่นของเจ้าของพร้อม https ทั้งหมดหรือยัง)

export function securityHeaders(o: { hsts: boolean }): RequestHandler {
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP)
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if (o.hsts) res.setHeader("Strict-Transport-Security", HSTS_VALUE)
    if (NOINDEX_PATH.test(req.originalUrl.split("?", 1)[0] as string)) res.setHeader("X-Robots-Tag", "noindex")
    next()
  }
}

// ───────────────────────── ด่านตรวจคำขอ ─────────────────────────

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function originAllowed(origin: string, host: string | undefined, allowedHosts: Set<string>): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false // "null", ค่าว่าง หรือรูปแบบเพี้ยน
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  return url.host === host?.toLowerCase() || allowedHosts.has(url.host)
}

function hasBody(req: Request): boolean {
  const length = req.headers["content-length"]
  if (length !== undefined) return Number(length) > 0
  return req.headers["transfer-encoding"] !== undefined
}

const isJsonContentType = (contentType: string | undefined): boolean =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"

/**
 * กัน CSRF: POST/PUT/PATCH/DELETE ที่มีหัว Origin ต้องเป็นโฮสต์เดียวกับหัว Host (หรืออยู่ใน `allowedHosts` เช่น โดเมนสาธารณะเมื่อ proxy เขียน Host ใหม่)
 * ไม่มี Origin = ไม่ใช่เบราว์เซอร์ (curl / สคริปต์) ผ่านได้; และถ้ามี body ต้องเป็น application/json (ฟอร์มข้ามเว็บส่ง JSON ไม่ได้)
 */
export function originGuard(o: { allowedHosts?: string[] }): RequestHandler {
  const allowedHosts = new Set((o.allowedHosts ?? []).map((host) => host.toLowerCase()))
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next()
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined && !originAllowed(origin, req.headers.host, allowedHosts)) {
      res.status(403).json({
        error: "คำขอถูกปฏิเสธเพราะมาจากเว็บไซต์อื่น (Origin ไม่ตรงกับโฮสต์ของเว็บนี้) — ถ้าเปิดหลังบ้านผ่านโดเมนของคุณเองแล้วเจอข้อความนี้ ให้ตั้ง PUBLIC_URL ให้ตรงกับโดเมนนั้น",
        code: "forbidden_origin",
      })
      return
    }
    if (hasBody(req) && !isJsonContentType(req.headers["content-type"])) {
      res.status(415).json({ error: "ต้องส่งข้อมูลเป็น JSON (Content-Type: application/json) เท่านั้น", code: "unsupported_media_type" })
      return
    }
    next()
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i

/** โหมดไม่มีรหัสผ่าน: หัว Host ต้องเป็น localhost / 127.0.0.1 / [::1] เท่านั้น (กัน DNS rebinding ที่ทำให้เว็บอื่นยิงเข้าเครื่องเรา) */
export function loopbackHostOnly(): RequestHandler {
  return (req, res, next) => {
    if (LOOPBACK_HOST.test(req.headers.host ?? "")) {
      next()
      return
    }
    res.status(403).json({
      error: "โหมดไม่มีรหัสผ่านใช้ได้เฉพาะเมื่อเปิดผ่าน localhost, 127.0.0.1 หรือ [::1] — ตั้ง ADMIN_PASSWORD ถ้าจะเปิดจากที่อื่น",
      code: "forbidden_host",
    })
  }
}

// ───────────────────────── ที่อยู่ผู้เรียก ─────────────────────────

/** กระจาย IPv6 เป็น 8 กลุ่ม (รองรับ `::`, IPv4 ต่อท้าย และ zone id) — เรียกเมื่อ `net.isIP` ยืนยันแล้วว่าเป็น IPv6 */
function ipv6Groups(address: string): number[] {
  let text = address.split("%", 1)[0] as string
  const embedded = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (embedded) {
    const [, head, a, b, c, d] = embedded.map(String) as [string, string, string, string, string, string]
    text = `${head}${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`
  }
  const toGroups = (part: string): string[] => (part === "" ? [] : part.split(":"))
  const halves = text.split("::")
  const before = toGroups(halves[0] as string)
  const after = halves[1] // undefined เมื่อไม่มี "::" (เขียนครบ 8 กลุ่ม)
  const groups =
    after === undefined ? before : [...before, ...Array<string>(8 - before.length - toGroups(after).length).fill("0"), ...toGroups(after)]
  return groups.map((group) => parseInt(group, 16))
}

/** IPv4-mapped → IPv4 ธรรมดา; IPv6 อื่น → คำนำหน้า /64 (ผู้ใช้หนึ่งคนหมุนที่อยู่ภายใน /64 ได้เป็นล้านล้านล้านค่า); อย่างอื่นคงเดิม */
function normalizeAddress(address: string): string {
  if (net.isIP(address) !== 6) return address
  const groups = ipv6Groups(address)
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const high = groups[6] as number
    const low = groups[7] as number
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`
}

/** คีย์ของผู้เรียกสำหรับตัวจำกัด: `req.ip` (ตาม `trust proxy`) → ที่อยู่ซ็อกเก็ต → "unknown" แล้วปรับรูปให้ที่อยู่เดียวกันได้คีย์เดียว */
export function clientIp(req: Request): string {
  return normalizeAddress(req.ip ?? req.socket.remoteAddress ?? "unknown")
}

const PROXY_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip"] as const

/**
 * `TRUST_PROXY=0` แต่คำขอมีหัวของ reverse proxy → เว็บน่าจะอยู่หลัง proxy จริง ซึ่งทุกคนจะถูกนับเป็นที่อยู่ของ proxy ตัวเดียว
 * (ตัวจำกัดล็อกอินล็อกทุกคนพร้อมกัน) เตือนครั้งเดียวต่อ middleware; `TRUST_PROXY ≥ 1` ไม่เตือน
 */
export function warnForwardedOnce(o: { trustProxy: number; log: Logger }): RequestHandler {
  if (o.trustProxy > 0) return (_req, _res, next) => next()
  let warned = false
  return (req, _res, next) => {
    if (!warned && PROXY_HEADERS.some((name) => req.headers[name])) {
      warned = true
      o.log.warn(
        "คำขอมีหัว X-Forwarded-For/Forwarded/X-Real-IP แต่ TRUST_PROXY=0 — ระบบจึงนับทุกคนเป็นที่อยู่ของ proxy ตัวเดียว (ตัวจำกัดล็อกอินและอัตราคำขอจะรวมทุกคนเป็นคนเดียว) ถ้าเว็บอยู่หลัง reverse proxy ให้ตั้ง TRUST_PROXY เป็นจำนวนชั้น proxy (เช่น 1)",
      )
    }
    next()
  }
}
