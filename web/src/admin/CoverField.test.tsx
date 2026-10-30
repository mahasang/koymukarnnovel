import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, text } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { CoverField, CoverFieldView, pendingCoverSrc, type CoverFieldViewProps } from "./CoverField"

const props = (over: Partial<CoverFieldViewProps> = {}): CoverFieldViewProps => ({
  mode: "edit",
  cover: <div className="cv" />,
  hasPending: false,
  hasSaved: false,
  busy: null,
  error: null,
  onFile: () => {},
  onUpload: () => {},
  onDiscard: () => {},
  onRemove: () => {},
  ...over,
})

const labels = (over: Partial<CoverFieldViewProps>) => all(renderPage(<CoverFieldView {...props(over)} />), "button").map((b) => text(b).trim())

describe("pendingCoverSrc", () => {
  test("ฐานสอง JPEG → data URL ที่แสดงเป็นรูปได้", () => {
    assert.equal(pendingCoverSrc("QUJD"), "data:image/jpeg;base64,QUJD")
  })
})

describe("CoverFieldView: ปุ่มตามสถานะ", () => {
  test("เรื่องที่ยังไม่มีปก (แก้ไข): มีแค่ช่องเลือกรูป ไม่มีปุ่มอื่น", () => {
    assert.deepEqual(labels({}), [])
    const page = renderPage(<CoverFieldView {...props()} />)
    assert.match(text(one(page, "label")), /เลือกรูปปก/)
  })

  test("เรื่องที่มีปกแล้ว (แก้ไข): ช่องเลือกบอกว่า 'เปลี่ยนรูปปก' และมีปุ่ม 'ลบปก'", () => {
    assert.deepEqual(labels({ hasSaved: true }), ["ลบปก"])
    assert.match(text(one(renderPage(<CoverFieldView {...props({ hasSaved: true })} />), "label")), /เปลี่ยนรูปปก/)
  })

  test("เลือกรูปแล้ว (แก้ไข): 'ใช้ปกนี้' กับ 'ยกเลิก' และบอกว่ายังไม่ได้อัปโหลด · ไม่มีปุ่มลบปกระหว่างนี้", () => {
    const page = renderPage(<CoverFieldView {...props({ hasPending: true, hasSaved: true })} />)
    assert.deepEqual(all(page, "button").map((b) => text(b).trim()), ["ใช้ปกนี้", "ยกเลิก"])
    assert.match(text(page), /ยังไม่ได้อัปโหลด/)
  })

  test("เลือกรูปแล้ว (สร้างเรื่องใหม่): บอกว่าจะอัปโหลดตอนสร้างเรื่อง · ปุ่ม 'เอารูปออก' · ไม่มี 'ใช้ปกนี้'", () => {
    const page = renderPage(<CoverFieldView {...props({ mode: "create", hasPending: true })} />)
    assert.deepEqual(all(page, "button").map((b) => text(b).trim()), ["เอารูปออก"])
    assert.match(text(page), /สร้างเรื่อง/)
    assert.doesNotMatch(text(page), /ใช้ปกนี้/)
  })

  test("สร้างเรื่องใหม่ที่ยังไม่เลือกรูป: บอกว่าจะใช้ปกอัตโนมัติจากชื่อเรื่อง", () => {
    assert.match(text(renderPage(<CoverFieldView {...props({ mode: "create" })} />)), /ปกอัตโนมัติ/)
  })

  test("คำอธิบายขนาด: ครอบกึ่งกลาง 2:3 ย่อเป็น 400×600", () => {
    assert.match(text(renderPage(<CoverFieldView {...props()} />)), /2:3.*400×600/)
  })
})

