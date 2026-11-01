/**
 * ตรวจตอน `npm run typecheck` (ไฟล์นี้ไม่ถูกรัน): ชนิดข้อมูลที่หน้าเว็บประกาศซ้ำไว้ใน `web/src/lib/types.ts`
 * ต้องตรงกับ DTO จริงที่เซิร์ฟเวอร์ตอบใน `server/src/http/dto.ts` ทุกช่อง ทั้งสองทิศ —
 * เซิร์ฟเวอร์เพิ่ม/ลบ/เปลี่ยนชนิดช่องแล้วลืมแก้ฝั่งหน้าเว็บ (หรือกลับกัน) จะ typecheck ไม่ผ่านที่นี่ ไม่ใช่ไปพังตอนผู้อ่านเปิดหน้า
 * (ทำไมอยู่ที่ `e2e/`: โฟลเดอร์นี้เป็นที่เดียวที่ tsconfig คลุมได้ทั้ง `server/` และ `web/`)
 */
import type { ApiCheck } from "../server/src/api-check.js"
import type {
  AdminChapterDto,
  AdminChapterListDto,
  AdminNovelDto,
  DashboardDto,
  GlossaryDto,
  NovelProgressDto,
  PublicChapterPageDto,
  PublicNovelCardDto,
  PublicNovelDto,
  PublicSiteDto,
  QueueDto,
  QueueErrorDto,
  SettingsViewDto,
  UsageRowDto,
} from "../server/src/http/dto.js"
import type { QueueState } from "../server/src/queue.js"
import type { SiteSettings } from "../server/src/settings.js"
import type {
  AdminChapterDto as WebAdminChapterDto,
  AdminChapterRow,
  AdminNovelDto as WebAdminNovelDto,
  ApiCheckDto,
  DashboardDto as WebDashboardDto,
  GlossaryDto as WebGlossaryDto,
  NovelProgressDto as WebNovelProgressDto,
  QueueDto as WebQueueDto,
  QueueError,
  QueueState as WebQueueState,
  SettingsDto,
  SiteSettingsDto,
  UsageRowDto as WebUsageRowDto,
} from "../web/src/admin/types.js"
import type { ChapterPageDto, NovelCardDto, NovelDetailDto, SiteDto } from "../web/src/lib/types.js"

/** ชนิดสองตัวกำหนดค่าให้กันได้ทั้งสองทิศ (ช่องขาด ช่องเกิน ชนิดช่องต่าง ช่องที่ใส่ `?` ไม่ตรงกัน) */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type WebContract = [
  Assert<Same<SiteDto, PublicSiteDto>>,
  Assert<Same<NovelCardDto, PublicNovelCardDto>>,
  Assert<Same<NovelDetailDto, PublicNovelDto>>,
  Assert<Same<ChapterPageDto, PublicChapterPageDto>>,
  // หลังบ้าน (web/src/admin/types.ts)
  Assert<Same<WebAdminNovelDto, AdminNovelDto>>,
  Assert<Same<AdminChapterRow, AdminChapterListDto>>,
  Assert<Same<WebAdminChapterDto, AdminChapterDto>>,
  Assert<Same<WebGlossaryDto, GlossaryDto>>,
  Assert<Same<QueueError, QueueErrorDto>>,
  Assert<Same<WebQueueState, QueueState>>,
  Assert<Same<WebQueueDto, QueueDto>>,
  Assert<Same<WebUsageRowDto, UsageRowDto>>,
  Assert<Same<WebNovelProgressDto, NovelProgressDto>>,
  Assert<Same<ApiCheckDto, ApiCheck>>,
  Assert<Same<WebDashboardDto, DashboardDto>>,
  Assert<Same<SiteSettingsDto, SiteSettings>>,
  Assert<Same<SettingsDto, SettingsViewDto>>,
]
