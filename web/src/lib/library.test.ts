import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  CONTINUE_MAX,
  INITIAL_LIBRARY,
  PAGE_SIZE,
  sortOptions,
  statusOptions,
  TAG_CHIPS_MAX,
  UPDATES_COUNT,
  continueItems,
  filterNovels,
  isSortKey,
  latestUpdates,
  libraryReducer,
  matchesQuery,
  pickHero,
  resumeInfo,
  shownCount,
  sortNovels,
  tagCounts,
  visibleTags,
} from "./library"
import { MESSAGES } from "../i18n/messages"
import { FINISHED_PCT, type Progress } from "./progress"
import type { NovelCardDto } from "./types"

const { th, en, lo } = MESSAGES

const novel = (over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id: 1,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Elmer Quill",
  synopsisShort: "…",
  tags: ["แฟนตาซี", "ผจญภัย"],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 30,
  latestNumber: 30,
  updatedAt: "2026-10-22 09:00:00",
  published: true,
  ...over,
})
const ids = (list: NovelCardDto[]) => list.map((item) => item.id)
const progress = (over: Partial<Progress> = {}): Progress => ({ number: 12, pct: 40, next: 13, at: 1, ...over })

describe("ค่าคงที่ของหน้าแรก", () => {
  test("ตามแผน: ตารางทีละ 24, อัปเดตล่าสุด 12 เรื่อง, อ่านต่อสูงสุด 3 เรื่อง", () => {
    assert.equal(PAGE_SIZE, 24)
    assert.equal(UPDATES_COUNT, 12)
    assert.equal(CONTINUE_MAX, 3)
    assert.equal(TAG_CHIPS_MAX, 10)
  })
})

describe("matchesQuery", () => {
  const n = novel()

  test("คำค้นว่างหรือมีแต่ช่องว่าง → ตรงทุกเรื่อง", () => {
    for (const query of ["", " ", "\t \n"]) assert.equal(matchesQuery(n, query), true, JSON.stringify(query))
  })

  test("ค้นได้จากชื่อต้นฉบับ ชื่อไทย ผู้แต่ง และแท็ก", () => {
    assert.equal(matchesQuery(n, "lantern"), true)
    assert.equal(matchesQuery(n, "ตะเกียง"), true)
    assert.equal(matchesQuery(n, "quill"), true)
    assert.equal(matchesQuery(n, "ผจญ"), true)
  })

  test("ไม่สนตัวพิมพ์ใหญ่-เล็ก (ทั้งสองข้าง)", () => {
    assert.equal(matchesQuery(n, "LANTERN"), true)
    assert.equal(matchesQuery(n, "eLmEr"), true)
    assert.equal(matchesQuery(novel({ title: "DRAGON", tags: ["SciFi"] }), "dragon"), true)
    assert.equal(matchesQuery(novel({ tags: ["SciFi"] }), "scifi"), true)
  })

  test("ไม่พบ → false; ไม่ค้นในเรื่องย่อ สถานะ หรือเลข id", () => {
    assert.equal(matchesQuery(n, "zzz"), false)
    assert.equal(matchesQuery(novel({ synopsisShort: "มังกรสีทอง" }), "มังกร"), false)
    assert.equal(matchesQuery(novel({ status: "completed" }), "completed"), false)
    assert.equal(matchesQuery(novel({ id: 4242 }), "4242"), false)
  })

  test("ตัดช่องว่างหัวท้าย; หลายคำต้องเจอครบทุกคำ (คนละช่องได้) ไม่ต้องเรียงติดกัน", () => {
    assert.equal(matchesQuery(n, "  lantern  "), true)
    assert.equal(matchesQuery(n, "lantern elmer"), true)
    assert.equal(matchesQuery(n, "elmer   lantern"), true)
    assert.equal(matchesQuery(n, "lantern zzz"), false)
    assert.equal(matchesQuery(n, "ตะเกียง ผจญภัย"), true)
  })

  test("คำที่ติดกันข้ามช่อง (ชื่อ+ผู้แต่ง) ไม่นับว่าเจอ", () => {
    assert.equal(matchesQuery(novel({ title: "abc", titleTh: "", author: "def", tags: [] }), "cdef"), false)
    assert.equal(matchesQuery(novel({ title: "abc", titleTh: "", author: "def", tags: [] }), "abcdef"), false)
    assert.equal(matchesQuery(novel({ title: "abc", titleTh: "", author: "", tags: ["def"] }), "cdef"), false)
  })

  test("อักขระพิเศษของ regex ถือเป็นตัวอักษรธรรมดา", () => {
    assert.equal(matchesQuery(novel({ title: "axb" }), "a.b"), false)
    assert.equal(matchesQuery(novel({ title: "a.b" }), "a.b"), true)
    assert.equal(matchesQuery(novel({ title: "C++ (2nd)" }), "c++ (2"), true)
    assert.equal(matchesQuery(n, "["), false)
  })

  test("อักษรประกอบ (e + จุดบน) กับตัวสำเร็จรูป (é) ถือเป็นคำเดียวกัน", () => {
    const composed = `caf${String.fromCodePoint(0xe9)}`
    const decomposed = `cafe${String.fromCodePoint(0x301)}`
    assert.equal(matchesQuery(novel({ title: composed }), decomposed), true)
    assert.equal(matchesQuery(novel({ title: decomposed }), composed), true)
  })

  test("สำเนียงมีความหมาย: 'cafe' ไม่ตรง 'Café' (ค้นตามตัวอักษรที่พิมพ์ ไม่ตัดสำเนียงทิ้งให้เดา)", () => {
    const withAccent = novel({ title: `Caf${String.fromCodePoint(0xe9)}`, titleTh: "", author: "", tags: [] })
    assert.equal(matchesQuery(withAccent, "cafe"), false)
    assert.equal(matchesQuery(novel({ title: "Cafe", titleTh: "", author: "", tags: [] }), `caf${String.fromCodePoint(0xe9)}`), false)
  })
})

