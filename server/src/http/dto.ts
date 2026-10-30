import type { ApiCheck } from "../api-check.js"
import type { ChapterContext } from "../context.js"
import type { QueueState } from "../queue.js"
import type { AccentId, SiteSettings } from "../settings.js"
import type { ChapterRow, ChapterStatus, GlossaryRow, Mode, NovelRow, NovelStatus } from "../types.js"
import { truncate } from "../util/text.js"

/** นิยายหนึ่งเรื่องในมุมมองผู้ดูแล (camelCase ตาม spec 7.10 · ธงเป็น boolean · แท็กเป็นอาร์เรย์) */
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
  mode: Mode
  published: boolean
  featured: boolean
  hasCover: boolean
  /** เวลาแก้ปกล่าสุดเป็นวินาที epoch (0 = ไม่มีปก) ใช้เป็น `?v=` ให้เบราว์เซอร์เห็นปกใหม่ทันที */
  coverV: number
  chapterCount: number
  translatedCount: number
  publishedCount: number
  createdAt: string
  updatedAt: string
}

/** แถว `novels` ที่ JOIN ปกและนับตอนมาแล้ว (ดู `SELECT_NOVEL` ใน admin/novels.ts) */
export interface AdminNovelRow extends NovelRow {
  cover_updated_at: string | null
  chapter_count: number
  translated_count: number
  published_count: number
}

/** คอลัมน์ `tags` เป็น JSON array ของข้อความ · ข้อมูลเสียรูป (แก้นอกระบบ) → [] และข้ามสมาชิกที่ไม่ใช่ข้อความ แทนที่จะทำให้หน้าล่ม */
export function parseTags(raw: string): string[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : []
}

const SQL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** เวลาในฐานข้อมูล (UTC `YYYY-MM-DD HH:MM:SS` ไม่มีเศษวินาที) เป็นวินาที epoch · ไม่มีปก (null) หรืออ่านไม่ออก → 0 */
export function coverVersion(updatedAt: string | null): number {
  if (updatedAt === null || !SQL_TIME.test(updatedAt)) return 0
  const ms = Date.parse(`${updatedAt.replace(" ", "T")}Z`)
  return Number.isNaN(ms) ? 0 : ms / 1000
}

