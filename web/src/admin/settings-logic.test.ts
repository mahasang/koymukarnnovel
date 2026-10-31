import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ApiError } from "../lib/api"
import {
  ACCENT_LABEL,
  apiKeyNote,
  BACKUP_HREF,
  draftOfSettings,
  fieldFromError,
  firstInvalidId,
  importExamples,
  importStatusNote,
  isDirty,
  MODEL_SUGGESTIONS,
  priceFieldId,
  priceModels,
  settingsChanges,
  testDiffersNote,
  TOKEN_COMMAND,
  validateSettings,
  type SettingsDraft,
} from "./settings-logic"
import type { SettingsDto } from "./types"

const dto = (over: Partial<SettingsDto> = {}): SettingsDto => ({
  siteName: "koymukarnnovel",
  tagline: "นิยายแปลไทย",
  aboutText: "เกี่ยวกับ",
  contactText: "",
  accent: "default",
  indexable: true,
  translateModel: "claude-sonnet-5-5",
  recapModel: "claude-haiku-4-5-20251001",
  prices: {},
  apiKeySet: true,
  importTokenSet: false,
  importUrl: "https://example.test/api/import",
  ...over,
})
const draft = (over: Partial<SettingsDraft> = {}): SettingsDraft => ({ ...draftOfSettings(dto()), ...over })

describe("draftOfSettings / priceModels", () => {
  test("ค่าเดิมครบทุกช่อง (ราคาเป็นข้อความ) · ไม่เอาสถานะความลับมาด้วย", () => {
    const d = draftOfSettings(dto({ prices: { "claude-sonnet-5-5": { in: 3, out: 15 } } }))
    assert.deepEqual(d.prices, { "claude-sonnet-5-5": { in: "3", out: "15" } })
    assert.equal(d.siteName, "koymukarnnovel")
    assert.equal(d.accent, "default")
    assert.equal(d.indexable, true)
    assert.equal("apiKeySet" in d, false)
    assert.equal("importUrl" in d, false)
  })
  test("แถวราคา: โมเดลแปล, โมเดลสรุป แล้วโมเดลอื่นที่มีราคาเรียงชื่อ · ไม่ซ้ำ · ไม่เอาชื่อว่าง", () => {
    const d = draft({ prices: { zeta: { in: "1", out: "2" }, alpha: { in: "1", out: "2" }, "claude-sonnet-5-5": { in: "3", out: "15" } } })
    assert.deepEqual(priceModels(d), ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "alpha", "zeta"])
    assert.deepEqual(priceModels(draft({ translateModel: "m", recapModel: "m" })), ["m"])
    assert.deepEqual(priceModels(draft({ translateModel: " ", recapModel: "x" })), ["x"])
  })
  test("แถวที่ผู้ใช้ตั้งชื่อโมเดลขึ้นต้นเองก็ตัดช่องว่างหัวท้าย", () => {
    assert.deepEqual(priceModels(draft({ translateModel: " a ", recapModel: "b" })), ["a", "b"])
  })
})

