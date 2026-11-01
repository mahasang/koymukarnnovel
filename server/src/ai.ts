import Anthropic, { APIConnectionError, APIError, APIUserAbortError, AnthropicError } from "@anthropic-ai/sdk"
import { FILL_SYSTEM, FILL_TOOL, MAX_TAG_LENGTH, MAX_TAGS, MAX_TERMS, RECAP_SYSTEM, RECAP_TOOL, buildFillUser, buildRecapUser } from "./prompts.js"
import type { Term } from "./types.js"
import { NO_API_KEY_MESSAGE } from "./util/errors.js"
import { truncate } from "./util/text.js"

/**
 * ทุกการเรียก Claude ของระบบผ่านไฟล์นี้ที่เดียว (spec 8): แปลทีละชิ้น, สรุปตอน+สกัดคำศัพท์, ai-fill ของนิยาย, ทดสอบ API
 * ส่วนอื่นของระบบเห็นแค่ interface `Ai` (เทสต์สลับเป็น `createFakeAi` ได้) และ `AiError` ที่บอกว่า "ควรหยุดคิวทั้งหมดไหม"
 */

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface Ai {
  hasKey(): boolean
  translateChunk(p: {
    model: string
    system: string
    user: string
    maxTokens: number
    onText: (t: string) => void
    signal?: AbortSignal
  }): Promise<{ text: string; usage: Usage }>
  /** `sourceText` (ต้นฉบับอังกฤษ) และ `knownTerms` (ชื่อที่อยู่ในอภิธานแล้ว) เป็นตัวเลือก: มีก็ได้ชื่อ source ที่สะกดตรงและไม่เปลือง 15 ช่องกับชื่อเดิม */
  chapterNotes(p: {
    model: string
    thaiText: string
    sourceTitle: string
    sourceText?: string
    knownTerms?: string[]
  }): Promise<{ recap: string; titleTh: string; terms: Required<Term>[]; usage: Usage }>
  fillNovel(p: { model: string; title: string; synopsisSrc: string; author: string }): Promise<{ titleTh: string; synopsis: string; tags: string[]; usage: Usage }>
  ping(model: string): Promise<{ usage: Usage }>
}

/**
 * ข้อผิดพลาดจากการเรียก Claude ที่จัดประเภทแล้ว: `fatal` = ทุกงานจะล้มเหมือนกัน (key ผิด เครดิตหมด ไม่พบโมเดล ไม่ได้ตั้ง key) → ควรหยุดคิว
 * ไม่ fatal = ลองใหม่ทีหลังได้ `status` คือสถานะ HTTP (หรือที่เทียบจากชนิด error กลางสตรีม) หรือ null ถ้าไม่เกี่ยวกับ HTTP
 * ข้อความเป็นภาษาไทยและไม่มี API key เด็ดขาด (จึงไม่พก error เดิมไว้ใน `cause` เพราะต้นทางอาจสะท้อน key กลับมา)
 */
export class AiError extends Error {
  readonly fatal: boolean
  readonly status: number | null
  constructor(message: string, o: { fatal: boolean; status?: number | null }) {
    super(message)
    this.name = "AiError"
    this.fatal = o.fatal
    this.status = o.status ?? null
  }
}

/** error ชื่อ AbortError แบบเดียวกับที่ `fetch` โยนเมื่อถูกยกเลิก: ผู้เรียกที่ยกเลิกเองเช็ก `signal.aborted` แล้วไม่ถือเป็นความผิดพลาด */
export const abortError = (): Error => new DOMException("This operation was aborted", "AbortError")
export const isAbortError = (e: unknown): e is Error => e instanceof Error && e.name === "AbortError"

export const noKeyError = (): AiError => new AiError(NO_API_KEY_MESSAGE, { fatal: true })

const nonFatal = (message: string): AiError => new AiError(message, { fatal: false })

const MAX_DETAIL = 300
const MIN_EXACT_KEY = 8
const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{6,}/g

/** ลบ API key ออกจากข้อความที่มาจากภายนอก: ทั้งตัวที่รู้ (ตรงตัว) และตัวที่หน้าตาเป็น key ของ Anthropic */
function redact(text: string, apiKey?: string | null): string {
  const key = apiKey?.trim()
  const known = key && key.length >= MIN_EXACT_KEY ? text.split(key).join("sk-ant-***") : text
  return known.replace(KEY_SHAPE, "sk-ant-***")
}

/** ชนิด error ในเนื้อ body เทียบเป็นสถานะ HTTP (event `error` กลางสตรีมไม่มีสถานะ HTTP มาด้วย) */
const TYPE_STATUS: Record<string, number | undefined> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
}

