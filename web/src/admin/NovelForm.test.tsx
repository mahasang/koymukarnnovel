import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Chip } from "../components/Chip"
import { Switch } from "../components/Switch"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { NovelFormView, NovelTabs, parseTab, TextField, type NovelFormViewProps } from "./NovelForm"
import { emptyDraft, MODE_HINT, STYLE_EXAMPLE, type NovelDraft } from "./novel-logic"
import { TagInput } from "./TagInput"

const props = (over: Partial<NovelFormViewProps> = {}): NovelFormViewProps => ({
  mode: "create",
  draft: emptyDraft(),
  errors: {},
  dirty: false,
  saving: false,
  saveError: null,
  notice: null,
  ai: { busy: false, error: null, notice: null, canUndo: false },
  cover: <div className="cover-slot" />,
  onChange: () => {},
  onSubmit: () => {},
  onAiFill: () => {},
  onAiUndo: () => {},
  ...over,
})

const draftOf = (over: Partial<NovelDraft> = {}): NovelDraft => ({ ...emptyDraft(), ...over })
const render = (over: Partial<NovelFormViewProps> = {}) => renderPage(<NovelFormView {...props(over)} />)

/** ช่องกรอกทุกช่อง: [id, คีย์ในร่าง, ชนิดแท็ก, ความยาวสูงสุดตามเซิร์ฟเวอร์] */
const FIELDS = [
  ["nf-title", "title", "input", 300],
  ["nf-author", "author", "input", 200],
  ["nf-synopsisSrc", "synopsisSrc", "textarea", 10000],
  ["nf-titleTh", "titleTh", "input", 300],
  ["nf-synopsis", "synopsis", "textarea", 10000],
  ["nf-sourceUrl", "sourceUrl", "input", 2000],
  ["nf-licenseNote", "licenseNote", "textarea", 2000],
  ["nf-styleNote", "styleNote", "textarea", 3000],
] as const

describe("NovelFormView: โครงฟอร์ม", () => {
  test("หัวข้อกลุ่มตามลำดับ และเป็นฟอร์มที่ไม่ใช้การตรวจของเบราว์เซอร์ (noValidate: ข้อความผิดพลาดเป็นภาษาไทยของเรา)", () => {
    const page = render()
    assert.deepEqual(all(page, "h2").map(text), ["ต้นฉบับ", "ภาษาไทย", "การแปลและที่มา", "ปก", "การแสดงผล"])
    assert.equal(one(page, "form").attrs.novalidate !== undefined, true)
  })

  test("ทุกช่องมีป้ายกำกับที่ผูกด้วย id และความยาวสูงสุดตรงกับเซิร์ฟเวอร์", () => {
    const page = render()
    for (const [id, , tag, max] of FIELDS) {
      const field = one(page, `${tag}[id=${id}]`)
      assert.equal(field.attrs.maxlength, String(max), id)
      assert.equal(all(page, `label[for=${id}]`).length, 1, `ป้ายของ ${id}`)
    }
    assert.equal(all(page, "label[for=nf-tags]").length, 1)
  })

  test("ชื่อต้นฉบับเป็นช่องที่ต้องกรอก (aria-required) ช่องอื่นไม่ใช่", () => {
    const page = render()
    assert.equal(one(page, "input[id=nf-title]").attrs["aria-required"], "true")
    for (const [id, , tag] of FIELDS.filter(([, key]) => key !== "title")) assert.equal(one(page, `${tag}[id=${id}]`).attrs["aria-required"], undefined, id)
  })

  test("ค่าในช่องมาจากร่าง", () => {
    const draft = draftOf({ title: "T", author: "A", synopsisSrc: "SS", titleTh: "TH", synopsis: "SY", sourceUrl: "https://x.example", licenseNote: "LN", styleNote: "SN" })
    const page = render({ draft })
    for (const [id, key, tag] of FIELDS) {
      const field = one(page, `${tag}[id=${id}]`)
      assert.equal(tag === "input" ? field.attrs.value : text(field), draft[key], id)
    }
  })

  test("พิมพ์ในช่องไหน ส่ง patch ของช่องนั้นช่องเดียว", () => {
    const patches: Partial<NovelDraft>[] = []
    const view = NovelFormView(props({ onChange: (patch) => patches.push(patch) }))
    for (const [id, key] of FIELDS) {
      const [field] = findAll(view, (e) => e.type === TextField && e.props.id === id)
      ;(field!.props.onChange as (v: string) => void)(`v-${key}`)
    }
    assert.deepEqual(patches, FIELDS.map(([, key]) => ({ [key]: `v-${key}` })))
  })

  test("ช่องลิงก์เป็น type=url และไม่ให้เติมอัตโนมัติ", () => {
    const el = one(render(), "input[id=nf-sourceUrl]")
    assert.equal(el.attrs.type, "url")
    assert.equal(el.attrs.inputmode, "url")
  })

  test("แท็ก: ใช้ TagInput และเปลี่ยนแท็กแล้วส่ง patch tags", () => {
    const patches: Partial<NovelDraft>[] = []
    const view = NovelFormView(props({ draft: draftOf({ tags: ["a"] }), onChange: (patch) => patches.push(patch) }))
    const [tagInput] = findAll(view, (e) => e.type === TagInput)
    assert.equal(tagInput!.props.id, "nf-tags")
    assert.deepEqual(tagInput!.props.tags, ["a"])
    ;(tagInput!.props.onChange as (t: string[]) => void)(["a", "b"])
    assert.deepEqual(patches, [{ tags: ["a", "b"] }])
  })

  test("ช่องปกเป็นของที่ส่งเข้ามา (อยู่ในหัวข้อ 'ปก')", () => {
    assert.equal(all(render(), "div[class=cover-slot]").length, 1)
  })
})

