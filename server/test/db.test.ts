import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDb } from "../src/db.js"
import { migrate } from "../src/migrate.js"

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-db-"))
const count = (db: ReturnType<typeof openDb>, table: string) => db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)!.c

test("พารามิเตอร์: undefined เป็น NULL, boolean เป็น 0/1, run คืนตัวเลข, แถวเป็น object ธรรมดา", () => {
  const db = openDb(":memory:")
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b INTEGER, c INTEGER)")
  const r = db.run("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", undefined, true, false)
  assert.equal(typeof r.changes, "number")
  assert.equal(r.changes, 1)
  assert.equal(typeof r.lastInsertRowid, "number")
  assert.equal(r.lastInsertRowid, 1)
  assert.deepEqual(db.get("SELECT a, b, c FROM t"), { a: null, b: 1, c: 0 })
  assert.deepEqual(db.all("SELECT b FROM t"), [{ b: 1 }])
  assert.equal(db.get("SELECT * FROM t WHERE id = ?", 99), undefined)
  db.close()
})

test("tx: throw แล้ว rollback ทั้งก้อน และใช้ tx ต่อได้", () => {
  const db = openDb(":memory:")
  db.exec("CREATE TABLE t (n INTEGER)")
  assert.throws(() => db.tx(() => { db.run("INSERT INTO t VALUES (1)"); throw new Error("boom") }), /boom/)
  assert.equal(count(db, "t"), 0)
  assert.equal(db.tx(() => { db.run("INSERT INTO t VALUES (2)"); return "ok" }), "ok")
  assert.equal(count(db, "t"), 1)
  db.close()
})

test("tx ซ้อนกัน: inner throw ทำให้ rollback ทั้งหมด, สำเร็จแล้ว commit ทั้งหมด", () => {
  const db = openDb(":memory:")
  db.exec("CREATE TABLE t (n INTEGER)")
  assert.throws(
    () => db.tx(() => { db.run("INSERT INTO t VALUES (1)"); db.tx(() => { db.run("INSERT INTO t VALUES (2)"); throw new Error("inner") }) }),
    /inner/,
  )
  assert.equal(count(db, "t"), 0)
  const v = db.tx(() => { db.run("INSERT INTO t VALUES (1)"); return db.tx(() => { db.run("INSERT INTO t VALUES (2)"); return 42 }) })
  assert.equal(v, 42)
  assert.equal(count(db, "t"), 2)
  db.close()
})

test("tx: inner throw ที่ outer กลืนไว้ → outer rollback ทั้งหมดแล้วโยน error ไม่ commit ครึ่งเดียว", () => {
  const db = openDb(":memory:")
  db.exec("CREATE TABLE t (n INTEGER)")
  assert.throws(
    () => db.tx(() => {
      db.run("INSERT INTO t VALUES (1)")
      try { db.tx(() => { db.run("INSERT INTO t VALUES (2)"); throw new Error("inner") }) } catch { /* กลืน error ไว้ */ }
    }),
    /ธุรกรรม/,
  )
  assert.equal(count(db, "t"), 0)
  db.close()
})

test("tx: ฟังก์ชัน async ถูกปฏิเสธและ rollback (ไม่ commit ก่อนงานเสร็จ)", () => {
  const db = openDb(":memory:")
  db.exec("CREATE TABLE t (n INTEGER)")
  assert.throws(() => db.tx(async () => { db.run("INSERT INTO t VALUES (1)") }), /async/)
  assert.equal(count(db, "t"), 0)
  db.close()
})

test("ไฟล์จริง: สร้างโฟลเดอร์แม่, ใช้โหมด WAL, เปิด foreign_keys", () => {
  const dir = tmpDir()
  const file = path.join(dir, "deeper", "x.db")
  const db = openDb(file)
  assert.equal(db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode, "wal")
  assert.equal(db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys, 1)
  assert.equal(db.get<{ timeout: number }>("PRAGMA busy_timeout")?.timeout, 5000)
  db.close()
  assert.ok(fs.existsSync(file))
  const mem = openDb(":memory:")
  assert.equal(mem.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys, 1)
  mem.close()
})

test("backupTo ได้ไฟล์ที่เปิดด้วย openDb แล้วอ่านข้อมูลเดิมได้", () => {
  const dir = tmpDir()
  const db = openDb(path.join(dir, "main.db"))
  db.exec("CREATE TABLE t (n TEXT)")
  db.run("INSERT INTO t VALUES (?)", "สวัสดี")
  const copy = path.join(dir, "copy.db")
  db.backupTo(copy)
  db.run("INSERT INTO t VALUES (?)", "หลังสำรอง")
  const restored = openDb(copy)
  assert.deepEqual(restored.all("SELECT n FROM t"), [{ n: "สวัสดี" }])
  restored.close()
  db.close()
})

test("ลบ novel แล้ว chapters, glossary และ covers หายตาม (cascade)", () => {
  const db = openDb(":memory:")
  migrate(db)
  db.run("INSERT INTO novels (title, created_at, updated_at) VALUES ('N', '2026-01-01 00:00:00', '2026-01-01 00:00:00')")
  db.run("INSERT INTO chapters (novel_id, number, source_text) VALUES (1, 1, 'x')")
  db.run("INSERT INTO glossary (novel_id, source, thai) VALUES (1, 'a', 'ก')")
  db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (1, 'image/png', x'89504e47', '2026-01-01 00:00:00')")
  db.run("DELETE FROM novels WHERE id = 1")
  for (const table of ["chapters", "glossary", "covers"]) assert.equal(count(db, table), 0, table)
  db.close()
})
