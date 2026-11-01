import { test } from "node:test"
import assert from "node:assert/strict"
import { openDb, type Db } from "../src/db.js"
import { migrate } from "../src/migrate.js"
import { applyTranslation, enqueueChapters, setPublished, VISIBLE_SQL } from "../src/chapters.js"
import { buildContext } from "../src/context.js"
import { recordUsage } from "../src/usage.js"
import { buildSystem } from "../src/prompts.js"
import { getChapter, seedChapter, seedGlossary, seedNovel } from "./helpers/seed.js"

const T0 = "2026-01-01 00:00:00" // เวลาที่ seed ใส่ให้ created_at/updated_at
const T1 = "2026-03-01 10:00:00"
const T2 = "2026-03-02 10:00:00"

function setup(): { db: Db; novelId: number } {
  const db = openDb(":memory:")
  migrate(db)
  return { db, novelId: seedNovel(db) }
}

const glossaryOf = (db: Db, novelId: number) =>
  db.all<{ source: string; thai: string; note: string; auto: number }>(
    "SELECT source, thai, note, auto FROM glossary WHERE novel_id = ? ORDER BY source",
    novelId,
  )

// ───────────────────────── VISIBLE_SQL ─────────────────────────

test("VISIBLE_SQL: ผู้อ่านเห็นเฉพาะตอนที่เผยแพร่ + มีคำแปล + เรื่องเผยแพร่แล้ว (ขาดข้อใดข้อหนึ่งก็ไม่เห็น)", () => {
  const db = openDb(":memory:")
  migrate(db)
  const shown = seedNovel(db, { published: true })
  const hidden = seedNovel(db, { published: false })
  const ok = seedChapter(db, shown, 1, { published: true, translation: "แปลแล้ว" })
  seedChapter(db, shown, 2, { published: true, translation: "" }) // เผยแพร่แล้วแต่ไม่มีคำแปล
  seedChapter(db, shown, 3, { published: false, translation: "แปลแล้ว" }) // มีคำแปลแต่ยังซ่อน
  seedChapter(db, hidden, 1, { published: true, translation: "แปลแล้ว" }) // เรื่องยังซ่อน
  const rows = db.all<{ id: number }>(`SELECT c.id FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE ${VISIBLE_SQL}`)
  assert.deepEqual(
    rows.map((r) => r.id),
    [ok],
  )
})

// ───────────────────────── applyTranslation ─────────────────────────

test("applyTranslation: เขียนคำแปล เวลาแปล สถานะ done ล้าง error ออกจากคิว โดยไม่แตะต้นฉบับและเลขตอน", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 4, { source: "SRC", status: "translating", error: "ผิดพลาดเก่า", queueSeq: 9 })
  assert.equal(applyTranslation(db, id, { translation: "คำแปลใหม่", now: T1 }), true)
  const c = getChapter(db, id)
  assert.equal(c.translation, "คำแปลใหม่")
  assert.equal(c.translated_at, T1)
  assert.equal(c.status, "done")
  assert.equal(c.error, "")
  assert.equal(c.queue_seq, null)
  assert.equal(c.updated_at, T1)
  assert.equal(c.source_text, "SRC")
  assert.equal(c.number, 4)
})

test("applyTranslation: ไม่เผยแพร่เองถ้าผู้เรียกไม่สั่ง (ไม่ใส่ publish หรือ publish:false) แม้แถวตั้ง auto_publish ไว้", () => {
  for (const publish of [undefined, false]) {
    const { db, novelId } = setup()
    const id = seedChapter(db, novelId, 1, { autoPublish: true })
    applyTranslation(db, id, { translation: "x", publish, now: T1 })
    const c = getChapter(db, id)
    assert.equal(c.published, 0, `publish=${publish}`)
    assert.equal(c.published_at, null, `publish=${publish}`)
  }
})

