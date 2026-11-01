/**
 * ตรรกะล้วนของหน้าแดชบอร์ด (ไม่มี React/DOM จึงเทสต์ตรงๆ ได้) — ส่วนแสดงผลอยู่ใน `Dashboard.tsx`
 * เวลาจากเซิร์ฟเวอร์เป็นข้อความ `YYYY-MM-DD HH:MM:SS` เวลา UTC เสมอ (แสดงเป็นเวลาไทย UTC+7)
 */
import { parseSqlTime, thaiDate } from "../lib/format"
import { formatCount } from "./format"
import type { ApiCheckDto, BulkResult, DashboardDto, QueueError, QueueState, UsageRowDto } from "./types"

// ───────────────────────── เริ่มต้นใช้งาน ─────────────────────────

export type OnboardingId = "api-key" | "contact" | "first-novel"

export interface OnboardingItem {
  id: OnboardingId
  title: string
  hint: string
  /** หน้าที่ไปทำข้อนี้ */
  to: string
  done: boolean
  /** ยังไม่ทำและสำคัญ (ช่องทางติดต่อเจ้าของลิขสิทธิ์) → แสดงสีเด่น */
  warn: boolean
}

/** ขั้นตอนเริ่มต้น 3 ข้อตามลำดับ: ① รหัส API (หรือรหัสนำเข้า) ② ช่องทางติดต่อเจ้าของลิขสิทธิ์ ③ นิยายเรื่องแรก */
export function onboardingItems(o: DashboardDto["onboarding"]): OnboardingItem[] {
  return [
    {
      id: "api-key",
      title: "ตั้งรหัส API สำหรับแปล",
      hint: "ตั้ง ANTHROPIC_API_KEY ให้เซิร์ฟเวอร์ — หรือตั้ง IMPORT_TOKEN ถ้าจะส่งคำแปลเข้ามาจากภายนอก แล้วดูสถานะในหน้าตั้งค่า",
      to: "/admin/settings",
      done: o.apiKey,
      warn: false,
    },
    {
      id: "contact",
      title: "กรอกช่องทางติดต่อเจ้าของลิขสิทธิ์",
      hint: "ให้เจ้าของผลงานติดต่อขอแก้ไขหรือถอดเรื่องได้ — ข้อความนี้แสดงในหน้า “ติดต่อ” ของเว็บ",
      to: "/admin/settings",
      done: o.contact,
      warn: !o.contact,
    },
    {
      id: "first-novel",
      title: "สร้างนิยายเรื่องแรก",
      hint: "ใส่ชื่อเรื่อง แล้ววางตอนภาษาอังกฤษเพื่อให้ AI แปลเป็นไทย",
      to: "/admin/novels/new",
      done: o.firstNovel,
      warn: false,
    },
  ]
}

export function onboardingComplete(o: DashboardDto["onboarding"]): boolean {
  return o.apiKey && o.contact && o.firstNovel
}

// ───────────────────────── คิวสด ─────────────────────────

/**
 * ลายเซ็นของคิวที่ใช้ตัดสินว่าตัวเลขบนแดชบอร์ดน่าจะเก่าแล้ว (ตอนที่กำลังแปลเปลี่ยน/จบ, จำนวนที่รอ, หยุด/ทำต่อ, รายการผิดพลาด)
 * ส่วนที่แปลอยู่และข้อความที่ไหลไม่รวม: เปลี่ยนทุกไม่กี่วินาทีแต่ไม่กระทบตัวเลข · `null` = ยังไม่เคยได้สถานะ
 */
export function queueSignature(state: QueueState | null, errors: QueueError[]): string {
  if (state === null) return "pending"
  const failed = errors
    .map((e) => e.id)
    .sort((a, b) => a - b)
    .join(",")
  return `${state.paused ? "paused" : "running"}|${state.current?.chapterId ?? "-"}|${state.waitingTotal}|${failed}`
}

/** ผู้ใช้อยู่ท้ายกล่องที่เลื่อนได้หรือยัง (เหลือไม่เกิน `slack` พิกเซลถือว่าอยู่) — ค่าที่ใช้ไม่ได้ถือว่าอยู่ท้าย */
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 24): boolean {
  if (![scrollTop, clientHeight, scrollHeight, slack].every(Number.isFinite)) return true
  return scrollHeight - scrollTop - clientHeight <= slack
}

/** ข้อความและเปอร์เซ็นต์ของตอนที่กำลังแปล: ส่วนที่แปลเสร็จแล้วต่อส่วนทั้งหมด (`chunkIndex` นับจาก 0) · ยังไม่รู้จำนวนส่วน → ไม่มีเปอร์เซ็นต์ */
export function chunkProgress(current: { chunkIndex: number; chunkTotal: number }): { label: string; percent: number } {
  const total = current.chunkTotal
  if (!(total > 0)) return { label: "กำลังเตรียมแปล", percent: 0 }
  const index = Number.isFinite(current.chunkIndex) ? current.chunkIndex : 0
  const part = Math.min(Math.max(index + 1, 1), total)
  const percent = Math.min(Math.max(Math.round((index / total) * 100), 0), 100)
  return { label: `กำลังแปล ส่วนที่ ${part} จาก ${total}`, percent }
}

