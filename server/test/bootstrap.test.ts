import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { mock, test } from "node:test"
import type { Ai } from "../src/ai.js"
import {
  describeStartupFailure,
  explainListenError,
  installShutdown,
  listenUrl,
  prepareDb,
  startServer,
  StartupError,
  type RunningServer,
} from "../src/bootstrap.js"
import { ConfigError } from "../src/config.js"
import { openDb } from "../src/db.js"
import { migrate, SCHEMA_VERSION } from "../src/migrate.js"
import { DEMO_TITLE, runSeed, seedDemo } from "../src/seed.js"
import type { ChapterRow, NovelRow } from "../src/types.js"
import { memoryLogger } from "../src/util/log.js"
import { createLegacyDb } from "./fixtures/legacy.js"
import { withTestApp } from "./helpers/app.js"
import { CONFIG_KEYS, SERVER_DIR, dbFileOf, envFor, waitUntil, withDbFile, withDir, within } from "./helpers/boot.js"
import { createFakeAi } from "./helpers/fake-ai.js"
import { seedChapter, seedNovel } from "./helpers/seed.js"

const NOW = "2026-10-23 08:00:00"
const HAS_IPV6 = Object.values(os.networkInterfaces()).some((list) => list?.some((i) => i.address === "::1"))
const userVersion = (db: { get<T>(sql: string): T | undefined }) => db.get<{ user_version: number }>("PRAGMA user_version")!.user_version
const closeNet = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()))

// ───────────────────────── ตัวช่วยของไฟล์นี้ ─────────────────────────

/** เริ่มระบบจริงในโปรเซสนี้ รัน `fn` แล้วปิดเสมอ (แม้ `fn` ล้ม จะได้ไม่ค้างพอร์ต/ตัวจับเวลา) */
async function withRunning<T>(
  env: Record<string, string>,
  o: { ai?: Ai; graceMs?: number },
  fn: (running: RunningServer, lines: string[]) => Promise<T>,
): Promise<T> {
  const { logger, lines } = memoryLogger()
  const running = await startServer(env, { log: logger, ...o })
  try {
    return await fn(running, lines)
  } finally {
    await running.close()
  }
}

/** ตัวจำลองการปิดระบบ: สัญญาณปลอม (EventEmitter), exit ปลอม, log ในหน่วยความจำ */
function shutdownHarness(o: { close?: () => Promise<void>; timeoutMs?: number } = {}) {
  const signals = new EventEmitter()
  const { logger, lines } = memoryLogger()
  const exits: number[] = []
  let closeCalls = 0
  const running = {
    close: () => {
      closeCalls++
      return (o.close ?? (() => Promise.resolve()))()
    },
  }
  const uninstall = installShutdown(running, { log: logger, signals, exit: (code) => void exits.push(code), timeoutMs: o.timeoutMs ?? 2000 })
  return { signals, lines, exits, uninstall, closeCalls: () => closeCalls }
}

// ───────────────────────── สภาพแวดล้อมของเทสต์ ─────────────────────────

