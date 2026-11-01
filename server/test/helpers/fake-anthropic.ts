/**
 * Response ปลอมสำหรับฉีดเข้า SDK ของ Anthropic ผ่านตัวเลือก `fetch` (ไม่ออกเครือข่ายจริง)
 * ใช้ทดสอบ `createAi` ทั้งสายตั้งแต่ SDK ถึงการจัดประเภทข้อผิดพลาด
 */

export type SseEvent = { type: string } & Record<string, unknown>

const encoder = new TextEncoder()
const abortError = () => new DOMException("This operation was aborted", "AbortError")

/**
 * Response แบบ SSE: ส่ง events ทีละอัน (หน่วง `delayMs` ระหว่างอัน)
 * `hang: true` = ส่งครบแล้วไม่ปิดสตรีม รอจนถูกยกเลิกด้วย `signal` (จำลองสตรีมที่ค้างกลางทาง)
 */
export function sse(events: SseEvent[], o: { signal?: AbortSignal | null; hang?: boolean; delayMs?: number } = {}): Response {
  let timer: ReturnType<typeof setTimeout> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const onAbort = () => {
        clearTimeout(timer)
        try {
          controller.error(abortError())
        } catch {
          /* สตรีมปิดไปแล้ว */
        }
      }
      if (o.signal?.aborted) return onAbort()
      o.signal?.addEventListener("abort", onAbort, { once: true })
      let i = 0
      const next = () => {
        const event = events[i++]
        if (event) {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
          timer = setTimeout(next, o.delayMs ?? 0)
        } else if (!o.hang) {
          controller.close()
        }
      }
      next()
    },
    cancel() {
      clearTimeout(timer)
    },
  })
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_fake" } })
}

/** ลำดับ event ของข้อความที่ไหลมาเป็นชิ้นๆ ตามที่ API จริงส่ง; ตัด 2 event ท้ายออก (`.slice(0, -2)`) = สตรีมขาดกลางคัน */
export function textEvents(pieces: string[], o: { inputTokens?: number; outputTokens?: number; stopReason?: string } = {}): SseEvent[] {
  const { inputTokens = 11, outputTokens = 7, stopReason = "end_turn" } = o
  return [
    {
      type: "message_start",
      message: { id: "msg_fake", type: "message", role: "assistant", model: "fake", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 1 } },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...pieces.map((text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } },
    { type: "message_stop" },
  ]
}

const JSON_HEADERS = { "content-type": "application/json", "request-id": "req_fake" }

/** ตอบแบบไม่สตรีม (`messages.create`) */
export function jsonMessage(content: unknown[], usage: { input_tokens: number; output_tokens: number }, o: { stopReason?: string } = {}): Response {
  const body = { id: "msg_fake", type: "message", role: "assistant", model: "fake", content, stop_reason: o.stopReason ?? "end_turn", stop_sequence: null, usage }
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS })
}

export const toolUse = (name: string, input: unknown) => ({ type: "tool_use", id: "toolu_fake", name, input })

/** ตอบ error แบบที่ API จริงส่ง `{type:"error", error:{type, message}}` */
export function errorResponse(status: number, message: string, o: { type?: string; headers?: Record<string, string> } = {}): Response {
  const body = { type: "error", error: { type: o.type ?? "api_error", message } }
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...o.headers } })
}

export interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  /** JSON ที่ SDK ส่งมา (ไม่มี body = null): ใช้ any เพราะเทสต์ตรวจรูปร่างด้วย assert เอง */
  body: any
}

export type Responder = Response | ((req: RecordedRequest, signal: AbortSignal | null | undefined) => Response | Promise<Response>)

/**
 * `fetch` ปลอม: การเรียกครั้งที่ i ใช้ responder ตัวที่ i (เกินจำนวนแล้วใช้ตัวสุดท้ายซ้ำ — ถ้าจะซ้ำให้ส่งเป็นฟังก์ชัน
 * เพราะ Response อ่านได้ครั้งเดียว) บันทึกทุกคำขอไว้ใน `requests` ถ้า signal ถูกยกเลิกแล้วจะ throw AbortError เหมือน fetch จริง
 */
export function createFakeFetch(...responders: Responder[]): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal
    if (signal?.aborted) throw abortError()
    const req: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    }
    requests.push(req)
    const responder = responders[Math.min(requests.length - 1, responders.length - 1)]
    if (!responder) throw new Error("createFakeFetch: ไม่มี responder")
    return typeof responder === "function" ? responder(req, signal) : responder
  }
  return { fetch: fakeFetch as typeof fetch, requests }
}
