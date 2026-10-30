/**
 * ตรรกะล้วนของหน้านิยายหลังบ้าน (spec 7.4): ร่างข้อมูลของฟอร์ม · ตรวจก่อนส่ง · แท็ก · ให้ AI ช่วยกรอก (ย้อนกลับได้) · ข้อความในรายการ
 * ไม่มี DOM/React จึงเทสต์ตรงๆ ได้ — `Novels.tsx` / `NovelForm.tsx` เป็นแค่ตัวต่อกับ API และหน้าจอ
 */
import type { AiFillResult } from "./adminApi"
import type { AdminNovelDto, NovelInput, NovelMode, NovelStatus } from "./types"

/** ขีดจำกัดของแท็ก ตรงกับเซิร์ฟเวอร์ (server/src/prompts.ts) */
export const MAX_TAGS = 12
export const MAX_TAG_LENGTH = 40
const MAX_URL_LENGTH = 2000

export const STATUS_TEXT: Record<NovelStatus, string> = { ongoing: "กำลังอัปเดต", completed: "จบแล้ว" }
export const MODE_TEXT: Record<NovelMode, string> = { translate: "แปลตรง", story: "เล่าเรื่อง" }
export const MODE_HINT: Record<NovelMode, string> = {
  translate: "แปลครบทุกประโยค รักษาน้ำเสียงและบทสนทนาของต้นฉบับ",
  story: "เล่าด้วยน้ำเสียงผู้เล่าเรื่อง ย่อฉากที่ยืดยาวได้ เหมาะกับการฟัง",
}

/** ตัวอย่างที่ปุ่ม "ใส่ตัวอย่าง" ใส่ให้ในช่องสไตล์การแปล (ไม่เกิน 3000 ตัวอักษรของเซิร์ฟเวอร์) */
export const STYLE_EXAMPLE = [
  "ใช้สรรพนาม “ข้า / เจ้า” ในบทสนทนาของตัวละครหลัก ผู้เล่าเรื่องใช้ภาษากลางสุภาพ",
  "คำเรียกขาน “ท่านอาจารย์” คงไว้ ไม่แปลเป็น “คุณครู”",
  "ชื่อเฉพาะและชื่อสถานที่ทับศัพท์ ไม่แปลความหมาย",
  "ฉากต่อสู้ใช้ประโยคสั้น กระชับ ฉากพรรณนาใช้ประโยคยาวได้",
].join("\n")

// ───────────────────────── ร่างข้อมูลของฟอร์ม ─────────────────────────

/** ช่องทั้งหมดที่ฟอร์มแก้ได้ (ตรงกับ `NovelInput` แบบครบทุกช่อง) */
export interface NovelDraft {
  title: string
  titleTh: string
  author: string
  synopsisSrc: string
  synopsis: string
  tags: string[]
  status: NovelStatus
  sourceUrl: string
  licenseNote: string
  styleNote: string
  mode: NovelMode
  published: boolean
  featured: boolean
}

export function emptyDraft(): NovelDraft {
  return {
    title: "",
    titleTh: "",
    author: "",
    synopsisSrc: "",
    synopsis: "",
    tags: [],
    status: "ongoing",
    sourceUrl: "",
    licenseNote: "",
    styleNote: "",
    mode: "translate",
    published: false,
    featured: false,
  }
}

const DRAFT_KEYS = Object.keys(emptyDraft()) as (keyof NovelDraft)[]

export function draftFromNovel(n: AdminNovelDto): NovelDraft {
  return {
    title: n.title,
    titleTh: n.titleTh,
    author: n.author,
    synopsisSrc: n.synopsisSrc,
    synopsis: n.synopsis,
    tags: [...n.tags],
    status: n.status,
    sourceUrl: n.sourceUrl,
    licenseNote: n.licenseNote,
    styleNote: n.styleNote,
    mode: n.mode,
    published: n.published,
    featured: n.featured,
  }
}

/** สร้างเรื่องใหม่: ส่งทุกช่องตามที่กรอก (เซิร์ฟเวอร์ล้างข้อความและตรวจซ้ำอีกชั้น) */
export function inputFromDraft(d: NovelDraft): NovelInput {
  return { ...d, tags: [...d.tags] }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, i) => item === b[i])

/** แก้เรื่องเดิม: ส่งเฉพาะช่องที่ต่างจากที่บันทึกไว้ (แท็กเทียบตามค่าและลำดับ) */
export function changedFields(saved: NovelDraft, draft: NovelDraft): Partial<NovelInput> {
  const out: Record<string, unknown> = {}
  for (const key of DRAFT_KEYS) {
    if (key === "tags") {
      if (!sameList(saved.tags, draft.tags)) out.tags = [...draft.tags]
    } else if (saved[key] !== draft[key]) {
      out[key] = draft[key]
    }
  }
  return out as Partial<NovelInput>
}

