import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDb, type Db } from "../src/db.js"
import { migrate, renameLegacyDb, SCHEMA_VERSION } from "../src/migrate.js"
import { memoryLogger } from "../src/util/log.js"
import { createLegacyDb, LEGACY_TIMES } from "./fixtures/legacy.js"

// คอลัมน์ตามตารางใน spec 5.1
const COLUMNS: Record<string, string[]> = {
  novels: ["id", "title", "title_th", "author", "synopsis", "synopsis_src", "tags", "status", "source_url", "license_note", "style_note", "mode", "published", "featured", "created_at", "updated_at"],
  chapters: ["id", "novel_id", "number", "title", "title_th", "source_text", "translation", "recap", "status", "error", "published", "published_at", "auto_publish", "queue_seq", "translated_at", "created_at", "updated_at"],
  glossary: ["id", "novel_id", "source", "thai", "note", "auto"],
  covers: ["novel_id", "mime", "data", "updated_at"],
  settings: ["key", "value"],
  usage: ["day", "model", "tokens_in", "tokens_out", "calls"],
  views: ["day", "novel_id", "count"],
}

const columnsOf = (db: Db, table: string) => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name).sort()
const userVersion = (db: Db) => db.get<{ user_version: number }>("PRAGMA user_version")!.user_version
const indexColumns = (db: Db, table: string) =>
  db.all<{ name: string; origin: string }>(`PRAGMA index_list(${table})`)
    .filter((i) => i.origin === "c")
    .map((i) => db.all<{ name: string }>(`PRAGMA index_info(${i.name})`).map((c) => c.name))

function assertAllColumns(db: Db) {
  for (const [table, cols] of Object.entries(COLUMNS)) assert.deepEqual(columnsOf(db, table), [...cols].sort(), table)
}

test("DB ว่าง: สร้างครบทุกตาราง คอลัมน์ และดัชนี", () => {
  const db = openDb(":memory:")
  assert.deepEqual(migrate(db), { fromVersion: 0, migratedPrototype: false })
  assert.equal(SCHEMA_VERSION, 1)
  assert.equal(userVersion(db), 1)
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name)
  assert.deepEqual(tables, ["chapters", "covers", "glossary", "novels", "settings", "usage", "views"])
  assertAllColumns(db)
  const indexes = indexColumns(db, "chapters")
  assert.ok(indexes.some((c) => c.join() === "novel_id,published,number"), JSON.stringify(indexes))
  assert.ok(indexes.some((c) => c.join() === "status,queue_seq"), JSON.stringify(indexes))
  db.close()
})

test("ย้ายจาก prototype: คัดลอกคำแปล ตั้งสถานะ โหมด และซ่อนทุกเรื่อง", () => {
  const db = openDb(":memory:")
  createLegacyDb(db)
  assert.deepEqual(migrate(db), { fromVersion: 0, migratedPrototype: true })
  assert.equal(userVersion(db), 1)
  assertAllColumns(db)

  const ch = (id: number) => db.get<Record<string, unknown>>("SELECT * FROM chapters WHERE id = ?", id)!
  // ตอน 1: ใช้ translate ก่อน story
  assert.equal(ch(1).translation, "แปลตอน 1")
  assert.equal(ch(1).status, "done")
  assert.equal(ch(1).published, 1)
  assert.equal(ch(1).published_at, LEGACY_TIMES.ch1Translate)
  assert.equal(ch(1).translated_at, LEGACY_TIMES.ch1Translate)
  assert.equal(ch(1).recap, "recap of chapter one")
  // ตอน 2: มีแต่ story
  assert.equal(ch(2).translation, "เล่าตอน 2")
  assert.equal(ch(2).status, "done")
  assert.equal(ch(2).published_at, LEGACY_TIMES.ch2Story)
  // ตอน 3: มีแต่ summary → ร่าง ไม่คัดลอก แต่ข้อความเดิมยังอยู่ในตาราง translations
  assert.equal(ch(3).translation, "")
  assert.equal(ch(3).status, "draft")
  assert.equal(ch(3).published, 0)
  assert.equal(ch(3).published_at, null)
  assert.equal(db.get<{ text: string }>("SELECT text FROM translations WHERE chapter_id = 3")?.text, "สรุปตอน 3")
  // โหมดของเรื่อง และทุกเรื่องถูกซ่อน
  const mode = (id: number) => db.get<{ mode: string }>("SELECT mode FROM novels WHERE id = ?", id)!.mode
  assert.deepEqual([mode(1), mode(2), mode(3)], ["translate", "story", "translate"])
  assert.deepEqual(db.all("SELECT published FROM novels"), [{ published: 0 }, { published: 0 }, { published: 0 }])
  // ค่าเริ่มต้นของคอลัมน์ใหม่ และ updated_at = created_at
  assert.deepEqual(
    db.get("SELECT status, tags, featured, author, title_th, created_at = updated_at AS same FROM novels WHERE id = 1"),
    { status: "ongoing", tags: "[]", featured: 0, author: "", title_th: "", same: 1 },
  )
  assert.equal(db.get<{ same: number }>("SELECT created_at = updated_at AS same FROM chapters WHERE id = 1")?.same, 1)
  assert.deepEqual(db.get("SELECT auto FROM glossary"), { auto: 0 })
  assert.equal(db.get<{ source_url: string }>("SELECT source_url FROM novels WHERE id = 1")?.source_url, "https://example.com/one")
  db.close()
})

