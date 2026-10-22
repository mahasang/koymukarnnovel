import { Router } from "express"
import type { AppDeps } from "../../app.js"
import { toQueueErrorDto, type QueueErrorRow } from "../dto.js"
import { obj, str } from "../validate.js"

/** ขีดจำกัด: สาเหตุที่ผู้ดูแลพิมพ์ (นับหลังล้างข้อความ) และจำนวนตอนผิดพลาดที่แสดงในหน้าคิว */
const MAX = { reason: 200, errors: 20 } as const

const LABEL = { reason: "สาเหตุที่หยุด (reason)" } as const

/** ตอนที่ผิดพลาดล่าสุดก่อน (เวลาแก้ไขตรงกันให้รหัสมากก่อน) */
const SELECT_ERRORS = `
  SELECT c.id, c.novel_id, c.number, c.error, n.title, n.title_th
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE c.status = 'error' ORDER BY c.updated_at DESC, c.id DESC LIMIT ?`

/** `/api/admin/queue…` (ผ่านด่านล็อกอินและตัวอ่าน JSON มาแล้ว) */
export function createQueueRouter(deps: AppDeps): Router {
  const { db, queue } = deps
  const router = Router()

  /** สถานะสดของคิว (`queue.state()`) + ตอนที่ผิดพลาดล่าสุด ตอบแบบเดียวกันทั้งเส้นทางอ่านและสั่งงาน หน้าเว็บจะได้อัปเดตทันทีไม่ต้องรอรอบดึงถัดไป */
  const snapshot = () => ({ ...queue.state(), errors: db.all<QueueErrorRow>(SELECT_ERRORS, MAX.errors).map(toQueueErrorDto) })

  router.get("/queue", (_req, res) => {
    res.json(snapshot())
  })

  router.post("/queue/pause", (req, res) => {
    const body = req.body === undefined ? {} : obj(req.body) // ไม่ส่ง body มาเลยก็หยุดได้ (ปุ่มกดตรงๆ)
    const reason = str(body.reason, LABEL.reason, { max: MAX.reason, optional: true })
    // หยุดซ้ำโดยไม่ระบุสาเหตุ (เช่นแท็บเก่าที่ยังเห็นปุ่มหยุด) ต้องไม่ทับสาเหตุจริงที่ระบบเก็บไว้ เช่น "API key ไม่ถูกต้อง"
    if (reason !== "" || !queue.state().paused) queue.pause(reason)
    res.json(snapshot())
  })

  router.post("/queue/resume", (_req, res) => {
    queue.resume()
    res.json(snapshot())
  })

  return router
}
