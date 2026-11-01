/**
 * เสียงอ่านของหน้าอ่าน — ตัวเชื่อม React กับ `window.speechSynthesis`
 * ตรรกะทั้งหมด (คิวท่อน หยุด/ข้าม ความเร็ว เหตุการณ์ค้าง) อยู่ใน `SpeechPlayer` ที่เทสต์ด้วยเครื่องยนต์จำลอง; ที่นี่มีแค่การต่อสาย:
 * สร้างตัวเล่นตอนติดตั้ง · ส่งย่อหน้าล่าสุดให้ · ฟัง `voiceschanged` (Chrome ส่งรายชื่อเสียงมาทีหลัง) · รอรายชื่อเสียงไม่เกิน 2.5 วินาที · หยุดเมื่อออกจากหน้า
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { clampRate } from "./reader-prefs"
import { SpeechPlayer, type SpeechSnapshot, type SynthLike } from "./speech-player"

/** รอรายชื่อเสียงนานเท่านี้ (มิลลิวินาที) ถ้ายังว่างถือว่าเครื่องนี้ไม่มีเสียงไทย */
export const VOICES_WAIT_MS = 2500

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
}

/** `window.speechSynthesis` ในรูปที่ตัวเล่นใช้ */
function browserSynth(): SynthLike | null {
  if (!hasSpeechSynthesis()) return null
  const synth = window.speechSynthesis
  return {
    getVoices: () => synth.getVoices(),
    cancel: () => synth.cancel(),
    speak(text, options) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = options.lang
      utterance.rate = options.rate
      if (options.voice !== null) utterance.voice = options.voice as SpeechSynthesisVoice
      utterance.onend = () => options.onend()
      utterance.onerror = (event) => options.onerror(event.error)
      synth.speak(utterance)
    },
  }
}

export interface Speech extends SpeechSnapshot {
  setRate(rate: number): void
  /** เริ่มอ่านจากย่อหน้า `from` (ไม่ระบุ = ย่อหน้าแรก) */
  play(from?: number): void
  pause(): void
  resume(): void
  stop(): void
  next(): void
  prev(): void
}

export function useSpeech(paragraphs: string[], initialRate = 1): Speech {
  const playerRef = useRef<SpeechPlayer | null>(null)
  // ก่อนติดตั้ง (และตอนเรนเดอร์ฝั่งเซิร์ฟเวอร์): บอกแค่ว่าเบราว์เซอร์รองรับไหม — ถือว่ามีเสียงไทยไว้ก่อน ปุ่มฟังจะได้ไม่กะพริบ
  const [snapshot, setSnapshot] = useState<SpeechSnapshot>(() => {
    const supported = hasSpeechSynthesis()
    return { supported, hasThaiVoice: supported, state: "idle", index: 0, rate: clampRate(initialRate) }
  })

  useEffect(() => {
    const synth = browserSynth()
    const player = new SpeechPlayer(synth, () => setSnapshot(player.snapshot()), initialRate)
    playerRef.current = player
    player.refreshVoices()
    const refresh = () => player.refreshVoices()
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh)
    const timer = window.setTimeout(() => player.settleVoices(), VOICES_WAIT_MS)
    setSnapshot(player.snapshot())
    return () => {
      window.clearTimeout(timer)
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh)
      player.destroy()
      playerRef.current = null
    }
    // ตัวเล่นสร้างครั้งเดียวต่อการติดตั้ง — ความเร็วเริ่มต้นใช้ตอนสร้างเท่านั้น (ตอนปรับใช้ setRate)
  }, [])

  // เนื้อหาเปลี่ยน (เปลี่ยนตอน) → ตัวเล่นหยุดและสร้างคิวใหม่ (เนื้อหาเดิมไม่แตะ) — effect นี้ประกาศหลัง effect ติดตั้ง จึงรันหลังตัวเล่นเกิดแล้วเสมอ
  useEffect(() => {
    playerRef.current?.setParagraphs(paragraphs)
  }, [paragraphs])

  const setRate = useCallback((rate: number) => playerRef.current?.setRate(rate), [])
  const play = useCallback((from?: number) => playerRef.current?.play(from), [])
  const pause = useCallback(() => playerRef.current?.pause(), [])
  const resume = useCallback(() => playerRef.current?.resume(), [])
  const stop = useCallback(() => playerRef.current?.stop(), [])
  const next = useCallback(() => playerRef.current?.next(), [])
  const prev = useCallback(() => playerRef.current?.prev(), [])

  return { ...snapshot, setRate, play, pause, resume, stop, next, prev }
}
