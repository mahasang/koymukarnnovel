import type { Db } from "../../db.js"
import type { ChapterRow } from "../../types.js"
import { notFound } from "../../util/errors.js"
import { idParam } from "../validate.js"

/**
 * หาแถวที่เส้นทางหลังบ้านอ้างถึงด้วยรหัส (ใช้ร่วมกันทุกเส้นทางที่อยู่ใต้ `/novels/:id` หรือ `/chapters/:id`)
 * รหัสผิดรูปแบบกับรหัสที่ไม่มีแถวตอบเหมือนกัน (404 ข้อความไทย) และต้องเรียกก่อนตรวจ body เสมอ
 */

/** ชื่อที่ผู้ดูแลเห็นในข้อความ "ไม่พบ…" */
export const NOVEL = "นิยายเรื่องนี้"
export const CHAPTER = "ตอนที่ระบุ"

/** เรื่องตามรหัสที่ตรวจรูปแบบแล้ว (เช่น `novelId` ใน body) ต้องมีอยู่จริง ไม่งั้น 404 */
export function requireNovel(db: Db, id: number): number {
  if (db.get("SELECT 1 AS found FROM novels WHERE id = ?", id) === undefined) throw notFound(`ไม่พบ${NOVEL}`)
  return id
}

/** รหัสเรื่องจากพาธ (`/novels/:id/…`) */
export const existingNovelId = (db: Db, param: unknown): number => requireNovel(db, idParam(param, NOVEL))

/** รหัสตอนจากพาธ (`/chapters/:id`) เมื่อไม่ต้องใช้เนื้อหา (ไม่ดึงต้นฉบับและคำแปลที่อาจยาวหลายแสนตัวอักษร) */
export function existingChapterId(db: Db, param: unknown): number {
  const id = idParam(param, CHAPTER)
  if (db.get("SELECT 1 AS found FROM chapters WHERE id = ?", id) === undefined) throw notFound(`ไม่พบ${CHAPTER}`)
  return id
}

/** ตอนเต็มทั้งแถว */
export function chapterRow(db: Db, id: number): ChapterRow {
  const row = db.get<ChapterRow>("SELECT * FROM chapters WHERE id = ?", id)
  if (row === undefined) throw notFound(`ไม่พบ${CHAPTER}`)
  return row
}