export const isDirty = (saved: NovelDraft, draft: NovelDraft): boolean => Object.keys(changedFields(saved, draft)).length > 0

export interface DraftErrors {
  title?: string
  sourceUrl?: string
}

const URL_BAD_CHARS = /[\s\x00-\x1f\x7f]/

/** ลิงก์ที่ฝังในหน้าเว็บได้อย่างปลอดภัย: http/https ไม่มีช่องว่างหรืออักขระควบคุม อ่านออกเป็นลิงก์ได้ (เหมือน `httpUrl` ของเซิร์ฟเวอร์) */
function isHttpUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url) || URL_BAD_CHARS.test(url)) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/** ตรวจเฉพาะที่ผู้ใช้แก้ได้ทันที (ความยาวช่องอื่นใช้ `maxLength` ของช่องกรอก; ที่เหลือเซิร์ฟเวอร์ตอบเป็นภาษาไทย) */
export function validateDraft(d: NovelDraft): DraftErrors {
  const errors: DraftErrors = {}
  if (d.title.trim() === "") errors.title = "กรอกชื่อต้นฉบับ"
  const url = d.sourceUrl.trim()
  if (url !== "" && !isHttpUrl(url)) errors.sourceUrl = `ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// ไม่มีช่องว่าง และยาวไม่เกิน ${MAX_URL_LENGTH} ตัวอักษร`
  return errors
}

/** ช่องแรกที่ผิดตามลำดับบนหน้า (ไว้ย้ายโฟกัสไปให้แก้) · ไม่ผิด → null */
export function firstInvalidId(errors: DraftErrors): string | null {
  if (errors.title !== undefined) return "nf-title"
  if (errors.sourceUrl !== undefined) return "nf-sourceUrl"
  return null
}

/**
 * ร่างหลังบันทึกสำเร็จ: ช่องที่เจ้าของไม่ได้แตะระหว่างรอคำตอบใช้ค่าที่เซิร์ฟเวอร์เก็บจริง (ล้างช่องว่างแล้ว)
 * ช่องที่พิมพ์เพิ่มระหว่างรอคงของเจ้าของไว้ ไม่ถูกทับ (และยังนับเป็นการแก้ไขที่ค้างอยู่)
 */
export function settleAfterSave(submitted: NovelDraft, current: NovelDraft, server: NovelDraft): NovelDraft {
  const out: Record<string, unknown> = { ...server, tags: [...server.tags] }
  for (const key of DRAFT_KEYS) {
    const edited = key === "tags" ? !sameList(submitted.tags, current.tags) : submitted[key] !== current[key]
    if (edited) out[key] = key === "tags" ? [...current.tags] : current[key]
  }
  return out as unknown as NovelDraft
}

// ───────────────────────── แท็ก ─────────────────────────

/** ตัดช่องว่างหัวท้ายและยุบช่องว่างติดกัน (รวมแท็บ/ขึ้นบรรทัด/อักขระกว้างศูนย์) เป็นเว้นวรรคเดียว */
export function cleanTag(raw: string): string {
  return raw.replace(/[\u{200b}\u{feff}]/gu, "").replace(/\s+/g, " ").trim()
}

const tagKey = (tag: string) => tag.toLowerCase()

export interface TagOutcome {
  tags: string[]
  /** ข้อความไทยบอกเหตุที่เพิ่มไม่ได้ (null = เพิ่มแล้วหรือไม่มีอะไรต้องเพิ่ม) */
  problem: string | null
}

/**
 * เพิ่มแท็กจากข้อความที่พิมพ์/วาง: คั่นด้วย , ， 、 หรือขึ้นบรรทัดใหม่ได้หลายอัน
 * ซ้ำ (ไม่สนตัวพิมพ์) ข้ามเงียบๆ · ยาวเกิน/เกินจำนวน → ไม่เพิ่มเลยสักอัน (ผู้ใช้จะได้แก้ข้อความแล้วลองใหม่โดยไม่เกิดแท็กครึ่งๆ กลางๆ)
 */
export function addTags(tags: string[], raw: string): TagOutcome {
  const seen = new Set(tags.map(tagKey))
  const fresh: string[] = []
  for (const piece of raw.split(/[,，、\n]/).map(cleanTag)) {
    if (piece === "") continue
    if (piece.length > MAX_TAG_LENGTH) return { tags: [...tags], problem: `แท็กแต่ละอันยาวได้ไม่เกิน ${MAX_TAG_LENGTH} ตัวอักษร` }
    if (seen.has(tagKey(piece))) continue
    seen.add(tagKey(piece))
    fresh.push(piece)
  }
  if (tags.length + fresh.length > MAX_TAGS) return { tags: [...tags], problem: `ใส่แท็กได้ไม่เกิน ${MAX_TAGS} อัน` }
  return { tags: [...tags, ...fresh], problem: null }
}

