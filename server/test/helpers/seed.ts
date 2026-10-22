import type { Db } from "../../src/db.js"
import type { ChapterRow, ChapterStatus, Mode } from "../../src/types.js"

/**
 * สร้างข้อมูลทดสอบลง DB ตรงๆ (ไม่ผ่านโค้ดของระบบ) ให้เทสต์ของโดเมน/คิว/HTTP ใช้ร่วมกัน
 * ค่าเริ่มต้นคือตอนแบบร่างที่ยังไม่มีคำแปล; ใส่เฉพาะฟิลด์ที่เทสต์สนใจ
 */

const T0 = "2026-01-01 00:00:00"

export function seedNovel(
  db: Db,
  o: { title?: string; titleTh?: string; mode?: Mode; styleNote?: string; published?: boolean; author?: string } = {},
): number {
  return db.run(
    "INSERT INTO novels (title, title_th, author, mode, style_note, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    o.title ?? "Test Novel",
    o.titleTh ?? "",
    o.author ?? "",
    o.mode ?? "translate",
    o.styleNote ?? "",
    o.published ? 1 : 0,
    T0,
    T0,
  ).lastInsertRowid
}

export interface SeedChapter {
  title?: string
  titleTh?: string
  source?: string
  translation?: string
  recap?: string | null
  status?: ChapterStatus
  error?: string
  published?: boolean
  publishedAt?: string | null
  autoPublish?: boolean
  queueSeq?: number | null
  translatedAt?: string | null
}

export function seedChapter(db: Db, novelId: number, number: number, o: SeedChapter = {}): number {
  return db.run(
    `INSERT INTO chapters (novel_id, number, title, title_th, source_text, translation, recap, status, error,
                           published, published_at, auto_publish, queue_seq, translated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    novelId,
    number,
    o.title ?? `Chapter ${number}`,
    o.titleTh ?? "",
    o.source ?? `Source text of chapter ${number}.`,
    o.translation ?? "",
    o.recap ?? null,
    o.status ?? "draft",
    o.error ?? "",
    o.published ? 1 : 0,
    o.publishedAt ?? null,
    o.autoPublish ? 1 : 0,
    o.queueSeq ?? null,
    o.translatedAt ?? null,
    T0,
    T0,
  ).lastInsertRowid
}

export function seedGlossary(db: Db, novelId: number, rows: { source: string; thai: string; note?: string; auto?: boolean }[]): void {
  for (const r of rows) {
    db.run("INSERT INTO glossary (novel_id, source, thai, note, auto) VALUES (?, ?, ?, ?, ?)", novelId, r.source, r.thai, r.note ?? "", r.auto ? 1 : 0)
  }
}

export const getChapter = (db: Db, id: number): ChapterRow => db.get<ChapterRow>("SELECT * FROM chapters WHERE id = ?", id)!