test("เทสต์กัน .env จริงของเครื่อง: CONFIG_KEYS ครบทุกตัวแปรที่ config.ts อ่าน", () => {
  const source = fs.readFileSync(path.join(SERVER_DIR, "src", "config.ts"), "utf8")
  const keys = new Set([...source.matchAll(/\b(?:read|readInt)\(env, "([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]!))
  assert.deepEqual([...keys].sort(), [...CONFIG_KEYS].sort())
})

test("index.ts: import \"./env.js\" เป็นคำสั่งแรก (ค่าจาก server/.env ต้องพร้อมก่อนโมดูลอื่นถูกโหลด)", () => {
  const lines = fs.readFileSync(path.join(SERVER_DIR, "src", "index.ts"), "utf8").split("\n").map((l) => l.trim())
  const code = lines.filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"))
  assert.equal(code[0], 'import "./env.js"')
})

test("seed.ts: โหลด server/.env เฉพาะตอนรันเป็นสคริปต์ (หลังตรวจว่าเป็น main และก่อนอ่าน config) ไม่โหลดตอนถูก import", () => {
  const source = fs.readFileSync(path.join(SERVER_DIR, "src", "seed.ts"), "utf8")
  const guard = source.indexOf("if (isMainModule(import.meta.url))")
  const load = source.indexOf('await import("./env.js")')
  const run = source.indexOf("runSeed(process.env")
  assert.ok(guard !== -1 && guard < load && load < run, `${guard} ${load} ${run}`)
  assert.ok(!/^import\s+["']\.\/env\.js["']/m.test(source), "ห้าม import env.js แบบ static (จะโหลด .env ของเครื่องเข้าโปรเซสทดสอบด้วย)")
})

// ───────────────────────── prepareDb ─────────────────────────

test("prepareDb: ฐานข้อมูลใหม่ — สร้างโฟลเดอร์แม่และไฟล์ ตั้งโครงล่าสุด และไม่มี log", async () => {
  await withDir((dir) => {
    const file = path.join(dir, "deep", "data", "x.db")
    const { logger, lines } = memoryLogger()
    const { db, migratedPrototype } = prepareDb(file, logger)
    try {
      assert.equal(migratedPrototype, false)
      assert.equal(userVersion(db), SCHEMA_VERSION)
      assert.ok(fs.existsSync(file))
      assert.deepEqual(lines, [])
    } finally {
      db.close()
    }
  })
})

test("prepareDb: เจอ novel-teller.db แบบ prototype → เปลี่ยนชื่อ แปลงโครง ซ่อนทุกเรื่อง และบอกเจ้าของ", async () => {
  await withDir((dir) => {
    const legacy = path.join(dir, "novel-teller.db")
    const target = path.join(dir, "koymukarnnovel.db")
    const old = openDb(legacy)
    createLegacyDb(old)
    old.close()

    const { logger, lines } = memoryLogger()
    const { db, migratedPrototype } = prepareDb(target, logger)
    try {
      assert.equal(migratedPrototype, true)
      assert.equal(fs.existsSync(legacy), false)
      assert.ok(fs.existsSync(target))
      assert.deepEqual(db.all("SELECT published FROM novels"), [{ published: 0 }, { published: 0 }, { published: 0 }])
      assert.equal(db.get<{ translation: string }>("SELECT translation FROM chapters WHERE id = 1")?.translation, "แปลตอน 1")
      assert.ok(lines.some((l) => l.startsWith("info: ") && l.includes("ย้ายฐานข้อมูลเดิม")), lines.join("\n"))
      assert.ok(lines.some((l) => l.startsWith("info: ") && l.includes("ยังไม่เผยแพร่")), lines.join("\n"))
    } finally {
      db.close()
    }
  })
})

for (const code of ["EBUSY", "EPERM", "EACCES"]) {
  test(`prepareDb: Windows ย้ายไฟล์เดิมไม่ได้ (${code}) → StartupError แนะนำให้ปิดโปรแกรมเวอร์ชันเก่า ไม่แตะไฟล์ใดๆ`, async () => {
    await withDir((dir) => {
      const legacy = path.join(dir, "novel-teller.db")
      const target = path.join(dir, "koymukarnnovel.db")
      fs.writeFileSync(legacy, "legacy-bytes")
      // ข้อความของ error ตั้งใจไม่มีรหัสอยู่ข้างใน: รหัส `(${code})` ที่เห็นต้องมาจากที่ prepareDb ใส่เอง
      const rename = mock.method(fs, "renameSync", () => {
        throw Object.assign(new Error(`resource busy or locked, rename '${legacy}'`), { code })
      })
      try {
        assert.throws(
          () => prepareDb(target, memoryLogger().logger),
          (e: unknown) => {
            assert.ok(e instanceof StartupError, String(e))
            assert.match(e.message, /ปิดโปรแกรมเวอร์ชันเก่าที่ยังเปิดอยู่แล้วลองใหม่/)
            assert.ok(e.message.includes(`(${code}): resource busy or locked`), e.message)
            assert.ok(e.message.includes("koymukarnnovel.db"), e.message)
            return true
          },
        )
        assert.equal(rename.mock.callCount(), 1)
      } finally {
        rename.mock.restore()
      }
      assert.equal(fs.readFileSync(legacy, "utf8"), "legacy-bytes")
      assert.equal(fs.existsSync(target), false)
    })
  })
}

test("prepareDb: ย้ายไฟล์เดิมไม่ได้เพราะสาเหตุอื่น → StartupError บอกรหัสและข้อความจริง แต่ไม่แนะนำให้ปิดโปรแกรมเก่า", async () => {
  await withDir((dir) => {
    fs.writeFileSync(path.join(dir, "novel-teller.db"), "legacy-bytes")
    const rename = mock.method(fs, "renameSync", () => {
      throw Object.assign(new Error("i/o error, rename"), { code: "EIO" })
    })
    try {
      assert.throws(
        () => prepareDb(path.join(dir, "koymukarnnovel.db"), memoryLogger().logger),
        (e: unknown) => {
          assert.ok(e instanceof StartupError, String(e))
          assert.ok(e.message.includes("(EIO): i/o error, rename"), e.message)
          assert.ok(!e.message.includes("ปิดโปรแกรมเวอร์ชันเก่า"), e.message)
          return true
        },
      )
    } finally {
      rename.mock.restore()
    }
  })
})

test("prepareDb: ฐานข้อมูลใหม่กว่าโปรแกรม → StartupError ข้อความไทยบอกไฟล์ และปิดไฟล์ไม่ค้าง (ไม่เหลือ -wal/-shm)", async () => {
  await withDir((dir) => {
    const file = path.join(dir, "x.db")
    const future = openDb(file)
    future.exec("PRAGMA user_version = 99")
    future.close()
    assert.throws(
      () => prepareDb(file, memoryLogger().logger),
      (e: unknown) => {
        assert.ok(e instanceof StartupError, String(e))
        assert.ok(e.message.includes(file), e.message)
        assert.match(e.message, /เวอร์ชัน 99/)
        return true
      },
    )
    assert.equal(fs.existsSync(file + "-wal"), false)
    assert.equal(fs.existsSync(file + "-shm"), false)
  })
})

test("prepareDb: ไฟล์ที่ไม่ใช่ฐานข้อมูล → StartupError บอกไฟล์ ไม่แตะเนื้อไฟล์", async () => {
  await withDir((dir) => {
    const file = path.join(dir, "x.db")
    fs.writeFileSync(file, "this is not a sqlite database, just text that is long enough to look like one".repeat(10))
    const before = fs.readFileSync(file, "utf8")
    assert.throws(
      () => prepareDb(file, memoryLogger().logger),
      (e: unknown) => e instanceof StartupError && e.message.includes(file),
    )
    assert.equal(fs.readFileSync(file, "utf8"), before)
  })
})

// ───────────────────────── ข้อความข้อผิดพลาด ─────────────────────────

test("describeStartupFailure: ConfigError/StartupError เป็นข้อความไทยล้วน · error แปลกๆ แสดง stack · ค่าที่ไม่ใช่ Error ก็แสดงได้", () => {
  assert.equal(describeStartupFailure(new ConfigError("PORT ผิด")), "ตั้งค่าไม่ถูกต้อง: PORT ผิด")
  assert.equal(describeStartupFailure(new StartupError("พอร์ตชน")), "พอร์ตชน")
  assert.equal(new StartupError("x").name, "StartupError")
  const boom = new Error("boom")
  const text = describeStartupFailure(boom)
  assert.ok(text.startsWith("เริ่มระบบไม่สำเร็จ: "), text)
  assert.ok(text.includes(boom.stack!), text)
  assert.equal(describeStartupFailure("oops"), "เริ่มระบบไม่สำเร็จ: oops")
  assert.equal(describeStartupFailure(undefined), "เริ่มระบบไม่สำเร็จ: undefined")
})

test("explainListenError: แปลรหัสข้อผิดพลาดของ listen เป็นคำแนะนำภาษาไทยที่บอกพอร์ต/HOST", () => {
  const cfg = { host: "127.0.0.1", port: 8787 }
  const withCode = (code: string) => explainListenError(Object.assign(new Error(`listen ${code} 127.0.0.1:8787`), { code }), cfg)
  assert.ok(withCode("EADDRINUSE") instanceof StartupError)
  assert.match(withCode("EADDRINUSE").message, /พอร์ต 8787 ถูกใช้งานอยู่แล้ว.*PORT/)
  assert.match(withCode("EACCES").message, /ไม่มีสิทธิ์เปิดพอร์ต 8787.*PORT/)
  assert.match(withCode("EADDRNOTAVAIL").message, /HOST=127\.0\.0\.1 ไม่ใช่ที่อยู่ของเครื่องนี้/)
  assert.match(withCode("EMFILE").message, /เปิดพอร์ต 8787 ไม่สำเร็จ \(EMFILE\): listen EMFILE/)
  assert.match(explainListenError(new Error("เสียแบบไม่มีรหัส"), cfg).message, /เปิดพอร์ต 8787 ไม่สำเร็จ: เสียแบบไม่มีรหัส/)
  assert.match(explainListenError("weird", cfg).message, /เปิดพอร์ต 8787 ไม่สำเร็จ: weird/)
})

test("explainListenError: รหัสต้องเป็นข้อความเท่านั้นถึงจะแสดง (code เป็นตัวเลข/ค่าว่างไม่ถูกเอามาต่อ) และรับค่าที่ไม่ใช่ error ได้โดยไม่ล้ม", () => {
  const cfg = { host: "127.0.0.1", port: 8787 }
  assert.equal(explainListenError(Object.assign(new Error("เลขรหัส"), { code: 42 }), cfg).message, "เปิดพอร์ต 8787 ไม่สำเร็จ: เลขรหัส")
  assert.equal(explainListenError(Object.assign(new Error("รหัสว่าง"), { code: "" }), cfg).message, "เปิดพอร์ต 8787 ไม่สำเร็จ: รหัสว่าง")
  assert.equal(explainListenError(null, cfg).message, "เปิดพอร์ต 8787 ไม่สำเร็จ: null")
  assert.equal(explainListenError(undefined, cfg).message, "เปิดพอร์ต 8787 ไม่สำเร็จ: undefined")
})

test("listenUrl: ใส่วงเล็บให้ IPv6 และไม่ซ้ำวงเล็บที่ตั้งมาเอง", () => {
  assert.equal(listenUrl("127.0.0.1", 8787), "http://127.0.0.1:8787")
  assert.equal(listenUrl("0.0.0.0", 80), "http://0.0.0.0:80")
  assert.equal(listenUrl("localhost", 1), "http://localhost:1")
  assert.equal(listenUrl("::1", 8787), "http://[::1]:8787")
  assert.equal(listenUrl("[::1]", 8787), "http://[::1]:8787")
})

// ───────────────────────── startServer ─────────────────────────

test("startServer: เปิดระบบครบทั้งตัวในโปรเซสนี้ — /healthz ตอบ ok, log บอก URL ของพอร์ตจริง, ปิดแล้วพอร์ตว่างและฐานข้อมูลปิดสะอาด", async () => {
  await withDir(async (dir) => {
    const { logger, lines } = memoryLogger()
    const running = await startServer(envFor(dir), { log: logger })
    try {
      assert.ok(running.port > 0)
      assert.equal(running.url, `http://127.0.0.1:${running.port}`)
      const health = await fetch(`${running.url}/healthz`)
      assert.equal(health.status, 200)
      assert.equal(await health.text(), "ok")
      const site = (await (await fetch(`${running.url}/api/public/site`)).json()) as { siteName: string }
      assert.equal(site.siteName, "koymukarnnovel")
      assert.deepEqual(lines.filter((l) => l.includes("listening on")), [`info: listening on ${running.url}`])
      assert.ok(lines.includes(`info: ฐานข้อมูล: ${dbFileOf(dir)}`), lines.join("\n"))
      assert.equal(userVersion(running.db), SCHEMA_VERSION)
      assert.ok(fs.existsSync(dbFileOf(dir)))
      assert.equal(running.config.dbPath, dbFileOf(dir))
    } finally {
      await running.close()
    }
    await assert.rejects(fetch(`${running.url}/healthz`)) // พอร์ตปิดแล้ว
    assert.equal(fs.existsSync(dbFileOf(dir) + "-wal"), false) // ปิดฐานข้อมูลสะอาด: WAL ถูกรวมกลับและลบ
    await running.close() // เรียกซ้ำได้ ไม่ error
    assert.deepEqual(lines.filter((l) => l.startsWith("error:")), [])
  })
})

test("startServer: เปิดที่ HOST=[::1] ได้ (ตัดวงเล็บก่อน listen) และ URL ใน log มีวงเล็บ", { skip: !HAS_IPV6 && "เครื่องนี้ไม่มี IPv6 loopback" }, async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir, { HOST: "[::1]" }), {}, async (running) => {
      assert.equal(running.url, `http://[::1]:${running.port}`)
      assert.equal((await fetch(`${running.url}/healthz`)).status, 200)
    })
  })
})

test("startServer: HOST ที่ครอบด้วย [ ] ก็เปิดได้ (ตัดวงเล็บก่อน listen) — ทดสอบด้วย IPv4 เพื่อให้ได้ผลเหมือนกันทุกเครื่อง", async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir, { HOST: "[127.0.0.1]" }), {}, async (running) => {
      assert.equal(running.url, `http://127.0.0.1:${running.port}`)
      assert.equal((await fetch(`${running.url}/healthz`)).status, 200)
    })
  })
})

