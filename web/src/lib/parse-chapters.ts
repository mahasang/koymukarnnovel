/**
 * แยกข้อความที่วางมา (หลายตอนต่อกัน) เป็นแถวตอนให้หน้า "เพิ่มตอน" ตรวจและให้เจ้าของแก้ก่อนส่ง — ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM
 * กติกาตามสเปก 7.5:
 * - บรรทัดหัวข้อ = ขึ้นต้นด้วย Chapter / Ch. / Ch / Episode / Ep. (ไม่สนตัวพิมพ์) ตามด้วยเลขอารบิก และทั้งบรรทัดไม่เกิน 120 ตัวอักษร
 * - ส่วนที่ตามหลังเลขคือชื่อตอน: มีตัวคั่น (`:` `-` `–` `—` `.` `|`) นำหน้าได้ · ถ้าไม่มีตัวคั่น ชื่อต้องขึ้นต้นด้วยตัวพิมพ์ใหญ่ ตัวเลข หรือตัวอักษรที่ไม่ใช่ละติน
 *   (ประโยคอย่าง "Chapter 3 was the hardest day." จึงไม่ใช่หัวข้อ)
 * - ข้อความก่อนหัวข้อแรกเป็นแถวของตัวเอง · ไม่พบหัวข้อเลย = ตอนเดียวทั้งก้อน
 * ข้อตกลงที่สเปกไม่ได้ระบุ (ล็อกไว้ด้วยเทสต์): เลขต้องตามด้วยช่องว่าง ตัวคั่น หรือจบบรรทัด ("Chapter 1A" ไม่ใช่หัวข้อ) · ย่อหน้านำหน้าบรรทัดหัวข้อได้ ·
 * ข้อความก่อนหัวข้อแรกได้เลขถัดไปทั้งที่ติ๊กหรือไม่ติ๊ก · ตอนว่างไม่แย่งเลขกับตอนจริง (สารบัญที่วางมาด้วย) · ข้อความว่าง = ไม่มีแถว
 */

export type ParsedIssue = "duplicate" | "bad_number" | "empty" | "too_long"

export interface ParsedRow {
  /** ใช้เป็น React key: ผูกกับตำแหน่งในที่วาง จึงไม่เปลี่ยนเมื่อแก้เลข/ชื่อ และไม่ซ้ำกันแม้เลขตอนซ้ำกัน */
  key: string
  /** `chapter` = มีหัวข้อ · `preamble` = ข้อความก่อนหัวข้อแรก · `single` = ทั้งก้อนเป็นตอนเดียว (ไม่พบหัวข้อ หรือสั่ง `forceSingle`) */
  kind: "chapter" | "preamble" | "single"
  /** `null` = เลขในหัวข้อใช้ไม่ได้ (เช่น 12.5) หรือเจ้าของล้างช่องเลข */
  number: number | null
  title: string
  /** เนื้อหาหลังล้างแล้ว (ไม่รวมบรรทัดหัวข้อ) */
  text: string
  words: number
  checked: boolean
  issues: ParsedIssue[]
}

export const MAX_CHAPTERS = 100
export const MAX_CHARS = 200_000

const MAX_HEADING_CHARS = 120
/** ข้อความก่อนหัวข้อแรกที่สั้นกว่านี้มักเป็นเมนู/โน้ต จึงไม่ติ๊กให้ */
const PREAMBLE_MIN_CHARS = 500
/**
 * ข้อความรวมของตอนที่เลือกต้องไม่เกิน 7.5MB (ทศนิยม = 7,500,000 ไบต์ UTF-8) เผื่อที่ให้เครื่องหมายและชื่อใน JSON ไม่ให้ชนเพดาน body 8MB ของเซิร์ฟเวอร์
 * วัดเป็นไบต์ เพราะตัวอักษรนอก ASCII (เครื่องหมายคำพูดโค้ง, ภาษาอื่น) กินหลายไบต์
 */
const MAX_TOTAL_BYTES = 7_500_000

// ───────────────────────── ล้างข้อความ ─────────────────────────

