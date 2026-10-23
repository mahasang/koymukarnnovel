import assert from "node:assert/strict"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { describe, test } from "node:test"
import { openDb } from "../src/db.js"
import { createLegacyDb } from "./fixtures/legacy.js"
import { WINDOWS, dbFileOf, envFor, spawnNode, withDbFile, withDir, within, type Child } from "./helpers/boot.js"
import { seedChapter, seedNovel } from "./helpers/seed.js"

/**
 * ทดสอบ `src/index.ts` และ `src/seed.ts` เป็นโปรเซสจริง (node + tsx) — สิ่งที่ทดสอบในโปรเซสเดียวไม่ได้:
 * รหัสออก, สัญญาณจริง, ข้อความที่ออกทาง stdout/stderr และการไม่รัน main ตอนถูก import
 * ตรรกะของการเริ่ม/ปิดระบบอยู่ใน bootstrap.test.ts (เร็วกว่าและจำลองความผิดพลาดได้ละเอียดกว่า)
 */

const childEnv = (dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, ...envFor(dir, extra) })
const LISTENING = /listening on (http:\/\/\S+)/

/** รัน `child` แล้วฆ่าทิ้งเสมอเมื่อ `fn` จบ (กันโปรเซสกำพร้าค้างพอร์ตถ้าเทสต์ล้มกลางทาง) */
async function using<T>(child: Child, fn: (child: Child) => Promise<T>): Promise<T> {
  try {
    return await fn(child)
  } finally {
    child.kill("SIGKILL")
    await child.exited
  }
}

