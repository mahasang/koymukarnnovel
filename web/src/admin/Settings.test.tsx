import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Switch } from "../components/Switch"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { SettingsView, type SettingsViewProps } from "./Settings"
import { draftOfSettings, MODEL_SUGGESTIONS, TOKEN_COMMAND } from "./settings-logic"
import { TextField } from "./NovelForm"
import type { SettingsDto } from "./types"

const settings = (over: Partial<SettingsDto> = {}): SettingsDto => ({
  siteName: "koymukarnnovel",
  tagline: "นิยายแปลไทย",
  aboutText: "เกี่ยวกับ",
  contactText: "",
  accent: "default",
  indexable: true,
  translateModel: "claude-sonnet-5-5",
  recapModel: "claude-haiku-4-5-20251001",
  prices: { "claude-sonnet-5-5": { in: 3, out: 15 } },
  apiKeySet: true,
  importTokenSet: true,
  importUrl: "https://example.test/api/import",
  ...over,
})

const props = (over: Partial<SettingsViewProps> = {}): SettingsViewProps => {
  const s = over.settings ?? settings()
  return {
    settings: s,
    draft: draftOfSettings(s),
    errors: {},
    pricesError: null,
    saving: false,
    notice: null,
    error: null,
    test: { busy: false, result: null },
    copied: null,
    copyFailed: false,
    onChange: () => {},
    onPrice: () => {},
    onSave: () => {},
    onTest: () => {},
    onCopy: () => {},
    ...over,
  }
}

const render = (over: Partial<SettingsViewProps> = {}) => renderPage(<SettingsView {...props(over)} />)
const tree = (over: Partial<SettingsViewProps> = {}) => SettingsView(props(over))
const field = (t: ReturnType<typeof tree>, id: string) => findTag(t, TextField as unknown as string, (el) => el.props.id === id)

const panel = (page: ReturnType<typeof render>, id: string) => one(page, `section[aria-labelledby=${id}]`)

describe("SettingsView — โครง", () => {
  test("หัวเรื่อง และกลุ่มตามลำดับใน spec 7.9", () => {
    const page = render()
    assert.equal(text(one(page, "h1")), "ตั้งค่า")
    assert.deepEqual(all(page, "h2").map((h) => text(h)), ["เว็บไซต์", "การค้นหา", "โมเดล", "ราคา (ไม่บังคับ)", "เชื่อมต่อ Claude API", "ช่องทางนำเข้าคำแปล", "สำรองข้อมูล"])
  })
  test("แจ้งว่ารหัสผ่าน/API key/โทเค็นตั้งผ่านตัวแปรสภาพแวดล้อมเท่านั้น", () => {
    assert.match(text(one(render(), "[data-kind=env-note]")), /ตัวแปรสภาพแวดล้อม.*เท่านั้น/)
  })
  test("ไม่มีช่องกรอกรหัสผ่าน/คีย์/โทเค็นเลย", () => {
    const page = render()
    for (const input of all(page, "input")) assert.notEqual(input.attrs.type, "password")
    assert.equal(all(page, "input").filter((i) => /key|token|password/i.test(i.attrs.id ?? "")).length, 0)
  })
})

