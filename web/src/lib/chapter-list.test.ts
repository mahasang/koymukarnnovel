import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  CHAPTERS_PER_PAGE,
  DEFAULT_ORDER,
  INITIAL_LIST,
  ORDER_OPTIONS,
  clampPage,
  firstChapter,
  latestChapter,
  listReducer,
  orderedChapters,
  pageCount,
  pageOf,
  pageSlice,
  parseChapterNumber,
  readAction,
  resolveJump,
} from "./chapter-list"
import { FINISHED_PCT, type Progress } from "./progress"
import type { ChapterItemDto } from "./types"

const chapter = (number: number, over: Partial<ChapterItemDto> = {}): ChapterItemDto => ({
  number,
  title: `Chapter ${number}`,
  titleTh: `ตอน ${number}`,
  publishedAt: "2026-10-01 00:00:00",
  published: true,
  ...over,
})
/** ตอน from..to เรียงจากน้อยไปมาก */
const range = (from: number, to: number): ChapterItemDto[] => Array.from({ length: to - from + 1 }, (_, i) => chapter(from + i))
const numbers = (list: ChapterItemDto[]) => list.map((c) => c.number)
const progress = (over: Partial<Progress> = {}): Progress => ({ number: 12, pct: 40, next: 13, at: 1, ...over })

describe("ค่าคงที่", () => {
  test("50 ตอนต่อหน้า (spec 6.2) · เริ่มที่ ใหม่→เก่า · ตัวเลือกเรียงมีสองแบบตามลำดับในสเปก", () => {
    assert.equal(CHAPTERS_PER_PAGE, 50)
    assert.equal(DEFAULT_ORDER, "desc")
    assert.deepEqual(ORDER_OPTIONS, [
      { key: "desc", label: "ใหม่ → เก่า" },
      { key: "asc", label: "เก่า → ใหม่" },
    ])
  })
})

describe("orderedChapters", () => {
  test("เรียงตามเลขตอน ไม่เชื่อลำดับที่เซิร์ฟเวอร์ส่งมา · ไม่แก้อาร์เรย์เดิม", () => {
    const input = [chapter(3), chapter(1), chapter(2), chapter(0)]
    assert.deepEqual(numbers(orderedChapters(input, "asc")), [0, 1, 2, 3])
    assert.deepEqual(numbers(orderedChapters(input, "desc")), [3, 2, 1, 0])
    assert.deepEqual(numbers(input), [3, 1, 2, 0])
  })

  test("เลขตอนเปรียบเทียบเป็นตัวเลข (10 มากกว่า 9) และตอนที่ 0 อยู่หัว/ท้ายถูกด้าน", () => {
    assert.deepEqual(numbers(orderedChapters([chapter(10), chapter(9), chapter(100), chapter(0)], "asc")), [0, 9, 10, 100])
  })

  test("รายการว่างได้ว่าง", () => {
    assert.deepEqual(orderedChapters([], "asc"), [])
  })
})

describe("pageCount / clampPage", () => {
  test("pageCount: 0 ตอนก็ยังมี 1 หน้า · 50 = 1 · 51 = 2 · 100 = 2 · 101 = 3", () => {
    assert.equal(pageCount(0), 1)
    assert.equal(pageCount(1), 1)
    assert.equal(pageCount(50), 1)
    assert.equal(pageCount(51), 2)
    assert.equal(pageCount(100), 2)
    assert.equal(pageCount(101), 3)
  })

  test("clampPage ตรึงในช่วง 1..จำนวนหน้า · ค่าที่ไม่ใช่จำนวนเต็ม → 1", () => {
    assert.equal(clampPage(0, 120), 1)
    assert.equal(clampPage(-3, 120), 1)
    assert.equal(clampPage(2, 120), 2)
    assert.equal(clampPage(3, 120), 3)
    assert.equal(clampPage(4, 120), 3)
    assert.equal(clampPage(99, 0), 1)
    assert.equal(clampPage(Number.NaN, 120), 1)
    assert.equal(clampPage(1.5, 120), 1)
    assert.equal(clampPage(Number.POSITIVE_INFINITY, 120), 1)
  })
})

