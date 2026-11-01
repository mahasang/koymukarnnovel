import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { applyLocale, loadLocale, localeForPath, saveLocale } from "./apply"

const g = globalThis as { localStorage?: unknown }
const original = g.localStorage

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  g.localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
  return data
}

afterEach(() => {
  if (original === undefined) delete g.localStorage
  else g.localStorage = original
})

describe("applyLocale", () => {
  test("ตั้ง lang ของ <html>", () => {
    const doc = { documentElement: { lang: "th" } }
    applyLocale(doc, "lo")
    assert.equal(doc.documentElement.lang, "lo")
  })
})

describe("loadLocale / saveLocale", () => {
  test("เก็บแล้วอ่านกลับได้ ภายใต้คีย์ koymukarnnovel.lang", () => {
    const data = stubStorage()
    saveLocale("lo")
    assert.equal(data.get("koymukarnnovel.lang"), '"lo"')
    assert.equal(loadLocale(["th"]), "lo")
  })
  test("ยังไม่เคยเก็บ → ตรวจจากภาษาเบราว์เซอร์", () => {
    stubStorage()
    assert.equal(loadLocale(["en-GB"]), "en")
  })
  test("ค่าที่เก็บไว้เป็นขยะ (\"fr\", {}, JSON เสีย) → ตรวจจับ/ไทย ไม่โยน", () => {
    stubStorage({ "koymukarnnovel.lang": '"fr"' })
    assert.equal(loadLocale(["lo"]), "lo")
    stubStorage({ "koymukarnnovel.lang": "{}" })
    assert.equal(loadLocale([]), "th")
    stubStorage({ "koymukarnnovel.lang": "{not json" })
    assert.equal(loadLocale([]), "th")
  })
  test("localStorage โยนทุกครั้ง → loadLocale คืนไทย / ตรวจจับ, saveLocale ไม่โยน", () => {
    g.localStorage = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    assert.equal(loadLocale([]), "th")
    assert.equal(loadLocale(["lo"]), "lo")
    assert.doesNotThrow(() => saveLocale("en"))
  })
  test("ไม่มี localStorage เลย → ไม่โยน", () => {
    delete g.localStorage
    assert.equal(loadLocale(["en"]), "en")
    assert.doesNotThrow(() => saveLocale("en"))
  })
})

describe("localeForPath: หลังบ้านตรึงเป็นไทย ส่วนหน้าบ้านให้ผู้อ่านเลือก", () => {
  test("/admin และหน้าลูกของมัน → th", () => {
    for (const path of ["/admin", "/admin/", "/admin/novels/3", "/admin/settings"]) assert.equal(localeForPath(path), "th", path)
  })
  test("หน้าบ้านและชื่อที่ขึ้นต้นคล้าย admin → undefined (ใช้ที่ผู้อ่านเลือก)", () => {
    for (const path of ["/", "/novel/1", "/novel/1/2", "/about", "/administrator", "/adminx/1"]) assert.equal(localeForPath(path), undefined, path)
  })
})
