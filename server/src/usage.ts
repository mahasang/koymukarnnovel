import type { Usage } from "./ai.js"
import type { Db } from "./db.js"

/** บันทึกโทเคนของการเรียก Claude หนึ่งครั้งลงยอดรายวันของโมเดลนั้น (`day` นับตามเวลา UTC+7 ผู้เรียกส่ง `dayKey(...)` มา) */
export function recordUsage(db: Db, day: string, model: string, u: Usage): void {
  db.run(
    `INSERT INTO usage (day, model, tokens_in, tokens_out, calls) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (day, model) DO UPDATE SET tokens_in = tokens_in + excluded.tokens_in,
                                            tokens_out = tokens_out + excluded.tokens_out,
                                            calls = calls + 1`,
    day,
    model,
    u.inputTokens,
    u.outputTokens,
  )
}
