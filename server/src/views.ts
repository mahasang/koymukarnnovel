import { createHash, randomBytes } from "node:crypto"
import type { Db } from "./db.js"
import type { Logger } from "./util/log.js"
import { dayKey } from "./util/time.js"

/** เพดานจำนวนคีย์ที่จำไว้ในหน่วยความจำ (spec 9.2) */
const DEFAULT_MAX = 200_000

export interface Views {
  /** นับการเปิดอ่านหนึ่งครั้ง: true = นับ (ครั้งแรกของ IP+UA+ตอนนั้นในวันนั้น), false = ซ้ำ หรือบันทึกไม่สำเร็จ */
  record(o: { ip: string; ua: string; novelId: number; chapterId: number }): boolean
  /** จำนวนคีย์ที่จำอยู่ในหน่วยความจำตอนนี้ */
  size(): number
}

/**
 * นับยอดอ่านรายวันรายเรื่องโดยไม่เก็บ IP/UA ลงดิสก์ (spec 9.2): จำเฉพาะแฮช sha256(ip, ua, ตอน, เกลือประจำวัน) ไว้ในหน่วยความจำ
 * เกลือสุ่มใหม่และชุดแฮชถูกล้างเมื่อขึ้นวันใหม่ (เวลา UTC+7) และล้างเมื่อเต็ม `max` (นับเกินได้เล็กน้อย แลกกับเพดานหน่วยความจำ)
 * ฐานข้อมูลพังไม่ทำให้ผู้อ่านเดือดร้อน: คืน false พร้อมเตือนใน log
 */
export function createViews(d: { db: Db; now: () => Date; max?: number; log?: Logger }): Views {
  const max = d.max ?? DEFAULT_MAX
  const seen = new Set<string>()
  let day = ""
  let salt = ""

  return {
    record({ ip, ua, novelId, chapterId }) {
      const today = dayKey(d.now())
      if (today !== day) {
        day = today
        salt = randomBytes(16).toString("base64")
        seen.clear()
      }
      // JSON array ไม่กำกวมเหมือนการต่อสตริงด้วยตัวคั่น (ip "1|a" + ua "2" ไม่ชนกับ ip "1" + ua "a|2")
      const key = createHash("sha256").update(JSON.stringify([ip, ua, chapterId, salt])).digest().subarray(0, 16).toString("base64")
      if (seen.has(key)) return false
      if (seen.size >= max) seen.clear()
      seen.add(key)
      try {
        d.db.run("INSERT INTO views (day, novel_id, count) VALUES (?, ?, 1) ON CONFLICT (day, novel_id) DO UPDATE SET count = count + 1", today, novelId)
        return true
      } catch (e) {
        seen.delete(key)
        d.log?.warn(`บันทึกยอดอ่านไม่สำเร็จ (views): ${e instanceof Error ? e.message : String(e)}`)
        return false
      }
    },
    size: () => seen.size,
  }
}