describe("NovelFormView: ตัวเลือกและสวิตช์", () => {
  const chips = (view: ReturnType<typeof NovelFormView>) => findAll(view, (e) => e.type === Chip)

  test("สถานะและโหมดเป็นชิปสลับ: อันที่เลือกอยู่ selected · กดแล้วส่ง patch", () => {
    const patches: Partial<NovelDraft>[] = []
    const view = NovelFormView(props({ draft: draftOf({ status: "completed", mode: "story" }), onChange: (patch) => patches.push(patch) }))
    const all4 = chips(view)
    // ตามลำดับบนหน้า: โหมดอยู่คอลัมน์หลัก สถานะอยู่คอลัมน์ข้าง
    assert.deepEqual(all4.map((c) => [c.props.children, Boolean(c.props.selected)]), [
      ["แปลตรง", false],
      ["เล่าเรื่อง", true],
      ["กำลังอัปเดต", false],
      ["จบแล้ว", true],
    ])
    for (const c of all4) (c.props.onClick as () => void)()
    assert.deepEqual(patches, [{ mode: "translate" }, { mode: "story" }, { status: "ongoing" }, { status: "completed" }])
  })

  test("คำอธิบายโหมดตามโหมดที่เลือก", () => {
    for (const mode of ["translate", "story"] as const) {
      const page = render({ draft: draftOf({ mode }) })
      assert.match(text(page), new RegExp(MODE_HINT[mode].slice(0, 12)))
      assert.doesNotMatch(text(page), new RegExp(MODE_HINT[mode === "translate" ? "story" : "translate"].slice(0, 12)))
    }
  })

  test("สวิตช์ 'เผยแพร่' และ 'เรื่องแนะนำ': ค่าตามร่าง กดแล้วส่งค่าตรงข้าม", () => {
    const patches: Partial<NovelDraft>[] = []
    const view = NovelFormView(props({ draft: draftOf({ published: true, featured: false }), onChange: (patch) => patches.push(patch) }))
    const switches = findAll(view, (e) => e.type === Switch)
    assert.deepEqual(switches.map((s) => [s.props.label, s.props.checked]), [
      ["เผยแพร่ให้ผู้อ่านเห็น", true],
      ["เรื่องแนะนำ (ขึ้นเด่นที่หน้าแรก)", false],
    ])
    ;(switches[0]!.props.onChange as (v: boolean) => void)(false)
    ;(switches[1]!.props.onChange as (v: boolean) => void)(true)
    assert.deepEqual(patches, [{ published: false }, { featured: true }])
  })

  test("อธิบายว่าเผยแพร่เรื่องแล้วยังต้องเผยแพร่ทีละตอนด้วย และเรื่องแนะนำมีได้เรื่องเดียว", () => {
    const body = text(render())
    assert.match(body, /ต้องเผยแพร่ทีละตอนด้วย/)
    assert.match(body, /เรื่องเดียว/)
  })

  test("ปุ่ม 'ใส่ตัวอย่าง' อยู่ที่ช่องสไตล์การแปลเมื่อช่องว่าง: ใส่ตัวอย่างให้ · ช่องมีข้อความแล้วไม่แสดง (ไม่เขียนทับ)", () => {
    const patches: Partial<NovelDraft>[] = []
    const empty = NovelFormView(props({ onChange: (patch) => patches.push(patch) }))
    handlerOf(findTag(empty, "button", (b) => b.props.children === "ใส่ตัวอย่าง"), "onClick")()
    assert.deepEqual(patches, [{ styleNote: STYLE_EXAMPLE }])
    assert.deepEqual(findAll(NovelFormView(props({ draft: draftOf({ styleNote: "ของฉัน" }) })), (e) => e.type === "button" && e.props.children === "ใส่ตัวอย่าง"), [])
    // ช่องที่มีแต่ช่องว่างยังถือว่าว่าง
    assert.equal(findAll(NovelFormView(props({ draft: draftOf({ styleNote: "  \n" }) })), (e) => e.type === "button" && e.props.children === "ใส่ตัวอย่าง").length, 1)
  })
})

