import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { AdminNovelDto } from "./types"
import {
  addTags,
  aiFillNotice,
  applyAiFill,
  canAiFill,
  changedFields,
  cleanTag,
  countsText,
  deleteMessage,
  draftFromNovel,
  emptyDraft,
  firstInvalidId,
  inputFromDraft,
  isDirty,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MODE_HINT,
  MODE_TEXT,
  mergeTags,
  novelTitles,
  removeTag,
  settleAfterSave,
  STATUS_TEXT,
  STYLE_EXAMPLE,
  undoAiFill,
  validateDraft,
  type NovelDraft,
} from "./novel-logic"

const novel = (over: Partial<AdminNovelDto> = {}): AdminNovelDto => ({
  id: 7,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Mei Lan",
  synopsis: "เรื่องย่อไทย",
  synopsisSrc: "Source synopsis",
  tags: ["ผจญภัย", "แฟนตาซี"],
  status: "completed",
  sourceUrl: "https://example.com/n/1",
  licenseNote: "ได้รับอนุญาตทางอีเมล",
  styleNote: "ใช้ข้า/เจ้า",
  mode: "story",
  published: true,
  featured: true,
  hasCover: true,
  coverV: 1700000000,
  chapterCount: 90,
  translatedCount: 87,
  publishedCount: 80,
  createdAt: "2026-10-01 00:00:00",
  updatedAt: "2026-10-02 00:00:00",
  ...over,
})

const draft = (over: Partial<NovelDraft> = {}): NovelDraft => ({ ...draftFromNovel(novel()), ...over })

describe("ร่างข้อมูลของฟอร์ม", () => {
  test("เรื่องใหม่: ว่างทุกช่อง · กำลังอัปเดต · แปลตรง · ยังไม่เผยแพร่ · ไม่แนะนำ", () => {
    assert.deepEqual(emptyDraft(), {
      title: "",
      titleTh: "",
      author: "",
      synopsisSrc: "",
      synopsis: "",
      tags: [],
      status: "ongoing",
      sourceUrl: "",
      licenseNote: "",
      styleNote: "",
      mode: "translate",
      published: false,
      featured: false,
    })
  })

  test("emptyDraft คืนออบเจ็กต์ใหม่ทุกครั้ง (แก้อันหนึ่งไม่กระทบอันอื่น)", () => {
    const a = emptyDraft()
    a.tags.push("x")
    assert.deepEqual(emptyDraft().tags, [])
  })

  test("draftFromNovel: ถอดเฉพาะช่องที่แก้ได้ (ไม่เอา id ปก จำนวนตอน เวลา) และคัดลอกแท็ก", () => {
    const n = novel()
    const d = draftFromNovel(n)
    assert.deepEqual(Object.keys(d).sort(), Object.keys(emptyDraft()).sort())
    assert.equal(d.title, "The Last Lantern")
    assert.equal(d.titleTh, "ตะเกียงดวงสุดท้าย")
    assert.equal(d.status, "completed")
    assert.equal(d.mode, "story")
    assert.equal(d.published, true)
    assert.equal(d.featured, true)
    assert.deepEqual(d.tags, ["ผจญภัย", "แฟนตาซี"])
    d.tags.push("ใหม่")
    assert.deepEqual(n.tags, ["ผจญภัย", "แฟนตาซี"], "แก้ร่างต้องไม่ย้อนไปแก้ข้อมูลเดิม")
  })

  test("inputFromDraft: ส่งครบทุกช่องตามที่กรอก (เซิร์ฟเวอร์เป็นผู้ล้างข้อความ)", () => {
    const d = draft({ title: "  X  ", tags: ["a", "b"] })
    const input = inputFromDraft(d)
    assert.deepEqual(Object.keys(input).sort(), Object.keys(emptyDraft()).sort())
    assert.equal(input.title, "  X  ")
    assert.deepEqual(input.tags, ["a", "b"])
    assert.notEqual(input.tags, d.tags)
  })

  test("changedFields: ส่งเฉพาะช่องที่เปลี่ยน · ไม่เปลี่ยน → ว่าง · isDirty ตรงกัน", () => {
    const saved = draft()
    assert.deepEqual(changedFields(saved, { ...saved }), {})
    assert.equal(isDirty(saved, { ...saved }), false)
    const next = { ...saved, author: "ใหม่", published: false, mode: "translate" as const }
    assert.deepEqual(changedFields(saved, next), { author: "ใหม่", published: false, mode: "translate" })
    assert.equal(isDirty(saved, next), true)
  })

  test("changedFields: แท็กเทียบตามค่าและลำดับ (สลับลำดับ = เปลี่ยน · อาร์เรย์ใหม่ค่าเดิม = ไม่เปลี่ยน)", () => {
    const saved = draft({ tags: ["a", "b"] })
    assert.deepEqual(changedFields(saved, { ...saved, tags: ["a", "b"] }), {})
    assert.deepEqual(changedFields(saved, { ...saved, tags: ["b", "a"] }), { tags: ["b", "a"] })
    assert.deepEqual(changedFields(saved, { ...saved, tags: ["a"] }), { tags: ["a"] })
    assert.deepEqual(changedFields(saved, { ...saved, tags: ["a", "b", "c"] }), { tags: ["a", "b", "c"] })
  })

  test("changedFields: ทุกช่องตรวจจริง (เปลี่ยนทีละช่องต้องเห็นช่องนั้นช่องเดียว)", () => {
    const saved = draft()
    const edits: Partial<NovelDraft>[] = [
      { title: "t" },
      { titleTh: "t" },
      { author: "t" },
      { synopsisSrc: "t" },
      { synopsis: "t" },
      { tags: ["t"] },
      { status: "ongoing" },
      { sourceUrl: "https://t.example" },
      { licenseNote: "t" },
      { styleNote: "t" },
      { mode: "translate" },
      { published: false },
      { featured: false },
    ]
    for (const edit of edits) assert.deepEqual(changedFields(saved, { ...saved, ...edit }), edit, JSON.stringify(edit))
    assert.equal(edits.length, Object.keys(saved).length)
  })
})

