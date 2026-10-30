import { Router } from "express"
import type { AppDeps } from "../../app.js"
import { readApiCheck } from "../../api-check.js"
import { READY_TO_PUBLISH_SQL } from "../../chapters.js"
import type { SiteSettings } from "../../settings.js"
import { dayKey } from "../../util/time.js"
import { toNovelProgressDto, toUsageRowDto, type DashboardDto, type NovelProgressRow, type UsageRow } from "../dto.js"

const DAY_MS = 24 * 60 * 60 * 1000
/** กราฟยอดอ่านย้อนหลังกี่วัน (รวมวันนี้) และช่วง "30 วัน" ของโทเคน (รวมวันนี้) */
const VIEW_DAYS = 14
const USAGE_DAYS = 30

interface CountsRow {
  published_novels: number
  total_novels: number
  published_chapters: number
  queued: number
  errors: number
  ready_to_publish: number
}

const COUNTS_SQL = `
  SELECT (SELECT COUNT(*) FROM novels WHERE published = 1) AS published_novels,
         (SELECT COUNT(*) FROM novels) AS total_novels,
         (SELECT COUNT(*) FROM chapters WHERE published = 1) AS published_chapters,
         (SELECT COUNT(*) FROM chapters WHERE status = 'queued') AS queued,
         (SELECT COUNT(*) FROM chapters WHERE status = 'error') AS errors,
         (SELECT COUNT(*) FROM chapters WHERE ${READY_TO_PUBLISH_SQL}) AS ready_to_publish`

/** ตอนที่ "แปลแล้ว" = มีคำแปลอยู่ (รวมตอนที่แปลใหม่ล้มเหลวแต่ยังมีคำแปลเดิมเผยแพร่อยู่) เรื่องที่ยังไม่มีตอนได้ศูนย์ทั้งสามช่อง */
const PROGRESS_SQL = `
  SELECT n.id, n.title, n.title_th,
         COUNT(c.id) AS total,
         SUM(CASE WHEN c.translation <> '' THEN 1 ELSE 0 END) AS translated,
         COALESCE(SUM(c.published), 0) AS published
  FROM novels n LEFT JOIN chapters c ON c.novel_id = n.id
  GROUP BY n.id ORDER BY n.id`

const USAGE_SQL = `
  SELECT model, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, SUM(calls) AS calls
  FROM usage WHERE day >= ? AND day <= ? GROUP BY model ORDER BY model`

/**
 * ค่าใช้จ่ายโดยประมาณ (ดอลลาร์) = Σ (โทเคนเข้า × ราคาเข้า + โทเคนออก × ราคาออก) / 1,000,000 เฉพาะโมเดลที่เจ้าของกรอกราคาไว้ ปัดที่ 6 ตำแหน่ง
 * null = ประเมินไม่ได้: ยังไม่กรอกราคาเลย หรือมีการใช้งานแต่ไม่มีโมเดลไหนมีราคา (ต่างจาก 0 ที่แปลว่าไม่ได้ใช้เลย)
 */
function estimateCost(rows: UsageRow[], prices: SiteSettings["prices"]): number | null {
  if (Object.keys(prices).length === 0) return null
  const priced = rows.filter((r) => Object.hasOwn(prices, r.model))
  if (rows.length > 0 && priced.length === 0) return null
  const total = priced.reduce((sum, r) => {
    const price = prices[r.model] as { in: number; out: number }
    return sum + (r.tokens_in * price.in + r.tokens_out * price.out) / 1e6
  }, 0)
  return Math.round(total * 1e6) / 1e6
}

/** `/api/admin/dashboard` (ผ่านด่านล็อกอินแล้ว) อ่านอย่างเดียว */
export function createDashboardRouter(deps: AppDeps): Router {
  const { db, config, settings, ai, queue, now } = deps
  const router = Router()

  router.get("/dashboard", (_req, res) => {
    const at = now()
    const today = dayKey(at)
    /** วันที่ (UTC+7) ย้อนหลัง `n` วันจากวันนี้ */
    const daysAgo = (n: number): string => dayKey(new Date(at.getTime() - n * DAY_MS))

    const site = settings.get()
    const counts = db.get<CountsRow>(COUNTS_SQL) as CountsRow

    const viewsByDay = new Map(
      db.all<{ day: string; count: number }>("SELECT day, SUM(count) AS count FROM views WHERE day >= ? AND day <= ? GROUP BY day", daysAgo(VIEW_DAYS - 1), today).map((r) => [r.day, r.count]),
    )
    const views = Array.from({ length: VIEW_DAYS }, (_, i) => {
      const day = daysAgo(VIEW_DAYS - 1 - i)
      return { day, count: viewsByDay.get(day) ?? 0 }
    })

    const usageToday = db.all<UsageRow>(USAGE_SQL, today, today)
    const usageLast30 = db.all<UsageRow>(USAGE_SQL, daysAgo(USAGE_DAYS - 1), today)

    const body: DashboardDto = {
      onboarding: {
        apiKey: ai.hasKey() || config.importToken !== null,
        contact: site.contactText !== "", // settings.get() ล้างช่องว่างหัวท้ายให้แล้ว: เหลือแต่ช่องว่าง = ว่าง
        firstNovel: counts.total_novels > 0,
      },
      counts: {
        publishedNovels: counts.published_novels,
        totalNovels: counts.total_novels,
        publishedChapters: counts.published_chapters,
        queued: counts.queued,
        errors: counts.errors,
        readyToPublish: counts.ready_to_publish,
      },
      queue: queue.state(),
      views,
      progress: db.all<NovelProgressRow>(PROGRESS_SQL).map(toNovelProgressDto),
      usage: { today: usageToday.map(toUsageRowDto), last30: usageLast30.map(toUsageRowDto) },
      estimate: { today: estimateCost(usageToday, site.prices), last30: estimateCost(usageLast30, site.prices) },
      api: { hasKey: ai.hasKey(), lastOk: readApiCheck(settings) },
    }
    res.json(body)
  })

  return router
}
