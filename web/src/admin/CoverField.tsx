/**
 * ช่องปกในฟอร์มนิยาย (spec 7.4): เลือกไฟล์ → ครอบ 2:3 ย่อ 400×600 JPEG ในเบราว์เซอร์ → ตัวอย่าง → อัปโหลด
 * แก้ไขเรื่องเดิม: เห็นตัวอย่างก่อนแล้วกด "ใช้ปกนี้" (ปกบันทึกด้วยคำขอของมันเอง ไม่รอปุ่มบันทึกฟอร์ม)
 * สร้างเรื่องใหม่: ยังไม่มีรหัสเรื่องให้ส่งปก จึงเก็บตัวอย่างไว้ที่ฟอร์ม แล้วอัปโหลดต่อท้ายตอนกด "สร้างเรื่อง"
 * `CoverFieldView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `CoverField` ถือสถานะกำลังทำงาน/ข้อผิดพลาด/กล่องยืนยันลบ และเรียก API
 */
import { ImagePlus } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { Cover } from "../components/Cover"
import { cropFileToCoverBase64 } from "../lib/cover-crop"
import { ApiError } from "../lib/api"
import { admin } from "./adminApi"
import { useMounted } from "./useMounted"

export const pendingCoverSrc = (base64: string): string => `data:image/jpeg;base64,${base64}`

export type CoverBusy = "crop" | "upload" | "delete" | null

export interface CoverFieldViewProps {
  mode: "create" | "edit"
  /** รูปที่แสดง: ตัวอย่างที่เพิ่งเลือก, ปกที่บันทึกแล้ว หรือปกอัตโนมัติ */
  cover: ReactNode
  /** มีรูปที่เลือกไว้แต่ยังไม่ได้อัปโหลด */
  hasPending: boolean
  /** เรื่องนี้มีปกบันทึกอยู่แล้ว */
  hasSaved: boolean
  busy: CoverBusy
  error: string | null
  onFile(file: File): void
  onUpload(): void
  onDiscard(): void
  onRemove(): void
}

export function CoverFieldView(p: CoverFieldViewProps) {
  const busy = p.busy !== null
  const pickLabel = p.hasPending || p.hasSaved ? "เปลี่ยนรูปปก" : "เลือกรูปปก"
  return (
    <div className="ad-cover-field">
      <div className="ad-cover-preview">{p.cover}</div>
      <div className="ad-cover-side">
        <label className="btn ghost sm ad-file">
          <ImagePlus size={17} aria-hidden="true" />
          {pickLabel}
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = "" // เลือกไฟล์เดิมซ้ำแล้วต้องเกิด change อีกครั้ง
              if (file !== undefined) p.onFile(file)
            }}
          />
        </label>
        {p.hasPending && p.mode === "edit" && (
          <>
            <p className="ad-hint">ตัวอย่างนี้ยังไม่ได้อัปโหลด — กด “ใช้ปกนี้” เพื่อบันทึกเป็นปกของเรื่อง</p>
            <div className="ad-cover-actions">
              <button type="button" className="btn primary sm" disabled={busy} onClick={p.onUpload}>
                {p.busy === "upload" ? "กำลังอัปโหลด…" : "ใช้ปกนี้"}
              </button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={p.onDiscard}>
                ยกเลิก
              </button>
            </div>
          </>
        )}
        {p.hasPending && p.mode === "create" && (
          <>
            <p className="ad-hint">ปกนี้จะอัปโหลดให้เองเมื่อกด “สร้างเรื่อง”</p>
            <div className="ad-cover-actions">
              <button type="button" className="btn ghost sm" disabled={busy} onClick={p.onDiscard}>
                เอารูปออก
              </button>
            </div>
          </>
        )}
        {!p.hasPending && p.hasSaved && (
          <div className="ad-cover-actions">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={p.onRemove}>
              {p.busy === "delete" ? "กำลังลบ…" : "ลบปก"}
            </button>
          </div>
        )}
        {!p.hasPending && !p.hasSaved && p.mode === "create" && <p className="ad-hint">ไม่เลือกรูป = ใช้ปกอัตโนมัติจากชื่อเรื่อง (เปลี่ยนทีหลังได้)</p>}
        {p.busy === "crop" && (
          <p className="ad-hint" role="status">
            กำลังย่อรูป…
          </p>
        )}
        <p className="ad-hint">ระบบครอบกึ่งกลางเป็นอัตราส่วน 2:3 แล้วย่อเป็น 400×600 พิกเซล (JPEG ไม่เกิน 500KB) ก่อนอัปโหลด</p>
        {p.error !== null && (
          <p className="ad-field-error" role="alert">
            {p.error}
          </p>
        )}
      </div>
    </div>
  )
}

const messageOf = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

export interface CoverFieldProps {
  /** เรื่องที่มีอยู่แล้ว (แก้ไข) หรือ null (กำลังสร้างเรื่องใหม่) */
  novel: { id: number; hasCover: boolean; coverV: number } | null
  /** ชื่อที่จะเขียนบนปกอัตโนมัติ (ชื่อไทยก่อน) */
  title: string
  /** ฐานสอง JPEG ของรูปที่เลือกไว้แต่ยังไม่อัปโหลด */
  pending: string | null
  onPending(base64: string | null): void
  /** อัปโหลดสำเร็จ: เวลาแก้ปกใหม่ (`coverV`) */
  onSaved(coverV: number): void
  onRemoved(): void
}

export function CoverField({ novel, title, pending, onPending, onSaved, onRemoved }: CoverFieldProps) {
  const [busy, setBusy] = useState<CoverBusy>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const mounted = useMounted()
  const working = useRef(false)

  async function pick(file: File): Promise<void> {
    if (working.current) return
    working.current = true
    setBusy("crop")
    setError(null)
    try {
      const base64 = await cropFileToCoverBase64(file)
      if (mounted.current) onPending(base64)
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setBusy(null)
    }
  }

  async function upload(): Promise<void> {
    if (working.current || novel === null || pending === null) return
    working.current = true
    setBusy("upload")
    setError(null)
    try {
      const { coverV } = await admin.putCover(novel.id, pending)
      if (!mounted.current) return
      onPending(null)
      onSaved(coverV)
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    if (novel === null) return
    await admin.deleteCover(novel.id) // ล้มเหลว → ConfirmDialog แสดงข้อความเอง
    setConfirmRemove(false)
    onRemoved()
  }

  const cover =
    pending !== null ? (
      <div className="cv">
        <img className="cv-img" src={pendingCoverSrc(pending)} alt="ตัวอย่างปกที่เลือก" />
      </div>
    ) : (
      <Cover novel={{ id: novel?.id ?? 0, title, hasCover: novel?.hasCover ?? false, coverV: novel?.coverV ?? 0 }} alt={novel?.hasCover ? "ปกปัจจุบัน" : undefined} />
    )

  return (
    <>
      <CoverFieldView
        mode={novel === null ? "create" : "edit"}
        cover={cover}
        hasPending={pending !== null}
        hasSaved={novel?.hasCover ?? false}
        busy={busy}
        error={error}
        onFile={(file) => void pick(file)}
        onUpload={() => void upload()}
        onDiscard={() => {
          setError(null)
          onPending(null)
        }}
        onRemove={() => setConfirmRemove(true)}
      />
      {confirmRemove && (
        <ConfirmDialog
          title="ลบปกของเรื่องนี้?"
          message="ปกที่อัปโหลดไว้จะถูกลบ แล้วเรื่องนี้จะกลับไปใช้ปกอัตโนมัติจากชื่อเรื่อง"
          confirmLabel="ลบปก"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </>
  )
}