describe("SettingsView — เว็บไซต์", () => {
  test("ช่องข้อความ: id · ค่า · ความยาวสูงสุดตรงเซิร์ฟเวอร์ · ชื่อเว็บจำเป็น", () => {
    const t = tree({ draft: draftOfSettings(settings({ siteName: "ชื่อ", tagline: "สโลแกน", aboutText: "ก", contactText: "ข" })) })
    const spec: [string, string, number][] = [
      ["st-siteName", "ชื่อ", 80],
      ["st-tagline", "สโลแกน", 160],
      ["st-aboutText", "ก", 5000],
      ["st-contactText", "ข", 2000],
    ]
    for (const [id, value, max] of spec) {
      const f = field(t, id)
      assert.equal(f.props.value, value, id)
      assert.equal(f.props.max, max, id)
    }
    assert.equal(field(t, "st-siteName").props.required, true)
    assert.equal(field(t, "st-tagline").props.required, undefined)
    assert.equal(field(t, "st-aboutText").props.rows, 6)
    assert.equal(field(t, "st-contactText").props.rows, 4)
  })
  test("พิมพ์ในช่อง → onChange ส่งเฉพาะช่องนั้น", () => {
    const calls: unknown[] = []
    const t = tree({ onChange: (p) => calls.push(p) })
    handlerOf(field(t, "st-siteName"), "onChange")("ใหม่")
    handlerOf(field(t, "st-tagline"), "onChange")("ส")
    handlerOf(field(t, "st-aboutText"), "onChange")("อ")
    handlerOf(field(t, "st-contactText"), "onChange")("ต")
    assert.deepEqual(calls, [{ siteName: "ใหม่" }, { tagline: "ส" }, { aboutText: "อ" }, { contactText: "ต" }])
  })
  test("ข้อความผิดพลาดส่งเข้าช่องที่ถูกต้อง", () => {
    const ids = ["st-siteName", "st-tagline", "st-aboutText", "st-contactText", "st-translateModel", "st-recapModel"]
    const t = tree({ errors: { siteName: "A", tagline: "B", aboutText: "C", contactText: "D", translateModel: "E", recapModel: "F" } })
    assert.deepEqual(ids.map((id) => field(t, id).props.error), ["A", "B", "C", "D", "E", "F"])
  })
  test("ชุดสีเน้น: 6 ปุ่มตามลำดับ ป้ายไทย data-accent · กดอยู่ = ที่เลือก", () => {
    const page = render({ draft: { ...draftOfSettings(settings()), accent: "teal" } })
    const sw = all(page, "button.ad-swatch")
    assert.deepEqual(sw.map((b) => b.attrs["data-accent"]), ["default", "violet", "pink", "teal", "amber", "blue"])
    assert.deepEqual(sw.map((b) => text(b)), ["ตามธีม", "ม่วง", "ชมพู", "เขียวน้ำทะเล", "เหลืองอำพัน", "น้ำเงิน"])
    assert.deepEqual(sw.map((b) => b.attrs["aria-pressed"]), ["false", "false", "false", "true", "false", "false"])
    assert.equal(all(page, ".ad-swatch-dot").length, 6)
  })
  test("ปุ่ม 'ตามธีม' มีไอคอนจานสี ปุ่มสีอื่นมีแต่จุดสี · จุดซ่อนจากโปรแกรมอ่านจอ", () => {
    const dots = all(render(), ".ad-swatch-dot")
    assert.equal(all(dots[0]!, "svg").length, 1)
    for (const dot of dots.slice(1)) assert.equal(all(dot, "svg").length, 0)
    for (const dot of dots) assert.equal(dot.attrs["aria-hidden"], "true")
  })
  test("กดสี → onChange({accent}) ของสีนั้น", () => {
    const calls: unknown[] = []
    const t = tree({ onChange: (p) => calls.push(p) })
    const buttons = findAll(t, (el) => el.type === "button" && el.props.className === "ad-swatch")
    assert.equal(buttons.length, 6)
    handlerOf(buttons[4]!, "onClick")()
    handlerOf(buttons[0]!, "onClick")()
    assert.deepEqual(calls, [{ accent: "amber" }, { accent: "default" }])
  })
  test("กลุ่มปุ่มสีมีป้ายกำกับ", () => {
    const page = render()
    assert.equal(one(page, "div[role=group]").attrs["aria-labelledby"], "st-accent-label")
    assert.equal(text(one(page, "span[id=st-accent-label]")), "ชุดสีเน้น")
  })
})

describe("SettingsView — การค้นหา", () => {
  test("สวิตช์ 'ให้เสิร์ชเอนจินค้นเจอ' ตามค่าและกดแล้วส่งค่ากลับด้าน", () => {
    const calls: unknown[] = []
    const t = tree({ onChange: (p) => calls.push(p) })
    const sw = findAll(t, (el) => el.type === Switch)[0]!
    assert.equal(sw.props.checked, true)
    assert.equal(sw.props.label, "ให้เสิร์ชเอนจินค้นเจอ")
    handlerOf(sw, "onChange")(false)
    assert.deepEqual(calls, [{ indexable: false }])
  })
  test("คำอธิบายเปลี่ยนตามสวิตช์", () => {
    assert.match(text(panel(render({ draft: { ...draftOfSettings(settings()), indexable: true } }), "st-h-search")), /เปิด: Google/)
    assert.match(text(panel(render({ draft: { ...draftOfSettings(settings()), indexable: false } }), "st-h-search")), /ปิด: บอกเสิร์ชเอนจินไม่ให้เก็บ/)
  })
})

