import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MAX_CHAPTERS, MAX_CHARS, forceSingle, isChapterNumber, parseChapters, revalidate, validateSelection, type ParsedRow } from "./parse-chapters"

const NONE: ReadonlySet<number> = new Set()
const have = (...numbers: number[]): ReadonlySet<number> => new Set(numbers)
const BODY = "Some text."

/** แถวในรูปที่เทียบง่าย (ไม่เอา key/words/text) */
const brief = (rows: readonly ParsedRow[]) => rows.map(({ kind, number, title, checked, issues }) => ({ kind, number, title, checked, issues }))

/** แถวที่ประกอบเอง สำหรับเทสต์ `revalidate`/`validateSelection` */
function row(over: Partial<ParsedRow> = {}): ParsedRow {
  return { key: "k", kind: "chapter", number: 1, title: "", text: "text", words: 1, checked: true, issues: [], ...over }
}

/** n แถวที่ติ๊กแล้ว เลขตอน 1..n ข้อความสั้น ไม่มีปัญหา */
const picked = (n: number) => Array.from({ length: n }, (_, i) => row({ key: `k${i}`, number: i + 1 }))

/**
 * วาง "บรรทัดนี้ + เนื้อหา" ต่อท้ายตอน 1: คืนเลข/ชื่อถ้าบรรทัดนั้นถูกอ่านเป็นหัวข้อ, `null` ถ้าไม่ใช่ (บรรทัดนั้นยังอยู่ในเนื้อหาตอน 1 ครบ ไม่แตกตอน)
 * วางหลังตอน 1 เพื่อให้ย่อหน้านำหน้าบรรทัดยังอยู่ (ถ้าเป็นบรรทัดแรกของที่วาง การล้างข้อความจะตัดช่องว่างหัวทิ้งก่อน)
 */
function headingOf(line: string): { number: number | null; title: string } | null {
  const rows = parseChapters(`Chapter 1: First\nBefore.\n${line}\n${BODY}`, NONE)
  if (rows.length === 1) {
    assert.equal(rows[0].text, `Before.\n${line}\n${BODY}`, line)
    return null
  }
  assert.equal(rows.length, 2, line)
  assert.equal(rows[1].kind, "chapter", line)
  assert.equal(rows[1].text, BODY, line)
  return { number: rows[1].number, title: rows[1].title }
}

/** บรรทัดหัวข้อที่ยาวพอดี `length` ตัวอักษร (ขึ้นต้น `Chapter 9: `) */
const headingOfLength = (length: number) => {
  const head = "Chapter 9: "
  return head + "x".repeat(length - head.length)
}

describe("ค่าคงที่", () => {
  test("ตามสเปก: ไม่เกิน 100 ตอนต่อครั้ง ตอนละไม่เกิน 200,000 ตัวอักษร", () => {
    assert.equal(MAX_CHAPTERS, 100)
    assert.equal(MAX_CHARS, 200_000)
  })
})