test("applyTranslation: publish:true เผยแพร่ ตั้ง published_at ครั้งแรกครั้งเดียว เรียกซ้ำไม่เปลี่ยน", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  applyTranslation(db, id, { translation: "แปลรอบแรก", publish: true, now: T1 })
  let c = getChapter(db, id)
  assert.equal(c.published, 1)
  assert.equal(c.published_at, T1)
  applyTranslation(db, id, { translation: "แปลรอบสอง", publish: true, now: T2 })
  c = getChapter(db, id)
  assert.equal(c.translation, "แปลรอบสอง")
  assert.equal(c.translated_at, T2)
  assert.equal(c.published, 1)
  assert.equal(c.published_at, T1)
})

test("applyTranslation: ตอนที่เผยแพร่อยู่แล้วยังเผยแพร่ต่อเมื่อแปลใหม่ และ published_at ไม่เปลี่ยน (คำแปลเดิมแสดงอยู่จนกว่าคำแปลใหม่เสร็จ)", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { translation: "คำแปลเดิม", status: "translating", published: true, publishedAt: "2026-02-01 08:00:00" })
  applyTranslation(db, id, { translation: "คำแปลใหม่", now: T1 })
  const c = getChapter(db, id)
  assert.equal(c.translation, "คำแปลใหม่")
  assert.equal(c.published, 1)
  assert.equal(c.published_at, "2026-02-01 08:00:00")
})

test("applyTranslation: titleTh ใส่เฉพาะเมื่อตอนนั้นยังไม่มีชื่อไทย ค่าที่เจ้าของตั้งไว้ไม่ถูกทับ และตัดช่องว่างหัวท้าย", () => {
  const { db, novelId } = setup()
  const empty = seedChapter(db, novelId, 1, { titleTh: "" })
  const owned = seedChapter(db, novelId, 2, { titleTh: "ชื่อที่เจ้าของตั้ง" })
  const blankGiven = seedChapter(db, novelId, 3, { titleTh: "" })
  const none = seedChapter(db, novelId, 4, { titleTh: "" })
  applyTranslation(db, empty, { translation: "x", titleTh: "  ชื่อจาก AI \n", now: T1 })
  applyTranslation(db, owned, { translation: "x", titleTh: "ชื่อจาก AI", now: T1 })
  applyTranslation(db, blankGiven, { translation: "x", titleTh: "   ", now: T1 })
  applyTranslation(db, none, { translation: "x", now: T1 })
  assert.equal(getChapter(db, empty).title_th, "ชื่อจาก AI")
  assert.equal(getChapter(db, owned).title_th, "ชื่อที่เจ้าของตั้ง")
  assert.equal(getChapter(db, blankGiven).title_th, "")
  assert.equal(getChapter(db, none).title_th, "")
})

test("applyTranslation: recap undefined = ไม่แตะ, ข้อความ = ตั้งค่า (ตัดช่องว่าง), null หรือข้อความว่าง = ล้างเป็น NULL", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { recap: "เรื่องย่อเดิม" })
  applyTranslation(db, id, { translation: "x", now: T1 })
  assert.equal(getChapter(db, id).recap, "เรื่องย่อเดิม")
  applyTranslation(db, id, { translation: "x", recap: "  เรื่องย่อใหม่\n", now: T1 })
  assert.equal(getChapter(db, id).recap, "เรื่องย่อใหม่")
  applyTranslation(db, id, { translation: "x", recap: null, now: T1 })
  assert.equal(getChapter(db, id).recap, null)
  applyTranslation(db, id, { translation: "x", recap: "ตั้งใหม่", now: T1 })
  applyTranslation(db, id, { translation: "x", recap: "   \n", now: T1 })
  assert.equal(getChapter(db, id).recap, null)
})