describe("SettingsView — โมเดล", () => {
  test("ช่องโมเดลผูกกับรายการแนะนำ · รายการแนะนำตามแผน", () => {
    const t = tree()
    for (const id of ["st-translateModel", "st-recapModel"]) {
      assert.equal(field(t, id).props.list, "st-models", id)
      assert.equal(field(t, id).props.required, true, id)
      assert.equal(field(t, id).props.max, 100, id)
    }
    assert.deepEqual(all(one(render(), "datalist[id=st-models]"), "option").map((o) => o.attrs.value), [...MODEL_SUGGESTIONS])
  })
  test("พิมพ์ชื่อโมเดล → onChange", () => {
    const calls: unknown[] = []
    const t = tree({ onChange: (p) => calls.push(p) })
    handlerOf(field(t, "st-translateModel"), "onChange")("claude-opus-5-5")
    handlerOf(field(t, "st-recapModel"), "onChange")("x")
    assert.deepEqual(calls, [{ translateModel: "claude-opus-5-5" }, { recapModel: "x" }])
  })
})

describe("SettingsView — ราคา", () => {
  const bodyRows = (page: ReturnType<typeof render>) => all(one(page, "tbody"), "tr")
  test("ตารางมีแถวต่อโมเดล (แปล, สรุป) พร้อมค่าเดิม", () => {
    const rows = bodyRows(render())
    assert.equal(rows.length, 2)
    assert.equal(text(one(rows[0]!, "th")), "claude-sonnet-5-5")
    assert.equal(one(rows[0]!, "input[aria-label=ราคาเข้าของ claude-sonnet-5-5]").attrs.value, "3")
    assert.equal(one(rows[0]!, "input[aria-label=ราคาออกของ claude-sonnet-5-5]").attrs.value, "15")
    assert.equal(one(rows[1]!, "input[aria-label=ราคาเข้าของ claude-haiku-4-5-20251001]").attrs.value, "")
  })
  test("หัวคอลัมน์ · หน่วยบอกชัด", () => {
    const page = render()
    assert.deepEqual(all(one(page, "thead"), "th").map((h) => text(h)), ["โมเดล", "ราคาเข้า (input)", "ราคาออก (output)"])
    assert.match(text(panel(page, "st-h-price")), /ดอลลาร์ต่อ 1 ล้านโทเคน/)
  })
  test("พิมพ์ราคา → onPrice(โมเดล, ช่องนั้น)", () => {
    const calls: unknown[] = []
    const t = tree({ onPrice: (m, p) => calls.push([m, p]) })
    const ins = findAll(t, (el) => el.type === "input" && el.props.className === "ad-pcell")
    assert.equal(ins.length, 4)
    handlerOf(ins[0]!, "onChange")({ target: { value: "4" } })
    handlerOf(ins[1]!, "onChange")({ target: { value: "20" } })
    handlerOf(ins[3]!, "onChange")({ target: { value: "9" } })
    assert.deepEqual(calls, [["claude-sonnet-5-5", { in: "4" }], ["claude-sonnet-5-5", { out: "20" }], ["claude-haiku-4-5-20251001", { out: "9" }]])
  })
  test("ข้อผิดพลาดของแถว: ข้อความใต้ชื่อโมเดล · ช่องทั้งสองถูกทำเครื่องหมายผิดและผูกกับข้อความ", () => {
    const page = render({ errors: { prices: { "claude-sonnet-5-5": "ราคาต้องเป็นตัวเลข" } } })
    assert.equal(text(one(page, "[data-kind=price-error]")), "ราคาต้องเป็นตัวเลข")
    for (const label of ["ราคาเข้าของ claude-sonnet-5-5", "ราคาออกของ claude-sonnet-5-5"]) {
      const i = one(page, `input[aria-label=${label}]`)
      assert.equal(i.attrs["aria-invalid"], "true")
      assert.equal(i.attrs["aria-describedby"], "st-price-claude-sonnet-5-5-error")
    }
    assert.equal(one(page, "[data-kind=price-error]").attrs.id, "st-price-claude-sonnet-5-5-error")
    assert.equal(all(page, "[data-kind=price-error]").length, 1)
    assert.equal(one(page, "input[aria-label=ราคาเข้าของ claude-haiku-4-5-20251001]").attrs["aria-invalid"], undefined)
  })
  test("ข้อผิดพลาดของราคาทั้งก้อนจากเซิร์ฟเวอร์ → แจ้งเหนือตาราง (role=alert)", () => {
    const e = one(render({ pricesError: "ราคาผิดรูปแบบ" }), "[data-kind=prices-error]")
    assert.equal(text(e), "ราคาผิดรูปแบบ")
    assert.equal(e.attrs.role, "alert")
    assert.equal(all(render(), "[data-kind=prices-error]").length, 0)
  })
  test("โมเดลที่เคยมีราคาแต่ไม่ได้ใช้แล้วยังมีแถว (แก้/ล้างได้)", () => {
    const s = settings({ prices: { "old-model": { in: 1, out: 2 } } })
    const heads = bodyRows(render({ settings: s, draft: draftOfSettings(s) })).map((r) => text(one(r, "th")))
    assert.deepEqual(heads, ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "old-model"])
  })
  test("แถวราคาตามชื่อโมเดลที่กำลังพิมพ์ในช่องโมเดล", () => {
    const d = { ...draftOfSettings(settings()), translateModel: "claude-opus-5-5" }
    const heads = bodyRows(render({ draft: d })).map((r) => text(one(r, "th")))
    assert.deepEqual(heads.slice(0, 2), ["claude-opus-5-5", "claude-haiku-4-5-20251001"])
  })
})

