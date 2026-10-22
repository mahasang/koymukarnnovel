import { test } from "node:test"
import assert from "node:assert/strict"
import type { Config } from "../src/config.js"
import type { Db } from "../src/db.js"
import { dayKey } from "../src/util/time.js"
import { TEST_IMPORT_TOKEN, TEST_PASSWORD, withTestApp, type Client, type TestApp } from "./helpers/app.js"
import { createClock, type Clock } from "./helpers/clock.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { rawRequest } from "./helpers/http.js"
import { seedChapter, seedGlossary, seedNovel, type SeedChapter } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const PUBLIC = "/api/public"
const NOVEL_NOT_FOUND = { error: "ไม่พบนิยายเรื่องนี้", code: "not_found" }
const CHAPTER_NOT_FOUND = { error: "ไม่พบตอนนี้", code: "not_found" }
const DAY_MS = 24 * 3600 * 1000

const epoch = (iso: string): number => Date.parse(iso) / 1000

// ═════════════════════════ ข้อมูลทดสอบ ═════════════════════════
//
// alpha  เผยแพร่ มีปก ตอนทุกแบบ:  0 เผยแพร่ (ไม่มีเวลาเผยแพร่) · 1 · 2 เผยแพร่ (เวลาล่าสุดของตอนที่เห็น) · 3 ร่างที่มีคำแปล ·
//        4 เผยแพร่แต่คำแปลว่าง · 5 เผยแพร่ (เลขมากสุดที่เห็น แต่เวลาเก่ากว่าตอน 2) · 6 เลิกเผยแพร่ (เวลาใหม่สุด) · 7 ยังไม่แปล
//        → ผู้อ่านเห็น 0,1,2,5 · ผู้ดูแลเห็น 0,1,2,3,5,6
// beta   เรื่องที่ซ่อน (ร่าง) มีปก มีตอนที่ "ดูเหมือน" เผยแพร่แล้ว
// gamma  เผยแพร่แล้วแต่ไม่มีตอนที่ผู้อ่านเห็นสักตอน
// delta  ร่างที่ยังว่างเปล่า

const ALPHA_SYNOPSIS = "เรื่องย่อของอัลฟา ".repeat(25).trim()
const ALPHA_SHORT = `${ALPHA_SYNOPSIS.slice(0, 280)}…`

interface Library {
  alpha: number
  beta: number
  gamma: number
  delta: number
}

function seedCover(db: Db, novelId: number, updatedAt: string): void {
  db.run(
    "INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', ?, ?)",
    novelId,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    updatedAt,
  )
}

function seedLibrary(db: Db): Library {
  // ข้อความ SECRET-* ต้องไม่โผล่ในคำตอบสาธารณะเด็ดขาด
  const chapter = (novelId: number, number: number, o: SeedChapter) =>
    seedChapter(db, novelId, number, { source: `SECRET-SOURCE-${novelId}-${number}`, recap: "SECRET-RECAP", ...o })

  const alpha = seedNovel(db, {
    title: "Alpha Saga",
    titleTh: "มหากาพย์อัลฟา",
    author: "Ann Author",
    published: true,
    featured: true,
    synopsis: ALPHA_SYNOPSIS,
    synopsisSrc: "SECRET-SYNOPSIS-SRC",
    tags: ["แฟนตาซี", "Magic"],
    status: "ongoing",
    sourceUrl: "https://example.com/alpha",
    licenseNote: "แปลโดยได้รับอนุญาตจากผู้แต่ง",
    styleNote: "SECRET-STYLE-NOTE",
    updatedAt: "2026-09-01 00:00:00",
  })
  seedCover(db, alpha, "2026-10-20 12:00:00")
  seedGlossary(db, alpha, [{ source: "SECRET-TERM", thai: "SECRET-THAI", note: "SECRET-NOTE" }])
  chapter(alpha, 0, { title: "Prologue", titleTh: "บทนำ", translation: "บทนำ\n\nนี่คือบทนำของเรื่อง", status: "done", published: true })
  chapter(alpha, 1, {
    title: "The Beginning",
    titleTh: "จุดเริ่มต้น",
    translation: "ตอนหนึ่ง\n\n***\n\nฉากใหม่",
    status: "done",
    published: true,
    publishedAt: "2026-10-02 09:00:00",
  })
  chapter(alpha, 2, { title: "Chapter 2", translation: "ตอนสอง", status: "done", published: true, publishedAt: "2026-10-09 09:00:00" })
  chapter(alpha, 3, { title: "Draft Three", titleTh: "ร่างสาม", translation: "ร่างตอนสาม", status: "done" })
  chapter(alpha, 4, { title: "Empty Four", published: true, publishedAt: "2026-10-20 09:00:00" })
  chapter(alpha, 5, { title: "Chapter 5", titleTh: "ตอนห้า", translation: "ตอนห้า", status: "done", published: true, publishedAt: "2026-10-05 09:00:00" })
  chapter(alpha, 6, { title: "Pulled Six", translation: "ร่างตอนหก", status: "done", publishedAt: "2026-10-25 09:00:00" })
  chapter(alpha, 7, { title: "Untranslated Seven", status: "error", error: "SECRET-ERROR-MESSAGE" })

  const beta = seedNovel(db, { title: "Beta Hidden", titleTh: "เบต้าที่ซ่อนอยู่", author: "Ben", published: false, synopsis: "ยังไม่เผยแพร่", updatedAt: "2026-10-10 00:00:00" })
  seedCover(db, beta, "2026-10-18 08:00:00")
  chapter(beta, 1, { title: "Beta One", translation: "ตอนของเรื่องที่ซ่อน", status: "done", published: true, publishedAt: "2026-10-12 00:00:00" })
  chapter(beta, 2, { title: "Beta Two", translation: "ร่างของเรื่องที่ซ่อน", status: "done" })

  const gamma = seedNovel(db, { title: "Gamma Quiet", published: true, status: "completed", synopsis: "สั้นๆ", updatedAt: "2026-08-15 00:00:00" })
  chapter(gamma, 1, { title: "Gamma One", translation: "ร่างของแกมมา", status: "done" })
  chapter(gamma, 2, { title: "Gamma Two", published: true, publishedAt: "2026-10-30 00:00:00" })

  const delta = seedNovel(db, { title: "Delta Empty", published: false, updatedAt: "2026-06-01 00:00:00" })

  return { alpha, beta, gamma, delta }
}

