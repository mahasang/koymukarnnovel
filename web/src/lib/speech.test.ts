import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { buildQueue, isThaiVoice, pickThaiVoice, splitForSpeech } from "./speech"

/**
 * แบ่งข้อความเป็นท่อนสั้นสำหรับเสียงอ่าน (บางเบราว์เซอร์อ่านยาวๆ ไม่ได้/หยุดกลางทาง) — Review Focus 5
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ ย่อหน้าหนึ่งอาจยาวพันตัวอักษรโดยไม่มีช่องว่างเลย → ต้องตัดที่ขอบเขตคำ ไม่ใช่กลางคำ
 * สัญญา: ทุกท่อน ≤ max · ท่อนต่อกันเท่าต้นฉบับทุกตัวอักษร (ท่อนที่มีแต่ช่องว่างถูกทิ้ง) · ตัดที่ประโยค → ช่องว่าง → คำ → ตัดแข็ง ตามลำดับ
 */

const WORDS = new Intl.Segmenter("th", { granularity: "word" })
const THAI_SENTENCE = "ฉันเดินไปที่ตลาดเพื่อซื้อผักและผลไม้สดใหม่สำหรับมื้อเย็นวันนี้"

const repeatTo = (unit: string, minLength: number): string => {
  let out = ""
  while (out.length < minLength) out += unit
  return out
}
/** ตำแหน่ง (ดัชนีในต้นฉบับ) ที่รอยตัดระหว่างท่ออยู่ */
const cutsOf = (chunks: string[]): number[] => {
  let at = 0
  return chunks.slice(0, -1).map((chunk) => (at += chunk.length))
}
const wordBoundaries = (text: string): Set<number> => new Set([...WORDS.segment(text)].map((s) => s.index).concat(text.length))
const longest = (chunks: string[]): number => Math.max(...chunks.map((chunk) => chunk.length))

describe("splitForSpeech — ภาษาไทยไม่มีช่องว่าง (Review Focus 5)", () => {
  const text = repeatTo(THAI_SENTENCE, 1000)
  const chunks = splitForSpeech(text)

  test("ข้อมูลทดสอบเป็นอย่างที่ตั้งใจ: ยาวพันตัวอักษร ไม่มีช่องว่าง และ Segmenter หาขอบเขตคำได้หลายสิบจุด", () => {
    assert.ok(text.length >= 1000)
    assert.ok(!/\s/.test(text))
    assert.ok(wordBoundaries(text).size > 100)
  })

  test("ทุกท่อน ≤ 180 และต่อกันได้ข้อความเดิมทุกตัวอักษร", () => {
    assert.ok(chunks.length >= 6)
    assert.ok(longest(chunks) <= 180)
    assert.equal(chunks.join(""), text)
  })

  test("ทุกรอยตัดตรงขอบเขตคำของ Intl.Segmenter('th', word) ไม่ตัดกลางคำ", () => {
    const boundaries = wordBoundaries(text)
    for (const cut of cutsOf(chunks)) assert.ok(boundaries.has(cut), `ตัดกลางคำที่ ${cut}: …${text.slice(cut - 6, cut)}|${text.slice(cut, cut + 6)}…`)
  })

  test("สะสมจนใกล้ max: ท่อนที่ไม่ใช่ท่อนสุดท้ายยาวเกือบเต็ม (ไม่ตัดสั้นๆ ทุกคำ)", () => {
    for (const chunk of chunks.slice(0, -1)) assert.ok(chunk.length >= 150, `ท่อนสั้นไป ${chunk.length}`)
  })

  test("max อื่นก็ได้ผลเหมือนกัน (40 และ 25)", () => {
    for (const max of [40, 25]) {
      const parts = splitForSpeech(text, max)
      assert.ok(longest(parts) <= max, `max ${max}`)
      assert.equal(parts.join(""), text)
      const boundaries = wordBoundaries(text)
      for (const cut of cutsOf(parts)) assert.ok(boundaries.has(cut), `max ${max}: ตัดกลางคำที่ ${cut}`)
    }
  })

  test("ย่อหน้ายาวมาก (สองหมื่นตัวอักษร) ยังได้ผลเดียวกัน", () => {
    const big = repeatTo(THAI_SENTENCE, 20_000)
    const parts = splitForSpeech(big)
    assert.ok(longest(parts) <= 180)
    assert.equal(parts.join(""), big)
  })

  test("สั้นพอในท่อนเดียว → ท่อนเดียวเท่าต้นฉบับ; ยาวเกิน max หนึ่งตัว → สองท่อน", () => {
    const exactly = repeatTo(THAI_SENTENCE, 180).slice(0, 180)
    // ตัดตรง 180 อาจตกกลางคำ ใช้ max ที่เท่าความยาวจริงของข้อความแทน
    assert.deepEqual(splitForSpeech(THAI_SENTENCE), [THAI_SENTENCE])
    assert.deepEqual(splitForSpeech(exactly, exactly.length), [exactly])
    assert.equal(splitForSpeech(exactly, exactly.length - 1).length, 2)
  })
})