describe("parseChapters: หัวข้อที่รู้จัก", () => {
  const RECOGNISED: [line: string, number: number, title: string][] = [
    ["Chapter 1: The Start", 1, "The Start"],
    ["Chapter 2 - Next", 2, "Next"],
    ["CHAPTER 3 – X", 3, "X"],
    ["Ch. 4 | Y", 4, "Y"],
    ["Ch 5. Z", 5, "Z"],
    ["Episode 6: A", 6, "A"],
    ["Ep. 7 — B", 7, "B"],
    ["chapter 8", 8, ""],
  ]

  test("ทุกรูปแบบในสเปก: ได้เลขตอน ชื่อ และเนื้อหา (ไม่รวมบรรทัดหัวข้อ) ติ๊กไว้ ไม่มีปัญหา", () => {
    for (const [line, number, title] of RECOGNISED) {
      const rows = parseChapters(`${line}\n${BODY}`, NONE)
      assert.deepEqual(brief(rows), [{ kind: "chapter", number, title, checked: true, issues: [] }], line)
      assert.equal(rows[0].text, BODY, line)
    }
  })

  test("รูปแบบใกล้เคียง: เลขนำศูนย์, ตอน 0, ไม่เว้นวรรค, ตัวคั่นลอยๆ, ตัวพิมพ์ปนกัน, ย่อหน้านำหน้า, ช่องว่างท้ายบรรทัด", () => {
    const variants: [string, number, string][] = [
      ["chapter 08", 8, ""],
      ["Chapter 007: Seven", 7, "Seven"],
      ["Chapter 0: Prologue", 0, "Prologue"],
      ["Chapter 1:Title", 1, "Title"],
      ["Chapter 1 :Title", 1, "Title"],
      ["Chapter 1:", 1, ""],
      ["Chapter 1 -", 1, ""],
      ["Chapter 1.", 1, ""],
      ["Chapter1: Squashed", 1, "Squashed"],
      ["Ch.5 Five", 5, "Five"],
      ["EP 9: Nine", 9, "Nine"],
      ["ChApTeR 10 - Mixed", 10, "Mixed"],
      ["Episode 11 | Eleven", 11, "Eleven"],
      ["Chapter 1: A - B: C", 1, "A - B: C"],
      ["Chapter 1: was lowercase after a separator", 1, "was lowercase after a separator"],
      ["  Chapter 2: Indented", 2, "Indented"],
      ["\tChapter 3: Tabbed", 3, "Tabbed"],
      ["Chapter 4: Trailing   ", 4, "Trailing"],
      ["Chapter 5:   Spaced   Out  ", 5, "Spaced   Out"],
      ["Chapter 6: Line\u2028Sep", 6, "Line\u2028Sep"],
      ["chapter 8\u3000", 8, ""],
      ["Chapter 9: Nine\u3000", 9, "Nine"],
    ]
    for (const [line, number, title] of variants) {
      assert.deepEqual(headingOf(line), { number, title }, JSON.stringify(line))
    }
  })

  test("ไม่มีตัวคั่น แต่ชื่อขึ้นต้นด้วยตัวพิมพ์ใหญ่ ตัวเลข หรือตัวอักษรที่ไม่ใช่ละติน → ยังเป็นหัวข้อ", () => {
    const bare: [string, number, string][] = [
      ["Ch 5 Zero", 5, "Zero"],
      ["Chapter 7 3rd attempt", 7, "3rd attempt"],
      ["Chapter 7 第一章", 7, "第一章"],
      ["Chapter 7 ตอนแรก", 7, "ตอนแรก"],
      ["Chapter 7 Éclair", 7, "Éclair"],
      ["Chapter 7 первый", 7, "первый"],
      ["Chapter 7 Ωmega", 7, "Ωmega"],
    ]
    for (const [line, number, title] of bare) assert.deepEqual(headingOf(line), { number, title }, line)
  })

  test("ไม่ใช่หัวข้อ: ประโยคทั่วไป, ไม่มีเลขอารบิก, ตัวอักษรติดกับเลข, ชื่อที่ไม่มีตัวคั่นและขึ้นต้นผิดแบบ", () => {
    const notHeadings = [
      "Chapter 3 was the hardest day.",
      "Chapters of life",
      "Chapter",
      "Chapter One: The Start",
      "Chapter IV",
      "Ch. five",
      "Chair 3: Wooden",
      "Episodes 4",
      "He read Chapter 5 again.",
      "See Chapter 5: The Return for details",
      "Chapter 5, the one with the dragon",
      "Chapter 5; the end",
      "Chapter 5 / The End",
      "Chapter 3 was the hardest. Day",
      "Chapter 3 was the hardest Day of 2026",
      "Chapter 7 éclair",
      "Chapter 7 (Part 2)",
      'Chapter 7 "Quoted"',
      "Chapter 7 !",
      "Chapter 1A: Sub",
      "Chapter 5Zero",
      "Chapter 12abc",
      "Chapter -5: Negative",
      "Chapter #5",
    ]
    for (const line of notHeadings) assert.equal(headingOf(line), null, line)
  })

  test("เส้นแบ่งความยาว: บรรทัดหัวข้อยาว 120 ตัวอักษรยังใช่, 121 ไม่ใช่ (ไม่นับช่องว่างนำหน้า/ท้าย)", () => {
    assert.deepEqual(headingOf(headingOfLength(120)), { number: 9, title: "x".repeat(109) })
    assert.equal(headingOf(headingOfLength(121)), null)
    assert.deepEqual(headingOf(`    ${headingOfLength(120)}`), { number: 9, title: "x".repeat(109) })
    assert.equal(headingOf(`    ${headingOfLength(121)}`), null)
    assert.deepEqual(headingOf(`${headingOfLength(120)}      `), { number: 9, title: "x".repeat(109) })
  })

  test("แยกหลายตอน: เนื้อหาของแต่ละตอนคือบรรทัดระหว่างหัวข้อ ตัดหัวท้าย เก็บบรรทัดว่างภายในไว้หนึ่งบรรทัด", () => {
    const rows = parseChapters("Chapter 1: One\nfirst a\n\nfirst b\n\n\nChapter 2: Two\n\nsecond\nChapter 3: Three\nthird", NONE)
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 1, title: "One", checked: true, issues: [] },
      { kind: "chapter", number: 2, title: "Two", checked: true, issues: [] },
      { kind: "chapter", number: 3, title: "Three", checked: true, issues: [] },
    ])
    assert.deepEqual(
      rows.map((r) => r.text),
      ["first a\n\nfirst b", "second", "third"],
    )
  })

  test("บรรทัดที่ไม่ใช่หัวข้อยังอยู่ในเนื้อหาของตอนนั้น ไม่ทำให้ตอนแตก", () => {
    const rows = parseChapters("Chapter 1: A\nline one\nChapter 3 was the hardest day.\nline two", NONE)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].text, "line one\nChapter 3 was the hardest day.\nline two")
  })

  test("เลขที่ไม่ใช่จำนวนเต็มล้วน (12.5, 1.2.3, 5.0) → number เป็น null + bad_number + ไม่ติ๊ก แต่ยังได้ชื่อและเนื้อหา", () => {
    for (const line of ["Chapter 12.5: Interlude", "Chapter 1.2.3: Interlude", "Chapter 5.0: Interlude"]) {
      const rows = parseChapters(`${line}\nBody.`, NONE)
      assert.deepEqual(brief(rows), [{ kind: "chapter", number: null, title: "Interlude", checked: false, issues: ["bad_number"] }], line)
      assert.equal(rows[0].text, "Body.", line)
    }
  })

  test("จุดหลังเลขที่ตามด้วยช่องว่างคือตัวคั่น ไม่ใช่ทศนิยม: `Chapter 12. The Return` → 12 / The Return", () => {
    assert.deepEqual(headingOf("Chapter 12. The Return"), { number: 12, title: "The Return" })
  })

  test("เลขเกินจำนวนเต็มที่แทนได้เป๊ะ → bad_number; ค่าสูงสุดที่ยังแทนได้ผ่าน", () => {
    assert.deepEqual(brief(parseChapters("Chapter 9007199254740991: Max\nx", NONE)), [{ kind: "chapter", number: 9007199254740991, title: "Max", checked: true, issues: [] }])
    assert.deepEqual(brief(parseChapters("Chapter 9007199254740992: Over\nx", NONE)), [{ kind: "chapter", number: null, title: "Over", checked: false, issues: ["bad_number"] }])
    assert.deepEqual(brief(parseChapters("Chapter 99999999999999999999: Huge\nx", NONE)), [{ kind: "chapter", number: null, title: "Huge", checked: false, issues: ["bad_number"] }])
  })
})

