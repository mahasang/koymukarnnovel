import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { FINISHED_PCT, type Progress } from "./progress"
import {
  BAR_HIDE_AFTER,
  BAR_SHOW_AFTER,
  BAR_TOP_ZONE,
  INITIAL_BAR,
  chapterHeading,
  chapterKeyAction,
  chapterTitle,
  firstVisibleParagraph,
  isTypingTarget,
  nextBarState,
  parseChapterParam,
  restoreTop,
  scrollPct,
  shouldRestore,
  type BarState,
  type KeyEventLike,
} from "./reader"

/** ตรรกะล้วนของหน้าอ่าน (ไม่แตะ DOM): แถบบนซ่อน/โผล่ตามทิศเลื่อน, เปอร์เซ็นต์ที่อ่านแล้ว, คืนตำแหน่ง, ปุ่มลูกศร, ชื่อตอน */

const scrollThrough = (start: BarState, ys: number[], pinned = false): BarState[] => {
  const states: BarState[] = []
  let state = start
  for (const y of ys) states.push((state = nextBarState(state, y, pinned)))
  return states
}
const visibility = (states: BarState[]): string => states.map((s) => (s.visible ? "V" : "h")).join("")

describe("nextBarState — แถบบนซ่อนเมื่อเลื่อนลง โผล่เมื่อเลื่อนขึ้น", () => {
  test("ค่าเริ่มต้น: เห็นแถบ", () => {
    assert.equal(INITIAL_BAR.visible, true)
  })

  test("อยู่ใกล้บนสุด (≤ BAR_TOP_ZONE) เห็นแถบเสมอ แม้เลื่อนลงเร็วหรือเพิ่งซ่อนอยู่", () => {
    assert.equal(nextBarState({ visible: false, anchor: 500 }, BAR_TOP_ZONE, false).visible, true)
    assert.equal(nextBarState({ visible: false, anchor: 500 }, 0, false).visible, true)
    assert.equal(nextBarState({ visible: true, anchor: 0 }, BAR_TOP_ZONE, false).visible, true)
    assert.equal(nextBarState({ visible: false, anchor: 500 }, -30, false).visible, true) // ดึงเลยขอบบนบน iOS
  })

  test("เลื่อนลงสะสมถึง BAR_HIDE_AFTER จึงซ่อน (ขยับนิดเดียวไม่ซ่อน — กันกะพริบ)", () => {
    const start = { visible: true, anchor: 200 }
    assert.equal(visibility(scrollThrough(start, [205, 210, 200 + BAR_HIDE_AFTER - 1])), "VVV")
    assert.equal(nextBarState(start, 200 + BAR_HIDE_AFTER, false).visible, false)
  })

  test("เลื่อนลงช้าๆ ทีละ 2 พิกเซลก็ซ่อนได้เมื่อสะสมครบ", () => {
    const ys = Array.from({ length: 20 }, (_, i) => 200 + (i + 1) * 2)
    const states = scrollThrough({ visible: true, anchor: 200 }, ys)
    assert.equal(states[10].visible, true) // 22 พิกเซล
    assert.equal(states[11].visible, false) // 24 พิกเซล
    assert.equal(states[19].visible, false)
  })

  test("เมื่อซ่อนอยู่ เลื่อนขึ้นสะสมถึง BAR_SHOW_AFTER จึงโผล่; เลื่อนลงต่อไม่โผล่", () => {
    const hidden = { visible: false, anchor: 400 }
    assert.equal(visibility(scrollThrough(hidden, [420, 450, 450 - BAR_SHOW_AFTER + 1])), "hhh")
    assert.equal(nextBarState({ visible: false, anchor: 450 }, 450 - BAR_SHOW_AFTER, false).visible, true)
  })

  test("เลื่อนขึ้นช้าๆ ทีละ 2 พิกเซลก็โผล่ได้ และสลับทิศกลางทางนับจากจุดสุดท้ายที่เปลี่ยนทิศ", () => {
    const states = scrollThrough({ visible: false, anchor: 600 }, [598, 596, 594, 592, 590, 588])
    assert.equal(visibility(states), "hhhhhV")
    // ซ่อนอยู่ เลื่อนขึ้น 8 แล้วกลับลง 30 แล้วขึ้น 8: ไม่ครบ 12 จากจุดสูงสุดที่ผ่านมา
    assert.equal(visibility(scrollThrough({ visible: false, anchor: 600 }, [592, 622, 614])), "hhh")
  })

  test("วงจรเต็ม: ลง → ซ่อน → ขึ้น → โผล่ → ลง → ซ่อน (ตำแหน่งนับจากจุดที่เปลี่ยนทิศล่าสุด)", () => {
    const states = scrollThrough({ visible: true, anchor: 300 }, [330, 360, 350, 340, 330, 360, 400])
    assert.equal(visibility(states), "hhhVVhh")
  })

  test("ปักหมุด (กำลังฟังเสียง / เปิดแผงตั้งค่า) → เห็นแถบเสมอ ไม่ว่าเลื่อนทางไหน", () => {
    assert.equal(visibility(scrollThrough({ visible: false, anchor: 500 }, [510, 600, 900], true)), "VVV")
    assert.equal(nextBarState({ visible: true, anchor: 200 }, 900, true).visible, true)
  })

  test("ค่า y ที่ไม่ใช่จำนวนจริง (NaN/Infinity) → สถานะเดิม", () => {
    const state = { visible: false, anchor: 500 }
    assert.equal(nextBarState(state, Number.NaN, false), state)
    assert.equal(nextBarState(state, Number.POSITIVE_INFINITY, false), state)
  })
})