describe("splitForSpeech — ภาษาอังกฤษและข้อความที่มีช่องว่าง", () => {
  const VOCAB = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]
  const noPunctuation = Array.from({ length: 90 }, (_, i) => VOCAB[i % VOCAB.length]).join(" ")

  test("ตัดที่ช่องว่าง ไม่ตัดกลางคำ · ท่อน ≤ 180 · ต่อกันได้ต้นฉบับ · ท่อนไม่สุดท้ายยาวเกือบเต็ม", () => {
    const chunks = splitForSpeech(noPunctuation)
    assert.ok(chunks.length >= 3)
    assert.ok(longest(chunks) <= 180)
    assert.equal(chunks.join(""), noPunctuation)
    for (const chunk of chunks.slice(0, -1)) {
      assert.match(chunk, /\s$/)
      assert.ok(chunk.length >= 180 - 8, `ท่อนสั้นไป ${chunk.length}`)
    }
    for (const word of chunks.flatMap((chunk) => chunk.split(/\s+/)).filter(Boolean)) assert.ok(VOCAB.includes(word), `คำถูกตัด: ${word}`)
  })

  test("ตัดที่จบประโยค (. ! ?) ก่อน และสะสมหลายประโยคต่อท่อนจนใกล้ max", () => {
    const sentence = (end: string) => `abcdefghi abcdefghi abcdefghi abcdefghi${end}` // ยาว 40
    const text = ["!", ".", "?", ".", "!", ".", "?", "."].map(sentence).join(" ")
    const chunks = splitForSpeech(text)
    assert.equal(chunks.length, 2)
    assert.equal(chunks.join(""), text)
    for (const chunk of chunks) assert.match(chunk.trimEnd(), /[.!?]$/)
    assert.equal(chunks[0].length, 164) // 4 ประโยค (ประโยคที่ 5 จะเกิน 180)
  })

  test("ตัวจบประโยคแบบเอเชีย (。！？) ตัดได้โดยไม่ต้องมีช่องว่างตามหลัง", () => {
    const text = ["。", "！", "？"].map((end) => `あ`.repeat(100) + end).join("")
    const chunks = splitForSpeech(text)
    assert.equal(chunks.length, 3)
    assert.equal(chunks.join(""), text)
    for (const chunk of chunks) assert.match(chunk, /[。！？]$/)
  })

  test("จุดกลางตัวเลข/ตัวย่อ (3.14) ไม่ใช่จบประโยค — ต้องมีช่องว่างหรือจบข้อความตามหลัง", () => {
    const text = `${"word ".repeat(19)}3.14 ${"word ".repeat(30)}`
    const chunks = splitForSpeech(text)
    assert.equal(chunks.join(""), text)
    assert.doesNotMatch(chunks[0], /3\.$/)
    assert.ok(chunks[0].length > 150)
  })

  test("เครื่องหมายคำพูด/วงเล็บปิดหลังจุดอยู่ท่อนเดียวกับประโยคนั้น", () => {
    const chunks = splitForSpeech('He said "Stop." Then he left the room quickly.', 20)
    assert.equal(chunks[0], 'He said "Stop." ')
    assert.equal(chunks.join(""), 'He said "Stop." Then he left the room quickly.')
    assert.ok(longest(chunks) <= 20)
  })

  test("ไทยที่เว้นวรรคระหว่างวลี ตัดที่ช่องว่างก่อน (ไม่ผ่าครึ่งวลี)", () => {
    const phrases = ["สวัสดีครับทุกคน", "วันนี้อากาศดีมาก", "ผมเดินไปตลาดกับพี่ชาย", "ซื้อผักและผลไม้", "แล้วกลับบ้านทันที"]
    const text = Array.from({ length: 40 }, (_, i) => phrases[i % phrases.length]).join(" ")
    const chunks = splitForSpeech(text)
    assert.ok(chunks.length >= 3)
    assert.ok(longest(chunks) <= 180)
    assert.equal(chunks.join(""), text)
    for (const chunk of chunks.slice(0, -1)) assert.match(chunk, / $/)
    for (const phrase of chunks.flatMap((chunk) => chunk.split(" ")).filter(Boolean)) assert.ok(phrases.includes(phrase), `วลีถูกผ่า: ${phrase}`)
  })

  test("ขึ้นบรรทัดใหม่ในย่อหน้านับเป็นช่องว่าง (ตัดตรงนั้นได้)", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n")
    const chunks = splitForSpeech(text, 60)
    assert.equal(chunks.join(""), text)
    assert.ok(longest(chunks) <= 60)
    for (const chunk of chunks.slice(0, -1)) assert.match(chunk, /\n$/)
  })

  test("คำเดียวที่ยาวเกิน max และไม่มีช่องว่าง (ตัวอักษรละติน 500 ตัว) → ตัดแข็งที่ max", () => {
    const chunks = splitForSpeech("a".repeat(500))
    assert.deepEqual(
      chunks.map((chunk) => chunk.length),
      [180, 180, 140],
    )
  })

  test("ท่อนก่อนหน้าไม่ถูกทิ้งเมื่อประโยคถัดไปยาวเกิน max: ประโยคสั้นแยกท่อน แล้วประโยคยาวถูกแบ่งต่อ", () => {
    const long = Array.from({ length: 50 }, () => "word").join(" ")
    const text = `Hi there. ${long}.`
    const chunks = splitForSpeech(text)
    assert.equal(chunks[0], "Hi there. ")
    assert.equal(chunks.join(""), text)
    assert.ok(longest(chunks) <= 180)
  })
})