describe("pageSlice / pageOf", () => {
  const list = range(1, 120)

  test("ใหม่→เก่า: หน้า 1 = ตอน 120..71 · หน้า 3 = ตอน 20..1 (หน้าสุดท้ายสั้นกว่า)", () => {
    assert.deepEqual(numbers(pageSlice(list, "desc", 1)), range(71, 120).map((c) => c.number).reverse())
    assert.deepEqual(numbers(pageSlice(list, "desc", 3)), range(1, 20).map((c) => c.number).reverse())
  })

  test("เก่า→ใหม่: หน้า 1 = ตอน 1..50 · หน้า 3 = ตอน 101..120", () => {
    assert.deepEqual(numbers(pageSlice(list, "asc", 1)), range(1, 50).map((c) => c.number))
    assert.deepEqual(numbers(pageSlice(list, "asc", 3)), range(101, 120).map((c) => c.number))
  })

  test("หน้าเกินช่วงถูกตรึงเป็นหน้าสุดท้าย / หน้าแรก (ไม่คืนอาร์เรย์ว่าง)", () => {
    assert.deepEqual(numbers(pageSlice(list, "asc", 9)), range(101, 120).map((c) => c.number))
    assert.deepEqual(numbers(pageSlice(list, "asc", 0)), range(1, 50).map((c) => c.number))
  })

  test("รายการว่าง → หน้าว่าง", () => {
    assert.deepEqual(pageSlice([], "desc", 1), [])
  })

  test("pageOf: หน้าที่มีตอนนั้นในแต่ละแบบเรียง (ขอบหน้า 50/51 ถูกด้าน)", () => {
    assert.equal(pageOf(list, "asc", 1), 1)
    assert.equal(pageOf(list, "asc", 50), 1)
    assert.equal(pageOf(list, "asc", 51), 2)
    assert.equal(pageOf(list, "asc", 120), 3)
    assert.equal(pageOf(list, "desc", 120), 1)
    assert.equal(pageOf(list, "desc", 71), 1)
    assert.equal(pageOf(list, "desc", 70), 2)
    assert.equal(pageOf(list, "desc", 1), 3)
  })

  test("pageOf: ตอนที่ 0 หาเจอ · ตอนที่ไม่มีในรายการ → null", () => {
    const withZero = range(0, 60)
    assert.equal(pageOf(withZero, "asc", 0), 1)
    assert.equal(pageOf(withZero, "desc", 0), 2)
    assert.equal(pageOf(list, "asc", 121), null)
    assert.equal(pageOf([], "asc", 1), null)
  })

  test("pageOf สอดคล้องกับ pageSlice: ตอนทุกตอนอยู่ในหน้าที่ pageOf บอก", () => {
    for (const order of ["asc", "desc"] as const) {
      for (const c of list) {
        const page = pageOf(list, order, c.number)
        assert.ok(page !== null && numbers(pageSlice(list, order, page)).includes(c.number), `${order} ตอน ${c.number}`)
      }
    }
  })

  test("ตอนที่ข้ามเลข (ลบตอนกลาง) ยังนับตามลำดับในรายการ ไม่ใช่ตามเลขตอน", () => {
    const gaps = [chapter(1), chapter(5), chapter(900)]
    assert.equal(pageOf(gaps, "asc", 900), 1)
    assert.deepEqual(numbers(pageSlice(gaps, "desc", 1)), [900, 5, 1])
  })
})

describe("firstChapter / latestChapter", () => {
  test("เลขน้อยสุด/มากสุดของรายการ ไม่ว่าลำดับเข้ามาอย่างไร · ตอนที่ 0 นับเป็นตอนจริง", () => {
    const list = [chapter(5), chapter(0), chapter(9), chapter(2)]
    assert.equal(firstChapter(list), 0)
    assert.equal(latestChapter(list), 9)
  })

  test("ไม่มีตอน → null", () => {
    assert.equal(firstChapter([]), null)
    assert.equal(latestChapter([]), null)
  })

  test("มีตอนเดียวเป็นทั้งตอนแรกและตอนล่าสุด", () => {
    assert.equal(firstChapter([chapter(7)]), 7)
    assert.equal(latestChapter([chapter(7)]), 7)
  })
})