/**
 * ล้างข้อความที่คัดลอกมา — ผลต้องเหมือน `normalizeText` ของเซิร์ฟเวอร์ (server/src/util/text.ts) เพราะเซิร์ฟเวอร์วัดความยาวและเก็บข้อความหลังล้างด้วยตัวนั้น
 * (เว็บไม่ import จากเซิร์ฟเวอร์ จึงเขียนซ้ำที่นี่ และเทสต์เทียบทั้งสองกับข้อความสุ่ม)
 * ต่างจากต้นฉบับเพียงจุดเดียว: `(?<![ \t])` ให้ตัดช่องว่างท้ายบรรทัดในเวลาเป็นเส้นตรง — ต้นฉบับใช้เวลากำลังสองกับช่องว่างยาวๆ กลางบรรทัด
 * (ช่องว่าง 50,000 ตัวค้างหลายวินาที) ซึ่งทำให้แท็บค้างตอนวาง; ผลลัพธ์เหมือนกันทุกกรณี
 */
function cleanText(s: string): string {
  return s
    .replace(/[\uFEFF\u200B]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/(?<![ \t])[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** `text` ที่ส่งเข้ามาตัดหัวท้ายแล้วเสมอ */
function countWords(text: string): number {
  return text === "" ? 0 : text.split(/\s+/).length
}

// ───────────────────────── หัวข้อ ─────────────────────────

/** เลขตอนที่เซิร์ฟเวอร์รับ: จำนวนเต็มที่ JavaScript แทนได้เป๊ะ ตั้งแต่ 0 ขึ้นไป (ตอน 0 ใช้ได้) */
export function isChapterNumber(n: number | null): n is number {
  return n !== null && Number.isSafeInteger(n) && n >= 0
}

/** คำบอกตอน + เลข (อาจมีจุดทศนิยมอย่าง 12.5 ซึ่งจะกลายเป็น `bad_number`) + ส่วนที่เหลือของบรรทัด */
const HEADING = /^(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)*)([\s\S]*)/i
/** ตัวคั่นหนึ่งตัวนำหน้าชื่อ (เว้นวรรคนำหน้าได้ ส่วนหลังตัวคั่นผู้เรียกตัดเอง) */
const SEPARATED_TITLE = /^\s*[:\-–—.|]([\s\S]*)/
/** ชื่อที่ไม่มีตัวคั่นต้องขึ้นต้นด้วยตัวพิมพ์ใหญ่ ตัวเลข หรือตัวอักษรที่ไม่ใช่ละติน */
const BARE_TITLE_START = /^(?:[\p{Lu}\d]|(?!\p{Script=Latin})\p{L})/u

interface Heading {
  number: number | null
  title: string
}

function headingNumber(digits: string): number | null {
  if (!/^\d+$/.test(digits)) return null
  const n = Number(digits)
  return isChapterNumber(n) ? n : null
}

function parseHeading(line: string): Heading | null {
  const text = line.trim()
  if (text.length > MAX_HEADING_CHARS) return null
  const match = HEADING.exec(text)
  if (match === null) return null
  const [, digits, rest] = match
  const number = headingNumber(digits)

  const separated = SEPARATED_TITLE.exec(rest)
  if (separated !== null) return { number, title: separated[1].trim() }
  if (rest === "") return { number, title: "" }
  // ไม่มีตัวคั่น: ต้องเว้นวรรคจากเลข ("Chapter 1A" ไม่ใช่หัวข้อ) และชื่อต้องขึ้นต้นตามกติกา
  const bare = rest.trim()
  if (/^\s/.test(rest) && BARE_TITLE_START.test(bare)) return { number, title: bare }
  return null
}

// ───────────────────────── แยกตอน ─────────────────────────

interface Chapter {
  heading: Heading
  lines: string[]
}

/** `lead` = บรรทัดก่อนหัวข้อแรก · `chapters` = หัวข้อแต่ละอันกับบรรทัดจนถึงหัวข้อถัดไป */
function splitSections(clean: string): { lead: string[]; chapters: Chapter[] } {
  const lead: string[] = []
  const chapters: Chapter[] = []
  for (const line of clean.split("\n")) {
    const heading = parseHeading(line)
    if (heading !== null) chapters.push({ heading, lines: [] })
    else (chapters.length === 0 ? lead : chapters[chapters.length - 1].lines).push(line)
  }
  return { lead, chapters }
}

/** เลขว่างถัดไป = สูงสุดของทุกกลุ่มที่ให้มา + 1 (ไม่มีเลยคือ 1) */
function nextFreeNumber(...groups: Iterable<number>[]): number {
  let highest = 0
  for (const group of groups) for (const n of group) highest = Math.max(highest, n)
  return highest + 1
}

type Draft = Pick<ParsedRow, "kind" | "number" | "title" | "text" | "checked">

/** ใส่ key/words แล้วให้ `revalidate` คำนวณ issues และติ๊กออกแถวที่มีปัญหา (กฎเดียวกับตอนเจ้าของแก้) */
function toRows(drafts: readonly Draft[], existing: ReadonlySet<number>): ParsedRow[] {
  const rows = drafts.map((draft, index): ParsedRow => ({ ...draft, key: `row-${index}`, words: countWords(draft.text), issues: [] }))
  return revalidate(rows, existing)
}

function singleRow(clean: string, existing: ReadonlySet<number>): ParsedRow[] {
  return toRows([{ kind: "single", number: nextFreeNumber(existing), title: "", text: clean, checked: true }], existing)
}

export function parseChapters(text: string, existing: ReadonlySet<number>): ParsedRow[] {
  const clean = cleanText(text)
  if (clean === "") return []
  const { lead, chapters } = splitSections(clean)
  if (chapters.length === 0) return singleRow(clean, existing)

  const drafts: Draft[] = []
  const leadText = lead.join("\n").trim()
  if (leadText !== "") {
    const pasted = chapters.map(({ heading }) => heading.number ?? 0) // เลขที่ใช้ไม่ได้ไม่นับ
    drafts.push({ kind: "preamble", number: nextFreeNumber(existing, pasted), title: "", text: leadText, checked: leadText.length >= PREAMBLE_MIN_CHARS })
  }
  for (const { heading, lines } of chapters) {
    drafts.push({ kind: "chapter", number: heading.number, title: heading.title, text: lines.join("\n").trim(), checked: true })
  }
  return toRows(drafts, existing)
}

/** ปุ่ม "ไม่ต้องแยกตอน": ทั้งก้อน (รวมบรรทัดหัวข้อ) เป็นตอนเดียว เลข = สูงสุดที่มีอยู่ + 1 */
export function forceSingle(text: string, existing: ReadonlySet<number>): ParsedRow[] {
  const clean = cleanText(text)
  return clean === "" ? [] : singleRow(clean, existing)
}

// ───────────────────────── ตรวจแถว ─────────────────────────

const hasContent = (row: ParsedRow) => row.text.trim() !== ""

function issuesOf(row: ParsedRow, existing: ReadonlySet<number>, earlier: ReadonlySet<number>): ParsedIssue[] {
  const issues: ParsedIssue[] = []
  if (!isChapterNumber(row.number)) issues.push("bad_number")
  else if (existing.has(row.number) || earlier.has(row.number)) issues.push("duplicate")
  if (!hasContent(row)) issues.push("empty")
  if (row.text.length > MAX_CHARS) issues.push("too_long")
  return issues
}

/**
 * คำนวณ issues ของทุกแถวใหม่หลังเจ้าของแก้เลข/ชื่อ แล้วติ๊กออกแถวที่เพิ่งมี issue ใหม่ (แถวที่เจ้าของติ๊กเองทั้งที่มี issue เดิมอยู่แล้วคงไว้ — `validateSelection` ยังกันไม่ให้ส่ง)
 * เลขซ้ำ: เทียบกับตอนที่มีอยู่และแถวก่อนหน้าที่มีเนื้อหา — ตัวหลังเป็นฝ่ายถูกทำเครื่องหมายเสมอ · ตอนว่างไม่นับ เพราะส่งไม่ได้อยู่แล้วและไม่ควรแย่งเลขตอนจริง
 * ไม่แก้แถวเดิม คืนแถวใหม่ (key, kind, title, text, words คงเดิม)
 */
export function revalidate(rows: readonly ParsedRow[], existing: ReadonlySet<number>): ParsedRow[] {
  const earlier = new Set<number>()
  return rows.map((row) => {
    const issues = issuesOf(row, existing, earlier)
    if (isChapterNumber(row.number) && hasContent(row)) earlier.add(row.number)
    const gotWorse = issues.some((issue) => !row.issues.includes(issue))
    return { ...row, issues, checked: row.checked && !gotWorse }
  })
}

// ───────────────────────── ตรวจชุดที่เลือก ─────────────────────────

const utf8 = new TextEncoder()

/** ปัญหาของแถวที่เลือก: ป้ายที่ติดมา + ที่วัดจากข้อมูลจริง (เผื่อป้ายตกค้าง) + เลขเดียวกันซ้ำกันเองในชุดที่เลือก */
function problemsOf(chosen: readonly ParsedRow[]): ReadonlySet<ParsedIssue> {
  const problems = new Set<ParsedIssue>()
  const numbers = new Set<number>()
  for (const row of chosen) {
    for (const issue of row.issues) problems.add(issue)
    if (!isChapterNumber(row.number)) problems.add("bad_number")
    else if (numbers.has(row.number)) problems.add("duplicate")
    else numbers.add(row.number)
    if (!hasContent(row)) problems.add("empty")
    if (row.text.length > MAX_CHARS) problems.add("too_long")
  }
  return problems
}

function totalBytes(chosen: readonly ParsedRow[]): number {
  let total = 0
  for (const row of chosen) total += utf8.encode(row.text).length
  return total
}

const MESSAGE = {
  tooMany: `เลือกได้ไม่เกิน ${MAX_CHAPTERS} ตอนต่อครั้ง`,
  tooLong: `มีตอนที่ยาวเกิน ${MAX_CHARS.toLocaleString("en-US")} ตัวอักษร — แยกตอนให้สั้นลงหรือติ๊กออกก่อน`,
  duplicate: "มีเลขตอนซ้ำ (ซ้ำกับตอนที่มีอยู่แล้วหรือซ้ำกันเอง) — แก้เลขหรือติ๊กออกก่อน",
  badNumber: "มีตอนที่เลขตอนว่างหรือไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม 0 ขึ้นไป) — ใส่เลขหรือติ๊กออกก่อน",
  empty: "มีตอนที่ไม่มีเนื้อหา — ติ๊กออกก่อน",
  tooBig: "ข้อความรวมของตอนที่เลือกเกิน 7.5MB — ติ๊กออกบางตอนแล้วเพิ่มเป็นหลายครั้ง",
} as const

/**
 * ตรวจชุดที่ติ๊กไว้ก่อนส่ง: คืนจำนวนที่ติ๊กกับข้อความเตือนภาษาไทยข้อเดียว (`null` = ส่งได้)
 * เรียงความสำคัญ: เกินจำนวนตอน → ยาวเกิน → เลขซ้ำ → ไม่มีเลข → ไม่มีเนื้อหา → ข้อความรวมเกิน 7.5MB · ไม่ติ๊กเลยไม่ใช่ error (หน้าปิดปุ่มเอง)
 */
export function validateSelection(rows: readonly ParsedRow[]): { count: number; error: string | null } {
  const chosen = rows.filter((row) => row.checked)
  return { count: chosen.length, error: selectionError(chosen) }
}

function selectionError(chosen: readonly ParsedRow[]): string | null {
  if (chosen.length > MAX_CHAPTERS) return MESSAGE.tooMany
  const problems = problemsOf(chosen)
  if (problems.has("too_long")) return MESSAGE.tooLong
  if (problems.has("duplicate")) return MESSAGE.duplicate
  if (problems.has("bad_number")) return MESSAGE.badNumber
  if (problems.has("empty")) return MESSAGE.empty
  if (totalBytes(chosen) > MAX_TOTAL_BYTES) return MESSAGE.tooBig
  return null
}