describe("scrollPct / restoreTop", () => {
  test("เปอร์เซ็นต์ที่เลื่อนไปของช่วงที่เลื่อนได้ทั้งหมด (สูงเอกสาร − สูงจอ)", () => {
    assert.equal(scrollPct(0, 1000, 500), 0)
    assert.equal(scrollPct(250, 1000, 500), 50)
    assert.equal(scrollPct(500, 1000, 500), 100)
    assert.equal(scrollPct(125, 1000, 500), 25)
  })

  test("เลื่อนเกินปลาย/ก่อนต้น (ดึงเกินขอบบน iOS) ตรึงใน 0–100; ค่าไม่ใช่จำนวน → 0", () => {
    assert.equal(scrollPct(700, 1000, 500), 100)
    assert.equal(scrollPct(-40, 1000, 500), 0)
    assert.equal(scrollPct(Number.NaN, 1000, 500), 0)
    assert.equal(scrollPct(10, Number.NaN, 500), 0)
  })

  test("ตอนสั้นจนไม่ต้องเลื่อน (เห็นครบในจอเดียว) → 100 (อ่านจบแล้ว)", () => {
    assert.equal(scrollPct(0, 400, 500), 100)
    assert.equal(scrollPct(0, 500, 500), 100)
  })

  test("restoreTop เป็นขั้นกลับของ scrollPct: จากเปอร์เซ็นต์เป็นตำแหน่งเลื่อน (ปัดเป็นจำนวนเต็ม)", () => {
    assert.equal(restoreTop(50, 1000, 500), 250)
    assert.equal(restoreTop(100, 1000, 500), 500)
    assert.equal(restoreTop(0, 1000, 500), 0)
    assert.equal(restoreTop(33, 1001, 500), 165) // 0.33 × 501 = 165.33
    for (const pct of [10, 37, 62, 94]) assert.ok(Math.abs(scrollPct(restoreTop(pct, 4321, 700), 4321, 700) - pct) < 0.1, String(pct))
  })

  test("restoreTop ตรึงเปอร์เซ็นต์นอกช่วง; หน้าที่ไม่ต้องเลื่อน/ค่าไม่ใช่จำนวน → 0", () => {
    assert.equal(restoreTop(150, 1000, 500), 500)
    assert.equal(restoreTop(-5, 1000, 500), 0)
    assert.equal(restoreTop(50, 400, 500), 0)
    assert.equal(restoreTop(Number.NaN, 1000, 500), 0)
    assert.equal(restoreTop(50, Number.NaN, 500), 0)
  })
})

