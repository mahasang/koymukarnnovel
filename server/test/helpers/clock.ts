/**
 * นาฬิกาจำลองที่เลื่อนเวลาเองได้ ใช้เป็น `now` ของแอป (เวลาที่เขียนลง DB, อายุเซสชัน, ตัวจำกัดอัตรา)
 * `now()` คืน Date ใหม่ทุกครั้ง จึงไม่มีใครแก้เวลาของนาฬิกาผ่านค่าที่ได้ไปโดยพลาด
 */
export interface Clock {
  now: () => Date
  advance: (ms: number) => void
}

export function createClock(startIso = "2026-10-22T01:02:03Z"): Clock {
  let t = Date.parse(startIso)
  return { now: () => new Date(t), advance: (ms) => void (t += ms) }
}
