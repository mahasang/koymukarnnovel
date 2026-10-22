import compression from "compression"
import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler } from "express"
import type { Ai } from "./ai.js"
import type { Config } from "./config.js"
import { createCoversRouter } from "./covers.js"
import type { Db } from "./db.js"
import { createAdminRouter } from "./http/admin.js"
import { createPublicRouter } from "./http/public.js"
import type { Queue } from "./queue.js"
import { securityHeaders, warnForwardedOnce } from "./security.js"
import type { Settings } from "./settings.js"
import { HttpError, notFound } from "./util/errors.js"
import type { Logger } from "./util/log.js"
import type { Views } from "./views.js"

/** ทุกอย่างที่แอปต้องใช้ ส่งเข้ามาทางนี้ทางเดียว (เทสต์จึงใช้ DB ในหน่วยความจำ + AI ปลอมได้) */
export interface AppDeps {
  config: Config
  db: Db
  settings: Settings
  ai: Ai
  queue: Queue
  views: Views
  now: () => Date
  log: Logger
}

/** หน้าบ้านสาธารณะอ่านอย่างเดียว: เมธอดอื่นถูกตีกลับตั้งแต่ก่อนถึงตัวอ่านข้อมูล (และไม่รับ body เลย) */
const publicReadOnly: RequestHandler = (req, res, next) => {
  const readOnly = req.method === "GET" || req.method === "HEAD"
  if (!readOnly) res.setHeader("Allow", "GET, HEAD")
  next(readOnly ? undefined : new HttpError(405, "เส้นทางสาธารณะรับเฉพาะการอ่านข้อมูล (GET)", "method_not_allowed"))
}

export function createApp(deps: AppDeps): Express {
  const { config, log } = deps
  const app = express()
  app.disable("x-powered-by")
  app.set("trust proxy", config.trustProxy)

  app.use(securityHeaders({ hsts: config.hsts }))
  app.use(compression())
  app.use(warnForwardedOnce({ trustProxy: config.trustProxy, log }))

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok")
  })

  // งานถัดไปเพิ่มบรรทัด mount ของตัวเองในช่วงนี้ (ต้องอยู่ก่อน 404 ของ /api): งาน 17 /api/import (เมื่อมี importToken)
  app.use("/api/public", publicReadOnly)
  app.use("/api/public", createPublicRouter(deps))
  app.use("/api/admin", createAdminRouter(deps))
  app.use("/covers", createCoversRouter(deps))

  app.use("/api", (_req, _res, next) => next(notFound("ไม่พบเส้นทาง API นี้")))
  // งาน 18: หน้าเว็บ (shell) ต่อจากตรงนี้

  app.use(errorHandler(log))
  return app
}

const INTERNAL_ERROR = { error: "เกิดข้อผิดพลาดในระบบ ลองใหม่อีกครั้งภายหลัง", code: "internal_error" }
const BAD_REQUEST = { error: "คำขอไม่ถูกต้อง", code: "bad_request" }
const UNSUPPORTED_MEDIA = { error: "ไม่รองรับชนิดหรือการเข้ารหัสของข้อมูลที่ส่งมา", code: "unsupported_media_type" }

const pathOf = (req: Request): string => req.originalUrl.split("?", 1)[0] as string
const describe = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))

const isClientStatus = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 400 && (v as number) < 500

/** สถานะ 4xx ที่ไลบรารีแนบมากับ error (http-errors ใส่ทั้ง `status` และ `statusCode`) ไม่ใช่ 4xx จริง → undefined; `Object(err)` ทำให้ค่าที่ไม่ใช่ออบเจ็กต์อ่านได้ไม่พัง */
function clientStatus(err: unknown): number | undefined {
  const { status, statusCode } = Object(err) as { status?: unknown; statusCode?: unknown }
  return [status, statusCode].find(isClientStatus)
}

/**
 * ตัวจัดการ error ตัวเดียวของแอป (ต้องอยู่ท้ายสุด):
 * HttpError → ตอบตามที่โยน · ความผิดของ body จาก express.json → 413/400 ไทย · 4xx อื่นจากไลบรารี (ผู้ใช้ยกเลิกอัปโหลด, charset ไม่รองรับ) → สถานะเดิมกับข้อความไทยทั่วไป
 * อย่างอื่น = บั๊กของเรา → บันทึก error พร้อม stack แล้วตอบ 500 ข้อความทั่วไป (ไม่รั่วรายละเอียด) · ถ้าเริ่มส่งคำตอบไปแล้ว ตอบใหม่ไม่ได้ → บันทึกแล้วตัดการเชื่อมต่อ
 */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      log.error(`${req.method} ${pathOf(req)} ล้มเหลวหลังเริ่มส่งคำตอบแล้ว: ${describe(err)}`)
      req.socket.destroy()
      return
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ ...err.extra, error: err.message, code: err.code })
      return
    }
    const { type } = Object(err) as { type?: unknown }
    if (type === "entity.too.large") {
      res.status(413).json({ error: "ข้อมูลที่ส่งมาใหญ่เกินกำหนด", code: "too_large" })
      return
    }
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: "ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง", code: "bad_json" })
      return
    }
    const status = clientStatus(err)
    if (status !== undefined) {
      res.status(status).json(status === 415 ? UNSUPPORTED_MEDIA : BAD_REQUEST)
      return
    }
    log.error(`${req.method} ${pathOf(req)}: ${describe(err)}`)
    res.status(500).json(INTERNAL_ERROR)
  }
}