describe("tagCounts / visibleTags", () => {
  test("นับจำนวนเรื่องต่อแท็ก เรียงจากมากไปน้อย เท่ากันเรียงตามชื่อ", () => {
    const list = [novel({ id: 1, tags: ["ข", "ก"] }), novel({ id: 2, tags: ["ก", "ค"] }), novel({ id: 3, tags: ["ก", "ข"] })]
    assert.deepEqual(tagCounts(list), [
      { tag: "ก", count: 3 },
      { tag: "ข", count: 2 },
      { tag: "ค", count: 1 },
    ])
  })

  test("จำนวนเท่ากัน → เรียงตามชื่อแท็กตามลำดับอักขระ ไม่ใช่ตามลำดับที่เจอ", () => {
    const list = [novel({ id: 1, tags: ["b", "c"] }), novel({ id: 2, tags: ["a"] })]
    assert.deepEqual(
      tagCounts(list).map((item) => item.tag),
      ["a", "b", "c"],
    )
    // ตัวพิมพ์ใหญ่ (U+0041) มาก่อนตัวพิมพ์เล็ก (U+0061) ตามลำดับอักขระ ไม่ขึ้นกับภาษาของเครื่อง
    assert.deepEqual(
      tagCounts([novel({ tags: ["b", "B"] })]).map((item) => item.tag),
      ["B", "b"],
    )
  })

  test("แท็กซ้ำในเรื่องเดียวนับครั้งเดียว; แท็กว่างข้าม; ไม่มีเรื่อง → ว่าง", () => {
    assert.deepEqual(tagCounts([novel({ tags: ["a", "a", " ", ""] })]), [{ tag: "a", count: 1 }])
    assert.deepEqual(tagCounts([]), [])
  })

  test("ตัวพิมพ์ต่างกันเป็นคนละแท็ก (ตรงตามที่เจ้าของพิมพ์)", () => {
    assert.deepEqual(
      tagCounts([novel({ tags: ["SciFi"] }), novel({ tags: ["scifi"] })]).map((t) => t.tag),
      ["SciFi", "scifi"],
    )
  })

  test("visibleTags: แสดงไม่เกินที่กำหนด; แท็กที่เลือกอยู่นอกลำดับต้นก็ต้องเห็น (ต่อท้าย)", () => {
    const counts = Array.from({ length: 14 }, (_, i) => ({ tag: `t${i}`, count: 20 - i }))
    assert.deepEqual(
      visibleTags(counts, null).map((t) => t.tag),
      counts.slice(0, TAG_CHIPS_MAX).map((t) => t.tag),
    )
    const withSelected = visibleTags(counts, "t12").map((t) => t.tag)
    assert.equal(withSelected.length, TAG_CHIPS_MAX + 1)
    assert.equal(withSelected.at(-1), "t12")
    assert.deepEqual(
      visibleTags(counts, "t3").map((t) => t.tag),
      counts.slice(0, TAG_CHIPS_MAX).map((t) => t.tag),
    )
  })

  test("visibleTags: แท็กที่เลือกไม่มีในรายการ (ข้อมูลเปลี่ยน) → ไม่เพิ่ม", () => {
    const counts = [{ tag: "a", count: 1 }]
    assert.deepEqual(visibleTags(counts, "ghost"), counts)
  })
})