describe("parseChapterNumber", () => {
  test("เลขอารบิกและเลขไทย ตัดช่องว่างหัวท้าย (รวมช่องว่างไม่ตัดบรรทัด)", () => {
    assert.equal(parseChapterNumber("12"), 12)
    assert.equal(parseChapterNumber("  12  "), 12)
    assert.equal(parseChapterNumber("\u{a0}12\u{a0}"), 12)
    assert.equal(parseChapterNumber("๑๒"), 12)
    assert.equal(parseChapterNumber("๐"), 0)
    assert.equal(parseChapterNumber("๑๒๓๔๕๖๗๘๙"), 123456789)
    assert.equal(parseChapterNumber("๑๙๐"), 190)
    assert.equal(parseChapterNumber("0"), 0)
    assert.equal(parseChapterNumber("007"), 7)
  })

  test("ตัวอักษรกว้างศูนย์ที่ติดมาตอนคัดลอกไม่ทำให้ใช้ไม่ได้", () => {
    assert.equal(parseChapterNumber("1\u{200b}2"), 12)
    assert.equal(parseChapterNumber("\u{feff}12"), 12)
    for (const zeroWidth of ["\u{200b}", "\u{200c}", "\u{200d}", "\u{feff}"]) {
      assert.equal(parseChapterNumber(`1${zeroWidth}2`), 12, JSON.stringify(zeroWidth))
    }
  })

  test("ที่ไม่ใช่จำนวนเต็มไม่ติดลบ → null", () => {
    for (const bad of ["", "   ", "abc", "12abc", "1.5", "-1", "+3", "1e3", "1,000", "NaN", "Infinity", "12 13", "๑.๕"]) {
      assert.equal(parseChapterNumber(bad), null, JSON.stringify(bad))
    }
  })

  test("ยาวเกินกว่าเลขตอนที่เป็นไปได้ → null (ไม่ปัดเป็นเลขเพี้ยนเกินที่เก็บได้)", () => {
    assert.equal(parseChapterNumber("123456789"), 123456789)
    assert.equal(parseChapterNumber("1234567890"), null)
    assert.equal(parseChapterNumber("9".repeat(400)), null)
  })
})

describe("resolveJump", () => {
  const list = range(1, 120)

  test("เจอตอน → เลขตอน + หน้าที่มีตอนนั้นตามแบบเรียงปัจจุบัน", () => {
    assert.deepEqual(resolveJump(list, "asc", "75"), { ok: true, number: 75, page: 2 })
    assert.deepEqual(resolveJump(list, "desc", "75"), { ok: true, number: 75, page: 1 })
    assert.deepEqual(resolveJump(list, "desc", " ๗๕ "), { ok: true, number: 75, page: 1 })
  })

  test("ตอนที่ 0 ไปได้ (ไม่ถูกมองเป็นช่องว่าง)", () => {
    assert.deepEqual(resolveJump(range(0, 10), "asc", "0"), { ok: true, number: 0, page: 1 })
  })

  test("ช่องว่าง → บอกให้กรอก", () => {
    assert.deepEqual(resolveJump(list, "asc", "  "), { ok: false, message: "กรอกเลขตอนที่ต้องการ" })
  })

  test("มีแต่ตัวอักษรกว้างศูนย์ (คัดลอกมาแต่ช่องว่าง) → ถือว่าว่าง บอกให้กรอก ไม่ใช่ 'ไม่ใช่ตัวเลข'", () => {
    assert.deepEqual(resolveJump(list, "asc", "\u{200b}"), { ok: false, message: "กรอกเลขตอนที่ต้องการ" })
    assert.deepEqual(resolveJump(list, "asc", " \u{feff}\u{200d} "), { ok: false, message: "กรอกเลขตอนที่ต้องการ" })
  })

  test("ไม่ใช่ตัวเลข → บอกรูปแบบที่ใช้ได้", () => {
    assert.deepEqual(resolveJump(list, "asc", "abc"), { ok: false, message: "กรอกเลขตอนเป็นตัวเลข เช่น 12" })
    assert.deepEqual(resolveJump(list, "asc", "1.5"), { ok: false, message: "กรอกเลขตอนเป็นตัวเลข เช่น 12" })
  })

  test("ไม่มีตอนนั้น → บอกเลขที่ไม่พบ พร้อมช่วงที่มี", () => {
    assert.deepEqual(resolveJump(list, "asc", "500"), { ok: false, message: "ไม่พบตอนที่ 500 (มีตั้งแต่ตอนที่ 1 ถึง 120)" })
    assert.deepEqual(resolveJump(range(0, 3), "asc", "9"), { ok: false, message: "ไม่พบตอนที่ 9 (มีตั้งแต่ตอนที่ 0 ถึง 3)" })
  })

  test("ไม่มีตอนเลย → บอกว่ายังไม่มีตอน (ไม่แสดงช่วงว่างๆ)", () => {
    assert.deepEqual(resolveJump([], "asc", "1"), { ok: false, message: "ยังไม่มีตอนให้ไป" })
  })

  test("รายการเลขข้าม (ลบตอนกลาง): เลขที่หายไปในช่วงก็ไม่พบ", () => {
    const gaps = [chapter(1), chapter(2), chapter(5)]
    assert.deepEqual(resolveJump(gaps, "asc", "3"), { ok: false, message: "ไม่พบตอนที่ 3 (มีตั้งแต่ตอนที่ 1 ถึง 5)" })
  })
})

