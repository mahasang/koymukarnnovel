import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { ChapterEditView, type ChapterEditViewProps } from "./ChapterEdit"
import { draftOf, type ChapterDraft } from "./chapter-edit-logic"
import { TextField } from "./NovelForm"
import type { AdminChapterDto, AdminChapterRow } from "./types"

const chapter = (over: Partial<AdminChapterDto> = {}): AdminChapterDto => ({
  id: 5,
  novelId: 7,
  number: 3,
  title: "The Stone Stairs",
  titleTh: "บันไดหิน",
  sourceText: "Source body",
  translation: "เนื้อหาแปล",
  recap: "สรุปตอน",
  status: "done",
  error: "",
  published: false,
  publishedAt: null,
  translatedAt: "2026-10-01 05:30:00",
  queueSeq: null,
  autoPublish: false,
  createdAt: "2026-10-01 00:00:00",
  updatedAt: "2026-10-01 00:00:00",
  ...over,
})

const link = (id: number, number: number): AdminChapterRow => ({ id, number, title: "T", titleTh: "", status: "done", error: "", published: false, publishedAt: null, translatedAt: null, queueSeq: null, hasTranslation: true, srcLength: 1 })

const props = (over: Partial<ChapterEditViewProps> = {}): ChapterEditViewProps => {
  const c = over.chapter ?? chapter()
  return {
    chapter: c,
    novelTitle: "Moon Gate",
    draft: draftOf(c),
    prev: link(4, 2),
    next: link(6, 4),
    saving: false,
    working: false,
    notice: null,
    error: null,
    onChange: () => {},
    onSave: () => {},
    onTranslate: () => {},
    onToggle: () => {},
    onGo: () => {},
    ...over,
  }
}

const render = (over: Partial<ChapterEditViewProps> = {}) => renderPage(<ChapterEditView {...props(over)} />)

describe("ChapterEditView — หัวหน้าและสถานะ", () => {
  test("ทางกลับ: นิยาย / ชื่อเรื่อง (ไปแท็บตอน) · หัวเรื่องบอกเลขตอนและชื่อไทย", () => {
    const page = render()
    assert.equal(one(page, "a[href=/admin/novels]").attrs.href, "/admin/novels")
    assert.equal(text(one(page, "a[href=/admin/novels/7?tab=chapters]")), "Moon Gate")
    assert.match(text(one(page, "h1")), /ตอนที่ 3/)
    assert.match(text(one(page, "h1")), /บันไดหิน/)
  })
  test("ไม่มีชื่อไทย → หัวเรื่องใช้ชื่อต้นฉบับ", () => {
    assert.match(text(one(render({ chapter: chapter({ titleTh: "" }) }), "h1")), /The Stone Stairs/)
  })
  test("ชิปสถานะตามโทน + ป้ายสถานะเผยแพร่ + เวลาแปลเป็นเวลาไทย", () => {
    const page = render()
    const pill = one(page, "span[class=ad-pill]")
    assert.equal(pill.attrs["data-tone"], "ok")
    assert.equal(text(pill), "แปลเสร็จ")
    assert.match(text(one(page, "p[class=ad-ce-stat]")), /ยังไม่เผยแพร่/)
    assert.match(text(one(page, "p[class=ad-ce-stat]")), /1 ต\.ค\. 2569 12:30 น\./)
  })
  test("เผยแพร่แล้ว → บอกว่าเผยแพร่แล้ว · ยังไม่เคยแปล → ขีด '—'", () => {
    assert.match(text(one(render({ chapter: chapter({ published: true }) }), "p[class=ad-ce-stat]")), /เผยแพร่แล้ว/)
    assert.match(text(one(render({ chapter: chapter({ translatedAt: null }) }), "p[class=ad-ce-stat]")), /—/)
  })
  test("ตอนที่ผิดพลาด: โชว์ข้อความผิดพลาดล่าสุด · ตอนอื่นไม่โชว์", () => {
    const page = render({ chapter: chapter({ status: "error", error: "API 529 Overloaded" }) })
    assert.equal(one(page, "p[class=ad-ce-error]").attrs.role, undefined)
    assert.match(text(one(page, "p[class=ad-ce-error]")), /API 529 Overloaded/)
    assert.equal(all(render({ chapter: chapter({ status: "done", error: "ค้าง" }) }), "p[class=ad-ce-error]").length, 0)
  })
})

