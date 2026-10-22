export type Mode = "translate" | "story"
export const MODES: readonly Mode[] = ["translate", "story"]

export type NovelStatus = "ongoing" | "completed"
export const NOVEL_STATUSES: readonly NovelStatus[] = ["ongoing", "completed"]

export type ChapterStatus = "draft" | "queued" | "translating" | "done" | "error"

/** คำศัพท์เฉพาะที่ AI สกัดได้ (note เป็นข้อความว่างได้) */
export interface Term {
  source: string
  thai: string
  note?: string
}

// แถวจากฐานข้อมูล: ชื่อคอลัมน์ snake_case ตาม spec 5.1, ค่าจริง/เท็จเก็บเป็น 0/1
export interface NovelRow {
  id: number
  title: string
  title_th: string
  author: string
  synopsis: string
  synopsis_src: string
  tags: string // JSON array ของข้อความ
  status: NovelStatus
  source_url: string
  license_note: string
  style_note: string
  mode: Mode
  published: number
  featured: number
  created_at: string
  updated_at: string
}

export interface ChapterRow {
  id: number
  novel_id: number
  number: number
  title: string
  title_th: string
  source_text: string
  translation: string
  recap: string | null
  status: ChapterStatus
  error: string
  published: number
  published_at: string | null
  auto_publish: number
  queue_seq: number | null
  translated_at: string | null
  created_at: string
  updated_at: string
}

export interface GlossaryRow {
  id: number
  novel_id: number
  source: string
  thai: string
  note: string
  auto: number
}
