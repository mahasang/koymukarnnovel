import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { installStorage, restoreGlobals, type StorageSetup } from "../testing/helpers"
import { FINISHED_PCT, getHistory, getProgress, resumeTarget, saveProgress, type Progress } from "./progress"
import { KEYS } from "./storage"

/** ความคืบหน้าการอ่านต่อเรื่อง + ประวัติเรื่องที่เพิ่งอ่าน (เก็บในเครื่องผู้อ่าน ไม่มีบัญชี) */

afterEach(restoreGlobals)

const at = (number: number, pct: number, next: number | null) => ({ number, pct, next })
const stored = (store: Record<string, string>, key: string): unknown => JSON.parse(store[key])

describe("saveProgress / getProgress", () => {
  test("ยังไม่เคยอ่านเรื่องนั้น → null", () => {
    installStorage()
    assert.equal(getProgress(7), null)
  })

  test("เก็บ {number, pct, next, at} ต่อเรื่อง และอ่านกลับได้เหมือนเดิม", () => {
    installStorage()
    saveProgress(7, at(3, 42, 4), 1_000)
    assert.deepEqual(getProgress(7), { number: 3, pct: 42, next: 4, at: 1_000 })
  })

  test("รูปแบบที่เก็บจริง: แผนที่ novelId → ความคืบหน้า ใต้ koymukarnnovel.progress และอาร์เรย์ id ใต้ koymukarnnovel.history (ผู้อ่านเก่าต้องยังอ่านได้หลังอัปเดตแอป)", () => {
    const store = installStorage()
    saveProgress(7, at(3, 42, 4), 1_000)
    saveProgress(9, at(1, 5, null), 2_000)
    assert.deepEqual(stored(store, KEYS.progress), {
      "7": { number: 3, pct: 42, next: 4, at: 1_000 },
      "9": { number: 1, pct: 5, next: null, at: 2_000 },
    })
    assert.deepEqual(stored(store, KEYS.history), [9, 7])
  })

  test("แต่ละเรื่องแยกกัน; อ่านซ้ำเรื่องเดิมทับค่าเก่า (ตอนล่าสุดชนะ)", () => {
    installStorage()
    saveProgress(1, at(2, 10, 3), 100)
    saveProgress(2, at(8, 90, 9), 200)
    saveProgress(1, at(5, 60, 6), 300)
    assert.deepEqual(getProgress(1), { number: 5, pct: 60, next: 6, at: 300 })
    assert.deepEqual(getProgress(2), { number: 8, pct: 90, next: 9, at: 200 })
    assert.equal(getProgress(3), null)
  })

  test("ไม่ส่งเวลา → ใช้เวลาปัจจุบัน", () => {
    installStorage()
    const before = Date.now()
    saveProgress(1, at(1, 1, 2))
    const after = Date.now()
    const { at: savedAt } = getProgress(1) as Progress
    assert.ok(savedAt >= before && savedAt <= after, `${before} ≤ ${savedAt} ≤ ${after}`)
  })

  test("ตอนที่ 0 (บทนำ) และ next ที่เป็น null เก็บได้ตามจริง", () => {
    installStorage()
    saveProgress(1, at(0, 0, null), 5)
    assert.deepEqual(getProgress(1), { number: 0, pct: 0, next: null, at: 5 })
  })

  test("pct ปัดเป็นจำนวนเต็มและจำกัด 0–100 (ค่าจากการเลื่อนหน้าจออาจเป็นทศนิยม เกิน 100 หรือ NaN)", () => {
    installStorage()
    const cases: [number, number][] = [[42.4, 42], [42.5, 43], [99.6, 100], [150, 100], [-5, 0], [Number.NaN, 0], [Infinity, 100], [-Infinity, 0]]
    for (const [input, expected] of cases) {
      saveProgress(1, at(1, input, 2), 1)
      assert.equal(getProgress(1)?.pct, expected, `pct ${input}`)
    }
  })

  test("next ที่ใช้ไม่ได้ (ไม่ใช่จำนวนเต็มไม่ติดลบ) ถูกเก็บเป็น null", () => {
    installStorage()
    for (const next of [Number.NaN, 4.5, -1, Infinity, "4" as unknown as number, undefined as unknown as number]) {
      saveProgress(1, at(3, 50, next), 1)
      assert.equal(getProgress(1)?.next, null, String(next))
    }
  })

  test("novelId หรือเลขตอนที่ใช้ไม่ได้ → ไม่เก็บอะไรเลย (ทั้งความคืบหน้าและประวัติ)", () => {
    const store = installStorage()
    for (const id of [0, -1, 1.5, Number.NaN, Infinity]) saveProgress(id, at(1, 1, 2), 1)
    for (const number of [-1, 1.5, Number.NaN, Infinity]) saveProgress(1, at(number, 1, 2), 1)
    assert.deepEqual(store, {})
  })

  test("ลบรายการเสียของเรื่องอื่นทิ้งตอนเขียนใหม่ (รวมคีย์ที่ไม่ใช่เลข id ตรงตัว) แต่รายการดีของเรื่องอื่นอยู่ครบ", () => {
    const good = { number: 2, pct: 20, next: 3, at: 10 }
    const mess = { "2": { number: "x" }, "3": null, "4": 7, abc: good, "0": good, "-1": good, "01": good, "1.5": good, "1e3": good, " 8": good }
    const store = installStorage({ initial: { [KEYS.progress]: JSON.stringify({ "1": good, ...mess }) } })
    saveProgress(5, at(1, 1, 2), 20)
    assert.deepEqual(stored(store, KEYS.progress), { "1": good, "5": { number: 1, pct: 1, next: 2, at: 20 } })
  })

  test("แผนที่ที่เก็บไว้ไม่ใช่วัตถุ (อาร์เรย์ — แม้มีรายการดีอยู่ช่องที่ 2 — สตริง null JSON เสีย) → เริ่มใหม่ ไม่โยน", () => {
    const entry = { number: 4, pct: 40, next: 5, at: 9 }
    for (const bad of ["[]", '"x"', "null", "7", "{oops", JSON.stringify([null, entry, entry])]) {
      const store = installStorage({ initial: { [KEYS.progress]: bad } })
      saveProgress(1, at(1, 1, 2), 5)
      assert.deepEqual(stored(store, KEYS.progress), { "1": { number: 1, pct: 1, next: 2, at: 5 } }, bad)
      restoreGlobals()
    }
  })
})

