import type { ChapterRow, ChapterStatus, Mode, NovelRow, NovelStatus } from "../types.js"

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
