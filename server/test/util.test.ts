import { test } from "node:test"
import assert from "node:assert/strict"
import { MODES } from "../src/types.js"
import { nowSql, dayKey, fileStamp } from "../src/util/time.js"
import { normalizeText, escapeHtml, truncate } from "../src/util/text.js"
import { camelize } from "../src/util/camel.js"
import { HttpError, badRequest, notFound, conflict } from "../src/util/errors.js"
import { memoryLogger } from "../src/util/log.js"

test("MODES มีแค่ translate กับ story", () => {
  assert.deepEqual([...MODES], ["translate", "story"])
})

test("nowSql เป็น UTC รูปแบบ YYYY-MM-DD HH:MM:SS", () => {
  assert.equal(nowSql(new Date("2026-10-22T01:02:03.456Z")), "2026-10-22 01:02:03")
  assert.match(nowSql(), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
})

test("dayKey ตัดวันตามเวลา UTC+7", () => {
  assert.equal(dayKey(new Date("2026-10-22T17:00:00Z")), "2026-10-23")
  assert.equal(dayKey(new Date("2026-10-22T16:59:59Z")), "2026-10-22")
})

test("fileStamp เป็น YYYYMMDD-HHMM ตามเวลา UTC+7 (ไว้ตั้งชื่อไฟล์สำรอง)", () => {
  assert.equal(fileStamp(new Date("2026-10-22T01:02:03.999Z")), "20261022-0802")
  assert.equal(fileStamp(new Date("2026-10-22T16:59:59Z")), "20261022-2359")
  assert.equal(fileStamp(new Date("2026-10-22T17:00:00Z")), "20261023-0000")
  assert.equal(fileStamp(new Date("2026-12-31T20:00:00Z")), "20270101-0300")
  assert.equal(fileStamp(new Date("2026-01-05T00:05:00Z")), "20260105-0705")
  assert.equal(fileStamp(new Date("2028-02-28T17:00:00Z")), "20280229-0000") // ปีอธิกสุรทิน
})

test("normalizeText ล้าง BOM, CRLF, NBSP และบรรทัดว่างเกิน (Review Focus 1)", () => {
  assert.equal(normalizeText("\uFEFFa\u00A0b\r\nc\r\n\r\n\r\n\r\nd  \n"), "a b\nc\n\nd")
  assert.equal(normalizeText("a\u200Bb"), "ab")
  assert.equal(normalizeText("a\u2007b\u202Fc"), "a b c")
  assert.equal(normalizeText("a\u00A0\nb"), "a\nb")
  assert.equal(normalizeText("old\rmac\rline"), "old\nmac\nline")
  assert.equal(normalizeText("สวัสดี\n\nโลก"), "สวัสดี\n\nโลก")
  assert.equal(normalizeText("  \n\n"), "")
})

test("escapeHtml แทน & < > \" ' ", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;")
})

test("truncate นับเป็น code point และสั้นกว่า n คืนเดิม", () => {
  assert.equal(truncate("กขคงจ", 3), "กขค…")
  assert.equal(truncate("กขค", 3), "กขค")
  assert.equal(truncate("ab", 5), "ab")
  assert.equal(truncate("😀😀😀😀", 2), "😀😀…")
})

test("camelize แปลง snake_case เป็น camelCase", () => {
  assert.deepEqual(camelize({ title_th: "x", created_at: "y", id: 1 }), { titleTh: "x", createdAt: "y", id: 1 })
})

test("HttpError เก็บ status, code, extra และตัวช่วยตั้งค่าถูกต้อง", () => {
  const e = new HttpError(409, "m", "dup", { a: 1 })
  assert.ok(e instanceof Error)
  assert.equal(e.status, 409)
  assert.equal(e.message, "m")
  assert.equal(e.code, "dup")
  assert.deepEqual(e.extra, { a: 1 })
  const b = badRequest("bad", "invalid")
  assert.deepEqual([b.status, b.message, b.code], [400, "bad", "invalid"])
  const n = notFound()
  assert.equal(n.status, 404)
  assert.match(n.message, /[\u0E00-\u0E7F]/)
  const c = conflict("c", "taken", { id: 3 })
  assert.deepEqual([c.status, c.code, c.extra], [409, "taken", { id: 3 }])
})

test("memoryLogger เก็บบรรทัดขึ้นต้นด้วยระดับ", () => {
  const { logger, lines } = memoryLogger()
  logger.warn("a")
  logger.info("b")
  logger.error("c")
  assert.deepEqual(lines, ["warn: a", "info: b", "error: c"])
})