describe("filterNovels", () => {
  const list = [
    novel({ id: 1, status: "ongoing", tags: ["a", "b"], title: "Alpha" }),
    novel({ id: 2, status: "completed", tags: ["b"], title: "Beta" }),
    novel({ id: 3, status: "completed", tags: ["c"], title: "Gamma" }),
  ]
  const all = { query: "", status: "all" as const, tag: null }

  test("ไม่กรองอะไร → ได้ครบตามลำดับเดิม (คนละอาร์เรย์)", () => {
    const out = filterNovels(list, all)
    assert.deepEqual(ids(out), [1, 2, 3])
    assert.notEqual(out, list)
  })

  test("กรองสถานะ", () => {
    assert.deepEqual(ids(filterNovels(list, { ...all, status: "completed" })), [2, 3])
    assert.deepEqual(ids(filterNovels(list, { ...all, status: "ongoing" })), [1])
  })

  test("กรองแท็ก (ตรงตัว)", () => {
    assert.deepEqual(ids(filterNovels(list, { ...all, tag: "b" })), [1, 2])
    assert.deepEqual(ids(filterNovels(list, { ...all, tag: "B" })), [])
  })

  test("กรองคำค้น และรวมทุกเงื่อนไขด้วย AND", () => {
    assert.deepEqual(ids(filterNovels(list, { ...all, query: "ta" })), [2])
    assert.deepEqual(ids(filterNovels(list, { query: "a", status: "completed", tag: "b" })), [2])
    assert.deepEqual(ids(filterNovels(list, { query: "alpha", status: "completed", tag: null })), [])
  })
})

describe("sortNovels / latestUpdates", () => {
  test("latest: อัปเดตล่าสุดก่อน; เวลาเท่ากันเรื่องใหม่กว่า (id มากกว่า) ก่อน; เวลาอ่านไม่ได้อยู่ท้ายสุด", () => {
    const list = [
      novel({ id: 1, updatedAt: "2026-10-01 00:00:00" }),
      novel({ id: 2, updatedAt: "2026-10-03 00:00:00" }),
      novel({ id: 3, updatedAt: "not a date" }),
      novel({ id: 4, updatedAt: "2026-10-03 00:00:00" }),
      novel({ id: 5, updatedAt: "" }),
    ]
    assert.deepEqual(ids(sortNovels(list, "latest")), [4, 2, 1, 5, 3])
  })

  test("title: เรียงตามชื่อที่แสดง (ชื่อไทยก่อน ไม่มีใช้ชื่อต้นฉบับ) ตามลำดับพยัญชนะไทย — สระนำหน้า (เ แ ไ ใ โ) เรียงตามพยัญชนะที่ตามมา", () => {
    const list = [
      novel({ id: 1, titleTh: "ขอบฟ้า", title: "Horizon" }),
      novel({ id: 2, titleTh: "เกม", title: "Game" }),
      novel({ id: 3, titleTh: "กา", title: "Crow" }),
      novel({ id: 4, titleTh: "", title: "Apple" }),
    ]
    assert.deepEqual(ids(sortNovels(list, "title")), [3, 2, 1, 4])
  })

  test("title: เลขในชื่อเรียงตามค่า (2 ก่อน 10); ชื่อเท่ากันเรียงตาม id น้อยไปมาก", () => {
    const list = [novel({ id: 5, titleTh: "ตอน 10" }), novel({ id: 7, titleTh: "ตอน 2" }), novel({ id: 6, titleTh: "ตอน 2" })]
    assert.deepEqual(ids(sortNovels(list, "title")), [6, 7, 5])
  })

  test("latest: เวลาที่อ่านไม่ได้อยู่ท้ายสุดเสมอ แม้เทียบกับวันที่ก่อนปี 1970", () => {
    const list = [novel({ id: 1, updatedAt: "not a date" }), novel({ id: 2, updatedAt: "1960-01-01 00:00:00" }), novel({ id: 3, updatedAt: "2026-10-01 00:00:00" })]
    assert.deepEqual(ids(sortNovels(list, "latest")), [3, 2, 1])
  })

  test("ไม่แก้อาร์เรย์เดิม", () => {
    const list = [novel({ id: 1, updatedAt: "2026-10-01 00:00:00" }), novel({ id: 2, updatedAt: "2026-10-02 00:00:00" })]
    sortNovels(list, "latest")
    sortNovels(list, "title")
    assert.deepEqual(ids(list), [1, 2])
  })

  test("latestUpdates: เรียงล่าสุดก่อนและตัดที่ 12 เรื่อง; น้อยกว่า 12 ได้ครบ", () => {
    const list = Array.from({ length: 15 }, (_, i) => novel({ id: i + 1, updatedAt: `2026-10-${String(i + 1).padStart(2, "0")} 00:00:00` }))
    const out = latestUpdates(list)
    assert.equal(out.length, UPDATES_COUNT)
    assert.deepEqual(ids(out), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4])
    assert.deepEqual(ids(latestUpdates(list.slice(0, 3))), [3, 2, 1])
    assert.deepEqual(latestUpdates([]), [])
  })
})

