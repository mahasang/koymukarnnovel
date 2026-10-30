/**
 * ชนิดข้อมูลของหลังบ้าน (`/api/admin/*`) — ประกาศซ้ำจาก `server/src/http/dto.ts` และ `queue.ts` (หน้าเว็บ import โค้ดฝั่งเซิร์ฟเวอร์ไม่ได้)
 * ห้ามแก้ให้เพี้ยน: `e2e/web-contract.ts` ตรวจตอน `npm run typecheck` ว่าตรงกับของจริงทุกช่อง ทั้งสองทิศ
 * ช่องเวลา (`createdAt`, `publishedAt` …) เป็นข้อความ `YYYY-MM-DD HH:MM:SS` เวลา UTC เหมือนหน้าบ้าน
 */
import type { AccentId, NovelStatus } from "../lib/types.js"

export type { AccentId, NovelStatus }
export type NovelMode = "translate" | "story"
export type ChapterStatus = "draft" | "queued" | "translating" | "done" | "error"

/** `GET /api/admin/me` */
export interface MeDto {
  admin: true
  /** ไม่ได้ตั้ง ADMIN_PASSWORD: เปิดหลังบ้านได้เลยบนเครื่องนี้ ไม่มีหน้าล็อกอิน */
  passwordless: boolean
}

/** นิยายหนึ่งเรื่องในมุมมองผู้ดูแล */
export interface AdminNovelDto {
  id: number
  title: string
  titleTh: string
  author: string
  synopsis: string
  synopsisSrc: string
  tags: string[]
  status: NovelStatus
  sourceUrl: string
  licenseNote: string
  styleNote: string
  mode: NovelMode
  published: boolean
  featured: boolean
  hasCover: boolean
  /** เวลาแก้ปกล่าสุดเป็นวินาที epoch (0 = ไม่มีปก) ใช้เป็น `?v=` */
  coverV: number
  chapterCount: number
  translatedCount: number
  publishedCount: number
  createdAt: string
  updatedAt: string
}

/** ตอนหนึ่งในตารางตอนของเรื่อง (แถวเบา: ไม่มีต้นฉบับ/คำแปล) */
export interface AdminChapterRow {
  id: number
  number: number
  title: string
  titleTh: string
  status: ChapterStatus
  error: string
  published: boolean
  publishedAt: string | null
  translatedAt: string | null
  queueSeq: number | null
  hasTranslation: boolean
  /** ความยาวต้นฉบับเป็นจำนวนตัวอักษร */
  srcLength: number
}

/** ตอนเดียวเต็มๆ (หน้าแก้ตอน) */
export interface AdminChapterDto {
  id: number
  novelId: number
  number: number
  title: string
  titleTh: string
  sourceText: string
  translation: string
  recap: string
  status: ChapterStatus
  error: string
  published: boolean
  publishedAt: string | null
  translatedAt: string | null
  queueSeq: number | null
  autoPublish: boolean
  createdAt: string
  updatedAt: string
}

/** คำศัพท์หนึ่งรายการในอภิธานของเรื่อง (`auto` = AI เสนอเองและเจ้าของยังไม่เคยแก้) */
export interface GlossaryDto {
  id: number
  source: string
  thai: string
  note: string
  auto: boolean
}

/** ตอนที่แปลผิดพลาดในรายการของหน้าคิว */
export interface QueueError {
  id: number
  novelId: number
  novelTitle: string
  number: number
  error: string
}

/** สถานะสดของคิวแปล (`GET /api/admin/queue` ก่อนต่อ `errors`) */
export interface QueueState {
  paused: boolean
  pausedReason: string
  /** ตอนที่ผิดพลาดติดกัน — ครบ 3 คิวหยุดเอง */
  consecutiveErrors: number
  /** จำนวนตอนที่รออยู่ทั้งหมด (`waiting` แสดงแค่ 50 ตอนแรก) */
  waitingTotal: number
  /** ตอนที่กำลังแปล (`chunkIndex` นับจาก 0) · `textTail` = ท้ายของผลที่ไหลอยู่ */
  current: null | {
    chapterId: number
    novelId: number
    novelTitle: string
    number: number
    chunkIndex: number
    chunkTotal: number
    textTail: string
  }
  waiting: { id: number; novelId: number; novelTitle: string; number: number }[]
}