describe("ChapterEditView — ช่องแก้ไข", () => {
  const FIELDS: [string, keyof ChapterDraft][] = [
    ["ce-title", "title"],
    ["ce-titleTh", "titleTh"],
    ["ce-recap", "recap"],
  ]
  test("ช่องชื่อ/ชื่อไทย/เรื่องย่อแสดงค่าของร่าง", () => {
    const draft = { ...draftOf(chapter()), title: "ร่าง A", titleTh: "ร่าง B", recap: "ร่าง C" }
    const page = render({ draft })
    assert.equal(one(page, "input[id=ce-title]").attrs.value, "ร่าง A")
    assert.equal(one(page, "input[id=ce-titleTh]").attrs.value, "ร่าง B")
    assert.equal(text(one(page, "textarea[id=ce-recap]")), "ร่าง C")
  })
  test("ต้นฉบับ (ซ้าย) และคำแปล (ขวา) เป็นสองช่องใหญ่ มีจำนวนตัวอักษร", () => {
    const page = render({ draft: { ...draftOf(chapter()), sourceText: "abcde", translation: "สวัสดี" } })
    assert.equal(text(one(page, "textarea[id=ce-sourceText]")), "abcde")
    assert.equal(text(one(page, "textarea[id=ce-translation]")), "สวัสดี")
    assert.equal(text(one(page, "p[data-count=sourceText]")), "5 ตัวอักษร")
    assert.equal(text(one(page, "p[data-count=translation]")), "6 ตัวอักษร")
  })
  test("พิมพ์ในแต่ละช่อง → ส่ง patch ของช่องนั้นช่องเดียว", () => {
    const got: Partial<ChapterDraft>[] = []
    const view = ChapterEditView(props({ onChange: (patch) => got.push(patch) }))
    for (const key of ["title", "titleTh", "recap", "sourceText", "translation"] as const) {
      const [field] = findAll(view, (e) => e.type === TextField && e.props.id === `ce-${key}`)
      ;(field!.props.onChange as (v: string) => void)(`v-${key}`)
    }
    assert.deepEqual(got, ["title", "titleTh", "recap", "sourceText", "translation"].map((key) => ({ [key]: `v-${key}` })))
    void FIELDS
  })
  test("กำลังแปล: ต้นฉบับและคำแปลถูกปิดพร้อมข้อความรอ/หยุดคิว · ชื่อและเรื่องย่อยังแก้ได้", () => {
    const page = render({ chapter: chapter({ status: "translating", translation: "" }), draft: { ...draftOf(chapter()), translation: "" } })
    assert.equal(one(page, "textarea[id=ce-sourceText]").attrs.disabled !== undefined, true)
    assert.equal(one(page, "textarea[id=ce-translation]").attrs.disabled !== undefined, true)
    assert.equal(one(page, "input[id=ce-title]").attrs.disabled, undefined)
    assert.equal(one(page, "input[id=ce-titleTh]").attrs.disabled, undefined)
    assert.equal(one(page, "textarea[id=ce-recap]").attrs.disabled, undefined)
    assert.match(text(one(page, "p[id=ce-translation-hint]")), /หยุดคิว/)
  })
  test("ตอนที่ยังไม่มีคำแปล: ช่องคำแปลว่างใช้ได้ พร้อมคำอธิบายวางคำแปลเอง", () => {
    const page = render({ chapter: chapter({ status: "draft", translation: "" }), draft: { ...draftOf(chapter()), translation: "" } })
    assert.equal(one(page, "textarea[id=ce-translation]").attrs.disabled, undefined)
    assert.match(text(one(page, "p[id=ce-translation-hint]")), /ไม่เสียค่า API/)
  })
  test("ตอนปกติที่มีคำแปล: ไม่มีคำอธิบายใต้ช่องคำแปล", () => {
    assert.equal(all(render(), "p[id=ce-translation-hint]").length, 0)
  })
})

