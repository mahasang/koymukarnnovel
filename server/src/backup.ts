import fs from "node:fs/promises"
import path from "node:path"
import type { Db } from "./db.js"
import { fileStamp } from "./util/time.js"

/**
 * สำเนาฐานข้อมูลทั้งก้อนเป็นไฟล์เดียวชื่อ `koymukarnnovel-YYYYMMDD-HHMM.db` (เวลา UTC+7) ในโฟลเดอร์ `dir` (สร้างให้ถ้ายังไม่มี)
 * ใช้ `VACUUM INTO` จึงได้ภาพที่สอดคล้องกัน รวมข้อมูลที่ยังอยู่ในไฟล์ -wal และเปิดได้เดี่ยวๆ ไม่ต้องพกไฟล์ข้างเคียง
 * ไม่ทับไฟล์ที่มีอยู่แล้ว (ล้มเหลวแทน) · คำสั่งนี้หยุดการทำงานอื่นของโปรเซสไว้จนสำเนาเสร็จ (ฐานข้อมูลของเว็บส่วนตัวใช้เวลาไม่นาน)
 */
export async function createBackupFile(db: Db, dir: string, now: Date): Promise<{ path: string; filename: string }> {
  await fs.mkdir(dir, { recursive: true })
  const filename = `koymukarnnovel-${fileStamp(now)}.db`
  const file = path.join(dir, filename)
  db.backupTo(file)
  return { path: file, filename }
}