describe("readAction (ปุ่มหลักของหน้าเรื่อง)", () => {
  const list = range(1, 30)

  test("ไม่มีตอนเลย → ไม่มีปุ่ม (ไม่ว่าเคยมีความคืบหน้าหรือไม่)", () => {
    assert.equal(readAction([], null), null)
    assert.equal(readAction([], progress()), null)
  })

  test("ยังไม่เคยอ่าน → เริ่มอ่านที่ตอนแรก (เลขน้อยสุด ไม่ว่าลำดับรายการ)", () => {
    assert.deepEqual(readAction(list, null), { kind: "start", number: 1, label: "เริ่มอ่าน" })
    assert.deepEqual(readAction([...list].reverse(), null), { kind: "start", number: 1, label: "เริ่มอ่าน" })
  })

  test("รายการที่เริ่มที่ตอนที่ 0 → เริ่มที่ 0 (ไม่ข้ามเพราะ 0 เป็นเท็จ)", () => {
    assert.deepEqual(readAction(range(0, 5), null), { kind: "start", number: 0, label: "เริ่มอ่าน" })
  })

  test("อ่านค้างกลางตอน → อ่านต่อตอนเดิม", () => {
    assert.deepEqual(readAction(list, progress({ number: 12, pct: 40, next: 13 })), { kind: "resume", number: 12, label: "อ่านต่อ ตอนที่ 12" })
  })

  test("ตอนที่ 0 อ่านค้าง → อ่านต่อ ตอนที่ 0", () => {
    assert.deepEqual(readAction(range(0, 5), progress({ number: 0, pct: 10, next: 1 })), { kind: "resume", number: 0, label: "อ่านต่อ ตอนที่ 0" })
  })

  test("ขอบการจบตอน: FINISHED_PCT-1 ยังเป็นตอนเดิม · FINISHED_PCT ไปตอนถัดไป", () => {
    assert.equal(readAction(list, progress({ pct: FINISHED_PCT - 1 }))?.number, 12)
    assert.deepEqual(readAction(list, progress({ pct: FINISHED_PCT })), { kind: "resume", number: 13, label: "อ่านต่อ ตอนที่ 13" })
    assert.equal(readAction(list, progress({ pct: 100 }))?.number, 13)
  })

  test("ขอบการจบตอนเมื่อจำไว้ว่าไม่มีตอนถัดไป: FINISHED_PCT = จบแล้ว → ตอนใหม่ · FINISHED_PCT-1 = ยังอ่านค้าง → ตอนเดิม", () => {
    assert.equal(readAction(list, progress({ number: 12, pct: FINISHED_PCT, next: null }))?.number, 13)
    assert.deepEqual(readAction(list, progress({ number: 12, pct: FINISHED_PCT - 1, next: null })), { kind: "resume", number: 12, label: "อ่านต่อ ตอนที่ 12" })
    assert.equal(readAction(list, progress({ number: 12, pct: 0, next: null }))?.number, 12)
  })

  test("อ่านจบและจำตอนถัดไปไว้ → ไปตอนที่จำไว้ (ที่ยังมีอยู่) แม้จะมีตอนเลขน้อยกว่าคั่นกลางที่เพิ่งออก", () => {
    assert.deepEqual(readAction(list, progress({ number: 3, pct: 100, next: 7 })), { kind: "resume", number: 7, label: "อ่านต่อ ตอนที่ 7" })
  })

  test("อ่านจบตอนที่เคยเป็นตอนล่าสุด (ไม่มีตอนถัดไปตอนบันทึก) แล้วมีตอนใหม่ → ไปตอนใหม่ตัวแรกหลังตอนนั้น", () => {
    assert.deepEqual(readAction(list, progress({ number: 12, pct: 100, next: null })), { kind: "resume", number: 13, label: "อ่านต่อ ตอนที่ 13" })
  })

  test("อ่านจบตอนล่าสุดจริง และยังไม่มีตอนใหม่ → อ่านซ้ำตอนนั้น", () => {
    assert.deepEqual(readAction(list, progress({ number: 30, pct: 100, next: null })), { kind: "reread", number: 30, label: "อ่านซ้ำ ตอนที่ 30" })
  })

  test("ตอนถัดไปที่จำไว้ถูกซ่อน/ลบไปแล้ว → ข้ามไปตอนแรกที่มากกว่าและยังมีอยู่", () => {
    const withoutThirteen = list.filter((c) => c.number !== 13)
    assert.deepEqual(readAction(withoutThirteen, progress({ number: 12, pct: 100, next: 13 })), { kind: "resume", number: 14, label: "อ่านต่อ ตอนที่ 14" })
  })

  test("ตอนที่อ่านค้างถูกซ่อน/ลบไปแล้ว → ตอนถัดไปที่ยังมี", () => {
    const withoutTwelve = list.filter((c) => c.number !== 12)
    assert.deepEqual(readAction(withoutTwelve, progress({ number: 12, pct: 40, next: 13 })), { kind: "resume", number: 13, label: "อ่านต่อ ตอนที่ 13" })
  })

  test("ตอนที่เคยอ่านเลยตอนล่าสุดที่มีอยู่ตอนนี้ (ตอนท้ายๆ ถูกลบ) → อ่านซ้ำตอนล่าสุดที่มี", () => {
    assert.deepEqual(readAction(list, progress({ number: 40, pct: 40, next: 41 })), { kind: "reread", number: 30, label: "อ่านซ้ำ ตอนที่ 30" })
    assert.deepEqual(readAction(list, progress({ number: 40, pct: 100, next: null })), { kind: "reread", number: 30, label: "อ่านซ้ำ ตอนที่ 30" })
  })

  test("นับทุกตอนที่ API ส่งมา รวมตอนร่างที่ผู้ดูแลเห็น", () => {
    const withDraft = [chapter(1, { published: false, publishedAt: null }), chapter(2)]
    assert.equal(readAction(withDraft, null)?.number, 1)
  })

  test("ความคืบหน้าที่ผิดรูป (เลขตอนติดลบ/ไม่ใช่เลข) ไม่ทำให้พัง → ปฏิบัติเหมือนตอนที่ไม่มีอยู่", () => {
    assert.equal(readAction(list, progress({ number: -1, pct: 10, next: null }))?.number, 1)
  })
})

