import type { Request, RequestHandler } from "express"
import type { AppDeps } from "../../app.js"
import { COOKIE_NAME, clearCookieHeader, cookieHeader, parseCookies, passwordMatches, sessionKey, signSession, verifySession } from "../../auth.js"
import type { Config } from "../../config.js"
import { clientIp, createFailureLimiter, isLoopbackHostHeader, loopbackHostOnly } from "../../security.js"
import { HttpError } from "../../util/errors.js"

const LOGIN_WINDOW_MS = 15 * 60_000
const LOGIN_MAX_FAILURES = 10

/** รหัสผ่านผู้ดูแลที่ใช้จริง; ไม่ตั้ง (null) หรือเป็นสตริงว่างคือโหมดไม่มีรหัสผ่าน — ห้ามมี session ที่เซ็นด้วยกุญแจจากรหัสว่าง */
const adminPassword = (config: Config): string | null => config.adminPassword || null

/**
 * คำขอนี้มาจากผู้ดูแลหรือไม่ (ใช้ทั้งด่านหลังบ้านและหน้าบ้านที่ต้องรู้ว่าจะโชว์ร่างไหม)
 * มีรหัสผ่าน: ต้องมี cookie ที่ลงนามถูกและยังไม่หมดอายุ · ไม่มีรหัสผ่าน: ทุกคำขอจากเครื่องนี้เอง (Host เป็น loopback) —
 * เว็บอื่นที่ชี้ DNS มาที่ 127.0.0.1 จะส่ง Host ของตัวเอง จึงไม่ได้สิทธิ์ผู้ดูแล
 */
export function isAdminRequest(deps: AppDeps, req: Request): boolean {
  const password = adminPassword(deps.config)
  if (password === null) return isLoopbackHostHeader(req.headers.host)
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  return verifySession(sessionKey(password, deps.config.sessionSecret), token, deps.now().getTime())
}

export interface AuthRoutes {
  /** `POST /login` (ผู้เรียกต้องใส่ตัวอ่าน JSON ขนาดเล็กไว้ข้างหน้า) */
  login: RequestHandler
  logout: RequestHandler
  /** ด่านตรวจตัวตน: ผ่านเมื่อเป็นผู้ดูแล ไม่งั้น 401 (โหมดไม่มีรหัสผ่านต้องผ่านการตรวจ Host ก่อน) */
  gate: RequestHandler
  me: RequestHandler
}

export function createAuthRoutes(deps: AppDeps): AuthRoutes {
  const { config } = deps
  const password = adminPassword(config)
  // นาฬิกาเดียวกับของแอป (เทสต์เลื่อนเวลาได้); ตัวจำกัดนับต่อ IP ที่ผ่าน `trust proxy` แล้ว
  const failures = createFailureLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_FAILURES, now: () => deps.now().getTime() })

  const login: RequestHandler = (req, res) => {
    if (password === null) {
      throw new HttpError(400, "ยังไม่ได้ตั้ง ADMIN_PASSWORD จึงไม่ต้องล็อกอิน — หลังบ้านเปิดใช้ได้เลยบนเครื่องนี้", "passwordless")
    }
    const ip = clientIp(req)
    const state = failures.check(ip)
    if (state.blocked) {
      res.setHeader("Retry-After", String(state.retryAfterSec))
      throw new HttpError(429, `ใส่รหัสผ่านผิดหลายครั้งเกินไป ลองใหม่ได้ในอีก ${Math.ceil(state.retryAfterSec / 60)} นาที`, "too_many_attempts", {
        retryAfterSec: state.retryAfterSec,
      })
    }
    const given = (req.body as { password?: unknown } | undefined)?.password
    if (typeof given !== "string") throw new HttpError(400, "กรุณากรอกรหัสผ่าน", "bad_request")
    if (!passwordMatches(given, password)) {
      failures.recordFailure(ip)
      throw new HttpError(401, "รหัสผ่านไม่ถูกต้อง", "bad_password")
    }
    failures.reset(ip)
    const token = signSession(sessionKey(password, config.sessionSecret), deps.now().getTime())
    res.setHeader("Set-Cookie", cookieHeader(token, req.secure))
    res.json({ admin: true, passwordless: false })
  }

  const logout: RequestHandler = (req, res) => {
    res.setHeader("Set-Cookie", clearCookieHeader(req.secure))
    res.json({ ok: true })
  }

  const gate: RequestHandler =
    password === null
      ? loopbackHostOnly()
      : (req, _res, next) => {
          next(isAdminRequest(deps, req) ? undefined : new HttpError(401, "กรุณาเข้าสู่ระบบก่อน", "unauthorized"))
        }

  const me: RequestHandler = (_req, res) => {
    res.json({ admin: true, passwordless: password === null })
  }

  return { login, logout, gate, me }
}
