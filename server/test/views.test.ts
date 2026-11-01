import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDb, type Db } from "../src/db.js"
import { migrate } from "../src/migrate.js"
import { createViews } from "../src/views.js"
import { memoryLogger } from "../src/util/log.js"
import { seedNovel } from "./helpers/seed.js"

// "วัน" ของยอดอ่านนับตามเวลา UTC+7: 16:59:59Z = 23:59:59 ของวันที่ 22, 17:00:00Z = 00:00:00 ของวันที่ 23
const DAY22 = "2026-10-22T10:00:00Z"
const DAY23 = "2026-10-22T20:00:00Z"

function clock(iso: string) {
  let t = new Date(iso)
  return { now: () => t, set: (next: string) => void (t = new Date(next)) }
}

function setup(iso = DAY22) {
  const db = openDb(":memory:")
  migrate(db)
  const novelId = seedNovel(db)
  const c = clock(iso)
  return { db, novelId, c, views: createViews({ db, now: c.now }) }
}

const rowsOf = (db: Db) => db.all<{ day: string; novel_id: number; count: number }>("SELECT day, novel_id, count FROM views ORDER BY day, novel_id")

const READER = { ip: "203.0.113.7", ua: "Mozilla/5.0 TestAgent" }

test("ip+ua+ตอนเดิมสองครั้งในวันเดียว: true แล้ว false และยอดของเรื่องนั้นในวันนั้นเป็น 1", () => {
  const { db, novelId, views } = setup()
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), true)
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), false)
  assert.deepEqual(rowsOf(db), [{ day: "2026-10-22", novel_id: novelId, count: 1 }])
  assert.equal(views.size(), 1)
})

test("ต่าง UA, ต่าง IP หรือต่างตอน นับเพิ่ม (ยอดเป็นรายเรื่อง แต่ตัดซ้ำรายตอน); ต่างเรื่องแยกแถว", () => {
  const { db, novelId, views } = setup()
  const other = seedNovel(db, { title: "Other" })
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), true)
  assert.equal(views.record({ ip: READER.ip, ua: "Another UA", novelId, chapterId: 5 }), true)
  assert.equal(views.record({ ip: "198.51.100.9", ua: READER.ua, novelId, chapterId: 5 }), true)
  assert.equal(views.record({ ...READER, novelId, chapterId: 6 }), true) // ตอนอื่นของเรื่องเดียวกัน
  assert.equal(views.record({ ...READER, novelId: other, chapterId: 77 }), true)
  assert.deepEqual(rowsOf(db), [
    { day: "2026-10-22", novel_id: novelId, count: 4 },
    { day: "2026-10-22", novel_id: other, count: 1 },
  ])
  assert.equal(views.size(), 5)
})

test("ตัวคั่นในข้อมูลไม่ทำให้คนละคนถูกนับเป็นคนเดียวกัน (ip/ua ที่ต่อกันแล้วได้ข้อความเดียวกัน)", () => {
  const { db, novelId, views } = setup()
  assert.equal(views.record({ ip: "1|a", ua: "2", novelId, chapterId: 3 }), true)
  assert.equal(views.record({ ip: "1", ua: "a|2", novelId, chapterId: 3 }), true)
  assert.equal(views.record({ ip: "1", ua: "a|2", novelId, chapterId: 3 }), false)
  assert.equal(rowsOf(db)[0]?.count, 2)
})

test("ขึ้นวันใหม่ (ข้ามเที่ยงคืน UTC+7) นับใหม่ ชุดในหน่วยความจำถูกล้าง และยอดวันเก่ายังอยู่", () => {
  const { db, novelId, c, views } = setup("2026-10-22T16:59:59Z")
  views.record({ ...READER, novelId, chapterId: 5 })
  views.record({ ip: "198.51.100.9", ua: "x", novelId, chapterId: 5 })
  assert.equal(views.size(), 2)
  c.set("2026-10-22T17:00:00Z") // 00:00:00 ของวันที่ 23 ตามเวลา UTC+7
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), true)
  assert.equal(views.size(), 1, "คีย์ของเมื่อวานถูกล้างทิ้ง เหลือแต่ของวันนี้")
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), false)
  assert.deepEqual(rowsOf(db), [
    { day: "2026-10-22", novel_id: novelId, count: 2 },
    { day: "2026-10-23", novel_id: novelId, count: 1 },
  ])
})

