import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { THEMES, getTheme, setTheme, type ThemeId } from "./theme"

/** `getTheme`/`setTheme` กับ `document` และ `localStorage` ปลอม (ติดตั้งเป็น global ชั่วคราว คืนค่าเดิมหลังทุกเทสต์) */

const KEY = "koymukarnnovel.theme"
const g = globalThis as Record<string, unknown>
const saved = { document: Object.getOwnPropertyDescriptor(g, "document"), localStorage: Object.getOwnPropertyDescriptor(g, "localStorage") }

afterEach(() => {
  for (const name of ["document", "localStorage"] as const) {
    if (saved[name]) Object.defineProperty(g, name, saved[name])
    else delete g[name]
  }
})

interface Setup {
  /** ค่า data-theme ที่ตั้งอยู่ก่อนแล้ว (เช่นจาก theme-init.js) */
  dom?: string
  /** ค่าที่เก็บอยู่ใน localStorage */
  stored?: string
  /** เข้าถึง `localStorage` แล้วโยน */
  storageGetterThrows?: boolean
  /** `getItem`/`setItem` โยน */
  storageOpsThrow?: boolean
  noDocument?: boolean
  noStorage?: boolean
  /** `document.documentElement` อ่าน/เขียนแอตทริบิวต์ไม่ได้ (โยน) */
  domThrows?: boolean
}

function install(s: Setup = {}) {
  // เริ่มจากสภาพ "ไม่มีอะไรเลย" ทุกครั้ง — ไม่งั้นของที่ติดตั้งในการเรียกก่อนหน้าค้างอยู่และบังเคสที่ขอให้ไม่มี
  delete g.document
  delete g.localStorage
  const attributes: Record<string, string> = s.dom === undefined ? {} : { "data-theme": s.dom }
  const store: Record<string, string> = s.stored === undefined ? {} : { [KEY]: s.stored }
  if (!s.noDocument) {
    Object.defineProperty(g, "document", {
      configurable: true,
      value: {
        documentElement: {
          getAttribute: (name: string) => {
            if (s.domThrows) throw new Error("document ใช้ไม่ได้")
            return attributes[name] ?? null
          },
          setAttribute: (name: string, value: string) => {
            if (s.domThrows) throw new Error("document ใช้ไม่ได้")
            attributes[name] = value
          },
        },
      },
    })
  }
  if (!s.noStorage) {
    Object.defineProperty(g, "localStorage", {
      configurable: true,
      get() {
        if (s.storageGetterThrows) throw new DOMException("The operation is insecure.", "SecurityError")
        return {
          getItem(key: string) {
            if (s.storageOpsThrow) throw new Error("denied")
            return store[key] ?? null
          },
          setItem(key: string, value: string) {
            if (s.storageOpsThrow) throw new Error("quota")
            store[key] = value
          },
        }
      },
    })
  }
  return { attributes, store }
}

test("THEMES: สี่ธีมตามลำดับที่ใช้แสดง และ ThemeId คือสมาชิกของมัน", () => {
  assert.deepEqual([...THEMES], ["midnight", "paper", "sepia", "black"])
  const id: ThemeId = THEMES[0]
  assert.equal(id, "midnight")
})

test("getTheme: ไม่มีอะไรตั้งไว้เลย → midnight", () => {
  install()
  assert.equal(getTheme(), "midnight")
})

test("getTheme: อ่านธีมที่แสดงอยู่จาก data-theme ได้ทุกธีม", () => {
  for (const id of THEMES) {
    install({ dom: id })
    assert.equal(getTheme(), id)
  }
})

test("getTheme: ไม่มี data-theme → ใช้ค่าที่เก็บไว้ (ถ้าถูกต้อง)", () => {
  for (const id of THEMES) {
    install({ stored: id })
    assert.equal(getTheme(), id)
  }
})

test("getTheme: data-theme ชนะค่าที่เก็บไว้ (หน้าแสดงอยู่ด้วยธีมไหน นั่นคือความจริง เช่นตอนเก็บลงเครื่องไม่ได้)", () => {
  install({ dom: "sepia", stored: "paper" })
  assert.equal(getTheme(), "sepia")
})