describe("NovelFormView: ปุ่มบันทึก", () => {
  const submit = (over: Partial<NovelFormViewProps>) => one(render(over), "button[type=submit]")

  test("สร้างเรื่อง: ปุ่ม 'สร้างเรื่อง' กดได้เสมอ (ยังไม่มีอะไรให้เทียบว่าเปลี่ยนหรือไม่)", () => {
    const b = submit({})
    assert.equal(text(b), "สร้างเรื่อง")
    assert.equal(b.attrs.disabled, undefined)
  })

  test("แก้ไข: ไม่มีอะไรเปลี่ยน → ปุ่ม 'บันทึก' ปิดอยู่และไม่มีป้ายค้าง · เปลี่ยนแล้ว → กดได้และบอกว่ายังไม่บันทึก", () => {
    const clean = render({ mode: "edit", dirty: false })
    assert.equal(text(one(clean, "button[type=submit]")), "บันทึก")
    assert.equal(one(clean, "button[type=submit]").attrs.disabled !== undefined, true)
    assert.doesNotMatch(text(clean), /ยังไม่บันทึก/)
    const dirty = render({ mode: "edit", dirty: true })
    assert.equal(one(dirty, "button[type=submit]").attrs.disabled, undefined)
    assert.match(text(dirty), /มีการแก้ไขที่ยังไม่บันทึก/)
  })

  test("กำลังบันทึก: ปุ่มปิดและขึ้น 'กำลังบันทึก…' (ทั้งสร้างและแก้ไข)", () => {
    for (const mode of ["create", "edit"] as const) {
      const b = submit({ mode, saving: true, dirty: true })
      assert.equal(text(b), "กำลังบันทึก…")
      assert.equal(b.attrs.disabled !== undefined, true)
    }
  })

  test("ข้อความ 'บันทึกแล้ว' เป็น role=status · ข้อผิดพลาดการบันทึกเป็น role=alert · ไม่มี = ไม่มีกล่อง", () => {
    const ok = render({ notice: "บันทึกแล้ว" })
    assert.equal(text(one(ok, "p[role=status]")), "บันทึกแล้ว")
    const bad = render({ saveError: "ชื่อเรื่อง (title) ต้องไม่ว่าง" })
    assert.equal(text(one(bad, "p[role=alert]")), "ชื่อเรื่อง (title) ต้องไม่ว่าง")
    const none = render()
    assert.equal(all(none, "p[role=status]").length, 0)
    assert.equal(all(none, "p[role=alert]").length, 0)
  })

  test("ส่งฟอร์มเรียก onSubmit พร้อมเหตุการณ์", () => {
    let got: unknown = null
    const event = { preventDefault() {} }
    handlerOf(findTag(NovelFormView(props({ onSubmit: (e) => (got = e) })), "form"), "onSubmit")(event)
    assert.equal(got, event)
  })

  test("ปุ่ม 'ลบเรื่องนี้' มีเฉพาะตอนแก้ไข เป็น type=button และเรียก onDelete", () => {
    assert.equal(all(render({ mode: "create" }), "button").filter((b) => text(b) === "ลบเรื่องนี้").length, 0)
    let deleted = 0
    const view = NovelFormView(props({ mode: "edit", onDelete: () => deleted++ }))
    const button = findTag(view, "button", (b) => String(b.props.children).includes("ลบเรื่องนี้"))
    assert.equal(button.props.type, "button")
    handlerOf(button, "onClick")()
    assert.equal(deleted, 1)
  })
})

