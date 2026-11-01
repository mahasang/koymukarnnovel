import fs from "node:fs"
import path from "node:path"
import type { Db } from "./db.js"
import type { Logger } from "./util/log.js"

export const SCHEMA_VERSION = 1

type Column = readonly [name: string, ddl: string]

const TEXT = "TEXT NOT NULL DEFAULT ''"
const FLAG = "INTEGER NOT NULL DEFAULT 0"
// SQLite ไม่ยอม ADD COLUMN ที่ default ไม่คงที่ จึงใช้ '' แล้วเติมจาก created_at ทีหลัง (ดู ensureSchema)
const UPDATED_AT = "TEXT NOT NULL DEFAULT ''"

/**
 * ตารางที่ prototype มีอยู่แล้ว: `create` คือโครงเดิมของ prototype ส่วน `add` คือคอลัมน์ที่เพิ่มภายหลัง
 * ฐานใหม่กับฐานเก่าใช้ทางเดียวกัน (สร้างแกน แล้วเติมคอลัมน์ที่ยังขาด) จึงได้โครงเหมือนกันทุกประการ
 */
const EVOLVING: { name: string; create: string; add: Column[] }[] = [
  {
    name: "novels",
    create: `CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      style_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    add: [
      ["title_th", TEXT],
      ["author", TEXT],
      ["synopsis", TEXT],
      ["synopsis_src", TEXT],
      ["tags", "TEXT NOT NULL DEFAULT '[]'"],
      ["status", "TEXT NOT NULL DEFAULT 'ongoing'"],
      ["license_note", TEXT],
      ["mode", "TEXT NOT NULL DEFAULT 'translate'"],
      ["published", FLAG],
      ["featured", FLAG],
      ["updated_at", UPDATED_AT],
    ],
  },
  {
    name: "chapters",
    create: `CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL,
      recap TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (novel_id, number)
    )`,
    add: [
      ["title_th", TEXT],
      ["translation", TEXT],
      ["status", "TEXT NOT NULL DEFAULT 'draft'"],
      ["error", TEXT],
      ["published", FLAG],
      ["published_at", "TEXT"],
      ["auto_publish", FLAG],
      ["queue_seq", "INTEGER"],
      ["translated_at", "TEXT"],
      ["updated_at", UPDATED_AT],
    ],
  },
  {
    name: "glossary",
    create: `CREATE TABLE IF NOT EXISTS glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      thai TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      UNIQUE (novel_id, source)
    )`,
    add: [["auto", FLAG]],
  },
]

// views ไม่มี FK: ยอดอ่านของเรื่องที่ถูกลบยังอยู่ในประวัติ (id เป็น AUTOINCREMENT ไม่ถูกใช้ซ้ำ จึงไม่ไปปนกับเรื่องใหม่)
const NEW_TABLES = [
  `CREATE TABLE IF NOT EXISTS covers (
    novel_id INTEGER PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage (
    day TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model)
  )`,
  `CREATE TABLE IF NOT EXISTS views (
    day TEXT NOT NULL,
    novel_id INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, novel_id)
  )`,
]

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS chapters_novel_published_number ON chapters (novel_id, published, number)",
  "CREATE INDEX IF NOT EXISTS chapters_status_queue ON chapters (status, queue_seq)",
]

const tableExists = (db: Db, name: string) =>
  db.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined

/** สร้างตาราง/คอลัมน์/ดัชนีที่ยังขาด รันซ้ำได้ ไม่แตะข้อมูลเดิม */
function ensureSchema(db: Db): void {
  for (const table of EVOLVING) {
    db.exec(table.create)
    const have = new Set(db.all<{ name: string }>(`PRAGMA table_info(${table.name})`).map((c) => c.name))
    for (const [name, ddl] of table.add) {
      if (!have.has(name)) db.exec(`ALTER TABLE ${table.name} ADD COLUMN ${name} ${ddl}`)
    }
  }
  for (const sql of NEW_TABLES) db.exec(sql)
  for (const sql of INDEXES) db.exec(sql)
  for (const table of ["novels", "chapters"]) db.run(`UPDATE ${table} SET updated_at = created_at WHERE updated_at = ''`)
}

/** spec 5.2 ข้อ 3–4: คัดลอกคำแปลจากตาราง translations (ตารางเดิมคงไว้) และตั้งโหมดของเรื่อง */
function copyPrototypeData(db: Db): void {
  // translate ก่อน story ถ้าไม่มีทั้งคู่ (เช่นมีแต่ summary) ตอนนั้นเป็นร่างและข้อความยังอยู่ใน translations
  db.run(`
    WITH best AS (
      SELECT chapter_id, text, created_at,
             ROW_NUMBER() OVER (PARTITION BY chapter_id ORDER BY CASE mode WHEN 'translate' THEN 0 ELSE 1 END, id) AS rn
      FROM translations
      WHERE mode IN ('translate', 'story') AND text <> ''
    )
    UPDATE chapters
    SET translation = best.text, translated_at = best.created_at, published_at = best.created_at,
        status = 'done', published = 1
    FROM best
    WHERE best.rn = 1 AND best.chapter_id = chapters.id`)
  // โหมด story เฉพาะเรื่องที่มีแต่คำแปลแบบ story นอกนั้นใช้ค่าเริ่มต้น translate
  // ทุกเรื่องคง published = 0 (ค่า default ของคอลัมน์ใหม่) เจ้าของกดเผยแพร่เองทีหลัง
  const has = (mode: string) => `EXISTS (
    SELECT 1 FROM translations t JOIN chapters c ON c.id = t.chapter_id
    WHERE c.novel_id = novels.id AND t.mode = '${mode}' AND t.text <> '')`
  db.run(`UPDATE novels SET mode = 'story' WHERE ${has("story")} AND NOT ${has("translate")}`)
}

export function migrate(db: Db): { fromVersion: number; migratedPrototype: boolean } {
  return db.tx(() => {
    const fromVersion = db.get<{ user_version: number }>("PRAGMA user_version")!.user_version
    if (fromVersion > SCHEMA_VERSION) {
      throw new Error(`ฐานข้อมูลนี้เป็นเวอร์ชัน ${fromVersion} ใหม่กว่าที่โปรแกรมนี้รองรับ (เวอร์ชัน ${SCHEMA_VERSION}) ให้อัปเดตโปรแกรมก่อนใช้ไฟล์นี้`)
    }
    const migratedPrototype = fromVersion === 0 && tableExists(db, "translations")
    ensureSchema(db)
    if (migratedPrototype) copyPrototypeData(db)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    return { fromVersion, migratedPrototype }
  })
}

// ชื่อไฟล์ของรุ่นก่อนหน้า เรียงจากใหม่ไปเก่า
const LEGACY_DB_NAMES = ["novel-99.db", "novel-teller.db"]
// ไฟล์หลักต้องมาก่อน ถ้าย้ายไม่สำเร็จ (เช่นไฟล์ยังเปิดอยู่ใน Windows) จะพังตั้งแต่ไฟล์แรกก่อนย้ายอะไรไป
const SIDECARS = ["", "-wal", "-shm", "-journal"]

/**
 * ย้ายฐานข้อมูลของรุ่นก่อน (novel-99.db หรือ novel-teller.db พร้อม -wal/-shm/-journal) มาเป็นชื่อ `dbPath`
 * ทำเฉพาะเมื่อปลายทางและไฟล์ข้างเคียงของปลายทางยังไม่มี ไม่เขียนทับและไม่ลบอะไร คืน true เมื่อย้ายแล้ว
 */
export function renameLegacyDb(dbPath: string, log?: Logger): boolean {
  if (dbPath === ":memory:") return false
  const target = path.resolve(dbPath)
  const dir = path.dirname(target)
  const legacy = LEGACY_DB_NAMES.map((name) => path.join(dir, name)).filter((p) => p !== target && fs.existsSync(p))
  if (legacy.length === 0) return false
  const name = (p: string) => path.basename(p)

  const occupied = SIDECARS.map((s) => target + s).filter((p) => fs.existsSync(p))
  if (occupied.length > 0) {
    log?.warn(`พบไฟล์ฐานข้อมูลเดิม ${legacy.map(name).join(", ")} แต่มี ${name(occupied[0]!)} อยู่แล้ว จึงไม่ย้ายและไม่แตะไฟล์เดิม`)
    return false
  }

  const [from, ...ignored] = legacy as [string, ...string[]]
  for (const s of SIDECARS) {
    if (fs.existsSync(from + s)) fs.renameSync(from + s, target + s)
  }
  if (ignored.length > 0) log?.warn(`พบไฟล์ฐานข้อมูลเดิมหลายชื่อ ใช้ ${name(from)} และไม่แตะ ${ignored.map(name).join(", ")}`)
  log?.info(`ย้ายฐานข้อมูลเดิม ${name(from)} เป็น ${name(target)} แล้ว`)
  return true
}