describe("splitForSpeech — เบราว์เซอร์ที่ไม่มี Intl.Segmenter (segmenter = null)", () => {
  const text = repeatTo(THAI_SENTENCE, 1000)

  test("ไทยไม่มีช่องว่าง → ตัดแข็งใกล้ max แต่ต่อกันยังได้ต้นฉบับครบ", () => {
    const chunks = splitForSpeech(text, 180, null)
    assert.ok(longest(chunks) <= 180)
    assert.equal(chunks.join(""), text)
    for (const chunk of chunks.slice(0, -1)) assert.ok(chunk.length >= 170, `ท่อนสั้นไป ${chunk.length}`)
  })

  test("ตัดแข็งก็ไม่ผ่าอักษรประกอบ: ไม่มีท่อนขึ้นต้นด้วยสระ/วรรณยุกต์ที่ลอยตามหลัง และไม่ลงท้ายด้วยสระนำ (เ แ โ ใ ไ)", () => {
    for (const max of [7, 10, 33, 61, 180]) {
      const chunks = splitForSpeech(text, max, null)
      assert.ok(longest(chunks) <= max)
      assert.equal(chunks.join(""), text)
      for (const chunk of chunks.slice(0, -1)) assert.doesNotMatch(chunk, /[เแโใไ]$/u, `max ${max}: ${chunk.slice(-3)}`)
      for (const chunk of chunks.slice(1)) assert.doesNotMatch(chunk, /^[\p{M}ะาำๆฯ]/u, `max ${max}: ${chunk.slice(0, 3)}`)
    }
  })

  test("ยังตัดที่ประโยคและช่องว่างก่อนตามปกติ", () => {
    const english = Array.from({ length: 60 }, (_, i) => `word${i % 10}`).join(" ")
    const chunks = splitForSpeech(english, 180, null)
    assert.equal(chunks.join(""), english)
    for (const chunk of chunks.slice(0, -1)) assert.match(chunk, /\s$/)
    assert.ok(longest(chunks) <= 180)
  })

  test("อีโมจิ (คู่ surrogate) ไม่ถูกผ่ากลาง", () => {
    const emoji = "😀".repeat(200)
    const chunks = splitForSpeech(emoji, 7, null)
    assert.equal(chunks.join(""), emoji)
    for (const chunk of chunks) {
      assert.doesNotThrow(() => encodeURIComponent(chunk)) // ตัวครึ่ง surrogate โยน URIError
      assert.ok(chunk.length <= 7)
    }
  })

  test("max เล็กสุด (1) ไม่วนไม่รู้จบ — แม้ตัวอักษรตัวเดียวยาวสองหน่วย ท่อนก็ยังต่อกันได้ต้นฉบับ", () => {
    const mixed = "a😀ก่b"
    const chunks = splitForSpeech(mixed, 1, null)
    assert.equal(chunks.join(""), mixed)
    assert.ok(chunks.length >= 3)
  })
})

