import { test } from "node:test"
import assert from "node:assert/strict"
import { openDb, type Db } from "../src/db.js"
import { migrate } from "../src/migrate.js"
import { ACCENTS, createSettings, type SiteSettings } from "../src/settings.js"
import { HttpError } from "../src/util/errors.js"

const CFG = { translateModel: "cfg-translate", recapModel: "cfg-recap" }

function setup(cfg = CFG): { db: Db; settings: ReturnType<typeof createSettings> } {
  const db = openDb(":memory:")
  migrate(db)
  return { db, settings: createSettings(db, cfg) }
}

const isBadRequest = (e: unknown) => e instanceof HttpError && e.status === 400
/** ผิดที่ช่อง `field`: 400 รหัส invalid_field พร้อมชื่อช่องในข้อมูลเสริม (หน้าตั้งค่าใช้ชี้ช่องที่ผิด) และข้อความเป็นภาษาไทย */
const isInvalidField = (field: string) => (e: unknown) =>
  e instanceof HttpError && e.status === 400 && e.code === "invalid_field" && e.extra?.field === field && /[ก-๙]/.test(e.message)
const rowCount = (db: Db) => db.get<{ c: number }>("SELECT COUNT(*) AS c FROM settings")!.c

test("ค่าเริ่มต้น: ชื่อเว็บ สโลแกน เกี่ยวกับ ติดต่อ สี การค้นหา โมเดลจาก cfg ราคาว่าง", () => {
  const { settings } = setup()
  const s = settings.get()
  assert.deepEqual(Object.keys(s).sort(), ["aboutText", "accent", "contactText", "indexable", "prices", "recapModel", "siteName", "tagline", "translateModel"])
  assert.equal(s.siteName, "koymukarnnovel")
  assert.equal(s.tagline, "นิยายแปลไทย อ่านสบาย ทุกที่")
  assert.ok(/[ก-๙]/.test(s.aboutText) && s.aboutText.length <= 5000, "aboutText เป็นข้อความไทยสั้นๆ")
  assert.equal(s.contactText, "")
  assert.equal(s.accent, "default")
  assert.equal(s.indexable, true)
  assert.deepEqual(s.prices, {})
  assert.equal(s.translateModel, "cfg-translate")
  assert.equal(s.recapModel, "cfg-recap")
  assert.deepEqual([...ACCENTS], ["default", "violet", "pink", "teal", "amber", "blue"])
})

test("ลำดับชั้น: ค่าใน DB ชนะ cfg ส่วนที่ไม่ได้ตั้งยังใช้ cfg และค่าคงอยู่ข้ามอินสแตนซ์", () => {
  const { db, settings } = setup()
  const updated = settings.update({ translateModel: "db-translate" })
  assert.equal(updated.translateModel, "db-translate")
  assert.equal(updated.recapModel, "cfg-recap")
  const again = createSettings(db, { translateModel: "other-cfg", recapModel: "other-recap" }).get()
  assert.equal(again.translateModel, "db-translate")
  assert.equal(again.recapModel, "other-recap")
})

test("update: คีย์ที่ไม่รู้จักถูกข้าม ไม่เขียนลง DB และไม่ทำให้ error", () => {
  const { db, settings } = setup()
  const before = settings.get()
  const result = settings.update({ nope: 1, adminPassword: "x", __proto__: { accent: "pink" } } as unknown as Partial<SiteSettings>)
  assert.deepEqual(result, before)
  assert.equal(rowCount(db), 0)
  assert.deepEqual(settings.update({}), before)
})

const TOO_LONG_MODEL = "m".repeat(101)
const INVALID: [string, Partial<Record<keyof SiteSettings, unknown>>][] = [
  ["accent ที่ไม่มีในรายการ", { accent: "bogus" }],
  ["ชื่อเว็บว่าง", { siteName: "" }],
  ["ชื่อเว็บมีแต่ช่องว่าง", { siteName: "   " }],
  ["ชื่อเว็บยาว 81", { siteName: "ก".repeat(81) }],
  ["ชื่อเว็บไม่ใช่ข้อความ", { siteName: 5 }],
  ["สโลแกนยาว 161", { tagline: "a".repeat(161) }],
  ["ข้อความเกี่ยวกับยาว 5001", { aboutText: "a".repeat(5001) }],
  ["ข้อความติดต่อยาว 2001", { contactText: "a".repeat(2001) }],
  ["indexable ไม่ใช่ boolean", { indexable: "yes" }],
  ["ชื่อโมเดลมีช่องว่าง", { translateModel: "has space" }],
  ["ชื่อโมเดลว่าง", { recapModel: "" }],
  ["ชื่อโมเดลเป็นอักษรไทย", { recapModel: "โมเดล" }],
  ["ชื่อโมเดลยาว 101", { translateModel: TOO_LONG_MODEL }],
  ["ราคาติดลบ", { prices: { m: { in: -1, out: 1 } } }],
  ["ราคาเป็นข้อความ", { prices: { m: { in: "3", out: 1 } } }],
  ["ราคาไม่ครบ out", { prices: { m: { in: 1 } } }],
  ["ราคา NaN", { prices: { m: { in: Number.NaN, out: 1 } } }],
  ["ราคา Infinity", { prices: { m: { in: 1, out: Number.POSITIVE_INFINITY } } }],
  ["ชื่อโมเดลในราคามีช่องว่าง", { prices: { "bad name": { in: 1, out: 1 } } }],
  ["ราคาเป็น array", { prices: [] }],
  ["ราคาเป็น null", { prices: null }],
  ["ราคาของโมเดลเป็น null", { prices: { m: null } }],
  ["ชื่อโมเดลในราคาเป็น __proto__", { prices: JSON.parse('{"__proto__": {"in": 1, "out": 1}}') }],
]

