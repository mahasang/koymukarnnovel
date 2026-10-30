import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { ACCENT_IDS, syncAccent } from "./accent"

/** `<html>` จำลอง: เก็บแอตทริบิวต์ไว้ใน Map และจดการเขียนทุกครั้ง */
function fakeRoot(initial: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(initial))
  const writes: string[] = []
  return {
    attrs,
    writes,
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute(name: string, value: string) {
      writes.push(`set ${name}=${value}`)
      attrs.set(name, value)
    },
    removeAttribute(name: string) {
      writes.push(`remove ${name}`)
      attrs.delete(name)
    },
  }
}

describe("syncAccent", () => {
  test("ชุดสีที่ไม่ใช่ค่าเริ่มต้น → ตั้ง data-accent", () => {
    const root = fakeRoot()
    syncAccent(root, "teal")
    assert.equal(root.getAttribute("data-accent"), "teal")
    assert.deepEqual(root.writes, ["set data-accent=teal"])
  })

  test("เปลี่ยนชุดสี → เขียนทับของเดิม", () => {
    const root = fakeRoot({ "data-accent": "violet" })
    syncAccent(root, "amber")
    assert.equal(root.getAttribute("data-accent"), "amber")
  })

  test("ค่าเริ่มต้น (default) → ลบ data-accent ที่เซิร์ฟเวอร์ใส่ไว้ออก", () => {
    const root = fakeRoot({ "data-accent": "pink" })
    syncAccent(root, "default")
    assert.equal(root.getAttribute("data-accent"), null)
    assert.deepEqual(root.writes, ["remove data-accent"])
  })

  test("ตรงกับที่เซิร์ฟเวอร์ใส่มาแล้ว → ไม่แตะ DOM เลย (ไม่เขียนซ้ำ)", () => {
    const same = fakeRoot({ "data-accent": "blue" })
    syncAccent(same, "blue")
    assert.deepEqual(same.writes, [])
    const none = fakeRoot()
    syncAccent(none, "default")
    assert.deepEqual(none.writes, [])
  })

  test("ชื่อชุดสีที่ไม่รู้จัก (เวอร์ชันหน้าเว็บกับเซิร์ฟเวอร์ไม่ตรงกัน) → ไม่แตะอะไร คงค่าที่เซิร์ฟเวอร์ใส่ไว้", () => {
    for (const bad of ["", "red", "VIOLET", "violet ", "__proto__", "toString"]) {
      const root = fakeRoot({ "data-accent": "teal" })
      syncAccent(root, bad)
      assert.equal(root.getAttribute("data-accent"), "teal", JSON.stringify(bad))
      assert.deepEqual(root.writes, [], JSON.stringify(bad))
    }
  })

  test("ไม่แตะแอตทริบิวต์อื่นของ <html> (เช่น data-theme)", () => {
    const root = fakeRoot({ "data-theme": "paper", lang: "th" })
    syncAccent(root, "pink")
    syncAccent(root, "default")
    assert.equal(root.getAttribute("data-theme"), "paper")
    assert.equal(root.getAttribute("lang"), "th")
  })
})

describe("ACCENT_IDS", () => {
  test("มีครบทุกชุดสีของ spec: ค่าเริ่มต้น + 5 ชุด ตามลำดับที่ใช้แสดง", () => {
    assert.deepEqual([...ACCENT_IDS], ["default", "violet", "pink", "teal", "amber", "blue"])
  })

  test("ตรงกับชุดสีที่ประกาศใน tokens.css ทุกชุด (ไม่ขาดไม่เกิน)", () => {
    const css = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8")
    const declared = [...css.matchAll(/html\[data-accent="([a-z]+)"\]/g)].map((m) => m[1])
    assert.deepEqual(
      [...new Set(declared)].sort(),
      ACCENT_IDS.filter((id) => id !== "default").sort(),
    )
  })
})