describe("validateSettings", () => {
  test("ค่าที่ถูกต้อง → ไม่มีข้อผิดพลาด", () => {
    assert.deepEqual(validateSettings(draft()), {})
  })
  test("ชื่อเว็บ: ห้ามว่าง · ไม่เกิน 80", () => {
    assert.match(validateSettings(draft({ siteName: "  " })).siteName ?? "", /ชื่อเว็บ/)
    assert.deepEqual(validateSettings(draft({ siteName: "ก".repeat(80) })), {})
    assert.match(validateSettings(draft({ siteName: "ก".repeat(81) })).siteName ?? "", /80/)
  })
  test("สโลแกน 160 · เกี่ยวกับ 5000 · ติดต่อ 2000 (ว่างได้)", () => {
    assert.deepEqual(validateSettings(draft({ tagline: "", aboutText: "", contactText: "" })), {})
    assert.deepEqual(validateSettings(draft({ tagline: "ก".repeat(160) })), {})
    assert.match(validateSettings(draft({ tagline: "ก".repeat(161) })).tagline ?? "", /160/)
    assert.match(validateSettings(draft({ aboutText: "ก".repeat(5001) })).aboutText ?? "", /5,000/)
    assert.match(validateSettings(draft({ contactText: "ก".repeat(2001) })).contactText ?? "", /2,000/)
    assert.deepEqual(validateSettings(draft({ aboutText: "ก".repeat(5000), contactText: "ก".repeat(2000) })), {})
  })
  test("ชื่อโมเดล: ห้ามว่าง · ใช้ได้เฉพาะอังกฤษ ตัวเลข จุด ขีด ขีดล่าง · ไม่เกิน 100", () => {
    assert.match(validateSettings(draft({ translateModel: "" })).translateModel ?? "", /กรอกชื่อโมเดลแปล/)
    assert.match(validateSettings(draft({ recapModel: "  " })).recapModel ?? "", /กรอกชื่อโมเดลสรุป/)
    assert.match(validateSettings(draft({ recapModel: "claude sonnet" })).recapModel ?? "", /โมเดลสรุป/)
    assert.match(validateSettings(draft({ recapModel: "โมเดล" })).recapModel ?? "", /ตัวอักษรอังกฤษ/)
    assert.deepEqual(validateSettings(draft({ translateModel: "a.b-c_9" })), {})
    assert.match(validateSettings(draft({ translateModel: "a".repeat(101) })).translateModel ?? "", /100/)
    assert.deepEqual(validateSettings(draft({ translateModel: "a".repeat(100) })), {})
  })
  test("ราคา: เว้นว่างทั้งคู่ได้ · กรอกครึ่งเดียวไม่ได้ · ต้องเป็นตัวเลข ≥ 0 (ทศนิยมได้)", () => {
    const base = { "claude-sonnet-5-5": { in: "", out: "" } }
    assert.deepEqual(validateSettings(draft({ prices: base })), {})
    assert.deepEqual(validateSettings(draft({ prices: { "claude-sonnet-5-5": { in: "0", out: "0.5" } } })), {})
    assert.match(validateSettings(draft({ prices: { "claude-sonnet-5-5": { in: "3", out: "" } } })).prices?.["claude-sonnet-5-5"] ?? "", /ครบ/)
    assert.match(validateSettings(draft({ prices: { "claude-sonnet-5-5": { in: "", out: "3" } } })).prices?.["claude-sonnet-5-5"] ?? "", /ครบ/)
    for (const bad of ["abc", "-1", "1e3", "1,5", "NaN", "Infinity", "."]) {
      assert.match(validateSettings(draft({ prices: { "claude-sonnet-5-5": { in: bad, out: "1" } } })).prices?.["claude-sonnet-5-5"] ?? "", /ตัวเลข/, bad)
    }
  })
  test("ราคาของโมเดลที่ไม่ได้ใช้แล้วก็ตรวจ (มันจะถูกส่งไปด้วย)", () => {
    assert.match(validateSettings(draft({ prices: { old: { in: "x", out: "1" } } })).prices?.old ?? "", /ตัวเลข/)
  })
  test("ช่องว่างหัวท้ายของตัวเลขไม่เป็นไร", () => {
    assert.deepEqual(validateSettings(draft({ prices: { "claude-sonnet-5-5": { in: " 3 ", out: " 15 " } } })), {})
  })
})

