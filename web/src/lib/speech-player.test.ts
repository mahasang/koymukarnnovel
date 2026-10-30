import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { SpeechPlayer, type SpeakOptions, type SynthLike, type VoiceLike } from "./speech-player"

/** ตัวเล่นเสียงอ่านกับเครื่องยนต์เสียงจำลอง — ตรวจลำดับท่อน, ย่อหน้าที่กำลังอ่าน, หยุด/เล่นต่อ/ข้าม, และเหตุการณ์ค้างจากเสียงที่ถูกยกเลิก */

interface Spoken extends SpeakOptions {
  text: string
}

class FakeSynth implements SynthLike {
  voices: VoiceLike[] = [{ lang: "en-US" }, { lang: "th-TH", default: true }]
  spoken: Spoken[] = []
  cancels = 0
  getVoices(): VoiceLike[] {
    return this.voices
  }
  cancel(): void {
    this.cancels++
  }
  speak(text: string, options: SpeakOptions): void {
    this.spoken.push({ text, ...options })
  }
  get last(): Spoken {
    return this.spoken[this.spoken.length - 1]
  }
  /** เครื่องยนต์อ่านท่อนล่าสุดจบ */
  finish(): void {
    this.last.onend()
  }
  texts(): string[] {
    return this.spoken.map((s) => s.text)
  }
}

const LONG = Array.from({ length: 80 }, () => "word").join(" ") // 399 ตัว → 3 ท่อน
const setup = (paragraphs: string[], rate?: number) => {
  const synth = new FakeSynth()
  let changes = 0
  const player = new SpeechPlayer(synth, () => changes++, rate)
  player.refreshVoices()
  player.setParagraphs(paragraphs)
  return { synth, player, changes: () => changes }
}
const view = (player: SpeechPlayer) => {
  const { state, index } = player.snapshot()
  return `${state}:${index}`
}

describe("SpeechPlayer — ไม่รองรับ", () => {
  test("ไม่มีเครื่องยนต์เสียง (synth = null): supported/hasThaiVoice เป็นเท็จ คำสั่งทั้งหมดไม่ทำอะไร", () => {
    const player = new SpeechPlayer(null, () => assert.fail("ไม่ควรแจ้งการเปลี่ยนแปลง"))
    player.setParagraphs(["ก"])
    player.refreshVoices()
    player.settleVoices()
    player.play()
    player.pause()
    player.resume()
    player.next()
    player.prev()
    player.stop()
    player.destroy()
    assert.deepEqual(player.snapshot(), { supported: false, hasThaiVoice: false, state: "idle", index: 0, rate: 1 })
  })
})

