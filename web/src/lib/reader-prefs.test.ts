import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { installStorage, restoreGlobals, type StorageSetup } from "../testing/helpers"
import { RATE_MAX, RATE_MIN, clampFontSize, clampRate, getReaderPrefs, saveReaderPrefs, type ReaderPrefs } from "./reader-prefs"
import { KEYS } from "./storage"

/** การตั้งค่าหน้าอ่านของผู้อ่าน (ขนาดตัวอักษร ฟอนต์ ความเร็วเสียง) เก็บในเครื่อง — ข้อมูลเสียต้องไม่ทำให้หน้าอ่านพัง */

afterEach(restoreGlobals)

const DEFAULTS: ReaderPrefs = { fontSize: 18, font: "sarabun", rate: 1 }
const prefsFrom = (stored: unknown): ReaderPrefs => {
  installStorage({ initial: { [KEYS.reader]: typeof stored === "string" ? stored : JSON.stringify(stored) } })
  try {
    return getReaderPrefs()
  } finally {
    restoreGlobals()
  }
}

describe("clampFontSize", () => {
  test("ปัดเป็นเลขคู่ใกล้สุดในช่วง 16–26 (15→16, 17→18, 30→26)", () => {
    assert.equal(clampFontSize(15), 16)
    assert.equal(clampFontSize(17), 18)
    assert.equal(clampFontSize(30), 26)
  })

  test("เลขคู่ในช่วงคงเดิมทุกขั้น: 16 18 20 22 24 26", () => {
    for (const size of [16, 18, 20, 22, 24, 26]) assert.equal(clampFontSize(size), size)
  })

  test("เลขคี่ปัดขึ้น (ตรงกลางระหว่างสองเลขคู่) และทศนิยมปัดไปเลขคู่ที่ใกล้กว่า", () => {
    assert.equal(clampFontSize(19), 20)
    assert.equal(clampFontSize(21), 22)
    assert.equal(clampFontSize(25), 26)
    assert.equal(clampFontSize(16.9), 16)
    assert.equal(clampFontSize(17.01), 18)
    assert.equal(clampFontSize(24.9), 24)
  })

  test("นอกช่วยถูกตรึงที่ปลายช่วง: เล็กเกิน → 16, ใหญ่เกิน → 26 (รวมค่าติดลบและอนันต์)", () => {
    assert.equal(clampFontSize(0), 16)
    assert.equal(clampFontSize(-5), 16)
    assert.equal(clampFontSize(27), 26)
    assert.equal(clampFontSize(1000), 26)
    assert.equal(clampFontSize(Infinity), 26)
    assert.equal(clampFontSize(-Infinity), 16)
  })

  test("NaN → ขนาดเริ่มต้น 18", () => {
    assert.equal(clampFontSize(Number.NaN), 18)
  })
})

describe("clampRate", () => {
  test("ช่วงที่ใช้ได้คือ 0.8–1.4 (ตรงกับตัวอ่านออกเสียงของหน้าอ่าน)", () => {
    assert.equal(RATE_MIN, 0.8)
    assert.equal(RATE_MAX, 1.4)
  })

  test("ค่าในช่วงคงเดิม รวมปลายช่วงทั้งสอง", () => {
    for (const rate of [0.8, 0.9, 1, 1.15, 1.4]) assert.equal(clampRate(rate), rate)
  })

  test("นอกช่วงถูกตรึงที่ปลายช่วง; NaN → 1", () => {
    assert.equal(clampRate(0.79), 0.8)
    assert.equal(clampRate(0), 0.8)
    assert.equal(clampRate(-3), 0.8)
    assert.equal(clampRate(-Infinity), 0.8)
    assert.equal(clampRate(1.41), 1.4)
    assert.equal(clampRate(10), 1.4)
    assert.equal(clampRate(Infinity), 1.4)
    assert.equal(clampRate(Number.NaN), 1)
  })
})

