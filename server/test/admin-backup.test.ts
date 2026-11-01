import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { createBackupFile } from "../src/backup.js"
import { openDb, type Db } from "../src/db.js"
import { migrate } from "../src/migrate.js"
import { recordUsage } from "../src/usage.js"
import { withTestApp, TEST_IMPORT_TOKEN, TEST_PASSWORD, type Client, type TestApp } from "./helpers/app.js"
import { createClock } from "./helpers/clock.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const BACKUP = "/api/admin/backup"
type T = TestApp<FakeAi>

const API_KEY = "sk-ant-api03-SECRET-KEY-VALUE-123"
const SQLITE_HEADER = "SQLite format 3\0"
/** ตารางที่ต้องอยู่ครบในสำเนา */
const TABLES = ["novels", "chapters", "glossary", "covers", "settings", "usage", "views"]

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

/**
 * ให้ `os.tmpdir()` ชี้ไปโฟลเดอร์ว่างของเทสต์นี้เอง (ตัวแปรสภาพแวดล้อมถูกอ่านใหม่ทุกครั้งที่เรียก; `node --test` แยกโปรเซสต่อไฟล์ จึงไม่กระทบเทสต์อื่น)
 * `sys` = โฟลเดอร์ชั่วคราวที่แอปเห็น (ต้องกลับมาว่างหลังส่งไฟล์เสร็จ) · `out` = ที่ให้เทสต์เก็บไฟล์ของตัวเอง
 */
async function withPrivateTmp<R>(fn: (dirs: { sys: string; out: string }) => Promise<R>): Promise<R> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-test-"))
  const sys = path.join(root, "sys")
  const out = path.join(root, "out")
  fs.mkdirSync(sys)
  fs.mkdirSync(out)
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = sys
  try {
    return await fn({ sys, out })
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: หมดเวลา")
    await new Promise((r) => setTimeout(r, 5))
  }
}

/**
 * ดาวน์โหลดแบบเก็บไบต์ดิบ (ไคลเอนต์ทดสอบถอดเป็นข้อความ ใช้กับไฟล์ฐานข้อมูลไม่ได้)
 * `identity` = ขอไม่บีบอัด (เซิร์ฟเวอร์บีบ gzip ให้เบราว์เซอร์ทั่วไปและจะไม่บอก Content-Length) · ไม่ระบุ = แบบเบราว์เซอร์ทั่วไป ถอดรหัสให้อัตโนมัติ
 */
async function download(t: T, c: Client, encoding?: "identity"): Promise<{ status: number; headers: Headers; body: Buffer }> {
  const cookie = [...c.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  const res = await fetch(t.base + BACKUP, { headers: { cookie, ...(encoding ? { "accept-encoding": encoding } : {}) } })
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
}

const filenameOf = (headers: Headers): string | undefined => /filename="([^"]+)"/.exec(headers.get("content-disposition") ?? "")?.[1]

const dump = (db: Db, table: string): unknown[] => db.all(`SELECT * FROM ${table} ORDER BY 1, 2`)

/** จดว่าแอปสั่งสำรองลงไฟล์ไหนบ้าง (ยังสำรองจริงตามปกติ) */
function recordBackupTargets(t: T): string[] {
  const targets: string[] = []
  const original = t.db.backupTo.bind(t.db)
  t.db.backupTo = (file) => {
    targets.push(file)
    original(file)
  }
  return targets
}

/** ข้อมูลหลายตารางพร้อมปกนิยาย (ไบต์ที่ไม่ใช่ข้อความ) ไว้ตรวจว่าสำเนาครบ */
function seedEverything(t: T): { novelId: number } {
  const a = seedNovel(t.db, { title: "Alpha", titleTh: "อัลฟา", published: true })
  seedNovel(t.db, { title: "Beta" })
  seedChapter(t.db, a, 1, { status: "done", translation: "คำแปลบทที่หนึ่ง", published: true })
  seedChapter(t.db, a, 2, { status: "queued", queueSeq: 1 })
  seedGlossary(t.db, a, [{ source: "Aria", thai: "อาเรีย", note: "นางเอก", auto: true }])
  t.settings.update({ siteName: "ชื่อในไฟล์สำรอง", accent: "teal" })
  recordUsage(t.db, "2026-10-22", "claude-sonnet-5-5", { inputTokens: 5, outputTokens: 6 })
  t.db.run("INSERT INTO views (day, novel_id, count) VALUES (?, ?, ?)", "2026-10-22", a, 9)
  t.db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, ?, ?, ?)", a, "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01]), "2026-10-22 00:00:00")
  return { novelId: a }
}