describe("getProgress: ตรวจรูปร่างข้อมูลที่อ่านจากเครื่อง (อาจเสีย/ถูกแก้มือ/มาจากแอปรุ่นเก่า)", () => {
  const good = { number: 3, pct: 42, next: 4, at: 1_000 }
  const read = (entry: unknown) => {
    installStorage({ initial: { [KEYS.progress]: JSON.stringify({ "7": entry }) } })
    try {
      return getProgress(7)
    } finally {
      restoreGlobals()
    }
  }

  test("รายการที่ถูกต้องอ่านได้ (รวม pct เป็นทศนิยมที่อยู่ในช่วง และ next เป็น null)", () => {
    assert.deepEqual(read(good), good)
    assert.deepEqual(read({ ...good, pct: 0 }), { ...good, pct: 0 })
    assert.deepEqual(read({ ...good, pct: 100 }), { ...good, pct: 100 })
    assert.deepEqual(read({ ...good, pct: 94.5 }), { ...good, pct: 94.5 })
    assert.deepEqual(read({ ...good, next: null }), { ...good, next: null })
    assert.deepEqual(read({ ...good, number: 0, next: 0 }), { ...good, number: 0, next: 0 })
  })

  const BAD: [string, unknown][] = [
    ["ไม่ใช่วัตถุ (null)", null],
    ["ไม่ใช่วัตถุ (ตัวเลข)", 5],
    ["ไม่ใช่วัตถุ (อาร์เรย์)", [3, 42, 4, 1_000]],
    ["ขาด number", { pct: 42, next: 4, at: 1_000 }],
    ["number เป็นสตริง", { ...good, number: "3" }],
    ["number ติดลบ", { ...good, number: -1 }],
    ["number เป็นทศนิยม", { ...good, number: 1.5 }],
    ["ขาด pct", { number: 3, next: 4, at: 1_000 }],
    ["pct เป็นสตริง", { ...good, pct: "42" }],
    ["pct เกิน 100", { ...good, pct: 100.5 }],
    ["pct ติดลบ", { ...good, pct: -1 }],
    ["ขาด next (ต้องเป็น null อย่างชัดเจน)", { number: 3, pct: 42, at: 1_000 }],
    ["next เป็นสตริง", { ...good, next: "4" }],
    ["next เป็นทศนิยม", { ...good, next: 4.5 }],
    ["next ติดลบ", { ...good, next: -2 }],
    ["ขาด at", { number: 3, pct: 42, next: 4 }],
    ["at เป็นสตริง", { ...good, at: "now" }],
    ["at เป็น null", { ...good, at: null }],
  ]
  test("at ที่ไม่ใช่จำนวนจำกัด (JSON อย่าง 1e999 อ่านออกมาเป็น Infinity) → null", () => {
    installStorage({ initial: { [KEYS.progress]: '{"7":{"number":3,"pct":42,"next":4,"at":1e999}}' } })
    assert.equal(getProgress(7), null)
  })

  for (const [name, entry] of BAD) {
    test(`${name} → null`, () => {
      assert.equal(read(entry), null)
    })
  }

  test("ผลที่คืนมีเฉพาะสี่ช่อง (ช่องแปลกปลอมไม่หลุดออกมา)", () => {
    assert.deepEqual(Object.keys(read({ ...good, extra: "x" }) as Progress).sort(), ["at", "next", "number", "pct"])
  })

  test("novelId ที่ใช้ไม่ได้ → null แม้แผนที่มีคีย์นั้น", () => {
    installStorage({ initial: { [KEYS.progress]: JSON.stringify({ "0": good, "-1": good, "1.5": good, NaN: good }) } })
    for (const id of [0, -1, 1.5, Number.NaN]) assert.equal(getProgress(id), null, String(id))
  })

  test("แผนที่ทั้งก้อนไม่ใช่วัตถุ (แม้เป็นอาร์เรย์ที่มีรายการดีอยู่ช่องที่ 1) / JSON เสีย → null", () => {
    for (const bad of ["[]", '"x"', "null", "{oops", JSON.stringify([null, good])]) {
      installStorage({ initial: { [KEYS.progress]: bad } })
      assert.equal(getProgress(7), null, bad)
      restoreGlobals()
    }
  })
})