for (const [label, patch] of INVALID) {
  test(`update ปฏิเสธด้วย 400: ${label}`, () => {
    const { db, settings } = setup()
    assert.throws(() => settings.update(patch as Partial<SiteSettings>), isInvalidField(Object.keys(patch)[0] as string))
    assert.equal(rowCount(db), 0)
  })
}

test("update ปฏิเสธข้อความผิดพลาดต่างกันตามช่อง (ข้อความไทยเฉพาะช่อง)", () => {
  const messages = new Map<string, string>()
  for (const [, patch] of INVALID) {
    const { settings } = setup()
    const field = Object.keys(patch)[0] as string
    try {
      settings.update(patch as Partial<SiteSettings>)
    } catch (e) {
      messages.set(field, (e as Error).message)
    }
  }
  assert.equal(messages.size, 9, "ครบทุกช่องของการตั้งค่า")
  assert.equal(new Set(messages.values()).size, 9)
})

test("update ที่ไม่ได้รับออบเจ็กต์ (อาร์เรย์, null, ข้อความ, ตัวเลข) → 400 ไม่บันทึกอะไร", () => {
  const { db, settings } = setup()
  for (const patch of [[], null, "siteName", 5, true]) {
    assert.throws(() => settings.update(patch as never), isBadRequest)
  }
  assert.equal(rowCount(db), 0)
})

test("update ทั้งก้อนหรือไม่เลย: มีค่าที่ผิดหนึ่งค่า ค่าที่ถูกในชุดเดียวกันก็ไม่ถูกบันทึก", () => {
  const { db, settings } = setup()
  assert.throws(() => settings.update({ siteName: "ชื่อใหม่", accent: "bogus" as never }), isInvalidField("accent"))
  assert.equal(settings.get().siteName, "koymukarnnovel")
  assert.equal(rowCount(db), 0)
})

test("ค่าที่อยู่พอดีเพดานผ่านได้ และบันทึกครบทุกช่องแล้วอ่านกลับได้", () => {
  const { settings } = setup()
  const full: SiteSettings = {
    siteName: "ก".repeat(80),
    tagline: "ข".repeat(160),
    aboutText: "ค".repeat(5000),
    contactText: "ง".repeat(2000),
    accent: "teal",
    indexable: false,
    translateModel: "m".repeat(100),
    recapModel: "claude-haiku-4-5-20251001",
    prices: { "claude-sonnet-5-5": { in: 3, out: 15 }, "claude-haiku-4-5-20251001": { in: 0, out: 0.5 } },
  }
  assert.deepEqual(settings.update(full), full)
  assert.deepEqual(settings.get(), full)
  for (const accent of ACCENTS) assert.equal(settings.update({ accent }).accent, accent)
})

test("update บางช่อง ช่องอื่นไม่เปลี่ยน และล้างข้อความให้ว่างได้ (ว่างที่ตั้งเองไม่ถูกแทนด้วยค่าเริ่มต้น)", () => {
  const { settings } = setup()
  settings.update({ siteName: "เว็บของฉัน", contactText: "ติดต่อ: a@example.com" })
  const s = settings.update({ tagline: "", contactText: "" })
  assert.equal(s.tagline, "")
  assert.equal(s.contactText, "")
  assert.equal(s.siteName, "เว็บของฉัน")
  assert.equal(s.accent, "default")
})

test("ทำความสะอาดข้อความ: ชื่อ/สโลแกนตัดช่องว่างหัวท้าย ข้อความหลายบรรทัดแปลง CRLF เป็น LF", () => {
  const { settings } = setup()
  const s = settings.update({ siteName: "  เว็บนิยาย  ", tagline: " อ่านสบาย ", aboutText: "บรรทัดแรก\r\nบรรทัดสอง\r\n\r\n\r\n\r\nท้าย  \r\n", contactText: "\r\nอีเมล\r\n" })
  assert.equal(s.siteName, "เว็บนิยาย")
  assert.equal(s.tagline, "อ่านสบาย")
  assert.equal(s.aboutText, "บรรทัดแรก\nบรรทัดสอง\n\nท้าย")
  assert.equal(s.contactText, "อีเมล")
})

test("ค่าภายใน: ตั้งและอ่านได้ ไม่เคยตั้งได้ ว่าง เขียนทับได้ และไม่รั่วเข้า get()", () => {
  const { db, settings } = setup()
  assert.equal(settings.getInternal("queue_paused_reason"), "")
  settings.setInternal("queue_paused_reason", "x")
  assert.equal(settings.getInternal("queue_paused_reason"), "x")
  settings.setInternal("queue_paused_reason", "y")
  assert.equal(settings.getInternal("queue_paused_reason"), "y")
  assert.equal(rowCount(db), 1)
  assert.ok(!("queue_paused_reason" in settings.get()))
  assert.ok(!JSON.stringify(settings.get()).includes("queue_paused_reason"))
  settings.update({ siteName: "ชื่อ" })
  assert.equal(settings.getInternal("queue_paused_reason"), "y")
})

test("ค่าที่ถูกแก้นอกระบบจนผิดรูปไม่ทำให้พัง: กลับไปใช้ค่าเริ่มต้นของช่องนั้น", () => {
  const { db, settings } = setup()
  for (const [key, value] of [["accent", "bogus"], ["indexable", "maybe"], ["prices", "{bad"], ["siteName", ""], ["translateModel", "has space"]]) {
    db.run("INSERT INTO settings (key, value) VALUES (?, ?)", key, value)
  }
  const s = settings.get()
  assert.equal(s.accent, "default")
  assert.equal(s.indexable, true)
  assert.deepEqual(s.prices, {})
  assert.equal(s.siteName, "koymukarnnovel")
  assert.equal(s.translateModel, "cfg-translate")
})