test("applyTranslation: terms เข้าอภิธานเป็น auto=1 ด้วย INSERT OR IGNORE ไม่ทับคำเดิมทั้งของเจ้าของ (auto=0) และที่ AI ใส่ไว้ก่อน", () => {
  const { db, novelId } = setup()
  seedGlossary(db, novelId, [
    { source: "Ayla", thai: "ไอร่า", note: "เจ้าของตั้ง", auto: false },
    { source: "Zed", thai: "เซด", auto: true },
  ])
  const id = seedChapter(db, novelId, 1)
  const ok = applyTranslation(db, id, {
    translation: "x",
    now: T1,
    terms: [
      { source: "Ayla", thai: "อายล่า", note: "AI" }, // ซ้ำกับของเจ้าของ
      { source: "Zed", thai: "เซ็ด" }, // ซ้ำกับที่ AI ใส่ไว้ก่อน
      { source: "Rook", thai: "รุก", note: "เมือง" }, // ใหม่
      { source: "Rook", thai: "รูค" }, // ซ้ำในชุดเดียวกัน อันแรกชนะ
    ],
  })
  assert.equal(ok, true)
  assert.deepEqual(glossaryOf(db, novelId), [
    { source: "Ayla", thai: "ไอร่า", note: "เจ้าของตั้ง", auto: 0 },
    { source: "Rook", thai: "รุก", note: "เมือง", auto: 1 },
    { source: "Zed", thai: "เซด", note: "", auto: 1 },
  ])
})

test("applyTranslation: terms ตัดช่องว่าง ข้ามรายการที่ source หรือ thai ว่าง ไม่มี note ได้เป็นข้อความว่าง", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  applyTranslation(db, id, {
    translation: "x",
    now: T1,
    terms: [
      { source: "  Mage  ", thai: " จอมเวท ", note: "  ผู้ใช้เวทมนตร์ " },
      { source: "", thai: "ไม่มีต้นฉบับ" },
      { source: "   ", thai: "ช่องว่างล้วน" },
      { source: "NoThai", thai: "  " },
    ],
  })
  assert.deepEqual(glossaryOf(db, novelId), [{ source: "Mage", thai: "จอมเวท", note: "ผู้ใช้เวทมนตร์", auto: 1 }])
})

test("applyTranslation: terms เข้าอภิธานของเรื่องเดียวกับตอนนั้น ไม่ใช่เรื่องอื่น", () => {
  const { db, novelId: a } = setup()
  const b = seedNovel(db, { title: "Other" })
  const chapterOfB = seedChapter(db, b, 1)
  applyTranslation(db, chapterOfB, { translation: "x", now: T1, terms: [{ source: "Ayla", thai: "ไอร่า" }] })
  assert.deepEqual(glossaryOf(db, a), [])
  assert.deepEqual(glossaryOf(db, b), [{ source: "Ayla", thai: "ไอร่า", note: "", auto: 1 }])
})

test("applyTranslation: ตอนถูกลบไปแล้วคืน false ไม่ throw ไม่เขียนอภิธาน", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  db.run("DELETE FROM chapters WHERE id = ?", id)
  assert.equal(applyTranslation(db, id, { translation: "x", now: T1, terms: [{ source: "A", thai: "เอ" }] }), false)
  assert.equal(applyTranslation(db, 99999, { translation: "x", now: T1 }), false)
  assert.deepEqual(glossaryOf(db, novelId), [])
})

test("applyTranslation: คำแปลว่างเปล่าหรือมีแต่ช่องว่างถือเป็นความผิดพลาดของผู้เรียก — throw และไม่แตะแถว (done ต้องมีคำแปลเสมอ)", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { status: "translating", queueSeq: 3 })
  for (const translation of ["", "  \n\t "]) {
    assert.throws(() => applyTranslation(db, id, { translation, now: T1 }), /คำแปลว่าง/)
  }
  const c = getChapter(db, id)
  assert.equal(c.status, "translating")
  assert.equal(c.queue_seq, 3)
  assert.equal(c.translation, "")
})

test("applyTranslation: เป็นธุรกรรมเดียว — ถ้าบันทึกคำศัพท์ล้มกลางทาง ตอนไม่ถูกเปลี่ยนครึ่งๆ กลางๆ", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { status: "translating", queueSeq: 3 })
  db.exec("DROP TABLE glossary")
  assert.throws(() => applyTranslation(db, id, { translation: "x", publish: true, now: T1, terms: [{ source: "A", thai: "เอ" }] }), /glossary/)
  const c = getChapter(db, id)
  assert.equal(c.status, "translating")
  assert.equal(c.translation, "")
  assert.equal(c.published, 0)
  assert.equal(c.queue_seq, 3)
})

