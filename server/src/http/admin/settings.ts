import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Router, type Request } from "express"
import { AiError } from "../../ai.js"
import type { AppDeps } from "../../app.js"
import { writeApiCheck } from "../../api-check.js"
import { createBackupFile } from "../../backup.js"
import type { SiteSettings } from "../../settings.js"
import { recordUsage } from "../../usage.js"
import { dayKey } from "../../util/time.js"
import { obj } from "../validate.js"

/** คำตอบของ test-api เมื่อเกิดข้อผิดพลาดที่ไม่ใช่ความผิดพลาดจาก Claude (ไม่บอกรายละเอียดภายใน — ดูใน log ของเซิร์ฟเวอร์) */
const UNEXPECTED_MESSAGE = "ทดสอบไม่สำเร็จเพราะเกิดข้อผิดพลาดภายในระบบ (ดูรายละเอียดใน log ของเซิร์ฟเวอร์)"

const BACKUP_DIR_PREFIX = "koymukarnnovel-backup-"

const describe = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e))

/** `/api/admin/settings…` และ `/api/admin/backup` (ผ่านด่านล็อกอินและตัวอ่าน JSON มาแล้ว) */
export function createSettingsRouter(deps: AppDeps): Router {
  const { config, db, settings, ai, now, log } = deps
  const router = Router()

  /** ที่อยู่ที่เครื่องมืออื่นใช้ส่งตอนเข้ามา: PUBLIC_URL ถ้าตั้งไว้ ไม่งั้นที่อยู่ที่ผู้ดูแลเปิดหน้านี้อยู่ตอนนี้ */
  const importUrl = (req: Request): string => `${config.publicUrl ?? `${req.protocol}://${req.get("host") ?? `localhost:${config.port}`}`}/api/import`

  /** การตั้งค่า + สถานะที่ระบบคำนวณเอง (บอกแค่ว่าตั้งความลับไว้แล้วหรือยัง ไม่เคยส่งค่าจริง) */
  const view = (req: Request) => ({
    ...settings.get(),
    apiKeySet: ai.hasKey(),
    importTokenSet: config.importToken !== null,
    importUrl: importUrl(req),
  })

  router.get("/settings", (req, res) => {
    res.json(view(req))
  })

  router.put("/settings", (req, res) => {
    settings.update(obj(req.body) as Partial<SiteSettings>) // ตรวจทั้งชุดก่อนบันทึก · คีย์ที่ไม่รู้จัก (รวมความลับ) ถูกข้าม
    res.json(view(req))
  })

  /** ส่งคำขอสั้นๆ ไปหา Claude ด้วยโมเดลสรุป (ถูกที่สุด) ตอบ 200 เสมอ ผลสำเร็จหรือไม่อยู่ใน `ok` และเก็บไว้ให้ Dashboard */
  router.post("/settings/test-api", async (_req, res) => {
    const model = settings.get().recapModel
    let ok = false
    let message: string
    try {
      const { usage } = await ai.ping(model)
      ok = true
      message = `เชื่อมต่อ Claude API ได้ (โมเดล ${model})`
      try {
        recordUsage(db, dayKey(now()), model, usage)
      } catch (e) {
        log.warn(`บันทึกโทเคนของการทดสอบ API ไม่สำเร็จ: ${describe(e)}`)
      }
    } catch (e) {
      if (e instanceof AiError) {
        message = e.message
      } else {
        log.error(`POST /api/admin/settings/test-api: ${describe(e)}`)
        message = UNEXPECTED_MESSAGE
      }
    }
    const check = writeApiCheck(settings, ok, message, now())
    res.json({ ok: check.ok, message: check.message })
  })

  /** สำรองฐานข้อมูลเป็นไฟล์เดียวไว้ในโฟลเดอร์ชั่วคราวของคำขอนี้ ส่งให้ดาวน์โหลด แล้วลบทิ้ง (ไม่ว่าส่งสำเร็จหรือไม่) */
  router.get("/backup", async (_req, res, next) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), BACKUP_DIR_PREFIX))
    const cleanup = (): Promise<void> =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((e: unknown) => log.warn(`ลบโฟลเดอร์ชั่วคราวของไฟล์สำรองไม่สำเร็จ (${dir}): ${describe(e)}`))

    let file: { path: string; filename: string }
    try {
      file = await createBackupFile(db, dir, now())
    } catch (e) {
      await cleanup()
      throw e
    }
    // คำตอบเป็น no-store อยู่แล้ว (ด่านของ /api/admin) จึงไม่ใส่ Last-Modified (ETag ปิดรายครั้งไม่ได้ Express ตั้งตามค่าแอป)
    res.download(file.path, file.filename, { lastModified: false }, (err) => {
      void cleanup()
      // ล้มก่อนเริ่มส่ง (เช่นไฟล์หายไป) ต้องตอบ 500 เอง · ล้มกลางทาง (ผู้ใช้ยกเลิก) ไม่มีอะไรให้ตอบแล้ว
      if (err && !res.headersSent) next(new Error(`ส่งไฟล์สำรองไม่สำเร็จ: ${err.message}`, { cause: err }))
    })
  })

  return router
}