describe("ตรวจฟอร์มก่อนส่ง (ซ้ำกับเซิร์ฟเวอร์เฉพาะที่ผู้ใช้แก้ได้ทันที)", () => {
  test("ชื่อต้นฉบับว่าง (รวมถึงมีแต่ช่องว่าง) → แจ้ง · มีชื่อ → ผ่าน", () => {
    assert.match(validateDraft(draft({ title: "" })).title ?? "", /ชื่อต้นฉบับ/)
    assert.match(validateDraft(draft({ title: "   \n " })).title ?? "", /ชื่อต้นฉบับ/)
    assert.equal(validateDraft(draft({ title: "A" })).title, undefined)
  })

  test("ลิงก์ต้นฉบับ: ว่าง/http/https ผ่าน (ไม่สนตัวพิมพ์และช่องว่างหัวท้าย)", () => {
    for (const url of ["", "  ", "https://example.com/a?b=1", "http://example.com", "HTTPS://EXAMPLE.COM", "  https://example.com  "]) {
      assert.equal(validateDraft(draft({ sourceUrl: url })).sourceUrl, undefined, JSON.stringify(url))
    }
  })

  test("ลิงก์ต้นฉบับ: โปรโตคอลอื่น มีช่องว่างกลาง อ่านไม่ออก หรือยาวเกิน 2000 → แจ้ง", () => {
    for (const url of ["ftp://example.com", "javascript:alert(1)", "data:text/html,x", "example.com", "https://a b.com", "https://", "https://exa\u0000mple.com", `https://example.com/${"a".repeat(2000)}`]) {
      assert.match(validateDraft(draft({ sourceUrl: url })).sourceUrl ?? "", /http/, JSON.stringify(url).slice(0, 40))
    }
  })

  test("ลิงก์ยาว 2000 ตัวพอดีผ่าน", () => {
    const url = `https://example.com/${"a".repeat(2000 - "https://example.com/".length)}`
    assert.equal(url.length, 2000)
    assert.equal(validateDraft(draft({ sourceUrl: url })).sourceUrl, undefined)
  })

  test("ฟอร์มถูกต้องทั้งหมด → ไม่มีข้อผิดพลาดเลย (ออบเจ็กต์ว่าง)", () => {
    assert.deepEqual(validateDraft(draft()), {})
  })
})