test("รันซ้ำ: ไม่คัดลอกอีก และข้อมูลที่เจ้าของแก้หลังย้ายไม่ถูกทับ", () => {
  const db = openDb(":memory:")
  createLegacyDb(db)
  migrate(db)
  db.run("UPDATE chapters SET translation = 'แก้เอง', published = 0 WHERE id = 1")
  db.run("UPDATE novels SET published = 1 WHERE id = 1")
  assert.deepEqual(migrate(db), { fromVersion: 1, migratedPrototype: false })
  assert.equal(db.get<{ translation: string }>("SELECT translation FROM chapters WHERE id = 1")?.translation, "แก้เอง")
  assert.equal(db.get<{ published: number }>("SELECT published FROM chapters WHERE id = 1")?.published, 0)
  assert.equal(db.get<{ published: number }>("SELECT published FROM novels WHERE id = 1")?.published, 1)
  db.close()

  const empty = openDb(":memory:")
  migrate(empty)
  assert.deepEqual(migrate(empty), { fromVersion: 1, migratedPrototype: false })
  empty.close()
})

test("ฐานข้อมูลที่ใหม่กว่าโปรแกรมถูกปฏิเสธ ไม่แก้อะไร", () => {
  const db = openDb(":memory:")
  db.exec("PRAGMA user_version = 99")
  assert.throws(() => migrate(db), /เวอร์ชัน/)
  assert.equal(userVersion(db), 99)
  db.close()
})

const SIDECARS = ["", "-wal", "-shm", "-journal"]
const legacyDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-rename-"))
const put = (dir: string, name: string, text: string) => fs.writeFileSync(path.join(dir, name), text)
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), "utf8")

test("renameLegacyDb: ย้าย novel-99.db พร้อม -wal/-shm/-journal เป็นชื่อใหม่ ไม่มีอะไรให้ย้ายก็คืน false เงียบๆ", () => {
  const dir = legacyDir()
  const target = path.join(dir, "koymukarnnovel.db")
  const { logger, lines } = memoryLogger()
  assert.equal(renameLegacyDb(target, logger), false) // ไม่มีอะไรให้ย้าย
  assert.equal(renameLegacyDb(":memory:", logger), false)
  assert.deepEqual(lines, [])

  for (const s of SIDECARS) put(dir, `novel-99.db${s}`, `legacy${s}`)
  assert.equal(renameLegacyDb(target, logger), true)
  for (const s of SIDECARS) {
    assert.equal(fs.readFileSync(`${target}${s}`, "utf8"), `legacy${s}`)
    assert.ok(!fs.existsSync(path.join(dir, `novel-99.db${s}`)), `old ${s}`)
  }
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^info: .*novel-99\.db.*koymukarnnovel\.db/)
})

test("renameLegacyDb: รุ่นเก่าสุด novel-teller.db ก็ย้ายได้", () => {
  const dir = legacyDir()
  put(dir, "novel-teller.db", "teller")
  put(dir, "novel-teller.db-wal", "teller-wal")
  assert.equal(renameLegacyDb(path.join(dir, "koymukarnnovel.db")), true)
  assert.equal(read(dir, "koymukarnnovel.db"), "teller")
  assert.equal(read(dir, "koymukarnnovel.db-wal"), "teller-wal")
  assert.ok(!fs.existsSync(path.join(dir, "novel-teller.db")))
  assert.ok(!fs.existsSync(path.join(dir, "novel-teller.db-wal")))
})

test("renameLegacyDb: มีทั้ง novel-99.db และ novel-teller.db → ใช้ novel-99.db ไม่แตะอีกไฟล์ และเตือนหนึ่งครั้ง", () => {
  const dir = legacyDir()
  put(dir, "novel-99.db", "newer")
  put(dir, "novel-teller.db", "older")
  const { logger, lines } = memoryLogger()
  assert.equal(renameLegacyDb(path.join(dir, "koymukarnnovel.db"), logger), true)
  assert.equal(read(dir, "koymukarnnovel.db"), "newer")
  assert.equal(read(dir, "novel-teller.db"), "older")
  const warns = lines.filter((l) => l.startsWith("warn: "))
  assert.equal(warns.length, 1)
  assert.match(warns[0], /novel-teller\.db/)
})

test("renameLegacyDb: ปลายทางหรือไฟล์ข้างเคียงของปลายทางมีอยู่แล้ว → ไม่แตะอะไรเลย คืน false และเตือน", () => {
  for (const existing of ["koymukarnnovel.db", "koymukarnnovel.db-wal"]) {
    const dir = legacyDir()
    put(dir, existing, "keep")
    put(dir, "novel-99.db", "legacy")
    const { logger, lines } = memoryLogger()
    assert.equal(renameLegacyDb(path.join(dir, "koymukarnnovel.db"), logger), false, existing)
    assert.equal(read(dir, existing), "keep")
    assert.equal(read(dir, "novel-99.db"), "legacy")
    assert.equal(lines.length, 1, existing)
    assert.match(lines[0], /^warn: /)
  }
})

test("renameLegacyDb: DB_PATH ที่ชี้ชื่อเก่าอยู่แล้ว ใช้ในที่เดิม ไม่ย้ายตัวเองและไม่เตือนเกินจริง", () => {
  const dir = legacyDir()
  put(dir, "novel-99.db", "legacy")
  const { logger, lines } = memoryLogger()
  assert.equal(renameLegacyDb(path.join(dir, "novel-99.db"), logger), false)
  assert.equal(read(dir, "novel-99.db"), "legacy")
  assert.deepEqual(lines, [])
})
