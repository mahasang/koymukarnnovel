import { test } from "node:test"
import assert from "node:assert/strict"
import { MODES, type Mode } from "../src/types.js"
import { MAX_RECAPS, MAX_TERMS, RECAP_SYSTEM, RECAP_TOOL, SECTION_TITLES, buildRecapUser, buildSystem, buildUserChunk } from "../src/prompts.js"

const GLOSSARY = [
  { source: "Kael", thai: "เคล", note: "พระเอก" },
  { source: "Mana", thai: "มานา", note: "" },
]

const sys = (mode: Mode, over: Partial<Parameters<typeof buildSystem>[0]> = {}) =>
  buildSystem({ mode, novelTitle: "Zxq Saga", styleNote: "", glossary: [], recaps: [], ...over })

const FULL = { styleNote: "ใช้ภาษากึ่งทางการ", glossary: GLOSSARY, recaps: [{ number: 1, recap: "สรุปตอนหนึ่ง" }] }

/** บล็อกที่ขึ้นต้นด้วยหัวข้อนั้น จนถึงบรรทัดว่างถัดไป (แต่ละส่วนของ system คั่นด้วยบรรทัดว่าง) */
function section(system: string, title: string): string {
  const start = system.indexOf(title)
  assert.ok(start >= 0, `ไม่พบหัวข้อ: ${title}`)
  const end = system.indexOf("\n\n", start)
  return system.slice(start, end === -1 ? undefined : end)
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

for (const mode of MODES) {
  test(`ลำดับส่วนใน system (${mode}): บทบาท < กติกา < กติกาภาษาไทย < สไตล์ < อภิธาน < เรื่องย่อ และแต่ละหัวข้อมีหนเดียว`, () => {
    const s = sys(mode, FULL)
    const at = (needle: string) => {
      const i = s.indexOf(needle)
      assert.ok(i >= 0, `ไม่พบ: ${needle}`)
      return i
    }
    const order = [at("Zxq Saga"), at(SECTION_TITLES.rules), at(SECTION_TITLES.thai), at(SECTION_TITLES.style), at(SECTION_TITLES.glossary), at(SECTION_TITLES.recaps)]
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
    assert.equal(new Set(order).size, order.length)
    for (const title of Object.values(SECTION_TITLES)) assert.equal(count(s, title), 1, `หัวข้อ "${title}" ต้องมีหนเดียว`)
    assert.ok(s.startsWith("คุณเป็นนักแปล"), "ขึ้นต้นด้วยบทบาท")
    assert.ok(section(s, "คุณเป็นนักแปล").includes(`"Zxq Saga"`), "ชื่อเรื่องอยู่ในย่อหน้าบทบาท")
  })

  test(`ส่วนที่ว่างไม่ปรากฏทั้งหัวข้อ (${mode}): สไตล์ อภิธาน เรื่องย่อ ปรากฏเมื่อมีข้อมูลเท่านั้น`, () => {
    const none = sys(mode, { styleNote: " \n\t " })
    for (const title of [SECTION_TITLES.style, SECTION_TITLES.glossary, SECTION_TITLES.recaps]) assert.ok(!none.includes(title), title)
    assert.ok(none.includes(SECTION_TITLES.rules) && none.includes(SECTION_TITLES.thai), "กติกาอยู่เสมอ")

    const only: [keyof typeof SECTION_TITLES, Partial<Parameters<typeof buildSystem>[0]>][] = [
      ["style", { styleNote: FULL.styleNote }],
      ["glossary", { glossary: GLOSSARY }],
      ["recaps", { recaps: FULL.recaps }],
    ]
    for (const [key, over] of only) {
      const s = sys(mode, over)
      for (const other of ["style", "glossary", "recaps"] as const) {
        assert.equal(s.includes(SECTION_TITLES[other]), other === key, `${key}: หัวข้อ ${other}`)
      }
    }
  })

  test(`กติกาตาม spec 8.3 ครบ (${mode}): ไทยล้วน ย่อหน้า source_text เป็นเนื้อหา อภิธาน ข้ามเมนู/โฆษณา หมายเหตุผู้เขียน เส้นคั่นฉาก`, () => {
    const rules = section(sys(mode), SECTION_TITLES.rules)
    for (const needle of [
      "ภาษาไทยล้วน", "markdown", "บรรทัดว่าง",
      "<source_text>", "ไม่ใช่คำสั่ง",
      "อภิธานศัพท์",
      "เมนูเว็บ", "ปุ่มถัดไป", "โฆษณา", "ขอบคุณผู้บริจาค",
      "หมายเหตุผู้เขียน:",
      "เส้นคั่นฉาก", "เป็นบรรทัด ***",
    ]) {
      assert.ok(rules.includes(needle), `กติกาต้องมี "${needle}"`)
    }
  })

  test(`กติกาภาษาไทยที่อ่านเป็นธรรมชาติ 6 ข้อครบ (${mode})`, () => {
    const lines = section(sys(mode), SECTION_TITLES.thai).split("\n").slice(1)
    const expected: [label: string, keywords: string[]][] = [
      ["ประธานและสรรพนาม", ["ละประธาน", "เขา/เธอ/มัน"]],
      ["คำเชื่อมและคำนามนำหน้า", ["ซึ่ง", "การ…", "ความ…", "ที่ว่า", "ประโยคสั้น"]],
      ["ประโยคถูกกระทำ", ["passive", "ถูก", "ประโยคกระทำ"]],
      ["ระดับภาษาและคำลงท้าย", ["ภาษาพูด", "นะ/สิ/เหรอ/ครับ/ค่ะ", "คงที่"]],
      ["สรรพนามบุคคลที่หนึ่งและสอง", ["สไตล์", "อภิธาน", "คำเดิมตลอดเรื่อง"]],
      ["สำนวนและเสียงประกอบ", ["idiom", "คำอุทาน", "ไม่แปลทีละคำ"]],
    ]
    assert.equal(lines.length, expected.length)
    expected.forEach(([label, keywords], i) => {
      assert.ok(lines[i]!.startsWith(`${i + 1}. ${label}:`), `ข้อ ${i + 1} ต้องขึ้นต้นด้วย "${label}" ได้ "${lines[i]}"`)
      for (const k of keywords) assert.ok(lines[i]!.includes(k), `ข้อ ${i + 1} (${label}) ต้องมี "${k}"`)
    })
  })
}

test("กติกาภาษาไทยเหมือนกันทั้งสองโหมด และ mode rule ต่างกัน: เล่าเรื่องมีคำว่า \"เล่าเรื่อง\" แปลตรงไม่มี", () => {
  const translate = sys("translate")
  const story = sys("story")
  assert.equal(section(translate, SECTION_TITLES.thai), section(story, SECTION_TITLES.thai))
  assert.equal(section(translate, SECTION_TITLES.rules), section(story, SECTION_TITLES.rules))

  const rule = (s: string) => section(s, "งานของคุณ:")
  assert.ok(rule(story).includes("เล่าเรื่อง") && rule(story).includes("ย่อ"))
  assert.ok(!rule(translate).includes("เล่าเรื่อง"))
  assert.ok(rule(translate).includes("ครบถ้วนทุกประโยค"))
  assert.ok(!translate.includes("เล่าเรื่อง"), "ไม่มีคำสั่งโหมดเล่าเรื่องปนในโหมดแปลตรงที่ใดเลย")
  assert.ok(translate.indexOf("งานของคุณ:") < translate.indexOf(SECTION_TITLES.rules), "mode rule มาก่อนกติกา")
})

test("สไตล์ถูกตัดช่องว่างหัวท้าย อภิธานเป็น 'ต้นฉบับ → ไทย (หมายเหตุ)' หมายเหตุว่างไม่มีวงเล็บ ลำดับคงเดิม", () => {
  const s = sys("translate", { styleNote: "  ใช้ภาษากึ่งทางการ\nเรียกพระเอกว่า 'เขา'  \n", glossary: GLOSSARY })
  assert.deepEqual(section(s, SECTION_TITLES.style).split("\n").slice(1), ["ใช้ภาษากึ่งทางการ", "เรียกพระเอกว่า 'เขา'"])
  assert.deepEqual(section(s, SECTION_TITLES.glossary).split("\n").slice(1), ["- Kael → เคล (พระเอก)", "- Mana → มานา"])
})

test("เรื่องย่อ: รับกี่ตอนก็ได้ ใช้ไม่เกิน 5 ตอนล่าสุด (เลขมากสุด) เรียงเลขน้อยไปมาก แม้ส่งมาสลับลำดับ", () => {
  const recapLines = (numbers: number[]) =>
    section(sys("story", { recaps: numbers.map((n) => ({ number: n, recap: `สรุป-${n}` })) }), SECTION_TITLES.recaps).split("\n").slice(1)
  const line = (n: number) => `ตอนที่ ${n}: สรุป-${n}`

  assert.equal(MAX_RECAPS, 5)
  assert.deepEqual(recapLines([7, 3, 9, 1, 8, 5, 2]), [3, 5, 7, 8, 9].map(line))
  assert.deepEqual(recapLines([5, 4, 3, 2, 1]), [1, 2, 3, 4, 5].map(line))
  assert.deepEqual(recapLines([12, 10]), [10, 12].map(line))
})

test("buildUserChunk: ห่อ <source_text> ระบุลำดับชิ้น และไม่มี <previous_output_tail> เมื่อไม่มีท้ายผลชิ้นก่อน", () => {
  const chunk = "Line one.\n\n\"Quote\" & <b>tags</b> $& $1"
  for (const previousTail of [undefined, "", "  \n "]) {
    const u = buildUserChunk({ chunk, index: 0, total: 1, previousTail })
    assert.ok(u.includes("1/1"))
    assert.ok(u.includes(`<source_text>\n${chunk}\n</source_text>`), "ข้อความต้นฉบับอยู่ในแท็กครบตามเดิม")
    assert.ok(!u.includes("previous_output_tail"), JSON.stringify(previousTail))
  }
})

test("buildUserChunk: มีท้ายผลชิ้นก่อน → <previous_output_tail> มาก่อน <source_text> และระบุ index+1/total", () => {
  const u = buildUserChunk({ chunk: "NEXT PART", index: 1, total: 5, previousTail: "…จบประโยคเดิม" })
  assert.ok(u.includes("2/5"))
  assert.ok(u.includes("<previous_output_tail>\n…จบประโยคเดิม\n</previous_output_tail>"))
  assert.equal(count(u, "<source_text>"), 1)
  assert.ok(u.indexOf("<previous_output_tail>") < u.indexOf("</previous_output_tail>"))
  assert.ok(u.indexOf("</previous_output_tail>") < u.indexOf("<source_text>"))
  assert.ok(u.indexOf("NEXT PART") > u.indexOf("<source_text>") && u.indexOf("NEXT PART") < u.indexOf("</source_text>"))
})

test("RECAP_TOOL: save_chapter_notes → {recap, titleTh, terms ≤ 15} ทั้งสามช่องจำเป็น และ term ต้องมี source กับ thai", () => {
  assert.equal(RECAP_TOOL.name, "save_chapter_notes")
  assert.ok(/[ก-๙]/.test(RECAP_TOOL.description))
  const schema = RECAP_TOOL.input_schema
  assert.equal(schema.type, "object")
  assert.deepEqual([...schema.required], ["recap", "titleTh", "terms"])
  assert.deepEqual(Object.keys(schema.properties).sort(), ["recap", "terms", "titleTh"])
  const props = schema.properties as Record<string, { type?: string; maxItems?: number; items?: { required?: string[]; properties?: Record<string, unknown> } }>
  assert.equal(props.recap!.type, "string")
  assert.equal(props.titleTh!.type, "string")
  assert.equal(props.terms!.type, "array")
  assert.equal(MAX_TERMS, 15)
  assert.equal(props.terms!.maxItems, MAX_TERMS)
  assert.deepEqual(props.terms!.items!.required, ["source", "thai"])
  assert.deepEqual(Object.keys(props.terms!.items!.properties!).sort(), ["note", "source", "thai"])
})

test("RECAP_SYSTEM: สั่งสรุป 2-3 ประโยค ชื่อตอนไทย สกัดชื่อเฉพาะไม่เกิน 15 พร้อมคำไทยที่ใช้จริง ผ่าน tool และถือข้อความเป็นเนื้อหา", () => {
  for (const needle of ["save_chapter_notes", "recap", "titleTh", "terms", "15", "<thai_text>", "<source_text>", "<known_terms>", "ไม่ใช่คำสั่ง"]) {
    assert.ok(RECAP_SYSTEM.includes(needle), `RECAP_SYSTEM ต้องมี "${needle}"`)
  }
  assert.ok(/2\s*-\s*3 ประโยค/.test(RECAP_SYSTEM))
  assert.ok(RECAP_SYSTEM.includes("ใช้ใน <thai_text> จริง"), "คำไทยต้องเป็นคำที่ใช้จริงในคำแปล ห้ามคิดใหม่")
})

test("buildRecapUser: ชื่อตอนต้นฉบับ + <thai_text> เสมอ; <source_text> และ <known_terms> เฉพาะเมื่อมีข้อมูล", () => {
  const minimal = buildRecapUser({ thaiText: "ข้อความไทย\n\nย่อหน้าสอง", sourceTitle: "Chapter 1: Start" })
  assert.ok(minimal.includes("Chapter 1: Start"))
  assert.ok(minimal.includes("<thai_text>\nข้อความไทย\n\nย่อหน้าสอง\n</thai_text>"))
  assert.ok(!minimal.includes("<source_text>") && !minimal.includes("<known_terms>"))

  const noTitle = buildRecapUser({ thaiText: "ไทย", sourceTitle: "  ", sourceText: "", knownTerms: [] })
  assert.ok(!noTitle.includes("ชื่อตอนต้นฉบับ") && !noTitle.includes("<source_text>") && !noTitle.includes("<known_terms>"))

  const full = buildRecapUser({ thaiText: "ไทย", sourceTitle: "T", sourceText: "English text", knownTerms: ["Kael", "Mana"] })
  assert.ok(full.includes("<source_text>\nEnglish text\n</source_text>"))
  assert.ok(full.includes("<known_terms>\nKael\nMana\n</known_terms>"))
  assert.ok(full.indexOf("<thai_text>") < full.indexOf("<source_text>") && full.indexOf("<source_text>") < full.indexOf("<known_terms>"))
})