describe("splitForSpeech — max ที่ใช้ไม่ได้และข้อความว่าง", () => {
  test("max ที่ไม่ใช่จำนวน ≥ 1 (0, ติดลบ, NaN, Infinity) → ใช้ค่าเริ่มต้น 180", () => {
    const text = "word ".repeat(100)
    const expected = splitForSpeech(text, 180)
    for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(splitForSpeech(text, max), expected, String(max))
    assert.ok(longest(expected) <= 180)
  })

  test("max เป็นทศนิยมถูกปัดลง", () => {
    for (const chunk of splitForSpeech("ab cd ef gh ij kl", 5.9)) assert.ok(chunk.length <= 5)
  })

  test("ข้อความว่าง/มีแต่ช่องว่าง → []", () => {
    assert.deepEqual(splitForSpeech(""), [])
    assert.deepEqual(splitForSpeech("   \n\t "), [])
  })

  test("ท่อนที่มีแต่ช่องว่างไม่ถูกส่งไปอ่าน (ช่องว่างท้ายยาวเกิน max)", () => {
    const chunks = splitForSpeech(`abc${" ".repeat(500)}`)
    assert.ok(chunks.length >= 1)
    for (const chunk of chunks) assert.match(chunk, /\S/)
    assert.ok(longest(chunks) <= 180)
    assert.equal(chunks.join("").trim(), "abc")
  })

  test("ไม่ตัดช่องว่างหัวท้ายของท่อน (ท่อนต่อกันได้ต้นฉบับ)", () => {
    assert.deepEqual(splitForSpeech("  hello  "), ["  hello  "])
  })
})

describe("buildQueue", () => {
  test("ท่อนเสียงเรียงตามย่อหน้า: para = ลำดับย่อหน้าเดิม, first = ท่อนแรกของย่อหน้า", () => {
    const long = Array.from({ length: 80 }, () => "word").join(" ") // > 180 → หลายท่อน
    const queue = buildQueue(["short one", long, "short two"])
    assert.deepEqual(queue[0], { text: "short one", para: 0, first: true })
    const middle = queue.filter((item) => item.para === 1)
    assert.ok(middle.length >= 2)
    assert.deepEqual(
      middle.map((item) => item.first),
      middle.map((_, i) => i === 0),
    )
    assert.equal(middle.map((item) => item.text).join(""), long)
    assert.deepEqual(queue[queue.length - 1], { text: "short two", para: 2, first: true })
    assert.deepEqual(
      queue.map((item) => item.para),
      [...queue.map((item) => item.para)].sort((a, b) => a - b),
    )
  })

  test("เส้นคั่นฉากและย่อหน้าว่างไม่ถูกอ่าน แต่ลำดับย่อหน้า (para) ของที่เหลือไม่เลื่อน", () => {
    const queue = buildQueue(["ก่อน", "***", "", "   ", "* * *", "หลัง"])
    assert.deepEqual(queue, [
      { text: "ก่อน", para: 0, first: true },
      { text: "หลัง", para: 5, first: true },
    ])
  })

  test("ไม่มีย่อหน้า → []", () => {
    assert.deepEqual(buildQueue([]), [])
  })

  test("ส่ง max และ segmenter ต่อให้ splitForSpeech", () => {
    const text = "x".repeat(50)
    assert.deepEqual(
      buildQueue([text], 20, null).map((item) => item.text.length),
      [20, 20, 10],
    )
  })
})