describe("แท็ก", () => {
  test("ขีดจำกัดตรงกับเซิร์ฟเวอร์ (12 อัน อันละ 40 ตัวอักษร)", () => {
    assert.equal(MAX_TAGS, 12)
    assert.equal(MAX_TAG_LENGTH, 40)
  })

  test("cleanTag: ตัดช่องว่างหัวท้าย และยุบช่องว่างติดกัน (รวมแท็บ/ขึ้นบรรทัด) เป็นเว้นวรรคเดียว", () => {
    assert.equal(cleanTag("  แฟนตาซี  "), "แฟนตาซี")
    assert.equal(cleanTag("slice \t of \n life"), "slice of life")
    assert.equal(cleanTag("   "), "")
  })

  test("เพิ่มแท็กเดียว: ต่อท้าย ไม่แก้อาร์เรย์เดิม", () => {
    const tags = ["a"]
    const out = addTags(tags, "ผจญภัย")
    assert.deepEqual(out, { tags: ["a", "ผจญภัย"], problem: null })
    assert.deepEqual(tags, ["a"])
    assert.notEqual(out.tags, tags)
  })

  test("ข้อความว่างหรือมีแต่ช่องว่าง/ตัวคั่น → ไม่เพิ่มและไม่ฟ้องว่าผิด", () => {
    for (const raw of ["", "   ", ",", " , ,, "]) assert.deepEqual(addTags(["a"], raw), { tags: ["a"], problem: null }, JSON.stringify(raw))
  })

  test("วางหลายแท็กคั่นด้วยจุลภาค (, ，、) หรือขึ้นบรรทัดใหม่ → เพิ่มทีละอันตามลำดับ", () => {
    assert.deepEqual(addTags([], "a, b ,,c").tags, ["a", "b", "c"])
    assert.deepEqual(addTags([], "ก，ข、ค").tags, ["ก", "ข", "ค"])
    assert.deepEqual(addTags([], "x\ny").tags, ["x", "y"])
  })

  test("ซ้ำ (ไม่สนตัวพิมพ์) ข้ามเงียบๆ ไม่ถือว่าผิด · ซ้ำกันเองในข้อความเดียวกันก็เก็บอันแรก", () => {
    assert.deepEqual(addTags(["Fantasy"], "fantasy"), { tags: ["Fantasy"], problem: null })
    assert.deepEqual(addTags([], "x, X, x"), { tags: ["x"], problem: null })
    assert.deepEqual(addTags(["a"], "a, b").tags, ["a", "b"])
  })

  test("ยาว 40 ตัวผ่าน · 41 ตัวไม่ผ่านและไม่เพิ่มอะไรเลยแม้อันอื่นในข้อความเดียวกันจะดี", () => {
    assert.deepEqual(addTags([], "a".repeat(40)).tags, ["a".repeat(40)])
    const bad = addTags(["x"], `ok, ${"a".repeat(41)}`)
    assert.deepEqual(bad.tags, ["x"])
    assert.match(bad.problem ?? "", /40/)
  })

  test("ครบ 12 อันแล้วเพิ่มไม่ได้ · เพิ่มพอดี 12 ได้ · เพิ่มหลายอันแล้วเกินไม่เพิ่มเลย", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`)
    assert.equal(addTags(eleven, "last").tags.length, 12)
    assert.equal(addTags(eleven, "last").problem, null)
    const twelve = [...eleven, "last"]
    const full = addTags(twelve, "more")
    assert.deepEqual(full.tags, twelve)
    assert.match(full.problem ?? "", /12/)
    const over = addTags(eleven, "p, q")
    assert.deepEqual(over.tags, eleven)
    assert.match(over.problem ?? "", /12/)
    // ซ้ำที่ข้ามไปไม่นับเป็นแท็กใหม่
    assert.equal(addTags(eleven, "last, LAST").tags.length, 12)
    assert.equal(addTags(twelve, "t0").problem, null)
  })

  test("removeTag: เอาออกตามตำแหน่ง ไม่แก้อาร์เรย์เดิม · ตำแหน่งที่ไม่มี → เหมือนเดิม", () => {
    const tags = ["a", "b", "c"]
    assert.deepEqual(removeTag(tags, 1), ["a", "c"])
    assert.deepEqual(removeTag(tags, 0), ["b", "c"])
    assert.deepEqual(removeTag(tags, 2), ["a", "b"])
    assert.deepEqual(removeTag(tags, 3), ["a", "b", "c"])
    assert.deepEqual(removeTag(tags, -1), ["a", "b", "c"])
    assert.deepEqual(tags, ["a", "b", "c"])
  })

  test("mergeTags (แท็กที่ AI แนะนำ): ของเดิมมาก่อน เติมอันใหม่ ไม่ซ้ำ ไม่เกิน 12 ตัดอันยาวเกินและอันว่างทิ้ง", () => {
    assert.deepEqual(mergeTags(["a", "b"], ["B", "c", " d ", "", "x".repeat(41)]), ["a", "b", "c", "d"])
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`)
    assert.deepEqual(mergeTags(ten, ["p", "q", "r"]), [...ten, "p", "q"])
    assert.deepEqual(mergeTags([], []), [])
  })
})