describe("CoverFieldView: ช่องเลือกไฟล์", () => {
  test("รับเฉพาะรูป JPEG/PNG/WebP · ซ่อนจากสายตาแต่โฟกัสด้วยแป้นได้ (sr-only ในป้าย)", () => {
    const input = one(renderPage(<CoverFieldView {...props()} />), "input")
    assert.equal(input.attrs.type, "file")
    assert.equal(input.attrs.accept, "image/jpeg,image/png,image/webp")
    assert.match(input.attrs.class ?? "", /sr-only/)
  })

  test("เลือกไฟล์ → ส่งไฟล์ขึ้นไปและเคลียร์ช่อง (เลือกไฟล์เดิมซ้ำแล้วยังเกิด change)", () => {
    const got: File[] = []
    const label = findTag(CoverFieldView(props({ onFile: (f) => got.push(f) })), "label")
    const el = findAll(label, (e) => e.type === "input")[0]!
    const file = { name: "a.png" } as File
    const target = { files: [file], value: "C:\\fakepath\\a.png" }
    handlerOf(el, "onChange")({ target })
    assert.deepEqual(got, [file])
    assert.equal(target.value, "")
  })

  test("ปิดหน้าต่างเลือกไฟล์โดยไม่เลือก (files ว่าง) → ไม่ทำอะไร", () => {
    let called = 0
    const label = findTag(CoverFieldView(props({ onFile: () => called++ })), "label")
    const el = findAll(label, (e) => e.type === "input")[0]!
    handlerOf(el, "onChange")({ target: { files: [], value: "" } })
    handlerOf(el, "onChange")({ target: { files: null, value: "" } })
    assert.equal(called, 0)
  })

  test("กำลังทำงานอยู่ → ช่องเลือกไฟล์ถูกปิด", () => {
    for (const busy of ["crop", "upload", "delete"] as const) {
      const input = findAll(CoverFieldView(props({ busy })), (e) => e.type === "input")[0]!
      assert.equal(input.props.disabled, true, busy)
    }
    assert.equal(findAll(CoverFieldView(props()), (e) => e.type === "input")[0]!.props.disabled, false)
  })
})

describe("CoverFieldView: การกดปุ่มและสถานะกำลังทำงาน", () => {
  const click = (view: ReturnType<typeof CoverFieldView>, name: string) => handlerOf(findTag(view, "button", (b) => String(b.props.children).includes(name)), "onClick")()

  test("ปุ่มส่งเหตุการณ์ถูกตัว", () => {
    const calls: string[] = []
    const base = { onUpload: () => calls.push("upload"), onDiscard: () => calls.push("discard"), onRemove: () => calls.push("remove") }
    click(CoverFieldView(props({ ...base, hasPending: true })), "ใช้ปกนี้")
    click(CoverFieldView(props({ ...base, hasPending: true })), "ยกเลิก")
    click(CoverFieldView(props({ ...base, hasSaved: true })), "ลบปก")
    click(CoverFieldView(props({ ...base, mode: "create", hasPending: true })), "เอารูปออก")
    assert.deepEqual(calls, ["upload", "discard", "remove", "discard"])
  })

  test("ปุ่มทุกปุ่มเป็น type=button (ไม่ส่งฟอร์มนิยาย)", () => {
    for (const over of [{ hasPending: true }, { hasSaved: true }, { mode: "create", hasPending: true }] as const) {
      for (const b of findAll(CoverFieldView(props(over)), (e) => e.type === "button")) assert.equal(b.props.type, "button")
    }
  })

  test("กำลังอัปโหลด: ปุ่มปิดและขึ้น 'กำลังอัปโหลด…' · กำลังลบ: ขึ้น 'กำลังลบ…' · กำลังย่อรูป: บอกสถานะ", () => {
    const up = renderPage(<CoverFieldView {...props({ hasPending: true, busy: "upload" })} />)
    assert.deepEqual(all(up, "button").map((b) => b.attrs.disabled !== undefined), [true, true])
    assert.match(text(up), /กำลังอัปโหลด…/)
    const del = renderPage(<CoverFieldView {...props({ hasSaved: true, busy: "delete" })} />)
    assert.match(text(one(del, "button")), /กำลังลบ…/)
    assert.equal(one(del, "button").attrs.disabled !== undefined, true)
    assert.match(text(renderPage(<CoverFieldView {...props({ busy: "crop" })} />)), /กำลังย่อรูป…/)
  })

  test("ข้อผิดพลาดแสดงเป็น role=alert · ไม่มีข้อผิดพลาดก็ไม่มีกล่องนี้", () => {
    const page = renderPage(<CoverFieldView {...props({ error: "ไฟล์ปกใหญ่เกิน 500KB" })} />)
    const alert = one(page, "p[role=alert]")
    assert.equal(text(alert), "ไฟล์ปกใหญ่เกิน 500KB")
    assert.equal(all(renderPage(<CoverFieldView {...props()} />), "p[role=alert]").length, 0)
  })
})