// ═════════════════════════ GET /backup ═════════════════════════

test("GET /backup ต้องล็อกอิน: ไม่มี cookie → 401 ไม่ส่งไฟล์ ไม่สร้างไฟล์หรือโฟลเดอร์ชั่วคราวเลย", async () => {
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({}, async (t) => {
      seedEverything(t)
      const r = await t.client().get(BACKUP)
      assert.equal(r.status, 401)
      assert.equal(r.json.code, "unauthorized")
      assert.match(r.json.error, THAI)
      assert.equal(r.headers.get("content-disposition"), null)
      assert.doesNotMatch(r.text, /Alpha|SQLite/)
      assert.deepEqual(fs.readdirSync(sys), [])
    })
  })
})

test("GET /backup: ดาวน์โหลดไฟล์ SQLite ชื่อ koymukarnnovel-YYYYMMDD-HHMM.db ที่เปิดอ่านได้ ข้อมูลทุกตารางครบเท่าของจริง และไม่เปลี่ยนข้อมูลจริง", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withPrivateTmp(async ({ sys, out }) => {
    await withTestApp({ now: clock.now }, async (t) => {
      seedEverything(t)
      const live = TABLES.map((table) => dump(t.db, table))
      const targets = recordBackupTargets(t)
      const c = await adminClient(t)

      const res = await download(t, c, "identity")
      assert.equal(res.status, 200)
      assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="koymukarnnovel-\d{8}-\d{4}\.db"$/)
      assert.equal(filenameOf(res.headers), "koymukarnnovel-20261022-0802.db") // 01:02 UTC = 08:02 เวลาไทย
      assert.equal(res.headers.get("content-type"), "application/octet-stream")
      assert.equal(res.headers.get("cache-control"), "no-store")
      assert.equal(res.headers.get("last-modified"), null)
      assert.equal(Number(res.headers.get("content-length")), res.body.length)
      assert.equal(res.body.subarray(0, 16).toString("latin1"), SQLITE_HEADER)

      const copyPath = path.join(out, filenameOf(res.headers) as string)
      fs.writeFileSync(copyPath, res.body)
      const copy = openDb(copyPath)
      try {
        assert.equal(copy.get<{ integrity_check: string }>("PRAGMA integrity_check")?.integrity_check, "ok")
        assert.equal(copy.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")?.n, 2)
        assert.equal(copy.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")?.n, t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")?.n)
        TABLES.forEach((table, i) => assert.deepEqual(dump(copy, table), live[i], table))
        assert.deepEqual(copy.all("SELECT type, name FROM sqlite_master ORDER BY type, name"), t.db.all("SELECT type, name FROM sqlite_master ORDER BY type, name"))
        assert.equal(copy.get<{ user_version: number }>("PRAGMA user_version")?.user_version, t.db.get<{ user_version: number }>("PRAGMA user_version")?.user_version)
        assert.equal(copy.get<{ value: string }>("SELECT value FROM settings WHERE key = 'siteName'")?.value, "ชื่อในไฟล์สำรอง")
      } finally {
        copy.close()
      }

      // การสำรองอ่านอย่างเดียว: ข้อมูลจริงเหมือนเดิมทุกตาราง
      TABLES.forEach((table, i) => assert.deepEqual(dump(t.db, table), live[i], `${table} ต้องไม่เปลี่ยน`))

      // สำรองลงโฟลเดอร์ชั่วคราวของคำขอนี้ใต้ os.tmpdir() แล้วลบทิ้งหลังส่ง (ส่งเสร็จฝั่งไคลเอนต์ก่อนฝั่งเซิร์ฟเวอร์เก็บกวาด จึงรอสักครู่)
      assert.equal(targets.length, 1)
      const target = targets[0] as string
      const requestDir = path.dirname(target)
      assert.equal(path.dirname(requestDir), sys)
      assert.match(path.basename(requestDir), /^koymukarnnovel-backup-/)
      assert.equal(path.basename(target), "koymukarnnovel-20261022-0802.db")
      await until(() => !fs.existsSync(requestDir))
      assert.deepEqual(fs.readdirSync(sys), [])
    })
  })
})

