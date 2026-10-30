/**
 * กล่องยืนยันของหลังบ้าน (แทน `confirm()` ของเบราว์เซอร์): ปุ่มอันตรายสีแดง, Esc/คลิกฉากหลัง = ยกเลิก, โฟกัสวนอยู่ในกล่อง, คืนโฟกัสให้ปุ่มที่เปิด
 * ผู้ใช้ครอบด้วยเงื่อนไขเอง (`{pending && <ConfirmDialog …/>}`) · `onConfirm` คืน Promise ได้:
 * ระหว่างรอ ปุ่มถูกปิดและกล่องปิดเองไม่ได้ · สำเร็จ → ผู้ใช้ถอดกล่องออก · ล้มเหลว → แสดงข้อความในกล่องแล้วให้ลองอีกครั้งหรือยกเลิก
 * ไม่ใช้ portal (ตัวเรนเดอร์ฝั่งเซิร์ฟเวอร์ที่ใช้ทดสอบไม่รองรับ): กล่องเป็น `position: fixed` เต็มจอ จึงซ้อนทับหน้าได้ทุกที่
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react"
import { ApiError } from "../lib/api"
import { dialogKeyAction, focusableIn } from "../lib/focus"

export interface ConfirmDialogViewProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  busy: boolean
  error: string | null
  titleId: string
  descId: string
  onConfirm(): void
  onCancel(): void
  onKeyDown(event: KeyboardEvent<HTMLElement>): void
  dialogRef?: Ref<HTMLDivElement>
  cancelRef?: Ref<HTMLButtonElement>
  confirmRef?: Ref<HTMLButtonElement>
}

/** ส่วนแสดงผลล้วน (ไม่มี hook) — ทดสอบด้วยการเรียกตรงๆ */
export function ConfirmDialogView(p: ConfirmDialogViewProps) {
  return (
    <div
      className="ad-scrim"
      onMouseDown={(event) => {
        // เฉพาะการกดที่ฉากหลังเอง: กดข้างในกล่องแล้วลากมาปล่อยนอกกล่อง (เลือกข้อความ) ต้องไม่ปิด และกดข้างในต้องโฟกัส/พิมพ์ได้ตามปกติ
        if (event.target !== event.currentTarget) return
        event.preventDefault() // ไม่ให้โฟกัสหลุดไปที่ body
        if (!p.busy) p.onCancel()
      }}
    >
      <div className="ad-dialog" role="alertdialog" aria-modal="true" aria-labelledby={p.titleId} aria-describedby={p.descId} tabIndex={-1} ref={p.dialogRef} onKeyDown={p.onKeyDown}>
        <h2 id={p.titleId} className="ad-dialog-title">
          {p.title}
        </h2>
        <div id={p.descId} className="ad-dialog-body">
          {p.message}
        </div>
        {p.error !== null && (
          <p className="ad-dialog-error" role="alert">
            {p.error}
          </p>
        )}
        <div className="ad-dialog-actions">
          <button type="button" className="btn ghost" ref={p.cancelRef} disabled={p.busy} onClick={p.onCancel}>
            {p.cancelLabel}
          </button>
          <button type="button" className={p.danger ? "btn danger" : "btn primary"} ref={p.confirmRef} disabled={p.busy} onClick={p.onConfirm}>
            {p.busy ? "กำลังดำเนินการ…" : p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** การกระทำที่ย้อนไม่ได้ (ลบ ฯลฯ): ปุ่มยืนยันสีแดง และโฟกัสแรกอยู่ที่ "ยกเลิก" กันกด Enter พลาด */
  danger?: boolean
  onConfirm(): void | Promise<void>
  onCancel(): void
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = "ยกเลิก", danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const wasBusy = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // เปิด: จำตัวที่โฟกัสอยู่ ล็อกการเลื่อนหน้า ย้ายโฟกัสเข้ากล่อง และดึงโฟกัสกลับถ้าหลุดออกนอกกล่อง · ปิด: คืนทุกอย่าง
  useEffect(() => {
    mounted.current = true
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    ;(danger ? cancelRef : confirmRef).current?.focus()
    const dialog = dialogRef.current
    const keepInside = (event: FocusEvent) => {
      if (dialog === null || (event.target instanceof Node && dialog.contains(event.target))) return
      const [first] = focusableIn(dialog)
      ;(first ?? dialog).focus()
    }
    document.addEventListener("focusin", keepInside)
    return () => {
      mounted.current = false
      document.removeEventListener("focusin", keepInside)
      document.body.style.overflow = overflow
      if (opener !== null && document.contains(opener)) opener.focus()
    }
    // ทำงานครั้งเดียวตอนเปิด: โฟกัสแรกตามค่า danger ของตอนนั้น (โปรเจกต์ไม่มี eslint จึงไม่มีกฎ exhaustive-deps ให้ปิด)
  }, [])

  // ปุ่มถูกปิดตอนกำลังทำงาน (โฟกัสจะหลุดไป body): พักโฟกัสที่ตัวกล่องให้แป้นยังอยู่ในกล่อง · ทำเสร็จแล้วยังเปิดอยู่ (ล้มเหลว) → กลับไปที่ "ยกเลิก"
  useEffect(() => {
    if (busy) dialogRef.current?.focus()
    else if (wasBusy.current) cancelRef.current?.focus()
    wasBusy.current = busy
  }, [busy])

  async function confirm(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      if (mounted.current) setError(e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const dialog = dialogRef.current
    if (dialog === null) return
    const items = focusableIn(dialog)
    const active = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
    const action = dialogKeyAction(event.key, event.shiftKey, { busy, count: items.length, active })
    if (action === null) return
    event.preventDefault()
    if (action.type === "cancel") onCancel()
    else (action.target === "dialog" ? dialog : items[action.target])?.focus()
  }

  return (
    <ConfirmDialogView
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      danger={danger}
      busy={busy}
      error={error}
      titleId={titleId}
      descId={descId}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      dialogRef={dialogRef}
      cancelRef={cancelRef}
      confirmRef={confirmRef}
    />
  )
}