describe("SpeechPlayer — เสียงไทย", () => {
  test("ยังไม่รู้รายชื่อเสียง (ว่างและยังไม่หมดเวลารอ) → ถือว่ามี เพื่อไม่ให้ปุ่มฟังกะพริบหาย", () => {
    const synth = new FakeSynth()
    synth.voices = []
    const player = new SpeechPlayer(synth, () => {})
    player.refreshVoices()
    assert.deepEqual(player.snapshot(), { supported: true, hasThaiVoice: true, state: "idle", index: 0, rate: 1 })
  })

  test("โหลดแล้วมีแต่เสียงอื่น → hasThaiVoice เป็นเท็จ และแจ้งการเปลี่ยนแปลง; มีเสียงไทย → จริง", () => {
    const synth = new FakeSynth()
    synth.voices = [{ lang: "en-US" }]
    let changes = 0
    const player = new SpeechPlayer(synth, () => changes++)
    player.refreshVoices()
    assert.equal(player.snapshot().hasThaiVoice, false)
    assert.equal(changes, 1)
    synth.voices = [{ lang: "en-US" }, { lang: "th-TH" }]
    player.refreshVoices() // เสียงไทยมาทีหลัง (voiceschanged)
    assert.equal(player.snapshot().hasThaiVoice, true)
    assert.equal(changes, 2)
    player.refreshVoices() // ไม่เปลี่ยน → ไม่แจ้งซ้ำ
    assert.equal(changes, 2)
  })

  test("รายชื่อว่างจนหมดเวลารอ (settleVoices) → ไม่มีเสียงไทย; เสียงมาทีหลังก็กลับมามี; รายชื่อที่โหลดแล้วไม่ถูก settle ทับ", () => {
    const synth = new FakeSynth()
    synth.voices = []
    const player = new SpeechPlayer(synth, () => {})
    player.refreshVoices()
    player.settleVoices()
    assert.equal(player.snapshot().hasThaiVoice, false)
    synth.voices = [{ lang: "th-TH" }]
    player.refreshVoices()
    assert.equal(player.snapshot().hasThaiVoice, true)
    player.settleVoices()
    assert.equal(player.snapshot().hasThaiVoice, true)
  })

  test("ไม่มีเสียงไทย → play() ไม่เริ่มอ่าน", () => {
    const { synth, player } = setup(["ก"])
    synth.voices = [{ lang: "en-US" }]
    player.refreshVoices()
    player.play()
    assert.equal(synth.spoken.length, 0)
    assert.equal(view(player), "idle:0")
  })

  test("อ่านด้วยเสียงไทยที่เลือกไว้ lang th-TH และความเร็วปัจจุบัน", () => {
    const { synth, player } = setup(["ก"], 1.2)
    player.play()
    assert.equal(synth.last.lang, "th-TH")
    assert.equal(synth.last.rate, 1.2)
    assert.deepEqual(synth.last.voice, { lang: "th-TH", default: true })
  })

  test("เครื่องยนต์ตอบ language-unavailable/voice-unavailable/synthesis-unavailable → เลิกเล่นและ hasThaiVoice เป็นเท็จ; error อื่นแค่เลิกเล่น", () => {
    for (const error of ["language-unavailable", "voice-unavailable", "synthesis-unavailable"]) {
      const { synth, player } = setup(["ก"])
      player.play()
      synth.last.onerror(error)
      assert.equal(view(player), "idle:0", error)
      assert.equal(player.snapshot().hasThaiVoice, false, error)
    }
    const { synth, player } = setup(["ก"])
    player.play()
    synth.last.onerror("not-allowed")
    assert.equal(view(player), "idle:0")
    assert.equal(player.snapshot().hasThaiVoice, true)
    player.play() // เล่นใหม่ได้
    assert.equal(view(player), "playing:0")
  })
})

describe("SpeechPlayer — เล่นต่อเนื่อง", () => {
  test("เล่นทีละท่อน: ท่อนจบ → ท่อนถัดไป · index เปลี่ยนเมื่อเริ่มย่อหน้าใหม่ (ไม่เปลี่ยนระหว่างท่อนของย่อหน้าเดียวกัน) · จบคิว → idle", () => {
    const { synth, player } = setup(["หนึ่ง", LONG, "สาม"])
    player.play()
    assert.equal(view(player), "playing:0")
    synth.finish()
    assert.equal(view(player), "playing:1")
    synth.finish()
    assert.equal(view(player), "playing:1") // ท่อนที่สองของย่อหน้า 1
    synth.finish()
    assert.equal(view(player), "playing:1") // ท่อนที่สาม
    synth.finish()
    assert.equal(view(player), "playing:2")
    assert.equal(synth.texts().length, 5)
    assert.equal(synth.texts().slice(1, 4).join(""), LONG)
    synth.finish()
    assert.equal(view(player), "idle:0")
    assert.equal(synth.spoken.length, 5)
  })

  test("เส้นคั่นฉากและย่อหน้าว่างไม่ถูกอ่าน", () => {
    const { synth, player } = setup(["ก", "***", "", "ข"])
    player.play()
    synth.finish()
    assert.deepEqual(synth.texts(), ["ก", "ข"])
    assert.equal(view(player), "playing:3")
  })

  test("play(from) เริ่มที่ย่อหน้านั้น; ย่อหน้าที่อ่านไม่ได้ → ถัดไปที่อ่านได้; เกินท้าย/ไม่มีอะไรอ่าน → ไม่ทำอะไร; ค่าแปลก (ติดลบ NaN ทศนิยม) ปรับเข้าช่วย", () => {
    const { synth, player } = setup(["ก", "***", "ข", "ค"])
    player.play(2)
    assert.equal(synth.last.text, "ข")
    assert.equal(view(player), "playing:2")
    player.play(1)
    assert.equal(synth.last.text, "ข")
    player.play(-3)
    assert.equal(synth.last.text, "ก")
    player.play(Number.NaN)
    assert.equal(synth.last.text, "ก")
    player.play(2.9)
    assert.equal(synth.last.text, "ข")
    const count = synth.spoken.length
    player.stop()
    player.play(4)
    assert.equal(view(player), "idle:0")
    assert.equal(synth.spoken.length, count)
    const empty = setup([])
    empty.player.play()
    assert.equal(empty.synth.spoken.length, 0)
  })

  test("เล่นซ้ำระหว่างเล่น: ยกเลิกเสียงเดิมแล้วเริ่มใหม่ และ end ของเสียงเดิมที่ตามมาไม่ทำให้คิวเดินซ้ำ", () => {
    const { synth, player } = setup(["ก", "ข", "ค"])
    player.play(0)
    const old = synth.last
    player.play(1)
    assert.equal(synth.last.text, "ข")
    const cancels = synth.cancels
    old.onend() // เบราว์เซอร์ยิงตามหลังการยกเลิก
    old.onerror("interrupted")
    assert.equal(synth.spoken.length, 2)
    assert.equal(synth.cancels, cancels)
    assert.equal(view(player), "playing:1")
  })
})