describe("parseChapters: ข้อความที่วางมาจากเว็บ (Review Focus 1)", () => {
  const CLEAN = parseChapters("Chapter 1: Title\nFirst line.\n\nSecond para.\nChapter 2 - Next\nBody two", NONE)

  test("BOM + CRLF + NBSP ในหัวข้อและเนื้อหา ถูกจัดการเหมือนข้อความปกติ", () => {
    const messy = "\uFEFFChapter 1:\u00A0Title\r\nFirst\u00A0line.  \r\n\r\n\r\n\r\nSecond\u200B para.\r\nChapter\u00A02 -\u00A0Next\r\nBody two\r\n"
    const rows = parseChapters(messy, NONE)
    assert.deepEqual(brief(rows), brief(CLEAN))
    assert.deepEqual(
      rows.map((r) => [r.text, r.words]),
      [
        ["First line.\n\nSecond para.", 4],
        ["Body two", 2],
      ],
    )
  })

  test("ขึ้นบรรทัดใหม่แบบ \\r ล้วน (Mac เก่า) ก็แยกตอนได้", () => {
    const rows = parseChapters("Chapter 1: A\rbody a\rChapter 2: B\rbody b", NONE)
    assert.deepEqual(
      rows.map((r) => [r.number, r.title, r.text]),
      [
        [1, "A", "body a"],
        [2, "B", "body b"],
      ],
    )
  })

  test("ล้างข้อความทีละขั้น: BOM/ZWSP ถูกลบ · CR/CRLF → LF · NBSP, U+2007, U+202F → ช่องว่าง · ช่องว่าง/แท็บท้ายบรรทัดถูกตัด · บรรทัดว่างติดกันเหลือบรรทัดเดียว · ตัดหัวท้าย", () => {
    const text = (s: string) => forceSingle(s, NONE)[0].text
    assert.equal(text("\uFEFFhello\u200B world\uFEFF"), "hello world")
    assert.equal(text("a\r\nb\rc\nd"), "a\nb\nc\nd")
    assert.equal(text("a\u00A0b\u2007c\u202Fd"), "a b c d")
    assert.equal(text("a \t \nb\t\nc  "), "a\nb\nc")
    assert.equal(text("a\n\n\n\n\nb"), "a\n\nb")
    assert.equal(text("a\n\nb"), "a\n\nb") // เหลือบรรทัดว่างหนึ่งบรรทัด ไม่ใช่ศูนย์
    assert.equal(text("a\n   \n \t \nb"), "a\n\nb") // บรรทัดที่มีแต่ช่องว่างนับเป็นบรรทัดว่าง
    assert.equal(text("  \n\n  lead and trail  \n\n  "), "lead and trail")
    assert.equal(text("a  b"), "a  b") // ช่องว่างกลางบรรทัดไม่แตะ
  })

  test("ช่องว่างยาวมากกลางบรรทัดไม่ทำให้ค้าง (ล้างแบบเวลาเป็นเส้นตรง)", () => {
    const started = performance.now()
    const rows = forceSingle(`a${" ".repeat(30_000)}b\n${"\t".repeat(30_000)}\nc${" ".repeat(30_000)}\nd${"\t".repeat(30_000)}e${"\t ".repeat(15_000)}`, NONE)
    assert.ok(performance.now() - started < 500, `ใช้เวลา ${Math.round(performance.now() - started)} ms`)
    assert.equal(rows[0].text, `a${" ".repeat(30_000)}b\n\nc\nd${"\t".repeat(30_000)}e`)
  })
})

describe("parseChapters: ข้อความก่อนหัวข้อแรก", () => {
  const withPreamble = (preamble: string, existing: ReadonlySet<number> = NONE) => parseChapters(`${preamble}\nChapter 1: A\nbody\nChapter 2: B\nbody`, existing)

  test("สั้นกว่า 500 ตัวอักษร → แถว preamble ไม่ติ๊ก (มักเป็นเมนู/โน้ต) ไม่มีปัญหา ได้เลขถัดไปถ้าเจ้าของอยากติ๊กเอง", () => {
    const rows = withPreamble("Home | Novels | Login")
    assert.deepEqual(brief(rows), [
      { kind: "preamble", number: 3, title: "", checked: false, issues: [] },
      { kind: "chapter", number: 1, title: "A", checked: true, issues: [] },
      { kind: "chapter", number: 2, title: "B", checked: true, issues: [] },
    ])
    assert.equal(rows[0].text, "Home | Novels | Login")
  })

  test("ข้อความก่อนหัวข้อแรกหลายบรรทัดคงบรรทัดและบรรทัดว่างไว้ (ตัดหัวท้าย) ไม่ถูกเชื่อมเป็นบรรทัดเดียว", () => {
    const rows = parseChapters("Line one\nLine two\n\nLine three\nChapter 1: A\nbody", NONE)
    assert.equal(rows[0].text, "Line one\nLine two\n\nLine three")
    assert.equal(rows[0].words, 6)
  })

  test("เส้นแบ่ง 500: 499 ตัวอักษรไม่ติ๊ก, 500 ติ๊ก (วัดหลังล้างและตัดหัวท้าย)", () => {
    assert.equal(withPreamble("x".repeat(499))[0].checked, false)
    assert.equal(withPreamble("x".repeat(500))[0].checked, true)
    assert.equal(withPreamble(`\n\n   ${"x".repeat(499)}   \n\n`)[0].checked, false)
    assert.equal(withPreamble(`\n\n   ${"x".repeat(500)}   \n\n`)[0].checked, true)
  })

  test("ตั้งแต่ 500 ตัวอักษร → นับเป็นตอนที่ไม่มีหัวข้อ ติ๊ก และได้เลข = สูงสุดของ (ที่มีอยู่ + ที่วางมา) + 1", () => {
    const text = "y".repeat(600)
    assert.deepEqual(brief(withPreamble(text)).slice(0, 1), [{ kind: "preamble", number: 3, title: "", checked: true, issues: [] }])
    assert.equal(withPreamble(text, have(10, 4))[0].number, 11) // ที่มีอยู่สูงกว่า
    assert.equal(withPreamble(text, have(1, 2))[0].number, 3) // ที่วางมาสูงกว่า/เท่ากัน
    assert.equal(withPreamble(text, have(0))[0].number, 3)
    assert.equal(withPreamble(text, have(2))[0].text, text)
  })

  test("เลขของแถวนี้ไม่ชนกับตอนที่มีอยู่และที่วางมา แม้เลขที่วางมาไม่เรียง/ข้ามเลข", () => {
    const rows = parseChapters(`${"z".repeat(500)}\nChapter 40: Forty\nx\nChapter 7: Seven\ny`, have(12))
    assert.equal(rows[0].number, 41)
    assert.deepEqual(rows[0].issues, [])
  })

  test("เลขหัวข้อที่ใช้ไม่ได้ (bad_number) ไม่นับเป็นเลขสูงสุด", () => {
    const rows = parseChapters(`${"z".repeat(500)}\nChapter 99999999999999999999: Huge\nx\nChapter 12.5: Half\ny\nChapter 2: Two\nz`, NONE)
    assert.equal(rows[0].number, 3)
  })

  test("ข้อความก่อนหัวข้อที่มีแต่ช่องว่าง/บรรทัดว่าง → ไม่มีแถว preamble", () => {
    for (const lead of ["", "\n\n", "  \t \n   \n"]) {
      const rows = parseChapters(`${lead}Chapter 1: A\nbody`, NONE)
      assert.deepEqual(
        rows.map((r) => r.kind),
        ["chapter"],
        JSON.stringify(lead),
      )
    }
  })
})