/** ข้อความอธิบายจาก API (`{type:"error", error:{type, message}}`) ถ้าไม่มีใช้ข้อความของ SDK ตัดเลขสถานะนำหน้าออก */
function apiDetail(e: APIError): string {
  const body: unknown = e.error
  if (isRecord(body)) {
    const inner = isRecord(body.error) ? body.error.message : body.message
    if (typeof inner === "string" && inner.trim()) return inner.trim()
  }
  return e.message.replace(/^\d{3}\s+/, "").trim()
}

/** `at` = " (HTTP n)" เฉพาะที่มาจากการตอบกลับ HTTP จริง (error กลางสตรีมมากับ HTTP 200 จึงไม่ใส่) */
function describeHttp(status: number | null, detail: string, at: string): { text: string; fatal: boolean } {
  if (status === 401 || status === 403) return { text: `API key ไม่ถูกต้องหรือไม่มีสิทธิ์${at}`, fatal: true }
  if (status === 402 || (status === 400 && /credit balance/i.test(detail))) {
    return { text: `เครดิต API หมดหรือบัญชีมีปัญหา — ตรวจที่ Anthropic Console (Plans & Billing)${at}`, fatal: true }
  }
  if (status === 404) return { text: `ไม่พบโมเดลที่ตั้งไว้ — ตรวจชื่อโมเดลในหน้าตั้งค่า${at}`, fatal: true }
  if (status === 429 || status === 529) return { text: `Claude API ไม่ว่างหรือถูกจำกัดอัตราชั่วคราว${at}`, fatal: false }
  if (status !== null && status >= 500) return { text: `Claude API ขัดข้อง${at}`, fatal: false }
  if (status === null) return { text: `Claude API ตอบกลับข้อผิดพลาด: ${detail}`, fatal: false }
  return { text: `Claude API ปฏิเสธคำขอ${at}: ${detail}`, fatal: false }
}

/**
 * จัดประเภทข้อผิดพลาดใดๆ จากการเรียก Claude เป็น `AiError` (ข้อความไทย ไม่มี key)
 * ยกเว้นการยกเลิก (AbortError): ผ่านไปไม่ห่อ — ผู้เรียกที่เป็นฝ่ายยกเลิกเช็ก `signal.aborted` เอง
 */
export function classifyError(e: unknown, apiKey?: string | null): AiError | Error {
  if (e instanceof AiError) return e
  if (e instanceof APIUserAbortError) return abortError()
  if (isAbortError(e)) return e

  const safe = (s: string) => truncate(redact(s, apiKey), MAX_DETAIL)
  const fail = (text: string, fatal: boolean, status: number | null) => new AiError(text, { fatal, status })

  if (e instanceof APIConnectionError) return fail("เชื่อมต่อ Claude API ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ตของเซิร์ฟเวอร์", false, null)
  if (e instanceof APIError) {
    const status = e.status ?? (e.type ? TYPE_STATUS[e.type] : undefined) ?? null
    const { text, fatal } = describeHttp(status, safe(apiDetail(e)), e.status ? ` (HTTP ${e.status})` : "")
    return fail(text, fatal, status)
  }
  // ข้อผิดพลาดของ SDK เอง: สตรีมขาดก่อนจบ ข้อมูลเสียรูป หรือการเชื่อมต่อหลุดกลางสตรีม
  if (e instanceof AnthropicError) return fail(`การเชื่อมต่อกับ Claude API ขาดกลางทางหรือข้อมูลที่ได้ไม่สมบูรณ์: ${safe(e.message)}`, false, null)
  return fail(`เรียก Claude API ไม่สำเร็จ: ${safe(e instanceof Error ? e.message : String(e))}`, false, null)
}

// ---------------------------------------------------------------- ตรวจผลลัพธ์

/** เผื่อโทเคนให้ tool call: สรุปตอน + ชื่อตอน + ชื่อเฉพาะ 15 รายการ / ชื่อเรื่อง + เรื่องย่อไทย (ภาษาไทยกินโทเคนมาก) + แท็ก */
const NOTES_MAX_TOKENS = 2000
const FILL_MAX_TOKENS = 3000
const PING_MAX_TOKENS = 16

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

const usageOf = (m: Anthropic.Message): Usage => ({ inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens })

/** คำตอบที่ถูกตัดหรือถูกปฏิเสธใช้ไม่ได้ ไม่ว่าจะได้เนื้อหามาบางส่วนแล้วหรือไม่ (ปล่อยผ่านจะกลายเป็นคำแปลขาดครึ่งที่ดูเหมือนสำเร็จ) */
function stopProblem(reason: string | null): AiError | null {
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") return nonFatal("คำตอบยาวเกินและถูกตัด — ถึงขีดจำกัดความยาวของคำตอบ")
  if (reason === "refusal") return nonFatal("Claude ปฏิเสธที่จะตอบข้อความนี้")
  return null
}

