import type { Db } from "../../src/db.js"

/** DDL ของ prototype ตามที่อยู่ใน `git show c0e0ba8:server/src/db.ts` (ตัด PRAGMA ออก) */
export const LEGACY_DDL = `
CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  style_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL,
  recap TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (novel_id, number)
);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (chapter_id, mode)
);

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  thai TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (novel_id, source)
);
`

/**
 * ฐานข้อมูล prototype จำลอง:
 * - เรื่อง 1: ตอน 1 มีคำแปล translate + story, ตอน 2 มีแต่ story, ตอน 3 มีแต่ summary + คำศัพท์ 1 แถว
 * - เรื่อง 2: มีคำแปล story อย่างเดียว
 * - เรื่อง 3: ไม่มีคำแปลเลย
 */
export const LEGACY_TIMES = {
  novel: "2026-09-01 10:00:00",
  ch1Translate: "2026-09-02 08:00:00",
  ch1Story: "2026-09-02 09:00:00",
  ch2Story: "2026-09-03 08:00:00",
  ch3Summary: "2026-09-04 08:00:00",
} as const

export function createLegacyDb(db: Db): void {
  db.exec(LEGACY_DDL)
  const t = LEGACY_TIMES
  db.run("INSERT INTO novels (id, title, source_url, style_note, created_at) VALUES (1, 'Legacy One', 'https://example.com/one', 'ใช้ภาษาเรียบง่าย', ?)", t.novel)
  db.run("INSERT INTO novels (id, title, created_at) VALUES (2, 'Legacy Two', ?)", t.novel)
  db.run("INSERT INTO novels (id, title, created_at) VALUES (3, 'Legacy Three', ?)", t.novel)
  const chapter = (id: number, novelId: number, number: number, recap: string | null) =>
    db.run("INSERT INTO chapters (id, novel_id, number, title, source_text, recap, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, novelId, number, `Chapter ${number}`, `source ${id}`, recap, t.novel)
  chapter(1, 1, 1, "recap of chapter one")
  chapter(2, 1, 2, null)
  chapter(3, 1, 3, null)
  chapter(4, 2, 1, null)
  chapter(5, 3, 1, null)
  const tr = (chapterId: number, mode: string, text: string, at: string) =>
    db.run("INSERT INTO translations (chapter_id, mode, text, created_at) VALUES (?, ?, ?, ?)", chapterId, mode, text, at)
  tr(1, "translate", "แปลตอน 1", t.ch1Translate)
  tr(1, "story", "เล่าตอน 1", t.ch1Story)
  tr(2, "story", "เล่าตอน 2", t.ch2Story)
  tr(3, "summary", "สรุปตอน 3", t.ch3Summary)
  tr(4, "story", "เล่าเรื่องสอง", t.ch2Story)
  db.run("INSERT INTO glossary (novel_id, source, thai, note) VALUES (1, 'Zed', 'เซด', 'ชื่อตัวละคร')")
}
