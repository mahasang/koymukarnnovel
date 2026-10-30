/**
 * ตรรกะของหน้าแรก (ล้วนๆ ไม่แตะ DOM/localStorage): ค้นหา กรอง เรียง เลือกเรื่องเด่น และข้อมูลแถว "อ่านต่อ"
 * ข้อมูลที่ได้จาก `GET /api/public/novels` (การ์ดนิยายทุกเรื่องในครั้งเดียว) — ค้นหา/กรองทำที่ฝั่งผู้อ่าน
 */
import { parseSqlTime, resumePercent } from "./format"
import { displayTitle } from "./novel"
import { FINISHED_PCT, resumeTarget, type Progress } from "./progress"
import type { NovelCardDto, NovelStatus } from "./types"

/** ตารางนิยายทั้งหมดแสดงทีละกี่เรื่อง (ปุ่ม "แสดงเพิ่ม" เพิ่มทีละเท่านี้) */
export const PAGE_SIZE = 24
/** แถว "อัปเดตล่าสุด" มีกี่เรื่อง */
export const UPDATES_COUNT = 12
/** แถว "อ่านต่อ" มีกี่เรื่อง (ประวัติเก็บได้ 10 แต่หน้าแรกโชว์แค่ที่เพิ่งอ่านล่าสุด) */
export const CONTINUE_MAX = 3
/** ชิปแท็กมากสุดกี่อัน (เรียงตามจำนวนเรื่อง; แท็กที่เลือกอยู่แต่ไม่ติดอันดับยังโชว์ต่อท้าย) */
export const TAG_CHIPS_MAX = 10

export type StatusFilter = "all" | NovelStatus
export type SortKey = "latest" | "title"

/** ชิปกรองสถานะ ตามลำดับที่แสดง */
export const STATUS_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "ทั้งหมด" },
  { key: "ongoing", label: "กำลังอัปเดต" },
  { key: "completed", label: "จบแล้ว" },
]

/** ตัวเลือกการเรียง ตัวแรกคือค่าเริ่มต้น */
export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "latest", label: "อัปเดตล่าสุด" },
  { key: "title", label: "ชื่อเรื่อง ก–ฮ" },
]

/** ค่าจากช่องเลือก (ข้อความอะไรก็ได้) เป็นวิธีเรียงที่รู้จักหรือไม่ */
export function isSortKey(value: string): value is SortKey {
  return SORT_OPTIONS.some((option) => option.key === value)
}

// ───────────────────────── ค้นหา ─────────────────────────

/** ตัวพิมพ์เล็ก + รวมอักษรประกอบเป็นตัวสำเร็จรูป (é แบบ e+จุดบน = é) — ใช้เทียบทั้งคำค้นและข้อมูล */
const fold = (text: string) => text.normalize("NFC").toLowerCase()

/**
 * เรื่องนี้ตรงกับคำค้นไหม: ค้นในชื่อต้นฉบับ ชื่อไทย ผู้แต่ง และแท็ก ไม่สนตัวพิมพ์ ·
 * แยกคำค้นด้วยช่องว่าง ทุกคำต้องเจอ (จะเจอคนละช่องก็ได้ ไม่ต้องเรียงติดกัน) · คำค้นว่าง = ตรงทุกเรื่อง
 */
export function matchesQuery(novel: NovelCardDto, query: string): boolean {
  const terms = fold(query).split(/\s+/).filter((term) => term !== "")
  if (terms.length === 0) return true
  // คั่นแต่ละช่องด้วยขึ้นบรรทัดใหม่ — คำค้นไม่มีช่องว่างจึงไม่ข้ามช่องได้
  const haystack = fold([novel.title, novel.titleTh, novel.author, ...novel.tags].join("\n"))
  return terms.every((term) => haystack.includes(term))
}

// ───────────────────────── แท็ก ─────────────────────────

export interface TagCount {
  tag: string
  count: number
}

