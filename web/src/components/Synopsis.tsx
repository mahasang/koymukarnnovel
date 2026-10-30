/**
 * เรื่องย่อบนหน้าเรื่อง (spec 6.2): พับให้เหลือ 5 บรรทัด มีปุ่ม "อ่านเพิ่ม" เมื่อข้อความยาวเกินจริง · แสดงเป็นข้อความล้วนเสมอ (ไม่ตีความ HTML)
 * แยกเป็น `SynopsisView` (ไม่มี state ทดสอบง่าย) กับ `Synopsis` (วัดบนหน้าจอจริงว่าล้นหรือไม่ — วัดได้เฉพาะในเบราว์เซอร์)
 */
import { useLayoutEffect, useRef, useState, type Ref } from "react"

/** จำนวนบรรทัดที่พับ — ค่าเดียวกับ `-webkit-line-clamp` ของ `.nv-syn` ใน public.css (เทสต์ตรึงไว้ทั้งสองฝั่ง) */
export const SYNOPSIS_LINES = 5

const HEADING_ID = "synopsis-title"
const TEXT_ID = "synopsis-text"

export interface SynopsisViewProps {
  text: string
  expanded: boolean
  /** ข้อความยาวเกินพื้นที่ที่พับ (วัดจากหน้าจอจริง) → มีปุ่มขยาย */
  overflowing: boolean
  onToggle: () => void
  /** ตัวอ้างอิงถึงย่อหน้าเนื้อหา — `Synopsis` ใช้วัดว่าล้นหรือไม่ */
  textRef?: Ref<HTMLParagraphElement>
}

export function SynopsisView({ text, expanded, overflowing, onToggle, textRef }: SynopsisViewProps) {
  const body = text.trim()
  if (body === "") return null
  return (
    <section className="nv-sec" aria-labelledby={HEADING_ID}>
      <h2 className="nv-h" id={HEADING_ID}>
        เรื่องย่อ
      </h2>
      <p className={expanded ? "nv-syn open" : "nv-syn"} id={TEXT_ID} ref={textRef}>
        {body}
      </p>
      {/* ขยายแล้วข้อความไม่ถูกตัด จึงวัดไม่ได้ว่าล้น — ปุ่มต้องคงอยู่ให้ย่อกลับ */}
      {overflowing || expanded ? (
        <button type="button" className="btn ghost nv-more" aria-expanded={expanded} aria-controls={TEXT_ID} onClick={onToggle}>
          {expanded ? "ย่อ" : "อ่านเพิ่ม"}
        </button>
      ) : null}
    </section>
  )
}

export function Synopsis({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  // วัดเฉพาะตอนพับอยู่ (ตอนขยายไม่ถูกตัด วัดแล้วได้ "ไม่ล้น" เสมอ) และวัดใหม่เมื่อความกว้างเปลี่ยนเพราะบรรทัดตัดคำต่างไป
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || expanded) return undefined
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, expanded])

  return <SynopsisView text={text} expanded={expanded} overflowing={overflowing} onToggle={() => setExpanded((open) => !open)} textRef={ref} />
}
