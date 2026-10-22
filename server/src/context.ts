import type { Db } from "./db.js"
import { buildSystem, MAX_RECAPS } from "./prompts.js"
import type { ChapterRow, GlossaryRow, NovelRow } from "./types.js"

export interface ChapterContext {
  novel: NovelRow
  chapter: ChapterRow
  glossary: GlossaryRow[]
  /** เรื่องย่อของตอนก่อนหน้า (ไม่เกิน MAX_RECAPS ตอนล่าสุดที่มีเรื่องย่อ) เรียงเลขน้อยไปมาก */
  recaps: { number: number; recap: string }[]
  /** system prompt ที่ประกอบจากข้อมูลข้างบน — ชุดเดียวกับที่คิวส่งให้ Claude และที่ช่องทางนำเข้าให้ผู้ใช้อ่าน */
  system: string
}

/**
 * ช่องว่าง/ขึ้นบรรทัด/แท็บล้วนถือว่าไม่มีเรื่องย่อ (TRIM ของ SQLite ตัดแค่เว้นวรรคถ้าไม่ระบุตัวอักษร)
 * recap ที่เป็น NULL ได้ TRIM เป็น NULL เงื่อนไขจึงไม่เป็นจริงเอง ไม่ต้องเช็ก IS NOT NULL แยก
 */
const BLANK_CHARS = " || char(9, 10, 13)"

export function buildContext(db: Db, chapterId: number): ChapterContext | null {
  const chapter = db.get<ChapterRow>("SELECT * FROM chapters WHERE id = ?", chapterId)
  if (!chapter) return null
  const novel = db.get<NovelRow>("SELECT * FROM novels WHERE id = ?", chapter.novel_id)
  if (!novel) return null

  const glossary = db.all<GlossaryRow>("SELECT * FROM glossary WHERE novel_id = ? ORDER BY id", novel.id)
  const recaps = db
    .all<{ number: number; recap: string }>(
      `SELECT number, recap FROM chapters
       WHERE novel_id = ? AND number < ? AND TRIM(recap, ' '${BLANK_CHARS}) <> ''
       ORDER BY number DESC LIMIT ?`,
      novel.id,
      chapter.number,
      MAX_RECAPS,
    )
    .map((r) => ({ number: r.number, recap: r.recap.trim() }))
    .reverse()

  const system = buildSystem({
    mode: novel.mode,
    novelTitle: novel.title,
    styleNote: novel.style_note,
    glossary: glossary.map((g) => ({ source: g.source, thai: g.thai, note: g.note })),
    recaps,
  })
  return { novel, chapter, glossary, recaps, system }
}