describe("ChapterEditView — ปุ่ม", () => {
  test("ไม่มีการแก้: บันทึกปิด · ไม่มีข้อความค้าง · แปลใหม่ใช้ได้", () => {
    const page = render()
    assert.equal(one(page, "button[type=submit]").attrs.disabled !== undefined, true)
    assert.equal(all(page, "span[class=ad-form-note]").length, 0)
    assert.equal(text(one(page, "button[data-act=translate]")), "แปลใหม่")
    assert.equal(one(page, "button[data-act=translate]").attrs.disabled, undefined)
  })
  test("มีการแก้: บันทึกใช้ได้ + ข้อความ 'มีการแก้ไขที่ยังไม่บันทึก' · แปลใหม่/เผยแพร่ปิดพร้อมเหตุผล", () => {
    const page = render({ draft: { ...draftOf(chapter()), titleTh: "แก้แล้ว" } })
    assert.equal(one(page, "button[type=submit]").attrs.disabled, undefined)
    assert.match(text(one(page, "span[class=ad-form-note]")), /ยังไม่บันทึก/)
    assert.equal(one(page, "button[data-act=translate]").attrs.disabled !== undefined, true)
    assert.equal(one(page, "button[data-act=toggle]").attrs.disabled !== undefined, true)
    assert.match(text(one(page, "p[data-kind=reason]")), /บันทึกก่อน/)
  })
  test("กำลังบันทึก: ปุ่มเขียน 'กำลังบันทึก…' และปิดทุกปุ่ม", () => {
    const page = render({ saving: true, draft: { ...draftOf(chapter()), titleTh: "x" } })
    assert.equal(text(one(page, "button[type=submit]")), "กำลังบันทึก…")
    assert.equal(one(page, "button[type=submit]").attrs.disabled !== undefined, true)
  })
  test("กำลังสั่งแปล/เผยแพร่อยู่ (working): ปุ่มสั่งงานปิดทั้งหมด", () => {
    const page = render({ working: true })
    assert.equal(one(page, "button[data-act=translate]").attrs.disabled !== undefined, true)
    assert.equal(one(page, "button[data-act=toggle]").attrs.disabled !== undefined, true)
  })
  test("ปุ่มเผยแพร่/ซ่อนตามสถานะและส่งค่าที่จะตั้ง", () => {
    const got: boolean[] = []
    const off = ChapterEditView(props({ onToggle: (v) => got.push(v) }))
    handlerOf(findTag(off, "button", (b) => b.props["data-act"] === "toggle"), "onClick")()
    const on = ChapterEditView(props({ chapter: chapter({ published: true }), onToggle: (v) => got.push(v) }))
    handlerOf(findTag(on, "button", (b) => b.props["data-act"] === "toggle"), "onClick")()
    assert.deepEqual(got, [true, false])
    assert.equal(text(one(render(), "button[data-act=toggle]")), "เผยแพร่")
    assert.equal(text(one(render({ chapter: chapter({ published: true }) }), "button[data-act=toggle]")), "ซ่อน")
  })
  test("ตอนที่ยังไม่มีคำแปล: เผยแพร่ไม่ได้ + เหตุผล · ปุ่มแปลเขียนว่า 'แปล'", () => {
    const c = chapter({ status: "draft", translation: "" })
    const page = render({ chapter: c, draft: draftOf(c) })
    assert.equal(one(page, "button[data-act=toggle]").attrs.disabled !== undefined, true)
    assert.match(text(one(page, "p[data-kind=reason]")), /ยังไม่มีคำแปล/)
    assert.equal(text(one(page, "button[data-act=translate]")), "แปล")
  })
  test("รอคิว/กำลังแปล: สั่งแปลซ้ำไม่ได้", () => {
    for (const status of ["queued", "translating"] as const) assert.equal(one(render({ chapter: chapter({ status }) }), "button[data-act=translate]").attrs.disabled !== undefined, true, status)
  })
  test("กดปุ่มแปล → onTranslate · ส่งฟอร์ม → onSave (กันส่งแบบเปลี่ยนหน้า)", () => {
    const calls: string[] = []
    const view = ChapterEditView(props({ onTranslate: () => calls.push("translate"), onSave: () => calls.push("save") }))
    handlerOf(findTag(view, "button", (b) => b.props["data-act"] === "translate"), "onClick")()
    let prevented = false
    handlerOf(findTag(view, "form"), "onSubmit")({ preventDefault: () => (prevented = true) })
    assert.deepEqual(calls, ["translate", "save"])
    assert.equal(prevented, true)
  })
})

