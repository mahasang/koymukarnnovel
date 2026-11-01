/**
 * ตัวเล่นเสียงอ่านทีละท่อน (ไม่ผูกกับ React/เบราว์เซอร์ — รับ `SynthLike` เข้ามา เพื่อเทสต์ด้วยเครื่องยนต์เสียงจำลองได้)
 * - เล่นท่อนจาก `buildQueue` ต่อกัน · `index` = ย่อหน้าที่กำลังอ่าน (เปลี่ยนเมื่อท่อนแรกของย่อหน้าใหม่เริ่ม)
 * - หยุดชั่วคราว = ยกเลิกเสียงแล้วจำท่อนไว้ แล้วเริ่มท่อนนั้นใหม่เมื่อเล่นต่อ (Chrome บนมือถือไม่รองรับ pause จริง, Chrome เดสก์ท็อปค้างเมื่ออ่านยาว)
 * - ทุกคำสั่งที่เปลี่ยนท่อนเพิ่ม `generation` ก่อนยกเลิก: เหตุการณ์ end/error ของเสียงที่ถูกยกเลิก (เบราว์เซอร์ยิงตามหลังเสมอ) จึงไม่ทำให้คิวเดินซ้ำ
 */
import { clampRate } from "./reader-prefs"
import { buildQueue, pickThaiVoice, type SpeechItem } from "./speech"

export type SpeechState = "idle" | "playing" | "paused"

export interface VoiceLike {
  lang: string
  default?: boolean
}

export interface SpeakOptions {
  lang: string
  rate: number
  voice: VoiceLike | null
  onend(): void
  /** `error` = รหัสข้อผิดพลาดของเครื่องยนต์เสียง เช่น "canceled", "language-unavailable" */
  onerror(error: string | undefined): void
}

/** เครื่องยนต์เสียง (ของจริง = `window.speechSynthesis` ผ่านตัวแปลงใน `useSpeech.ts`) */
export interface SynthLike {
  speak(text: string, options: SpeakOptions): void
  cancel(): void
  getVoices(): VoiceLike[]
}

export interface SpeechSnapshot {
  /** เบราว์เซอร์มีเสียงอ่าน (Web Speech API) */
  supported: boolean
  /** มีเสียงไทยให้ใช้ — ยังไม่รู้ (รายชื่อเสียงยังโหลดไม่เสร็จ) นับว่ามี; `false` เมื่อโหลดแล้วไม่พบเสียงไทยหรือเครื่องยนต์ปฏิเสธเสียงไทย */
  hasThaiVoice: boolean
  state: SpeechState
  /** ย่อหน้าที่กำลังอ่าน (ใช้ได้เมื่อ state ไม่ใช่ idle; idle = 0) */
  index: number
  rate: number
}

/** ข้อผิดพลาดที่แปลว่าเครื่องนี้อ่านภาษาไทยไม่ได้จริง (ต่างจากถูกขัดจังหวะ/ไม่ได้รับอนุญาต) */
const UNAVAILABLE = new Set(["language-unavailable", "voice-unavailable", "synthesis-unavailable"])

export class SpeechPlayer {
  private queue: SpeechItem[] = []
  private paragraphs: readonly string[] = []
  /** ตำแหน่งท่อนในคิว (-1 = ไม่ได้เล่น) */
  private pos = -1
  private generation = 0
  private state: SpeechState = "idle"
  private rate: number
  private voice: VoiceLike | null = null
  private voicesLoaded = false
  private failed = false
  private disposed = false

  constructor(
    private readonly synth: SynthLike | null,
    private readonly onChange: () => void,
    rate = 1,
  ) {
    this.rate = clampRate(rate)
  }

  snapshot(): SpeechSnapshot {
    return {
      supported: this.synth !== null,
      hasThaiVoice: this.hasThaiVoice(),
      state: this.state,
      index: this.pos >= 0 ? this.queue[this.pos].para : 0,
      rate: this.rate,
    }
  }

  private hasThaiVoice(): boolean {
    if (this.synth === null || this.failed) return false
    return !this.voicesLoaded || this.voice !== null
  }

  private emit(): void {
    if (!this.disposed) this.onChange()
  }

  /** เปลี่ยนเนื้อหา (เปลี่ยนตอน) — เนื้อหาเดิมเป๊ะไม่แตะ; ต่างไป → หยุดแล้วสร้างคิวใหม่ */
  setParagraphs(paragraphs: readonly string[]): void {
    const same = paragraphs.length === this.paragraphs.length && paragraphs.every((p, i) => p === this.paragraphs[i])
    if (same) return
    this.stop()
    this.paragraphs = paragraphs
    this.queue = buildQueue(paragraphs)
  }

  /** อ่านรายชื่อเสียงใหม่ (เรียกตอนเริ่มและทุกครั้งที่เบราว์เซอร์แจ้ง `voiceschanged`) */
  refreshVoices(): void {
    if (this.synth === null) return
    const before = this.hasThaiVoice()
    const voices = this.synth.getVoices()
    if (voices.length > 0) this.voicesLoaded = true
    this.setVoice(pickThaiVoice(voices), before)
  }