test("ขอบเขตของวันคือ UTC+7 ไม่ใช่ UTC: ข้ามเที่ยงคืน UTC แต่ยังวันเดียวกันตามเวลาไทย = ไม่นับซ้ำ; วันเดียวกันตาม UTC แต่ข้ามเที่ยงคืนไทย = นับใหม่", () => {
  const { novelId, c, views } = setup("2026-10-21T20:00:00Z") // 03:00 ของวันที่ 22 (ไทย)
  assert.equal(views.record({ ...READER, novelId, chapterId: 1 }), true)
  c.set("2026-10-22T01:00:00Z") // 08:00 ของวันที่ 22 (ไทย) — คนละวันตาม UTC แต่วันเดียวกันตามไทย
  assert.equal(views.record({ ...READER, novelId, chapterId: 1 }), false)
  c.set("2026-10-22T10:00:00Z") // 17:00 ของวันที่ 22 (ไทย)
  assert.equal(views.record({ ...READER, novelId, chapterId: 1 }), false)
  c.set("2026-10-22T20:00:00Z") // 03:00 ของวันที่ 23 (ไทย) — วันเดียวกันตาม UTC แต่คนละวันตามไทย
  assert.equal(views.record({ ...READER, novelId, chapterId: 1 }), true)
})

test("max:2 — ใส่คีย์ต่างกันตัวที่ 3 ชุดถูกล้างก่อนเพิ่ม ขนาดไม่เกิน max และคีย์ที่ถูกล้างไปนับใหม่ได้", () => {
  const { db, novelId, c } = setup()
  const views = createViews({ db, now: c.now, max: 2 })
  const at = (n: number) => views.record({ ip: `10.0.0.${n}`, ua: "ua", novelId, chapterId: 1 })
  assert.equal(at(1), true)
  assert.equal(at(2), true)
  assert.equal(views.size(), 2)
  assert.equal(at(2), false, "คีย์ที่ยังอยู่ในชุดไม่ทำให้ชุดถูกล้าง")
  assert.equal(views.size(), 2)
  assert.equal(at(3), true)
  assert.equal(views.size(), 1, "ล้างแล้วเหลือแต่คีย์ใหม่")
  assert.equal(at(1), true, "คีย์ที่ถูกล้างไปนับใหม่ได้ (ยอมให้นับเกินเล็กน้อยแลกกับเพดานหน่วยความจำ)")
  assert.equal(at(3), false)
  for (let n = 10; n < 30; n++) {
    at(n)
    assert.ok(views.size() <= 2, `size=${views.size()}`)
  }
})

test("ค่า max เริ่มต้นคือ 200,000 คีย์ (spec 9.2): ถึงเพดานพอดียังไม่ล้าง คีย์ถัดไปล้างก่อนเพิ่ม", () => {
  let writes = 0
  const stub = { run: () => (writes++, { changes: 1, lastInsertRowid: 0 }) } as unknown as Db
  const views = createViews({ db: stub, now: clock(DAY22).now })
  for (let i = 0; i < 200_000; i++) views.record({ ip: String(i), ua: "ua", novelId: 1, chapterId: 1 })
  assert.equal(views.size(), 200_000)
  views.record({ ip: "one-more", ua: "ua", novelId: 1, chapterId: 1 })
  assert.equal(views.size(), 1)
  assert.equal(writes, 200_001)
})

test("ไม่เก็บ IP หรือ User-Agent: ตาราง views มีแค่ day/novel_id/count และไฟล์ฐานข้อมูลไม่มีข้อความทั้งสองอยู่เลย", () => {
  const { db, novelId, views } = setup()
  const ip = "203.0.113.77"
  const ua = "Mozilla/5.0 (X11; Linux) PrivacyProbe/9.9"
  views.record({ ip, ua, novelId, chapterId: 1 })
  views.record({ ip, ua, novelId, chapterId: 2 })
  views.record({ ip: "198.51.100.5", ua, novelId, chapterId: 1 })
  assert.deepEqual(
    db.all<{ name: string }>("PRAGMA table_info(views)").map((c) => c.name),
    ["day", "novel_id", "count"],
  )
  assert.equal(rowsOf(db)[0]?.count, 3)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-views-"))
  try {
    const copy = path.join(dir, "copy.db")
    db.backupTo(copy)
    const bytes = fs.readFileSync(copy)
    for (const secret of [ip, "198.51.100.5", "PrivacyProbe", "Mozilla"]) {
      assert.equal(bytes.includes(secret), false, `พบ ${secret} ในฐานข้อมูล`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("บันทึกยอดไม่สำเร็จ: ไม่ throw (สถิติพังต้องไม่ทำให้หน้าอ่านพัง) คืน false เตือนใน log และไม่จำคีย์ไว้ ลองใหม่ภายหลังนับได้", () => {
  const { db, novelId, c } = setup()
  const { logger, lines } = memoryLogger()
  const views = createViews({ db, now: c.now, log: logger })
  db.exec("ALTER TABLE views RENAME TO views_gone")
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), false)
  assert.equal(views.size(), 0)
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /^warn: .*ยอดอ่าน.*views/)
  db.exec("ALTER TABLE views_gone RENAME TO views")
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), true)
  assert.deepEqual(rowsOf(db), [{ day: "2026-10-22", novel_id: novelId, count: 1 }])
})

test("บันทึกยอดไม่สำเร็จโดยไม่มี logger ก็ไม่ throw", () => {
  const { db, novelId, views } = setup()
  db.exec("DROP TABLE views")
  assert.equal(views.record({ ...READER, novelId, chapterId: 5 }), false)
})