describe("SpeechPlayer — หยุดชั่วคราว / เล่นต่อ / หยุด", () => {
  test("pause ยกเลิกเสียง จำท่อนไว้; end ที่ตามมาไม่เดินคิว; resume เริ่มท่อนเดิมใหม่ (ไม่ข้าม) แล้วเล่นต่อ", () => {
    const { synth, player } = setup(["ก", "ข"])
    player.play()
    const old = synth.last
    const cancels = synth.cancels
    player.pause()
    assert.equal(view(player), "paused:0")
    assert.equal(synth.cancels, cancels + 1)
    old.onend()
    old.onerror("canceled")
    assert.equal(synth.spoken.length, 1)
    assert.equal(view(player), "paused:0")
    player.resume()
    assert.equal(view(player), "playing:0")
    assert.deepEqual(synth.texts(), ["ก", "ก"])
    synth.finish()
    assert.equal(synth.last.text, "ข")
  })

  test("pause ตอนไม่ได้เล่น / resume ตอนไม่ได้หยุด / stop ตอนว่าง ไม่ทำอะไรและไม่แจ้งการเปลี่ยนแปลง", () => {
    const { synth, player, changes } = setup(["ก"])
    const before = changes()
    player.pause()
    player.resume()
    player.stop()
    assert.equal(changes(), before)
    assert.equal(synth.cancels, 0)
    player.play()
    player.resume() // กำลังเล่นอยู่ — ไม่ใช่หยุดชั่วคราว
    assert.equal(synth.spoken.length, 1)
    player.pause()
    player.pause()
    assert.equal(synth.cancels, 2) // play (ล้างของค้าง) + pause ครั้งเดียว
  })

  test("stop: ยกเลิกเสียง กลับ idle index 0; เหตุการณ์ค้างไม่ทำอะไร; play ใหม่ได้", () => {
    const { synth, player } = setup(["ก", "ข"])
    player.play(1)
    const old = synth.last
    player.stop()
    assert.equal(view(player), "idle:0")
    old.onend()
    assert.equal(synth.spoken.length, 1)
    player.stop()
    player.play()
    assert.equal(synth.last.text, "ก")
  })

  test("stop ขณะหยุดชั่วคราว → idle", () => {
    const { player } = setup(["ก"])
    player.play()
    player.pause()
    player.stop()
    assert.equal(view(player), "idle:0")
  })
})