const alphaCard = (lib: Library, over: Record<string, unknown> = {}) => ({
  id: lib.alpha,
  title: "Alpha Saga",
  titleTh: "มหากาพย์อัลฟา",
  author: "Ann Author",
  synopsisShort: ALPHA_SHORT,
  tags: ["แฟนตาซี", "Magic"],
  status: "ongoing",
  featured: true,
  hasCover: true,
  coverV: epoch("2026-10-20T12:00:00Z"),
  chapterCount: 4,
  latestNumber: 5,
  updatedAt: "2026-10-09 09:00:00",
  published: true,
  ...over,
})

const betaCard = (lib: Library, over: Record<string, unknown> = {}) => ({
  id: lib.beta,
  title: "Beta Hidden",
  titleTh: "เบต้าที่ซ่อนอยู่",
  author: "Ben",
  synopsisShort: "ยังไม่เผยแพร่",
  tags: [],
  status: "ongoing",
  featured: false,
  hasCover: true,
  coverV: epoch("2026-10-18T08:00:00Z"),
  chapterCount: 2,
  latestNumber: 2,
  updatedAt: "2026-10-12 00:00:00",
  published: false,
  ...over,
})

const gammaCard = (lib: Library, over: Record<string, unknown> = {}) => ({
  id: lib.gamma,
  title: "Gamma Quiet",
  titleTh: "",
  author: "",
  synopsisShort: "สั้นๆ",
  tags: [],
  status: "completed",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 0,
  latestNumber: null,
  updatedAt: "2026-08-15 00:00:00",
  published: true,
  ...over,
})

const deltaCard = (lib: Library) => ({
  id: lib.delta,
  title: "Delta Empty",
  titleTh: "",
  author: "",
  synopsisShort: "",
  tags: [],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 0,
  latestNumber: null,
  updatedAt: "2026-06-01 00:00:00",
  published: false,
})

const listItem = (number: number, title: string, titleTh: string, publishedAt: string | null, published: boolean) => ({
  number,
  title,
  titleTh,
  publishedAt,
  published,
})

const ALPHA_NOVEL = (lib: Library) => ({ id: lib.alpha, title: "Alpha Saga", titleTh: "มหากาพย์อัลฟา" })

interface Ctx {
  t: TestApp<FakeAi>
  clock: Clock
  lib: Library
  /** ผู้อ่านทั่วไป (ไม่มี cookie) */
  anon: Client
  /** ผู้ดูแลที่ล็อกอินแล้วในเบราว์เซอร์จำลองใหม่ */
  admin: () => Promise<Client>
}

async function withLibrary(fn: (ctx: Ctx) => Promise<void>, config: Partial<Config> = {}): Promise<void> {
  const clock = createClock()
  await withTestApp({ now: clock.now, config }, async (t) => {
    const lib = seedLibrary(t.db)
    await fn({
      t,
      clock,
      lib,
      anon: t.client(),
      admin: async () => {
        const c = t.client()
        await c.login()
        return c
      },
    })
  })
}

/** GET พร้อมระบุ User-Agent (ยอดอ่านแยกคนด้วย IP+UA) */
const read = (c: Client, path: string, ua = "Reader/1.0") => c.get(`${PUBLIC}${path}`, { headers: { "user-agent": ua } })

const viewsOf = (db: Db, novelId: number): number =>
  db.all<{ count: number }>("SELECT count FROM views WHERE novel_id = ?", novelId).reduce((sum, row) => sum + row.count, 0)

// ═════════════════════════ /site ═════════════════════════

test("/site: เฉพาะข้อมูลหน้าเว็บ 7 ช่อง (ไม่มีโมเดล ราคา หรือค่าภายใน) และเปลี่ยนตามการตั้งค่าทันที", async () => {
  await withLibrary(async ({ t, anon }) => {
    const before = await anon.get(`${PUBLIC}/site`)
    assert.equal(before.status, 200)
    assert.match(before.headers.get("content-type")!, /^application\/json/)
    const s = t.settings.get()
    assert.deepEqual(before.json, {
      siteName: s.siteName,
      tagline: s.tagline,
      aboutText: s.aboutText,
      contactText: s.contactText,
      accent: s.accent,
      indexable: s.indexable,
      isAdmin: false,
    })

    t.settings.update({
      siteName: "ร้านนิยายกลางคืน",
      tagline: "อ่านก่อนนอน",
      aboutText: "เกี่ยวกับเว็บ\n\nบรรทัดสอง",
      contactText: "ติดต่อ: owner@example.com",
      accent: "teal",
      indexable: false,
      translateModel: "model-secret-x",
      prices: { "model-secret-x": { in: 1, out: 2 } },
    })
    t.settings.setInternal("queue_paused_reason", "INTERNAL-REASON")
    const after = await anon.get(`${PUBLIC}/site`)
    assert.deepEqual(after.json, {
      siteName: "ร้านนิยายกลางคืน",
      tagline: "อ่านก่อนนอน",
      aboutText: "เกี่ยวกับเว็บ\n\nบรรทัดสอง",
      contactText: "ติดต่อ: owner@example.com",
      accent: "teal",
      indexable: false,
      isAdmin: false,
    })
    assert.doesNotMatch(after.text, /model-secret-x|INTERNAL-REASON/)
  })
})