describe("listReducer", () => {
  test("ค่าเริ่มต้น: ใหม่→เก่า หน้า 1 ไม่ไฮไลต์ ยังไม่เคยกระโดด", () => {
    assert.deepEqual(INITIAL_LIST, { order: "desc", page: 1, jump: null, jumps: 0 })
  })

  test("สลับแบบเรียง → กลับหน้า 1 และเลิกไฮไลต์ตอนที่กระโดดไป (จำนวนครั้งที่กระโดดไม่เปลี่ยน)", () => {
    const state = { order: "desc" as const, page: 3, jump: 75, jumps: 2 }
    assert.deepEqual(listReducer(state, { type: "order", order: "asc" }), { order: "asc", page: 1, jump: null, jumps: 2 })
  })

  test("เลือกแบบเรียงที่ใช้อยู่ซ้ำ → ไม่เปลี่ยนอะไร (หน้าที่ดูอยู่ไม่ถูกรีเซ็ต)", () => {
    const state = { order: "asc" as const, page: 3, jump: 75, jumps: 2 }
    assert.equal(listReducer(state, { type: "order", order: "asc" }), state)
  })

  test("กระโดดไม่เปลี่ยนแบบเรียง (หน้าที่คำนวณมาเป็นของแบบเรียงปัจจุบัน)", () => {
    const state = { order: "asc" as const, page: 1, jump: null, jumps: 0 }
    assert.equal(listReducer(state, { type: "jump", number: 77, page: 2 }).order, "asc")
  })

  test("เปลี่ยนหน้า → ตรึงในช่วงตามจำนวนตอน · คงแบบเรียงและไฮไลต์", () => {
    const state = { order: "asc" as const, page: 1, jump: 75, jumps: 1 }
    assert.deepEqual(listReducer(state, { type: "page", page: 2, count: 120 }), { order: "asc", page: 2, jump: 75, jumps: 1 })
    assert.equal(listReducer(state, { type: "page", page: 99, count: 120 }).page, 3)
    assert.equal(listReducer(state, { type: "page", page: 0, count: 120 }).page, 1)
  })

  test("กระโดดไปตอน → ไปหน้านั้น ไฮไลต์ตอนนั้น นับจำนวนครั้ง (กระโดดซ้ำตอนเดิมก็ต้องนับ เพื่อให้เลื่อน/โฟกัสอีกครั้ง)", () => {
    const first = listReducer(INITIAL_LIST, { type: "jump", number: 75, page: 2 })
    assert.deepEqual(first, { order: "desc", page: 2, jump: 75, jumps: 1 })
    const again = listReducer(first, { type: "jump", number: 75, page: 2 })
    assert.deepEqual(again, { order: "desc", page: 2, jump: 75, jumps: 2 })
  })

  test("กระโดดไปตอนที่ 0 ไฮไลต์ได้ (jump = 0 ไม่ใช่ 'ไม่มี')", () => {
    assert.equal(listReducer(INITIAL_LIST, { type: "jump", number: 0, page: 1 }).jump, 0)
  })
})