describe("NovelFormView: ข้อผิดพลาดของช่อง", () => {
  test("ชื่อ/ลิงก์ผิด → ช่องเป็น aria-invalid และอ้างข้อความผ่าน aria-describedby", () => {
    const page = render({ errors: { title: "กรอกชื่อต้นฉบับ", sourceUrl: "ลิงก์ต้องขึ้นต้นด้วย http://" } })
    const title = one(page, "input[id=nf-title]")
    assert.equal(title.attrs["aria-invalid"], "true")
    assert.equal(title.attrs["aria-describedby"], "nf-title-error")
    assert.equal(text(one(page, "p[id=nf-title-error]")), "กรอกชื่อต้นฉบับ")
    const url = one(page, "input[id=nf-sourceUrl]")
    assert.equal(url.attrs["aria-invalid"], "true")
    assert.match(url.attrs["aria-describedby"] ?? "", /nf-sourceUrl-error/)
    assert.equal(text(one(page, "p[id=nf-sourceUrl-error]")), "ลิงก์ต้องขึ้นต้นด้วย http://")
  })

  test("ไม่มีข้อผิดพลาด → ไม่มี aria-invalid และไม่มีกล่องข้อความ", () => {
    const page = render()
    assert.equal(one(page, "input[id=nf-title]").attrs["aria-invalid"], undefined)
    assert.equal(all(page, "p[id=nf-title-error]").length, 0)
    assert.equal(all(page, "p[id=nf-sourceUrl-error]").length, 0)
  })

  test("ช่องลิงก์มีคำอธิบายประกอบเสมอ (ว่างได้) และอ้างทั้งคำอธิบายกับข้อผิดพลาดเมื่อมี", () => {
    assert.equal(one(render(), "input[id=nf-sourceUrl]").attrs["aria-describedby"], "nf-sourceUrl-hint")
    assert.equal(one(render({ errors: { sourceUrl: "x" } }), "input[id=nf-sourceUrl]").attrs["aria-describedby"], "nf-sourceUrl-hint nf-sourceUrl-error")
  })
})