describe("parseChapters: ไม่พบหัวข้อ / forceSingle", () => {
  const STORY = "Once upon a time.\n\nThe end."

  test("ไม่พบหัวข้อเลย → แถว single แถวเดียว ติ๊ก ไม่มีชื่อ เลข = สูงสุดที่มี + 1 (ไม่มีเลยคือ 1)", () => {
    const rows = parseChapters(STORY, NONE)
    assert.deepEqual(brief(rows), [{ kind: "single", number: 1, title: "", checked: true, issues: [] }])
    assert.equal(rows[0].text, STORY)
    assert.equal(parseChapters(STORY, have(1, 2, 5))[0].number, 6)
    assert.equal(parseChapters(STORY, have(0))[0].number, 1)
    assert.equal(parseChapters(STORY, have(7))[0].number, 8)
  })

  test("forceSingle ให้ผลแบบเดียวกัน แม้มีหัวข้อ — ข้อความทั้งก้อนรวมบรรทัดหัวข้อเป็นตอนเดียว เลขไม่ขึ้นกับเลขหัวข้อที่วางมา", () => {
    const withHeadings = "Chapter 1: One\nfirst\n\nChapter 9: Nine\nsecond"
    const rows = forceSingle(withHeadings, have(2))
    assert.deepEqual(brief(rows), [{ kind: "single", number: 3, title: "", checked: true, issues: [] }])
    assert.equal(rows[0].text, withHeadings)
    assert.deepEqual(brief(forceSingle(STORY, NONE)), brief(parseChapters(STORY, NONE)))
    assert.equal(forceSingle(STORY, NONE)[0].text, STORY)
  })

  test("บรรทัดที่ดูคล้ายหัวข้อแต่ไม่ใช่ (ไม่มีหัวข้ออื่นเลย) → ทั้งก้อนเป็นตอนเดียว ข้อความครบ", () => {
    const longLine = `Chapter 9: ${"x".repeat(110)}` // 121 ตัวอักษร
    for (const line of ["Chapter 3 was the hardest day.", longLine, "Chapters of life"]) {
      const rows = parseChapters(`${line}\n${BODY}`, NONE)
      assert.deepEqual(brief(rows), [{ kind: "single", number: 1, title: "", checked: true, issues: [] }], line)
      assert.equal(rows[0].text, `${line}\n${BODY}`, line)
    }
  })

  test("ข้อความว่าง/มีแต่ช่องว่างและอักขระล่องหน → ไม่มีแถว", () => {
    for (const blank of ["", " ", "\n\r\n\t", "\uFEFF\u200B\u00A0"]) {
      assert.deepEqual(parseChapters(blank, NONE), [], JSON.stringify(blank))
      assert.deepEqual(forceSingle(blank, NONE), [], JSON.stringify(blank))
    }
  })

  test("ตอนเดียวที่ยาวเกินก็ถูกทำเครื่องหมายและไม่ติ๊ก", () => {
    assert.deepEqual(brief(forceSingle("x".repeat(MAX_CHARS + 1), NONE)), [{ kind: "single", number: 1, title: "", checked: false, issues: ["too_long"] }])
    assert.deepEqual(brief(parseChapters("x".repeat(MAX_CHARS + 1), NONE)), [{ kind: "single", number: 1, title: "", checked: false, issues: ["too_long"] }])
  })
})

describe("parseChapters: เลขซ้ำ ตอนว่าง ตอนยาวเกิน", () => {
  test("เลขซ้ำกับตอนที่มีอยู่ → duplicate และไม่ติ๊ก (ตอนอื่นไม่ถูกลูกหลง)", () => {
    const rows = parseChapters("Chapter 2: B\nbody\nChapter 3: C\nbody", have(2))
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 2, title: "B", checked: false, issues: ["duplicate"] },
      { kind: "chapter", number: 3, title: "C", checked: true, issues: [] },
    ])
  })

  test("ซ้ำกันเองในที่วาง → ตัวหลังถูกทำเครื่องหมาย (ตัวแรกปกติ)", () => {
    const rows = parseChapters("Chapter 5: A\nx\nChapter 5: B\ny\nChapter 5: C\nz", NONE)
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 5, title: "A", checked: true, issues: [] },
      { kind: "chapter", number: 5, title: "B", checked: false, issues: ["duplicate"] },
      { kind: "chapter", number: 5, title: "C", checked: false, issues: ["duplicate"] },
    ])
  })

  test("ซ้ำทั้งกับที่มีอยู่และกันเอง → ทุกแถวถูกทำเครื่องหมาย", () => {
    const rows = parseChapters("Chapter 5: A\nx\nChapter 5: B\ny", have(5))
    assert.deepEqual(
      rows.map((r) => [r.checked, r.issues]),
      [
        [false, ["duplicate"]],
        [false, ["duplicate"]],
      ],
    )
  })

  test("ตอนว่าง (สารบัญที่วางมาด้วย) ไม่แย่งเลข: ตอนจริงที่ตามมาไม่ถูกว่าซ้ำ", () => {
    const rows = parseChapters("Chapter 1: TOC\nChapter 2: TOC\nChapter 1: Real\ntext\nChapter 2: Real Two\ntext two", NONE)
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 1, title: "TOC", checked: false, issues: ["empty"] },
      { kind: "chapter", number: 2, title: "TOC", checked: false, issues: ["empty"] },
      { kind: "chapter", number: 1, title: "Real", checked: true, issues: [] },
      { kind: "chapter", number: 2, title: "Real Two", checked: true, issues: [] },
    ])
  })

  test("ตอนว่างที่ซ้ำกับตอนที่มีอยู่ถูกทำเครื่องหมายทั้งสองอย่าง; ตอนว่างที่ตามหลังตอนจริงเลขเดียวกันก็ซ้ำด้วย", () => {
    assert.deepEqual(brief(parseChapters("Chapter 2: Gone", have(2))), [{ kind: "chapter", number: 2, title: "Gone", checked: false, issues: ["duplicate", "empty"] }])
    assert.deepEqual(brief(parseChapters("Chapter 4: A\ntext\nChapter 4: B", NONE)), [
      { kind: "chapter", number: 4, title: "A", checked: true, issues: [] },
      { kind: "chapter", number: 4, title: "B", checked: false, issues: ["duplicate", "empty"] },
    ])
  })

  test("หัวข้อไม่มีเนื้อหา (ตามด้วยหัวข้อถัดไป, ท้ายข้อความ, หรือมีแต่ช่องว่าง) → empty ไม่ติ๊ก", () => {
    const rows = parseChapters("Chapter 1: A\nChapter 2: B\nbody\nChapter 3: C\n \t \nChapter 4: D", NONE)
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 1, title: "A", checked: false, issues: ["empty"] },
      { kind: "chapter", number: 2, title: "B", checked: true, issues: [] },
      { kind: "chapter", number: 3, title: "C", checked: false, issues: ["empty"] },
      { kind: "chapter", number: 4, title: "D", checked: false, issues: ["empty"] },
    ])
    assert.equal(rows[0].text, "")
    assert.equal(rows[0].words, 0)
  })

  test("เนื้อหาเกิน 200,000 ตัวอักษร → too_long ไม่ติ๊ก; พอดี 200,000 ผ่าน", () => {
    const rows = parseChapters(`Chapter 1: Fits\n${"x".repeat(MAX_CHARS)}\nChapter 2: Over\n${"x".repeat(MAX_CHARS + 1)}`, NONE)
    assert.deepEqual(brief(rows), [
      { kind: "chapter", number: 1, title: "Fits", checked: true, issues: [] },
      { kind: "chapter", number: 2, title: "Over", checked: false, issues: ["too_long"] },
    ])
  })

  test("ความยาววัดหลังล้างข้อความ (เหมือนเซิร์ฟเวอร์): CRLF นับเป็น 1 ตัว, ช่องว่างท้าย/ NBSP ท้ายไม่นับ", () => {
    const crlfLines = "x\r\n".repeat(100_000) // ดิบ 300,000 ตัวอักษร → หลังล้าง 199,999
    assert.deepEqual(brief(parseChapters(`Chapter 1: A\n${crlfLines}`, NONE))[0].issues, [])
    assert.deepEqual(brief(parseChapters(`Chapter 1: A\n${"x".repeat(MAX_CHARS)}${"\u00A0".repeat(50)}`, NONE))[0].issues, [])
  })

  test("หลายปัญหาในแถวเดียวเรียง duplicate, bad_number, empty, too_long", () => {
    // ตอนว่างเลขซ้ำ
    assert.deepEqual(parseChapters("Chapter 3: X", have(3))[0].issues, ["duplicate", "empty"])
    // ยาวเกิน + ซ้ำ
    assert.deepEqual(parseChapters(`Chapter 3: X\n${"x".repeat(MAX_CHARS + 1)}`, have(3))[0].issues, ["duplicate", "too_long"])
    // เลขใช้ไม่ได้ + ว่าง
    assert.deepEqual(parseChapters("Chapter 3.5: X", NONE)[0].issues, ["bad_number", "empty"])
    // เลขใช้ไม่ได้ + ยาวเกิน
    assert.deepEqual(parseChapters(`Chapter 3.5: X\n${"x".repeat(MAX_CHARS + 1)}`, NONE)[0].issues, ["bad_number", "too_long"])
  })

  test("ปัญหาครบสามอย่างที่เกิดพร้อมกันได้ (ซ้ำ + ว่าง) ไม่ทำให้ตอนอื่นเสีย และ words นับตามช่องว่าง", () => {
    const rows = parseChapters("Chapter 1: Words\none two  three\nfour\t five\u00A0six\n", NONE)
    assert.equal(rows[0].words, 6)
  })
})