test("GET /backup: ชื่อไฟล์ตามเวลา ณ ตอนที่กดดาวน์โหลด (UTC+7 ข้ามวันได้)", async () => {
  const clock = createClock("2026-10-22T16:59:00Z")
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({ now: clock.now }, async (t) => {
      const c = await adminClient(t)
      assert.equal(filenameOf((await download(t, c)).headers), "koymukarnnovel-20261022-2359.db")
      clock.advance(60_000) // 17:00 UTC = 00:00 วันถัดไปในไทย
      assert.equal(filenameOf((await download(t, c)).headers), "koymukarnnovel-20261023-0000.db")
      await until(() => fs.readdirSync(sys).length === 0)
    })
  })
})

test("GET /backup: ไฟล์สำรองไม่มีความลับของระบบ (รหัสผ่านผู้ดูแล, ANTHROPIC_API_KEY, IMPORT_TOKEN) แม้ผู้ดูแลเพิ่งทดสอบ API และตั้งค่าครบ", async () => {
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({ config: { anthropicApiKey: API_KEY } }, async (t) => {
      seedEverything(t)
      const c = await adminClient(t)
      assert.equal((await c.post("/api/admin/settings/test-api")).json.ok, true)
      const res = await download(t, c)
      assert.equal(res.status, 200)
      for (const secret of [API_KEY, TEST_PASSWORD, TEST_IMPORT_TOKEN]) assert.ok(!res.body.includes(secret), `ไฟล์สำรองมี ${secret.slice(0, 8)}…`)
      await until(() => fs.readdirSync(sys).length === 0)
    })
  })
})

test("GET /backup พร้อมกันหลายคำขอ (แม้ชื่อไฟล์ซ้ำกันในนาทีเดียวกัน): ทุกคำขอได้ไฟล์ที่สมบูรณ์ และเก็บกวาดไฟล์ชั่วคราวครบทุกอัน", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withPrivateTmp(async ({ sys, out }) => {
    await withTestApp({ now: clock.now }, async (t) => {
      seedEverything(t)
      const c = await adminClient(t)
      const results = await Promise.all([download(t, c), download(t, c), download(t, c)])
      for (const [i, res] of results.entries()) {
        assert.equal(res.status, 200, `คำขอที่ ${i}`)
        assert.equal(filenameOf(res.headers), "koymukarnnovel-20261022-0802.db")
        const copyPath = path.join(out, `copy-${i}.db`)
        fs.writeFileSync(copyPath, res.body)
        const copy = openDb(copyPath)
        try {
          assert.equal(copy.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")?.n, 2, `คำขอที่ ${i}`)
        } finally {
          copy.close()
        }
      }
      await until(() => fs.readdirSync(sys).length === 0)
    })
  })
})

test("GET /backup ถ้าสำรองไม่สำเร็จ → 500 ข้อความทั่วไป (ไม่รั่วสาเหตุ) บันทึก error ไว้ใน log และไม่ทิ้งโฟลเดอร์ชั่วคราว", async () => {
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({ expectErrorLogs: true }, async (t) => {
      t.db.backupTo = () => {
        throw new Error("disk full secret-detail")
      }
      const r = await (await adminClient(t)).get(BACKUP)
      assert.equal(r.status, 500)
      assert.equal(r.json.code, "internal_error")
      assert.match(r.json.error, THAI)
      assert.doesNotMatch(r.text, /disk full|secret-detail/)
      assert.equal(r.headers.get("content-disposition"), null)
      const errors = t.logs.filter((line) => line.startsWith("error:"))
      assert.equal(errors.length, 1)
      assert.match(errors[0] as string, /disk full secret-detail/)
      assert.deepEqual(fs.readdirSync(sys), [], "เก็บกวาดเสร็จก่อนตอบ")
    })
  })
})

