import { abortError, noKeyError, type Ai, type Usage } from "../../src/ai.js"
import type { Term } from "../../src/types.js"

/**
 * `Ai` ปลอมสำหรับเทสต์คิว/HTTP/e2e (Task 9–19, 35): บันทึกทุกการเรียกใน `calls` และให้เทสต์กำหนดพฤติกรรมรายครั้งผ่าน `script`
 * (แก้ `ai.script` ระหว่างเทสต์ได้ เพราะอ่านค่าตอนเรียก) ไม่มี key แล้วทุกเมธอดล้มแบบ fatal เหมือนของจริง
 */

export type TranslateCall = { model: string; system: string; user: string; maxTokens: number }
export type NotesCall = { model: string; thaiText: string; sourceTitle: string; sourceText?: string; knownTerms?: string[] }
export type FillCall = { model: string; title: string; synopsisSrc: string; author: string }

export type FakeCall =
  | ({ method: "translateChunk" } & TranslateCall)
  | ({ method: "chapterNotes" } & NotesCall)
  | ({ method: "fillNovel" } & FillCall)
  | { method: "ping"; model: string }

export interface TranslateBehavior {
  /** ข้อความทั้งก้อน (แบ่งครึ่งแล้วสตรีมสองส่วน) */
  text?: string
  /** ส่วนที่สตรีมทีละอัน (ชนะ `text`) */
  pieces?: string[]
  /** หน่วงก่อนส่งแต่ละส่วน (ms) เคารพ `signal` */
  delayMs?: number
  /** ล้มหลังสตรีมครบทุกส่วน (ล้มก่อนสตรีมให้ throw จากฟังก์ชัน script แทน) */
  error?: Error
  usage?: Usage
}
export interface NotesResult {
  recap?: string
  titleTh?: string
  terms?: Term[]
  usage?: Usage
}
export interface FillResult {
  titleTh?: string
  synopsis?: string
  tags?: string[]
  usage?: Usage
}

export interface FakeScript {
  /** ค่าเริ่มต้น true */
  hasKey?: boolean
  /** `n` = ลำดับการเรียกของเมธอดนั้น (เริ่มที่ 1) คืนข้อความล้วน = ข้อความทั้งก้อน throw = ล้มก่อนสตรีม */
  translate?: (call: TranslateCall & { n: number }) => string | TranslateBehavior | void
  notes?: (call: NotesCall & { n: number }) => NotesResult | void
  fill?: (call: FillCall & { n: number }) => FillResult | void
  ping?: (call: { model: string; n: number }) => { usage?: Usage } | void
}

export type FakeAi = Ai & { readonly calls: FakeCall[]; script: FakeScript }

const DEFAULT_USAGE: Usage = { inputTokens: 100, outputTokens: 50 }

/** แบ่งข้อความเป็นสองส่วนตามตัวอักษร (ข้อความสั้นกว่า 2 ตัวไม่แบ่ง) */
function halves(text: string): string[] {
  const chars = Array.from(text)
  if (chars.length < 2) return chars.length ? [text] : []
  const mid = Math.ceil(chars.length / 2)
  return [chars.slice(0, mid).join(""), chars.slice(mid).join("")]
}

function pause(ms: number | undefined, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  if (!ms) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function createFakeAi(script: FakeScript = {}): FakeAi {
  const calls: FakeCall[] = []
  const counts = { translateChunk: 0, chapterNotes: 0, fillNovel: 0, ping: 0 }

  const begin = (call: FakeCall): number => {
    calls.push(call)
    const n = ++counts[call.method]
    if (!ai.hasKey()) throw noKeyError()
    return n
  }

  const ai: FakeAi = {
    calls,
    script,
    hasKey: () => ai.script.hasKey ?? true,

    async translateChunk({ onText, signal, ...call }) {
      const n = begin({ method: "translateChunk", ...call })
      const result = ai.script.translate?.({ ...call, n })
      const behavior: TranslateBehavior = typeof result === "string" ? { text: result } : (result ?? {})
      const pieces = behavior.pieces ?? halves(behavior.text ?? `แปล ${n}`)
      for (const piece of pieces) {
        await pause(behavior.delayMs, signal)
        onText(piece)
      }
      if (signal?.aborted) throw abortError()
      if (behavior.error) throw behavior.error
      return { text: pieces.join(""), usage: behavior.usage ?? DEFAULT_USAGE }
    },

    async chapterNotes(call) {
      const n = begin({ method: "chapterNotes", ...call })
      const r = ai.script.notes?.({ ...call, n }) ?? {}
      return {
        recap: r.recap ?? `สรุปตอน ${n}`,
        titleTh: r.titleTh ?? `ชื่อตอน ${n}`,
        terms: (r.terms ?? []).map((t) => ({ source: t.source, thai: t.thai, note: t.note ?? "" })),
        usage: r.usage ?? DEFAULT_USAGE,
      }
    },

    async fillNovel(call) {
      const n = begin({ method: "fillNovel", ...call })
      const r = ai.script.fill?.({ ...call, n }) ?? {}
      return { titleTh: r.titleTh ?? "ชื่อไทย", synopsis: r.synopsis ?? "เรื่องย่อภาษาไทย", tags: r.tags ?? ["แฟนตาซี"], usage: r.usage ?? DEFAULT_USAGE }
    },

    async ping(model) {
      const n = begin({ method: "ping", model })
      const r = ai.script.ping?.({ model, n }) ?? {}
      return { usage: r.usage ?? DEFAULT_USAGE }
    },
  }
  return ai
}