describe("parseChapters: words และ key", () => {
  test("words นับคำที่คั่นด้วยช่องว่าง/แท็บ/ขึ้นบรรทัดใหม่ (ไม่รวมหัวข้อ) ; ตอนว่างได้ 0", () => {
    const rows = parseChapters("Chapter 1: A title with words\none two  three\nfour\t five\n\nsix\nChapter 2: B", NONE)
    assert.deepEqual(
      rows.map((r) => r.words),
      [6, 0],
    )
    assert.equal(forceSingle("single", NONE)[0].words, 1)
    assert.equal(forceSingle("a b", NONE)[0].words, 2)
  })

  test("key ไม่ซ้ำกันในชุดเดียว (แม้เลขตอนซ้ำกัน) และเป็นข้อความไม่ว่าง", () => {
    const rows = parseChapters("pre\nChapter 1: A\nx\nChapter 1: B\ny\nChapter 2: C\nz", NONE)
    assert.equal(rows.length, 4)
    assert.equal(new Set(rows.map((r) => r.key)).size, rows.length)
    for (const r of rows) assert.ok(typeof r.key === "string" && r.key !== "")
  })

  test("key ผูกกับตำแหน่ง: วางข้อความใหม่ที่มีโครงเดียวกัน แถวเดิมได้ key เดิม (ช่องกรอกไม่ถูกสร้างใหม่ระหว่างพิมพ์)", () => {
    const a = parseChapters("Chapter 1: A\nx\nChapter 2: B\ny", NONE)
    const b = parseChapters("Chapter 7: Z\nq\nChapter 8: Y\nr", have(7))
    assert.deepEqual(
      b.map((r) => r.key),
      a.map((r) => r.key),
    )
    assert.equal(forceSingle("a", NONE)[0].key, forceSingle("b", have(4))[0].key)
  })

  test("ไม่แก้ชุดเลขที่มีอยู่ที่ส่งเข้ามา", () => {
    const existing = new Set([1, 2])
    parseChapters(`${"x".repeat(600)}\nChapter 9: A\nbody`, existing)
    forceSingle("body", existing)
    assert.deepEqual([...existing], [1, 2])
  })
})