test("/site.isAdmin ตามสถานะ cookie: ผู้อ่านทั่วไป false · ล็อกอินแล้ว true · ออกจากระบบ/cookie ปลอม/หมดอายุ false", async () => {
  await withLibrary(async ({ t, clock, anon, admin: loginAdmin }) => {
    const isAdmin = async (c: Client): Promise<unknown> => (await c.get(`${PUBLIC}/site`)).json.isAdmin
    assert.equal(await isAdmin(anon), false)

    const admin = await loginAdmin()
    assert.equal(await isAdmin(admin), true)
    await admin.post("/api/admin/logout")
    assert.equal(await isAdmin(admin), false, "ออกจากระบบแล้ว cookie ถูกล้าง")

    const forged = await t.client().get(`${PUBLIC}/site`, { headers: { cookie: "koymukarnnovel_admin=MTIzNA.not-a-real-signature" } })
    assert.equal(forged.json.isAdmin, false)

    const soon = await loginAdmin()
    assert.equal(await isAdmin(soon), true)
    clock.advance(31 * DAY_MS)
    assert.equal(await isAdmin(soon), false, "cookie อายุ 30 วัน หมดอายุตามนาฬิกาของแอป")
  })
})

// ═════════════════════════ ผู้อ่านทั่วไป: เงื่อนไขมองเห็น ═════════════════════════

test("/novels (ผู้อ่านทั่วไป): เฉพาะเรื่องที่เผยแพร่ เรียงอัปเดตล่าสุดก่อน การ์ดครบทุกช่องและไม่มีข้อมูลหลังบ้าน", async () => {
  await withLibrary(async ({ anon, lib }) => {
    const r = await anon.get(`${PUBLIC}/novels`)
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type")!, /^application\/json/)
    // beta (ซ่อน) และ delta (ร่างว่าง) ไม่ปรากฏ · gamma เผยแพร่แล้วแม้ยังไม่มีตอนที่เห็น
    assert.deepEqual(r.json, [alphaCard(lib), gammaCard(lib)])
  })
})

test("การ์ด: chapterCount / latestNumber / updatedAt คำนวณจากตอนที่ผู้อ่านเห็นเท่านั้น (ตอนร่าง ตอนคำแปลว่าง และตอนของเรื่องที่ซ่อนไม่นับ)", async () => {
  await withLibrary(async ({ t, anon, lib }) => {
    const [alpha, gamma] = (await anon.get(`${PUBLIC}/novels`)).json
    // ตอนที่เห็น 0,1,2,5 (4 ตอน) · เลขมากสุด 5 (ตอน 4,6,7 ที่เลขมากกว่าไม่นับ)
    // updatedAt = เวลาเผยแพร่ล่าสุดของตอนที่เห็น = ตอน 2 (ไม่ใช่ตอน 5 ที่เลขมากสุด, ไม่ใช่ตอน 4/6 ที่ซ่อนแต่เวลาใหม่กว่า, และ NULL ของตอน 0 ถูกข้าม)
    assert.equal(alpha.chapterCount, 4)
    assert.equal(alpha.latestNumber, 5)
    assert.equal(alpha.updatedAt, "2026-10-09 09:00:00")
    // ไม่มีตอนที่เห็น (ร่าง + คำแปลว่างที่เวลาเผยแพร่ใหม่กว่า) → 0 ตอน ไม่มีเลขตอน และใช้เวลาแก้ของเรื่อง
    assert.equal(gamma.chapterCount, 0)
    assert.equal(gamma.latestNumber, null)
    assert.equal(gamma.updatedAt, "2026-08-15 00:00:00")

    // เผยแพร่ตอน 6 (มีคำแปล) → ตอนที่เห็นเพิ่ม เลขล่าสุดเปลี่ยน และเวลาเผยแพร่ใหม่สุดกลายเป็นของตอนนั้น
    t.db.run("UPDATE chapters SET published = 1 WHERE novel_id = ? AND number = 6", lib.alpha)
    const [after] = (await anon.get(`${PUBLIC}/novels`)).json
    assert.equal(after.chapterCount, 5)
    assert.equal(after.latestNumber, 6)
    assert.equal(after.updatedAt, "2026-10-25 09:00:00")
  })
})

test("synopsisShort: ตัดที่ 280 ตัวอักษรแล้วต่อ … (280 พอดียังไม่ตัด, 281 ตัด) · เรื่องย่อเต็มอยู่ที่หน้าเรื่องเท่านั้น", async () => {
  await withTestApp({}, async (t) => {
    const make = (length: number) => seedNovel(t.db, { title: `S${length}`, published: true, synopsis: "ก".repeat(length) })
    const ids = { short: make(279), exact: make(280), over: make(281), long: make(2000) }
    const list = (await t.client().get(`${PUBLIC}/novels`)).json as { id: number; synopsisShort: string }[]
    const short = (id: number): string => list.find((n) => n.id === id)!.synopsisShort
    assert.equal(short(ids.short), "ก".repeat(279))
    assert.equal(short(ids.exact), "ก".repeat(280))
    assert.equal(short(ids.over), `${"ก".repeat(280)}…`)
    assert.equal(short(ids.long), `${"ก".repeat(280)}…`)
    assert.ok(list.every((n) => Array.from(n.synopsisShort).length <= 281))
    const detail = await t.client().get(`${PUBLIC}/novels/${ids.long}`)
    assert.equal(detail.json.synopsis, "ก".repeat(2000))
  })
})

test("การ์ด: เรื่องที่อัปเดตเวลาเดียวกันเรียงรหัสใหม่ก่อน · แท็กเสียรูปไม่ทำให้หน้าล่ม · ตอนเลข 0 ตอนเดียวทำให้ latestNumber เป็น 0 (ไม่ใช่ null) และข้ามเวลาเผยแพร่ที่ว่างไปใช้เวลาแก้ของเรื่อง", async () => {
  await withTestApp({}, async (t) => {
    const same = { published: true, updatedAt: "2026-05-05 00:00:00" }
    const first = seedNovel(t.db, { title: "First", ...same })
    const second = seedNovel(t.db, { title: "Second", ...same })
    const third = seedNovel(t.db, { title: "Third", ...same })
    t.db.run("UPDATE novels SET tags = ? WHERE id = ?", "{ไม่ใช่ json", second)
    seedChapter(t.db, third, 0, { translation: "บทนำ", status: "done", published: true })

    const list = (await t.client().get(`${PUBLIC}/novels`)).json as { id: number; tags: string[]; chapterCount: number; latestNumber: number | null; updatedAt: string }[]
    assert.deepEqual(
      list.map((n) => n.id),
      [third, second, first],
    )
    assert.deepEqual(list[1]!.tags, [])
    assert.equal(list[0]!.chapterCount, 1)
    assert.equal(list[0]!.latestNumber, 0)
    assert.equal(list[0]!.updatedAt, "2026-05-05 00:00:00")
    assert.equal(list[2]!.latestNumber, null)

    const page = await t.client().get(`${PUBLIC}/novels/${third}/chapters/0`)
    assert.equal(page.status, 200)
    assert.equal(page.json.chapter.number, 0)
    assert.equal(page.json.prev, null)
    assert.equal(page.json.next, null)
  })
})