describe("ให้ AI ช่วยกรอก (ยังไม่บันทึก · ย้อนกลับได้)", () => {
  const ai = { titleTh: "ตะเกียงสุดท้าย", synopsis: "เรื่องย่อจาก AI", tags: ["ผจญภัย", "ใหม่"] }

  test("canAiFill: ต้องมีชื่อต้นฉบับ (ที่ไม่ใช่ช่องว่างล้วน)", () => {
    assert.equal(canAiFill(draft({ title: "A" })), true)
    assert.equal(canAiFill(draft({ title: "" })), false)
    assert.equal(canAiFill(draft({ title: "  " })), false)
  })

  test("applyAiFill: เติมชื่อไทยกับเรื่องย่อ เพิ่มแท็กต่อท้ายของเดิม และเก็บค่าเดิมสามช่องนี้ไว้ย้อนกลับ", () => {
    const before = draft({ titleTh: "ของเดิม", synopsis: "เรื่องย่อเดิม", tags: ["ผจญภัย"] })
    const out = applyAiFill(before, ai)
    assert.equal(out.draft.titleTh, "ตะเกียงสุดท้าย")
    assert.equal(out.draft.synopsis, "เรื่องย่อจาก AI")
    assert.deepEqual(out.draft.tags, ["ผจญภัย", "ใหม่"])
    assert.deepEqual(out.undo, { titleTh: "ของเดิม", synopsis: "เรื่องย่อเดิม", tags: ["ผจญภัย"] })
    // ไม่แตะช่องอื่น
    for (const key of ["title", "author", "synopsisSrc", "status", "sourceUrl", "licenseNote", "styleNote", "mode", "published", "featured"] as const) {
      assert.equal(out.draft[key], before[key], key)
    }
  })

  test("applyAiFill: ผลของ AI ว่าง (หรือมีแต่ช่องว่าง) ไม่ลบของที่เจ้าของกรอกไว้", () => {
    const before = draft({ titleTh: "ของเดิม", synopsis: "เรื่องย่อเดิม" })
    const out = applyAiFill(before, { titleTh: "", synopsis: "  \n", tags: [] })
    assert.equal(out.draft.titleTh, "ของเดิม")
    assert.equal(out.draft.synopsis, "เรื่องย่อเดิม")
    assert.deepEqual(out.draft.tags, before.tags)
  })

  test("applyAiFill ไม่แก้ร่างเดิมและไม่แชร์อาร์เรย์แท็ก", () => {
    const before = draft({ tags: ["a"] })
    const out = applyAiFill(before, ai)
    assert.deepEqual(before.tags, ["a"])
    out.undo.tags.push("z")
    assert.deepEqual(before.tags, ["a"])
  })

  test("undoAiFill: คืนเฉพาะสามช่องที่ AI เติม ส่วนที่เจ้าของแก้ต่อช่องอื่นหลังจากนั้นอยู่ครบ", () => {
    const before = draft({ titleTh: "ของเดิม", synopsis: "เรื่องย่อเดิม", tags: ["ผจญภัย"], author: "คนเดิม" })
    const filled = applyAiFill(before, ai)
    const edited = { ...filled.draft, author: "แก้ทีหลัง", styleNote: "ใหม่" }
    const restored = undoAiFill(edited, filled.undo)
    assert.equal(restored.titleTh, "ของเดิม")
    assert.equal(restored.synopsis, "เรื่องย่อเดิม")
    assert.deepEqual(restored.tags, ["ผจญภัย"])
    assert.equal(restored.author, "แก้ทีหลัง")
    assert.equal(restored.styleNote, "ใหม่")
  })

  test("aiFillNotice: บอกว่าเติมอะไรบ้างและย้ำว่ายังไม่บันทึก · ไม่เปลี่ยนอะไร → บอกตรงๆ", () => {
    const before = draft({ titleTh: "", synopsis: "", tags: ["a"] })
    const out = applyAiFill(before, { titleTh: "ชื่อ", synopsis: "ย่อ", tags: ["b", "c"] })
    const text = aiFillNotice(before, out.draft)
    assert.match(text, /ชื่อภาษาไทย/)
    assert.match(text, /เรื่องย่อภาษาไทย/)
    assert.match(text, /แท็ก 2 อัน/)
    assert.match(text, /ยังไม่ได้บันทึก/)
    assert.match(aiFillNotice(before, applyAiFill(before, { titleTh: "ชื่อ", synopsis: "", tags: [] }).draft), /^AI เติมให้แล้ว: ชื่อภาษาไทย — /)
    assert.match(aiFillNotice(before, before), /ไม่ได้เติมอะไรเพิ่ม/)
    // ผลเหมือนที่มีอยู่เป๊ะ = ไม่ได้เติมอะไร
    const same = draft({ titleTh: "ชื่อ", synopsis: "ย่อ", tags: ["b"] })
    assert.match(aiFillNotice(same, applyAiFill(same, { titleTh: "ชื่อ", synopsis: "ย่อ", tags: ["B"] }).draft), /ไม่ได้เติมอะไรเพิ่ม/)
  })
})