describe("revalidate", () => {
  const base = () => parseChapters("Chapter 1: A\nx\nChapter 2: B\ny\nChapter 3: C\nz", NONE)

  test("ผลของ parseChapters ผ่าน revalidate แล้วไม่เปลี่ยน (ใช้กฎเดียวกัน)", () => {
    const pastes = [
      "Chapter 1: A\nx\nChapter 1: B\ny\nChapter 2: C",
      `${"p".repeat(700)}\nChapter 4: A\nx\nChapter 4.5: B\ny`,
      "Chapter 1: A\nx\nChapter 2: B\ny",
      "plain story",
      "Chapter 1: Gone",
    ]
    for (const paste of pastes) {
      for (const existing of [NONE, have(1, 4)]) {
        const parsed = parseChapters(paste, existing)
        assert.deepEqual(revalidate(parsed, existing), parsed, paste)
        const single = forceSingle(paste, existing)
        assert.deepEqual(revalidate(single, existing), single, paste)
      }
    }
  })

  test("แก้เลขให้ซ้ำกับตอนก่อนหน้า → แถวนั้น (ตัวหลัง) ได้ duplicate และถูกติ๊กออก; แถวอื่นเหมือนเดิม", () => {
    const rows = base()
    const edited = rows.map((r, i) => (i === 1 ? { ...r, number: 1 } : r))
    const result = revalidate(edited, NONE)
    assert.deepEqual(
      result.map((r) => [r.number, r.checked, r.issues]),
      [
        [1, true, []],
        [1, false, ["duplicate"]],
        [3, true, []],
      ],
    )
  })

  test("แก้เลขของตัวแรกให้ชนตัวหลัง → ตัวหลังถูกทำเครื่องหมาย (ตัวหลังเสมอ) ตัวแรกไม่ถูก", () => {
    const edited = base().map((r, i) => (i === 0 ? { ...r, number: 2 } : r))
    assert.deepEqual(
      revalidate(edited, NONE).map((r) => [r.number, r.checked, r.issues]),
      [
        [2, true, []],
        [2, false, ["duplicate"]],
        [3, true, []],
      ],
    )
  })

  test("แก้เลขให้ซ้ำกับตอนที่มีอยู่ → duplicate + ติ๊กออก", () => {
    const edited = base().map((r, i) => (i === 2 ? { ...r, number: 7 } : r))
    const result = revalidate(edited, have(7))
    assert.deepEqual([result[2].checked, result[2].issues], [false, ["duplicate"]])
    assert.deepEqual([result[0].checked, result[1].checked], [true, true])
  })

  test("ล้างเลข (null) หรือเลขใช้ไม่ได้ → bad_number + ติ๊กออก; ตอน 0 ใช้ได้", () => {
    for (const bad of [null, Number.NaN, -1, 1.5, 2 ** 53, Number.POSITIVE_INFINITY]) {
      const result = revalidate([row({ number: bad })], NONE)
      assert.deepEqual([result[0].checked, result[0].issues], [false, ["bad_number"]], String(bad))
    }
    assert.deepEqual(
      revalidate([row({ number: 0 })], NONE).map((r) => [r.checked, r.issues]),
      [[true, []]],
    )
  })

  test("แก้เลขให้ถูกแล้ว → issue หายไป แต่ไม่ติ๊กกลับให้เอง (เจ้าของติ๊กเอง)", () => {
    const [duplicate] = parseChapters("Chapter 2: B\nbody", have(2))
    assert.deepEqual([duplicate.checked, duplicate.issues], [false, ["duplicate"]])
    const fixed = revalidate([{ ...duplicate, number: 9 }], have(2))
    assert.deepEqual([fixed[0].checked, fixed[0].issues], [false, []])
    const ticked = revalidate([{ ...fixed[0], checked: true }], have(2))
    assert.deepEqual([ticked[0].checked, ticked[0].issues], [true, []])
  })

  test("ติ๊กออกเฉพาะแถวที่มี issue ใหม่: แถวที่เจ้าของติ๊กเองทั้งที่มี issue เดิมอยู่แล้วไม่ถูกติ๊กออกตอนแก้แถวอื่น", () => {
    const stubborn = row({ key: "a", number: 1, text: "", checked: true, issues: ["empty"] })
    const other = row({ key: "b", number: 2 })
    const result = revalidate([stubborn, other], NONE)
    assert.deepEqual([result[0].checked, result[0].issues], [true, ["empty"]])
    // เกิด issue ใหม่ (ซ้ำกับตอนที่มีอยู่) บนแถวที่มี issue เดิมอยู่แล้ว → ถูกติ๊กออก
    const worse = revalidate([{ ...stubborn, number: 7 }], have(7))
    assert.deepEqual([worse[0].checked, worse[0].issues], [false, ["duplicate", "empty"]])
  })

  test("คำนวณ empty/too_long ใหม่จากข้อความของแถว (เพิ่มและหายไปได้)", () => {
    const grown = revalidate([row({ text: "x".repeat(MAX_CHARS + 1) })], NONE)
    assert.deepEqual([grown[0].checked, grown[0].issues], [false, ["too_long"]])
    const blank = revalidate([row({ text: "  \n " })], NONE)
    assert.deepEqual([blank[0].checked, blank[0].issues], [false, ["empty"]])
    const healed = revalidate([row({ text: "fine", checked: false, issues: ["empty", "too_long"] })], NONE)
    assert.deepEqual([healed[0].checked, healed[0].issues], [false, []])
    assert.deepEqual(revalidate([row({ text: "x".repeat(MAX_CHARS) })], NONE)[0].issues, [])
  })

  test("ตอนว่างไม่แย่งเลข: ตอนว่างก่อนหน้าไม่ทำให้ตอนจริงเลขเดียวกันเป็นซ้ำ", () => {
    const result = revalidate([row({ key: "a", number: 4, text: "" }), row({ key: "b", number: 4, text: "real" })], NONE)
    assert.deepEqual(
      result.map((r) => r.issues),
      [["empty"], []],
    )
  })

  test("คืนแถวใหม่ ไม่แก้ของเดิม และคงฟิลด์อื่น (key, kind, title, text, words) ไว้", () => {
    const rows = Object.freeze(base().map((r) => Object.freeze({ ...r, issues: Object.freeze([...r.issues]) as ParsedRow["issues"] })))
    const result = revalidate(rows as ParsedRow[], have(1))
    assert.notEqual(result, rows)
    assert.deepEqual(
      result.map(({ key, kind, title, text, words }) => ({ key, kind, title, text, words })),
      rows.map(({ key, kind, title, text, words }) => ({ key, kind, title, text, words })),
    )
    assert.deepEqual(rows[0].issues, []) // ของเดิมยังเหมือนเดิม (ไม่ได้ถูกใส่ duplicate)
    assert.equal(rows[0].checked, true)
    assert.deepEqual(result[0].issues, ["duplicate"])
  })

  test("รายการว่าง → ว่าง", () => {
    assert.deepEqual(revalidate([], NONE), [])
  })
})

