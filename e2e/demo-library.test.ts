import assert from "node:assert/strict"
import { describe, test } from "node:test"
import zlib from "node:zlib"
import { corruptPng, coverPng, seedLibrary } from "./demo-library.js"
import { openDb, type Db } from "../server/src/db.js"
import { migrate } from "../server/src/migrate.js"
import { seedDemo, DEMO_TITLE } from "../server/src/seed.js"

/**
 * `e2e/demo-library.ts`: ชุดนิยายสมมติสำหรับตรวจหน้าแรกด้วยตา ไม่ใช่โค้ดของระบบจริง แต่ถ้ามันพัง
 * ภาพที่ใช้ตัดสินเลย์เอาต์จะพลอยผิดตามไปเงียบๆ (เช่น ปกที่เบราว์เซอร์ถอดรหัสไม่ได้ทั้งที่ควรได้ หรือไม่มีเรื่องเกิน 24 ให้เห็นปุ่ม "แสดงเพิ่ม")
 */

const NOW = "2026-10-30 05:00:00"
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function freshDb(): Db {
  const db = openDb(":memory:")
  migrate(db)
  seedDemo(db, NOW)
  return db
}

/** แยก chunk ของ PNG พร้อมตรวจ CRC (โยน error ถ้าโครงสร้างผิด) */
function chunksOf(png: Buffer): { type: string; data: Buffer }[] {
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE)
  const out: { type: string; data: Buffer }[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString("ascii")
    const data = png.subarray(at + 8, at + 8 + length)
    const crc = png.readUInt32BE(at + 8 + length)
    assert.equal(zlib.crc32(png.subarray(at + 4, at + 8 + length)), crc, `CRC ของ ${type} ไม่ตรง`)
    out.push({ type, data })
    at += 12 + length
  }
  return out
}

describe("coverPng / corruptPng", () => {
  test("coverPng: PNG ที่ถูกต้อง 200×300 RGB 8 บิต โครงสร้าง IHDR → IDAT → IEND, CRC ครบ, ข้อมูลภาพคลายแล้วได้ขนาดตรงทุกแถว", () => {
    const chunks = chunksOf(coverPng(215))
    assert.deepEqual(
      chunks.map((c) => c.type),
      ["IHDR", "IDAT", "IEND"],
    )
    const ihdr = chunks[0]!.data
    assert.equal(ihdr.readUInt32BE(0), 200)
    assert.equal(ihdr.readUInt32BE(4), 300)
    assert.equal(ihdr[8], 8)
    assert.equal(ihdr[9], 2)
    assert.equal(zlib.inflateSync(chunks[1]!.data).length, (200 * 3 + 1) * 300)
    assert.equal(chunks[2]!.data.length, 0)
  })

  test("coverPng: ค่าเดิมได้ไบต์เดิมทุกครั้ง · เฉดสี (hue) ต่างกันได้ภาพต่างกัน · ทุกแถวขึ้นต้นด้วยตัวกรอง 0", () => {
    assert.deepEqual(coverPng(10), coverPng(10))
    assert.notDeepEqual(coverPng(10), coverPng(200))
    const raw = zlib.inflateSync(chunksOf(coverPng(90))[1]!.data)
    for (let y = 0; y < 300; y++) assert.equal(raw[y * 601], 0, `แถว ${y}`)
  })

  test("corruptPng: ขึ้นต้นด้วยลายเซ็น PNG (เซิร์ฟเวอร์ถือว่าเป็นรูป) แต่ไม่มี chunk ที่อ่านได้ — เบราว์เซอร์ต้องถอดรหัสไม่ได้", () => {
    const bad = corruptPng()
    assert.deepEqual(bad.subarray(0, 8), PNG_SIGNATURE)
    assert.throws(() => chunksOf(bad))
    assert.ok(bad.length < 100)
  })
})