describe("SettingsView — แถบบันทึก", () => {
  const saveBtn = (page: ReturnType<typeof render>) => one(page, "button[type=submit]")
  test("ยังไม่แก้ → ปุ่มบันทึกปิด ไม่มีข้อความค้าง", () => {
    const page = render()
    assert.equal(saveBtn(page).attrs.disabled, "")
    assert.equal(text(saveBtn(page)), "บันทึกการตั้งค่า")
    assert.equal(all(page, "span.ad-form-note").length, 0)
  })
  test("แก้แล้ว → ปุ่มใช้ได้ + 'มีการแก้ไขที่ยังไม่บันทึก'", () => {
    const page = render({ draft: { ...draftOfSettings(settings()), siteName: "ใหม่" } })
    assert.equal(saveBtn(page).attrs.disabled, undefined)
    assert.equal(text(one(page, "span.ad-form-note")), "มีการแก้ไขที่ยังไม่บันทึก")
  })
  test("แก้เฉพาะสีเน้นหรือสวิตช์ก็นับว่าแก้", () => {
    assert.equal(saveBtn(render({ draft: { ...draftOfSettings(settings()), accent: "blue" } })).attrs.disabled, undefined)
    assert.equal(saveBtn(render({ draft: { ...draftOfSettings(settings()), indexable: false } })).attrs.disabled, undefined)
  })
  test("กำลังบันทึก → 'กำลังบันทึก…' ปิดปุ่ม ซ่อนข้อความค้าง", () => {
    const page = render({ draft: { ...draftOfSettings(settings()), siteName: "ใหม่" }, saving: true })
    assert.equal(text(saveBtn(page)), "กำลังบันทึก…")
    assert.equal(saveBtn(page).attrs.disabled, "")
    assert.equal(all(page, "span.ad-form-note").length, 0)
  })
  test("แจ้งผลสำเร็จ (role=status) และข้อผิดพลาด (role=alert)", () => {
    const ok = one(render({ notice: "บันทึกการตั้งค่าแล้ว" }), "p.ad-form-ok")
    assert.equal(ok.attrs.role, "status")
    assert.equal(text(ok), "บันทึกการตั้งค่าแล้ว")
    const bad = one(one(render({ error: "บันทึกไม่ได้" }), "div.ad-form-bar"), "p.ad-field-error")
    assert.equal(bad.attrs.role, "alert")
    assert.equal(text(bad), "บันทึกไม่ได้")
    assert.equal(all(render(), "p.ad-form-ok").length, 0)
  })
  test("ส่งฟอร์ม → onSave (และกันการส่งแบบเดิมของเบราว์เซอร์)", () => {
    let saved = 0
    let prevented = 0
    const form = findTag(tree({ onSave: () => saved++ }), "form")
    handlerOf(form, "onSubmit")({ preventDefault: () => prevented++ })
    assert.deepEqual([saved, prevented], [1, 1])
    assert.equal(form.props.noValidate, true)
  })
})