describe("validateSelection", () => {
  const MSG = {
    tooMany: "เลือกได้ไม่เกิน 100 ตอนต่อครั้ง",
    tooLong: "มีตอนที่ยาวเกิน 200,000 ตัวอักษร — แยกตอนให้สั้นลงหรือติ๊กออกก่อน",
    duplicate: "มีเลขตอนซ้ำ (ซ้ำกับตอนที่มีอยู่แล้วหรือซ้ำกันเอง) — แก้เลขหรือติ๊กออกก่อน",
    badNumber: "มีตอนที่เลขตอนว่างหรือไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม 0 ขึ้นไป) — ใส่เลขหรือติ๊กออกก่อน",
    empty: "มีตอนที่ไม่มีเนื้อหา — ติ๊กออกก่อน",
    tooBig: "ข้อความรวมของตอนที่เลือกเกิน 7.5MB — ติ๊กออกบางตอนแล้วเพิ่มเป็นหลายครั้ง",
  } as const

  test("ไม่มีปัญหา → error เป็น null และ count = จำนวนที่ติ๊ก (แถวที่ไม่ติ๊กไม่นับ)", () => {
    const rows = [...picked(3), row({ key: "off", number: 9, checked: false })]
    assert.deepEqual(validateSelection(rows), { count: 3, error: null })
  })

  test("ไม่ติ๊กเลย → count 0 ไม่มี error (หน้าเป็นคนปิดปุ่มเอง); ไม่มีแถว → เหมือนกัน", () => {
    assert.deepEqual(validateSelection([row({ checked: false })]), { count: 0, error: null })
    assert.deepEqual(validateSelection([]), { count: 0, error: null })
  })

  test("ติ๊ก 101 ตอน → error เลือกได้ไม่เกิน 100 ตอนต่อครั้ง; 100 ตอนพอดีผ่าน", () => {
    assert.deepEqual(validateSelection(picked(101)), { count: 101, error: MSG.tooMany })
    assert.deepEqual(validateSelection(picked(100)), { count: 100, error: null })
  })

  test("ติ๊กออกจนเหลือ 100 ตอนก็ผ่าน (นับเฉพาะที่ติ๊ก)", () => {
    const rows = picked(105).map((r, i) => (i < 5 ? { ...r, checked: false } : r))
    assert.deepEqual(validateSelection(rows), { count: 100, error: null })
  })

  test("ตอนยาวเกิน (ตามป้าย หรือวัดจากข้อความจริง) → error; ที่ไม่ติ๊กไม่นับ", () => {
    assert.equal(validateSelection([row({ issues: ["too_long"] })]).error, MSG.tooLong)
    assert.equal(validateSelection([row({ text: "x".repeat(MAX_CHARS + 1) })]).error, MSG.tooLong)
    assert.equal(validateSelection([row({ text: "x".repeat(MAX_CHARS) })]).error, null)
    assert.equal(validateSelection([row({ issues: ["too_long"], checked: false })]).error, null)
  })

  test("เลขซ้ำที่ติ๊กอยู่ (ตามป้ายซ้ำกับตอนที่มีอยู่ หรือเลขเดียวกันสองแถวที่ติ๊ก) → error; ตัวที่ไม่ติ๊กไม่ทำให้ชน", () => {
    assert.equal(validateSelection([row({ issues: ["duplicate"] })]).error, MSG.duplicate)
    assert.equal(validateSelection([row({ key: "a", number: 4 }), row({ key: "b", number: 4 })]).error, MSG.duplicate)
    assert.equal(validateSelection([row({ key: "a", number: 4 }), row({ key: "b", number: 4, checked: false })]).error, null)
    assert.equal(validateSelection([row({ issues: ["duplicate"], checked: false })]).error, null)
    assert.equal(validateSelection([row({ key: "a", number: 0 }), row({ key: "b", number: 0 })]).error, MSG.duplicate)
  })

  test("ยังไม่มีเลข/เลขใช้ไม่ได้ที่ติ๊กอยู่ → error", () => {
    for (const bad of [null, Number.NaN, -1, 1.5, 2 ** 53]) {
      assert.equal(validateSelection([row({ number: bad })]).error, MSG.badNumber, String(bad))
    }
    assert.equal(validateSelection([row({ number: 3, issues: ["bad_number"] })]).error, MSG.badNumber)
    assert.equal(validateSelection([row({ number: null, checked: false })]).error, null)
    assert.equal(validateSelection([row({ number: 0 })]).error, null)
  })

  test("ตอนว่างที่ติ๊กอยู่ → error (เซิร์ฟเวอร์ไม่รับต้นฉบับว่าง)", () => {
    assert.equal(validateSelection([row({ text: "" })]).error, MSG.empty)
    assert.equal(validateSelection([row({ text: " \n\t " })]).error, MSG.empty)
    assert.equal(validateSelection([row({ issues: ["empty"] })]).error, MSG.empty)
    assert.equal(validateSelection([row({ text: "", checked: false })]).error, null)
  })

  test("ลำดับความสำคัญของข้อความ: เกินจำนวนตอน → ยาวเกิน → เลขซ้ำ → ไม่มีเลข → ว่าง → รวมเกิน 7.5MB", () => {
    const broken = (issues: ParsedRow["issues"], over: Partial<ParsedRow> = {}) => row({ issues, number: null, text: "", ...over })
    assert.equal(validateSelection([...picked(101).slice(1), broken(["too_long"]), row({ key: "z", number: 1000 })]).error, MSG.tooMany)
    assert.equal(validateSelection([broken(["too_long", "duplicate", "bad_number", "empty"])]).error, MSG.tooLong)
    assert.equal(validateSelection([broken(["duplicate"])]).error, MSG.duplicate) // ยังมีเลขว่าง/ไม่มีเนื้อหาด้วย แต่ซ้ำสำคัญกว่า
    assert.equal(validateSelection([broken([])]).error, MSG.badNumber) // ไม่มีเลข + ไม่มีเนื้อหา → เลขสำคัญกว่า
    assert.equal(validateSelection([broken([], { number: 1 })]).error, MSG.empty)
    // รวมเกินอย่างเดียว
    const fat = Array.from({ length: 38 }, (_, i) => row({ key: `f${i}`, number: i + 1, text: "x".repeat(MAX_CHARS) }))
    assert.equal(validateSelection(fat).error, MSG.tooBig)
    // รวมเกิน + ปัญหารายแถว → รายแถวมาก่อน
    assert.equal(validateSelection([...fat, row({ key: "e", number: 99, text: "" })]).error, MSG.empty)
    assert.equal(validateSelection([...fat, row({ key: "d", number: 1 })]).error, MSG.duplicate)
  })

  test("(Review Focus 3) ตอนละไม่เกิน 200,000 แต่รวม 7,600,000 ตัวอักษร → error ที่มี 7.5MB", () => {
    const rows = Array.from({ length: 38 }, (_, i) => row({ key: `f${i}`, number: i + 1, text: "x".repeat(MAX_CHARS) }))
    const { count, error } = validateSelection(rows)
    assert.equal(count, 38)
    assert.equal(error, MSG.tooBig)
    assert.ok(error?.includes("7.5MB"))
  })

  test("เส้นแบ่งรวม 7.5MB = 7,500,000 ไบต์: พอดีผ่าน, เกิน 1 ไบต์ไม่ผ่าน; นับเฉพาะที่ติ๊ก", () => {
    const block = (i: number, length: number, extra: Partial<ParsedRow> = {}) => row({ key: `b${i}`, number: i + 1, text: "x".repeat(length), ...extra })
    const justFits = [...Array.from({ length: 37 }, (_, i) => block(i, MAX_CHARS)), block(37, 100_000)] // 7,400,000 + 100,000
    assert.equal(validateSelection(justFits).error, null)
    assert.equal(validateSelection([...justFits, block(38, 1)]).error, MSG.tooBig)
    assert.equal(validateSelection([...justFits, block(38, 1_000_000, { checked: false })]).error, null)
  })

  test("วัดเป็นไบต์ UTF-8 (ตรงกับขนาดที่ส่งไปเซิร์ฟเวอร์) ไม่ใช่จำนวนตัวอักษร: ตัวอักษร 2/3/4 ไบต์", () => {
    const rowsOf = (unit: string, unitsPerRow: number, n: number) => Array.from({ length: n }, (_, i) => row({ key: `u${i}`, number: i + 1, text: unit.repeat(unitsPerRow) }))
    // "é" 2 ไบต์: 150,000 ตัวอักษร = 300,000 ไบต์ × 25 = 7,500,000 พอดี → ผ่าน; เพิ่มอีก 1 ไบต์ → ไม่ผ่าน
    const twoByte = rowsOf("é", 150_000, 25)
    assert.equal(validateSelection(twoByte).error, null)
    assert.equal(validateSelection([...twoByte, row({ key: "tail", number: 99, text: "a" })]).error, MSG.tooBig)
    // "ก" 3 ไบต์: 100,000 ตัวอักษร = 300,000 ไบต์ × 26 = 7,800,000 → ไม่ผ่าน (นับตัวอักษรได้แค่ 2,600,000)
    assert.equal(validateSelection(rowsOf("ก", 100_000, 26)).error, MSG.tooBig)
    // "😀" 4 ไบต์ (2 หน่วย UTF-16): 100,000 ตัวอักษร (50,000 อีโมจิ) = 200,000 ไบต์ ; 38 แถว = 7,600,000 ไบต์
    assert.equal(validateSelection(rowsOf("😀", 50_000, 38)).error, MSG.tooBig)
    assert.equal(validateSelection(rowsOf("😀", 50_000, 37)).error, null)
  })

  test("วางเกิน 100 ตอน: แยกครบทุกตอนไม่ตัดทิ้ง (ติ๊กไว้ทั้งหมด) แต่ validateSelection ไม่ให้ส่งจนกว่าจะติ๊กออก", () => {
    const paste = Array.from({ length: 150 }, (_, i) => `Chapter ${i + 1}: T${i + 1}\nbody ${i + 1}`).join("\n")
    const rows = parseChapters(paste, NONE)
    assert.equal(rows.length, 150)
    assert.ok(rows.every((r) => r.checked && r.issues.length === 0))
    assert.deepEqual(validateSelection(rows), { count: 150, error: MSG.tooMany })
    const trimmed = rows.map((r, i) => (i >= 100 ? { ...r, checked: false } : r))
    assert.deepEqual(validateSelection(trimmed), { count: 100, error: null })
  })

  test("ใช้กับผลของ parseChapters จริง: วางตอนใหญ่ 38 ตอนแบบ CRLF → แยกได้ครบ ไม่มีป้าย แต่ติ๊กทั้งหมดไม่ได้", () => {
    const chapter = (n: number) => `Chapter ${n}: Big ${n}\r\n${"y".repeat(MAX_CHARS - 1)}\r\n`
    const paste = Array.from({ length: 38 }, (_, i) => chapter(i + 1)).join("")
    const rows = parseChapters(paste, NONE)
    assert.equal(rows.length, 38)
    assert.ok(rows.every((r) => r.checked && r.issues.length === 0))
    assert.equal(validateSelection(rows).error, MSG.tooBig) // 38 × 199,999 = 7,599,962 ไบต์
    assert.deepEqual(validateSelection(rows.slice(0, 37)), { count: 37, error: null })
  })

  test("ผลของ parseChapters ที่แก้เลขจนซ้ำแล้ว revalidate → ปุ่มต้องถูกปิด (ติ๊กกลับเองแล้วยังมี error)", () => {
    const rows = parseChapters("Chapter 1: A\nx\nChapter 2: B\ny", NONE)
    const edited = revalidate(
      rows.map((r) => ({ ...r, number: 1 })),
      NONE,
    )
    assert.deepEqual(validateSelection(edited), { count: 1, error: null }) // ตัวหลังถูกติ๊กออกแล้ว
    const forced = edited.map((r) => ({ ...r, checked: true }))
    assert.equal(validateSelection(forced).error, MSG.duplicate)
  })
})