// ───────────────────────── enqueueChapters ─────────────────────────

test("enqueueChapters: เรียงตาม (novel_id, number) ไม่ใช่ลำดับ id หรือลำดับที่ส่งมา และเลข queue_seq เริ่มที่ 1 เมื่อคิวว่าง", () => {
  const { db, novelId: a } = setup()
  const b = seedNovel(db, { title: "B" })
  // สร้างสลับเลขตอนและสลับเรื่อง เพื่อให้ลำดับ id ต่างจากลำดับ (novel_id, number)
  const b2 = seedChapter(db, b, 2)
  const a3 = seedChapter(db, a, 3)
  const a1 = seedChapter(db, a, 1)
  const b1 = seedChapter(db, b, 1)
  const a2 = seedChapter(db, a, 2)
  const r = enqueueChapters(db, [a2, b1, a1, b2, a3], { autoPublish: false, now: T1 })
  assert.deepEqual(r, { queued: [a1, a2, a3, b1, b2], skipped: [] })
  const seqs = [a1, a2, a3, b1, b2].map((id) => getChapter(db, id).queue_seq)
  assert.deepEqual(seqs, [1, 2, 3, 4, 5])
})

test("enqueueChapters: queue_seq ต่อจากค่าสูงสุดที่มีอยู่ในคิว", () => {
  const { db, novelId } = setup()
  seedChapter(db, novelId, 1, { status: "queued", queueSeq: 7 })
  seedChapter(db, novelId, 2, { status: "queued", queueSeq: 4 })
  const c3 = seedChapter(db, novelId, 3)
  const c4 = seedChapter(db, novelId, 4)
  const r = enqueueChapters(db, [c4, c3], { autoPublish: false, now: T1 })
  assert.deepEqual(r.queued, [c3, c4])
  assert.equal(getChapter(db, c3).queue_seq, 8)
  assert.equal(getChapter(db, c4).queue_seq, 9)
})

test("enqueueChapters: ข้ามตอนที่ queued/translating อยู่แล้วและ id ที่ไม่มี (ตามลำดับที่ส่งมา) ไม่แตะแถวเหล่านั้น และ id ซ้ำนับครั้งเดียว", () => {
  const { db, novelId } = setup()
  const q = seedChapter(db, novelId, 1, { status: "queued", queueSeq: 3, autoPublish: true })
  const t = seedChapter(db, novelId, 2, { status: "translating" })
  const d = seedChapter(db, novelId, 3)
  const r = enqueueChapters(db, [q, t, 99999, d, d, q], { autoPublish: false, now: T1 })
  assert.deepEqual(r, { queued: [d], skipped: [q, t, 99999] })
  const qRow = getChapter(db, q)
  assert.equal(qRow.queue_seq, 3)
  assert.equal(qRow.auto_publish, 1) // ไม่ถูกเขียนทับด้วยค่าของคำสั่งนี้
  assert.equal(qRow.updated_at, T0)
  const tRow = getChapter(db, t)
  assert.equal(tRow.status, "translating")
  assert.equal(tRow.queue_seq, null)
  assert.equal(getChapter(db, d).queue_seq, 4)
})

test("enqueueChapters: ตั้ง status queued, auto_publish ตามที่สั่ง, ล้าง error, updated_at = now (ทั้งตอนร่างและตอนที่ผิดพลาด)", () => {
  for (const autoPublish of [true, false]) {
    const { db, novelId } = setup()
    const draft = seedChapter(db, novelId, 1, { autoPublish: !autoPublish })
    const failed = seedChapter(db, novelId, 2, { status: "error", error: "ล้มเหลวเมื่อวาน", autoPublish: !autoPublish })
    const r = enqueueChapters(db, [draft, failed], { autoPublish, now: T1 })
    assert.deepEqual(r.queued, [draft, failed])
    for (const id of [draft, failed]) {
      const c = getChapter(db, id)
      assert.equal(c.status, "queued", `autoPublish=${autoPublish}`)
      assert.equal(c.auto_publish, autoPublish ? 1 : 0, `autoPublish=${autoPublish}`)
      assert.equal(c.error, "")
      assert.equal(c.updated_at, T1)
    }
  }
})