describe("SpeechPlayer — ข้ามย่อหน้า", () => {
  test("next: ไปต้นย่อหน้าถัดไปที่มีอะไรให้อ่าน (ข้ามเส้นคั่นฉาก) แม้อยู่กลางย่อหน้ายาว; เสียงเดิมถูกยกเลิกและ end ค้างถูกเมิน", () => {
    const { synth, player } = setup(["ก", LONG, "***", "ค"])
    player.play(1)
    synth.finish() // ท่อนที่สองของย่อหน้า 1
    const old = synth.last
    player.next()
    assert.equal(view(player), "playing:3")
    assert.equal(synth.last.text, "ค")
    old.onend()
    assert.equal(synth.spoken.length, 3)
    assert.equal(view(player), "playing:3")
  })

  test("next ที่ย่อหน้าสุดท้าย → จบ (idle)", () => {
    const { synth, player } = setup(["ก", "ข"])
    player.play(1)
    player.next()
    assert.equal(view(player), "idle:0")
    assert.equal(synth.spoken.length, 1)
  })

  test("prev: ไปต้นย่อหน้าก่อนหน้า (แม้อยู่กลางย่อหน้ายาว); ย่อหน้าแรก → เริ่มย่อหน้าแรกใหม่", () => {
    const { synth, player } = setup(["ก", "***", LONG, "ค"])
    player.play(2)
    synth.finish()
    synth.finish() // ท่อนที่สามของย่อหน้า 2
    player.prev()
    assert.equal(view(player), "playing:0") // ข้ามเส้นคั่นฉากไปย่อหน้า 0
    assert.equal(synth.last.text, "ก")
    player.prev()
    assert.equal(view(player), "playing:0")
    assert.equal(synth.last.text, "ก")
    assert.equal(synth.spoken.length, 5)
  })

  test("prev ในย่อหน้ายาวย่อหน้าแรก → กลับไปท่อนแรกของย่อหน้านั้น", () => {
    const { synth, player } = setup([LONG])
    player.play()
    synth.finish()
    player.prev()
    assert.equal(synth.last.text, synth.spoken[0].text)
  })

  test("next/prev ขณะหยุดชั่วคราวย้ายตำแหน่งอย่างเดียว ไม่พูด; resume พูดที่ตำแหน่งใหม่", () => {
    const { synth, player } = setup(["ก", "ข", "ค"])
    player.play()
    player.pause()
    const spoken = synth.spoken.length
    player.next()
    assert.equal(view(player), "paused:1")
    player.next()
    player.prev()
    assert.equal(view(player), "paused:1")
    assert.equal(synth.spoken.length, spoken)
    player.resume()
    assert.equal(synth.last.text, "ข")
  })

  test("next/prev ตอน idle ไม่ทำอะไร", () => {
    const { synth, player, changes } = setup(["ก", "ข"])
    const before = changes()
    player.next()
    player.prev()
    assert.equal(synth.spoken.length, 0)
    assert.equal(changes(), before)
  })
})

describe("SpeechPlayer — ความเร็ว", () => {
  test("ตรึง 0.8–1.4; ค่าเริ่มต้นจากตัวสร้างก็ตรึง; NaN → 1", () => {
    const { player } = setup(["ก"], 5)
    assert.equal(player.snapshot().rate, 1.4)
    player.setRate(0.1)
    assert.equal(player.snapshot().rate, 0.8)
    player.setRate(1.1)
    assert.equal(player.snapshot().rate, 1.1)
    player.setRate(Number.NaN)
    assert.equal(player.snapshot().rate, 1)
  })

  test("ขณะเล่น: เริ่มท่อนปัจจุบันใหม่ด้วยความเร็วใหม่ และท่อนถัดไปใช้ความเร็วใหม่ต่อ; ค่าเดิมไม่เริ่มใหม่", () => {
    const { synth, player } = setup(["ก", "ข"])
    player.play()
    player.setRate(1)
    assert.equal(synth.spoken.length, 1)
    const old = synth.last
    player.setRate(1.3)
    assert.equal(synth.spoken.length, 2)
    assert.equal(synth.last.text, "ก")
    assert.equal(synth.last.rate, 1.3)
    old.onend()
    assert.equal(synth.spoken.length, 2)
    synth.finish()
    assert.equal(synth.last.text, "ข")
    assert.equal(synth.last.rate, 1.3)
  })

  test("ขณะหยุดชั่วคราว/ว่าง: แค่จำค่า (ไม่พูด) แล้ว resume/play ใช้ค่าใหม่", () => {
    const { synth, player, changes } = setup(["ก"])
    player.setRate(0.9)
    assert.equal(synth.spoken.length, 0)
    assert.equal(changes() > 0, true)
    player.play()
    player.pause()
    player.setRate(1.2)
    assert.equal(synth.spoken.length, 1)
    player.resume()
    assert.equal(synth.last.rate, 1.2)
  })
})

