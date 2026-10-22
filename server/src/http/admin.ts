import express, { Router, type RequestHandler } from "express"
import type { AppDeps } from "../app.js"
import type { Config } from "../config.js"
import { originGuard } from "../security.js"
import { createAuthRoutes } from "./admin/auth.js"
import { createNovelsRouter } from "./admin/novels.js"

export { isAdminRequest } from "./admin/auth.js"

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store")
  next()
}

/** โดเมนสาธารณะ (จาก PUBLIC_URL) ที่ยอมรับเป็น Origin ได้แม้ reverse proxy เขียนหัว Host ใหม่ */
const publicHosts = (config: Config): string[] => (config.publicUrl === null ? [] : [new URL(config.publicUrl).host])

/**
 * `/api/admin`: no-store → ด่าน CSRF → ล็อกอิน/ออก (body เล็ก ยังไม่ต้องล็อกอิน) → ด่านตรวจตัวตน → ตัวอ่าน JSON 8MB → `/me` → เส้นทางของงานถัดไป
 * ด่านตัวตนอยู่ก่อนตัวอ่าน body เสมอ คนแปลกหน้าจึงสั่งให้เซิร์ฟเวอร์อ่าน/แปลง body ใหญ่ไม่ได้
 */
export function createAdminRouter(deps: AppDeps): Router {
  const router = Router()
  const auth = createAuthRoutes(deps)

  router.use(noStore)
  router.use(originGuard({ allowedHosts: publicHosts(deps.config) }))
  router.post("/login", express.json({ limit: "1kb" }), auth.login)
  router.post("/logout", auth.logout)
  router.use(auth.gate)
  router.use(express.json({ limit: "8mb" }))
  router.get("/me", auth.me)
  router.use(createNovelsRouter(deps))
  // งาน 13–15 ต่อเส้นทางหลังบ้านของตัวเองตรงนี้ (ผ่านด่านล็อกอินและตัวอ่าน body แล้ว)

  return router
}