describe("settingsChanges — ส่งเฉพาะช่องที่เปลี่ยน", () => {
  test("ไม่ได้แก้ → {}", () => {
    assert.deepEqual(settingsChanges(dto(), draftOfSettings(dto())), {})
  })
  test("ชื่อเว็บ/สโลแกน/โมเดล: เทียบหลังตัดช่องว่างหัวท้าย · ส่งค่าที่ตัดแล้ว", () => {
    assert.deepEqual(settingsChanges(dto(), draft({ siteName: " koymukarnnovel " })), {})
    assert.deepEqual(settingsChanges(dto(), draft({ siteName: " ใหม่ ", translateModel: "claude-opus-5-5 " })), { siteName: "ใหม่", translateModel: "claude-opus-5-5" })
  })
  test("ข้อความยาว/สีเน้น/สวิตช์ค้นหา", () => {
    assert.deepEqual(settingsChanges(dto(), draft({ aboutText: "ใหม่", contactText: "อีเมล", accent: "teal", indexable: false })), { aboutText: "ใหม่", contactText: "อีเมล", accent: "teal", indexable: false })
  })
  test("ล้างสโลแกน → ส่งสโลแกนว่าง (ไม่ใช่ไม่ส่ง)", () => {
    assert.deepEqual(settingsChanges(dto(), draft({ tagline: "" })), { tagline: "" })
  })
  test("ราคา: เปลี่ยน → ส่งทั้งก้อน (ตัวเลข) · แถวที่เว้นว่างไม่ส่ง · ตัดแถวที่เคยมี = ส่งก้อนที่เหลือ", () => {
    const withPrice = dto({ prices: { a: { in: 1, out: 2 }, b: { in: 3, out: 4 } } })
    assert.deepEqual(settingsChanges(withPrice, draftOfSettings(withPrice)), {})
    assert.deepEqual(settingsChanges(withPrice, { ...draftOfSettings(withPrice), prices: { a: { in: "1.0", out: "2" }, b: { in: "3", out: "4" } } }), {})
    assert.deepEqual(settingsChanges(withPrice, { ...draftOfSettings(withPrice), prices: { a: { in: "5", out: "2" }, b: { in: "3", out: "4" } } }), { prices: { a: { in: 5, out: 2 }, b: { in: 3, out: 4 } } })
    assert.deepEqual(settingsChanges(withPrice, { ...draftOfSettings(withPrice), prices: { a: { in: "", out: "" }, b: { in: "3", out: "4" } } }), { prices: { b: { in: 3, out: 4 } } })
    assert.deepEqual(settingsChanges(withPrice, { ...draftOfSettings(withPrice), prices: { a: { in: "1", out: "9" }, b: { in: "3", out: "4" } } }), { prices: { a: { in: 1, out: 9 }, b: { in: 3, out: 4 } } })
    assert.deepEqual(settingsChanges(dto({ prices: { a: { in: 1, out: 2 } } }), draft({ prices: { b: { in: "1", out: "2" } } })), { prices: { b: { in: 1, out: 2 } } })
    assert.deepEqual(settingsChanges(dto(), draft({ prices: { a: { in: "3", out: "" }, b: { in: "", out: "4" } } })), {}, "แถวที่ยังไม่ครบไม่ถูกส่ง")
    assert.deepEqual(settingsChanges(dto(), draft({ prices: { "claude-sonnet-5-5": { in: "3", out: "15" } } })), { prices: { "claude-sonnet-5-5": { in: 3, out: 15 } } })
    assert.deepEqual(settingsChanges(dto(), draft({ prices: { "claude-sonnet-5-5": { in: "", out: "" } } })), {})
  })
})