export function toAdminNovelDto(r: AdminNovelRow): AdminNovelDto {
  return {
    id: r.id,
    title: r.title,
    titleTh: r.title_th,
    author: r.author,
    synopsis: r.synopsis,
    synopsisSrc: r.synopsis_src,
    tags: parseTags(r.tags),
    status: r.status,
    sourceUrl: r.source_url,
    licenseNote: r.license_note,
    styleNote: r.style_note,
    mode: r.mode,
    published: r.published === 1,
    featured: r.featured === 1,
    hasCover: r.cover_updated_at !== null,
    coverV: coverVersion(r.cover_updated_at),
    chapterCount: r.chapter_count,
    translatedCount: r.translated_count,
    publishedCount: r.published_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** ตอนหนึ่งในตารางตอนของเรื่อง (สเปก 7.10): แถวเบา ไม่มีต้นฉบับ/คำแปล เพื่อให้เรื่องที่มีหลายพันตอนยังโหลดเร็ว */
export interface AdminChapterListDto {
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
  /** ความยาวต้นฉบับเป็นจำนวนตัวอักษร (ไว้ประเมินค่าแปล) */
  srcLength: number
}

/** แถวจาก `SELECT_CHAPTER_LIST` ใน admin/chapters.ts */
export interface AdminChapterListRow
  extends Pick<ChapterRow, "id" | "number" | "title" | "title_th" | "status" | "error" | "published" | "published_at" | "translated_at" | "queue_seq"> {
  has_translation: number
  src_length: number
}

export function toAdminChapterListDto(r: AdminChapterListRow): AdminChapterListDto {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    titleTh: r.title_th,
    status: r.status,
    error: r.error,
    published: r.published === 1,
    publishedAt: r.published_at,
    translatedAt: r.translated_at,
    queueSeq: r.queue_seq,
    hasTranslation: r.has_translation === 1,
    srcLength: r.src_length,
  }
}

/** ตอนเดียวเต็มๆ ในมุมมองผู้ดูแล (หน้าแก้ตอน): รวมต้นฉบับ คำแปล และเรื่องย่อ */
export interface AdminChapterDto {
  id: number
  novelId: number
  number: number
  title: string
  titleTh: string
  sourceText: string
  translation: string
  /** ตอนที่ยังไม่มีเรื่องย่อ = ข้อความว่าง */
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

export function toAdminChapterDto(r: ChapterRow): AdminChapterDto {
  return {
    id: r.id,
    novelId: r.novel_id,
    number: r.number,
    title: r.title,
    titleTh: r.title_th,
    sourceText: r.source_text,
    translation: r.translation,
    recap: r.recap ?? "",
    status: r.status,
    error: r.error,
    published: r.published === 1,
    publishedAt: r.published_at,
    translatedAt: r.translated_at,
    queueSeq: r.queue_seq,
    autoPublish: r.auto_publish === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** คำศัพท์หนึ่งรายการในอภิธานของเรื่อง (`auto` = AI เสนอมาเองและเจ้าของยังไม่เคยแก้/ยืนยัน) */
export interface GlossaryDto {
  id: number
  source: string
  thai: string
  note: string
  auto: boolean
}

export function toGlossaryDto(r: GlossaryRow): GlossaryDto {
  return { id: r.id, source: r.source, thai: r.thai, note: r.note, auto: r.auto === 1 }
}

/** ตอนที่แปลผิดพลาดในรายการของหน้าคิว (ไว้แสดงสาเหตุและปุ่มลองใหม่) */
export interface QueueErrorDto {
  id: number
  novelId: number
  /** ชื่อไทยก่อน ไม่มีค่อยใช้ชื่อเดิม */
  novelTitle: string
  number: number
  error: string
}

export interface QueueErrorRow {
  id: number
  novel_id: number
  number: number
  error: string
  title: string
  title_th: string
}

export function toQueueErrorDto(r: QueueErrorRow): QueueErrorDto {
  return { id: r.id, novelId: r.novel_id, novelTitle: r.title_th || r.title, number: r.number, error: r.error }
}

/** โทเคนที่ใช้ไปของโมเดลหนึ่ง รวมตามช่วงเวลา (Dashboard) */
export interface UsageRowDto {
  model: string
  tokensIn: number
  tokensOut: number
  calls: number
}

export interface UsageRow {
  model: string
  tokens_in: number
  tokens_out: number
  calls: number
}

export function toUsageRowDto(r: UsageRow): UsageRowDto {
  return { model: r.model, tokensIn: r.tokens_in, tokensOut: r.tokens_out, calls: r.calls }
}

/** ความคืบหน้าของเรื่องหนึ่งใน Dashboard: ตอนที่มีคำแปลแล้ว / ตอนทั้งหมด / ตอนที่เผยแพร่ */
export interface NovelProgressDto {
  novelId: number
  /** ชื่อไทยก่อน ไม่มีค่อยใช้ชื่อเดิม */
  title: string
  translated: number
  total: number
  published: number
}

export interface NovelProgressRow {
  id: number
  title: string
  title_th: string
  translated: number
  total: number
  published: number
}

export function toNovelProgressDto(r: NovelProgressRow): NovelProgressDto {
  return { novelId: r.id, title: r.title_th || r.title, translated: r.translated, total: r.total, published: r.published }
}

/** `GET /api/admin/queue` (และคำตอบของ pause/resume): สถานะสดของคิว + ตอนที่ผิดพลาดล่าสุด */
export type QueueDto = QueueState & { errors: QueueErrorDto[] }

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
  api: { hasKey: boolean; lastOk: ApiCheck | null }
}

/** `GET/PUT /api/admin/settings`: การตั้งค่า + สถานะความลับที่ระบบคำนวณเอง (ไม่เคยส่งค่าจริงของความลับ) */
export type SettingsViewDto = SiteSettings & { apiKeySet: boolean; importTokenSet: boolean; importUrl: string }

// ───────────────────────── หน้าบ้านสาธารณะ (/api/public · spec 4.2) ─────────────────────────

/** เรื่องย่อในการ์ดตัดที่กี่ตัวอักษร (นับเป็น code point แล้วต่อ "…") */
export const SYNOPSIS_SHORT_LENGTH = 280

/**
 * การ์ดนิยายที่ผู้อ่านเห็น · `chapterCount`/`latestNumber`/`updatedAt` นับจากตอนที่ผู้ขอมองเห็นเท่านั้น
 * `published` = ผู้อ่านทั่วไปเห็นเรื่องนี้หรือไม่ (ผู้อ่านทั่วไปได้ true เสมอ · false เกิดเฉพาะกับผู้ดูแลที่ดูร่าง)
 */
export interface PublicNovelCardDto {
  id: number
  title: string
  titleTh: string
  author: string
  synopsisShort: string
  tags: string[]
  status: NovelStatus
  featured: boolean
  hasCover: boolean
  /** ใช้เป็น `?v=` ของ `/covers/:id` (0 = ไม่มีปก) */
  coverV: number
  chapterCount: number
  /** เลขตอนมากสุดที่เห็น (ตอนเลข 0 ก็เป็น 0) · ยังไม่มีตอนที่เห็น = null */
  latestNumber: number | null
  /** เวลาเผยแพร่ล่าสุดของตอนที่เห็น (UTC) · ไม่มีใช้เวลาแก้ล่าสุดของเรื่อง */
  updatedAt: string
  published: boolean
}

/** แถวจาก SQL การ์ดของ public.ts (`last_update` = `updatedAt` ที่คำนวณแล้ว) */
export interface PublicNovelRow
  extends Pick<NovelRow, "id" | "title" | "title_th" | "author" | "synopsis" | "tags" | "status" | "source_url" | "license_note" | "featured" | "published"> {
  cover_updated_at: string | null
  chapter_count: number
  latest_number: number | null
  last_update: string
}

export function toPublicNovelCardDto(r: PublicNovelRow): PublicNovelCardDto {
  return {
    id: r.id,
    title: r.title,
    titleTh: r.title_th,
    author: r.author,
    synopsisShort: truncate(r.synopsis, SYNOPSIS_SHORT_LENGTH),
    tags: parseTags(r.tags),
    status: r.status,
    featured: r.featured === 1,
    hasCover: r.cover_updated_at !== null,
    coverV: coverVersion(r.cover_updated_at),
    chapterCount: r.chapter_count,
    latestNumber: r.latest_number,
    updatedAt: r.last_update,
    published: r.published === 1,
  }
}

/** ตอนหนึ่งในสารบัญของเรื่อง (ไม่มีเนื้อหา) · `published` = ผู้อ่านทั่วไปเห็นตอนนี้หรือไม่ (เรื่องที่ซ่อน = ทุกตอนไม่เห็น) */
export interface PublicChapterItemDto {
  number: number
  title: string
  titleTh: string
  publishedAt: string | null
  published: boolean
}

export interface PublicChapterItemRow {
  number: number
  title: string
  title_th: string
  published_at: string | null
  is_public: number
}

export function toPublicChapterItemDto(r: PublicChapterItemRow): PublicChapterItemDto {
  return { number: r.number, title: r.title, titleTh: r.title_th, publishedAt: r.published_at, published: r.is_public === 1 }
}

/** หน้าเรื่อง: การ์ด + เรื่องย่อเต็ม + ลิงก์ต้นฉบับ + บันทึกสิทธิ์ + สารบัญตอนที่เห็น (เรียงเลขตอนน้อยไปมาก) */
export interface PublicNovelDto extends PublicNovelCardDto {
  synopsis: string
  sourceUrl: string
  licenseNote: string
  chapters: PublicChapterItemDto[]
}

export function toPublicNovelDto(r: PublicNovelRow, chapters: PublicChapterItemRow[]): PublicNovelDto {
  return {
    ...toPublicNovelCardDto(r),
    synopsis: r.synopsis,
    sourceUrl: r.source_url,
    licenseNote: r.license_note,
    chapters: chapters.map(toPublicChapterItemDto),
  }
}

/**
 * `GET /api/public/site`: ค่าตั้งของเว็บที่ผู้อ่านเห็น (ไม่รวมค่าภายในอย่างโมเดล/ราคา) + `isAdmin` ให้หน้าเว็บรู้ว่าผู้เปิดอยู่ล็อกอินหลังบ้านไว้ไหม
 * หน้าเว็บประกาศชนิดนี้ซ้ำไว้ที่ `web/src/lib/types.ts` — `e2e/web-contract.ts` ตรวจตอน typecheck ว่าสองฝั่งยังตรงกัน
 */
export interface PublicSiteDto {
  siteName: string
  tagline: string
  aboutText: string
  contactText: string
  accent: AccentId
  indexable: boolean
  isAdmin: boolean
}

/** หน้าอ่าน: เนื้อหาคำแปลของตอน + เลขตอนข้างเคียงที่เห็น (null = ไม่มี) */
export interface PublicChapterPageDto {
  novel: { id: number; title: string; titleTh: string }
  chapter: { number: number; title: string; titleTh: string; text: string; published: boolean }
  prev: number | null
  next: number | null
}

export interface PublicChapterRow {
  novel_id: number
  novel_title: string
  novel_title_th: string
  chapter_id: number
  number: number
  title: string
  title_th: string
  translation: string
  is_public: number
}

export function toPublicChapterPageDto(r: PublicChapterRow, prev: number | null, next: number | null): PublicChapterPageDto {
  return {
    novel: { id: r.novel_id, title: r.novel_title, titleTh: r.novel_title_th },
    chapter: { number: r.number, title: r.title, titleTh: r.title_th, text: r.translation, published: r.is_public === 1 },
    prev,
    next,
  }
}

// ───────────────────────── ช่องทางนำเข้า (/api/import) ─────────────────────────
// คำตอบที่ผู้แปลภายนอกถือโทเค็นอ่านได้ — เฉพาะที่ต้องใช้แปลให้ตรงกับระบบ ไม่มีข้อมูลหลังบ้านอื่น (spec 9.6)

/** ตอนหนึ่งในรายการแบบเบา (ไว้หาว่าตอนไหนยังรอแปล) · `chars` = ความยาวต้นฉบับ */
export interface ImportChapterItemDto {
  number: number
  title: string
  status: ChapterStatus
  hasTranslation: boolean
  chars: number
  published: boolean
}

export interface ImportChapterItemRow {
  number: number
  title: string
  status: ChapterStatus
  has_translation: number
  chars: number
  published: number
}

export function toImportChapterItemDto(r: ImportChapterItemRow): ImportChapterItemDto {
  return { number: r.number, title: r.title, status: r.status, hasTranslation: r.has_translation === 1, chars: r.chars, published: r.published === 1 }
}

/** โจทย์ของตอน: ต้นฉบับ + บริบทชุดเดียวกับที่คิวแปลใช้ (`buildContext`) · ไม่ส่งคำแปลเดิมกลับ บอกแค่ว่ามีหรือยัง */
export interface ImportBriefDto {
  novel: { id: number; title: string; titleTh: string; mode: Mode; styleNote: string }
  chapter: { number: number; title: string; sourceText: string; status: ChapterStatus; hasTranslation: boolean }
  glossary: { source: string; thai: string; note: string }[]
  recaps: { number: number; recap: string }[]
  systemPrompt: string
}

export function toImportBriefDto(c: ChapterContext): ImportBriefDto {
  return {
    novel: { id: c.novel.id, title: c.novel.title, titleTh: c.novel.title_th, mode: c.novel.mode, styleNote: c.novel.style_note },
    chapter: { number: c.chapter.number, title: c.chapter.title, sourceText: c.chapter.source_text, status: c.chapter.status, hasTranslation: c.chapter.translation !== "" },
    glossary: c.glossary.map((g) => ({ source: g.source, thai: g.thai, note: g.note })),
    recaps: c.recaps.map((r) => ({ number: r.number, recap: r.recap })),
    systemPrompt: c.system,
  }
}
