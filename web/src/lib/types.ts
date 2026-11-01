/**
 * ชนิดข้อมูลที่ `/api/public/*` ตอบ — ประกาศซ้ำจาก `server/src/http/dto.ts` (หน้าเว็บ import โค้ดฝั่งเซิร์ฟเวอร์ไม่ได้)
 * ห้ามแก้ให้เพี้ยนจากฝั่งเซิร์ฟเวอร์: `e2e/web-contract.ts` ตรวจตอน `npm run typecheck` ว่าสองฝั่งยังตรงกันทุกช่อง
 * ช่องเวลา (`updatedAt`, `publishedAt`) เป็นข้อความ `YYYY-MM-DD HH:MM:SS` เวลา UTC — ใช้ `isNew`/`thaiDate` ใน `format.ts` อ่านเสมอ
 */

export type NovelStatus = "ongoing" | "completed"

/** สีเน้นของเว็บ (ตรงกับ `ACCENTS` ใน `server/src/settings.ts` และชุดสีใน `styles/tokens.css`) */
export type AccentId = "default" | "violet" | "pink" | "teal" | "amber" | "blue"

/** `GET /api/public/site` */
export interface SiteDto {
  siteName: string
  tagline: string
  aboutText: string
  contactText: string
  accent: AccentId
  indexable: boolean
  /** ผู้เปิดอยู่ล็อกอินหลังบ้านไว้ (เห็นตอน/นิยายที่ยังไม่เผยแพร่ด้วย) */
  isAdmin: boolean
}

/** นิยายหนึ่งเรื่องในรายการ (`GET /api/public/novels`) */
export interface NovelCardDto {
  id: number
  title: string
  titleTh: string
  author: string
  synopsisShort: string
  tags: string[]
  status: NovelStatus
  featured: boolean
  hasCover: boolean
  /** ใช้เป็น `?v=` ต่อท้ายที่อยู่ปก ให้เบราว์เซอร์เห็นปกใหม่ทันทีที่เปลี่ยน */
  coverV: number
  chapterCount: number
  /** เลขตอนล่าสุดที่เห็น — `null` = ยังไม่มีตอนเลย (ระวัง: ตอนที่ 0 เป็นตอนจริง ใช้ `!== null` ไม่ใช่ตรวจว่าเป็นเท็จ) */
  latestNumber: number | null
  updatedAt: string
  /** มีเฉพาะที่ผู้ดูแลเห็น: เรื่องที่ยังไม่เผยแพร่ */
  published: boolean
}

export interface ChapterItemDto {
  number: number
  title: string
  titleTh: string
  /** `null` = ยังไม่เผยแพร่ (ผู้ดูแลเท่านั้นที่เห็น) */
  publishedAt: string | null
  published: boolean
}

/** หน้านิยาย (`GET /api/public/novels/:id`) */
export interface NovelDetailDto extends NovelCardDto {
  synopsis: string
  sourceUrl: string
  licenseNote: string
  chapters: ChapterItemDto[]
}

/** หน้าอ่าน (`GET /api/public/novels/:id/chapters/:number`) */
export interface ChapterPageDto {
  novel: { id: number; title: string; titleTh: string }
  chapter: { number: number; title: string; titleTh: string; text: string; published: boolean }
  /** เลขตอนก่อนหน้า/ถัดไปที่เห็น (`null` = ไม่มี) */
  prev: number | null
  next: number | null
}
