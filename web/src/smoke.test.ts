import { test } from "node:test"
import assert from "node:assert/strict"

// Task 26 (speech splitting) depends on word-level Thai segmentation being available.
test("Intl.Segmenter splits Thai text into words", () => {
  const segments = Array.from(new Intl.Segmenter("th", { granularity: "word" }).segment("ฉันกำลังเดินไปที่ตลาด"))
  assert.ok(segments.length > 3, `expected more than 3 segments, got ${segments.length}`)
})