test("enqueueChapters: ตอนที่แปลเสร็จแล้ว (done) ถูกสั่งแปลใหม่ได้ โดยคำแปลเดิม สถานะเผยแพร่ และเวลาแปลเดิมยังอยู่ครบ", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, {
    status: "done",
    translation: "คำแปลเดิม",
    translatedAt: "2026-02-01 08:00:00",
    published: true,
    publishedAt: "2026-02-02 09:00:00",
    recap: "เรื่องย่อเดิม",
  })
  assert.deepEqual(enqueueChapters(db, [id], { autoPublish: false, now: T1 }), { queued: [id], skipped: [] })
  const c = getChapter(db, id)
  assert.equal(c.status, "queued")
  assert.equal(c.translation, "คำแปลเดิม")
  assert.equal(c.translated_at, "2026-02-01 08:00:00")
  assert.equal(c.published, 1)
  assert.equal(c.published_at, "2026-02-02 09:00:00")
  assert.equal(c.recap, "เรื่องย่อเดิม")
})

test("enqueueChapters: รายการว่างไม่ทำอะไรและไม่ throw", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  assert.deepEqual(enqueueChapters(db, [], { autoPublish: true, now: T1 }), { queued: [], skipped: [] })
  assert.equal(getChapter(db, id).status, "draft")
})

test("enqueueChapters: เป็นธุรกรรมเดียว — ล้มกลางทางแล้วไม่มีตอนไหนเข้าคิวค้าง", () => {
  const { db, novelId } = setup()
  const ids = [1, 2, 3].map((n) => seedChapter(db, novelId, n))
  db.exec("CREATE TRIGGER boom BEFORE UPDATE ON chapters WHEN NEW.number = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END")
  assert.throws(() => enqueueChapters(db, ids, { autoPublish: true, now: T1 }), /boom/)
  for (const id of ids) {
    const c = getChapter(db, id)
    assert.equal(c.status, "draft")
    assert.equal(c.queue_seq, null)
    assert.equal(c.auto_publish, 0)
  }
})

// ───────────────────────── setPublished ─────────────────────────

test("setPublished(true): เผยแพร่ตอนที่มีคำแปล ตั้ง published_at/updated_at (แม้เรื่องยังไม่เผยแพร่ — เรื่องกับตอนเปิดแยกกัน)", () => {
  const { db, novelId } = setup() // เรื่องที่ seed ให้ published=0
  const a = seedChapter(db, novelId, 1, { translation: "แปล 1" })
  const b = seedChapter(db, novelId, 2, { translation: "แปล 2" })
  assert.deepEqual(setPublished(db, [a, b], true, T1), { changed: 2, skipped: 0 })
  for (const id of [a, b]) {
    const c = getChapter(db, id)
    assert.equal(c.published, 1)
    assert.equal(c.published_at, T1)
    assert.equal(c.updated_at, T1)
  }
})

test("setPublished(true): ตอนที่ไม่มีคำแปลและ id ที่ไม่มีถูกข้ามและนับใน skipped ตอนเหล่านั้นไม่ถูกเผยแพร่", () => {
  const { db, novelId } = setup()
  const ok = seedChapter(db, novelId, 1, { translation: "แปลแล้ว" })
  const empty = seedChapter(db, novelId, 2, { translation: "" })
  const r = setPublished(db, [ok, empty, 99999], true, T1)
  assert.deepEqual(r, { changed: 1, skipped: 2 })
  assert.equal(getChapter(db, empty).published, 0)
  assert.equal(getChapter(db, empty).published_at, null)
  assert.equal(getChapter(db, empty).updated_at, T0)
})

