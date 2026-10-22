import { Router } from "express"
import type { AppDeps } from "./app.js"
import { isAdminRequest } from "./http/admin/auth.js"
import { idParam } from "./http/validate.js"
import { notFound } from "./util/errors.js"

/** ปกนิยายเก็บในฐานข้อมูล (ตาราง `covers`) ใหญ่สุด 500KB — ฝั่งเว็บย่อรูปก่อนอัปโหลด */
export const MAX_COVER_BYTES = 500 * 1024

export type CoverMime = "image/jpeg" | "image/png" | "image/webp"

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const RIFF = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] // "WEBP" (ต่อจากขนาด 4 ไบต์ ซึ่งไม่ตรวจ)

/** ไบต์ที่เกินความยาวไฟล์อ่านได้ `undefined` ซึ่งไม่เท่ากับไบต์ใดๆ ไฟล์ที่สั้นกว่าลายเซ็นจึงไม่ผ่านเอง */
const hasBytesAt = (buf: Buffer, at: number, bytes: readonly number[]): boolean => bytes.every((b, i) => buf[at + i] === b)

/**
 * ชนิดรูปจากไบต์แรกของไฟล์เท่านั้น (ไม่เชื่อนามสกุลหรือ mime ที่ผู้ใช้บอก) · รับเฉพาะ JPEG, PNG, WebP
 * GIF/SVG/HTML และไฟล์อื่นที่อาจแฝงสคริปต์ไม่ผ่าน → null
 */
export function detectImage(buf: Buffer): CoverMime | null {
  if (hasBytesAt(buf, 0, JPEG)) return "image/jpeg"
  if (hasBytesAt(buf, 0, PNG)) return "image/png"
  if (hasBytesAt(buf, 0, RIFF) && hasBytesAt(buf, 8, WEBP)) return "image/webp"
  return null
}

const COVER = "ปกนี้"
const PUBLIC_CACHE = "public, max-age=604800"
const DRAFT_CACHE = "private, no-store"

/**
 * `GET /covers/:novelId` (สาธารณะ): ปกของเรื่องที่เผยแพร่แล้วเท่านั้น · เรื่องที่ซ่อนอยู่เห็นได้เฉพาะผู้ดูแล (และไม่ถูก cache)
 * ไม่มีเรื่อง/ไม่มีปก/เรื่องที่ซ่อน (สำหรับคนทั่วไป) ตอบ 404 ข้อความเดียวกันทุกตัวอักษร ผู้อ่านจึงเดาไม่ได้ว่ามีเรื่องซ่อนอยู่
 * ตั้ง Content-Type และ nosniff เอง (ไม่พึ่งหัวรวมของแอป) · ETag มาจากไบต์ของรูป (Express ทำให้เมื่อส่ง Buffer) และตอบ 304 ให้เอง
 */
export function createCoversRouter(deps: AppDeps): Router {
  const router = Router()

  router.get("/:novelId", (req, res) => {
    const id = idParam(req.params.novelId, COVER)
    const cover = deps.db.get<{ mime: string; data: Uint8Array; published: number }>(
      "SELECT cv.mime AS mime, cv.data AS data, n.published AS published FROM covers cv JOIN novels n ON n.id = cv.novel_id WHERE cv.novel_id = ?",
      id,
    )
    if (cover === undefined || (cover.published !== 1 && !isAdminRequest(deps, req))) throw notFound(`ไม่พบ${COVER}`)

    res.setHeader("Content-Type", cover.mime)
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Cache-Control", cover.published === 1 ? PUBLIC_CACHE : DRAFT_CACHE)
    res.send(Buffer.from(cover.data))
  })

  return router
}