describe("CoverFieldView: ป้ายปุ่มเลือกรูปตามสถานะ", () => {
  const pick = (over: Partial<CoverFieldViewProps>) => text(one(renderPage(<CoverFieldView {...props(over)} />), "label"))
  test("มีรูปที่เลือกไว้แล้ว (ยังไม่เคยบันทึก) → 'เปลี่ยนรูปปก' · มีปกบันทึกแล้ว → เหมือนกัน · ไม่มีเลย → 'เลือกรูปปก'", () => {
    assert.match(pick({ hasPending: true, hasSaved: false }), /เปลี่ยนรูปปก/)
    assert.match(pick({ hasPending: false, hasSaved: true }), /เปลี่ยนรูปปก/)
    assert.match(pick({ hasPending: false, hasSaved: false }), /เลือกรูปปก/)
  })

  test("คำอธิบาย 'ไม่เลือกรูป = ใช้ปกอัตโนมัติ' ขึ้นเฉพาะตอนสร้างเรื่อง ไม่ขึ้นตอนแก้ไขเรื่องที่ยังไม่มีปก", () => {
    const edit = text(renderPage(<CoverFieldView {...props({ mode: "edit" })} />))
    const create = text(renderPage(<CoverFieldView {...props({ mode: "create" })} />))
    assert.doesNotMatch(edit, /ไม่เลือกรูป/)
    assert.match(create, /ไม่เลือกรูป/)
  })
})

describe("CoverField (ตัวถือสถานะ): การประกอบค่าเข้ากับส่วนแสดงผลตอนเรนเดอร์ครั้งแรก", () => {
  const noop = () => {}
  const field = (over: Partial<Parameters<typeof CoverField>[0]>) => renderPage(<CoverField novel={null} title="ชื่อ" pending={null} onPending={noop} onSaved={noop} onRemoved={noop} {...over} />)

  test("สร้างเรื่องใหม่ (novel = null): โหมด create (มีคำอธิบายปกอัตโนมัติ) ไม่มีปุ่มลบปก", () => {
    const page = field({})
    assert.match(text(page), /ไม่เลือกรูป/)
    assert.equal(all(page, "button").length, 0)
  })

  test("แก้เรื่องที่มีปก: โหมด edit มีปุ่มลบปก และรูปมีคำอธิบาย 'ปกปัจจุบัน' · เรื่องที่ไม่มีปก → ไม่มีปุ่มลบ และปกอัตโนมัติไม่มีคำอธิบายรูป", () => {
    const withCover = field({ novel: { id: 3, hasCover: true, coverV: 5 } })
    assert.equal(one(withCover, "img").attrs.alt, "ปกปัจจุบัน")
    assert.deepEqual(all(withCover, "button").map((b) => text(b).trim()), ["ลบปก"])
    assert.doesNotMatch(text(withCover), /ไม่เลือกรูป/)
    const without = field({ novel: { id: 3, hasCover: false, coverV: 0 } })
    assert.equal(all(without, "button").length, 0)
    assert.equal(all(without, "img").length, 0)
  })

  test("มีตัวอย่างที่เลือกไว้: โชว์รูปตัวอย่างพร้อมคำอธิบายรูป แทนที่ปกเดิม", () => {
    const page = field({ novel: { id: 3, hasCover: true, coverV: 5 }, pending: "QUJD" })
    const img = one(page, "img")
    assert.equal(img.attrs.alt, "ตัวอย่างปกที่เลือก")
    assert.equal(img.attrs.src, "data:image/jpeg;base64,QUJD")
  })
})