describe("shouldRestore — คืนตำแหน่งเฉพาะตอนที่อ่านค้างไว้และยังอ่านไม่จบ", () => {
  const progress = (over: Partial<Progress> = {}): Progress => ({ number: 5, pct: 40, next: 6, at: 1, ...over })

  test("ตอนเดียวกับที่บันทึกไว้ อ่านไปบ้างแล้วแต่ยังไม่จบ → คืนตำแหน่ง", () => {
    assert.equal(shouldRestore(progress(), 5), true)
    assert.equal(shouldRestore(progress({ pct: 1 }), 5), true)
    assert.equal(shouldRestore(progress({ pct: FINISHED_PCT - 1 }), 5), true)
  })

  test("ไม่เคยอ่านเรื่องนี้ / ตอนอื่น → ไม่คืน (เริ่มที่บนสุด)", () => {
    assert.equal(shouldRestore(null, 5), false)
    assert.equal(shouldRestore(progress(), 4), false)
    assert.equal(shouldRestore(progress(), 6), false)
  })

  test("อ่านจบแล้ว (≥ FINISHED_PCT) หรือเพิ่งเปิด (0) → เริ่มที่บนสุด", () => {
    assert.equal(shouldRestore(progress({ pct: FINISHED_PCT }), 5), false)
    assert.equal(shouldRestore(progress({ pct: 100 }), 5), false)
    assert.equal(shouldRestore(progress({ pct: 0 }), 5), false)
  })

  test("ตอนที่ 0 (บทนำ) เป็นตอนจริง", () => {
    assert.equal(shouldRestore(progress({ number: 0 }), 0), true)
  })
})

describe("chapterKeyAction / isTypingTarget — ปุ่มลูกศรเปลี่ยนตอน", () => {
  const key = (over: Partial<KeyEventLike> = {}): KeyEventLike => ({
    key: "ArrowRight",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: { tagName: "BODY", isContentEditable: false },
    ...over,
  })
  const both = { prev: 4, next: 6 }

  test("→ ไปตอนถัดไป, ← ไปตอนก่อนหน้า", () => {
    assert.equal(chapterKeyAction(key({ key: "ArrowRight" }), both), "next")
    assert.equal(chapterKeyAction(key({ key: "ArrowLeft" }), both), "prev")
  })

  test("ไม่มีตอนถัดไป/ก่อนหน้า → ไม่ทำอะไร (ปล่อยให้เบราว์เซอร์ทำงานต่อ)", () => {
    assert.equal(chapterKeyAction(key({ key: "ArrowRight" }), { prev: 4, next: null }), null)
    assert.equal(chapterKeyAction(key({ key: "ArrowLeft" }), { prev: null, next: 6 }), null)
    assert.equal(chapterKeyAction(key({ key: "ArrowRight" }), { prev: null, next: 0 }), "next") // ตอนที่ 0 เป็นตอนจริง
  })

  test("ปุ่มอื่นไม่ทำอะไร", () => {
    for (const k of ["ArrowUp", "ArrowDown", "Enter", " ", "a", "Escape", "PageDown", "Home"]) assert.equal(chapterKeyAction(key({ key: k }), both), null, k)
  })

  test("กดคู่กับ Ctrl / Cmd / Alt (Alt+← คือย้อนกลับของเบราว์เซอร์) / Shift (ขยายการเลือกข้อความ) ไม่ทำอะไร", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) assert.equal(chapterKeyAction(key({ [mod]: true }), both), null, mod)
  })

  test("โฟกัสอยู่ที่ช่องกรอก (input / textarea / select / contenteditable) ไม่ทำอะไร", () => {
    for (const target of [{ tagName: "INPUT" }, { tagName: "input" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
      assert.equal(chapterKeyAction(key({ target }), both), null, JSON.stringify(target))
    }
  })

  test("โฟกัสที่ปุ่ม/ลิงก์ ทำงานปกติ", () => {
    assert.equal(chapterKeyAction(key({ target: { tagName: "BUTTON" } }), both), "next")
    assert.equal(chapterKeyAction(key({ target: { tagName: "A" } }), both), "next")
  })

  test("ถูกจัดการไปแล้ว (defaultPrevented) / กำลังพิมพ์ด้วย IME / ถูกบล็อก (แผงตั้งค่าเปิดอยู่) ไม่ทำอะไร", () => {
    assert.equal(chapterKeyAction(key({ defaultPrevented: true }), both), null)
    assert.equal(chapterKeyAction(key({ isComposing: true }), both), null)
    assert.equal(chapterKeyAction(key(), both, true), null)
    assert.equal(chapterKeyAction(key(), both, false), "next")
  })

  test("isTypingTarget: ไม่ใช่วัตถุ/ไม่มีแท็ก → เท็จ", () => {
    for (const target of [null, undefined, "input", 5, {}, { tagName: 5 }]) assert.equal(isTypingTarget(target), false, String(target))
    assert.equal(isTypingTarget({ tagName: "INPUT" }), true)
    assert.equal(isTypingTarget({ tagName: "P", isContentEditable: true }), true)
  })
})