/** แถวที่รอที่โชว์ (ไม่เกิน `limit`) และจำนวนที่ไม่ได้โชว์ — นับจากจำนวนรอทั้งหมดของเซิร์ฟเวอร์ (ที่ส่งมาแค่ 50 แถวแรก) */
export function waitingRows(state: QueueState, limit = 8): { rows: QueueState["waiting"]; more: number } {
  const rows = state.waiting.slice(0, limit)
  return { rows, more: Math.max(0, state.waitingTotal - rows.length) }
}

/** ข้อความแทนตอนที่กำลังแปลในแผงคิว (มีตอนกำลังแปล → null) */
export function queueIdleNote(state: QueueState): string | null {
  if (state.current !== null) return null
  if (state.paused) return "คิวหยุดอยู่ — กด “ทำต่อ” เพื่อแปลต่อ"
  if (state.waitingTotal > 0) return "กำลังเตรียมแปลตอนถัดไป…"
  return "คิวว่าง — ยังไม่มีตอนรอแปล"
}

export const chapterPath = (novelId: number, chapterId: number) => `/admin/novels/${novelId}/chapters/${chapterId}`

// ───────────────────────── ตัวเลขและเวลา ─────────────────────────

/** ค่าใช้จ่ายโดยประมาณเป็นดอลลาร์ · null/ค่าที่ใช้ไม่ได้ → null (ประเมินไม่ได้) · ≥ 1 สองตำแหน่ง · < 1 ถึงสี่ตำแหน่งตัดศูนย์ท้าย */
export function formatUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null
  if (value === 0) return "$0.00"
  if (value < 0.0001) return "<$0.0001"
  // ต่ำกว่า 1 ดอลลาร์: 4 ตำแหน่งตัดศูนย์ท้ายไม่เกิน 2 ตัว (เหลือ ≥ 2 ตำแหน่ง) · 0.99996 ปัดเป็น "1.0000" → "1.00" เอง
  if (value < 1) return `$${value.toFixed(4).replace(/0{1,2}$/, "")}`
  return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

const HOUR = 60 * 60 * 1000

/** "31 ต.ค. 2569 00:28 น." จากเวลา SQL (UTC) · รูปแบบผิด → "" */
export function thaiDateTime(sql: string): string {
  const time = parseSqlTime(sql)
  if (time === null) return ""
  const thai = new Date(time + 7 * HOUR)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${thaiDate(sql)} ${pad(thai.getUTCHours())}:${pad(thai.getUTCMinutes())} น.`
}

/** เปอร์เซ็นต์ที่แปลแล้วของเรื่อง (0–100, ปัดเศษ) · เรื่องที่ยังไม่มีตอน/ค่าที่ใช้ไม่ได้ → 0 */
export function progressPercent(translated: number, total: number): number {
  if (!(total > 0)) return 0
  const pct = Math.round((translated / total) * 100)
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
}

export function usageTotals(rows: UsageRowDto[]): { tokensIn: number; tokensOut: number; calls: number } {
  return rows.reduce(
    (sum, row) => ({ tokensIn: sum.tokensIn + row.tokensIn, tokensOut: sum.tokensOut + row.tokensOut, calls: sum.calls + row.calls }),
    { tokensIn: 0, tokensOut: 0, calls: 0 },
  )
}

// ───────────────────────── สถานะ API และผลเผยแพร่ ─────────────────────────

export interface ApiStatus {
  tone: "ok" | "fail" | "warn" | "idle"
  label: string
  detail: string
}

/** สถานะเชื่อมต่อ API: ไม่มีรหัส (เตือน) · มีรหัสแต่ไม่เคยทดสอบ · ทดสอบล่าสุดผ่าน · ทดสอบล่าสุดไม่ผ่าน (พร้อมข้อความ) */
export function apiStatus(api: { hasKey: boolean; lastOk: ApiCheckDto | null }): ApiStatus {
  if (!api.hasKey) return { tone: "warn", label: "ยังไม่ได้ตั้งรหัส API", detail: "แปลด้วย AI ไม่ได้จนกว่าจะตั้งรหัส" }
  const check = api.lastOk
  if (check === null) return { tone: "idle", label: "ตั้งรหัสแล้ว", detail: "ยังไม่เคยทดสอบการเชื่อมต่อ" }
  const when = thaiDateTime(check.at)
  if (check.ok) return { tone: "ok", label: "API พร้อมใช้งาน", detail: when === "" ? "" : `ทดสอบล่าสุด ${when}` }
  return { tone: "fail", label: "เชื่อมต่อ API ไม่สำเร็จ", detail: [when, check.message].filter((part) => part !== "").join(" · ") }
}

/** ข้อความแจ้งผลหลัง "เผยแพร่ทั้งหมด" */
export function publishNotice(result: BulkResult): string {
  const changed = result.changed ?? 0
  if (changed <= 0) return "ไม่มีตอนที่ต้องเผยแพร่เพิ่ม"
  const skipped = result.skipped ?? 0
  return skipped > 0 ? `เผยแพร่แล้ว ${formatCount(changed)} ตอน · ข้าม ${formatCount(skipped)} ตอน` : `เผยแพร่แล้ว ${formatCount(changed)} ตอน`
}