describe("SpeechPlayer — เนื้อหาและการเลิกใช้", () => {
  test("setParagraphs เนื้อหาเดิม (อาร์เรย์ใหม่แต่เหมือนกัน) ไม่หยุดการอ่าน; เนื้อหาต่างไป → หยุดและใช้คิวใหม่", () => {
    const { synth, player } = setup(["ก", "ข"])
    player.play()
    player.setParagraphs(["ก", "ข"])
    assert.equal(view(player), "playing:0")
    player.setParagraphs(["ก", "ข", "ค"])
    assert.equal(view(player), "idle:0")
    player.play(2)
    assert.equal(synth.last.text, "ค")
  })

  test("destroy: ยกเลิกเสียง เงียบทุกการแจ้งและเหตุการณ์ต่อจากนั้น", () => {
    const { synth, player, changes } = setup(["ก", "ข"])
    player.play()
    const old = synth.last
    const cancels = synth.cancels
    const before = changes()
    player.destroy()
    assert.equal(synth.cancels, cancels + 1)
    old.onend()
    old.onerror("x")
    player.stop()
    assert.equal(synth.spoken.length, 1)
    assert.equal(changes(), before)
  })

  test("ทุกการเปลี่ยนสถานะ/ย่อหน้าแจ้ง onChange (ให้ UI อ่าน snapshot ใหม่)", () => {
    const { synth, player, changes } = setup(["ก", "ข"])
    const seen: string[] = []
    const base = changes()
    const record = () => seen.push(`${view(player)}#${changes() - base}`)
    player.play()
    record()
    synth.finish()
    record()
    player.pause()
    record()
    player.resume()
    record()
    player.stop()
    record()
    assert.deepEqual(seen, ["playing:0#1", "playing:1#2", "paused:1#3", "playing:1#4", "idle:0#5"])
  })
})