describe("isThaiVoice / pickThaiVoice", () => {
  test("isThaiVoice: th, th-TH, th_TH (Android เก่า) ตัวพิมพ์ใหญ่เล็กก็ได้; ภาษาอื่นและค่าผิดรูปไม่ใช่", () => {
    for (const lang of ["th", "th-TH", "th_TH", "TH-th", "TH"]) assert.equal(isThaiVoice({ lang }), true, lang)
    for (const lang of ["en-US", "", "tl-PH", "the", "thx-TH", "ja-JP", "x-th"]) assert.equal(isThaiVoice({ lang }), false, lang)
    assert.equal(isThaiVoice({ lang: undefined as unknown as string }), false)
  })

  test("pickThaiVoice: ไม่มีเสียงไทย/รายการว่าง → null", () => {
    assert.equal(pickThaiVoice([]), null)
    assert.equal(pickThaiVoice([{ lang: "en-US" }, { lang: "ja-JP" }]), null)
  })

  test("pickThaiVoice: เลือกเสียงไทย; ถ้ามีหลายเสียง เลือกตัวที่เป็นค่าเริ่มต้นของระบบก่อน ไม่งั้นตัวแรก", () => {
    const en = { lang: "en-US", name: "en" }
    const th1 = { lang: "th-TH", name: "th1" }
    const th2 = { lang: "th_TH", name: "th2", default: true }
    assert.equal(pickThaiVoice([en, th1]), th1)
    assert.equal(pickThaiVoice([en, th1, th2]), th2)
    assert.equal(pickThaiVoice([th1, { ...th2, default: false }]), th1)
  })
})

