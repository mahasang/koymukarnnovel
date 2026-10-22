// เซสชันหลังบ้านแบบไม่เก็บสถานะ: cookie = เวลาหมดอายุ + ลายเซ็น HMAC ไม่มีตารางเซสชันในฐานข้อมูล
// `crypto` นำเข้าแบบ default เพื่อให้เทสต์ดักดู `timingSafeEqual` ได้ (named import จะไม่ตามการแทนที่)
import crypto from "node:crypto"

export const COOKIE_NAME = "koymukarnnovel_admin"
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000

const sha256 = (data: string): Buffer => crypto.createHash("sha256").update(data).digest()
const sign = (key: Buffer, payload: string): string => crypto.createHmac("sha256", key).update(payload).digest("base64url")

/** กุญแจเซ็นเซสชัน ผูกกับทั้งรหัสผ่านและ SESSION_SECRET — เปลี่ยนค่าใดค่าหนึ่ง token เก่าทุกอันใช้ไม่ได้ทันที */
export function sessionKey(password: string, secret: string): Buffer {
  return sha256(`koymukarnnovel-session-v1\0${secret}\0${password}`)
}

/** token = base64url(เวลาหมดอายุเป็น ms) + "." + HMAC-SHA256 ของส่วนแรก */
export function signSession(key: Buffer, nowMs: number): string {
  const payload = Buffer.from(String(nowMs + SESSION_TTL_MS)).toString("base64url")
  return `${payload}.${sign(key, payload)}`
}

/** ตรวจลายเซ็นก่อน (เวลาคงที่) แล้วค่อยดูวันหมดอายุ — ใช้ได้จนถึงมิลลิวินาทีที่หมดอายุพอดี; ทุกกรณีผิดปกติคืน false ไม่ throw */
export function verifySession(key: Buffer, token: string | undefined, nowMs: number): boolean {
  if (typeof token !== "string") return false
  const parts = token.split(".")
  if (parts.length !== 2) return false
  const [payload, signature] = parts as [string, string]
  const given = Buffer.from(signature)
  const wanted = Buffer.from(sign(key, payload))
  // เทียบเป็นไบต์ของสตริงที่ส่งมา (รูปแบบ base64url มาตรฐานเท่านั้นถึงตรง) และต้องยาวเท่ากันก่อน ไม่งั้น timingSafeEqual จะ throw
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return false
  const text = Buffer.from(payload, "base64url").toString("utf8")
  if (!/^\d+$/.test(text)) return false
  const expiresAt = Number(text)
  return Number.isSafeInteger(expiresAt) && nowMs <= expiresAt
}

/** เทียบรหัสผ่านด้วยแฮชของทั้งสองฝั่ง (ความยาวต่างกันก็ไม่ throw และไม่รั่วความยาว); รหัสที่ตั้งไว้ว่างไม่มีวันตรง */
export function passwordMatches(input: string, expected: string): boolean {
  if (expected === "") return false
  return crypto.timingSafeEqual(sha256(input), sha256(expected))
}

const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax"

export function cookieHeader(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${SESSION_TTL_MS / 1000}; ${COOKIE_ATTRIBUTES}${secure ? "; Secure" : ""}`
}

/** ล้าง cookie: ต้องใช้ Path/แฟล็กชุดเดียวกับตอนตั้ง ไม่งั้นเบราว์เซอร์ไม่ลบ */
export function clearCookieHeader(secure: boolean): string {
  return `${COOKIE_NAME}=; Max-Age=0; ${COOKIE_ATTRIBUTES}${secure ? "; Secure" : ""}`
}

function decodeCookieValue(raw: string): string {
  const unquoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  try {
    return decodeURIComponent(unquoted)
  } catch {
    return unquoted
  }
}

/**
 * แยกหัว `Cookie` เป็นคู่ชื่อ-ค่า ชื่อซ้ำใช้ตัวแรก ชิ้นที่ไม่มี `=` หรือไม่มีชื่อถูกข้าม
 * (ชื่อ `__proto__` ที่ได้ค่าเป็นสตริงถูก JS เมินตอนกำหนดค่า จึงไม่เป็นช่องโหว่ prototype pollution)
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const piece of header.split(";")) {
    const eq = piece.indexOf("=")
    if (eq === -1) continue
    const name = piece.slice(0, eq).trim()
    if (name === "" || Object.hasOwn(out, name)) continue
    out[name] = decodeCookieValue(piece.slice(eq + 1).trim())
  }
  return out
}