test("/novels/:id (ผู้อ่านทั่วไป): การ์ด + เรื่องย่อเต็ม ลิงก์ต้นฉบับ บันทึกสิทธิ์ + รายการตอนที่เห็นเรียงตามเลขตอน (รวมตอนเลข 0)", async () => {
  await withLibrary(async ({ anon, lib }) => {
    const r = await anon.get(`${PUBLIC}/novels/${lib.alpha}`)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, {
      ...alphaCard(lib),
      synopsis: ALPHA_SYNOPSIS,
      sourceUrl: "https://example.com/alpha",
      licenseNote: "แปลโดยได้รับอนุญาตจากผู้แต่ง",
      chapters: [
        listItem(0, "Prologue", "บทนำ", null, true),
        listItem(1, "The Beginning", "จุดเริ่มต้น", "2026-10-02 09:00:00", true),
        listItem(2, "Chapter 2", "", "2026-10-09 09:00:00", true),
        listItem(5, "Chapter 5", "ตอนห้า", "2026-10-05 09:00:00", true),
      ],
    })

    const quiet = await anon.get(`${PUBLIC}/novels/${lib.gamma}`)
    assert.equal(quiet.status, 200)
    assert.deepEqual(quiet.json, { ...gammaCard(lib), synopsis: "สั้นๆ", sourceUrl: "", licenseNote: "", chapters: [] })
  })
})

test("/novels/:id/chapters/:number (ผู้อ่านทั่วไป): เนื้อหาคำแปล (ไม่ใช่ต้นฉบับ) + prev/next ข้ามตอนที่ซ่อน", async () => {
  await withLibrary(async ({ anon, lib }) => {
    const chapter = (n: number) => anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters/${n}`)

    const one = await chapter(1)
    assert.equal(one.status, 200)
    assert.deepEqual(one.json, {
      novel: ALPHA_NOVEL(lib),
      chapter: { number: 1, title: "The Beginning", titleTh: "จุดเริ่มต้น", text: "ตอนหนึ่ง\n\n***\n\nฉากใหม่", published: true },
      prev: 0, // ตอนเลข 0 เป็นตอนก่อนหน้าจริง (ไม่ใช่ "ไม่มี")
      next: 2,
    })

    const prevNext = async (n: number) => {
      const r = await chapter(n)
      assert.equal(r.status, 200, `ตอน ${n}`)
      return [r.json.prev, r.json.next]
    }
    assert.deepEqual(await prevNext(0), [null, 1])
    assert.deepEqual(await prevNext(2), [1, 5], "ข้ามตอน 3 (ร่าง) และ 4 (คำแปลว่าง)")
    assert.deepEqual(await prevNext(5), [2, null], "ตอน 6 เลิกเผยแพร่ ตอน 7 ยังไม่แปล ไม่นับเป็นตอนถัดไป")
  })
})

test("ตอน/เรื่องที่ผู้อ่านเห็นไม่ได้ → 404 ข้อความเดียวกันทุกตัวอักษรกับ \"ไม่มีอยู่จริง\" (เดาไม่ได้ว่ามีเรื่องซ่อนอยู่)", async () => {
  await withLibrary(async ({ anon, lib }) => {
    const MISSING_NOVEL = 987_654
    const novels = [lib.beta, lib.delta, MISSING_NOVEL]
    const missingNovel = await anon.get(`${PUBLIC}/novels/${MISSING_NOVEL}`)
    assert.equal(missingNovel.status, 404)
    assert.deepEqual(missingNovel.json, NOVEL_NOT_FOUND)
    for (const id of novels) {
      const r = await anon.get(`${PUBLIC}/novels/${id}`)
      assert.equal(r.status, 404, `เรื่อง ${id}`)
      assert.equal(r.text, missingNovel.text, `เรื่อง ${id}`)
    }

    const missingChapter = await anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters/99`)
    assert.equal(missingChapter.status, 404)
    assert.deepEqual(missingChapter.json, CHAPTER_NOT_FOUND)
    const hidden: [string, number, number][] = [
      ["ตอนที่ยังไม่เผยแพร่ (มีคำแปล)", lib.alpha, 3],
      ["ตอนเผยแพร่แล้วแต่คำแปลว่าง", lib.alpha, 4],
      ["ตอนที่เลิกเผยแพร่", lib.alpha, 6],
      ["ตอนที่ยังไม่แปล", lib.alpha, 7],
      ["ตอนของเรื่องที่ซ่อน (เผยแพร่แล้วมีคำแปล)", lib.beta, 1],
      ["ตอนของเรื่องที่ซ่อน (ร่าง)", lib.beta, 2],
      ["ตอนของเรื่องที่ไม่มีอยู่", MISSING_NOVEL, 1],
      ["ตอนที่คำแปลว่างของเรื่องที่เผยแพร่ (เผยแพร่แล้ว)", lib.gamma, 2],
      ["ตอนร่างของเรื่องที่เผยแพร่", lib.gamma, 1],
    ]
    for (const [label, novel, number] of hidden) {
      const r = await anon.get(`${PUBLIC}/novels/${novel}/chapters/${number}`)
      assert.equal(r.status, 404, label)
      assert.equal(r.text, missingChapter.text, label)
    }
  })
})