export const removeTag = (tags: string[], index: number): string[] => tags.filter((_, i) => i !== index)

/** รวมแท็กที่ AI แนะนำเข้ากับของเดิม: ของเดิมมาก่อน อันใหม่ไม่ซ้ำ ไม่ว่าง ไม่ยาวเกิน และรวมแล้วไม่เกิน `MAX_TAGS` */
export function mergeTags(existing: string[], suggested: string[]): string[] {
  const out = [...existing]
  const seen = new Set(out.map(tagKey))
  for (const raw of suggested) {
    const tag = cleanTag(raw)
    if (tag === "" || tag.length > MAX_TAG_LENGTH || seen.has(tagKey(tag))) continue
    if (out.length >= MAX_TAGS) break
    seen.add(tagKey(tag))
    out.push(tag)
  }
  return out
}

// ───────────────────────── ให้ AI ช่วยกรอก ─────────────────────────

/** ค่าเดิมของสามช่องที่ AI เติม ไว้ให้ปุ่ม "ย้อนกลับ" */
export interface AiFillUndo {
  titleTh: string
  synopsis: string
  tags: string[]
}

/** ต้องมีชื่อต้นฉบับก่อน AI ถึงจะมีอะไรให้แปล */
export const canAiFill = (d: NovelDraft): boolean => d.title.trim() !== ""

/**
 * เติมผลของ AI ลงร่าง (ยังไม่บันทึก): ชื่อไทย/เรื่องย่อทับของเดิมเมื่อ AI ส่งมา (ว่าง = คงของเจ้าของไว้) · แท็กต่อท้ายของเดิม
 * คืนร่างใหม่พร้อมค่าเดิมสามช่องนั้นไว้ย้อนกลับ
 */
export function applyAiFill(draft: NovelDraft, result: AiFillResult): { draft: NovelDraft; undo: AiFillUndo } {
  const titleTh = result.titleTh.trim()
  const synopsis = result.synopsis.trim()
  return {
    draft: {
      ...draft,
      titleTh: titleTh !== "" ? titleTh : draft.titleTh,
      synopsis: synopsis !== "" ? synopsis : draft.synopsis,
      tags: mergeTags(draft.tags, result.tags),
    },
    undo: { titleTh: draft.titleTh, synopsis: draft.synopsis, tags: [...draft.tags] },
  }
}

/** ย้อนเฉพาะสามช่องที่ AI เติม — สิ่งที่เจ้าของแก้ช่องอื่นต่อจากนั้นอยู่ครบ */
export function undoAiFill(draft: NovelDraft, undo: AiFillUndo): NovelDraft {
  return { ...draft, titleTh: undo.titleTh, synopsis: undo.synopsis, tags: [...undo.tags] }
}

export function aiFillNotice(before: NovelDraft, after: NovelDraft): string {
  const parts: string[] = []
  if (after.titleTh !== before.titleTh) parts.push("ชื่อภาษาไทย")
  if (after.synopsis !== before.synopsis) parts.push("เรื่องย่อภาษาไทย")
  const added = after.tags.length - before.tags.length
  if (added > 0) parts.push(`แท็ก ${added} อัน`)
  if (parts.length === 0) return "AI ไม่ได้เติมอะไรเพิ่ม (ผลลัพธ์ว่างหรือเหมือนที่มีอยู่แล้ว)"
  return `AI เติมให้แล้ว: ${parts.join(" · ")} — ยังไม่ได้บันทึก ตรวจและแก้ได้ก่อน แล้วกดบันทึก`
}

// ───────────────────────── ข้อความในรายการ ─────────────────────────

/** ชื่อไทยเป็นหลัก (ถ้ามี) ชื่อต้นฉบับเป็นรอง */
export function novelTitles(n: Pick<AdminNovelDto, "title" | "titleTh">): { main: string; sub: string } {
  const th = n.titleTh.trim()
  return th === "" ? { main: n.title, sub: "" } : { main: th, sub: n.title }
}

/** แปลแล้ว / ทั้งหมด */
export const countsText = (n: Pick<AdminNovelDto, "translatedCount" | "chapterCount">): string => `${n.translatedCount} / ${n.chapterCount}`

export function deleteMessage(n: Pick<AdminNovelDto, "title" | "titleTh" | "chapterCount">): string {
  const { main } = novelTitles(n)
  if (n.chapterCount === 0) return `ลบเรื่อง “${main}” ถาวร — เรื่องนี้ยังไม่มีตอน จะลบอภิธานศัพท์และปก (ถ้ามี) ไปด้วย กู้คืนไม่ได้`
  return `ลบเรื่อง “${main}” ถาวร — จะลบตอนทั้งหมด (${n.chapterCount} ตอน) อภิธานศัพท์ และปกของเรื่องนี้ไปด้วย กู้คืนไม่ได้`
}