describe("chapterHeading / chapterTitle — รูปแบบเดียวกับ <title> ที่เซิร์ฟเวอร์ใส่ให้", () => {
  const novel = { title: "Glass Season", titleTh: "ฤดูกระจก" }

  test("ตอนที่ N: ชื่อตอน (ชื่อไทยก่อน ไม่มีใช้ชื่อต้นฉบับ) · ไม่มีชื่อ → ตอนที่ N", () => {
    assert.equal(chapterHeading({ number: 12, title: "The Door", titleTh: "ประตู" }), "ตอนที่ 12: ประตู")
    assert.equal(chapterHeading({ number: 12, title: "The Door", titleTh: "" }), "ตอนที่ 12: The Door")
    assert.equal(chapterHeading({ number: 12, title: "The Door", titleTh: "   " }), "ตอนที่ 12: The Door")
    assert.equal(chapterHeading({ number: 12, title: "", titleTh: "" }), "ตอนที่ 12")
    assert.equal(chapterHeading({ number: 0, title: "", titleTh: " " }), "ตอนที่ 0")
  })

  test("ชื่อแท็บ: หัวตอน — ชื่อเรื่อง (ชื่อไทยก่อน)", () => {
    assert.equal(chapterTitle(novel, { number: 3, title: "A", titleTh: "ก" }), "ตอนที่ 3: ก — ฤดูกระจก")
    assert.equal(chapterTitle({ title: "Glass Season", titleTh: "" }, { number: 3, title: "", titleTh: "" }), "ตอนที่ 3 — Glass Season")
  })
})

describe("firstVisibleParagraph — เริ่มอ่านออกเสียงจากย่อหน้าที่เห็นอยู่", () => {
  test("ย่อหน้าแรกที่ขอบล่างพ้นขอบบนของพื้นที่อ่าน (ใต้แถบบน)", () => {
    assert.equal(firstVisibleParagraph([-300, -120, 40, 200, 400], 60), 3)
    assert.equal(firstVisibleParagraph([-300, -120, 40, 200, 400], 0), 2)
    assert.equal(firstVisibleParagraph([100, 200], 60), 0)
  })

  test("ขอบล่างเท่าขอบบนพอดีถือว่าพ้นไปแล้ว", () => {
    assert.equal(firstVisibleParagraph([60, 200], 60), 1)
  })

  test("ไม่มีย่อหน้า หรือเลื่อนพ้นทุกย่อหน้าไปแล้ว (อยู่ท้ายตอน) → ย่อหน้าแรก", () => {
    assert.equal(firstVisibleParagraph([], 60), 0)
    assert.equal(firstVisibleParagraph([-500, -300, -100], 60), 0)
  })
})


describe("parseChapterParam — เลขตอนใน URL", () => {
  test("จำนวนเต็มไม่ติดลบ 1–9 หลักไม่มีศูนย์นำหน้า (รวมตอนที่ 0)", () => {
    assert.equal(parseChapterParam("0"), 0)
    assert.equal(parseChapterParam("1"), 1)
    assert.equal(parseChapterParam("120"), 120)
    assert.equal(parseChapterParam("123456789"), 123456789)
  })

  test("รูปอื่นไม่ใช่: ว่าง, ศูนย์นำหน้า, ติดลบ, ทศนิยม, เลขไทย, ยาวเกิน 9 หลัก, มีตัวอื่นปน, ไม่ระบุ", () => {
    for (const raw of ["", "00", "01", "-1", "1.5", "1e3", "๑", " 1", "1 ", "1234567890", "12a", "+1", "0x1"]) assert.equal(parseChapterParam(raw), null, JSON.stringify(raw))
    assert.equal(parseChapterParam(undefined), null)
  })
})