test("พารามิเตอร์ในพาธที่ผิดรูปแบบ → 404 เหมือนไม่มีอยู่ (รหัสเรื่องเป็นจำนวนเต็มบวกมาตรฐาน · เลขตอนเริ่มที่ 0)", async () => {
  await withLibrary(async ({ anon, lib }) => {
    for (const id of ["0", "01", "-1", "1.5", "1e0", "abc", "%20", "9007199254740993", `${lib.alpha}x`, "0x1"]) {
      const r = await anon.get(`${PUBLIC}/novels/${id}`)
      assert.equal(r.status, 404, `id ${id}`)
      assert.deepEqual(r.json, NOVEL_NOT_FOUND, `id ${id}`)
    }
    for (const n of ["00", "01", "-1", "1.5", "1e0", "abc", "0x1", "9007199254740993", "%201", "１"]) {
      const r = await anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters/${n}`)
      assert.equal(r.status, 404, `เลขตอน ${n}`)
      assert.deepEqual(r.json, CHAPTER_NOT_FOUND, `เลขตอน ${n}`)
    }
    for (const id of ["0", "abc", "01"]) {
      const r = await anon.get(`${PUBLIC}/novels/${id}/chapters/1`)
      assert.equal(r.status, 404, `id ${id} ในพาธตอน`)
      assert.deepEqual(r.json, CHAPTER_NOT_FOUND)
    }
    assert.equal((await anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters/0`)).status, 200)
    assert.equal((await anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters`)).status, 404)
    assert.equal((await anon.get(`${PUBLIC}/ไม่มีอยู่`)).status, 404)
  })
})

// ═════════════════════════ ผู้ดูแล: ดูร่างก่อนเผยแพร่ ═════════════════════════

test("โหมดผู้ดูแล /novels: เห็นทุกเรื่อง (รวมร่าง) พร้อม published:false · ตัวเลขนับตอนที่มีคำแปลทั้งร่างและเผยแพร่แล้ว", async () => {
  await withLibrary(async ({ lib, admin: loginAdmin }) => {
    const admin = await loginAdmin()
    const r = await admin.get(`${PUBLIC}/novels`)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, [
      // ตอนที่ผู้ดูแลเห็น 0,1,2,3,5,6 (ตอน 4 คำแปลว่าง, 7 ยังไม่แปล ยังซ่อน) · เวลาใหม่สุดคือตอน 6 ที่เลิกเผยแพร่
      alphaCard(lib, { chapterCount: 6, latestNumber: 6, updatedAt: "2026-10-25 09:00:00" }),
      betaCard(lib),
      // gamma: เห็นตอน 1 (ร่าง) ตอน 2 ที่คำแปลว่างยังซ่อน (เวลาเผยแพร่ 10-30 ต้องไม่ถูกนับ)
      gammaCard(lib, { chapterCount: 1, latestNumber: 1 }),
      deltaCard(lib),
    ])
  })
})

test("โหมดผู้ดูแล /novels/:id: รายการตอนรวมร่างที่มีคำแปล · published บอกว่าผู้อ่านทั่วไปเห็นหรือไม่ (เรื่องที่ซ่อน = ทุกตอนไม่เห็น)", async () => {
  await withLibrary(async ({ lib, admin: loginAdmin }) => {
    const admin = await loginAdmin()
    const alpha = await admin.get(`${PUBLIC}/novels/${lib.alpha}`)
    assert.equal(alpha.status, 200)
    assert.deepEqual(alpha.json, {
      ...alphaCard(lib, { chapterCount: 6, latestNumber: 6, updatedAt: "2026-10-25 09:00:00" }),
      synopsis: ALPHA_SYNOPSIS,
      sourceUrl: "https://example.com/alpha",
      licenseNote: "แปลโดยได้รับอนุญาตจากผู้แต่ง",
      chapters: [
        listItem(0, "Prologue", "บทนำ", null, true),
        listItem(1, "The Beginning", "จุดเริ่มต้น", "2026-10-02 09:00:00", true),
        listItem(2, "Chapter 2", "", "2026-10-09 09:00:00", true),
        listItem(3, "Draft Three", "ร่างสาม", null, false),
        listItem(5, "Chapter 5", "ตอนห้า", "2026-10-05 09:00:00", true),
        listItem(6, "Pulled Six", "", "2026-10-25 09:00:00", false),
      ],
    })

    const beta = await admin.get(`${PUBLIC}/novels/${lib.beta}`)
    assert.equal(beta.status, 200)
    assert.deepEqual(beta.json, {
      ...betaCard(lib),
      synopsis: "ยังไม่เผยแพร่",
      sourceUrl: "",
      licenseNote: "",
      chapters: [listItem(1, "Beta One", "", "2026-10-12 00:00:00", false), listItem(2, "Beta Two", "", null, false)],
    })

    const empty = await admin.get(`${PUBLIC}/novels/${lib.delta}`)
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, { ...deltaCard(lib), synopsis: "", sourceUrl: "", licenseNote: "", chapters: [] })

    assert.deepEqual((await admin.get(`${PUBLIC}/novels/987654`)).json, NOVEL_NOT_FOUND)
  })
})

test("โหมดผู้ดูแล /novels/:id/chapters/:number: อ่านร่างที่มีคำแปลได้ (published:false) · prev/next รวมร่าง · ตอนที่ไม่มีคำแปลยัง 404", async () => {
  await withLibrary(async ({ lib, admin: loginAdmin }) => {
    const admin = await loginAdmin()
    const chapter = (novel: number, n: number) => admin.get(`${PUBLIC}/novels/${novel}/chapters/${n}`)

    const draft = await chapter(lib.alpha, 3)
    assert.equal(draft.status, 200)
    assert.deepEqual(draft.json, {
      novel: ALPHA_NOVEL(lib),
      chapter: { number: 3, title: "Draft Three", titleTh: "ร่างสาม", text: "ร่างตอนสาม", published: false },
      prev: 2,
      next: 5,
    })

    const prevNext = async (n: number) => {
      const r = await chapter(lib.alpha, n)
      assert.equal(r.status, 200, `ตอน ${n}`)
      return [r.json.prev, r.json.next, r.json.chapter.published]
    }
    assert.deepEqual(await prevNext(0), [null, 1, true])
    assert.deepEqual(await prevNext(2), [1, 3, true], "ตอน 3 (ร่าง) เป็นตอนถัดไปของผู้ดูแล")
    assert.deepEqual(await prevNext(5), [3, 6, true])
    assert.deepEqual(await prevNext(6), [5, null, false], "ตอน 7 ยังไม่แปล จึงไม่ใช่ตอนถัดไป")

    // ตอนของเรื่องที่ซ่อน: เผยแพร่ในตัวมันเองแล้วแต่เรื่องยังซ่อน → ผู้อ่านทั่วไปไม่เห็น จึงต้องเป็น published:false
    const inHidden = await chapter(lib.beta, 1)
    assert.equal(inHidden.status, 200)
    assert.deepEqual(inHidden.json, {
      novel: { id: lib.beta, title: "Beta Hidden", titleTh: "เบต้าที่ซ่อนอยู่" },
      chapter: { number: 1, title: "Beta One", titleTh: "", text: "ตอนของเรื่องที่ซ่อน", published: false },
      prev: null,
      next: 2,
    })

    for (const [novel, n] of [
      [lib.alpha, 4],
      [lib.alpha, 7],
      [lib.alpha, 99],
      [lib.gamma, 2],
      [lib.delta, 1],
    ] as const) {
      const r = await chapter(novel, n)
      assert.equal(r.status, 404, `เรื่อง ${novel} ตอน ${n}`)
      assert.deepEqual(r.json, CHAPTER_NOT_FOUND)
    }
  })
})

test("Cache-Control: ผู้อ่านทั่วไป no-cache ทุกเส้นทาง · ผู้ดูแล private, no-store ทุกเส้นทาง (รวมคำตอบ 404)", async () => {
  await withLibrary(async ({ anon, lib, admin: loginAdmin }) => {
    const admin = await loginAdmin()
    const paths = [
      "/site",
      "/novels",
      `/novels/${lib.alpha}`,
      `/novels/${lib.alpha}/chapters/1`,
      `/novels/${lib.beta}`, // 404 สำหรับผู้อ่านทั่วไป
      `/novels/${lib.alpha}/chapters/4`, // 404 ทั้งคู่
    ]
    for (const path of paths) {
      const a = await anon.get(`${PUBLIC}${path}`)
      assert.equal(a.headers.get("cache-control"), "no-cache", `ผู้อ่าน ${path} (${a.status})`)
      const b = await admin.get(`${PUBLIC}${path}`)
      assert.equal(b.headers.get("cache-control"), "private, no-store", `ผู้ดูแล ${path} (${b.status})`)
    }
  })
})

test("cookie ที่ไม่ถูกต้องเป็นผู้อ่านทั่วไป: ไม่เห็นร่าง ไม่ได้ private, no-store และยอดอ่านนับ", async () => {
  await withLibrary(async ({ t, lib }) => {
    const headers = { cookie: "koymukarnnovel_admin=not-a-real-token", "user-agent": "Forger/1.0" }
    const novels = await t.client().get(`${PUBLIC}/novels`, { headers })
    assert.deepEqual(
      novels.json.map((n: { id: number }) => n.id),
      [lib.alpha, lib.gamma],
    )
    assert.equal(novels.headers.get("cache-control"), "no-cache")
    assert.equal((await t.client().get(`${PUBLIC}/novels/${lib.alpha}/chapters/3`, { headers })).status, 404)
    assert.equal((await t.client().get(`${PUBLIC}/novels/${lib.alpha}/chapters/1`, { headers })).status, 200)
    assert.equal(viewsOf(t.db, lib.alpha), 1)
  })
})

test("โหมดไม่มีรหัสผ่าน (loopback): ทุกคำขอจากเครื่องนี้เป็นผู้ดูแล (เห็นร่าง ไม่นับยอด) ส่วนคำขอที่ Host เป็นโดเมนอื่นเป็นผู้อ่านทั่วไป", async () => {
  await withLibrary(
    async ({ t, lib }) => {
      const local = t.client()
      const site = await local.get(`${PUBLIC}/site`)
      assert.equal(site.json.isAdmin, true)
      assert.equal(site.headers.get("cache-control"), "private, no-store")
      const draft = await read(local, `/novels/${lib.alpha}/chapters/3`)
      assert.equal(draft.status, 200)
      assert.equal(draft.json.chapter.published, false)
      assert.equal((await read(local, `/novels/${lib.alpha}/chapters/1`)).status, 200)
      assert.equal(viewsOf(t.db, lib.alpha), 0, "ผู้ดูแลไม่นับยอด")

      const foreign = (path: string) => rawRequest({ port: t.port, path: `${PUBLIC}${path}`, headers: { Host: "evil.test", "user-agent": "Rebinder/1.0" } })
      const foreignSite = await foreign("/site")
      assert.equal((foreignSite.json as { isAdmin: boolean }).isAdmin, false)
      assert.equal(foreignSite.headers["cache-control"], "no-cache")
      assert.equal((await foreign(`/novels/${lib.alpha}/chapters/3`)).status, 404)
      assert.equal((await foreign(`/novels/${lib.alpha}/chapters/1`)).status, 200)
      assert.equal(viewsOf(t.db, lib.alpha), 1, "Host อื่นเป็นผู้อ่านทั่วไป จึงนับ")
    },
    { adminPassword: null },
  )
})

// ═════════════════════════ ยอดอ่าน ═════════════════════════

test("ยอดอ่าน: IP+UA เดิมเปิดตอนเดิมซ้ำไม่นับ · UA ต่างนับเพิ่ม · ตอนอื่นนับเพิ่ม · ยอดเข้าเรื่องที่ถูกอ่านในวันตามนาฬิกาของแอป", async () => {
  await withLibrary(async ({ t, clock, lib, anon }) => {
    const today = dayKey(clock.now())
    const count = (): number => t.db.get<{ count: number }>("SELECT count FROM views WHERE day = ? AND novel_id = ?", today, lib.alpha)?.count ?? 0
    assert.equal(count(), 0)

    assert.equal((await read(anon, `/novels/${lib.alpha}/chapters/1`, "UA-A")).status, 200)
    assert.equal(count(), 1)
    await read(anon, `/novels/${lib.alpha}/chapters/1`, "UA-A")
    assert.equal(count(), 1, "IP+UA เดิม ตอนเดิม ไม่นับซ้ำ")
    await read(anon, `/novels/${lib.alpha}/chapters/1`, "UA-B")
    assert.equal(count(), 2, "UA ต่างกัน นับเพิ่ม")
    await read(anon, `/novels/${lib.alpha}/chapters/2`, "UA-A")
    assert.equal(count(), 3, "ตอนอื่น นับเพิ่ม")

    assert.equal(viewsOf(t.db, lib.beta) + viewsOf(t.db, lib.gamma) + viewsOf(t.db, lib.delta), 0)
    assert.equal(viewsOf(t.db, lib.alpha), 3)
  })
})

test("ยอดอ่าน: IP ต่างกัน (X-Forwarded-For เมื่อ TRUST_PROXY=1) นับแยกกันแม้ UA เดียวกัน", async () => {
  await withLibrary(
    async ({ t, lib, anon }) => {
      const as = (ip: string) => anon.get(`${PUBLIC}/novels/${lib.alpha}/chapters/1`, { headers: { "user-agent": "UA-A", "x-forwarded-for": ip } })
      await as("198.51.100.1")
      await as("198.51.100.1")
      assert.equal(viewsOf(t.db, lib.alpha), 1)
      await as("198.51.100.2")
      assert.equal(viewsOf(t.db, lib.alpha), 2)
    },
    { trustProxy: 1 },
  )
})

test("ยอดอ่านไม่นับ: ผู้ดูแล · คำตอบ 404 ทุกแบบ · รายการ/รายละเอียด/site · HEAD — และไม่ทำให้ผู้อ่านจริงที่ IP+UA เดียวกันถูกมองว่าซ้ำ", async () => {
  await withLibrary(async ({ t, lib, anon, admin: loginAdmin }) => {
    const UA = "SameAgent/1.0"
    const admin = await loginAdmin()
    for (const path of [`/novels/${lib.alpha}/chapters/1`, `/novels/${lib.alpha}/chapters/3`, `/novels/${lib.beta}/chapters/1`]) {
      assert.equal((await read(admin, path, UA)).status, 200, path)
    }

    for (const path of [
      `/novels/${lib.alpha}/chapters/3`, // ร่าง
      `/novels/${lib.alpha}/chapters/4`, // คำแปลว่าง
      `/novels/${lib.alpha}/chapters/99`, // ไม่มี
      `/novels/${lib.beta}/chapters/1`, // เรื่องซ่อน
      `/novels/${lib.alpha}/chapters/abc`, // พาธผิดรูปแบบ
    ]) {
      assert.equal((await read(anon, path, UA)).status, 404, path)
    }

    for (const path of ["/site", "/novels", `/novels/${lib.alpha}`]) assert.equal((await read(anon, path, UA)).status, 200, path)

    const head = await anon.raw(`${PUBLIC}/novels/${lib.alpha}/chapters/1`, { method: "HEAD", headers: { "user-agent": UA } })
    assert.equal(head.status, 200)
    assert.equal(head.text, "")

    assert.equal(viewsOf(t.db, lib.alpha) + viewsOf(t.db, lib.beta) + viewsOf(t.db, lib.gamma), 0)

    // ผู้อ่านจริงที่ IP+UA เดียวกับข้างบนยังนับได้ครั้งแรก (ไม่ถูกคำขอที่ไม่นับทำให้กลายเป็น "เคยนับแล้ว")
    assert.equal((await read(anon, `/novels/${lib.alpha}/chapters/1`, UA)).status, 200)
    assert.equal(viewsOf(t.db, lib.alpha), 1)
  })
})

test("ยอดอ่าน: คำขอแบบมีเงื่อนไขที่ได้ 304 ก็นับ (ผู้อ่านที่กลับมาเปิดตอนที่เบราว์เซอร์แคชไว้คือการอ่านจริง)", async () => {
  await withLibrary(async ({ t, lib }) => {
    const path = `${PUBLIC}/novels/${lib.alpha}/chapters/1`
    const first = await rawRequest({ port: t.port, path, headers: { "user-agent": "UA-A" } })
    assert.equal(first.status, 200)
    const etag = first.headers.etag
    assert.ok(etag, "ต้องมี ETag")
    assert.equal(viewsOf(t.db, lib.alpha), 1)

    const revalidated = await rawRequest({ port: t.port, path, headers: { "user-agent": "UA-B", "if-none-match": etag } })
    assert.equal(revalidated.status, 304)
    assert.equal(viewsOf(t.db, lib.alpha), 2)
  })
})

// ═════════════════════════ แคชและ ETag ═════════════════════════

test("ผู้อ่านทั่วไปได้ ETag + no-cache: If-None-Match ที่ตรงได้ 304 ไม่มีเนื้อหา · ข้อมูลเปลี่ยนแล้วได้ 200 ใหม่พร้อม ETag ใหม่", async () => {
  await withLibrary(async ({ t, lib }) => {
    const get = (headers: Record<string, string> = {}) => rawRequest({ port: t.port, path: `${PUBLIC}/novels`, headers })
    const first = await get()
    assert.equal(first.status, 200)
    assert.equal(first.headers["cache-control"], "no-cache")
    const etag = first.headers.etag
    assert.ok(etag)

    const same = await get({ "If-None-Match": etag })
    assert.equal(same.status, 304)
    assert.equal(same.text, "")
    assert.equal(same.headers["cache-control"], "no-cache")

    t.db.run("UPDATE novels SET title = ? WHERE id = ?", "Alpha Saga 2", lib.alpha)
    const changed = await get({ "If-None-Match": etag })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.etag, etag)
    assert.equal((changed.json as { title: string }[])[0]!.title, "Alpha Saga 2")
  })
})

// ═════════════════════════ ตัวจำกัดอัตรา · เมธอด ═════════════════════════

test("ตัวจำกัดอัตรา: คำขอที่ 121 ภายใน 1 นาทีต่อ IP → 429 ข้อความไทย + Retry-After · IP อื่นไม่ถูกกระทบ · ครบ 60 วินาทีนับใหม่", async () => {
  await withLibrary(
    async ({ clock, anon }) => {
      const hit = (ip = "198.51.100.1") => anon.get(`${PUBLIC}/site`, { headers: { "x-forwarded-for": ip } })
      for (let i = 1; i <= 120; i++) {
        const r = await hit()
        assert.equal(r.status, 200, `คำขอที่ ${i}`)
        assert.equal(r.headers.get("retry-after"), null)
      }

      const blocked = await hit()
      assert.equal(blocked.status, 429)
      assert.equal(blocked.headers.get("retry-after"), "60")
      assert.match(blocked.json.error, THAI)
      assert.equal(blocked.json.code, "rate_limited")
      assert.equal(blocked.json.retryAfterSec, 60)

      assert.equal((await hit("198.51.100.2")).status, 200, "IP อื่นมีโควตาของตัวเอง")

      clock.advance(59_000)
      const still = await hit()
      assert.equal(still.status, 429)
      assert.equal(still.headers.get("retry-after"), "1")
      assert.equal(still.json.retryAfterSec, 1)

      clock.advance(1_000)
      assert.equal((await hit()).status, 200, "ครบ 60 วินาทีนับใหม่")
    },
    { trustProxy: 1 },
  )
})

test("ตัวจำกัดอัตรานับทุกเส้นทางใต้ /api/public (รวมที่ตอบ 404) แต่ไม่นับ /healthz, /api/admin และคำขอที่ถูกปฏิเสธด้วย 405", async () => {
  await withLibrary(async ({ anon, lib }) => {
    for (let i = 0; i < 125; i++) assert.equal((await anon.get("/healthz")).status, 200)
    for (let i = 0; i < 125; i++) assert.equal((await anon.get("/api/admin/me")).status, 401)
    for (let i = 0; i < 125; i++) assert.equal((await anon.post(`${PUBLIC}/novels`, {})).status, 405)

    // โควตาเต็ม 120 ยังอยู่ · ผสมเส้นทางหลายแบบ รวมเส้นทางที่ 404
    const paths = ["/site", "/novels", `/novels/${lib.alpha}`, `/novels/${lib.alpha}/chapters/1`, `/novels/${lib.beta}`, "/ไม่มีอยู่"]
    for (let i = 0; i < 120; i++) {
      const r = await anon.get(`${PUBLIC}${paths[i % paths.length]}`)
      assert.notEqual(r.status, 429, `คำขอที่ ${i + 1}`)
    }
    assert.equal((await anon.get(`${PUBLIC}/site`)).status, 429)
  })
})

test("เมธอดอื่นนอกจาก GET/HEAD → 405 พร้อม Allow ทุกเส้นทางสาธารณะ", async () => {
  await withLibrary(async ({ anon, lib }) => {
    for (const path of ["/site", "/novels", `/novels/${lib.alpha}`, `/novels/${lib.alpha}/chapters/1`]) {
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const r = await anon[method](`${PUBLIC}${path}`, {})
        assert.equal(r.status, 405, `${method} ${path}`)
        assert.equal(r.headers.get("allow"), "GET, HEAD")
        assert.equal(r.json.code, "method_not_allowed")
        assert.match(r.json.error, THAI)
      }
    }
  })
})

// ═════════════════════════ ไม่รั่วข้อมูลหลังบ้าน ═════════════════════════

test("ไม่มีข้อมูลหลังบ้านหลุดในคำตอบสาธารณะ ทั้งผู้อ่านทั่วไปและผู้ดูแล (ต้นฉบับ สรุปตอน โน้ตสไตล์ อภิธานศัพท์ ข้อความผิดพลาด คีย์ รหัสผ่าน)", async () => {
  await withLibrary(
    async ({ t, lib, anon, admin: loginAdmin }) => {
      t.settings.update({ translateModel: "model-secret-x", prices: { "model-secret-x": { in: 1, out: 2 } } })
      const admin = await loginAdmin()
      const secrets = [
        "SECRET-",
        "model-secret-x",
        "claude-sonnet",
        "claude-haiku",
        "sk-ant-KEY-VALUE",
        TEST_PASSWORD,
        TEST_IMPORT_TOKEN,
        "koymukarnnovel_admin",
        "styleNote",
        "synopsisSrc",
        "sourceText",
        "recap",
      ]
      const paths = ["/site", "/novels", ...[lib.alpha, lib.beta, lib.gamma, lib.delta].map((id) => `/novels/${id}`)]
      for (let n = 0; n <= 7; n++) paths.push(`/novels/${lib.alpha}/chapters/${n}`)
      for (let n = 1; n <= 2; n++) paths.push(`/novels/${lib.beta}/chapters/${n}`)

      let served = 0
      for (const [who, client] of [["ผู้อ่าน", anon], ["ผู้ดูแล", admin]] as const) {
        for (const path of paths) {
          const r = await client.get(`${PUBLIC}${path}`)
          if (r.status === 200) served++
          for (const secret of secrets) assert.ok(!r.text.includes(secret), `${who} ${path} มี "${secret}"`)
        }
      }
      assert.equal(served, 22, "ผู้อ่านได้ 200 จำนวน 8 เส้นทาง ผู้ดูแล 14 เส้นทาง — ต้องได้เนื้อหาจริงให้ตรวจ ไม่ใช่ 404 ทั้งหมด")
    },
    { anthropicApiKey: "sk-ant-KEY-VALUE" },
  )
})
