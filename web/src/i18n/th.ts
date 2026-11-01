/**
 * ข้อความ UI ภาษาไทย — ต้นแบบของรูปร่างข้อความทั้งหมด (`Messages = typeof th`): en.ts / lo.ts ต้องมีโครงเดียวกัน ขาดข้อความไหน compile ไม่ผ่าน
 * ข้อความที่มีพารามิเตอร์เป็นฟังก์ชันรับตัวเลข/ข้อความล้วนๆ (เทสต์เรียกด้วย 7 ทุกพารามิเตอร์ ผลต้องมี "7")
 */
import type { Locale } from "./types"

export const th = {
  /** รหัสภาษาของชุดข้อความนี้ (ให้ฟังก์ชันที่รับแค่ `m` เลือกรูปแบบวันที่ได้) */
  locale: "th" as Locale,
  lang: { menuLabel: "ภาษา" },
  time: {
    justNow: "เมื่อสักครู่",
    minutesAgo: (n: number) => `${n} นาทีที่แล้ว`,
    hoursAgo: (n: number) => `${n} ชั่วโมงที่แล้ว`,
    yesterday: "เมื่อวาน",
    daysAgo: (n: number) => `${n} วันที่แล้ว`,
    weeksAgo: (n: number) => `${n} สัปดาห์ที่แล้ว`,
  },
}