/** แท็กทั้งหมดพร้อมจำนวนเรื่อง เรียงมาก→น้อย เท่ากันเรียงตามชื่อ (ลำดับอักขระ ไม่ขึ้นกับภาษาของเครื่อง) — แท็กซ้ำในเรื่องเดียวนับครั้งเดียว แท็กว่างข้าม */
export function tagCounts(novels: NovelCardDto[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const novel of novels) {
    for (const tag of new Set(novel.tags)) {
      if (tag.trim() !== "") counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
}

/** แท็กที่โชว์เป็นชิป: `max` อันแรก + แท็กที่เลือกอยู่ (ถ้าอยู่นอกลำดับต้นและยังมีในรายการ) ต่อท้าย */
export function visibleTags(counts: TagCount[], selected: string | null, max: number = TAG_CHIPS_MAX): TagCount[] {
  const head = counts.slice(0, max)
  if (selected === null || head.some((item) => item.tag === selected)) return head
  const extra = counts.find((item) => item.tag === selected)
  return extra === undefined ? head : [...head, extra]
}

// ───────────────────────── กรอง / เรียง ─────────────────────────

export interface LibraryFilter {
  query: string
  status: StatusFilter
  tag: string | null
}

/** เรื่องที่ผ่านทุกเงื่อนไข (AND) ตามลำดับเดิม — ได้อาร์เรย์ใหม่เสมอ */
export function filterNovels(novels: NovelCardDto[], { query, status, tag }: LibraryFilter): NovelCardDto[] {
  return novels.filter((novel) => (status === "all" || novel.status === status) && (tag === null || novel.tags.includes(tag)) && matchesQuery(novel, query))
}

const timeOf = (novel: NovelCardDto) => parseSqlTime(novel.updatedAt) ?? Number.NEGATIVE_INFINITY
/** เทียบชื่อแบบพจนานุกรมไทย (สระนำหน้า เ แ โ ใ ไ เรียงตามพยัญชนะที่ตามมา) และเลขในชื่อเรียงตามค่า (2 ก่อน 10) */
const titleCollator = new Intl.Collator("th", { numeric: true })

/**
 * เรียงเป็นอาร์เรย์ใหม่ · `latest`: อัปเดตล่าสุดก่อน (เวลาเท่ากัน → เรื่องใหม่กว่า/id มากกว่าก่อน; เวลาอ่านไม่ได้อยู่ท้ายสุด) ·
 * `title`: ตามชื่อที่แสดง (เท่ากัน → id น้อยก่อน)
 */
export function sortNovels(novels: NovelCardDto[], key: SortKey): NovelCardDto[] {
  const copy = [...novels]
  if (key === "title") return copy.sort((a, b) => titleCollator.compare(displayTitle(a), displayTitle(b)) || a.id - b.id)
  return copy.sort((a, b) => {
    const ta = timeOf(a)
    const tb = timeOf(b)
    return ta === tb ? b.id - a.id : ta > tb ? -1 : 1
  })
}

/** แถว "อัปเดตล่าสุด": เรื่องที่อัปเดตล่าสุด `count` เรื่อง */
export function latestUpdates(novels: NovelCardDto[], count: number = UPDATES_COUNT): NovelCardDto[] {
  return sortNovels(novels, "latest").slice(0, count)
}

/**
 * เรื่องที่ขึ้น Hero: เรื่องแนะนำ (`featured`; หลายเรื่อง → ที่อัปเดตล่าสุด) → ไม่มี: เรื่องที่อัปเดตล่าสุดที่มีปก →
 * ไม่มีเรื่องไหนมีปกเลย: เรื่องที่อัปเดตล่าสุด (ปกอัตโนมัติวาดเป็นโปสเตอร์ได้ ไม่ปล่อยให้เว็บที่ยังไม่มีรูปปกไม่มี Hero) · ไม่มีเรื่องเลย → null
 */
export function pickHero(novels: NovelCardDto[]): NovelCardDto | null {
  const latest = sortNovels(novels, "latest")
  return latest.find((novel) => novel.featured) ?? latest.find((novel) => novel.hasCover) ?? latest[0] ?? null
}

// ───────────────────────── อ่านต่อ ─────────────────────────

export interface ResumeInfo {
  /** ปลายทางของปุ่ม: ตอนที่ควรอ่านต่อ หรือหน้าเรื่อง (เมื่อรู้ไม่ได้ว่าตอนถัดไปคือตอนไหน) */
  href: string
  /** ข้อความบนปุ่ม/ลิงก์ */
  label: string
  /** ตอนที่อ่านถึง (ที่บันทึกไว้) */
  chapter: number
  /** แถบความคืบหน้า 0–100 = ตอนที่อ่านถึง ÷ ตอนล่าสุด */
  percent: number
}

/**
 * ปุ่ม "อ่านต่อ" ของเรื่องหนึ่งจากความคืบหน้าในเครื่อง:
 * - อ่านค้างกลางตอน หรือจบตอนที่รู้ตอนถัดไป → `resumeTarget` (ตอนเดิม/ตอนถัดไป)
 * - อ่านจบตอนที่ตอนนั้นเป็นตอนสุดท้าย (ไม่รู้ตอนถัดไป) → ไปหน้าเรื่อง: ถ้าตอนนี้มีตอนใหม่กว่านั้นแล้ว "มีตอนใหม่" ไม่งั้น "อ่านทันตอนล่าสุดแล้ว"
 *   (ผู้อ่านนิยายที่ยังไม่จบอ่านทันแล้วกลับมาอีกทีตอนที่ผู้เขียนลงตอนใหม่ — ไม่ควรพาไปอ่านตอนเดิมซ้ำ)
 * - เรื่องที่ตอนนี้ไม่มีตอนให้อ่านเลย → ไปหน้าเรื่อง
 */
export function resumeInfo(novel: NovelCardDto, progress: Progress): ResumeInfo {
  const home = `/novel/${novel.id}`
  const latest = novel.latestNumber
  const percent = latest === null ? 0 : resumePercent(progress.number, latest)
  const base = { chapter: progress.number, percent }
  if (latest === null) return { ...base, href: home, label: "ดูเรื่องนี้" }
  if (progress.pct >= FINISHED_PCT && progress.next === null) {
    return latest > progress.number ? { ...base, href: home, label: "มีตอนใหม่" } : { ...base, href: home, label: "อ่านทันตอนล่าสุดแล้ว" }
  }
  const target = resumeTarget(progress)
  return { ...base, href: `${home}/${target.number}`, label: `อ่านต่อ ตอนที่ ${target.number}` }
}

export interface ContinueItem {
  novel: NovelCardDto
  info: ResumeInfo
}

/**
 * การ์ดแถว "อ่านต่อจากที่ค้างไว้": ไล่ตามประวัติ (ล่าสุดก่อน) ข้ามเรื่องที่ไม่อยู่ในรายการแล้ว (ถูกซ่อน/ลบ) หรือไม่มีความคืบหน้าที่ใช้ได้
 * ได้ไม่เกิน `max` เรื่อง — ไม่มี → อาร์เรย์ว่าง (หน้าแรกซ่อนทั้งส่วน)
 */
export function continueItems(novels: NovelCardDto[], history: number[], progressOf: (id: number) => Progress | null, max: number = CONTINUE_MAX): ContinueItem[] {
  const byId = new Map(novels.map((novel) => [novel.id, novel]))
  const items: ContinueItem[] = []
  const seen = new Set<number>()
  for (const id of history) {
    if (items.length >= max) break
    if (seen.has(id)) continue
    seen.add(id)
    const novel = byId.get(id)
    const progress = novel === undefined ? null : progressOf(id)
    if (novel !== undefined && progress !== null) items.push({ novel, info: resumeInfo(novel, progress) })
  }
  return items
}

// ───────────────────────── สถานะของตารางนิยายทั้งหมด ─────────────────────────

export interface LibraryState {
  status: StatusFilter
  tag: string | null
  sort: SortKey
  /** แสดงไปแล้วกี่หน้า (ทีละ `PAGE_SIZE`) */
  pages: number
}

export const INITIAL_LIBRARY: LibraryState = { status: "all", tag: null, sort: "latest", pages: 1 }

export type LibraryAction =
  | { type: "status"; status: StatusFilter }
  /** แตะแท็กที่เลือกอยู่ซ้ำ = ยกเลิก */
  | { type: "tag"; tag: string }
  | { type: "sort"; sort: SortKey }
  | { type: "more" }
  | { type: "reset" }

/** เปลี่ยนตัวกรอง/การเรียงทุกครั้งกลับไปแสดงหน้าแรก (24 เรื่อง) · `more` เพิ่มทีละหน้าโดยคงตัวกรอง · `reset` กลับค่าเริ่มต้น */
export function libraryReducer(state: LibraryState, action: LibraryAction): LibraryState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status, pages: 1 }
    case "tag":
      return { ...state, tag: state.tag === action.tag ? null : action.tag, pages: 1 }
    case "sort":
      return { ...state, sort: action.sort, pages: 1 }
    case "more":
      return { ...state, pages: state.pages + 1 }
    case "reset":
      return INITIAL_LIBRARY
  }
}

/** แสดงกี่เรื่อง: `pages` × 24 แต่ไม่เกินจำนวนทั้งหมด */
export function shownCount(total: number, pages: number): number {
  return Math.min(total, pages * PAGE_SIZE)
}
