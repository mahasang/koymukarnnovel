/**
 * ตัวเรียก API ของเซิร์ฟเวอร์ตัวเดียวกัน (JSON เข้า/ออก) — ทุกเส้นทางของเซิร์ฟเวอร์ตอบ JSON เสมอ (ไม่เคยใช้ 204 หรือตอบว่าง)
 * ที่ล้มทุกรูปแบบกลายเป็น `ApiError` ตัวเดียว: หน้าเว็บมีทางจัดการทางเดียว (แสดง `message` ที่เป็นภาษาไทยอยู่แล้ว)
 */
import type { ChapterPageDto, NovelCardDto, NovelDetailDto, SiteDto } from "./types"

export class ApiError extends Error {
  /** สถานะ HTTP ที่เซิร์ฟเวอร์ตอบ; 0 = ไม่ได้คำตอบเลย (เครือข่ายล่ม) */
  readonly status: number
  /** รหัสข้อผิดพลาดของเซิร์ฟเวอร์ เช่น `not_found`, `invalid_field` */
  readonly code?: string
  /** เนื้อหาคำตอบที่แปลงจาก JSON แล้วทั้งก้อน (มีช่องเสริมของแต่ละข้อผิดพลาด เช่น `field`) — ไม่ใช่ JSON = undefined */
  readonly data?: unknown

  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.data = data
  }
}

export interface ApiInit {
  /** ไม่ระบุ = GET (หรือ POST เมื่อมี body) */
  method?: string
  /** ส่งเป็น JSON (`undefined` = ไม่มี body; `null`/`0`/`false`/`""` ส่งตามจริง) */
  body?: unknown
  signal?: AbortSignal
}

const NETWORK_ERROR = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"
const UNKNOWN_REPLY = "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่รู้จัก"

/**
 * เรียก `path` ของเว็บตัวเอง (ส่งคุกกี้หลังบ้านเฉพาะโดเมนเดียวกัน) คืนค่า JSON ที่ตอบ
 * - ไม่ใช่ 2xx → `ApiError(status, body.error)` พร้อม `code` และ `data`
 * - เครือข่ายล่ม (รวมขาดระหว่างอ่านคำตอบ) → `ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")`
 * - 2xx แต่ไม่ใช่ JSON (เช่น dev server ตอบหน้า HTML เพราะ proxy ไม่ทำงาน) → `ApiError` ไม่คืน undefined เงียบๆ
 * - ถูกยกเลิกด้วย `signal` → โยนเหตุผลการยกเลิกตัวเดิม (ไม่ใช่ `ApiError`) ให้ผู้เรียกแยกออกได้
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { signal } = init
  // body ที่เป็น undefined → JSON.stringify คืน undefined = ไม่มี body (ต่างจาก null/0/false/"" ที่ส่งตามจริง)
  const payload: string | undefined = JSON.stringify(init.body)
  let status: number
  let ok: boolean
  let text: string
  try {
    const response = await fetch(path, {
      method: init.method ?? (payload === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload,
      signal,
    })
    status = response.status
    ok = response.ok
    text = await response.text()
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError(0, NETWORK_ERROR, "network")
  }

  let parsed: { value: unknown } | null = null
  try {
    parsed = { value: JSON.parse(text) }
  } catch {
    // ไม่ใช่ JSON: จัดการด้านล่างตามว่าสำเร็จหรือไม่
  }
  const value = parsed?.value

  if (!ok) {
    const fields = (value ?? {}) as { error?: unknown; code?: unknown }
    const given = typeof fields.error === "string" && fields.error !== ""
    const message = given ? (fields.error as string) : `เซิร์ฟเวอร์ตอบผิดพลาด (${status})`
    // ไม่มีข้อความจากเซิร์ฟเวอร์เลย (เช่น หน้า 502 ของ proxy) → รหัสที่เว็บตั้งเองเพื่อให้แปลได้
    const code = typeof fields.code === "string" ? fields.code : given ? undefined : "http_error"
    throw new ApiError(status, message, code, value)
  }
  if (parsed === null) throw new ApiError(status, UNKNOWN_REPLY, "unknown_reply")
  return parsed.value as T
}

/** เส้นทางสาธารณะที่ผู้อ่านใช้ (ไม่ต้องล็อกอิน) — `signal` เป็นตัวเลือก ส่งต่อให้ `useFetch` ยกเลิกคำขอตอนเปลี่ยนหน้า */
export const publicApi = {
  site: (signal?: AbortSignal) => api<SiteDto>("/api/public/site", { signal }),
  novels: (signal?: AbortSignal) => api<NovelCardDto[]>("/api/public/novels", { signal }),
  novel: (id: number, signal?: AbortSignal) => api<NovelDetailDto>(`/api/public/novels/${id}`, { signal }),
  chapter: (id: number, number: number, signal?: AbortSignal) => api<ChapterPageDto>(`/api/public/novels/${id}/chapters/${number}`, { signal }),
}