test("setPublished: ตอนที่อยู่ในสถานะนั้นอยู่แล้วไม่นับทั้ง changed และ skipped และไม่ถูกแตะ (published_at/updated_at เดิม)", () => {
  const { db, novelId } = setup()
  const shown = seedChapter(db, novelId, 1, { translation: "แปล", published: true, publishedAt: "2026-02-01 08:00:00" })
  const hiddenAlready = seedChapter(db, novelId, 2, { translation: "แปล", published: false })
  assert.deepEqual(setPublished(db, [shown], true, T1), { changed: 0, skipped: 0 })
  assert.deepEqual(setPublished(db, [hiddenAlready], false, T1), { changed: 0, skipped: 0 })
  const c = getChapter(db, shown)
  assert.equal(c.published_at, "2026-02-01 08:00:00")
  assert.equal(c.updated_at, T0)
  assert.equal(getChapter(db, hiddenAlready).updated_at, T0)
})

test("setPublished(false): ซ่อนตอนได้ เก็บ published_at ครั้งแรกไว้ นับเฉพาะตอนที่เปลี่ยนจริง และซ่อนตอนที่ไม่มีคำแปลได้ด้วย", () => {
  const { db, novelId } = setup()
  const shown = seedChapter(db, novelId, 1, { translation: "แปล", published: true, publishedAt: "2026-02-01 08:00:00" })
  const odd = seedChapter(db, novelId, 2, { translation: "", published: true, publishedAt: "2026-02-02 08:00:00" }) // สภาพผิดปกติที่ยังต้องซ่อนได้
  const never = seedChapter(db, novelId, 3, { translation: "แปล" })
  const r = setPublished(db, [shown, odd, never, 99999], false, T1)
  assert.deepEqual(r, { changed: 2, skipped: 1 }) // 99999 ไม่มี → skipped; never อยู่ในสถานะซ่อนอยู่แล้ว
  for (const id of [shown, odd]) {
    const c = getChapter(db, id)
    assert.equal(c.published, 0)
    assert.equal(c.updated_at, T1)
  }
  assert.equal(getChapter(db, shown).published_at, "2026-02-01 08:00:00")
  assert.equal(getChapter(db, odd).published_at, "2026-02-02 08:00:00")
})

test("setPublished: เผยแพร่ใหม่หลังซ่อน published_at ยังเป็นเวลาที่เผยแพร่ครั้งแรก", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { translation: "แปล" })
  setPublished(db, [id], true, T1)
  setPublished(db, [id], false, T2)
  assert.deepEqual(setPublished(db, [id], true, "2026-03-03 10:00:00"), { changed: 1, skipped: 0 })
  const c = getChapter(db, id)
  assert.equal(c.published, 1)
  assert.equal(c.published_at, T1)
  assert.equal(c.updated_at, "2026-03-03 10:00:00")
})

test("setPublished: id ซ้ำนับครั้งเดียว และรายการว่างได้ 0/0", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1, { translation: "แปล" })
  const none = seedChapter(db, novelId, 2, { translation: "" })
  assert.deepEqual(setPublished(db, [id, id, none, none, 99999, 99999], true, T1), { changed: 1, skipped: 2 })
  assert.deepEqual(setPublished(db, [], true, T1), { changed: 0, skipped: 0 })
})

test("setPublished: เป็นธุรกรรมเดียว — ล้มกลางทางแล้วไม่มีตอนไหนถูกเผยแพร่ค้าง", () => {
  const { db, novelId } = setup()
  const ids = [1, 2, 3].map((n) => seedChapter(db, novelId, n, { translation: "แปล" }))
  db.exec("CREATE TRIGGER boom BEFORE UPDATE ON chapters WHEN NEW.number = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END")
  assert.throws(() => setPublished(db, ids, true, T1), /boom/)
  for (const id of ids) {
    const c = getChapter(db, id)
    assert.equal(c.published, 0)
    assert.equal(c.published_at, null)
  }
})

// ───────────────────────── recordUsage ─────────────────────────