function toolInput(message: Anthropic.Message, name: string): Record<string, unknown> {
  const problem = stopProblem(message.stop_reason)
  if (problem) throw problem
  for (const block of message.content) {
    if (block.type === "tool_use" && block.name === name) return isRecord(block.input) ? block.input : {}
  }
  throw nonFatal("Claude ไม่ได้ส่งผลลัพธ์ตามรูปแบบที่กำหนด ลองใหม่อีกครั้ง")
}

/** ทิ้งรายการที่ขาด source/thai ก่อนแล้วจึงตัดเหลือ MAX_TERMS; note เป็นข้อความเสมอ */
function cleanTerms(value: unknown): Required<Term>[] {
  if (!Array.isArray(value)) return []
  const terms: Required<Term>[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const source = str(item.source)
    const thai = str(item.thai)
    if (!source || !thai) continue
    terms.push({ source, thai, note: str(item.note) })
    if (terms.length === MAX_TERMS) break
  }
  return terms
}

/** แท็กที่ใช้ได้: ข้อความไม่ว่าง ยาวไม่เกิน MAX_TAG_LENGTH ไม่ซ้ำ (ไม่สนตัวพิมพ์) ไม่เกิน MAX_TAGS อัน; ที่ยาวเกินทิ้งทั้งอัน (ตัดกลางคำแล้วไม่มีความหมาย) */
function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of value) {
    const tag = str(item)
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
    if (tags.length === MAX_TAGS) break
  }
  return tags
}

// ---------------------------------------------------------------- ตัวเรียกจริง

export function createAi(apiKey: string | null, o: { fetch?: typeof fetch; maxRetries?: number } = {}): Ai {
  const key = apiKey?.trim() || null
  const client = key ? new Anthropic({ apiKey: key, maxRetries: o.maxRetries ?? 5, ...(o.fetch ? { fetch: o.fetch } : {}) }) : null

  /** ไม่มี key → ล้มแบบ fatal ก่อนออกเครือข่าย; ข้อผิดพลาดใดๆ ถูกจัดประเภทก่อนออกไปข้างนอก */
  async function call<T>(run: (c: Anthropic) => Promise<T>): Promise<T> {
    if (!client) throw noKeyError()
    try {
      return await run(client)
    } catch (e) {
      throw classifyError(e, key)
    }
  }

  return {
    hasKey: () => client !== null,

    translateChunk: (p) =>
      call(async (c) => {
        const stream = c.messages.stream(
          { model: p.model, max_tokens: p.maxTokens, system: p.system, messages: [{ role: "user", content: p.user }] },
          p.signal ? { signal: p.signal } : {},
        )
        let text = "" // ผลลัพธ์คือสิ่งที่ส่งออกทาง onText ทั้งหมดต่อกัน ตรงกับที่ผู้ใช้เห็นระหว่างสตรีมเป๊ะ
        stream.on("text", (delta) => {
          text += delta
          p.onText(delta)
        })
        const message = await stream.finalMessage()

        const problem = stopProblem(message.stop_reason)
        if (problem) throw problem
        if (message.stop_reason !== "end_turn") throw nonFatal("คำตอบจาก Claude API ไม่สมบูรณ์ (สตรีมจบก่อนเวลา)")
        if (!text.trim()) throw nonFatal("Claude ตอบกลับมาเป็นข้อความว่างเปล่า")
        return { text, usage: usageOf(message) }
      }),

    chapterNotes: (p) =>
      call(async (c) => {
        const message = await c.messages.create({
          model: p.model,
          max_tokens: NOTES_MAX_TOKENS,
          system: RECAP_SYSTEM,
          tools: [RECAP_TOOL],
          tool_choice: { type: "tool", name: RECAP_TOOL.name },
          messages: [{ role: "user", content: buildRecapUser(p) }],
        })
        const input = toolInput(message, RECAP_TOOL.name)
        const recap = str(input.recap)
        if (!recap) throw nonFatal("Claude ส่งเรื่องย่อของตอนกลับมาว่างเปล่า")
        return { recap, titleTh: str(input.titleTh), terms: cleanTerms(input.terms), usage: usageOf(message) }
      }),

    fillNovel: (p) =>
      call(async (c) => {
        const message = await c.messages.create({
          model: p.model,
          max_tokens: FILL_MAX_TOKENS,
          system: FILL_SYSTEM,
          tools: [FILL_TOOL],
          tool_choice: { type: "tool", name: FILL_TOOL.name },
          messages: [{ role: "user", content: buildFillUser(p) }],
        })
        const input = toolInput(message, FILL_TOOL.name)
        return { titleTh: str(input.titleTh), synopsis: str(input.synopsis), tags: cleanTags(input.tags), usage: usageOf(message) }
      }),

    ping: (model) =>
      call(async (c) => {
        const message = await c.messages.create({ model, max_tokens: PING_MAX_TOKENS, messages: [{ role: "user", content: "ping" }] })
        return { usage: usageOf(message) }
      }),
  }
}