describe("isDirty", () => {
  test("ตรงกับของเดิม → ไม่ dirty · แก้แล้วพิมพ์กลับ → ไม่ dirty", () => {
    const base = draftOfSettings(dto())
    assert.equal(isDirty(base, base), false)
    assert.equal(isDirty(base, { ...base, siteName: "x" }), true)
    assert.equal(isDirty(base, { ...base, siteName: base.siteName }), false)
  })
  test("ทุกช่องนับ: สีเน้น · สวิตช์ · ข้อความ · โมเดล", () => {
    const base = draftOfSettings(dto())
    for (const patch of [{ accent: "blue" }, { indexable: false }, { aboutText: "x" }, { contactText: "x" }, { tagline: "x" }, { translateModel: "x" }, { recapModel: "x" }] as const) {
      assert.equal(isDirty(base, { ...base, ...patch }), true, JSON.stringify(patch))
    }
  })
  test("ราคา: เปลี่ยนเลข = dirty · แถวว่างล้วนที่เพิ่มมา = ไม่ dirty · พิมพ์ราคาที่ยังไม่ครบ = dirty (ยังไม่บันทึก)", () => {
    const base = draftOfSettings(dto())
    assert.equal(isDirty(base, { ...base, prices: { x: { in: "", out: "" } } }), false)
    assert.equal(isDirty(base, { ...base, prices: { x: { in: "1", out: "" } } }), true)
    assert.equal(isDirty(base, { ...base, prices: { x: { in: "1", out: "2" } } }), true)
  })
  test("ลำดับการใส่แถวราคาไม่มีผล", () => {
    const base = draftOfSettings(dto({ prices: { a: { in: 1, out: 2 }, b: { in: 3, out: 4 } } }))
    assert.equal(isDirty(base, { ...base, prices: { b: { in: "3", out: "4" }, a: { in: "1", out: "2" } } }), false)
  })
  test("ตัวเลขเทียบค่า ไม่ใช่ตัวอักษร: 3 กับ 3.0 เท่ากัน", () => {
    const base = draftOfSettings(dto({ prices: { a: { in: 3, out: 15 } } }))
    assert.equal(isDirty(base, { ...base, prices: { a: { in: "3.0", out: "15" } } }), false)
  })
})

describe("fieldFromError — ข้อผิดพลาดตรวจค่าจากเซิร์ฟเวอร์ต่อช่อง", () => {
  test("invalid_field + field ที่รู้จัก → ช่องและข้อความไทยของเซิร์ฟเวอร์", () => {
    const e = new ApiError(400, "ชื่อเว็บต้องไม่ว่าง", "invalid_field", { error: "x", field: "siteName" })
    assert.deepEqual(fieldFromError(e), { field: "siteName", message: "ชื่อเว็บต้องไม่ว่าง" })
    assert.deepEqual(fieldFromError(new ApiError(400, "ราคาผิด", "invalid_field", { field: "prices" })), { field: "prices", message: "ราคาผิด" })
  })
  test("ช่องที่ไม่รู้จัก / รหัสอื่น / ไม่ใช่ ApiError / ไม่มี data → null", () => {
    assert.equal(fieldFromError(new ApiError(400, "m", "invalid_field", { field: "secret" })), null)
    assert.equal(fieldFromError(new ApiError(400, "m", "invalid_field", { field: 5 })), null)
    assert.equal(fieldFromError(new ApiError(400, "m", "invalid_field")), null)
    assert.equal(fieldFromError(new ApiError(400, "m", "other", { field: "siteName" })), null)
    assert.equal(fieldFromError(new ApiError(500, "m")), null)
    assert.equal(fieldFromError(new Error("x")), null)
    assert.equal(fieldFromError(null), null)
  })
})