describe("ข้อความในรายการ", () => {
  test("ป้ายสถานะและโหมดตาม spec", () => {
    assert.deepEqual(STATUS_TEXT, { ongoing: "กำลังอัปเดต", completed: "จบแล้ว" })
    assert.deepEqual(MODE_TEXT, { translate: "แปลตรง", story: "เล่าเรื่อง" })
  })

  test("novelTitles: มีชื่อไทย → ชื่อไทยเป็นหลัก ชื่อต้นฉบับรอง · ไม่มี (หรือมีแต่ช่องว่าง) → ชื่อต้นฉบับอย่างเดียว", () => {
    assert.deepEqual(novelTitles(novel()), { main: "ตะเกียงดวงสุดท้าย", sub: "The Last Lantern" })
    assert.deepEqual(novelTitles(novel({ titleTh: "" })), { main: "The Last Lantern", sub: "" })
    assert.deepEqual(novelTitles(novel({ titleTh: "  " })), { main: "The Last Lantern", sub: "" })
  })

  test("countsText: แปลแล้ว / ทั้งหมด", () => {
    assert.equal(countsText(novel()), "87 / 90")
    assert.equal(countsText(novel({ translatedCount: 0, chapterCount: 0 })), "0 / 0")
  })

  test("deleteMessage: บอกชื่อ จำนวนตอนที่จะหายไปด้วย (ตอน อภิธาน ปก) และกู้คืนไม่ได้ · ไม่มีตอน → บอกว่ายังไม่มีตอน", () => {
    const text = deleteMessage(novel())
    assert.match(text, /ตะเกียงดวงสุดท้าย/)
    assert.match(text, /90 ตอน/)
    assert.match(text, /อภิธานศัพท์/)
    assert.match(text, /ปก/)
    assert.match(text, /กู้คืนไม่ได้/)
    const empty = deleteMessage(novel({ chapterCount: 0 }))
    assert.match(empty, /ยังไม่มีตอน/)
    assert.doesNotMatch(empty, /0 ตอน/)
    assert.match(empty, /กู้คืนไม่ได้/)
  })

  test("ตัวอย่างสไตล์การแปลมีข้อความ และไม่เกินเพดาน 3000 ตัวอักษรของเซิร์ฟเวอร์", () => {
    assert.ok(STYLE_EXAMPLE.trim().length > 20)
    assert.ok(STYLE_EXAMPLE.length <= 3000)
  })
})

