import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { installStorage, restoreGlobals, type StorageSetup } from "../testing/helpers"
import { setTheme } from "./theme"
import { KEYS, readJson, writeJson } from "./storage"

/** `readJson`/`writeJson` กับ `localStorage` ปลอม — ทุกทางที่การเก็บข้อมูลในเครื่องล้มต้องไม่โยน (บางเบราว์เซอร์ปิดไว้ แค่เข้าถึงก็โยน) */

afterEach(restoreGlobals)

/** สภาพที่ localStorage ใช้ไม่ได้ทุกแบบ */
const BROKEN: [string, StorageSetup][] = [
  ["แค่เข้าถึง localStorage ก็โยน (SecurityError)", { accessThrows: true }],
  ["getItem/setItem โยน", { readThrows: true, writeThrows: true }],
  ["ไม่มี localStorage เลย (นอกเบราว์เซอร์)", { absent: true }],
]

describe("KEYS", () => {
  test("หกคีย์ที่แอปใช้เก็บข้อมูลในเครื่อง (ห้าของผู้อ่าน รวมภาษา UI + ตัวเลือกเพิ่มตอนของเจ้าของ) ขึ้นต้น koymukarnnovel. ทั้งหมด", () => {
    assert.deepEqual(KEYS, {
      theme: "koymukarnnovel.theme",
      reader: "koymukarnnovel.reader",
      progress: "koymukarnnovel.progress",
      history: "koymukarnnovel.history",
      lang: "koymukarnnovel.lang",
      addOptions: "koymukarnnovel.admin.add",
    })
  })

  test("KEYS.theme คือคีย์เดียวกับที่ setTheme เขียน และที่ theme-init.js อ่านก่อนวาดหน้า (ถ้าคีย์เพี้ยน ธีมที่เลือกไว้จะไม่ถูกจำ)", () => {
    const store = installStorage()
    setTheme("paper")
    assert.deepEqual(Object.keys(store), [KEYS.theme])
    assert.equal(store[KEYS.theme], "paper")

    const here = path.dirname(fileURLToPath(import.meta.url))
    const init = fs.readFileSync(path.join(here, "..", "..", "public", "theme-init.js"), "utf8")
    assert.equal(init.match(/localStorage\.getItem\("([^"]+)"\)/)?.[1], KEYS.theme)
  })
})

describe("readJson", () => {
  test("คืนค่าที่เก็บไว้เป็น JSON ทุกชนิด (วัตถุ อาร์เรย์ สตริง ตัวเลข บูลีน)", () => {
    installStorage({
      initial: { obj: '{"a":[1,2],"b":"ก"}', arr: "[1,2,3]", str: '"สวัสดี"', num: "42", yes: "true", no: "false" },
    })
    assert.deepEqual(readJson("obj", null), { a: [1, 2], b: "ก" })
    assert.deepEqual(readJson("arr", null), [1, 2, 3])
    assert.equal(readJson("str", ""), "สวัสดี")
    assert.equal(readJson("num", 0), 42)
    assert.equal(readJson("yes", false), true)
    assert.equal(readJson("no", true), false)
  })

  test("ไม่มีคีย์นั้น → fallback (ตัวเดียวกัน ไม่ใช่สำเนา)", () => {
    installStorage()
    const fallback = { empty: true }
    assert.equal(readJson("missing", fallback), fallback)
  })

  test("JSON เสีย/ว่าง/ถูกตัดครึ่ง → fallback ไม่โยน", () => {
    installStorage({ initial: { broken: "{not json", empty: "", cut: '{"a":' } })
    for (const key of ["broken", "empty", "cut"]) assert.deepEqual(readJson(key, ["fb"]), ["fb"], key)
  })

  for (const [name, setup] of BROKEN) {
    test(`${name} → fallback ไม่โยน`, () => {
      installStorage({ ...setup, initial: { k: "1" } })
      assert.equal(readJson("k", "fb"), "fb")
    })
  }
})

describe("writeJson", () => {
  test("เก็บเป็นข้อความ JSON ใต้คีย์นั้น คืน true และ readJson อ่านกลับได้เหมือนเดิม", () => {
    const store = installStorage()
    const value = { n: 1, list: ["ก", "ข"], nested: { ok: true, none: null } }
    assert.equal(writeJson("k", value), true)
    assert.equal(store.k, JSON.stringify(value))
    assert.deepEqual(readJson("k", null), value)
  })

  test("เขียนทับค่าเดิมได้ และเก็บค่า falsy ที่ถูกต้อง (0, false, ค่าว่าง, null) ได้", () => {
    const store = installStorage({ initial: { k: '"old"' } })
    for (const [value, text] of [[0, "0"], [false, "false"], ["", '""'], [null, "null"], [[], "[]"]] as const) {
      assert.equal(writeJson("k", value), true)
      assert.equal(store.k, text)
    }
  })

  test("ค่าที่แปลงเป็น JSON ไม่ได้ (undefined / ฟังก์ชัน / วงวน / BigInt) → false และไม่แตะของเดิม", () => {
    const store = installStorage({ initial: { k: '"keep"' } })
    const loop: Record<string, unknown> = {}
    loop.self = loop
    for (const value of [undefined, () => 1, Symbol("s"), loop, 10n]) assert.equal(writeJson("k", value), false, String(typeof value))
    assert.equal(store.k, '"keep"')
  })

  for (const [name, setup] of BROKEN) {
    test(`${name} → false ไม่โยน`, () => {
      installStorage(setup)
      assert.equal(writeJson("k", { a: 1 }), false)
    })
  }

  test("โควตาเต็ม (setItem โยน) → false ส่วนการอ่านยังใช้ได้", () => {
    installStorage({ writeThrows: true, initial: { k: "7" } })
    assert.equal(writeJson("k", 8), false)
    assert.equal(readJson("k", 0), 7)
  })
})