describe("SettingsView — เชื่อมต่อ API", () => {
  const api = (over: Partial<SettingsViewProps> = {}) => panel(render(over), "st-h-api")
  test("ตั้งคีย์แล้ว → ป้ายเขียว · ปุ่มทดสอบใช้ได้ · บอกโมเดลที่ใช้ทดสอบ", () => {
    const p = api()
    assert.equal(one(p, ".ad-pill").attrs["data-tone"], "ok")
    assert.equal(text(one(p, ".ad-pill")), "ตั้งค่าแล้ว")
    assert.match(text(one(p, "p.ad-st-status")), /ตั้ง ANTHROPIC_API_KEY แล้ว/)
    assert.equal(one(p, "button[data-act=test-api]").attrs.disabled, undefined)
    assert.equal(text(one(p, "button[data-act=test-api]")), "ทดสอบการเชื่อมต่อ")
    assert.match(text(p), /โมเดลสรุป \(claude-haiku-4-5-20251001\)/)
  })
  test("ยังไม่ตั้งคีย์ → ป้ายเตือน · ปุ่มทดสอบปิด · บอกวิธีตั้ง", () => {
    const p = api({ settings: settings({ apiKeySet: false }) })
    assert.equal(one(p, ".ad-pill").attrs["data-tone"], "warn")
    assert.equal(text(one(p, ".ad-pill")), "ยังไม่ได้ตั้ง")
    assert.equal(one(p, "button[data-act=test-api]").attrs.disabled, "")
    assert.match(text(one(p, "p.ad-st-status")), /ยังไม่ได้ตั้ง ANTHROPIC_API_KEY/)
  })
  test("กำลังทดสอบ → ป้ายปุ่มเปลี่ยนและปิดปุ่ม", () => {
    const b = one(api({ test: { busy: true, result: null } }), "button[data-act=test-api]")
    assert.equal(text(b), "กำลังทดสอบ…")
    assert.equal(b.attrs.disabled, "")
  })
  test("กดปุ่มทดสอบ → onTest", () => {
    let n = 0
    const b = findAll(tree({ onTest: () => n++ }), (el) => el.type === "button" && el.props["data-act"] === "test-api")[0]!
    handlerOf(b, "onClick")()
    assert.equal(n, 1)
  })
  test("ผลสำเร็จ → ข้อความ role=status · ล้มเหลว → ข้อความ role=alert · ยังไม่ทดสอบ → ไม่มี", () => {
    const ok = one(api({ test: { busy: false, result: { ok: true, message: "เชื่อมต่อ Claude API ได้" } } }), "[data-kind=test-result]")
    assert.equal(ok.attrs.role, "status")
    assert.equal(text(ok), "เชื่อมต่อ Claude API ได้")
    const bad = one(api({ test: { busy: false, result: { ok: false, message: "คีย์ไม่ถูกต้อง" } } }), "[data-kind=test-result]")
    assert.equal(bad.attrs.role, "alert")
    assert.equal(text(bad), "คีย์ไม่ถูกต้อง")
    assert.equal(all(api(), "[data-kind=test-result]").length, 0)
  })
  test("แก้ช่องโมเดลสรุปค้างอยู่ → เตือนว่าทดสอบด้วยค่าที่บันทึกไว้ · ไม่ได้แก้ → ไม่เตือน", () => {
    assert.equal(all(api(), "[data-kind=test-diff]").length, 0)
    const d = { ...draftOfSettings(settings()), recapModel: "claude-opus-5-5" }
    assert.match(text(one(api({ draft: d }), "[data-kind=test-diff]")), /ยังไม่ได้บันทึก/)
  })
})