describe("splitForSpeech — ช่องว่างที่ mutation พบ", () => {
  const noStart = ["ะ", "า", "ำ", "ๆ", "ฯ", "\u{0E31}", "\u{200D}", "\u{1D165}"] // อักษรที่ขึ้นต้นท่อนไม่ได้
  const noEnd = ["เ", "แ", "โ", "ใ", "ไ", "\u{200D}"] // สระนำ/ZWJ ที่ลงท้ายท่อนไม่ได้

  test("ตัดหลัง . ! ? (ตามด้วยช่องว่าง) และ 。！？ (ตัดได้เลย) ที่ขอบประโยค ก่อนจะตัดที่ช่องว่างธรรมดา", () => {
    for (const mark of [".", "!", "?"]) assert.deepEqual(splitForSpeech(`aa bb${mark} c d`, 9, null), [`aa bb${mark} `, "c d"], mark)
    for (const mark of ["。", "！", "？"]) assert.deepEqual(splitForSpeech(`aa bb${mark}c d`, 7, null), [`aa bb${mark}`, "c d"], mark)
  })

  test("เครื่องหมายจบประโยคปนกัน (ASCII แล้วตามด้วยแบบกว้าง) นับเป็นจบประโยคแบบกว้างทั้งชุด — ตัดได้เลยไม่ต้องมีช่องว่าง", () => {
    assert.deepEqual(splitForSpeech("aa bb?。c d", 7, null), ["aa bb?。", "c d"])
  })

  test("เครื่องหมายปิดคำพูด/วงเล็บที่ตามหลังจุดจบประโยคติดไปกับประโยคเดิม", () => {
    for (const closer of ['"', "'", "”", "’", ")", "]", "」", "』"]) assert.deepEqual(splitForSpeech(`aa bb.${closer} c d`, 10, null), [`aa bb.${closer} `, "c d"], closer)
  })

  test("เครื่องหมายจบประโยคติดกันหลายตัว (！？) ไม่ถูกผ่ากลาง", () => {
    assert.deepEqual(splitForSpeech("aa bb！？c d", 6, null), ["aa ", "bb！？", "c d"])
  })

  test("ท่อนต่อกันได้ข้อความเดิม: หางที่ไม่มีเครื่องหมายจบประโยค · ช่องว่างนำหน้าที่ติดไปกับคำแรก · ช่องว่างท้าย", () => {
    const cases: [string, number[]][] = [
      ["A. B. C", [3, 5, 8, 180]],
      ["A. B. C. D tail", [5, 8, 13, 180]],
      ["   ab cd ef", [8, 13, 180]],
      ["trailing spaces after words   ", [8, 13, 180]],
      ["x. y. z. ", [3, 5, 8, 180]],
    ]
    for (const [text, maxes] of cases) {
      for (const max of maxes) {
        const chunks = splitForSpeech(text, max, null)
        assert.equal(chunks.join(""), text, `${JSON.stringify(text)} max ${max}`)
        for (const chunk of chunks) assert.ok(chunk.length <= max, `${JSON.stringify(chunk)} > ${max}`)
      }
    }
  })

  test("ชิ้นที่รวมกันได้พอดี max อยู่ท่อนเดียวกัน (ไม่ใช่แค่ต่ำกว่า max)", () => {
    assert.deepEqual(splitForSpeech("aa bb cccccc", 6, null), ["aa bb ", "cccccc"])
  })

  test("ท่อนสุดท้ายของชิ้นที่ต้องผ่ารับชิ้นถัดไปต่อได้ (ไม่ทิ้งท่อนสั้นเศษ)", () => {
    assert.deepEqual(splitForSpeech(`${"a".repeat(25)} bb cc`, 20, null), ["a".repeat(20), "aaaaa bb cc"])
  })

  test("ตัดแข็งไม่ขึ้นต้นท่อนด้วยอักษรประกอบ/ZWJ/ๆ/ฯ/สระท้ายคำ", () => {
    for (const starter of noStart) {
      const text = "ก".repeat(5) + starter + "ก".repeat(5)
      const chunks = splitForSpeech(text, 5, null)
      assert.equal(chunks.join(""), text)
      for (const chunk of chunks) assert.ok(!chunk.startsWith(starter), `ขึ้นต้นด้วย ${JSON.stringify(starter)}: ${JSON.stringify(chunks)}`)
    }
  })

  test("ตัดแข็งไม่ลงท้ายท่อนด้วยสระนำ/ZWJ (ต้องอยู่กับพยัญชนะที่ตามมา)", () => {
    for (const ender of noEnd) {
      const text = "ก".repeat(4) + ender + "ก".repeat(5)
      const chunks = splitForSpeech(text, 5, null)
      assert.equal(chunks.join(""), text)
      for (const chunk of chunks) assert.ok(!chunk.endsWith(ender), `ลงท้ายด้วย ${JSON.stringify(ender)}: ${JSON.stringify(chunks)}`)
    }
  })

  test("ไม่ผ่ากลางคู่ surrogate (อักขระนอก BMP) แม้ขอบ max ตกตรงกลาง", () => {
    const text = "ก" + "\u{10000}".repeat(10)
    for (const max of [3, 4, 5, 6]) {
      const chunks = splitForSpeech(text, max, null)
      assert.equal(chunks.join(""), text)
      for (const chunk of chunks) assert.ok(!/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk), `max ${max}: ${JSON.stringify(chunks)}`)
    }
  })

  test("ตัวอักษรประกอบยาวเกิน max ไม่ถูกผ่า — ยอมให้ท่อนยาวเกินแทน (ผ่าแล้วเสียงเพี้ยนกว่า)", () => {
    const text = "ก" + "\u{0E31}".repeat(30)
    assert.deepEqual(splitForSpeech(text, 10, null), [text])
  })

  test("max ทศนิยมได้ผลเหมือนปัดลง แม้ขอบตกที่สระนำ", () => {
    const text = "ก".repeat(5) + "เ" + "ก".repeat(5)
    assert.deepEqual(splitForSpeech(text, 5.5, null), splitForSpeech(text, 5, null))
  })

  test("ท่อนท้ายสุดที่ลงท้ายด้วยสระนำไม่ถูกแยกสระออก", () => {
    assert.deepEqual(splitForSpeech("ก".repeat(10) + "กเ", 10, null), ["ก".repeat(10), "กเ"])
  })

  test("buildQueue ส่ง max และ segmenter ต่อไปให้ splitForSpeech", () => {
    const text = "สวัสดีครับทุกคนวันนี้อากาศดีมากเลยนะครับ"
    const hard = splitForSpeech(text, 10, null)
    const words = splitForSpeech(text, 10)
    assert.notDeepEqual(hard, words, "ข้อมูลทดสอบต้องทำให้ตัดแข็งกับตัดตามคำต่างกัน")
    assert.deepEqual(buildQueue([text], 10, null).map((item) => item.text), hard)
    assert.deepEqual(buildQueue([text], 10).map((item) => item.text), words)
  })
})
