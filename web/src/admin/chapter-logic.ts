/**
 * ตรรกะล้วนของตารางตอน (spec 7.6): สถานะที่ต้องดึงซ้ำ · การเลือกแถว · ข้อความผลของคำสั่งหลายตอน · ข้อความยืนยันลบ
 * ไม่มี DOM/React จึงเทสต์ตรงๆ ได้ — `ChapterTable.tsx` ต่อกับ API และหน้าจอ
 */
import { formatCount } from "./format"
import type { AdminChapterRow, BulkResult, ChapterStatus } from "./types"

/** ระยะดึงรายการซ้ำเมื่อมีตอนที่ยังรอคิว/กำลังแปล (มิลลิวินาที) */
export const POLL_MS = 2000

/** มีตอนที่สถานะยังเปลี่ยนเองได้ (รอคิว/กำลังแปล) → ต้องดึงซ้ำ */
export function hasLive(rows: readonly AdminChapterRow[]): boolean {
  return rows.some((row) => row.status === "queued" || row.status === "translating")
}

/** โทนสีของชิปสถานะ (`data-tone` ของ `.ad-pill`) */
export const STATUS_TONE: Record<ChapterStatus, string> = { draft: "idle", queued: "warn", translating: "live", done: "ok", error: "fail" }

/** ตอนที่ "เผยแพร่ตอนที่แปลเสร็จทั้งหมด" จะเผยแพร่ให้ — ตรงกับ READY_TO_PUBLISH_SQL ของเซิร์ฟเวอร์ */
export function readyCount(rows: readonly AdminChapterRow[]): number {
  return rows.filter((row) => row.status === "done" && !row.published && row.hasTranslation).length
}

export function summaryText(rows: readonly AdminChapterRow[]): string {
  const done = rows.filter((row) => row.status === "done").length
  const published = rows.filter((row) => row.published).length
  return `ทั้งหมด ${formatCount(rows.length)} ตอน · แปลแล้ว ${formatCount(done)} · เผยแพร่ ${formatCount(published)}`
}

/** สวิตช์เผยแพร่: ตอนที่ไม่มีคำแปลเผยแพร่ไม่ได้ (เซิร์ฟเวอร์ก็ข้ามให้) จึงปิดพร้อมเหตุผล */
export function publishSwitch(row: AdminChapterRow): { disabled: boolean; reason: string | null } {
  return row.hasTranslation ? { disabled: false, reason: null } : { disabled: true, reason: "ยังไม่มีคำแปล จึงเผยแพร่ไม่ได้" }
}

export function toggleOne(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected)
  if (!next.delete(id)) next.add(id)
  return next
}

/** ช่องเลือกทั้งหมด: ยังเลือกไม่ครบ → เลือกทุกแถว · ครบแล้ว → ล้าง */
export function toggleAll(selected: ReadonlySet<number>, rows: readonly AdminChapterRow[]): Set<number> {
  const all = rows.length > 0 && rows.every((row) => selected.has(row.id))
  return all ? new Set() : new Set(rows.map((row) => row.id))
}

/** ตัดรหัสที่ไม่มีในรายการแล้ว (ตอนถูกลบ/รายการเปลี่ยน) · ไม่มีอะไรต้องตัด → คืนตัวเดิม (ไม่ทำให้ state เปลี่ยน) */
export function selectionAfter(selected: ReadonlySet<number>, rows: readonly AdminChapterRow[]): ReadonlySet<number> {
  const present = new Set(rows.map((row) => row.id))
  const kept = [...selected].filter((id) => present.has(id))
  return kept.length === selected.size ? selected : new Set(kept)
}

/** รหัสของแถวที่เลือก เรียงตามลำดับในตาราง (เลขตอน) */
export function idsOf(selected: ReadonlySet<number>, rows: readonly AdminChapterRow[]): number[] {
  return rows.filter((row) => selected.has(row.id)).map((row) => row.id)
}

/** ป้ายปุ่มสั่งแปลของแถวที่เลือก: ยังไม่มีคำแปล = "แปล" · มีแล้ว = "แปลใหม่" */
export function translateLabel(selected: readonly AdminChapterRow[]): string {
  if (selected.length === 0) return "แปล / แปลใหม่"
  if (selected.every((row) => !row.hasTranslation)) return "แปล"
  if (selected.every((row) => row.hasTranslation)) return "แปลใหม่"
  return "แปล / แปลใหม่"
}

export type BulkAction = "translate" | "publish" | "hide" | "delete"

/** ข้อความแจ้งผลคำสั่งหลายตอน (รายงานจำนวนที่ข้ามเสมอ) */
export function bulkNotice(action: BulkAction, result: BulkResult): string {
  const changed = result.changed ?? 0
  const skipped = result.skipped ?? 0
  switch (action) {
    case "translate": {
      const queued = result.queued ?? 0
      if (queued === 0) return skipped > 0 ? `ไม่มีตอนที่ส่งเข้าคิวเพิ่ม — ${formatCount(skipped)} ตอนอยู่ในคิวหรือกำลังแปลอยู่แล้ว` : "ไม่มีตอนที่ต้องส่งเข้าคิว"
      const base = `ส่งเข้าคิวแปลแล้ว ${formatCount(queued)} ตอน`
      return skipped > 0 ? `${base} · ข้าม ${formatCount(skipped)} ตอน (อยู่ในคิวหรือกำลังแปลอยู่แล้ว)` : base
    }
    case "publish":
      if (changed === 0) return skipped > 0 ? `ไม่ได้เผยแพร่ — ข้าม ${formatCount(skipped)} ตอนที่ยังไม่มีคำแปล` : "ตอนที่เลือกเผยแพร่อยู่แล้ว"
      return skipped > 0 ? `เผยแพร่แล้ว ${formatCount(changed)} ตอน · ข้าม ${formatCount(skipped)} ตอน (ยังไม่มีคำแปล)` : `เผยแพร่แล้ว ${formatCount(changed)} ตอน`
    case "hide":
      return changed > 0 ? `ซ่อนแล้ว ${formatCount(changed)} ตอน` : "ตอนที่เลือกซ่อนอยู่แล้ว"
    case "delete": {
      const deleted = result.deleted ?? 0
      return deleted > 0 ? `ลบแล้ว ${formatCount(deleted)} ตอน` : "ไม่มีตอนที่ถูกลบ"
    }
  }
}

const SHOWN_NUMBERS = 5

/** ข้อความในกล่องยืนยันลบ */
export function deleteMessage(rows: readonly AdminChapterRow[]): string {
  const live = rows.some((row) => row.status === "translating") ? " ตอนที่กำลังแปลอยู่จะถูกยกเลิกการแปล" : ""
  const tail = `ต้นฉบับและคำแปลของตอนที่ลบจะหายถาวร กู้คืนไม่ได้${live}`
  if (rows.length === 1) {
    const [only] = rows
    const name = only!.titleTh !== "" ? only!.titleTh : only!.title
    return `ลบตอนที่ ${only!.number}${name === "" ? "" : ` “${name}”`}? ${tail}`
  }
  const numbers = rows.slice(0, SHOWN_NUMBERS).map((row) => row.number).join(", ")
  const more = rows.length > SHOWN_NUMBERS ? ` และอีก ${formatCount(rows.length - SHOWN_NUMBERS)} ตอน` : ""
  return `ลบ ${formatCount(rows.length)} ตอน (ตอนที่ ${numbers}${more}) ${tail}`
}