describe("seedLibrary", () => {
  test("เพิ่มนิยายตามจำนวนที่คืนมา · ที่ผู้อ่านเห็น (published) เกิน 24 เรื่องเพื่อให้เห็นปุ่ม \"แสดงเพิ่ม\" · มีเรื่องร่างเพียงเรื่องเดียว", () => {
    const db = freshDb()
    const { novels } = seedLibrary(db, NOW)
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels")!.n, novels + 1) // +1 = เรื่องจาก seedDemo
    const published = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels WHERE published = 1")!.n
    assert.ok(published > 24 + 3, `ผู้อ่านเห็น ${published} เรื่อง — ต้องเกิน 24 พอให้ "แสดงเพิ่ม" แสดงจำนวนที่เหลือหลายเรื่อง`)
    const drafts = db.all<{ title: string }>("SELECT title FROM novels WHERE published = 0")
    assert.equal(drafts.length, 1)
    assert.match(drafts[0]!.title, /draft/i)
    assert.ok(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE n.published = 0")!.n >= 1)
  })

  test("ครอบคลุมกรณีที่หน้าแรกต้องรับมือ: ชื่อยาว ≥ 80 ตัวอักษร · ไม่มีชื่อไทย · ไม่มีตอนเลย · แท็กยาว · ทั้งสองสถานะ", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    const rows = db.all<{ title: string; title_th: string; status: string; tags: string; chapters: number }>(
      "SELECT n.title, n.title_th, n.status, n.tags, (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapters FROM novels n WHERE n.published = 1",
    )
    assert.ok(rows.some((r) => r.title.length >= 80), "ต้องมีชื่ออังกฤษยาว ≥ 80")
    assert.ok(rows.some((r) => r.title_th.length >= 80), "ต้องมีชื่อไทยยาว ≥ 80")
    assert.ok(rows.some((r) => r.title_th === ""), "ต้องมีเรื่องที่ไม่มีชื่อไทย")
    assert.ok(rows.some((r) => r.chapters === 0), "ต้องมีเรื่องที่ยังไม่มีตอน")
    assert.ok(rows.some((r) => (JSON.parse(r.tags) as string[]).some((t) => t.length >= 30)), "ต้องมีแท็กยาว")
    assert.ok(rows.some((r) => r.status === "completed") && rows.some((r) => r.status === "ongoing"))
  })

  test("ป้าย \"ใหม่\" (72 ชั่วโมง): มีทั้งที่อยู่ในและนอกเกณฑ์ ≥ 3 เรื่องต่อฝั่ง · เรื่องที่มีตอนอัปเดตล่าสุด = เวลาเผยแพร่ตอนล่าสุด · มีตอนเกิน 12 เรื่อง (เต็มแถว \"อัปเดตล่าสุด\")", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    const rows = db.all<{ id: number; last: string; chapters: number }>(
      `SELECT n.id, COALESCE(MAX(c.published_at), n.updated_at) AS last, COUNT(c.id) AS chapters
       FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id WHERE n.published = 1 GROUP BY n.id`,
    )
    const edge = Date.parse("2026-10-30T05:00:00Z") - 72 * 3600_000
    const fresh = rows.filter((r) => Date.parse(`${r.last.replace(" ", "T")}Z`) >= edge)
    assert.ok(fresh.length >= 3, `ใหม่ ${fresh.length}`)
    assert.ok(rows.length - fresh.length >= 3)
    assert.ok(rows.filter((r) => r.chapters > 0).length >= 12)
    for (const r of rows) assert.ok(Number.isFinite(Date.parse(`${r.last.replace(" ", "T")}Z`)), r.last)
  })

  test("ปก: มีทั้งปกถูกต้อง ปกเสียหนึ่งเรื่อง และเรื่องไม่มีปก · ปกทุกรายการเป็น image/png · ปกเสียไม่ใช่ PNG สมบูรณ์", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    const covers = db.all<{ novel_id: number; mime: string; data: Uint8Array }>("SELECT novel_id, mime, data FROM covers")
    assert.ok(covers.length >= 8)
    assert.ok(covers.every((c) => c.mime === "image/png"))
    const broken = covers.filter((c) => {
      try {
        chunksOf(Buffer.from(c.data))
        return false
      } catch {
        return true
      }
    })
    assert.equal(broken.length, 1)
    const novels = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM novels WHERE published = 1")!.n
    assert.ok(novels - covers.length >= 8, "ต้องมีเรื่องไม่มีปกด้วย")
  })

  test("เรื่องแนะนำ: demo = เรื่องจาก seedDemo เรื่องเดียว · cover = Moonlit Courier (มีปก) เรื่องเดียว · none = ไม่มีเลย", () => {
    const featuredTitles = (hero?: "demo" | "cover" | "none"): string[] => {
      const db = freshDb()
      seedLibrary(db, NOW, hero)
      return db.all<{ title: string }>("SELECT title FROM novels WHERE featured = 1 ORDER BY id").map((r) => r.title)
    }
    assert.deepEqual(featuredTitles(), [DEMO_TITLE])
    assert.deepEqual(featuredTitles("demo"), [DEMO_TITLE])
    assert.deepEqual(featuredTitles("cover"), ["Moonlit Courier"])
    assert.deepEqual(featuredTitles("none"), [])
    const db = freshDb()
    seedLibrary(db, NOW, "cover")
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers cv JOIN novels n ON n.id = cv.novel_id WHERE n.title = 'Moonlit Courier'")!.n, 1)
  })

  test("ตอนทุกตอนที่ใส่: เลขตอนเรียง 1..N ต่อเรื่อง, มีคำแปลไม่ว่าง, เผยแพร่แล้ว — ผู้อ่านเห็นครบ", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    const bad = db.all("SELECT 1 FROM chapters WHERE translation = '' OR published <> 1 OR published_at IS NULL OR status <> 'done'")
    assert.equal(bad.length, 0)
    const gaps = db.all<{ novel_id: number }>("SELECT novel_id FROM chapters GROUP BY novel_id HAVING MAX(number) <> COUNT(*) OR MIN(number) <> 1")
    assert.deepEqual(gaps, [])
  })

  test("ไม่ใส่ความลับ/ข้อมูลจริง: ข้อความทุกช่องที่ใส่ไม่มีรูปแบบคีย์ ลิงก์ภายนอก หรืออีเมล", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    // ลิงก์ต้นฉบับ (source_url) ตรวจแยกในเทสต์ถัดไป: ใช้ได้เฉพาะโดเมนสำรองของ RFC 2606
    const text = JSON.stringify([db.all("SELECT title, title_th, author, tags, synopsis, license_note FROM novels WHERE title <> ?", DEMO_TITLE), db.all("SELECT title, title_th, source_text, translation FROM chapters")])
    assert.doesNotMatch(text, /sk-ant|https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}/i)
  })

  test("หน้าเรื่องมีของให้ตรวจ: เรื่องที่มีมากกว่า 100 ตอน (รายการตอนแบ่งหน้า) และลิงก์ต้นฉบับที่ใช้โดเมนสำรอง example.org เท่านั้น", () => {
    const db = freshDb()
    seedLibrary(db, NOW)
    const counts = db.all<{ n: number }>("SELECT COUNT(*) AS n FROM chapters GROUP BY novel_id").map((row) => row.n)
    assert.ok(counts.some((n) => n > 100), "ต้องมีเรื่องที่มีมากกว่า 100 ตอน")
    const urls = db.all<{ source_url: string }>("SELECT source_url FROM novels WHERE source_url <> ''")
    assert.ok(urls.length >= 1, "ต้องมีเรื่องที่มีลิงก์ต้นฉบับ")
    for (const { source_url } of urls) assert.match(source_url, /^https:\/\/example\.org\//)
  })
})