  /** ถึงเวลาเลิกรอแล้วรายชื่อเสียงยังว่าง → ถือว่าโหลดแล้วและไม่มีเสียงไทย (เบราว์เซอร์ที่ไม่มีเครื่องยนต์เสียงจะไม่ยิง `voiceschanged` เลย) */
  settleVoices(): void {
    if (this.synth === null || this.voicesLoaded) return
    const before = this.hasThaiVoice()
    this.voicesLoaded = true
    this.setVoice(null, before)
  }

  /** จำเสียงที่เลือก แล้วแจ้งถ้า "มีเสียงไทยหรือไม่" เปลี่ยนไปจากค่าก่อนหน้า (`before`) */
  private setVoice(voice: VoiceLike | null, before: boolean): void {
    this.voice = voice
    if (voice !== null) this.failed = false
    if (this.hasThaiVoice() !== before) this.emit()
  }

  /** เริ่มอ่านจากย่อหน้า `from` (หรือย่อหน้าถัดไปที่มีอะไรให้อ่าน) · ไม่มีเสียงไทย/ไม่มีอะไรให้อ่าน → ไม่ทำอะไร */
  play(from = 0): void {
    if (this.synth === null || !this.hasThaiVoice()) return
    const start = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0
    const pos = this.queue.findIndex((item) => item.para >= start)
    if (pos < 0) return
    this.pos = pos
    this.state = "playing"
    this.speakCurrent(true)
    this.emit()
  }

  pause(): void {
    if (this.state !== "playing" || this.synth === null) return
    this.generation++
    this.synth.cancel()
    this.state = "paused"
    this.emit()
  }

  resume(): void {
    if (this.state !== "paused") return
    this.state = "playing"
    this.speakCurrent(true)
    this.emit()
  }

  stop(): void {
    if (this.state === "idle") return
    this.halt()
    this.emit()
  }

  /** ข้ามไปย่อหน้าถัดไปที่มีอะไรให้อ่าน (ย่อหน้าสุดท้าย → จบ) · ขณะหยุดชั่วคราวแค่ย้ายตำแหน่ง */
  next(): void {
    if (this.state === "idle") return
    const para = this.queue[this.pos].para
    const pos = this.queue.findIndex((item) => item.para > para)
    if (pos < 0) {
      this.stop()
      return
    }
    this.jump(pos)
  }

  /** กลับไปต้นย่อหน้าก่อนหน้าที่มีอะไรให้อ่าน (ย่อหน้าแรก → เริ่มย่อหน้าแรกใหม่) */
  prev(): void {
    if (this.state === "idle") return
    const para = this.queue[this.pos].para
    let target = para
    for (let i = this.pos; i >= 0; i--) {
      if (this.queue[i].para < para) {
        target = this.queue[i].para
        break
      }
    }
    this.jump(this.queue.findIndex((item) => item.para === target))
  }

  /** ความเร็ว 0.8–1.4 · ขณะเล่นเริ่มท่อนปัจจุบันใหม่ทันทีด้วยความเร็วใหม่ */
  setRate(rate: number): void {
    const next = clampRate(rate)
    if (next === this.rate) return
    this.rate = next
    if (this.state === "playing") this.speakCurrent(true)
    this.emit()
  }

  /** เลิกใช้ (unmount): ยกเลิกเสียงและเงียบเหตุการณ์ทั้งหมดต่อจากนี้ */
  destroy(): void {
    if (this.state !== "idle") this.halt()
    this.disposed = true
  }

  private halt(): void {
    this.generation++
    this.synth?.cancel()
    this.state = "idle"
    this.pos = -1
  }

  private jump(pos: number): void {
    this.pos = pos
    if (this.state === "playing") this.speakCurrent(true)
    this.emit()
  }

  /** พูดท่อนปัจจุบัน · `interrupt` = ยกเลิกเสียงที่ค้างอยู่ก่อน (ต่อท่อนถัดไปหลังท่อนเดิมจบเองไม่ต้อง) */
  private speakCurrent(interrupt: boolean): void {
    if (this.synth === null) return
    this.generation++
    if (interrupt) this.synth.cancel()
    const generation = this.generation
    this.synth.speak(this.queue[this.pos].text, {
      lang: "th-TH",
      rate: this.rate,
      voice: this.voice,
      onend: () => this.handleEnd(generation),
      onerror: (error) => this.handleError(generation, error),
    })
  }

  private handleEnd(generation: number): void {
    if (generation !== this.generation || this.state !== "playing") return
    if (this.pos + 1 < this.queue.length) {
      this.pos++
      this.speakCurrent(false)
    } else {
      this.halt()
    }
    this.emit()
  }

  private handleError(generation: number, error: string | undefined): void {
    if (generation !== this.generation || this.state === "idle") return
    // คำสั่งของเราเองเพิ่ม generation ก่อน cancel เสมอ → error ของ generation ปัจจุบันคือเครื่องยนต์ล้มเอง/ถูกขัดจากภายนอก: เลิกเล่น
    if (error !== undefined && UNAVAILABLE.has(error)) this.failed = true
    this.halt()
    this.emit()
  }
}