test("GET /backup ถ้าสำรองแล้วไม่มีไฟล์ให้ส่ง → 500 ข้อความทั่วไป บันทึก error ไว้ใน log และเก็บกวาดโฟลเดอร์ชั่วคราว", async () => {
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({ expectErrorLogs: true }, async (t) => {
      t.db.backupTo = () => undefined // อ้างว่าสำเร็จแต่ไม่ได้สร้างไฟล์
      const r = await (await adminClient(t)).get(BACKUP)
      assert.equal(r.status, 500)
      assert.equal(r.json.code, "internal_error")
      assert.match(r.json.error, THAI)
      assert.equal(r.headers.get("content-disposition"), null)
      const errors = t.logs.filter((line) => line.startsWith("error:"))
      assert.equal(errors.length, 1)
      assert.match(errors[0] as string, /ส่งไฟล์สำรองไม่สำเร็จ/)
      await until(() => fs.readdirSync(sys).length === 0)
    })
  })
})

test("GET /backup ที่ผู้ใช้ปิดหน้าต่างกลางทาง: ลบไฟล์ชั่วคราวทิ้งอยู่ดี และไม่นับเป็นข้อผิดพลาดของระบบ (ไม่มี warn/error ใน log)", async () => {
  await withPrivateTmp(async ({ sys }) => {
    await withTestApp({}, async (t) => {
      // ฐานข้อมูลใหญ่พอจะเกินบัฟเฟอร์ของซ็อกเก็ต ผู้ใช้เลิกรับก่อนส่งจบ (สุ่มไบต์ไว้ไม่ให้บีบอัดเล็กลงได้)
      seedChapter(t.db, seedNovel(t.db), 1, { source: randomBytes(24 * 1024 * 1024).toString("base64") })
      const c = await adminClient(t)
      const cookie = [...c.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
      const res = await fetch(t.base + BACKUP, { headers: { cookie, "accept-encoding": "identity" } })
      assert.equal(res.status, 200)
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      assert.ok(((await reader.read()).value?.length ?? 0) > 0)
      assert.equal(fs.readdirSync(sys).length, 1, "กำลังส่งอยู่ ไฟล์ชั่วคราวยังต้องอยู่")
      await reader.cancel() // เลิกรับกลางทาง = ผู้ใช้ปิดหน้าต่าง/ยกเลิกดาวน์โหลด
      await until(() => fs.readdirSync(sys).length === 0, 10_000)
      assert.deepEqual(t.logs.filter((line) => /^(warn|error):/.test(line)), [])
    })
  })
})

// ═════════════════════════ createBackupFile ═════════════════════════

function seededDb(): Db {
  const db = openDb(":memory:")
  migrate(db)
  const n = seedNovel(db, { title: "Alpha" })
  seedChapter(db, n, 1, { status: "done", translation: "แปลแล้ว" })
  return db
}

const countNovels = (db: Db): number | undefined => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")?.n

test("createBackupFile: ชื่อไฟล์ koymukarnnovel-YYYYMMDD-HHMM.db ตามเวลา UTC+7 วางในโฟลเดอร์ที่ให้ (สร้างโฟลเดอร์ซ้อนให้ถ้ายังไม่มี) และเปิดอ่านข้อมูลเดิมได้", async () => {
  await withPrivateTmp(async ({ out }) => {
    const db = seededDb()
    try {
      const dir = path.join(out, "nested", "backups")
      const cases: [string, string][] = [
        ["2026-10-22T01:02:03Z", "koymukarnnovel-20261022-0802.db"],
        ["2026-10-22T16:59:59Z", "koymukarnnovel-20261022-2359.db"],
        ["2026-10-22T17:00:00Z", "koymukarnnovel-20261023-0000.db"], // เที่ยงคืนไทย = วันใหม่
        ["2026-12-31T20:00:00Z", "koymukarnnovel-20270101-0300.db"], // ข้ามปี
        ["2026-01-05T00:05:00Z", "koymukarnnovel-20260105-0705.db"], // เติมศูนย์หน้าเลขหลักเดียว
        ["2026-03-09T02:03:00Z", "koymukarnnovel-20260309-0903.db"],
      ]
      for (const [iso, filename] of cases) {
        const r = await createBackupFile(db, dir, new Date(iso))
        assert.deepEqual(r, { path: path.join(dir, filename), filename }, iso)
        assert.match(r.filename, /^koymukarnnovel-\d{8}-\d{4}\.db$/)
        assert.equal(fs.readFileSync(r.path).subarray(0, 16).toString("latin1"), SQLITE_HEADER)
      }
      assert.deepEqual(fs.readdirSync(dir).sort(), cases.map(([, filename]) => filename).sort())

      const copy = openDb(path.join(dir, "koymukarnnovel-20261022-0802.db"))
      try {
        assert.equal(countNovels(copy), 1)
        assert.deepEqual(dump(copy, "chapters"), dump(db, "chapters"))
      } finally {
        copy.close()
      }
    } finally {
      db.close()
    }
  })
})

test("createBackupFile ไม่ทับไฟล์ที่มีอยู่แล้ว: ล้มเหลวและไฟล์เดิมไม่เปลี่ยน (สำเนาก่อนหน้าไม่หายเพราะกดซ้ำในนาทีเดียวกัน)", async () => {
  await withPrivateTmp(async ({ out }) => {
    const db = seededDb()
    try {
      const now = new Date("2026-10-22T01:02:03Z")
      const first = await createBackupFile(db, out, now)
      const original = fs.readFileSync(first.path)
      seedNovel(db, { title: "Gamma" })
      await assert.rejects(createBackupFile(db, out, now), /exist/i)
      assert.deepEqual(fs.readFileSync(first.path), original)
      assert.deepEqual(fs.readdirSync(out), [first.filename])
    } finally {
      db.close()
    }
  })
})

test("createBackupFile ส่งต่อข้อผิดพลาดของการสำรอง (ไม่กลืน)", async () => {
  await withPrivateTmp(async ({ out }) => {
    const db = seededDb()
    try {
      db.backupTo = () => {
        throw new Error("backup-broke")
      }
      await assert.rejects(createBackupFile(db, out, new Date("2026-10-22T01:02:03Z")), /backup-broke/)
    } finally {
      db.close()
    }
  })
})

test("createBackupFile กับฐานข้อมูลไฟล์จริงโหมด WAL: ข้อมูลที่ยังอยู่ในไฟล์ -wal ก็ติดมาในสำเนา และสำเนาเปิดได้โดยลำพัง", async () => {
  await withPrivateTmp(async ({ out }) => {
    const livePath = path.join(out, "live", "novel.db")
    const live = openDb(livePath)
    try {
      migrate(live)
      for (const title of ["A", "B", "C"]) seedNovel(live, { title })
      assert.ok(fs.statSync(`${livePath}-wal`).size > 0, "ข้อมูลยังไม่ถูก checkpoint เข้าไฟล์หลัก")

      const { path: backupPath } = await createBackupFile(live, path.join(out, "backups"), new Date("2026-10-22T01:02:03Z"))
      const lone = path.join(out, "lone", "restored.db") // ย้ายไปที่ใหม่ ไม่มีไฟล์ -wal ติดไป
      fs.mkdirSync(path.dirname(lone))
      fs.copyFileSync(backupPath, lone)
      const copy = openDb(lone)
      try {
        assert.equal(countNovels(copy), 3)
        assert.deepEqual(dump(copy, "novels"), dump(live, "novels"))
      } finally {
        copy.close()
      }
    } finally {
      live.close()
    }
  })
})