describe("pickHero", () => {
  const old = "2026-09-01 00:00:00"
  const mid = "2026-10-01 00:00:00"
  const fresh = "2026-10-20 00:00:00"

  test("ไม่มีเรื่องเลย → null", () => {
    assert.equal(pickHero([]), null)
  })

  test("มีเรื่องแนะนำ (featured) → ใช้เรื่องนั้น แม้จะเก่ากว่าและไม่มีปก", () => {
    const list = [novel({ id: 1, updatedAt: fresh, hasCover: true }), novel({ id: 2, updatedAt: old, featured: true })]
    assert.equal(pickHero(list)?.id, 2)
  })

  test("มีเรื่องแนะนำหลายเรื่อง → เรื่องที่อัปเดตล่าสุดในกลุ่มนั้น", () => {
    const list = [novel({ id: 1, updatedAt: mid, featured: true }), novel({ id: 2, updatedAt: fresh, featured: true }), novel({ id: 3, updatedAt: old, featured: true })]
    assert.equal(pickHero(list)?.id, 2)
  })

  test("ไม่มีเรื่องแนะนำ → เรื่องที่อัปเดตล่าสุดที่มีปก (ข้ามเรื่องใหม่กว่าที่ไม่มีปก)", () => {
    const list = [novel({ id: 1, updatedAt: fresh, hasCover: false }), novel({ id: 2, updatedAt: mid, hasCover: true }), novel({ id: 3, updatedAt: old, hasCover: true })]
    assert.equal(pickHero(list)?.id, 2)
  })

  test("ไม่มีเรื่องแนะนำและไม่มีเรื่องไหนมีปกเลย → เรื่องที่อัปเดตล่าสุด (ปกอัตโนมัติใช้เป็นโปสเตอร์ได้)", () => {
    const list = [novel({ id: 1, updatedAt: old }), novel({ id: 2, updatedAt: fresh }), novel({ id: 3, updatedAt: mid })]
    assert.equal(pickHero(list)?.id, 2)
  })

  test("ไม่แก้ลำดับของรายการเดิม", () => {
    const list = [novel({ id: 1, updatedAt: old }), novel({ id: 2, updatedAt: fresh })]
    pickHero(list)
    assert.deepEqual(ids(list), [1, 2])
  })
})