describe("getReaderPrefs", () => {
  test("ยังไม่เคยตั้งอะไร → ค่าเริ่มต้น 18 / sarabun / 1", () => {
    installStorage()
    assert.deepEqual(getReaderPrefs(), DEFAULTS)
  })

  test("ได้วัตถุใหม่ทุกครั้ง (แก้ผลที่ได้ไม่ทำให้ค่าเริ่มต้นเพี้ยน)", () => {
    installStorage()
    const first = getReaderPrefs()
    first.fontSize = 26
    assert.deepEqual(getReaderPrefs(), DEFAULTS)
  })

  test("อ่านค่าที่ถูกต้องที่เก็บไว้ได้ครบทั้งสามช่อง", () => {
    assert.deepEqual(prefsFrom({ fontSize: 22, font: "serif", rate: 1.2 }), { fontSize: 22, font: "serif", rate: 1.2 })
    assert.deepEqual(prefsFrom({ fontSize: 16, font: "sarabun", rate: 0.8 }), { fontSize: 16, font: "sarabun", rate: 0.8 })
  })

  test("ข้อมูลเสียทั้งก้อน (JSON เสีย ไม่ใช่วัตถุ) → ค่าเริ่มต้น", () => {
    for (const bad of ["{oops", "[]", "[1,2,3]", '"serif"', "null", "42", "true", ""]) assert.deepEqual(prefsFrom(bad), DEFAULTS, bad)
  })

  test("เสียบางช่อง → ช่องที่ถูกต้องยังอยู่ ช่องที่เสียใช้ค่าเริ่มต้น", () => {
    assert.deepEqual(prefsFrom({ fontSize: "ใหญ่", font: "serif", rate: 1.2 }), { fontSize: 18, font: "serif", rate: 1.2 })
    assert.deepEqual(prefsFrom({ fontSize: 22, font: "comic-sans", rate: 1.2 }), { fontSize: 22, font: "sarabun", rate: 1.2 })
    assert.deepEqual(prefsFrom({ fontSize: 22, font: "serif", rate: "เร็ว" }), { fontSize: 22, font: "serif", rate: 1 })
    assert.deepEqual(prefsFrom({ fontSize: null, font: 5, rate: [] }), DEFAULTS)
    assert.deepEqual(prefsFrom({ fontSize: 22 }), { fontSize: 22, font: "sarabun", rate: 1 })
    assert.deepEqual(prefsFrom({}), DEFAULTS)
  })

  test("ค่าที่อ่านมาแต่อยู่นอกช่วง/ไม่ตรงขั้นถูกปรับเข้าช่วง (ไม่ทิ้ง)", () => {
    assert.deepEqual(prefsFrom({ fontSize: 40, font: "serif", rate: 5 }), { fontSize: 26, font: "serif", rate: 1.4 })
    assert.deepEqual(prefsFrom({ fontSize: 17, font: "serif", rate: 0.1 }), { fontSize: 18, font: "serif", rate: 0.8 })
    assert.deepEqual(prefsFrom({ fontSize: 3, font: "serif", rate: -1 }), { fontSize: 16, font: "serif", rate: 0.8 })
  })

  test("ช่องแปลกปลอมไม่หลุดออกมา", () => {
    assert.deepEqual(Object.keys(prefsFrom({ ...DEFAULTS, theme: "paper", x: 1 })).sort(), ["font", "fontSize", "rate"])
  })
})

describe("saveReaderPrefs", () => {
  test("เก็บแล้วอ่านกลับได้เหมือนเดิม", () => {
    installStorage()
    saveReaderPrefs({ fontSize: 24, font: "serif", rate: 1.3 })
    assert.deepEqual(getReaderPrefs(), { fontSize: 24, font: "serif", rate: 1.3 })
  })

  test("รูปแบบที่เก็บจริง: JSON สามช่อง ใต้ koymukarnnovel.reader (ผู้อ่านเก่าต้องยังอ่านได้หลังอัปเดตแอป)", () => {
    const store = installStorage()
    saveReaderPrefs({ fontSize: 24, font: "serif", rate: 1.3 })
    assert.deepEqual(Object.keys(store), [KEYS.reader])
    assert.deepEqual(JSON.parse(store[KEYS.reader]), { fontSize: 24, font: "serif", rate: 1.3 })
  })

  test("ปรับค่าให้ถูกต้องก่อนเก็บ และไม่เก็บช่องเกิน", () => {
    const store = installStorage()
    saveReaderPrefs({ fontSize: 99, font: "wingdings", rate: Number.NaN, extra: "x" } as unknown as ReaderPrefs)
    assert.deepEqual(JSON.parse(store[KEYS.reader]), { fontSize: 26, font: "sarabun", rate: 1 })
    saveReaderPrefs({ fontSize: 15, font: "serif", rate: 9 })
    assert.deepEqual(JSON.parse(store[KEYS.reader]), { fontSize: 16, font: "serif", rate: 1.4 })
  })

  test("เก็บใหม่ทับของเดิม", () => {
    installStorage()
    saveReaderPrefs({ fontSize: 24, font: "serif", rate: 1.3 })
    saveReaderPrefs({ fontSize: 20, font: "sarabun", rate: 0.9 })
    assert.deepEqual(getReaderPrefs(), { fontSize: 20, font: "sarabun", rate: 0.9 })
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
    test(`${name}: อ่านได้ค่าเริ่มต้น เก็บแล้วไม่โยน`, () => {
      installStorage(setup)
      assert.deepEqual(getReaderPrefs(), DEFAULTS)
      assert.doesNotThrow(() => saveReaderPrefs({ fontSize: 24, font: "serif", rate: 1.3 }))
    })
  }
})
