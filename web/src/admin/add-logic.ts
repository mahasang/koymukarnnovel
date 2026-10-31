/**
 * กติกาล้วนของหน้า "เพิ่มตอน" (spec 7.5) — ไม่แตะ DOM/ที่เก็บข้อมูล จึงเทสต์ตรงๆ
 * ตัวเลือก "แปลทันที"/"เผยแพร่เอง" จำค่าล่าสุดไว้ แต่ค่าที่ใช้จริงต้องผ่าน `effectiveOptions` เสมอ (ไม่มีคีย์ API = บันทึกเป็นร่างเท่านั้น)
 */
import { ApiError } from "../lib/api"
import { estimateCost } from "../lib/cost"
import { isChapterNumber, type ParsedIssue, type ParsedRow, revalidate } from "../lib/parse-chapters"
import type { NewChaptersInput } from "./adminApi"
import { formatCount } from "./format"
import { formatUsd } from "./dashboard-logic"

export interface AddOptions {
  /** แปลทันทีหลังสร้างตอน (false = บันทึกเป็นร่าง รอสั่งแปลทีหลัง) */
  translate: boolean
  /** เผยแพร่เองเมื่อแปลเสร็จ */
  publish: boolean
}

export const DEFAULT_OPTIONS: AddOptions = { translate: true, publish: false }

/** อ่านค่าที่จำไว้ (อาจเสีย/มาจากแอปรุ่นเก่า): ช่องไหนชนิดผิดใช้ค่าเริ่มต้นของช่องนั้น */
export function parseOptions(raw: unknown): AddOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_OPTIONS }
  const o = raw as Record<string, unknown>
  return {
    translate: typeof o.translate === "boolean" ? o.translate : DEFAULT_OPTIONS.translate,
    publish: typeof o.publish === "boolean" ? o.publish : DEFAULT_OPTIONS.publish,
  }
}

/** ค่าที่ส่งจริง: ไม่มีคีย์ API → ไม่แปล · ไม่แปล → ไม่เผยแพร่เอง (เซิร์ฟเวอร์ตอบ 400 `no_api_key` ถ้าสั่งแปลทั้งที่ไม่มีคีย์) */
export function effectiveOptions(options: AddOptions, apiKeySet: boolean): AddOptions {
  const translate = options.translate && apiKeySet
  return { translate, publish: translate && options.publish }
}

export function submitLabel(count: number, translate: boolean): string {
  if (!translate) return "บันทึกเป็นร่าง"
  return count > 0 ? `แปล ${count} ตอน` : "แปล"
}

/** ตอนที่ติ๊กไว้ เรียงตามเลขตอน (เซิร์ฟเวอร์เข้าคิวตามลำดับที่ส่ง จึงต้องเรียงก่อนส่ง) */
export function buildPayload(rows: readonly ParsedRow[], options: AddOptions): NewChaptersInput {
  const chapters: NewChaptersInput["chapters"] = []
  for (const r of rows) {
    if (r.checked && isChapterNumber(r.number)) chapters.push({ number: r.number, title: r.title.trim(), text: r.text })
  }
  chapters.sort((a, b) => a.number - b.number)
  return { chapters, translate: options.translate, publish: options.publish }
}

/** 409 `duplicate_numbers` → เลขที่ชน (เลขตอนที่ใช้ได้เท่านั้น — ตอน 0 นับ) · อย่างอื่น → null */
export function conflictsOf(error: unknown): number[] | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "duplicate_numbers") return null
  const list = (error.data as { conflicts?: unknown } | undefined)?.conflicts
  if (!Array.isArray(list)) return null
  const numbers = list.filter((n): n is number => typeof n === "number" && isChapterNumber(n))
  return numbers.length === 0 ? null : numbers
}

/**
 * ทำเครื่องหมายแถวที่เซิร์ฟเวอร์ว่าชน: เพิ่มเลขเหล่านั้นเข้าเซตตอนที่มีอยู่ (ให้ `revalidate` ครั้งต่อๆ ไปยังเห็นว่าซ้ำ) แล้วเอาติ๊กออก
 * ไม่แก้ของเดิม
 */