describe("getHistory", () => {
  test("ยังไม่เคยอ่านอะไร → []", () => {
    installStorage()
    assert.deepEqual(getHistory(), [])
  })

  test("เรื่องที่เพิ่งอ่านล่าสุดมาก่อน", () => {
    installStorage()
    for (const id of [1, 2, 3]) saveProgress(id, at(1, 1, 2), id)
    assert.deepEqual(getHistory(), [3, 2, 1])
  })

  test("ใส่ 12 เรื่อง เหลือ 10 เรื่องล่าสุด (เรื่องที่ 1–2 หลุด) ทั้งตอนอ่านและในที่เก็บจริง (ไม่สะสมเกิน)", () => {
    const store = installStorage()
    for (let id = 1; id <= 12; id++) saveProgress(id, at(1, 1, 2), id)
    assert.deepEqual(getHistory(), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    assert.deepEqual(stored(store, KEYS.history), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  })

  test("เรื่องเดิมที่อ่านซ้ำเลื่อนขึ้นหน้าสุดไม่ซ้ำ; ถ้าอยู่หน้าสุดอยู่แล้วลำดับไม่เปลี่ยน", () => {
    installStorage()
    for (const id of [1, 2, 3]) saveProgress(id, at(1, 1, 2), id)
    saveProgress(1, at(2, 5, 3), 10)
    assert.deepEqual(getHistory(), [1, 3, 2])
    saveProgress(1, at(2, 6, 3), 11)
    assert.deepEqual(getHistory(), [1, 3, 2])
  })

  test("ครบ 10 เรื่องแล้วอ่านซ้ำเรื่องที่มีอยู่ → ไม่มีใครหลุด (ย้ายก่อนค่อยตัดท้าย)", () => {
    installStorage()
    for (let id = 1; id <= 10; id++) saveProgress(id, at(1, 1, 2), id)
    saveProgress(5, at(2, 9, 3), 99)
    assert.deepEqual(getHistory(), [5, 10, 9, 8, 7, 6, 4, 3, 2, 1])
  })

  test("ข้อมูลเสียในเครื่องถูกคัด: เก็บเฉพาะ id จำนวนเต็มบวกที่ไม่ซ้ำ (ตัวแรกชนะ) ไม่เกิน 10", () => {
    installStorage({ initial: { [KEYS.history]: JSON.stringify([3, "4", 3, -1, 0, 2.5, null, 5, true, 9]) } })
    assert.deepEqual(getHistory(), [3, 5, 9])
    restoreGlobals()
    installStorage({ initial: { [KEYS.history]: JSON.stringify(Array.from({ length: 15 }, (_, i) => i + 1)) } })
    assert.deepEqual(getHistory(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  test("ที่เก็บไม่ใช่อาร์เรย์ / JSON เสีย → []", () => {
    for (const bad of ['{"a":1}', '"x"', "null", "5", "[oops"]) {
      installStorage({ initial: { [KEYS.history]: bad } })
      assert.deepEqual(getHistory(), [], bad)
      restoreGlobals()
    }
  })
})

describe("resumeTarget", () => {
  const p = (number: number, pct: number, next: number | null): Progress => ({ number, pct, next, at: 0 })

  test("อ่านยังไม่จบ (pct 94) → ตอนเดิม ตำแหน่งเดิม", () => {
    assert.deepEqual(resumeTarget(p(4, 94, 5)), { number: 4, fromPct: 94 })
  })

  test("อ่านจบแล้ว (pct 95) และมีตอนถัดไป → ไปตอนถัดไป เริ่มจากต้น", () => {
    assert.deepEqual(resumeTarget(p(4, 95, 5)), { number: 5, fromPct: 0 })
    assert.deepEqual(resumeTarget(p(4, 100, 5)), { number: 5, fromPct: 0 })
  })

  test("อ่านจบแล้วแต่ไม่มีตอนถัดไป (pct 95/100) → ตอนเดิม เริ่มจากต้น", () => {
    assert.deepEqual(resumeTarget(p(4, 100, null)), { number: 4, fromPct: 0 })
    assert.deepEqual(resumeTarget(p(4, 95, null)), { number: 4, fromPct: 0 })
  })

  test("ยังไม่จบแม้ไม่มีตอนถัดไป → ตอนเดิม ตำแหน่งเดิม; เพิ่งเปิด (pct 0) → ตอนเดิมจากต้น", () => {
    assert.deepEqual(resumeTarget(p(4, 50, null)), { number: 4, fromPct: 50 })
    assert.deepEqual(resumeTarget(p(4, 0, 5)), { number: 4, fromPct: 0 })
  })

  test("เลข 0 ก็เป็นตอนจริง: ตรวจ next ว่าเป็น null ไม่ใช่ตรวจว่าเป็นเท็จ", () => {
    assert.deepEqual(resumeTarget(p(3, 100, 0)), { number: 0, fromPct: 0 })
  })

  test("เกณฑ์ 'อ่านจบ' คือ FINISHED_PCT = 95 (หน้าอ่านใช้ค่าเดียวกัน)", () => {
    assert.equal(FINISHED_PCT, 95)
    assert.equal(resumeTarget(p(1, FINISHED_PCT - 0.5, 2)).number, 1)
    assert.equal(resumeTarget(p(1, FINISHED_PCT, 2)).number, 2)
  })
})

describe("localStorage ใช้ไม่ได้", () => {
  const BROKEN: [string, StorageSetup][] = [
    ["แค่เข้าถึงก็โยน", { accessThrows: true }],
    ["อ่านโยน", { readThrows: true }],
    ["เขียนโยน (โควตาเต็ม)", { writeThrows: true }],
    ["ไม่มี localStorage", { absent: true }],
  ]
  for (const [name, setup] of BROKEN) {
    test(`${name}: ไม่โยนสักฟังก์ชัน และอ่านได้ค่าว่าง`, () => {
      installStorage(setup)
      assert.doesNotThrow(() => saveProgress(1, at(1, 50, 2), 1))
      assert.equal(getProgress(1), null)
      assert.deepEqual(getHistory(), [])
    })
  }
})