describe("ChapterEditView — ตอนก่อนหน้า/ถัดไป · แจ้งผล", () => {
  test("ปุ่มมีป้ายเลขตอนปลายทาง · กดแล้วส่งแถวนั้นให้ onGo", () => {
    const got: number[] = []
    const view = ChapterEditView(props({ onGo: (row) => got.push(row.id) }))
    const prev = findTag(view, "button", (b) => b.props["data-nav"] === "prev")
    const next = findTag(view, "button", (b) => b.props["data-nav"] === "next")
    assert.equal(prev.props["aria-label"], "ไปตอนก่อนหน้า (ตอนที่ 2)")
    assert.equal(next.props["aria-label"], "ไปตอนถัดไป (ตอนที่ 4)")
    handlerOf(prev, "onClick")()
    handlerOf(next, "onClick")()
    assert.deepEqual(got, [4, 6])
  })
  test("ไม่มีตอนข้างเคียง → ปุ่มปิด (ยังอยู่ให้เห็นว่าไม่มี)", () => {
    const page = render({ prev: null, next: null })
    assert.equal(one(page, "button[data-nav=prev]").attrs.disabled !== undefined, true)
    assert.equal(one(page, "button[data-nav=next]").attrs.disabled !== undefined, true)
  })
  test("แจ้งผลเป็น role=status · ข้อผิดพลาดเป็น role=alert · ไม่มีก็ไม่แสดง", () => {
    const page = render({ notice: "บันทึกแล้ว", error: "409 กำลังแปลอยู่" })
    assert.equal(text(one(page, "p[class=ad-form-note ad-form-ok]")), "บันทึกแล้ว")
    assert.equal(one(page, "p[class=ad-form-note ad-form-ok]").attrs.role, "status")
    assert.equal(text(one(page, "p[class=ad-field-error]")), "409 กำลังแปลอยู่")
    assert.equal(one(page, "p[class=ad-field-error]").attrs.role, "alert")
    const none = render()
    assert.equal(all(none, "p[role=status]").length, 0)
    assert.equal(all(none, "p[role=alert]").length, 0)
  })
})

describe("ChapterEditView — ขอบเขตหลัง mutation sweep", () => {
  const edited = { ...draftOf(chapter()), titleTh: "แก้แล้ว" }
  test("มีแก้ค้างแต่กำลังสั่งแปล/เผยแพร่อยู่ → บันทึกปิดด้วย", () => {
    assert.equal(one(render({ draft: edited, working: true }), "button[type=submit]").attrs.disabled !== undefined, true)
    assert.equal(one(render({ draft: edited }), "button[type=submit]").attrs.disabled, undefined)
  })
  test("กำลังบันทึก → ไม่แสดง 'มีการแก้ไขที่ยังไม่บันทึก'", () => {
    assert.equal(all(render({ draft: edited, saving: true }), "span[class=ad-form-note]").length, 0)
  })
  test("ช่องแต่ละช่องจำกัดความยาวตามที่เซิร์ฟเวอร์รับ", () => {
    const page = render()
    const max: [string, string][] = [["input[id=ce-title]", "300"], ["input[id=ce-titleTh]", "300"], ["textarea[id=ce-recap]", "2000"], ["textarea[id=ce-sourceText]", "200000"], ["textarea[id=ce-translation]", "400000"]]
    for (const [selector, value] of max) assert.equal(one(page, selector).attrs.maxlength, value, selector)
  })
  test("โทนชิปตามสถานะ", () => {
    const tone = (status: AdminChapterDto["status"]) => one(render({ chapter: chapter({ status }) }), "span[class=ad-pill]").attrs["data-tone"]
    assert.deepEqual((["draft", "queued", "translating", "done", "error"] as const).map(tone), ["idle", "warn", "live", "ok", "fail"])
  })
})

