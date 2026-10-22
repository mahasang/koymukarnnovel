import type { Db } from "./db.js"
import type { Term } from "./types.js"

/**
 * เงื่อนไขของ "ตอนที่ผู้อ่านเห็น" ต่อท้าย WHERE ของคำสั่งที่ตั้งชื่อ chapters ว่า `c` และ novels ว่า `n`
 * (ตอนต้องเผยแพร่ + มีคำแปล + เรื่องต้องเผยแพร่) เป็นที่เดียวที่นิยามเรื่องนี้ เพื่อให้หน้าสาธารณะทุกจุดตรงกัน
 */
export const VISIBLE_SQL = "c.published = 1 AND c.translation <> '' AND n.published = 1"

export interface TranslationResult {
  translation: string
  /** ใส่ให้เฉพาะเมื่อ `title_th` ของตอนยังว่าง (ชื่อที่เจ้าของตั้งเองมาก่อนเสมอ) */
  titleTh?: string
  /** undefined = ไม่แตะ, ข้อความ = ตั้งค่า, null (หรือข้อความว่าง) = ล้าง */
  recap?: string | null
  /** เข้าอภิธานเป็น auto=1 ด้วย INSERT OR IGNORE ไม่ทับคำเดิม */
  terms?: Term[]
  /** ผู้เรียกเป็นคนตัดสิน (คิวส่ง auto_publish ของตอน, ช่องทางนำเข้าไม่ส่ง) ฟังก์ชันนี้ไม่อ่าน `auto_publish` เอง */
  publish?: boolean
  now: string
}

/**
 * บันทึกผลการแปลของตอนเป็นธุรกรรมเดียว: คำแปล เวลาแปล `done` ล้าง error ออกจากคิว (+ชื่อไทย เรื่องย่อ ศัพท์ ตามที่ส่งมา)
 * ตอนที่เผยแพร่อยู่แล้วยังเผยแพร่ต่อ (คำแปลเดิมแสดงอยู่จนกว่าจะแทนที่) คืน false ถ้าแถวหายไปแล้ว;
 * คำแปลว่างเปล่า throw เพราะ `done` ต้องมีเนื้อหาให้อ่านเสมอ ผู้เรียกต้องตรวจก่อน
 */
export function applyTranslation(db: Db, chapterId: number, p: TranslationResult): boolean {
  if (p.translation.trim() === "") throw new Error("applyTranslation: คำแปลว่างเปล่า")
  return db.tx(() => {
    const row = db.get<{ novel_id: number; title_th: string; recap: string | null }>(
      "SELECT novel_id, title_th, recap FROM chapters WHERE id = ?",
      chapterId,
    )
    if (!row) return false

    const titleTh = row.title_th === "" ? (p.titleTh ?? "").trim() : row.title_th
    const recap = p.recap === undefined ? row.recap : p.recap?.trim() || null
    db.run(
      `UPDATE chapters SET translation = ?, translated_at = ?, status = 'done', error = '', queue_seq = NULL,
                           title_th = ?, recap = ?, updated_at = ? WHERE id = ?`,
      p.translation,
      p.now,
      titleTh,
      recap,
      p.now,
      chapterId,
    )
    if (p.publish) {
      db.run("UPDATE chapters SET published = 1, published_at = COALESCE(published_at, ?) WHERE id = ?", p.now, chapterId)
    }
    for (const term of p.terms ?? []) {
      const source = term.source.trim()
      const thai = term.thai.trim()
      if (source === "" || thai === "") continue
      db.run(
        "INSERT OR IGNORE INTO glossary (novel_id, source, thai, note, auto) VALUES (?, ?, ?, ?, 1)",
        row.novel_id,
        source,
        thai,
        (term.note ?? "").trim(),
      )
    }
    return true
  })
}

/**
 * ส่งตอนเข้าคิวแปล: เรียงตาม (novel_id, number) ได้ `queue_seq` ต่อจากค่าสูงสุด ข้ามตอนที่ `queued`/`translating` อยู่แล้ว
 * และ id ที่ไม่มี (อยู่ใน `skipped` ตามลำดับที่ส่งมา) ตอน `done` ที่แปลใหม่ยังเก็บคำแปลและสถานะเผยแพร่เดิมไว้
 */
export function enqueueChapters(db: Db, ids: number[], o: { autoPublish: boolean; now: string }): { queued: number[]; skipped: number[] } {
  return db.tx(() => {
    const eligible: { id: number; novel_id: number; number: number }[] = []
    const skipped: number[] = []
    for (const id of new Set(ids)) {
      const row = db.get<{ id: number; novel_id: number; number: number; status: string }>(
        "SELECT id, novel_id, number, status FROM chapters WHERE id = ?",
        id,
      )
      if (!row || row.status === "queued" || row.status === "translating") skipped.push(id)
      else eligible.push(row)
    }
    eligible.sort((a, b) => a.novel_id - b.novel_id || a.number - b.number)

    let seq = db.get<{ top: number }>("SELECT COALESCE(MAX(queue_seq), 0) AS top FROM chapters")!.top
    for (const c of eligible) {
      db.run(
        "UPDATE chapters SET status = 'queued', queue_seq = ?, auto_publish = ?, error = '', updated_at = ? WHERE id = ?",
        ++seq,
        o.autoPublish,
        o.now,
        c.id,
      )
    }
    return { queued: eligible.map((c) => c.id), skipped }
  })
}

/**
 * เผยแพร่/ซ่อนหลายตอน: เผยแพร่เฉพาะตอนที่มีคำแปล (ที่ไม่มีและ id ที่ไม่มีนับใน `skipped`) ตอนที่อยู่ในสถานะนั้นอยู่แล้วไม่ถูกแตะและไม่นับ
 * `published_at` เป็นเวลาที่เผยแพร่ครั้งแรกและไม่เปลี่ยนอีก (แม้ซ่อนแล้วเผยแพร่ใหม่) การซ่อนทำได้เสมอ
 */
export function setPublished(db: Db, ids: number[], publish: boolean, now: string): { changed: number; skipped: number } {
  return db.tx(() => {
    let changed = 0
    let skipped = 0
    for (const id of new Set(ids)) {
      const row = db.get<{ published: number; translation: string }>("SELECT published, translation FROM chapters WHERE id = ?", id)
      if (!row || (publish && row.translation === "")) {
        skipped++
        continue
      }
      if (row.published === (publish ? 1 : 0)) continue
      db.run(
        "UPDATE chapters SET published = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?",
        publish,
        publish,
        now,
        now,
        id,
      )
      changed++
    }
    return { changed, skipped }
  })
}