test("startServer: เตือนจาก config ออกเป็น warn (ไม่มีรหัสผ่านบนเครื่องนี้)", async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir), {}, async (_running, lines) => {
      assert.ok(lines.some((l) => l.startsWith("warn: ") && l.includes("ADMIN_PASSWORD")), lines.join("\n"))
    })
  })
})

test("startServer: ส่ง config เข้าแอปจริง — ตั้ง ADMIN_PASSWORD แล้วหลังบ้านต้องล็อกอิน (401), ไม่ตั้ง (เครื่องนี้เท่านั้น) เปิดได้", async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir, { ADMIN_PASSWORD: "correct-horse-battery" }), {}, async (running) => {
      assert.equal((await fetch(`${running.url}/api/admin/novels`)).status, 401)
    })
  })
  await withDir(async (dir) => {
    await withRunning(envFor(dir), {}, async (running) => {
      const res = await fetch(`${running.url}/api/admin/novels`)
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), [])
    })
  })
})

test("startServer: ช่องทางนำเข้าเปิดเมื่อมี IMPORT_TOKEN ยาวพอเท่านั้น", async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir, { IMPORT_TOKEN: "import-token-0123456789-abcdef-xyz" }), {}, async (running) => {
      assert.equal((await fetch(`${running.url}/api/import/novels`)).status, 401) // มีช่องทางแต่ไม่มีโทเคน
    })
  })
  await withDir(async (dir) => {
    await withRunning(envFor(dir), {}, async (running) => {
      assert.equal((await fetch(`${running.url}/api/import/novels`)).status, 404) // ไม่เปิดช่องทาง
    })
  })
})