export function applyConflicts(
  rows: readonly ParsedRow[],
  existing: ReadonlySet<number>,
  conflicts: readonly number[],
): { rows: ParsedRow[]; existing: Set<number> } {
  const nextExisting = new Set(existing)
  for (const n of conflicts) nextExisting.add(n)
  const marked = revalidate(rows, nextExisting).map((r) => (r.number !== null && conflicts.includes(r.number) ? { ...r, checked: false } : r))
  return { rows: marked, existing: nextExisting }
}

/** ข้อความเมื่อส่งไม่สำเร็จ — ใช้ข้อความไทยของเซิร์ฟเวอร์ (413 เติมคำแนะนำ) */
export function submitErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "ทำไม่สำเร็จ ลองอีกครั้ง"
  if (error.status === 413) return `${error.message} — ลดจำนวนตอนต่อการวางหนึ่งครั้งแล้วลองใหม่`
  return error.message
}

/** บรรทัดประมาณการก่อนสั่งแปล (ไม่มีตอนที่ติ๊ก → null) · ไม่มีราคาของโมเดล → ไม่แสดงเงิน */
export function costLine(chars: readonly number[], price: { in: number; out: number } | undefined): string | null {
  if (chars.length === 0) return null
  const { input, output, cost } = estimateCost(chars, price)
  const tokens = `โทเคนเข้า ≈ ${formatCount(input)} · ออก ≈ ${formatCount(output)}`
  const money = cost === null ? null : formatUsd(cost)
  return `ประมาณการ: ${chars.length} ตอน · ${tokens}${money === null ? "" : ` · ค่าใช้จ่าย ≈ ${money}`} (ประมาณคร่าวๆ ยอดจริงดูที่แดชบอร์ด)`
}

const NOTE: Record<ParsedIssue, string> = {
  duplicate: "เลขตอนนี้ซ้ำกับตอนที่มีอยู่แล้ว",
  bad_number: "เลขตอนใช้ไม่ได้ (ต้องเป็นจำนวนเต็มบวก)",
  empty: "ไม่มีเนื้อหา",
  too_long: "ยาวเกิน 200,000 ตัวอักษร",
}
const NOTE_ORDER: readonly ParsedIssue[] = ["duplicate", "bad_number", "empty", "too_long"]

/** ป้ายเตือนของแถวเป็นข้อความเดียว (null = ไม่มีปัญหา) */
export function rowNote(issues: readonly ParsedIssue[]): string | null {
  const parts = NOTE_ORDER.filter((i) => issues.includes(i)).map((i) => NOTE[i])
  return parts.length === 0 ? null : parts.join(" · ")
}

/** `?novel=` → รหัสเรื่องที่มีอยู่จริง (ไม่ใช่เลขจำนวนเต็มบวก/ไม่พบ → null ให้เจ้าของเลือกเอง) */
export function novelIdFrom(param: string | null, novels: readonly { id: number }[]): number | null {
  if (param === null || !/^[1-9]\d*$/.test(param)) return null
  const id = Number(param)
  return novels.some((n) => n.id === id) ? id : null
}

/** ช่องเลขตอน: ว่าง → null (ล้างเลข) · เลขล้วนไม่เกิน 10 หลัก → จำนวน · อย่างอื่น → undefined (ไม่รับ คงค่าเดิม) */
export function parseNumberInput(value: string): number | null | undefined {
  const t = value.trim()
  if (t === "") return null
  return /^\d{1,10}$/.test(t) ? Number(t) : undefined
}

export interface RowPatch {
  checked?: boolean
  number?: number | null
  title?: string
}

/** แก้แถวตาม `key` แล้วตรวจทุกแถวใหม่ (แถวที่เพิ่งมีปัญหาใหม่ถูกเอาติ๊กออก) · ไม่แก้ของเดิม */
export function editRow(rows: readonly ParsedRow[], existing: ReadonlySet<number>, key: string, patch: RowPatch): ParsedRow[] {
  return revalidate(
    rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    existing,
  )
}