describe("ตัวล้างข้อความตรงกับ normalizeText ของเซิร์ฟเวอร์", () => {
  test("ข้อความสุ่ม 4,000 ชุดจากตัวอักษรที่ชวนพัง (BOM, ZWSP, NBSP, CR/LF, แท็บ, U+2028, U+3000) ให้ผลเหมือนกันทุกชุด", async (t) => {
    // ตัวแปร (ไม่ใช่ข้อความตรงๆ): tsc ไม่บังคับว่าต้องมีโฟลเดอร์ server ตอน build เว็บอย่างเดียว; ไม่พบก็ข้ามการเทียบ
    const specifier = "../../../server/src/util/text"
    const server = (await import(specifier).catch(() => null)) as { normalizeText(s: string): string } | null
    if (server === null) {
      t.skip("ไม่พบ server/src/util/text (build เว็บอย่างเดียว) — ข้ามการเทียบกับเซิร์ฟเวอร์")
      return
    }
    let seed = 20261024
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    const alphabet = ["a", "b", "1", " ", " ", "\t", "\n", "\n", "\r", "\r\n", "\u00A0", "\u2007", "\u202F", "\uFEFF", "\u200B", "\u2028", "\u2029", "\u3000", "ก"]
    for (let i = 0; i < 4000; i++) {
      let s = ""
      for (let n = Math.floor(random() * 40); n > 0; n--) s += alphabet[Math.floor(random() * alphabet.length)]
      const web = forceSingle(s, NONE)[0]?.text ?? ""
      assert.equal(web, server.normalizeText(s), JSON.stringify(s))
    }
  })
})

describe("isChapterNumber — เลขตอนที่เซิร์ฟเวอร์รับ (ใช้ร่วมกับหน้าเพิ่มตอน)", () => {
  test("จำนวนเต็มปลอดภัยตั้งแต่ 0 ขึ้นไปเท่านั้น", () => {
    for (const ok of [0, 1, 12, Number.MAX_SAFE_INTEGER]) assert.equal(isChapterNumber(ok), true, String(ok))
    for (const bad of [null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) assert.equal(isChapterNumber(bad), false, String(bad))
  })
})
