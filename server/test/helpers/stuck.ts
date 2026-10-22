import type { TickResult } from "../../src/queue.js"
import type { TestApp } from "./app.js"
import type { FakeAi } from "./fake-ai.js"

/**
 * เริ่มแปลตอนแรกของ `ids` ด้วยคิวจริงแล้วค้างกลางสตรีม (AI ปลอมหน่วง 5 วินาทีที่ยกเลิกได้ด้วย signal) คืน promise ของ `tick()` ที่ยังไม่จบ
 * ตอนถัดไปในคิวรอคิวอยู่ ใช้ทดสอบสิ่งที่ต้องเห็นตอนมีตอนกำลังแปลจริง (ลบกลางสตรีม, สถานะคิวสด) เรียกจบได้ด้วยการยกเลิกหรือปิดแอป
 */
export async function startStuckTranslation(t: TestApp<FakeAi>, ids: number[]): Promise<{ tick: Promise<TickResult> }> {
  let enter!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  t.ai.script.translate = () => {
    enter()
    return { pieces: ["กำลังแปล…"], delayMs: 5000 }
  }
  t.queue.enqueue(ids, { autoPublish: true })
  const tick = t.queue.tick()
  await entered
  return { tick } // ห่อไว้: ถ้าคืน promise ตรงๆ ฟังก์ชัน async จะรอจนมันจบ ซึ่งต้องรอให้ถูกยกเลิกก่อน
}