describe("SpeechPlayer — ช่องว่างที่ mutation พบ", () => {
  test("idle: index เป็น 0 เสมอ แม้ย่อหน้าแรกที่อ่านได้ไม่ใช่ย่อหน้าที่ 0", () => {
    const { player } = setup(["***", "ข้อความ"])
    assert.equal(player.snapshot().index, 0)
  })

  test("setParagraphs: จำนวนเท่ากันแต่เนื้อหาต่าง → หยุดแล้วสร้างคิวใหม่", () => {
    const { synth, player } = setup(["ก"])
    player.play()
    player.setParagraphs(["ข"])
    assert.equal(view(player), "idle:0")
    player.play()
    assert.equal(synth.last.text, "ข")
  })

  test("setParagraphs: สั้นลง (ย่อหน้าที่เหลือเหมือนเดิม) → หยุดแล้วสร้างคิวใหม่", () => {
    const { player } = setup(["ก", "ข"])
    player.play(1)
    assert.equal(view(player), "playing:1")
    player.setParagraphs(["ก"])
    assert.equal(view(player), "idle:0")
    player.play(1)
    assert.equal(view(player), "idle:0") // ย่อหน้าที่ 1 ไม่มีแล้ว
  })

  test("setParagraphs: ยาวขึ้น → อ่านย่อหน้าที่เพิ่มมาได้", () => {
    const { synth, player } = setup(["ก"])
    player.setParagraphs(["ก", "ข"])
    player.play(1)
    assert.equal(synth.last.text, "ข")
  })

  test("play(NaN / ±Infinity) เริ่มที่ย่อหน้าแรก", () => {
    for (const from of [NaN, Infinity, -Infinity]) {
      const { synth, player } = setup(["ก", "ข"])
      player.play(from)
      assert.equal(synth.last?.text, "ก", String(from))
    }
  })

  test("play ที่เส้นคั่นฉาก → ข้ามไปย่อหน้าถัดไปที่อ่านได้", () => {
    const { synth, player } = setup(["ก", "***", "ข"])
    player.play(1)
    assert.equal(synth.last.text, "ข")
    assert.equal(view(player), "playing:2")
  })

  test("คำสั่งที่เริ่มท่อนใหม่ (play/resume/next/prev/เปลี่ยนความเร็ว) ยกเลิกเสียงเดิมก่อนทุกครั้ง — ไม่งั้นเบราว์เซอร์ต่อคิวรอเสียงเก่าอ่านจบ", () => {
    const { synth, player } = setup(["ก", "ข", "ค"])
    player.play()
    assert.equal(synth.cancels, 1)
    player.pause()
    assert.equal(synth.cancels, 2)
    player.resume()
    assert.equal(synth.cancels, 3)
    player.next()
    assert.equal(synth.cancels, 4)
    player.prev()
    assert.equal(synth.cancels, 5)
    player.setRate(1.2)
    assert.equal(synth.cancels, 6)
  })

  test("ท่อนจบเอง → ท่อนถัดไปไม่สั่ง cancel (ไม่ตัดหรือรบกวนเครื่องยนต์ที่เพิ่งจบเสียงเอง)", () => {
    const { synth, player } = setup([LONG])
    player.play()
    assert.equal(synth.cancels, 1)
    synth.finish()
    synth.finish()
    assert.equal(synth.spoken.length, 3)
    assert.equal(synth.cancels, 1)
  })

  test("next ขณะหยุดชั่วคราว: แจ้ง onChange (ไฮไลต์ย้าย) โดยไม่พูด", () => {
    const { synth, player, changes } = setup(["ก", "ข"])
    player.play()
    player.pause()
    const before = changes()
    const spoken = synth.spoken.length
    player.next()
    assert.ok(changes() > before, "ต้องแจ้ง onChange")
    assert.equal(view(player), "paused:1")
    assert.equal(synth.spoken.length, spoken)
  })

  test("เครื่องยนต์ล้ม (error ของท่อนปัจจุบัน) → แจ้ง onChange และกลับ idle", () => {
    const { synth, player, changes } = setup(["ก", "ข"])
    player.play()
    const before = changes()
    synth.last.onerror("synthesis-failed")
    assert.ok(changes() > before, "ต้องแจ้ง onChange")
    assert.equal(view(player), "idle:0")
  })

  test("destroy ตอน idle ไม่ยกเลิกเสียง (ไม่ไปตัดเสียงของส่วนอื่นของหน้า)", () => {
    const { synth, player } = setup(["ก"])
    player.destroy()
    assert.equal(synth.cancels, 0)
  })

  test("หลัง destroy: รายชื่อเสียงเปลี่ยนก็ไม่แจ้ง onChange (กัน setState หลัง unmount)", () => {
    const synth = new FakeSynth()
    synth.voices = []
    let calls = 0
    const player = new SpeechPlayer(synth, () => calls++)
    player.refreshVoices()
    player.destroy()
    synth.voices = [{ lang: "en-US" }]
    player.refreshVoices()
    assert.equal(calls, 0)
  })

  test("เสียงล้มเพราะไม่มีภาษาไทย แล้วเสียงไทยกลับมา (voiceschanged) → ใช้ได้อีก", () => {
    const { synth, player } = setup(["ก"])
    player.play()
    synth.last.onerror("language-unavailable")
    assert.equal(player.snapshot().hasThaiVoice, false)
    player.refreshVoices()
    assert.equal(player.snapshot().hasThaiVoice, true)
  })
})