describe("SettingsView — ช่องทางนำเข้า", () => {
  const imp = (over: Partial<SettingsViewProps> = {}) => panel(render(over), "st-h-import")
  test("ตั้งโทเค็นแล้ว → ป้ายเขียว 'เปิดใช้อยู่' · ไม่มีวิธีตั้งค่า", () => {
    const p = imp()
    assert.equal(one(p, ".ad-pill").attrs["data-tone"], "ok")
    assert.equal(text(one(p, ".ad-pill")), "เปิดใช้อยู่")
    assert.equal(all(p, "[data-kind=howto]").length, 0)
  })
  test("ยังไม่ตั้ง → ป้ายเตือน 'ปิดอยู่' · แสดงวิธีสร้างค่าสุ่มและตั้งใน .env พร้อมปุ่มคัดลอกคำสั่ง", () => {
    const p = imp({ settings: settings({ importTokenSet: false }) })
    assert.equal(one(p, ".ad-pill").attrs["data-tone"], "warn")
    assert.equal(text(one(p, ".ad-pill")), "ปิดอยู่")
    const how = one(p, "[data-kind=howto]")
    assert.equal(all(how, "li").length, 3)
    assert.match(text(how), /IMPORT_TOKEN=/)
    assert.match(text(how), /24 ตัวอักษร/)
    assert.equal(text(one(how, "pre")), TOKEN_COMMAND)
    assert.equal(all(how, "button[data-copy=token-command]").length, 1)
  })
  test("แสดงที่อยู่และตัวอย่างคำสั่ง 2 แบบที่ใช้ YOUR_TOKEN · ไม่แสดงค่าโทเค็นจริงใดๆ", () => {
    const p = imp()
    const blocks = all(p, "pre").map((b) => text(b))
    assert.equal(blocks.length, 3)
    assert.equal(blocks[0], "https://example.test/api/import")
    assert.match(blocks[1]!, /status=draft/)
    assert.match(blocks[2]!, /-X PUT/)
    for (const b of blocks.slice(1)) assert.match(b, /Bearer YOUR_TOKEN/)
    assert.match(text(p), /แทน YOUR_TOKEN ด้วยค่า IMPORT_TOKEN/)
  })
  test("บอกว่าช่องทางนี้สร้าง/ลบ/เผยแพร่ตอนไม่ได้", () => {
    assert.match(text(imp()), /สร้าง ลบ หรือเผยแพร่ตอนไม่ได้/)
  })
  test("ปุ่มคัดลอกส่งรหัสกับข้อความจริงที่แสดงอยู่", () => {
    const calls: unknown[] = []
    const t = tree({ onCopy: (k, v) => calls.push([k, v]) })
    const buttons = findAll(t, (el) => el.type === "button" && typeof el.props["data-copy"] === "string")
    assert.deepEqual(buttons.map((b) => b.props["data-copy"]), ["import-url", "import-example-0", "import-example-1"])
    for (const b of buttons) handlerOf(b, "onClick")()
    assert.equal((calls[0] as string[])[1], "https://example.test/api/import")
    assert.match((calls[1] as string[])[1]!, /status=draft/)
    assert.match((calls[2] as string[])[1]!, /-X PUT/)
    assert.deepEqual((calls as string[][]).map((c) => c[0]), ["import-url", "import-example-0", "import-example-1"])
  })
  test("ปุ่มที่เพิ่งคัดลอกเปลี่ยนป้ายเป็น 'คัดลอกแล้ว' เฉพาะปุ่มนั้น", () => {
    const p = imp({ copied: "import-example-0" })
    assert.deepEqual(all(p, "button[data-copy]").map((b) => text(b)), ["คัดลอก", "คัดลอกแล้ว", "คัดลอก"])
  })
  test("คัดลอกอัตโนมัติไม่ได้ → แจ้ง (role=alert) · ปกติไม่แจ้ง", () => {
    const e = one(imp({ copyFailed: true }), "[data-kind=copy-failed]")
    assert.equal(e.attrs.role, "alert")
    assert.equal(all(imp(), "[data-kind=copy-failed]").length, 0)
  })
  test("กรอบคำสั่งเลื่อนด้วยคีย์บอร์ดได้ (tabindex)", () => {
    for (const pre of all(imp(), "pre")) assert.equal(pre.attrs.tabindex, "0")
  })
})

describe("SettingsView — สำรองข้อมูล", () => {
  test("ลิงก์ดาวน์โหลดไป /api/admin/backup", () => {
    const a = one(panel(render(), "st-h-backup"), "a[data-act=backup]")
    assert.equal(a.attrs.href, "/api/admin/backup")
    assert.equal(a.attrs.download, "")
    assert.equal(text(a), "ดาวน์โหลดไฟล์สำรอง")
  })
  test("บอกชื่อไฟล์และว่าไม่มีความลับในไฟล์", () => {
    const t = text(panel(render(), "st-h-backup"))
    assert.match(t, /koymukarnnovel-/)
    assert.match(t, /ไม่มีรหัสผ่าน คีย์ API หรือโทเค็น/)
  })
})