describe("NovelFormView: ให้ AI ช่วยกรอก", () => {
  const aiButton = (over: Partial<NovelFormViewProps>) => findTag(NovelFormView(props(over)), "button", (b) => b.props["data-ai"] === "fill")

  test("ปุ่มข้อความตาม spec · ต้องมีชื่อต้นฉบับก่อน ไม่มี → ปิดและบอกเหตุ", () => {
    const empty = render()
    const b = one(empty, "button[data-ai=fill]")
    assert.equal(text(b), "ให้ AI ช่วยแปลชื่อ + เรื่องย่อ + แนะนำแท็ก")
    assert.equal(b.attrs.disabled !== undefined, true)
    assert.match(text(empty), /กรอกชื่อต้นฉบับก่อน/)
    const ready = render({ draft: draftOf({ title: "The Last Lantern" }) })
    assert.equal(one(ready, "button[data-ai=fill]").attrs.disabled, undefined)
    assert.doesNotMatch(text(ready), /กรอกชื่อต้นฉบับก่อน/)
  })

  test("อธิบายว่าผลเติมลงช่องให้แก้ต่อและไม่ถูกเก็บจนกว่าจะกดปุ่มบันทึก", () => {
    assert.match(text(render({ draft: draftOf({ title: "T" }) })), /ไม่ถูกเก็บจนกว่า/)
  })

  test("กดปุ่ม → onAiFill · เป็น type=button (ไม่ส่งฟอร์ม)", () => {
    let called = 0
    const b = aiButton({ draft: draftOf({ title: "T" }), onAiFill: () => called++ })
    assert.equal(b.props.type, "button")
    handlerOf(b, "onClick")()
    assert.equal(called, 1)
  })

  test("AI กำลังทำงาน → ปุ่มปิดและขึ้น 'AI กำลังทำงาน…'", () => {
    const b = one(render({ draft: draftOf({ title: "T" }), ai: { busy: true, error: null, notice: null, canUndo: false } }), "button[data-ai=fill]")
    assert.equal(text(b), "AI กำลังทำงาน…")
    assert.equal(b.attrs.disabled !== undefined, true)
  })

  test("ข้อผิดพลาดของ AI (เช่น ยังไม่ได้ตั้ง API key) แสดงตามที่เซิร์ฟเวอร์บอก เป็น role=alert", () => {
    const page = render({ draft: draftOf({ title: "T" }), ai: { busy: false, error: "ยังไม่ได้ตั้ง API key", notice: null, canUndo: false } })
    assert.equal(text(one(page, "p[role=alert][data-ai=error]")), "ยังไม่ได้ตั้ง API key")
  })

  test("ผลสำเร็จ: ข้อความสรุปเป็น role=status · ปุ่ม 'ย้อนกลับ' มีเมื่อย้อนได้เท่านั้น และเรียก onAiUndo", () => {
    const notice = "AI เติมให้แล้ว: ชื่อภาษาไทย — ยังไม่ได้บันทึก"
    const noUndo = render({ ai: { busy: false, error: null, notice, canUndo: false } })
    assert.equal(text(one(noUndo, "p[data-ai=notice]")), notice)
    assert.equal(all(noUndo, "button[data-ai=undo]").length, 0)
    let undone = 0
    const view = NovelFormView(props({ ai: { busy: false, error: null, notice, canUndo: true }, onAiUndo: () => undone++ }))
    const undo = findTag(view, "button", (b) => b.props["data-ai"] === "undo")
    assert.equal(undo.props.type, "button")
    handlerOf(undo, "onClick")()
    assert.equal(undone, 1)
    assert.equal(text(one(render({ ai: { busy: false, error: null, notice, canUndo: true } }), "button[data-ai=undo]")), "ย้อนกลับ")
  })
})

