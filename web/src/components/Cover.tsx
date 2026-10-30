/**
 * ปกนิยาย 2:3 — มีรูปปกใช้รูปจากเซิร์ฟเวอร์ · ไม่มี หรือรูปโหลดไม่ขึ้น ใช้ปกอัตโนมัติ (พื้นไล่สีจากชื่อเรื่อง + ลาย + ชื่อเรื่อง)
 * แยกเป็น `CoverView` (ไม่มี state ทดสอบง่าย) กับ `Cover` (จำว่ารูปไหนโหลดไม่ขึ้น)
 */
import { useState } from "react"
import { coverBackground, coverUrl, placeholderCover } from "../lib/cover"
import { CoverArt } from "./CoverArt"

export interface CoverNovel {
  id: number
  /** ชื่อที่จะเขียนบนปกอัตโนมัติ (และใช้เลือกสี/ลาย) — ผู้เรียกส่งชื่อที่แสดงอยู่ข้างๆ (ชื่อไทยก่อน) เพื่อให้ปกกับหัวข้อตรงกัน */
  title: string
  hasCover: boolean
  coverV: number
}

export interface CoverViewProps {
  novel: CoverNovel
  /**
   * คำอธิบายรูปสำหรับโปรแกรมอ่านหน้าจอ — ไม่ส่ง = ภาพประดับ (ในการ์ดที่มีชื่อเรื่องอยู่ข้างๆ แล้ว)
   * หน้านิยายที่ปกเป็นรูปเดียวของเรื่องควรส่งมา
   */
  alt?: string
  /** รูปปกโหลดไม่ขึ้น → ใช้ปกอัตโนมัติแทน */
  failed: boolean
  onImageError: () => void
}

export function CoverView({ novel, alt, failed, onImageError }: CoverViewProps) {
  const url = coverUrl(novel)
  if (url !== null && !failed) {
    return (
      <div className="cv">
        <img className="cv-img" src={url} alt={alt ?? ""} loading="lazy" decoding="async" onError={onImageError} />
      </div>
    )
  }
  const art = placeholderCover(novel.title)
  const described = alt !== undefined && alt !== ""
  const a11y = described ? ({ role: "img", "aria-label": alt } as const) : ({ "aria-hidden": "true" } as const)
  return (
    <div className="cv cv-placeholder" style={{ background: coverBackground(art.colors) }} {...a11y}>
      <CoverArt motif={art.motif} seed={art.seed} />
      <div className="cv-title">{novel.title}</div>
    </div>
  )
}

/** รูปปกของ URL นี้เคยโหลดไม่ขึ้นหรือไม่ — ต้องมีรูป (url ไม่ใช่ null) และเป็น URL เดียวกับที่จำไว้ว่าโหลดไม่ขึ้น (อัปโหลดปกใหม่ → URL เปลี่ยน → ลองโหลดใหม่) */
export function imageFailed(url: string | null, failedUrl: string | null): boolean {
  return url !== null && failedUrl === url
}

export function Cover({ novel, alt }: { novel: CoverNovel; alt?: string }) {
  const url = coverUrl(novel)
  // จำ URL ที่โหลดไม่ขึ้น (ไม่ใช่แค่ true/false) — อัปโหลดปกใหม่แล้ว `coverV` เปลี่ยน URL เปลี่ยน ก็ลองโหลดรูปใหม่เอง
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return <CoverView novel={novel} alt={alt} failed={imageFailed(url, failedUrl)} onImageError={() => setFailedUrl(url)} />
}