test("startServer: ส่ง API key เข้า AI ตามที่ตั้ง (ไม่มี → ไม่มี key) โดยไม่เรียกเครือข่ายตอนเริ่ม", async () => {
  await withDir(async (dir) => {
    await withRunning(envFor(dir), {}, async (running) => assert.equal(running.ai.hasKey(), false))
  })
  await withDir(async (dir) => {
    await withRunning(envFor(dir, { ANTHROPIC_API_KEY: "fake-api-key-for-tests-9f8e7d6c" }), {}, async (running) => {
      assert.equal(running.ai.hasKey(), true)
    })
  })
})

test("startServer: ไม่เขียนความลับลง log แม้ตัวอักษรเดียว แต่สรุปว่าตั้งอะไรไว้บ้าง", async () => {
  const secrets = {
    ADMIN_PASSWORD: "hunter2-hunter2-HUNTER2",
    IMPORT_TOKEN: "import-token-0123456789-abcdef-xyz",
    ANTHROPIC_API_KEY: "fake-api-key-for-tests-9f8e7d6c",
    SESSION_SECRET: "session-secret-for-tests-a1b2c3d4",
  }
  await withDir(async (dir) => {
    await withRunning(envFor(dir, secrets), {}, async (_running, lines) => {
      const all = lines.join("\n")
      for (const [key, value] of Object.entries(secrets)) assert.ok(!all.includes(value), `${key} รั่วลง log`)
      const summary = lines.find((l) => l.startsWith("info: ตั้งค่า:"))
      assert.ok(summary, all)
      assert.match(summary, /หลังบ้าน=ต้องล็อกอิน/)
      assert.match(summary, /ช่องทางนำเข้า=เปิด/)
      assert.match(summary, /Claude API key=มี/)
      assert.match(summary, /โมเดลแปล=claude-sonnet-5-5/)
    })
  })
  await withDir(async (dir) => {
    await withRunning(envFor(dir), {}, async (_running, lines) => {
      const summary = lines.find((l) => l.startsWith("info: ตั้งค่า:"))
      assert.ok(summary, lines.join("\n"))
      assert.match(summary, /หลังบ้าน=ไม่ต้องล็อกอิน/)
      assert.match(summary, /ช่องทางนำเข้า=ปิด/)
      assert.match(summary, /Claude API key=ไม่มี/)
    })
  })
})

test("startServer: ตอนที่ค้าง translating จากโปรเซสที่ดับกลางคัน กลับเป็น queued ด้วยเวลาปัจจุบัน (คิวที่หยุดไว้จึงไม่หยิบไปแปลต่อทันที)", async () => {
  await withDir(async (dir) => {
    const id = withDbFile(dbFileOf(dir), (db) => {
      db.run("INSERT INTO settings (key, value) VALUES ('queue_paused_reason', 'ทดสอบ')")
      return seedChapter(db, seedNovel(db, { published: true }), 1, { status: "translating", queueSeq: 1 })
    })
    await withRunning(envFor(dir), {}, async (running, lines) => {
      const row = running.db.get<{ status: string; updated_at: string }>("SELECT status, updated_at FROM chapters WHERE id = ?", id)!
      assert.equal(row.status, "queued")
      const age = Date.now() - Date.parse(`${row.updated_at.replace(" ", "T")}Z`)
      assert.ok(age >= -1000 && age < 60_000, `updated_at ไม่ใช่เวลาปัจจุบัน: ${row.updated_at}`)
      assert.ok(lines.some((l) => l.includes("กลับเข้าคิว")), lines.join("\n"))
    })
  })
})

test("startServer: คิวเริ่มทำงานหลังเปิดพอร์ต — มีตอนรอคิวแต่ไม่มี API key → คิวหยุดพร้อมเหตุผล ตอนยังรออยู่", async () => {
  await withDir(async (dir) => {
    const id = withDbFile(dbFileOf(dir), (db) => seedChapter(db, seedNovel(db, { published: true }), 1, { status: "queued", queueSeq: 1 }))
    await withRunning(envFor(dir), {}, async (running) => {
      await waitUntil(() => running.queue.state().paused, 5000, "คิวหยุดเพราะไม่มี key")
      assert.match(running.queue.state().pausedReason, /ANTHROPIC_API_KEY/)
      assert.equal(running.db.get<{ status: string }>("SELECT status FROM chapters WHERE id = ?", id)?.status, "queued")
    })
  })
})

test("startServer: พอร์ตถูกใช้อยู่ → StartupError บอกพอร์ต และไม่แตะอะไรเลย (ไม่คืนคิว ไม่เริ่มคิว) ปิดฐานข้อมูลสะอาด", async () => {
  const blocker = net.createServer()
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve))
  const port = (blocker.address() as net.AddressInfo).port
  try {
    await withDir(async (dir) => {
      const file = dbFileOf(dir)
      withDbFile(file, (db) => {
        const novel = seedNovel(db, { published: true })
        seedChapter(db, novel, 1, { status: "translating", queueSeq: 1 })
        seedChapter(db, novel, 2, { status: "queued", queueSeq: 2 })
      })
      const { logger, lines } = memoryLogger()
      await assert.rejects(startServer(envFor(dir, { PORT: String(port) }), { log: logger }), (e: unknown) => {
        assert.ok(e instanceof StartupError, String(e))
        assert.ok(e.message.includes(String(port)), e.message)
        assert.match(e.message, /ถูกใช้งานอยู่แล้ว/)
        return true
      })
      assert.equal(fs.existsSync(file + "-wal"), false) // ปิดฐานข้อมูลแล้ว
      withDbFile(file, (db) => {
        // ตอนที่ค้างอยู่ยังค้างเหมือนเดิม: อีกโปรเซสที่ถือพอร์ตอาจกำลังแปลตอนนั้นอยู่จริง และคิวไม่ได้เริ่ม (ไม่มีการหยุดเพราะไม่มี key)
        assert.deepEqual(db.all("SELECT number, status FROM chapters ORDER BY number"), [
          { number: 1, status: "translating" },
          { number: 2, status: "queued" },
        ])
        assert.equal(db.get("SELECT value FROM settings WHERE key = 'queue_paused_reason'"), undefined)
      })
      assert.ok(!lines.some((l) => l.includes("listening on")), lines.join("\n"))
    })
  } finally {
    await closeNet(blocker)
  }
})