describe("หลังบันทึกสำเร็จ", () => {
  test("settleAfterSave: ช่องที่ไม่ได้แก้ระหว่างรอใช้ค่าที่เซิร์ฟเวอร์ล้างแล้ว (ตัดช่องว่าง ฯลฯ)", () => {
    const submitted = draft({ author: "  ใหม่  ", titleTh: "  ชื่อ  " })
    const server = draft({ author: "ใหม่", titleTh: "ชื่อ" })
    const out = settleAfterSave(submitted, { ...submitted }, server)
    assert.deepEqual(out, server)
    assert.equal(isDirty(server, out), false)
  })

  test("settleAfterSave: ช่องที่เจ้าของพิมพ์เพิ่มระหว่างรอคงของเจ้าของไว้ (ไม่ถูกทับ) และยังนับว่ามีการแก้ไขค้าง", () => {
    const submitted = draft({ author: "ก", synopsis: "เดิม" })
    const server = draft({ author: "ก", synopsis: "เดิม" })
    const current = { ...submitted, author: "ก ข", tags: ["ใหม่"], published: !submitted.published }
    const out = settleAfterSave(submitted, current, server)
    assert.equal(out.author, "ก ข")
    assert.deepEqual(out.tags, ["ใหม่"])
    assert.equal(out.published, !server.published)
    assert.equal(out.synopsis, "เดิม")
    assert.deepEqual(changedFields(server, out), { author: "ก ข", tags: ["ใหม่"], published: !server.published })
  })

  test("settleAfterSave: แท็กที่ไม่ได้แก้ (ค่าเท่ากัน) ใช้ของเซิร์ฟเวอร์ (ผ่านการล้าง/ตัดซ้ำ) และไม่แชร์อาร์เรย์", () => {
    const submitted = draft({ tags: ["a", "A"] })
    const server = draft({ tags: ["a"] })
    const out = settleAfterSave(submitted, { ...submitted, tags: [...submitted.tags] }, server)
    assert.deepEqual(out.tags, ["a"])
    assert.notEqual(out.tags, server.tags)
  })

  test("firstInvalidId: ช่องแรกที่ผิดตามลำดับบนหน้า (ชื่อก่อนลิงก์) · ไม่ผิด → null", () => {
    assert.equal(firstInvalidId({ title: "x", sourceUrl: "y" }), "nf-title")
    assert.equal(firstInvalidId({ sourceUrl: "y" }), "nf-sourceUrl")
    assert.equal(firstInvalidId({}), null)
  })
})