test("getTheme: ค่าที่ไม่ถูกต้องถูกเมิน (data-theme เสียแต่ที่เก็บถูก → ใช้ที่เก็บ · เสียทั้งคู่ → midnight)", () => {
  install({ dom: "neon", stored: "black" })
  assert.equal(getTheme(), "black")
  install({ dom: "neon", stored: "also-bad" })
  assert.equal(getTheme(), "midnight")
  install({ dom: "constructor", stored: "toString" })
  assert.equal(getTheme(), "midnight")
})

test("getTheme: localStorage ใช้ไม่ได้ (โยนตอนเข้าถึง/ตอนอ่าน/ไม่มีตัวแปร) → ไม่โยน ได้ midnight หรือค่าจาก data-theme", () => {
  install({ storageGetterThrows: true })
  assert.equal(getTheme(), "midnight")
  install({ storageOpsThrow: true, stored: "paper" })
  assert.equal(getTheme(), "midnight")
  install({ noStorage: true })
  assert.equal(getTheme(), "midnight")
  install({ storageGetterThrows: true, dom: "paper" })
  assert.equal(getTheme(), "paper")
})

test("getTheme: ไม่มี document (นอกเบราว์เซอร์) → ใช้ที่เก็บ/ค่าเริ่มต้นโดยไม่โยน", () => {
  install({ noDocument: true, stored: "sepia" })
  assert.equal(getTheme(), "sepia")
  install({ noDocument: true, noStorage: true })
  assert.equal(getTheme(), "midnight")
})

test("getTheme: อ่านแอตทริบิวต์ของ document ไม่ได้ (โยน) → ใช้ที่เก็บ/ค่าเริ่มต้นโดยไม่โยน", () => {
  install({ domThrows: true, stored: "sepia" })
  assert.equal(getTheme(), "sepia")
  install({ domThrows: true })
  assert.equal(getTheme(), "midnight")
})

test("setTheme: ตั้ง <html data-theme> และเก็บชื่อธีมดิบๆ (ไม่ใช่ JSON) ลง koymukarnnovel.theme — theme-init.js อ่านค่านี้ตรงๆ", () => {
  for (const id of THEMES) {
    const { attributes, store } = install()
    assert.equal(setTheme(id), undefined)
    assert.equal(attributes["data-theme"], id)
    assert.equal(store[KEY], id)
    assert.deepEqual(Object.keys(attributes), ["data-theme"])
    assert.deepEqual(Object.keys(store), [KEY])
  }
})

test("setTheme แล้ว getTheme ได้ธีมเดิม (รวมกรณีเก็บลงเครื่องไม่ได้)", () => {
  install()
  setTheme("paper")
  assert.equal(getTheme(), "paper")
  install({ storageGetterThrows: true })
  setTheme("black")
  assert.equal(getTheme(), "black")
})

test("setTheme: ชื่อธีมที่ไม่ถูกต้อง (หลุดมาจากการ cast) ไม่ทำอะไรและไม่โยน", () => {
  const { attributes, store } = install({ dom: "sepia", stored: "sepia" })
  for (const bad of ["neon", "", "PAPER", "constructor", "__proto__", "toString"]) setTheme(bad as ThemeId)
  assert.equal(attributes["data-theme"], "sepia")
  assert.equal(store[KEY], "sepia")
})

test("setTheme: เก็บลงเครื่องไม่ได้ (โยนตอนเข้าถึง/ตอนเขียน/ไม่มีตัวแปร) ก็ยังเปลี่ยนธีมที่แสดงได้และไม่โยน", () => {
  for (const setup of [{ storageGetterThrows: true }, { storageOpsThrow: true }, { noStorage: true }] satisfies Setup[]) {
    const { attributes } = install(setup)
    setTheme("paper")
    assert.equal(attributes["data-theme"], "paper", JSON.stringify(setup))
  }
})

test("setTheme: ไม่มี document (นอกเบราว์เซอร์) ไม่โยน และยังจำธีมไว้ในเครื่อง", () => {
  const { store } = install({ noDocument: true })
  assert.doesNotThrow(() => setTheme("paper"))
  assert.equal(store[KEY], "paper")
})

test("setTheme: ตั้งแอตทริบิวต์ของ document ไม่ได้ (โยน) ไม่โยน และยังจำธีมไว้ในเครื่อง (สองขั้นแยกกัน ขั้นหนึ่งพังไม่ลากอีกขั้น)", () => {
  const { store } = install({ domThrows: true })
  assert.doesNotThrow(() => setTheme("sepia"))
  assert.equal(store[KEY], "sepia")
})
