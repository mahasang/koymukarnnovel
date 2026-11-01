import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MESSAGES, type Messages } from "./messages"
import { LOCALES } from "./types"

type Node = unknown

function shape(value: Node, path: string, out: string[]): void {
  if (typeof value === "function") {
    out.push(`${path}:fn`)
  } else if (Array.isArray(value)) {
    out.push(`${path}:array(${value.length})`)
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value).sort()) shape((value as Record<string, Node>)[key], `${path}.${key}`, out)
  } else {
    out.push(`${path}:${typeof value}`)
  }
}

function leaves(value: Node, path: string, out: Array<[string, Node]>): void {
  if (typeof value === "function" || typeof value === "string") out.push([path, value])
  else if (Array.isArray(value)) value.forEach((item, i) => leaves(item, `${path}[${i}]`, out))
  else if (value !== null && typeof value === "object") for (const key of Object.keys(value)) leaves((value as Record<string, Node>)[key], `${path}.${key}`, out)
}

const shapeOf = (m: Messages) => {
  const out: string[] = []
  shape(m, "m", out)
  return out
}

describe("ข้อความสามภาษา", () => {
  test("en และ lo มีโครงเดียวกับ th (คีย์ ชนิด ความยาวอาร์เรย์)", () => {
    const base = shapeOf(MESSAGES.th)
    assert.deepEqual(shapeOf(MESSAGES.en), base)
    assert.deepEqual(shapeOf(MESSAGES.lo), base)
  })

  test("ทุกข้อความไม่ว่าง และฟังก์ชันข้อความที่ได้ค่า 7 ต้องมี 7 อยู่ในผลทุกภาษา", () => {
    for (const locale of LOCALES) {
      const all: Array<[string, Node]> = []
      leaves(MESSAGES[locale], "m", all)
      assert.ok(all.length > 0)
      for (const [path, value] of all) {
        const text = typeof value === "function" ? (value as (...args: unknown[]) => unknown)(...Array(value.length).fill(7)) : value
        assert.equal(typeof text, "string", `${locale} ${path}`)
        assert.notEqual((text as string).trim(), "", `${locale} ${path} ว่าง`)
        if (typeof value === "function" && value.length > 0) assert.ok((text as string).includes("7"), `${locale} ${path} ไม่ใส่ค่าที่รับเข้ามา`)
      }
    }
  })
})