describe("index.ts เป็นโปรเซสจริง", { concurrency: 4 }, () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    test(`เริ่มระบบ → /healthz ตอบ ok → ${signal} ปิดเรียบร้อย exit 0 ภายใน 5 วินาที ฐานข้อมูลปิดสะอาด`, { skip: WINDOWS && "Windows ไม่มีสัญญาณ POSIX จริง (kill ฆ่าทันที) — ตรรกะปิดระบบทดสอบใน bootstrap.test.ts แล้ว" }, async () => {
      await withDir(async (dir) => {
        await using(spawnNode(["src/index.ts"], childEnv(dir)), async (child) => {
          const [, url] = await child.waitFor(LISTENING)
          const health = await fetch(`${url}/healthz`)
          assert.equal(health.status, 200)
          assert.equal(await health.text(), "ok")

          const started = Date.now()
          child.kill(signal)
          const code = await within(child.exited, 5000, `ปิดระบบหลัง ${signal}`)
          assert.equal(code, 0, `${child.out()}\n${child.err()}`)
          // ปกติปิดภายในไม่กี่สิบ ms · เข้มกว่าเกณฑ์ 5 วินาทีของแผนโดยตั้งใจ: ถ้ามีตัวจับเวลาค้างอยู่ (เช่น เวลาผ่อนผัน 3 วินาทีที่ไม่ถูกเลิก) โปรเซสจะถูกบังคับออกที่ ~2 วินาที ซึ่งยังผ่าน 5 วินาที แต่ไม่ใช่การปิดที่สะอาด
          assert.ok(Date.now() - started < 1500, `ปิดช้า ${Date.now() - started} ms`)
          assert.match(child.out(), new RegExp(`info: ได้รับ ${signal}`))
          assert.match(child.out(), /info: ปิดระบบเรียบร้อย/)
          assert.equal(fs.existsSync(dbFileOf(dir) + "-wal"), false) // db.close() ทำงาน: WAL ถูกรวมกลับและลบ
          assert.ok(fs.existsSync(dbFileOf(dir)))
        })
      })
    })
  }

  test(
    "ปิดระบบค้าง: close() ไม่มีวันเสร็จและโปรเซสไม่เหลืออะไรค้างเลย → ตัวจับเวลากันเหนียวยังทำงาน log error แล้วออกด้วยรหัส 1 (ไม่ใช่จบเงียบๆ ด้วยรหัส 0)",
    { skip: WINDOWS && "Windows ไม่มีสัญญาณ POSIX จริง — ตรรกะหมดเวลาทดสอบใน bootstrap.test.ts แล้ว" },
    async () => {
      // keepAlive ทำให้โปรเซสยังอยู่จนกว่าจะได้สัญญาณ แล้ว close() ปล่อยมันทิ้ง → ตอนนั้นเหลือแค่ตัวจับเวลาหมดเวลาของ installShutdown
      const script = `Promise.all([import('./src/bootstrap.ts'), import('./src/util/log.ts')]).then(([{ installShutdown }, { consoleLogger }]) => {
        const keepAlive = setInterval(() => {}, 1000)
        installShutdown({ close: () => { clearInterval(keepAlive); return new Promise(() => {}) } }, { log: consoleLogger(), timeoutMs: 400 })
        console.log('ready')
      })`
      await withDir(async (dir) => {
        await using(spawnNode(["-e", script], childEnv(dir)), async (child) => {
          await child.waitFor(/ready/)
          const started = Date.now()
          child.kill("SIGTERM")
          const code = await within(child.exited, 5000, "โปรเซสจบ")
          assert.equal(code, 1, `${child.out()}\n${child.err()}`)
          assert.ok(Date.now() - started >= 300, `จบเร็วเกินไป (${Date.now() - started} ms) ทั้งที่ยังไม่ถึงเวลาหมดเวลา 400 ms`)
          assert.match(child.out(), /info: ได้รับ SIGTERM/)
          assert.match(child.err(), /error: ปิดระบบไม่เสร็จภายใน 400 มิลลิวินาที จึงบังคับออก/)
          assert.doesNotMatch(child.out(), /ปิดระบบเรียบร้อย/)
        })
      })
    },
  )

  test("ตั้งค่าไม่ถูกต้อง (HOST เปิดสู่ภายนอกแต่ไม่มี ADMIN_PASSWORD) → exit 1 ข้อความมี ADMIN_PASSWORD ไม่เปิดพอร์ต ไม่สร้างฐานข้อมูล", async () => {
    await withDir(async (dir) => {
      await using(spawnNode(["src/index.ts"], childEnv(dir, { HOST: "0.0.0.0" })), async (child) => {
        const code = await within(child.exited, 20_000, "โปรเซสจบ")
        assert.equal(code, 1, `${child.out()}\n${child.err()}`)
        assert.match(child.err(), /error: ตั้งค่าไม่ถูกต้อง: HOST=0\.0\.0\.0 .*ADMIN_PASSWORD/)
        assert.doesNotMatch(child.out(), /listening/)
        assert.equal(fs.existsSync(path.join(dir, "data")), false)
      })
    })
  })

  test("พอร์ตถูกใช้อยู่ → exit 1 ข้อความไทยบอกพอร์ต ไม่ทิ้งเศษไว้ (ตอนที่ค้างอยู่ยังเหมือนเดิม)", async () => {
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      await withDir(async (dir) => {
        withDbFile(dbFileOf(dir), (db) => void seedChapter(db, seedNovel(db), 1, { status: "translating", queueSeq: 1 }))
        await using(spawnNode(["src/index.ts"], childEnv(dir, { PORT: String(port) })), async (child) => {
          const code = await within(child.exited, 20_000, "โปรเซสจบ")
          assert.equal(code, 1, `${child.out()}\n${child.err()}`)
          assert.match(child.err(), new RegExp(`error: พอร์ต ${port} ถูกใช้งานอยู่แล้ว`))
          assert.doesNotMatch(child.out(), /listening/)
        })
        withDbFile(dbFileOf(dir), (db) => {
          assert.equal(db.get<{ status: string }>("SELECT status FROM chapters")?.status, "translating")
        })
      })
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  test("เริ่มบนโฟลเดอร์ที่ยังมี novel-teller.db แบบ prototype → เปลี่ยนชื่อ แปลงโครง ข้อมูลอยู่ครบ ทุกเรื่องถูกซ่อนจากผู้อ่านจนกว่าเจ้าของจะเผยแพร่", async () => {
    await withDir(async (dir) => {
      const legacy = path.join(dir, "data", "novel-teller.db")
      const old = openDb(legacy)
      createLegacyDb(old)
      old.close()

      // ตั้งรหัสผ่านหลังบ้าน เพื่อให้คำขอที่ไม่มี cookie เป็นมุมมองของผู้อ่านจริง (ไม่ตั้ง = ทุกคนบนเครื่องนี้คือผู้ดูแล เห็นฉบับร่างด้วย)
      await using(spawnNode(["src/index.ts"], childEnv(dir, { ADMIN_PASSWORD: "correct-horse-battery" })), async (child) => {
        const [, url] = await child.waitFor(LISTENING)
        assert.equal(fs.existsSync(legacy), false)
        assert.ok(fs.existsSync(dbFileOf(dir)))
        assert.match(child.out(), /info: ย้ายฐานข้อมูลเดิม novel-teller\.db เป็น koymukarnnovel\.db แล้ว/)
        assert.match(child.out(), /info: แปลงข้อมูลจากฐานข้อมูลรุ่นต้นแบบแล้ว/)
        assert.deepEqual(await (await fetch(`${url}/api/public/novels`)).json(), []) // ผู้อ่านยังไม่เห็นอะไร
        child.kill("SIGTERM")
        assert.equal(await within(child.exited, 5000, "ปิดระบบ"), 0)
      })
      withDbFile(dbFileOf(dir), (db) => {
        assert.deepEqual(db.all("SELECT title, published FROM novels ORDER BY id"), [
          { title: "Legacy One", published: 0 },
          { title: "Legacy Two", published: 0 },
          { title: "Legacy Three", published: 0 },
        ])
        assert.equal(db.get<{ translation: string }>("SELECT translation FROM chapters WHERE id = 1")?.translation, "แปลตอน 1")
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chapters")!.n, 5)
      })
    })
  })

  test("เริ่มบนฐานข้อมูลที่มีข้อมูลเผยแพร่แล้ว → ผู้อ่านเปิดอ่านได้ทันที (และเห็นเฉพาะที่เผยแพร่)", async () => {
    await withDir(async (dir) => {
      withDbFile(dbFileOf(dir), (db) => {
        const novel = seedNovel(db, { title: "Published Novel", titleTh: "นิยายที่เผยแพร่แล้ว", published: true })
        seedChapter(db, novel, 1, { status: "done", translation: "คำแปลตอนแรก", published: true, publishedAt: "2026-10-01 00:00:00" })
        seedNovel(db, { title: "Hidden Draft", published: false })
      })
      await using(spawnNode(["src/index.ts"], childEnv(dir, { ADMIN_PASSWORD: "correct-horse-battery" })), async (child) => {
        const [, url] = await child.waitFor(LISTENING)
        const list = (await (await fetch(`${url}/api/public/novels`)).json()) as { title: string; chapterCount: number }[]
        assert.deepEqual(list.map((n) => [n.title, n.chapterCount]), [["Published Novel", 1]])
        child.kill("SIGTERM")
        assert.equal(await within(child.exited, 5000, "ปิดระบบ"), 0)
      })
    })
  })

  test("seed.ts รันเป็นสคริปต์ (npm run seed:demo) — ครั้งแรกสร้างตัวอย่างลง DB_PATH ครั้งที่สองบอกว่ามีแล้ว exit 0 ทั้งคู่", async () => {
    await withDir(async (dir) => {
      const first = spawnNode(["src/seed.ts"], childEnv(dir))
      assert.equal(await within(first.exited, 20_000, "seed ครั้งแรก"), 0, `${first.out()}\n${first.err()}`)
      assert.match(first.out(), /info: สร้างนิยายตัวอย่าง/)

      const second = spawnNode(["src/seed.ts"], childEnv(dir))
      assert.equal(await within(second.exited, 20_000, "seed ครั้งที่สอง"), 0, `${second.out()}\n${second.err()}`)
      assert.match(second.out(), /info: .*อยู่แล้ว/)

      withDbFile(dbFileOf(dir), (db) => {
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")!.n, 1)
        assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chapters WHERE published = 1 AND status = 'done'")!.n, 3)
      })
    })
  })

  test("seed.ts: config ผิดเมื่อรันเป็นสคริปต์ → exit 1 พร้อมข้อความ", async () => {
    await withDir(async (dir) => {
      const child = spawnNode(["src/seed.ts"], childEnv(dir, { HOST: "0.0.0.0" }))
      assert.equal(await within(child.exited, 20_000, "seed"), 1, `${child.out()}\n${child.err()}`)
      assert.match(child.err(), /error: ตั้งค่าไม่ถูกต้อง: .*ADMIN_PASSWORD/)
    })
  })

  test("seed.ts: ถูก import เฉยๆ ไม่รัน main (ไม่เปิด ไม่สร้างฐานข้อมูล)", async () => {
    await withDir(async (dir) => {
      const child = spawnNode(["-e", "import('./src/seed.ts').then((m) => console.log('imported', typeof m.seedDemo))"], childEnv(dir))
      assert.equal(await within(child.exited, 20_000, "import"), 0, `${child.out()}\n${child.err()}`)
      assert.equal(child.out().trim(), "imported function")
      assert.equal(fs.existsSync(path.join(dir, "data")), false)
    })
  })

  test("import bootstrap.ts เฉยๆ ไม่เปิดพอร์ตและไม่แตะฐานข้อมูล (index.ts เท่านั้นที่เริ่มระบบ)", async () => {
    await withDir(async (dir) => {
      const child = spawnNode(["-e", "import('./src/bootstrap.ts').then((m) => console.log('imported', typeof m.startServer))"], childEnv(dir))
      assert.equal(await within(child.exited, 20_000, "import"), 0, `${child.out()}\n${child.err()}`)
      assert.equal(child.out().trim(), "imported function") // และโปรเซสจบเองได้ = ไม่มีอะไรค้างอยู่
      assert.equal(fs.existsSync(path.join(dir, "data")), false)
    })
  })
})