describe("NovelTabs: แถบแท็บของหน้าเรื่อง", () => {
  const nav = (tab: "info" | "chapters" | "glossary", chapterCount = 90) => renderPage(<NovelTabs id={7} tab={tab} chapterCount={chapterCount} />)

  test("สามแท็บเป็นลิงก์ตามลำดับ: ข้อมูล (ไม่มี ?tab) · ตอน · อภิธานศัพท์", () => {
    const links = all(nav("info"), "a")
    assert.deepEqual(links.map((a) => a.attrs.href), ["/admin/novels/7", "/admin/novels/7?tab=chapters", "/admin/novels/7?tab=glossary"])
    assert.deepEqual(links.map((a) => text(a).replace(/\s+/g, " ").trim()), ["ข้อมูล", "ตอน 90", "อภิธานศัพท์"])
  })

  test("แท็บที่เปิดอยู่มี aria-current=page ตัวเดียว", () => {
    for (const [tab, index] of [["info", 0], ["chapters", 1], ["glossary", 2]] as const) {
      const links = all(nav(tab), "a")
      assert.deepEqual(links.map((a) => a.attrs["aria-current"] ?? null), links.map((_, i) => (i === index ? "page" : null)), tab)
    }
  })

  test("เป็นเมนูนำทางที่มีชื่อ", () => {
    assert.equal(one(nav("info"), "nav").attrs["aria-label"], "ส่วนต่างๆ ของเรื่อง")
  })
})

describe("parseTab", () => {
  test("อ่านแท็บจาก ?tab= · ไม่มี/ไม่รู้จัก → ข้อมูล", () => {
    assert.equal(parseTab("chapters"), "chapters")
    assert.equal(parseTab("glossary"), "glossary")
    assert.equal(parseTab("info"), "info")
    for (const v of [null, "", "x", "CHAPTERS", "chapters "]) assert.equal(parseTab(v), "info", String(v))
  })
})

describe("NovelFormView/TextField: ส่วนที่ mutation sweep พบว่าเทสต์ยังไม่ครอบ (Task 30)", () => {
  test("ดอกจันช่องบังคับซ่อนจากโปรแกรมอ่านหน้าจอ (aria-required อ่านให้แล้ว) และมีเฉพาะช่องที่บังคับ", () => {
    const page = render()
    const stars = all(page, "span[class=ad-req]")
    assert.equal(stars.length, 1)
    assert.equal(stars[0]!.attrs["aria-hidden"], "true")
    assert.equal(all(one(page, "label[for=nf-author]"), "span").length, 0)
  })

  test("TextField: พิมพ์ในช่อง → ส่งค่าที่พิมพ์ให้ onChange (ทั้งช่องบรรทัดเดียวและหลายบรรทัด)", () => {
    for (const rows of [undefined, 3]) {
      const got: string[] = []
      const view = TextField({ id: "x", label: "ป้าย", value: "", max: 10, rows, onChange: (v) => got.push(v) })
      const field = findTag(view, rows === undefined ? "input" : "textarea")!
      ;(field.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "สวัสดี" } })
      assert.deepEqual(got, ["สวัสดี"])
    }
  })

  test("ข้อความ AI (notice) เป็น role=status ให้โปรแกรมอ่านหน้าจออ่านเมื่อเปลี่ยน", () => {
    const page = render({ ai: { busy: false, error: null, notice: "AI เติมให้แล้ว", canUndo: false } })
    assert.equal(one(page, "p[data-ai=notice]").attrs.role, "status")
  })

  test("ขณะกำลังบันทึก ไม่ขึ้น 'มีการแก้ไขที่ยังไม่บันทึก' · ตอนสร้างเรื่องไม่มีปุ่มลบแม้ส่ง onDelete มา", () => {
    const editing = render({ mode: "edit", dirty: true, saving: true })
    assert.doesNotMatch(text(editing), /ยังไม่บันทึก/)
    assert.match(text(render({ mode: "edit", dirty: true, saving: false })), /มีการแก้ไขที่ยังไม่บันทึก/)
    const create = render({ mode: "create", onDelete: () => {} })
    assert.equal(all(create, "button").filter((b) => /ลบเรื่องนี้/.test(text(b))).length, 0)
  })
})