const usageRows = (db: Db) =>
  db.all<{ day: string; model: string; tokens_in: number; tokens_out: number; calls: number }>("SELECT * FROM usage ORDER BY day, model")

test("recordUsage: เรียกสองครั้งวันเดียว/โมเดลเดียวกันได้แถวเดียว บวกโทเคนและ calls = 2", () => {
  const { db } = setup()
  recordUsage(db, "2026-10-22", "m-a", { inputTokens: 100, outputTokens: 40 })
  recordUsage(db, "2026-10-22", "m-a", { inputTokens: 25, outputTokens: 5 })
  assert.deepEqual(usageRows(db), [{ day: "2026-10-22", model: "m-a", tokens_in: 125, tokens_out: 45, calls: 2 }])
})

test("recordUsage: ต่างโมเดลหรือต่างวันแยกแถวกัน", () => {
  const { db } = setup()
  recordUsage(db, "2026-10-22", "m-a", { inputTokens: 1, outputTokens: 2 })
  recordUsage(db, "2026-10-22", "m-b", { inputTokens: 10, outputTokens: 20 })
  recordUsage(db, "2026-10-23", "m-a", { inputTokens: 100, outputTokens: 200 })
  assert.deepEqual(usageRows(db), [
    { day: "2026-10-22", model: "m-a", tokens_in: 1, tokens_out: 2, calls: 1 },
    { day: "2026-10-22", model: "m-b", tokens_in: 10, tokens_out: 20, calls: 1 },
    { day: "2026-10-23", model: "m-a", tokens_in: 100, tokens_out: 200, calls: 1 },
  ])
})

test("recordUsage: การเรียกที่ใช้ 0 โทเคนก็นับเป็น 1 ครั้ง", () => {
  const { db } = setup()
  recordUsage(db, "2026-10-22", "m-a", { inputTokens: 0, outputTokens: 0 })
  recordUsage(db, "2026-10-22", "m-a", { inputTokens: 0, outputTokens: 0 })
  assert.deepEqual(usageRows(db), [{ day: "2026-10-22", model: "m-a", tokens_in: 0, tokens_out: 0, calls: 2 }])
})

// ───────────────────────── buildContext ─────────────────────────

test("buildContext: ตอนที่ไม่มีอยู่ได้ null (รวมตอนกำพร้าที่เรื่องหายไปแล้ว เช่นฐานข้อมูลที่ปิด foreign key)", () => {
  const { db, novelId } = setup()
  const id = seedChapter(db, novelId, 1)
  db.run("DELETE FROM chapters WHERE id = ?", id)
  assert.equal(buildContext(db, id), null)
  assert.equal(buildContext(db, 99999), null)

  const orphan = seedChapter(db, novelId, 2)
  db.exec("PRAGMA foreign_keys = OFF")
  db.run("DELETE FROM novels WHERE id = ?", novelId)
  assert.equal(buildContext(db, orphan), null)
})

test("buildContext: คืนเรื่อง ตอน และอภิธานทั้งหมดของเรื่องนั้น (ทั้งที่เจ้าของใส่และที่ AI สกัด) เรียงตาม id ไม่ปนเรื่องอื่น", () => {
  const { db, novelId } = setup()
  const other = seedNovel(db, { title: "Other" })
  seedGlossary(db, novelId, [
    { source: "Rook", thai: "รุก", auto: true },
    { source: "Ayla", thai: "ไอร่า", note: "ตัวเอก", auto: false },
  ])
  seedGlossary(db, other, [{ source: "Nope", thai: "ไม่เกี่ยว" }])
  const id = seedChapter(db, novelId, 3, { source: "ต้นฉบับตอนปัจจุบัน" })
  const ctx = buildContext(db, id)!
  assert.equal(ctx.novel.id, novelId)
  assert.equal(ctx.novel.title, "Test Novel")
  assert.equal(ctx.chapter.id, id)
  assert.equal(ctx.chapter.source_text, "ต้นฉบับตอนปัจจุบัน")
  assert.deepEqual(
    ctx.glossary.map((g) => [g.source, g.thai, g.note, g.auto]),
    [
      ["Rook", "รุก", "", 1],
      ["Ayla", "ไอร่า", "ตัวเอก", 0],
    ],
  )
})

