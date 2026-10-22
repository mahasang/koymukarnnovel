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

/** ข้อความเดียวกันทั้งตอน Claude ล้มเพราะไม่มี key (`noKeyError` ใน ai.ts) และตอนที่หลังบ้านปฏิเสธล่วงหน้า */
export const NO_API_KEY_MESSAGE = "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY (ใส่ในไฟล์ .env ของเซิร์ฟเวอร์ แล้วเปิดแอปใหม่)"

/** งานที่ต้องเรียก Claude แต่ยังไม่มี key: ตอบก่อนเขียนอะไรลงฐานข้อมูล */
export const noApiKey = () => new HttpError(400, NO_API_KEY_MESSAGE, "no_api_key")