test("startServer: HOST ที่ไม่ใช่ที่อยู่ของเครื่อง → StartupError ชี้ไปที่ HOST", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      startServer(envFor(dir, { HOST: "198.51.100.7", ADMIN_PASSWORD: "correct-horse-battery" }), { log: memoryLogger().logger }),
      (e: unknown) => e instanceof StartupError && e.message.includes("HOST=198.51.100.7"),
    )
  })
})

test("startServer: HOST เปิดสู่ภายนอกแต่ไม่มี ADMIN_PASSWORD → ConfigError ก่อนแตะดิสก์ (ไม่สร้างฐานข้อมูล)", async () => {
  await withDir(async (dir) => {
    await assert.rejects(startServer(envFor(dir, { HOST: "0.0.0.0" }), { log: memoryLogger().logger }), (e: unknown) => {
      assert.ok(e instanceof ConfigError, String(e))
      assert.match(e.message, /ADMIN_PASSWORD/)
      return true
    })
    assert.equal(fs.existsSync(path.join(dir, "data")), false)
  })
})

test("startServer: ล้มหลังเปิดพอร์ตไปแล้ว (นาฬิกาพัง) → ปิดพอร์ตและฐานข้อมูลคืน ไม่ค้าง", async () => {
  // หาพอร์ตว่างก่อนแล้วปล่อย เพื่อรู้ว่าหลังล้มต้องตรวจพอร์ตไหน
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const port = (probe.address() as net.AddressInfo).port
  await closeNet(probe)
  await withDir(async (dir) => {
    let listeningWhenClockBroke: boolean | undefined
    const now = (): Date => {
      listeningWhenClockBroke = process.getActiveResourcesInfo().includes("TCPServerWrap")
      throw new Error("clock broke")
    }
    await assert.rejects(startServer(envFor(dir, { PORT: String(port) }), { log: memoryLogger().logger, now }), /clock broke/)
    assert.equal(listeningWhenClockBroke, true, "ต้องล้มหลังเปิดพอร์ตแล้ว ไม่งั้นเทสต์นี้ไม่ได้ทดสอบอะไร")
    assert.equal(fs.existsSync(dbFileOf(dir) + "-wal"), false)
    await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`)) // พอร์ตถูกปิดคืนแล้ว
  })
})

test("RunningServer.close: ฐานข้อมูลถูกปิดไปก่อนแล้วก็ปิดระบบต่อได้ (แค่เตือนใน log ไม่ล้ม)", async () => {
  await withDir(async (dir) => {
    const { logger, lines } = memoryLogger()
    const running = await startServer(envFor(dir), { log: logger })
    running.db.close()
    await running.close()
    assert.ok(lines.some((l) => l.startsWith("warn: ปิดฐานข้อมูลไม่สำเร็จ")), lines.join("\n"))
  })
})

test("RunningServer.close: เวลาผ่อนผันเริ่มต้นคือ 3 วินาที (คำขอที่ค้างไม่ถูกตัดก่อนหน้านั้น ถูกตัดเมื่อครบ)", async () => {
  await withDir(async (dir) => {
    const running = await startServer(envFor(dir), { log: memoryLogger().logger })
    const socket = net.connect(running.port, "127.0.0.1")
    socket.on("error", () => {})
    let socketClosed = false
    socket.once("close", () => void (socketClosed = true))
    const settle = async (rounds = 50) => {
      for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
    }
    try {
      await new Promise<void>((resolve) => socket.once("connect", () => resolve()))
      socket.write("GET /healthz HTTP/1.1\r\nHost: localhost\r\n") // หัวคำขอยังไม่จบ = คำขอที่ยังทำอยู่
      await new Promise((resolve) => setTimeout(resolve, 50))
      mock.timers.enable({ apis: ["setTimeout"] })
      const closing = running.close()
      mock.timers.tick(2999)
      await settle()
      assert.equal(socketClosed, false, "ถูกตัดก่อนครบ 3 วินาที")
      mock.timers.tick(1)
      mock.timers.reset() // ที่เหลือใช้เวลาจริง
      await within(closing, 5000, "close")
      await settle()
      assert.equal(socketClosed, true)
    } finally {
      mock.timers.reset()
      socket.destroy()
      await running.close()
    }
  })
})

test("RunningServer.close: คำขอที่ค้างครึ่งทางถูกตัดหลังช่วงผ่อนผัน (graceMs) — ไม่รอตลอดไปและไม่ตัดทิ้งทันที · เรียกซ้อนกันได้", async () => {
  await withDir(async (dir) => {
    const { logger, lines } = memoryLogger()
    const running = await startServer(envFor(dir), { log: logger, graceMs: 300 })
    const socket = net.connect(running.port, "127.0.0.1")
    socket.on("error", () => {})
    const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()))
    try {
      await new Promise<void>((resolve) => socket.once("connect", () => resolve()))
      // หัวคำขอยังไม่จบ: เซิร์ฟเวอร์ถือว่ากำลังรับคำขออยู่ (ไม่ใช่การเชื่อมต่อว่างที่ปิดได้ทันที)
      socket.write("GET /healthz HTTP/1.1\r\nHost: localhost\r\n")
      await new Promise((resolve) => setTimeout(resolve, 100))
      const started = Date.now()
      await within(Promise.all([running.close(), running.close()]), 5000, "close")
      const elapsed = Date.now() - started
      assert.ok(elapsed >= 200, `ปิดเร็วเกินไป (${elapsed} ms) แสดงว่าไม่ได้ให้เวลาผ่อนผัน`)
      // ค่าเริ่มต้นคือ 3000 ms: ถ้ายังปิดไม่เกิน 2 วินาที แปลว่า graceMs ที่ส่งเข้าไป (300) ถูกใช้จริง
      assert.ok(elapsed < 2000, `ปิดช้าเกินไป (${elapsed} ms) แสดงว่าไม่ได้ใช้ graceMs ที่ตั้ง`)
      await within(socketClosed, 2000, "ซ็อกเก็ตที่ค้างถูกตัด")
    } finally {
      socket.destroy()
      await running.close()
    }
    assert.deepEqual(lines.filter((l) => l.startsWith("error:") || l.startsWith("warn: ปิด")), [])
  })
})

test("RunningServer.close: ปิดระหว่างแปล → ยกเลิกสตรีมและคืนตอนเข้าคิวก่อนปิดฐานข้อมูล ไม่เหลือคำแปลครึ่งๆ กลางๆ ไม่มี error ใน log", async () => {
  await withDir(async (dir) => {
    const file = dbFileOf(dir)
    const id = withDbFile(file, (db) => seedChapter(db, seedNovel(db, { published: true }), 1, { status: "queued", queueSeq: 1, source: "Some text to translate." }))
    const ai = createFakeAi()
    let entered!: () => void
    const inStream = new Promise<void>((resolve) => (entered = resolve))
    ai.script.translate = () => {
      entered()
      return { pieces: ["กำลังแปล…"], delayMs: 10_000 }
    }
    const { logger, lines } = memoryLogger()
    const running = await startServer(envFor(dir), { log: logger, ai })
    try {
      await within(inStream, 5000, "คิวเริ่มแปล")
      await waitUntil(() => running.db.get<{ status: string }>("SELECT status FROM chapters WHERE id = ?", id)?.status === "translating", 5000, "สถานะ translating")
      await within(running.close(), 5000, "close")
    } finally {
      await running.close()
    }
    withDbFile(file, (db) => {
      assert.deepEqual(db.get("SELECT status, translation, error FROM chapters WHERE id = ?", id), { status: "queued", translation: "", error: "" })
    })
    assert.deepEqual(lines.filter((l) => l.startsWith("error:")), [])
  })
})

// ───────────────────────── installShutdown ─────────────────────────

test("installShutdown: รับ SIGTERM และ SIGINT เท่านั้น และถอดออกได้", () => {
  const h = shutdownHarness()
  assert.deepEqual([...h.signals.eventNames()].sort(), ["SIGINT", "SIGTERM"])
  h.uninstall()
  assert.deepEqual(h.signals.eventNames(), [])
})

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`installShutdown: ${signal} → ปิดระบบ (close) หนึ่งครั้ง แล้วออกด้วยรหัส 0 หลังปิดเสร็จเท่านั้น`, async () => {
    let release!: () => void
    const h = shutdownHarness({ close: () => new Promise<void>((resolve) => (release = resolve)) })
    h.signals.emit(signal)
    assert.equal(h.closeCalls(), 1)
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(h.exits, []) // ยังปิดไม่เสร็จ ห้ามออก
    release()
    await waitUntil(() => h.exits.length > 0)
    assert.deepEqual(h.exits, [0])
    assert.ok(h.lines.some((l) => l.startsWith("info: ") && l.includes(signal)), h.lines.join("\n"))
    assert.ok(h.lines.some((l) => l.startsWith("info: ") && l.includes("ปิดระบบเรียบร้อย")), h.lines.join("\n"))
  })
}

test("installShutdown: สัญญาณซ้ำระหว่างกำลังปิด (ไม่ว่าชนิดไหน) ไม่ปิดซ้ำและไม่ออกซ้ำ", async () => {
  let release!: () => void
  const h = shutdownHarness({ close: () => new Promise<void>((resolve) => (release = resolve)) })
  h.signals.emit("SIGINT")
  h.signals.emit("SIGINT")
  h.signals.emit("SIGTERM")
  assert.equal(h.closeCalls(), 1)
  assert.equal(h.lines.filter((l) => l.includes("กำลังปิดอยู่แล้ว")).length, 2)
  release()
  await waitUntil(() => h.exits.length > 0)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(h.exits, [0])
})

test("installShutdown: ปิดไม่สำเร็จ (close ล้ม) → ออกด้วยรหัส 1 พร้อม error ใน log", async () => {
  const h = shutdownHarness({ close: () => Promise.reject(new Error("ดิสก์เต็ม")) })
  h.signals.emit("SIGTERM")
  await waitUntil(() => h.exits.length > 0)
  assert.deepEqual(h.exits, [1])
  assert.ok(h.lines.some((l) => l.startsWith("error: ") && l.includes("ดิสก์เต็ม")), h.lines.join("\n"))
})

test("installShutdown: ปิดไม่ทันกำหนด → บังคับออกด้วยรหัส 1 (ไม่รอตลอดไป)", async () => {
  const h = shutdownHarness({ close: () => new Promise<void>(() => {}), timeoutMs: 40 })
  h.signals.emit("SIGTERM")
  await waitUntil(() => h.exits.length > 0)
  assert.deepEqual(h.exits, [1])
  assert.ok(h.lines.some((l) => l.startsWith("error: ") && l.includes("ไม่เสร็จภายใน 40")), h.lines.join("\n"))
})

test("installShutdown: ปิดเสร็จ/ล้มทีหลังที่บังคับออกไปแล้ว → ไม่ออกซ้ำและไม่บอกว่าเรียบร้อย (รหัสออกคงเป็น 1)", async () => {
  let release!: () => void
  const late = shutdownHarness({ close: () => new Promise<void>((resolve) => (release = resolve)), timeoutMs: 30 })
  late.signals.emit("SIGTERM")
  await waitUntil(() => late.exits.length > 0)
  release()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(late.exits, [1])
  assert.ok(!late.lines.some((l) => l.includes("ปิดระบบเรียบร้อย")), late.lines.join("\n"))

  let fail!: (e: Error) => void
  const lateFail = shutdownHarness({ close: () => new Promise<void>((_, reject) => (fail = reject)), timeoutMs: 30 })
  lateFail.signals.emit("SIGINT")
  await waitUntil(() => lateFail.exits.length > 0)
  fail(new Error("ล้มทีหลัง"))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(lateFail.exits, [1])
  assert.ok(!lateFail.lines.some((l) => l.includes("ล้มทีหลัง")), lateFail.lines.join("\n"))
})

test("installShutdown: เวลาบังคับออกเริ่มต้นคือ 8 วินาที (ต่ำกว่า 10 วินาทีที่ Docker รอก่อนฆ่า)", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    const signals = new EventEmitter()
    const exits: number[] = []
    installShutdown({ close: () => new Promise<void>(() => {}) }, { log: memoryLogger().logger, signals, exit: (code) => void exits.push(code) })
    signals.emit("SIGTERM")
    mock.timers.tick(7999)
    assert.deepEqual(exits, [])
    mock.timers.tick(1)
    assert.deepEqual(exits, [1])
  } finally {
    mock.timers.reset()
  }
})

test("installShutdown: ปิดทันกำหนดแล้วตัวจับเวลาถูกเลิก ไม่มีการออกซ้ำด้วยรหัส 1", async () => {
  const h = shutdownHarness({ timeoutMs: 40 })
  h.signals.emit("SIGTERM")
  await waitUntil(() => h.exits.length > 0)
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.deepEqual(h.exits, [0])
  assert.deepEqual(h.lines.filter((l) => l.startsWith("error:")), [])
})

// ───────────────────────── seedDemo / runSeed ─────────────────────────

const thaiChars = (s: string) => (s.match(/[฀-๿]/g) ?? []).length
const codePoints = (s: string) => Array.from(s).length

test("seedDemo: สร้างนิยายสมมติหนึ่งเรื่อง สามตอนเรียงเลข 1–3 มีคำแปลครบ เผยแพร่ทั้งหมด ใช้เวลาที่ให้มา", () => {
  const db = openDb(":memory:")
  migrate(db)
  assert.deepEqual(seedDemo(db, NOW), { created: true })

  const novels = db.all<NovelRow>("SELECT * FROM novels")
  assert.equal(novels.length, 1)
  const novel = novels[0]!
  assert.equal(novel.title, DEMO_TITLE)
  assert.ok(novel.title_th.includes("ตัวอย่าง"), novel.title_th) // ป้ายบอกว่าเป็นตัวอย่าง กันสับสนถ้าเผลอใช้กับเว็บจริง
  assert.match(novel.license_note, /เขียนขึ้นเอง/)
  assert.equal(novel.source_url, "")
  assert.equal(novel.mode, "translate")
  assert.equal(novel.status, "ongoing")
  assert.equal(novel.published, 1)
  assert.equal(novel.featured, 1)
  assert.ok(thaiChars(novel.synopsis) > 50 && novel.synopsis_src.length > 50)
  const tags = JSON.parse(novel.tags) as unknown
  assert.ok(Array.isArray(tags) && tags.length >= 2 && tags.every((t) => typeof t === "string" && t !== ""), novel.tags)
  assert.equal(novel.created_at, NOW)
  assert.equal(novel.updated_at, NOW)

  const chapters = db.all<ChapterRow>("SELECT * FROM chapters ORDER BY number")
  assert.deepEqual(chapters.map((c) => c.number), [1, 2, 3])
  for (const c of chapters) {
    assert.equal(c.novel_id, novel.id)
    assert.equal(c.status, "done", `ตอน ${c.number}`)
    assert.equal(c.published, 1)
    assert.equal(c.auto_publish, 0)
    assert.equal(c.error, "")
    assert.equal(c.queue_seq, null)
    assert.equal(c.published_at, NOW)
    assert.equal(c.translated_at, NOW)
    assert.equal(c.created_at, NOW)
    assert.equal(c.updated_at, NOW)
    assert.ok(thaiChars(c.translation) >= 200, `คำแปลตอน ${c.number} สั้นเกินไป`)
    assert.equal(thaiChars(c.source_text), 0, `ต้นฉบับตอน ${c.number} ต้องเป็นอังกฤษล้วน`)
    assert.ok(c.source_text.length >= 300)
    assert.ok(c.title !== "" && thaiChars(c.title_th) > 0 && thaiChars(c.recap ?? "") > 0)
  }
  db.close()
})

test("seedDemo: เรียกซ้ำไม่ซ้ำซ้อน ({created:false}) และไม่แตะเรื่องของเจ้าของ", () => {
  const db = openDb(":memory:")
  migrate(db)
  seedNovel(db, { title: "เรื่องของเจ้าของ", published: true })
  assert.deepEqual(seedDemo(db, NOW), { created: true })
  const count = (table: string) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n
  const before = { novels: count("novels"), chapters: count("chapters"), glossary: count("glossary") }
  assert.deepEqual(before, { novels: 2, chapters: 3, glossary: before.glossary })
  assert.ok(before.glossary >= 4)

  assert.deepEqual(seedDemo(db, "2027-01-01 00:00:00"), { created: false })
  assert.deepEqual({ novels: count("novels"), chapters: count("chapters"), glossary: count("glossary") }, before)
  assert.equal(db.get<{ updated_at: string }>("SELECT updated_at FROM novels WHERE title = ?", DEMO_TITLE)?.updated_at, NOW) // ครั้งที่สองไม่แก้อะไร
  db.close()
})

test("seedDemo: เนื้อหาไว้ทดสอบเลย์เอาต์ — ตอนหนึ่งมีบรรทัด *** คั่นฉาก, ชื่อตอนหนึ่งยาวเกิน 60 ตัวอักษร (ทั้งอังกฤษและไทย), มีย่อหน้ายาวมาก", () => {
  const db = openDb(":memory:")
  migrate(db)
  seedDemo(db, NOW)
  const chapters = db.all<ChapterRow>("SELECT * FROM chapters ORDER BY number")
  const breaks = chapters.filter((c) => c.translation.split("\n").some((line) => line.trim() === "***"))
  assert.equal(breaks.length, 1)
  assert.ok(breaks[0]!.source_text.split("\n").some((line) => line.trim() === "***"), "ต้นฉบับของตอนนั้นก็ควรมี *** เหมือนกัน")
  const long = chapters.filter((c) => codePoints(c.title) > 60 && codePoints(c.title_th) > 60)
  assert.equal(long.length, 1)
  const longestParagraph = Math.max(...chapters.flatMap((c) => c.translation.split(/\n+/).map((p) => codePoints(p))))
  assert.ok(longestParagraph > 180, `ย่อหน้าที่ยาวที่สุดมี ${longestParagraph} ตัวอักษร (ต้องยาวกว่า 180 ไว้ทดสอบการแบ่งประโยคตอนอ่านออกเสียง)`)
  db.close()
})

test("seedDemo: อภิธานตัวอย่างสอดคล้องกับเนื้อเรื่อง (ชื่ออังกฤษอยู่ในต้นฉบับ ชื่อไทยอยู่ในคำแปล) และเป็นของที่เจ้าของใส่เอง (auto = 0)", () => {
  const db = openDb(":memory:")
  migrate(db)
  seedDemo(db, NOW)
  const sources = db.all<ChapterRow>("SELECT * FROM chapters").map((c) => c.source_text).join("\n")
  const translations = db.all<ChapterRow>("SELECT * FROM chapters").map((c) => c.translation).join("\n")
  const rows = db.all<{ source: string; thai: string; auto: number }>("SELECT source, thai, auto FROM glossary")
  assert.ok(rows.length >= 4)
  for (const r of rows) {
    assert.ok(sources.includes(r.source), `${r.source} ไม่อยู่ในต้นฉบับ`)
    assert.ok(translations.includes(r.thai), `${r.thai} ไม่อยู่ในคำแปล`)
    assert.equal(r.auto, 0)
  }
  db.close()
})

test("seedDemo: เป็นธุรกรรมเดียว — ล้มกลางทางแล้วไม่เหลือเรื่องครึ่งๆ กลางๆ", () => {
  const db = openDb(":memory:")
  migrate(db)
  db.exec("CREATE TRIGGER boom BEFORE INSERT ON chapters WHEN NEW.number = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END")
  assert.throws(() => seedDemo(db, NOW), /boom/)
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")!.n, 0)
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chapters")!.n, 0)
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM glossary")!.n, 0)
  db.close()
})

test("seedDemo: ข้อมูลที่สร้างเปิดอ่านได้จริงผ่านหน้าบ้านสาธารณะ (เห็นเรื่อง เห็นครบสามตอน ตอนที่มี *** อ่านได้ครบ)", async () => {
  await withTestApp({}, async (app) => {
    seedDemo(app.db, NOW)
    const client = app.client()
    const list = await client.get("/api/public/novels")
    assert.equal(list.status, 200)
    assert.equal(list.json.length, 1)
    const card = list.json[0]
    assert.equal(card.title, DEMO_TITLE)
    assert.equal(card.chapterCount, 3)
    assert.equal(card.latestNumber, 3)

    const novel = await client.get(`/api/public/novels/${card.id}`)
    assert.equal(novel.status, 200)
    assert.deepEqual(novel.json.chapters.map((c: { number: number; published: boolean }) => [c.number, c.published]), [[1, true], [2, true], [3, true]])

    const second = await client.get(`/api/public/novels/${card.id}/chapters/2`)
    assert.equal(second.status, 200)
    assert.ok(second.json.chapter.text.split("\n").some((line: string) => line.trim() === "***"))
    assert.equal(second.json.prev, 1)
    assert.equal(second.json.next, 3)
  })
})

test("runSeed: ใช้ DB_PATH เดียวกับระบบ — ครั้งแรกสร้างตัวอย่าง ครั้งที่สองบอกว่ามีแล้ว คืนรหัส 0 และปิดฐานข้อมูลสะอาด", async () => {
  await withDir((dir) => {
    const env = envFor(dir)
    const first = memoryLogger()
    assert.equal(runSeed(env, first.logger), 0)
    assert.ok(first.lines.some((l) => l.startsWith("info: ") && l.includes("สร้างนิยายตัวอย่าง") && l.includes(DEMO_TITLE)), first.lines.join("\n"))
    assert.equal(fs.existsSync(dbFileOf(dir) + "-wal"), false)

    const second = memoryLogger()
    assert.equal(runSeed(env, second.logger), 0)
    assert.ok(second.lines.some((l) => l.startsWith("info: ") && l.includes("อยู่แล้ว")), second.lines.join("\n"))

    withDbFile(dbFileOf(dir), (db) => {
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")!.n, 1)
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chapters")!.n, 3)
      const createdAt = db.get<{ created_at: string }>("SELECT created_at FROM novels")!.created_at
      const age = Date.now() - Date.parse(`${createdAt.replace(" ", "T")}Z`)
      assert.ok(age >= -1000 && age < 60_000, `เวลาสร้างต้องเป็นเวลาปัจจุบัน: ${createdAt}`)
    })
  })
})

test("runSeed: config ผิด → คืนรหัส 1 พร้อมข้อความ ไม่สร้างฐานข้อมูล", async () => {
  await withDir((dir) => {
    const { logger, lines } = memoryLogger()
    assert.equal(runSeed(envFor(dir, { HOST: "0.0.0.0" }), logger), 1)
    assert.ok(lines.some((l) => l.startsWith("error: ") && l.includes("ADMIN_PASSWORD")), lines.join("\n"))
    assert.equal(fs.existsSync(path.join(dir, "data")), false)
  })
})

test("runSeed: เจอฐานข้อมูลชื่อเก่า → ย้ายมาก่อนแล้วค่อยเติมตัวอย่าง (ไม่สร้างไฟล์ใหม่เปล่าๆ ทับทางข้อมูลเดิม)", async () => {
  await withDir((dir) => {
    const legacy = path.join(dir, "data", "novel-teller.db")
    const old = openDb(legacy)
    createLegacyDb(old)
    old.close()
    const { logger } = memoryLogger()
    assert.equal(runSeed(envFor(dir), logger), 0)
    assert.equal(fs.existsSync(legacy), false)
    withDbFile(dbFileOf(dir), (db) => {
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels WHERE title = 'Legacy One'")!.n, 1)
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels WHERE title = ?", DEMO_TITLE)!.n, 1)
    })
  })
})

test("runSeed: เปิดฐานข้อมูลไม่ได้ → คืนรหัส 1 พร้อมข้อความไทย", async () => {
  await withDir((dir) => {
    fs.mkdirSync(path.join(dir, "data"), { recursive: true })
    fs.writeFileSync(dbFileOf(dir), "this is not a sqlite database".repeat(20))
    const { logger, lines } = memoryLogger()
    assert.equal(runSeed(envFor(dir), logger), 1)
    assert.ok(lines.some((l) => l.startsWith("error: ") && l.includes(dbFileOf(dir))), lines.join("\n"))
  })
})