describe("nextBarState — ขอบเขตของเกณฑ์ (พิกเซลต่อพิกเซล)", () => {
  test("โซนบนสุดจบที่ 80 พอดี: 80 ยังเห็นแถบ · 81 (เลื่อนลงจาก 0) ซ่อน", () => {
    assert.deepEqual(nextBarState({ visible: true, anchor: 0 }, 80, false), { visible: true, anchor: 80 })
    assert.equal(nextBarState({ visible: true, anchor: 0 }, 81, false).visible, false)
  })

  test("ซ่อนเมื่อเลื่อนลงสะสมครบ 24 พอดี: 23 ยังเห็น · 24 ซ่อน", () => {
    assert.equal(nextBarState({ visible: true, anchor: 100 }, 123, false).visible, true)
    assert.equal(nextBarState({ visible: true, anchor: 100 }, 124, false).visible, false)
  })

  test("โผล่เมื่อเลื่อนขึ้นสะสมครบ 12 พอดี: 11 ยังซ่อน · 12 โผล่", () => {
    assert.equal(nextBarState({ visible: false, anchor: 300 }, 289, false).visible, false)
    assert.equal(nextBarState({ visible: false, anchor: 300 }, 288, false).visible, true)
  })

  test("ปักหมุดอยู่ (กำลังฟัง/เปิดแผง) จุดอ้างอิงเลื่อนตามตำแหน่งปัจจุบัน — เลิกปักแล้วนับระยะจากตรงนั้น ไม่ใช่จากจุดเก่า", () => {
    const pinned = nextBarState({ visible: true, anchor: 0 }, 500, true)
    assert.deepEqual(pinned, { visible: true, anchor: 500 })
    assert.equal(nextBarState(pinned, 510, false).visible, true) // เลื่อนลงแค่ 10 จากจุดที่เลิกปัก
    assert.equal(nextBarState(pinned, 524, false).visible, false)
  })

  test("ซ่อนแล้ว จุดอ้างอิงคือจุดที่ซ่อน: เลื่อนขึ้นสะสม 12 จากจุดนั้นจึงโผล่", () => {
    const hidden = nextBarState({ visible: true, anchor: 100 }, 130, false)
    assert.deepEqual(hidden, { visible: false, anchor: 130 })
    assert.equal(nextBarState(hidden, 120, false).visible, false) // ขึ้นมา 10
    assert.equal(nextBarState(hidden, 118, false).visible, true) // ขึ้นมา 12
  })

  test("โผล่แล้ว จุดอ้างอิงคือจุดที่โผล่: เลื่อนลงสะสม 24 จากจุดนั้นจึงซ่อนอีก", () => {
    const shown = nextBarState({ visible: false, anchor: 300 }, 280, false)
    assert.deepEqual(shown, { visible: true, anchor: 280 })
    assert.equal(nextBarState(shown, 290, false).visible, true) // ลงมา 10
    assert.equal(nextBarState(shown, 303, false).visible, true) // ลงมา 23
    assert.equal(nextBarState(shown, 304, false).visible, false) // ลงมา 24
  })
})

describe("scrollPct / restoreTop — เศษทศนิยม", () => {
  test("scrollPct คืนค่าทศนิยม ไม่ปัด (saveProgress ปัดเองตอนเก็บ)", () => {
    assert.ok(Math.abs(scrollPct(1, 3, 0) - 100 / 3) < 1e-9)
  })

  test("restoreTop ปัดเศษ (round) เป็นพิกเซลเต็ม", () => {
    assert.equal(restoreTop(50, 1001, 0), 501) // 500.5 → 501
    assert.equal(restoreTop(33, 1000, 0), 330)
  })
})