export type QueueDto = QueueState & { errors: QueueError[] }

export interface UsageRowDto {
  model: string
  tokensIn: number
  tokensOut: number
  calls: number
}

export interface NovelProgressDto {
  novelId: number
  title: string
  translated: number
  total: number
  published: number
}

/** ผลทดสอบ API ครั้งล่าสุดที่เก็บไว้ (`at` เวลา UTC รูปแบบฐานข้อมูล) */
export interface ApiCheckDto {
  at: string
  ok: boolean
  message: string
}

/** `GET /api/admin/dashboard` */
export interface DashboardDto {
  onboarding: { apiKey: boolean; contact: boolean; firstNovel: boolean }
  counts: { publishedNovels: number; totalNovels: number; publishedChapters: number; queued: number; errors: number; readyToPublish: number }
  queue: QueueState
  /** 14 วัน เก่า→ใหม่ (วันตาม UTC+7) เติมศูนย์ */
  views: { day: string; count: number }[]
  progress: NovelProgressDto[]
  usage: { today: UsageRowDto[]; last30: UsageRowDto[] }
  /** ค่าใช้จ่ายโดยประมาณเป็นดอลลาร์ · null = ประเมินไม่ได้ (ยังไม่กรอกราคา) */
  estimate: { today: number | null; last30: number | null }
  api: { hasKey: boolean; lastOk: ApiCheckDto | null }
}

/** การตั้งค่าของเว็บที่ผู้ดูแลแก้ได้ */
export interface SiteSettingsDto {
  siteName: string
  tagline: string
  aboutText: string
  contactText: string
  accent: AccentId
  indexable: boolean
  translateModel: string
  recapModel: string
  /** ราคาต่อล้านโทเคนของแต่ละโมเดล (ดอลลาร์) ไว้ประเมินค่าใช้จ่าย */
  prices: Record<string, { in: number; out: number }>
}

/** `GET/PUT /api/admin/settings`: การตั้งค่า + สถานะความลับ (บอกแค่ว่าตั้งไว้แล้วหรือยัง ไม่เคยส่งค่าจริง) */
export type SettingsDto = SiteSettingsDto & { apiKeySet: boolean; importTokenSet: boolean; importUrl: string }

// ───────────────────────── ข้อมูลที่ส่งไปให้เซิร์ฟเวอร์ ─────────────────────────

/** สร้างนิยาย: ต้องมี `title` เท่านั้น (ช่องอื่นมีค่าเริ่มต้น) · แก้บางช่อง: ส่งเฉพาะช่องที่เปลี่ยน */
export interface NovelInput {
  title: string
  titleTh?: string
  author?: string
  synopsis?: string
  synopsisSrc?: string
  tags?: string[]
  status?: NovelStatus
  sourceUrl?: string
  licenseNote?: string
  styleNote?: string
  mode?: NovelMode
  published?: boolean
  featured?: boolean
}

export interface TermInput {
  source: string
  thai: string
  note?: string
}

export type SiteSettingsInput = Partial<SiteSettingsDto>

/** การจัดการหลายตอนพร้อมกัน: เลือกตามรหัส (`ids` ≤ 500) หรือ "เผยแพร่ทุกตอนที่พร้อม" (`where: "ready"` เฉพาะ action `publish`) */
export type BulkInput =
  | { ids: number[]; action: "translate" | "publish" | "hide" | "delete"; autoPublish?: boolean }
  | { where: "ready"; action: "publish"; novelId?: number; autoPublish?: boolean }

/** ผลของ `POST /chapters/bulk` (ช่องที่ไม่เกี่ยวกับการกระทำนั้นไม่มา) */
export interface BulkResult {
  changed?: number
  skipped?: number
  queued?: number
  deleted?: number
}