describe("resumeInfo (ปุ่ม/การ์ดอ่านต่อ)", () => {
  const n = novel({ id: 7, latestNumber: 30 })

  test("อ่านค้างกลางตอน → กลับตอนเดิม; แถบ = ตอนที่อ่านถึง ÷ ตอนล่าสุด", () => {
    assert.deepEqual(resumeInfo(n, progress({ number: 12, pct: 40 }), th), { href: "/novel/7/12", label: "อ่านต่อ ตอนที่ 12", chapter: 12, percent: 40 })
  })

  test("อ่านถึง 95% ขึ้นไปและรู้ตอนถัดไป → พาไปตอนถัดไป", () => {
    const info = resumeInfo(n, progress({ number: 12, pct: 95, next: 14 }), th)
    assert.equal(info.href, "/novel/7/14")
    assert.equal(info.label, "อ่านต่อ ตอนที่ 14")
    assert.equal(info.chapter, 12)
    assert.equal(info.percent, 40)
    assert.equal(resumeInfo(n, progress({ number: 12, pct: 94, next: 14 }), th).href, "/novel/7/12")
  })

  test("ขอบเขต 95% พอดีที่ตอนสุดท้าย (ไม่รู้ตอนถัดไป) นับว่าอ่านจบ → ไปหน้าเรื่อง ไม่ใช่กลับไปตอนเดิม", () => {
    const last = novel({ id: 7, latestNumber: 12 })
    const done = resumeInfo(last, progress({ number: 12, pct: FINISHED_PCT, next: null }), th)
    assert.equal(done.href, "/novel/7")
    assert.equal(done.label, "อ่านทันตอนล่าสุดแล้ว")
    assert.equal(resumeInfo(last, progress({ number: 12, pct: FINISHED_PCT - 1, next: null }), th).href, "/novel/7/12")
  })

  test("ตอนที่ 0 (บทนำ) เป็นตอนจริง", () => {
    const info = resumeInfo(novel({ id: 7, latestNumber: 30 }), progress({ number: 0, pct: 10 }), th)
    assert.equal(info.href, "/novel/7/0")
    assert.equal(info.label, "อ่านต่อ ตอนที่ 0")
    assert.equal(info.percent, 0)
    assert.equal(resumeInfo(n, progress({ number: 5, pct: 99, next: 0 }), th).href, "/novel/7/0")
  })

  test("อ่านจบตอนล่าสุดตอนนั้นแต่ตอนนี้มีตอนใหม่ → ไปหน้าเรื่อง (ไม่รู้เลขตอนถัดไป) ป้าย 'มีตอนใหม่'", () => {
    const info = resumeInfo(n, progress({ number: 28, pct: 100, next: null }), th)
    assert.equal(info.href, "/novel/7")
    assert.equal(info.label, "มีตอนใหม่")
    assert.equal(info.percent, 93)
  })

  test("อ่านจบตอนล่าสุดและยังไม่มีตอนใหม่ → ไปหน้าเรื่อง ป้าย 'อ่านทันตอนล่าสุดแล้ว' แถบเต็ม", () => {
    const info = resumeInfo(n, progress({ number: 30, pct: 97, next: null }), th)
    assert.equal(info.href, "/novel/7")
    assert.equal(info.label, "อ่านทันตอนล่าสุดแล้ว")
    assert.equal(info.percent, 100)
  })

  test("ยังอ่านไม่จบตอนสุดท้าย (pct ต่ำกว่า 95) → อ่านต่อตอนเดิมตามปกติ แม้ไม่มีตอนถัดไป", () => {
    assert.equal(resumeInfo(n, progress({ number: 30, pct: 50, next: null }), th).href, "/novel/7/30")
  })

  test("เรื่องที่ตอนนี้ไม่มีตอนให้อ่านเลย (latestNumber เป็น null) → ไปหน้าเรื่อง แถบ 0%", () => {
    const info = resumeInfo(novel({ id: 7, latestNumber: null }), progress({ number: 3, pct: 20 }), th)
    assert.equal(info.href, "/novel/7")
    assert.equal(info.label, "ดูเรื่องนี้")
    assert.equal(info.percent, 0)
  })

  test("อ่านถึงตอนที่เกินตอนล่าสุด (ตอนถูกลบ) → แถบไม่เกิน 100%", () => {
    assert.equal(resumeInfo(novel({ id: 7, latestNumber: 10 }), progress({ number: 12, pct: 20 }), th).percent, 100)
  })
})

