/**
 * แถบบนของหน้าอ่าน (spec 6.3): ← ชื่อเรื่อง · ตอนที่ N · สารบัญ · ฟังเสียง · ตั้งค่าการอ่าน (Aa) และเส้นบอกว่าอ่านไปแล้วกี่เปอร์เซ็นต์ที่ขอบบน
 * ซ่อนเมื่อเลื่อนลง โผล่เมื่อเลื่อนขึ้น (ตรรกะอยู่ใน `lib/reader.ts`) · ขณะฟังเสียงมีแถวควบคุม: ย่อหน้าก่อน / หยุด-เล่นต่อ / ย่อหน้าถัดไป / ความเร็ว
 * ไม่มี state/effect — หน้าอ่านส่งทุกอย่างเข้ามา (ทดสอบโครงสร้างและการผูก handler ได้)
 */
import { ArrowLeft, Headphones, List, Pause, Play, SkipBack, SkipForward, Type } from "lucide-react"
import type { Ref } from "react"
import { Link } from "react-router"
import { MESSAGES, type Messages } from "../i18n/messages"
import { RATE_MAX, RATE_MIN } from "../lib/reader-prefs"
import type { SpeechState } from "../lib/speech-player"

export interface ReaderBarProps {
  novelId: number
  novelTitle: string
  number: number
  /** แถบอยู่ในจอหรือซ่อนอยู่ */
  visible: boolean
  /** อ่านไปแล้วกี่เปอร์เซ็นต์ (0–100) */
  pct: number
  /** ปุ่มฟังเสียงมีให้ใช้ (เบราว์เซอร์มีเสียงอ่านและเสียงไทย) */
  listenAvailable: boolean
  speechState: SpeechState
  rate: number
  settingsOpen: boolean
  /** id ของแผงตั้งค่า — ปุ่ม Aa ผูก `aria-controls` กับ id นี้ตอนแผงเปิด */
  settingsId: string
  onToggleSettings: () => void
  onListen: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  onPrev: () => void
  onNext: () => void
  onRate: (rate: number) => void
  /** กรอบนอก (ใช้วัดความสูงแถบ) และปุ่ม Aa (แผงตั้งค่าใช้ย้ายโฟกัสกลับ/ไม่นับว่าคลิกนอกแผง) */
  rootRef?: Ref<HTMLElement>
  settingsButtonRef?: Ref<HTMLButtonElement>
  /** ชุดข้อความ — ไม่ส่ง = ภาษาไทย (ไม่ใช้ hook เพื่อให้เทสต์เรียกเป็นฟังก์ชันตรงๆ ได้; หน้าอ่านส่งให้) */
  m?: Messages
}

export function ReaderBar(props: ReaderBarProps) {
  const { novelId, novelTitle, number, visible, pct, listenAvailable, speechState, rate, settingsOpen, settingsId, m = MESSAGES.th } = props
  const t = m.reader.bar
  const listening = speechState !== "idle"
  const paused = speechState === "paused"
  const novelPath = `/novel/${novelId}`

  return (
    <header className={visible ? "rb" : "rb hidden"} ref={props.rootRef}>
      <div className="rb-progress" role="progressbar" aria-label={t.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span className="rb-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="rb-row">
        <Link to={novelPath} className="iconbtn" aria-label={t.back}>
          <ArrowLeft aria-hidden="true" size={18} />
        </Link>
        <div className="rb-info">
          <span className="rb-novel">{novelTitle}</span>
          <span className="rb-chapter">{t.chapter(number)}</span>
        </div>
        <div className="rb-actions">
          <Link to={novelPath} className="iconbtn" aria-label={t.toc}>
            <List aria-hidden="true" size={18} />
          </Link>
          {listenAvailable ? (
            <button type="button" className={listening ? "iconbtn on" : "iconbtn"} aria-label={listening ? t.stopListen : t.listen} aria-pressed={listening} onClick={listening ? props.onStop : props.onListen}>
              <Headphones aria-hidden="true" size={18} />
            </button>
          ) : null}
          <button
            type="button"
            className={settingsOpen ? "iconbtn on" : "iconbtn"}
            aria-label={t.settings}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-controls={settingsOpen ? settingsId : undefined}
            onClick={props.onToggleSettings}
            ref={props.settingsButtonRef}
          >
            <Type aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      {listening ? (
        <div className="rb-player" role="group" aria-label={t.player}>
          <button type="button" className="iconbtn" aria-label={t.prevPara} onClick={props.onPrev}>
            <SkipBack aria-hidden="true" size={18} />
          </button>
          <button type="button" className="iconbtn rb-play" aria-label={paused ? t.resume : t.pause} onClick={paused ? props.onResume : props.onPause}>
            {paused ? <Play aria-hidden="true" size={18} /> : <Pause aria-hidden="true" size={18} />}
          </button>
          <button type="button" className="iconbtn" aria-label={t.nextPara} onClick={props.onNext}>
            <SkipForward aria-hidden="true" size={18} />
          </button>
          <label className="rb-rate">
            <span className="rb-rate-label">{t.speed}</span>
            <input
              type="range"
              className="rb-range"
              min={RATE_MIN}
              max={RATE_MAX}
              step={0.1}
              value={rate}
              aria-valuetext={t.rateValue(rate)}
              onChange={(event) => props.onRate(Number(event.currentTarget.value))}
            />
            <output className="rb-rate-value">{rate.toFixed(1)}×</output>
          </label>
        </div>
      ) : null}
    </header>
  )
}