test("buildContext: recaps = ตอนก่อนหน้าของเรื่องเดียวกันที่มีเรื่องย่อ ไม่เกิน 5 ตอนล่าสุด เรียงเลขน้อยไปมาก ไม่รวมตอนปัจจุบัน ตอนที่เลขมากกว่า และเรื่องอื่น", () => {
  const { db, novelId } = setup()
  const other = seedNovel(db, { title: "Other" })
  for (const n of [1, 2, 3, 4, 5, 6]) seedChapter(db, novelId, n, { recap: `สรุป ${n}` })
  seedChapter(db, novelId, 7, { recap: null }) // ไม่มีเรื่องย่อ: ข้าม และไม่กินโควตา 5 ตอน
  seedChapter(db, novelId, 8, { recap: "  \n" }) // มีแต่ช่องว่าง: ถือว่าไม่มี
  const current = seedChapter(db, novelId, 9, { recap: "สรุปของตอนปัจจุบันเอง" })
  seedChapter(db, novelId, 10, { recap: "สรุป 10 (ตอนถัดไป)" })
  seedChapter(db, other, 3, { recap: "สรุปของเรื่องอื่น" })
  const ctx = buildContext(db, current)!
  assert.deepEqual(
    ctx.recaps.map((r) => r.number),
    [2, 3, 4, 5, 6],
  )
  assert.deepEqual(ctx.recaps[0], { number: 2, recap: "สรุป 2" })
})

test("buildContext: เลขตอนมีช่องว่างได้ และน้อยกว่า 5 ตอนก็ได้เท่าที่มี (ตัดช่องว่างหัวท้ายของเรื่องย่อ)", () => {
  const { db, novelId } = setup()
  seedChapter(db, novelId, 1, { recap: " สรุป 1 \n" })
  seedChapter(db, novelId, 5, { recap: "สรุป 5" })
  const current = seedChapter(db, novelId, 10)
  assert.deepEqual(buildContext(db, current)!.recaps, [
    { number: 1, recap: "สรุป 1" },
    { number: 5, recap: "สรุป 5" },
  ])
  const first = db.get<{ id: number }>("SELECT id FROM chapters WHERE novel_id = ? AND number = 1", novelId)!.id
  assert.deepEqual(buildContext(db, first)!.recaps, [])
})

test("buildContext: system เท่ากับ buildSystem ของข้อมูลชุดเดียวกัน (ชื่อเรื่องต้นฉบับ โหมด สไตล์ อภิธาน เรื่องย่อ)", () => {
  for (const mode of ["translate", "story"] as const) {
    const { db } = setup()
    const novelId = seedNovel(db, { title: "Dungeon Hermit", titleTh: "ฤๅษีดันเจี้ยน", mode, styleNote: "เล่าเหมือนเพื่อนเล่าให้ฟัง" })
    seedGlossary(db, novelId, [
      { source: "Ayla", thai: "ไอร่า", note: "ตัวเอก" },
      { source: "Rook", thai: "รุก", auto: true },
    ])
    seedChapter(db, novelId, 1, { recap: "ไอร่าเข้าดันเจี้ยน" })
    seedChapter(db, novelId, 2, { recap: "รุกปรากฏตัว" })
    const current = seedChapter(db, novelId, 3)
    const expected = buildSystem({
      mode,
      novelTitle: "Dungeon Hermit",
      styleNote: "เล่าเหมือนเพื่อนเล่าให้ฟัง",
      glossary: [
        { source: "Ayla", thai: "ไอร่า", note: "ตัวเอก" },
        { source: "Rook", thai: "รุก", note: "" },
      ],
      recaps: [
        { number: 1, recap: "ไอร่าเข้าดันเจี้ยน" },
        { number: 2, recap: "รุกปรากฏตัว" },
      ],
    })
    assert.equal(buildContext(db, current)!.system, expected, `mode=${mode}`)
  }
})