describe("ช่องว่างของเทสต์ที่ mutation sweep พบ (Task 30)", () => {
  const draft = (over: Partial<NovelDraft> = {}): NovelDraft => ({ ...draftFromNovel(novel()), ...over })

  test("ลิงก์ยาวพอดี 2000 ตัวอักษรผ่าน · 2001 ไม่ผ่าน", () => {
    const at = (n: number) => "https://a.co/" + "x".repeat(n - "https://a.co/".length)
    assert.equal(at(2000).length, 2000)
    assert.deepEqual(validateDraft(draft({ sourceUrl: at(2000) })), {})
    assert.equal(typeof validateDraft(draft({ sourceUrl: at(2001) })).sourceUrl, "string")
  })

  test("ลิงก์ที่มีช่องว่าง อักขระควบคุม (0x01, 0x1f, 0x7f) หรือแท็บกลางลิงก์ไม่ผ่าน แม้ new URL จะรับ", () => {
    for (const bad of ["https://a.co/a b", "https://a.co/a\u0001b", "https://a.co/a\u001fb", "https://a.co/a\u007fb", "https://a.co/a\tb", "https://a.co/a\nb"]) {
      assert.equal(typeof validateDraft(draft({ sourceUrl: bad })).sourceUrl, "string", JSON.stringify(bad))
    }
    assert.deepEqual(validateDraft(draft({ sourceUrl: "  https://a.co/ok  " })), {}) // ช่องว่างหัวท้ายถูกตัดก่อนตรวจ
  })

  test("changedFields: มีช่องเดียวที่ต่างก็ถือว่าแก้ (isDirty) และแท็กที่ส่งเป็นสำเนา ไม่ใช่อาเรย์เดียวกับร่าง", () => {
    const saved = draft()
    assert.equal(isDirty(saved, { ...saved, author: "อื่น" }), true)
    assert.equal(isDirty(saved, { ...saved }), false)
    const edited = draft({ tags: ["ใหม่"] })
    const out = changedFields(saved, edited)
    assert.deepEqual(out.tags, ["ใหม่"])
    assert.notEqual(out.tags, edited.tags)
  })

  test("settleAfterSave: แท็กที่เจ้าของแก้ระหว่างรอเป็นสำเนา (แก้ผลลัพธ์ไม่ทะลุไปร่างปัจจุบัน)", () => {
    const submitted = draft({ tags: ["ก"] })
    const current = draft({ tags: ["ก", "ข"] })
    const out = settleAfterSave(submitted, current, draft({ tags: ["ก"] }))
    assert.deepEqual(out.tags, ["ก", "ข"])
    assert.notEqual(out.tags, current.tags)
  })

  test("cleanTag/addTags: อักขระกว้างศูนย์ทั้ง U+200B และ U+FEFF หายไป (ไม่ใช่แค่ตัดหัวท้าย)", () => {
    const zw = String.fromCodePoint(0x200b)
    const bom = String.fromCodePoint(0xfeff)
    assert.equal(cleanTag(`a${zw}b`), "ab")
    assert.equal(cleanTag(`a${bom}b`), "ab")
    assert.deepEqual(addTags([], `x${zw}y${bom}z`).tags, ["xyz"])
  })

  test("mergeTags: แท็กยาว 40 ผ่าน 41 ไม่ผ่าน · AI ส่งซ้ำกันเองในรายการเดียวเก็บอันเดียว (ไม่สนตัวพิมพ์)", () => {
    assert.deepEqual(mergeTags([], ["ก".repeat(MAX_TAG_LENGTH)]), ["ก".repeat(MAX_TAG_LENGTH)])
    assert.deepEqual(mergeTags([], ["ก".repeat(MAX_TAG_LENGTH + 1)]), [])
    assert.deepEqual(mergeTags([], ["Magic", "magic", "MAGIC", "  Magic "]), ["Magic"])
  })

  test("applyAiFill: ชื่อไทยที่ AI ส่งมามีช่องว่างหัวท้ายถูกตัด", () => {
    const out = applyAiFill(draft({ titleTh: "", synopsis: "" }), { titleTh: "  ชื่อใหม่  ", synopsis: "  เรื่องย่อ  ", tags: [] })
    assert.equal(out.draft.titleTh, "ชื่อใหม่")
    assert.equal(out.draft.synopsis, "เรื่องย่อ")
  })

  test("undoAiFill: แท็กที่ย้อนเป็นสำเนา (แก้ภายหลังไม่ทำให้ค่าสำหรับย้อนเปลี่ยน)", () => {
    const undo = { titleTh: "ก", synopsis: "ข", tags: ["ค"] }
    const out = undoAiFill(draft(), undo)
    assert.deepEqual(out.tags, ["ค"])
    assert.notEqual(out.tags, undo.tags)
  })

  test("คำอธิบายโหมด: แต่ละโหมดมีคำอธิบายของตัวเองตามความหมายจริง", () => {
    assert.match(MODE_HINT.translate, /แปลครบทุกประโยค/)
    assert.match(MODE_HINT.story, /เล่าด้วยน้ำเสียงผู้เล่าเรื่อง/)
    assert.notEqual(MODE_HINT.translate, MODE_HINT.story)
  })
})