describe("continueItems (แถว 'อ่านต่อจากที่ค้างไว้')", () => {
  const list = [novel({ id: 1 }), novel({ id: 2 }), novel({ id: 3 }), novel({ id: 4 }), novel({ id: 5 })]
  const store: Record<number, Progress> = { 1: progress({ number: 1 }), 2: progress({ number: 2 }), 3: progress({ number: 3 }), 4: progress({ number: 4 }), 5: progress({ number: 5 }) }
  const read = (id: number) => store[id] ?? null

  test("เรียงตามประวัติ (ล่าสุดก่อน) ได้ไม่เกิน 3 เรื่อง", () => {
    const out = continueItems(list, [5, 3, 1, 2, 4], read, th)
    assert.deepEqual(out.map((item) => item.novel.id), [5, 3, 1])
    assert.equal(out.length, CONTINUE_MAX)
  })

  test("ข้ามเรื่องที่ไม่อยู่ในรายการแล้ว (ซ่อน/ลบ) และเรื่องที่ไม่มีความคืบหน้า แล้วเติมด้วยเรื่องถัดไปในประวัติ", () => {
    const out = continueItems(list, [99, 5, 3, 1, 2], (id) => (id === 3 ? null : read(id)), th)
    assert.deepEqual(out.map((item) => item.novel.id), [5, 1, 2])
  })

  test("แต่ละรายการมีข้อมูลอ่านต่อของตัวเอง", () => {
    const [first] = continueItems(list, [2], read, th)
    assert.equal(first.info.href, "/novel/2/2")
    assert.equal(first.info.chapter, 2)
  })

  test("ไม่มีประวัติ / ไม่มีเรื่องที่ใช้ได้ → ว่าง (ซ่อนทั้งส่วน)", () => {
    assert.deepEqual(continueItems(list, [], read, th), [])
    assert.deepEqual(continueItems(list, [99, 98], read, th), [])
    assert.deepEqual(continueItems([], [1, 2], read, th), [])
  })

  test("id ซ้ำในประวัติไม่ทำให้การ์ดซ้ำ", () => {
    const out = continueItems(list, [2, 2, 1], read, th)
    assert.deepEqual(out.map((item) => item.novel.id), [2, 1])
  })
})

describe("libraryReducer / shownCount", () => {
  test("สถานะเริ่มต้น: ทั้งหมด ไม่เลือกแท็ก เรียงล่าสุด หน้าแรก 1 หน้า", () => {
    assert.deepEqual(INITIAL_LIBRARY, { status: "all", tag: null, sort: "latest", pages: 1 })
  })

  test("เลือกสถานะ → เปลี่ยนสถานะและกลับไปแสดงหน้าแรก", () => {
    const state = libraryReducer({ ...INITIAL_LIBRARY, pages: 3 }, { type: "status", status: "completed" })
    assert.deepEqual(state, { status: "completed", tag: null, sort: "latest", pages: 1 })
  })

  test("แตะแท็ก: เลือก → แตะซ้ำเพื่อยกเลิก → เปลี่ยนไปแท็กอื่นได้; ทุกครั้งกลับหน้าแรก", () => {
    let state = libraryReducer({ ...INITIAL_LIBRARY, pages: 2 }, { type: "tag", tag: "a" })
    assert.deepEqual(state, { ...INITIAL_LIBRARY, tag: "a", pages: 1 })
    state = libraryReducer({ ...state, pages: 4 }, { type: "tag", tag: "b" })
    assert.deepEqual(state, { ...INITIAL_LIBRARY, tag: "b", pages: 1 })
    state = libraryReducer({ ...state, pages: 4 }, { type: "tag", tag: "b" })
    assert.deepEqual(state, { ...INITIAL_LIBRARY, tag: null, pages: 1 })
  })

  test("เปลี่ยนการเรียง → กลับหน้าแรก คงตัวกรองไว้", () => {
    const state = libraryReducer({ status: "ongoing", tag: "a", sort: "latest", pages: 3 }, { type: "sort", sort: "title" })
    assert.deepEqual(state, { status: "ongoing", tag: "a", sort: "title", pages: 1 })
  })

  test("แสดงเพิ่ม → เพิ่มทีละหน้า คงตัวกรองไว้", () => {
    let state = libraryReducer({ ...INITIAL_LIBRARY, status: "completed" }, { type: "more" })
    state = libraryReducer(state, { type: "more" })
    assert.deepEqual(state, { status: "completed", tag: null, sort: "latest", pages: 3 })
  })

  test("ล้างตัวกรอง → กลับสถานะเริ่มต้นทั้งหมด (รวมการเรียง)", () => {
    assert.deepEqual(libraryReducer({ status: "completed", tag: "a", sort: "title", pages: 5 }, { type: "reset" }), INITIAL_LIBRARY)
  })

  test("shownCount: pages × 24 แต่ไม่เกินจำนวนทั้งหมด", () => {
    assert.equal(shownCount(100, 1), 24)
    assert.equal(shownCount(100, 2), 48)
    assert.equal(shownCount(100, 5), 100)
    assert.equal(shownCount(10, 1), 10)
    assert.equal(shownCount(0, 1), 0)
    assert.equal(shownCount(24, 1), 24)
    assert.equal(shownCount(25, 1), 24)
    assert.equal(shownCount(25, 2), 25)
  })
})

