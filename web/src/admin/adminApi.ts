/**
 * ตัวเรียก API หลังบ้าน (`/api/admin/*`) — ห่อ `api()` ของหน้าเว็บ ข้อผิดพลาดทุกแบบเป็น `ApiError` เหมือนกัน
 * คำสั่งที่เซิร์ฟเวอร์ตอบแค่ `{ ok: true }` (ออกจากระบบ ลบ …) คืน void: หน้าที่เรียกไม่มีอะไรให้ใช้จากคำตอบนั้น
 * ส่วนผู้เรียกที่ต้องการสถานะใหม่หลังสั่ง (เช่น หยุด/ทำต่อคิว) ให้ดึงซ้ำผ่าน `useQueue().reload()`
 */
import { api } from "../lib/api"
import type {
  AdminChapterDto,
  AdminChapterRow,
  AdminNovelDto,
  BulkInput,
  BulkResult,
  DashboardDto,
  GlossaryDto,
  MeDto,
  NovelInput,
  QueueDto,
  SettingsDto,
  SiteSettingsInput,
  TermInput,
} from "./types"

const BASE = "/api/admin"

const send = <T>(method: string, path: string, body?: unknown): Promise<T> => api<T>(`${BASE}${path}`, { method, body })
/** สั่งงานที่ไม่สนคำตอบ */
const command = async (method: string, path: string, body?: unknown): Promise<void> => {
  await send<unknown>(method, path, body)
}

export interface AiFillInput {
  title: string
  synopsisSrc: string
  author: string
}
export interface AiFillResult {
  titleTh: string
  synopsis: string
  tags: string[]
}
export interface NewChaptersInput {
  chapters: { number: number; title: string; text: string }[]
  translate: boolean
  publish: boolean
}
export type ChapterPatch = Partial<{ title: string; titleTh: string; sourceText: string; translation: string; recap: string }>

export const admin = {
  me: () => send<MeDto>("GET", "/me"),
  login: (password: string) => command("POST", "/login", { password }),
  logout: () => command("POST", "/logout"),

  dashboard: () => send<DashboardDto>("GET", "/dashboard"),
  queue: () => send<QueueDto>("GET", "/queue"),
  pause: (reason?: string) => command("POST", "/queue/pause", { reason }),
  resume: () => command("POST", "/queue/resume"),

  novels: () => send<AdminNovelDto[]>("GET", "/novels"),
  novel: (id: number) => send<AdminNovelDto>("GET", `/novels/${id}`),
  createNovel: (body: NovelInput) => send<AdminNovelDto>("POST", "/novels", body),
  patchNovel: (id: number, body: Partial<NovelInput>) => send<AdminNovelDto>("PATCH", `/novels/${id}`, body),
  deleteNovel: (id: number) => command("DELETE", `/novels/${id}`),
  putCover: (id: number, data: string) => send<{ coverV: number }>("PUT", `/novels/${id}/cover`, { data }),
  deleteCover: (id: number) => command("DELETE", `/novels/${id}/cover`),
  aiFill: (body: AiFillInput) => send<AiFillResult>("POST", "/novels/ai-fill", body),

  chapters: (novelId: number) => send<AdminChapterRow[]>("GET", `/novels/${novelId}/chapters`),
  createChapters: (novelId: number, body: NewChaptersInput) => send<{ created: number[]; queued: number }>("POST", `/novels/${novelId}/chapters`, body),
  chapter: (id: number) => send<AdminChapterDto>("GET", `/chapters/${id}`),
  patchChapter: (id: number, body: ChapterPatch) => send<AdminChapterDto>("PATCH", `/chapters/${id}`, body),
  deleteChapter: (id: number) => command("DELETE", `/chapters/${id}`),
  bulk: (body: BulkInput) => send<BulkResult>("POST", "/chapters/bulk", body),

  glossary: (novelId: number, autoOnly = false) => send<GlossaryDto[]>("GET", `/novels/${novelId}/glossary${autoOnly ? "?auto=1" : ""}`),
  addTerm: (novelId: number, body: TermInput) => send<GlossaryDto>("POST", `/novels/${novelId}/glossary`, body),
  patchTerm: (id: number, body: Partial<TermInput>) => send<GlossaryDto>("PATCH", `/glossary/${id}`, body),
  deleteTerm: (id: number) => command("DELETE", `/glossary/${id}`),

  settings: () => send<SettingsDto>("GET", "/settings"),
  putSettings: (body: Partial<SiteSettingsInput>) => send<SettingsDto>("PUT", "/settings", body),
  testApi: () => send<{ ok: boolean; message: string }>("POST", "/settings/test-api"),
}
