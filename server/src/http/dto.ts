import type { Mode, NovelRow, NovelStatus } from "../types.js"

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
