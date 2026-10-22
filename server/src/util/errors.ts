/** ข้อผิดพลาดที่ตอบกลับผู้เรียกได้ตรงๆ — ข้อความต้องเป็นภาษาไทย */
export class HttpError extends Error {
  status: number
  code?: string
  extra?: Record<string, unknown>

  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (msg: string, code?: string) => new HttpError(400, msg, code)
export const notFound = (msg = "ไม่พบข้อมูลที่ต้องการ") => new HttpError(404, msg, "not_found")
export const conflict = (msg: string, code: string, extra?: Record<string, unknown>) => new HttpError(409, msg, code, extra)