describe("ตัวเลือกบนแถบกรอง", () => {
  test("สถานะ: ทั้งหมด / กำลังอัปเดต / จบแล้ว ตามลำดับ", () => {
    assert.deepEqual(statusOptions(th), [
      { key: "all", label: "ทั้งหมด" },
      { key: "ongoing", label: "กำลังอัปเดต" },
      { key: "completed", label: "จบแล้ว" },
    ])
  })

  test("การเรียง: อัปเดตล่าสุด (ค่าเริ่มต้น) / ชื่อเรื่อง", () => {
    assert.deepEqual(sortOptions(th), [
      { key: "latest", label: "อัปเดตล่าสุด" },
      { key: "title", label: "ชื่อเรื่อง ก–ฮ" },
    ])
    assert.equal(sortOptions(th)[0].key, INITIAL_LIBRARY.sort)
  })

  test("isSortKey รับเฉพาะค่าที่มีในรายการ (ค่าจากฟอร์มเป็นข้อความอะไรก็ได้)", () => {
    assert.equal(isSortKey("latest"), true)
    assert.equal(isSortKey("title"), true)
    for (const bad of ["", "Latest", "oldest", "constructor", "toString", "__proto__"]) assert.equal(isSortKey(bad), false, bad)
  })
})

describe("ข้อความของตัวเลือกและปุ่มอ่านต่อ (หลายภาษา)", () => {
  test("ตัวเลือกสถานะ/การเรียง: คีย์เดิม ป้ายตามภาษา ไม่ซ้ำกัน", () => {
    for (const m of [en, lo]) {
      assert.deepEqual(statusOptions(m).map((o) => o.key), ["all", "ongoing", "completed"])
      assert.deepEqual(sortOptions(m).map((o) => o.key), ["latest", "title"])
      assert.equal(new Set(statusOptions(m).map((o) => o.label)).size, 3)
      assert.equal(new Set(sortOptions(m).map((o) => o.label)).size, 2)
    }
    assert.notDeepEqual(statusOptions(lo).map((o) => o.label), statusOptions(th).map((o) => o.label))
    assert.equal(statusOptions(en)[1]!.label, "Ongoing")
  })

  test("resumeInfo: ป้ายทุกกรณีตามภาษา (ปลายทางและตัวเลขไม่เปลี่ยน)", () => {
    for (const m of [en, lo]) {
      const mid = resumeInfo(novel({ id: 7, latestNumber: 30 }), progress({ number: 12, pct: 40 }), m)
      assert.equal(mid.label, m.library.resumeContinue(12))
      assert.equal(mid.href, "/novel/7/12")
      assert.equal(resumeInfo(novel({ id: 7, latestNumber: 30 }), progress({ number: 28, pct: 100, next: null }), m).label, m.library.resumeNew)
      assert.equal(resumeInfo(novel({ id: 7, latestNumber: 30 }), progress({ number: 30, pct: 100, next: null }), m).label, m.library.resumeCaughtUp)
      assert.equal(resumeInfo(novel({ id: 7, latestNumber: null }), progress({ number: 3, pct: 20 }), m).label, m.library.resumeView)
    }
    assert.match(en.library.resumeContinue(12), /12/)
    assert.doesNotMatch(lo.library.resumeContinue(12), /[\u0E00-\u0E7F]/)
  })

  test("continueItems ใส่ป้ายตามภาษา", () => {
    const list = [novel({ id: 1, latestNumber: 10 })]
    const [item] = continueItems(list, [1], () => progress({ number: 3, pct: 20 }), lo)
    assert.equal(item!.info.label, lo.library.resumeContinue(3))
  })
})