describe("ข้อความและตัวอย่าง", () => {
  test("สีเน้น: ป้ายไทยครบทั้ง 6 · default = ตามธีม", () => {
    assert.deepEqual(Object.keys(ACCENT_LABEL), ["default", "violet", "pink", "teal", "amber", "blue"])
    assert.equal(ACCENT_LABEL.default, "ตามธีม")
  })
  test("โมเดลแนะนำตามแผน", () => {
    assert.deepEqual([...MODEL_SUGGESTIONS], ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"])
  })
  test("คีย์ API: ตั้งแล้ว/ยังไม่ตั้ง (ไม่มีตัวคีย์)", () => {
    assert.match(apiKeyNote(true), /ตั้ง ANTHROPIC_API_KEY แล้ว/)
    assert.match(apiKeyNote(true), /ไม่แสดงตัวคีย์/)
    assert.match(apiKeyNote(false), /ยังไม่ได้ตั้ง/)
    assert.match(apiKeyNote(false), /ANTHROPIC_API_KEY/)
  })
  test("ทดสอบ API ใช้โมเดลสรุปที่บันทึกไว้: ถ้าช่องที่แก้ค้างต่างกัน → เตือน · เท่ากันหรือว่าง → null", () => {
    assert.equal(testDiffersNote("a", "a"), null)
    assert.equal(testDiffersNote("a", " a "), null)
    assert.match(testDiffersNote("a", "b") ?? "", /บันทึก/)
  })
  test("ช่องทางนำเข้า: สถานะตามที่ตั้ง · ยังไม่ตั้งบอกว่าปิดอยู่และ 404", () => {
    assert.match(importStatusNote(true), /เปิดใช้อยู่/)
    assert.match(importStatusNote(false), /ปิดอยู่/)
  })
  test("ตัวอย่างคำสั่ง: ใช้ YOUR_TOKEN (ไม่ใช่ค่าจริง) และที่อยู่ที่เซิร์ฟเวอร์ส่งมา · ไม่มีคำขอที่สร้าง/ลบ/เผยแพร่", () => {
    const ex = importExamples("https://example.test/api/import")
    assert.equal(ex.length, 2)
    for (const e of ex) {
      assert.match(e.command, /Authorization: Bearer YOUR_TOKEN/)
      assert.match(e.command, /https:\/\/example\.test\/api\/import\/novels\//)
      assert.ok(!/DELETE|POST/.test(e.command))
    }
    assert.match(ex[0].command, /status=draft/)
    assert.match(ex[1].command, /-X PUT/)
    assert.match(ex[1].command, /translation/)
    assert.ok(ex[1].command.includes('Content-Type: application/json'))
  })
  test("ที่อยู่ที่ลงท้ายด้วย / ไม่ทำให้มี // ซ้อน", () => {
    assert.ok(!importExamples("https://example.test/api/import/")[0].command.includes("import//"))
  })
  test("วิธีสร้างโทเค็นสุ่ม และลิงก์สำรองข้อมูล", () => {
    assert.match(TOKEN_COMMAND, /randomBytes\(32\)\.toString\('base64url'\)/)
    assert.equal(BACKUP_HREF, "/api/admin/backup")
  })
})

describe("firstInvalidId / priceFieldId", () => {
  test("ช่องแรกที่ผิดตามลำดับบนหน้า", () => {
    const d = draft()
    assert.equal(firstInvalidId({}, d), null)
    assert.equal(firstInvalidId({ recapModel: "x", tagline: "x" }, d), "st-tagline")
    assert.equal(firstInvalidId({ tagline: "x", siteName: "x" }, d), "st-siteName")
    assert.equal(firstInvalidId({ translateModel: "x", recapModel: "x" }, d), "st-translateModel")
    assert.equal(firstInvalidId({ siteName: "x", contactText: "x" }, d), "st-siteName")
    assert.equal(firstInvalidId({ aboutText: "x", contactText: "x" }, d), "st-aboutText")
    assert.equal(firstInvalidId({ contactText: "x", recapModel: "x" }, d), "st-contactText")
    assert.equal(firstInvalidId({ recapModel: "x" }, d), "st-recapModel")
  })
  test("ราคาผิดมาหลังช่องข้อความ · เลือกแถวแรกตามลำดับแถว · โฟกัสช่องราคาเข้า", () => {
    const d = draft({ prices: { "claude-haiku-4-5-20251001": { in: "x", out: "1" }, "claude-sonnet-5-5": { in: "x", out: "1" } } })
    assert.equal(firstInvalidId({ prices: { "claude-haiku-4-5-20251001": "e", "claude-sonnet-5-5": "e" } }, d), "st-price-claude-sonnet-5-5-in")
    assert.equal(firstInvalidId({ prices: { "claude-haiku-4-5-20251001": "e" } }, d), "st-price-claude-haiku-4-5-20251001-in")
    assert.equal(firstInvalidId({ siteName: "x", prices: { "claude-haiku-4-5-20251001": "e" } }, d), "st-siteName")
  })
  test("priceFieldId", () => {
    assert.equal(priceFieldId("a.b", "in"), "st-price-a.b-in")
    assert.equal(priceFieldId("a.b", "out"), "st-price-a.b-out")
  })
})
