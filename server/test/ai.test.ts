import { test } from "node:test"
import assert from "node:assert/strict"
import { inspect } from "node:util"
import { APIConnectionError, APIError, APIUserAbortError, AnthropicError } from "@anthropic-ai/sdk"
import { AiError, abortError, classifyError, createAi } from "../src/ai.js"
import { FILL_SYSTEM, FILL_TOOL, RECAP_SYSTEM, RECAP_TOOL, buildFillUser, buildRecapUser } from "../src/prompts.js"
import { createFakeFetch, errorResponse, jsonMessage, sse, textEvents, toolUse, type SseEvent } from "./helpers/fake-anthropic.js"

const KEY = "sk-ant-api03-TESTKEY1234567890abcdef"

/** maxRetries 0 = ไม่ลองใหม่ (เทสต์การจัดประเภทข้อผิดพลาดไม่ต้องรอ backoff) */
const aiFor = (fake: { fetch: typeof fetch }, maxRetries = 0) => createAi(KEY, { fetch: fake.fetch, maxRetries })

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (e) {
    return e
  }
  return assert.fail("ควรล้มเหลว แต่สำเร็จ")
}

function aiError(e: unknown): AiError {
  assert.ok(e instanceof AiError, `ควรเป็น AiError ได้ ${String(e)}`)
  return e
}

const translateParams = (over: Record<string, unknown> = {}) => ({
  model: "m-translate",
  system: "SYS",
  user: "USER",
  maxTokens: 8000,
  onText: () => {},
  ...over,
})
const hasThai = (s: string) => /[ก-๙]/.test(s)
const NOTES = (input: unknown, stopReason = "tool_use") =>
  jsonMessage([toolUse("save_chapter_notes", input)], { input_tokens: 40, output_tokens: 20 }, { stopReason })
const FILLED = (input: unknown, stopReason = "tool_use") => jsonMessage([toolUse(FILL_TOOL.name, input)], { input_tokens: 30, output_tokens: 25 }, { stopReason })

// ---------------------------------------------------------------- translateChunk

test("translateChunk: ส่ง onText ทีละส่วน คืนข้อความรวมกับ usage และส่งคำขอสตรีมถูกรูป", async () => {
  const fake = createFakeFetch(() => sse(textEvents(["สวัส", "ดี"], { inputTokens: 11, outputTokens: 7 })))
  const got: string[] = []
  const result = await aiFor(fake).translateChunk(translateParams({ onText: (t: string) => got.push(t) }))

  assert.deepEqual(got, ["สวัส", "ดี"])
  assert.deepEqual(result, { text: "สวัสดี", usage: { inputTokens: 11, outputTokens: 7 } })
  assert.equal(fake.requests.length, 1)
  const req = fake.requests[0]!
  assert.equal(req.method, "POST")
  assert.ok(new URL(req.url).pathname.endsWith("/v1/messages"))
  assert.equal(req.headers.get("x-api-key"), KEY)
  assert.equal(req.body.model, "m-translate")
  assert.equal(req.body.max_tokens, 8000)
  assert.equal(req.body.system, "SYS")
  assert.equal(req.body.stream, true)
  assert.deepEqual(req.body.messages, [{ role: "user", content: "USER" }])
})

test("createAi: key ที่มีช่องว่างหัวท้าย (วางมาจาก .env) ถูกตัดก่อนส่งในหัว x-api-key", async () => {
  const fake = createFakeFetch(() => sse(textEvents(["ก"])))
  await createAi(`  ${KEY}\n`, { fetch: fake.fetch, maxRetries: 0 }).translateChunk(translateParams())
  assert.equal(fake.requests[0]!.headers.get("x-api-key"), KEY)
})

const NO_STOP_REASON = textEvents(["ครึ่งเดียว"]).filter((e) => e.type !== "message_delta")
const BAD_ENDINGS: [label: string, events: SseEvent[], message: RegExp][] = [
  ["คำตอบถูกตัดเพราะ max_tokens", textEvents(["ครึ่งเดียว"], { stopReason: "max_tokens" }), /ถูกตัด/],
  ["คำตอบถูกตัดเพราะเต็มหน้าต่างบริบท", textEvents(["ครึ่งเดียว"], { stopReason: "model_context_window_exceeded" }), /ถูกตัด/],
  ["โมเดลปฏิเสธ (refusal)", textEvents(["ขออภัย"], { stopReason: "refusal" }), /ปฏิเสธ/],
  ["สตรีมขาดก่อน message_stop", textEvents(["ครึ่งเดียว"]).slice(0, -2), /ไม่สมบูรณ์/],
  ["จบโดยไม่มี stop_reason", NO_STOP_REASON, /ไม่สมบูรณ์/],
  ["ข้อความว่างเปล่า", textEvents([" \n"]), /ว่างเปล่า/],
]
for (const [label, events, message] of BAD_ENDINGS) {
  test(`translateChunk: ${label} → AiError ไม่ fatal (ไม่คืนข้อความที่ใช้ไม่ได้เป็นคำแปลสำเร็จ)`, async () => {
    const e = aiError(await failure(aiFor(createFakeFetch(() => sse(events))).translateChunk(translateParams())))
    assert.equal(e.fatal, false)
    assert.ok(hasThai(e.message))
    assert.match(e.message, message)
  })
}

test("translateChunk: API ส่ง event error กลางสตรีม (overloaded_error) → AiError ไม่ fatal สถานะ 529", async () => {
  const events: SseEvent[] = [...textEvents(["สวัส"]).slice(0, 3), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]
  const e = aiError(await failure(aiFor(createFakeFetch(() => sse(events))).translateChunk(translateParams())))
  assert.deepEqual([e.fatal, e.status], [false, 529])
})

test("translateChunk: ยกเลิกกลางสตรีมด้วย signal → reject ด้วย error ชื่อ AbortError (ไม่ห่อเป็น AiError) ทั้งที่สตรีมยังค้างอยู่", { timeout: 10_000 }, async () => {
  const controller = new AbortController()
  const fake = createFakeFetch((_req, signal) => sse(textEvents(["สวัส", "ดี"]).slice(0, 4), { signal, hang: true }))
  const got: string[] = []
  const pending = aiFor(fake).translateChunk(
    translateParams({
      signal: controller.signal,
      onText: (t: string) => {
        got.push(t)
        if (got.length === 1) controller.abort()
      },
    }),
  )
  const e = await failure(pending)
  assert.equal((e as Error).name, "AbortError")
  assert.ok(!(e instanceof AiError))
  assert.ok(got.length >= 1)
})

test("translateChunk: signal ที่ถูกยกเลิกอยู่แล้ว → AbortError โดยไม่ออกเครือข่าย", { timeout: 10_000 }, async () => {
  const controller = new AbortController()
  controller.abort()
  const fake = createFakeFetch(() => sse(textEvents(["x"])))
  const e = await failure(aiFor(fake).translateChunk(translateParams({ signal: controller.signal })))
  assert.equal((e as Error).name, "AbortError")
  assert.ok(!(e instanceof AiError))
  assert.equal(fake.requests.length, 0)
})

// ---------------------------------------------------------------- chapterNotes

const NOTES_PARAMS = { model: "m-recap", thaiText: "เนื้อหาไทย", sourceTitle: "Chapter 5", sourceText: "English text", knownTerms: ["Kael"] }

test("chapterNotes: บังคับ tool save_chapter_notes อ่านผลจาก tool_use.input ตัด terms เหลือ 15 ทิ้งรายการที่ขาด source/thai และ note เป็น string เสมอ", async () => {
  const valid = Array.from({ length: 18 }, (_, i) => ({ source: `Name${i}`, thai: `ชื่อ${i}`, note: i === 1 ? " ตัวละคร " : i === 2 ? 5 : undefined }))
  const input = {
    recap: "  สรุปตอน  ",
    titleTh: " ชื่อตอน ",
    terms: [{ source: "NoThai" }, { thai: "ไม่มีต้นฉบับ" }, { source: "  ", thai: "x" }, { source: "S", thai: 5 }, null, "str", ...valid],
  }
  const fake = createFakeFetch(() => NOTES(input))
  const result = await aiFor(fake).chapterNotes(NOTES_PARAMS)

  assert.equal(result.recap, "สรุปตอน")
  assert.equal(result.titleTh, "ชื่อตอน")
  assert.equal(result.terms.length, 15)
  assert.deepEqual(result.terms[0], { source: "Name0", thai: "ชื่อ0", note: "" })
  assert.deepEqual(result.terms[1], { source: "Name1", thai: "ชื่อ1", note: "ตัวละคร" })
  assert.deepEqual(result.terms[2], { source: "Name2", thai: "ชื่อ2", note: "" }, "note ที่ไม่ใช่ข้อความกลายเป็นข้อความว่าง")
  assert.deepEqual(result.terms[14], { source: "Name14", thai: "ชื่อ14", note: "" })
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 20 })

  const body = fake.requests[0]!.body
  assert.equal(body.model, "m-recap")
  assert.deepEqual(body.tool_choice, { type: "tool", name: "save_chapter_notes" })
  assert.equal(body.tools.length, 1)
  assert.equal(body.tools[0].name, RECAP_TOOL.name)
  assert.deepEqual(body.tools[0].input_schema, RECAP_TOOL.input_schema)
  assert.equal(body.system, RECAP_SYSTEM)
  assert.deepEqual(body.messages, [{ role: "user", content: buildRecapUser(NOTES_PARAMS) }])
  assert.ok(body.max_tokens >= 1000, "ที่ให้ terms 15 รายการต้องเผื่อโทเคนพอ")
})

test("chapterNotes: ไม่มีต้นฉบับ/อภิธานก็เรียกได้ (ตัวเลือกเสริม) และ terms ที่ไม่ใช่ array (ข้อความ ตัวเลข object null หรือไม่มีเลย) ได้ []", async () => {
  const fake = createFakeFetch(() => NOTES({ recap: "ก", titleTh: "ข", terms: [] }))
  await aiFor(fake).chapterNotes({ model: "m", thaiText: "ไทย", sourceTitle: "" })
  assert.equal(fake.requests[0]!.body.messages[0].content, buildRecapUser({ thaiText: "ไทย", sourceTitle: "" }))

  for (const terms of ["ไม่ใช่ array", 5, { source: "S", thai: "ท" }, null, undefined]) {
    const result = await aiFor(createFakeFetch(() => NOTES({ recap: "ก", titleTh: "ข", terms }))).chapterNotes(NOTES_PARAMS)
    assert.deepEqual(result.terms, [], JSON.stringify(terms))
  }
})

test("chapterNotes: ไม่มี tool_use ในคำตอบ → AiError ไม่ fatal", async () => {
  const fake = createFakeFetch(() => jsonMessage([{ type: "text", text: "สรุป: ..." }], { input_tokens: 1, output_tokens: 1 }))
  const e = aiError(await failure(aiFor(fake).chapterNotes(NOTES_PARAMS)))
  assert.equal(e.fatal, false)
  assert.ok(hasThai(e.message))
})

test("chapterNotes: คำตอบถูกตัดกลางคัน (max_tokens) หรือถูกปฏิเสธ → AiError ไม่ fatal ไม่ใช้ผลที่ได้มาไม่ครบ", async () => {
  const cut = aiError(await failure(aiFor(createFakeFetch(() => NOTES({ recap: "ค", titleTh: "ก", terms: [] }, "max_tokens"))).chapterNotes(NOTES_PARAMS)))
  assert.equal(cut.fatal, false)
  assert.match(cut.message, /ถูกตัด/)
  const refused = aiError(await failure(aiFor(createFakeFetch(() => NOTES({ recap: "ค", titleTh: "ก", terms: [] }, "refusal"))).chapterNotes(NOTES_PARAMS)))
  assert.equal(refused.fatal, false)
  assert.match(refused.message, /ปฏิเสธ/)
})

test("chapterNotes: tool_use ของ tool อื่น → AiError ไม่ fatal (อ่านเฉพาะ save_chapter_notes)", async () => {
  const fake = createFakeFetch(() => jsonMessage([toolUse("other_tool", { recap: "ก", titleTh: "ข", terms: [] })], { input_tokens: 1, output_tokens: 1 }, { stopReason: "tool_use" }))
  const e = aiError(await failure(aiFor(fake).chapterNotes(NOTES_PARAMS)))
  assert.equal(e.fatal, false)
  assert.match(e.message, /รูปแบบ/)
})

test("chapterNotes: เรื่องย่อว่างเปล่า (หรือ input ไม่ใช่ object) → AiError ไม่ fatal (ไม่เก็บความจำว่างเป็นผลสำเร็จ) ส่วนชื่อตอนว่างยอมรับได้", async () => {
  for (const recap of ["  ", undefined, 5]) {
    const e = aiError(await failure(aiFor(createFakeFetch(() => NOTES({ recap, titleTh: "ก", terms: [] }))).chapterNotes(NOTES_PARAMS)))
    assert.equal(e.fatal, false)
    assert.match(e.message, /เรื่องย่อ/)
  }
  for (const input of [null, "text", [1]]) {
    const e = aiError(await failure(aiFor(createFakeFetch(() => NOTES(input))).chapterNotes(NOTES_PARAMS)))
    assert.equal(e.fatal, false)
    assert.match(e.message, /เรื่องย่อ/)
  }
  const noTitle = await aiFor(createFakeFetch(() => NOTES({ recap: "ก", terms: [] }))).chapterNotes(NOTES_PARAMS)
  assert.equal(noTitle.titleTh, "")
})

// ---------------------------------------------------------------- fillNovel

test("fillNovel: บังคับ tool คืน titleTh synopsis tags (ไม่เกิน 12 อัน อันละไม่เกิน 40 ตัดซ้ำทั้งตัวพิมพ์ต่าง ตัดช่องว่าง ทิ้งที่ไม่ใช่ข้อความ)", async () => {
  const input = {
    titleTh: " ชื่อไทย ",
    synopsis: " เรื่องย่อไทย ",
    tags: ["แฟนตาซี", " แฟนตาซี ", "", "  ", 5, "ก".repeat(41), "ข".repeat(40), "LitRPG", "litrpg", ...Array.from({ length: 20 }, (_, i) => `แท็ก${i}`)],
  }
  const fake = createFakeFetch(() => FILLED(input))
  const params = { model: "m-fill", title: "The Hero", synopsisSrc: "A boy wakes up.", author: "Someone" }
  const result = await aiFor(fake).fillNovel(params)

  assert.equal(result.titleTh, "ชื่อไทย")
  assert.equal(result.synopsis, "เรื่องย่อไทย")
  assert.equal(result.tags.length, 12)
  assert.deepEqual(result.tags.slice(0, 4), ["แฟนตาซี", "ข".repeat(40), "LitRPG", "แท็ก0"], "ซ้ำ ว่าง ไม่ใช่ข้อความ และยาวเกิน 40 ถูกทิ้ง")
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 25 })

  const body = fake.requests[0]!.body
  assert.equal(body.model, "m-fill")
  assert.deepEqual(body.tool_choice, { type: "tool", name: FILL_TOOL.name })
  assert.equal(body.tools.length, 1)
  assert.deepEqual(body.tools[0].input_schema, FILL_TOOL.input_schema)
  assert.equal(body.system, FILL_SYSTEM)
  assert.deepEqual(body.messages, [{ role: "user", content: buildFillUser(params) }])
  assert.ok(body.max_tokens >= 1500, "เรื่องย่อภาษาไทยยาวได้ ต้องเผื่อโทเคนพอ")
})

test("fillNovel: ไม่มี tool_use / ถูกตัด → AiError ไม่ fatal; ช่องที่ขาดกลายเป็นค่าว่าง", async () => {
  const blank = { model: "m", title: "T", synopsisSrc: "", author: "" }
  const none = createFakeFetch(() => jsonMessage([{ type: "text", text: "..." }], { input_tokens: 1, output_tokens: 1 }))
  const e = aiError(await failure(aiFor(none).fillNovel(blank)))
  assert.equal(e.fatal, false)

  const cut = aiError(await failure(aiFor(createFakeFetch(() => FILLED({ titleTh: "ชื่อ", synopsis: "ครึ่ง" }, "max_tokens"))).fillNovel(blank)))
  assert.equal(cut.fatal, false)
  assert.match(cut.message, /ถูกตัด/)

  const partial = await aiFor(createFakeFetch(() => FILLED({ titleTh: "ชื่อ" }))).fillNovel(blank)
  assert.deepEqual({ titleTh: partial.titleTh, synopsis: partial.synopsis, tags: partial.tags }, { titleTh: "ชื่อ", synopsis: "", tags: [] })
})

// ---------------------------------------------------------------- ping

test("ping: เรียกด้วย max_tokens เล็กๆ แล้วคืน usage", async () => {
  const fake = createFakeFetch(() => jsonMessage([{ type: "text", text: "pong" }], { input_tokens: 8, output_tokens: 2 }))
  assert.deepEqual(await aiFor(fake).ping("m-ping"), { usage: { inputTokens: 8, outputTokens: 2 } })
  const body = fake.requests[0]!.body
  assert.equal(body.model, "m-ping")
  assert.ok(body.max_tokens >= 1 && body.max_tokens <= 16)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, "user")
  assert.ok(body.messages[0].content.length > 0, "ข้อความผู้ใช้ว่างเปล่าถูก API ปฏิเสธ")
})

// ---------------------------------------------------------------- ไม่มี key

for (const [label, key] of [["null", null], ["ว่าง", ""], ["มีแต่ช่องว่าง", "   "]] as const) {
  test(`ไม่มี key (${label}): hasKey() เป็นเท็จ และทุกเมธอด reject ด้วย AiError fatal ที่บอก ANTHROPIC_API_KEY โดยไม่ออกเครือข่าย`, async () => {
    const fake = createFakeFetch(() => sse(textEvents(["x"])))
    const ai = createAi(key, { fetch: fake.fetch })
    assert.equal(ai.hasKey(), false)
    const attempts = [
      ai.translateChunk(translateParams()),
      ai.chapterNotes(NOTES_PARAMS),
      ai.fillNovel({ model: "m", title: "T", synopsisSrc: "", author: "" }),
      ai.ping("m"),
    ]
    for (const attempt of attempts) {
      const e = aiError(await failure(attempt))
      assert.equal(e.fatal, true)
      assert.ok(e.message.includes("ANTHROPIC_API_KEY"))
    }
    assert.equal(fake.requests.length, 0)
  })
}

test("มี key: hasKey() เป็นจริง", () => {
  assert.equal(createAi(KEY, { fetch: createFakeFetch(() => sse([])).fetch }).hasKey(), true)
})

// ---------------------------------------------------------------- classifyError

const apiError = (status: number, message: string) => APIError.generate(status, { type: "error", error: { type: "x", message } }, undefined, new Headers())
/** error ที่ SDK โยนเมื่อ API ส่ง event `error` กลางสตรีม: ไม่มีสถานะ HTTP มีแต่ชนิดใน body */
const streamApiError = (type: string, message: string) => new APIError(undefined, { type: "error", error: { type, message } }, undefined, new Headers(), type as never)

const CLASSES: [label: string, error: unknown, expected: { fatal: boolean; status: number | null; message: RegExp }][] = [
  ["401 key ผิด", apiError(401, "invalid x-api-key"), { fatal: true, status: 401, message: /API key/ }],
  ["403 ไม่มีสิทธิ์", apiError(403, "forbidden"), { fatal: true, status: 403, message: /API key/ }],
  ["400 เครดิตหมด", apiError(400, "Your credit balance is too low to access the Anthropic API."), { fatal: true, status: 400, message: /เครดิต/ }],
  ["402 billing", apiError(402, "billing problem"), { fatal: true, status: 402, message: /เครดิต/ }],
  ["400 เครดิตหมด (ตัวพิมพ์ต่างจากที่เคยเห็น)", apiError(400, "Credit Balance is too low"), { fatal: true, status: 400, message: /เครดิต/ }],
  ["400 อื่นๆ (prompt ยาวเกิน)", apiError(400, "prompt is too long: 300000 tokens"), { fatal: false, status: 400, message: /ปฏิเสธคำขอ \(HTTP 400\): prompt is too long: 300000 tokens$/ }],
  ["413 ใหญ่เกิน", apiError(413, "request too large"), { fatal: false, status: 413, message: /ปฏิเสธ.*request too large/ }],
  ["body เป็นข้อความล้วนจากพร็อกซี", APIError.generate(400, "upstream gateway text", undefined, new Headers()), { fatal: false, status: 400, message: /ปฏิเสธ.*upstream gateway text/ }],
  ["404 ไม่พบโมเดล", apiError(404, "model: nope"), { fatal: true, status: 404, message: /โมเดล/ }],
  ["429 ถูกจำกัดอัตรา", apiError(429, "rate limited"), { fatal: false, status: 429, message: /ไม่ว่าง|จำกัด/ }],
  ["529 โอเวอร์โหลด", apiError(529, "overloaded"), { fatal: false, status: 529, message: /ไม่ว่าง|จำกัด/ }],
  ["500 ขัดข้อง", apiError(500, "boom"), { fatal: false, status: 500, message: /ขัดข้อง/ }],
  ["503 ขัดข้อง", apiError(503, "unavailable"), { fatal: false, status: 503, message: /ขัดข้อง/ }],
  ["event error กลางสตรีม: overloaded_error", streamApiError("overloaded_error", "Overloaded"), { fatal: false, status: 529, message: /ไม่ว่าง|จำกัด/ }],
  ["event error กลางสตรีม: api_error", streamApiError("api_error", "Internal server error"), { fatal: false, status: 500, message: /ขัดข้อง/ }],
  ["event error กลางสตรีม: authentication_error", streamApiError("authentication_error", "invalid x-api-key"), { fatal: true, status: 401, message: /API key/ }],
  ["event error กลางสตรีม: billing_error", streamApiError("billing_error", "billing"), { fatal: true, status: 402, message: /เครดิต/ }],
  ["event error กลางสตรีม: permission_error", streamApiError("permission_error", "forbidden"), { fatal: true, status: 403, message: /API key/ }],
  ["event error กลางสตรีม: not_found_error", streamApiError("not_found_error", "model: nope"), { fatal: true, status: 404, message: /โมเดล/ }],
  ["event error กลางสตรีม: rate_limit_error", streamApiError("rate_limit_error", "slow down"), { fatal: false, status: 429, message: /ไม่ว่าง|จำกัด/ }],
  ["event error กลางสตรีม: invalid_request_error", streamApiError("invalid_request_error", "bad things"), { fatal: false, status: 400, message: /ปฏิเสธ.*bad things/ }],
  ["event error กลางสตรีม: request_too_large", streamApiError("request_too_large", "too big"), { fatal: false, status: 413, message: /ปฏิเสธ.*too big/ }],
  ["event error กลางสตรีม: ชนิดที่ไม่รู้จัก", streamApiError("brand_new_error", "something odd"), { fatal: false, status: null, message: /ตอบกลับข้อผิดพลาด.*something odd/ }],
  ["เครือข่าย (APIConnectionError)", new APIConnectionError({ message: "Connection error." }), { fatal: false, status: null, message: /^เชื่อมต่อ Claude API ไม่ได้/ }],
  ["Error ของ SDK ที่ไม่ใช่ API (สตรีมขาด)", new AnthropicError("terminated"), { fatal: false, status: null, message: /ไม่สมบูรณ์.*terminated/ }],
  ["Error ทั่วไป", new Error("boom"), { fatal: false, status: null, message: /boom/ }],
  ["ค่าที่ไม่ใช่ Error", "oops", { fatal: false, status: null, message: /oops/ }],
]
for (const [label, error, expected] of CLASSES) {
  test(`classifyError: ${label}`, () => {
    const e = aiError(classifyError(error))
    assert.equal(e.fatal, expected.fatal)
    assert.equal(e.status, expected.status)
    assert.ok(hasThai(e.message), e.message)
    assert.match(e.message, expected.message)
  })
}

test("classifyError: ข้อความจาก API ที่ยาวมากถูกตัดให้อ่านได้", () => {
  const e = aiError(classifyError(apiError(400, "x".repeat(5000))))
  assert.ok(e.message.length < 600, `ยาว ${e.message.length}`)
})

test("classifyError: AiError ผ่านไปเป็นตัวเดิม; AbortError ผ่านไปไม่ห่อ; ข้อผิดพลาดยกเลิกของ SDK กลายเป็น AbortError", () => {
  const own = new AiError("เดิม", { fatal: true, status: 401 })
  assert.equal(classifyError(own), own)

  const abort = abortError()
  assert.equal(abort.name, "AbortError")
  assert.equal(classifyError(abort), abort)
  const named = Object.assign(new Error("aborted"), { name: "AbortError" })
  assert.equal(classifyError(named), named)

  const fromSdk = classifyError(new APIUserAbortError())
  assert.ok(!(fromSdk instanceof AiError))
  assert.equal(fromSdk.name, "AbortError")
})

test("classifyError: ใส่ (HTTP n) เฉพาะที่มาจากการตอบกลับ HTTP จริง (ไม่ใส่ให้ error กลางสตรีม) และไม่ซ้ำเลขสถานะในรายละเอียด", () => {
  assert.match(aiError(classifyError(apiError(401, "invalid x-api-key"))).message, /\(HTTP 401\)/)
  assert.match(aiError(classifyError(apiError(503, "unavailable"))).message, /\(HTTP 503\)/)
  assert.doesNotMatch(aiError(classifyError(streamApiError("overloaded_error", "Overloaded"))).message, /HTTP/)
  const plain = aiError(classifyError(APIError.generate(400, "upstream gateway text", undefined, new Headers())))
  assert.match(plain.message, /\(HTTP 400\): "upstream gateway text"/)
})

test("AiError: สถานะเริ่มต้นเป็น null และเป็น Error ที่มีชื่อ AiError", () => {
  const e = new AiError("ข้อความ", { fatal: false })
  assert.deepEqual([e.fatal, e.status, e.name, e instanceof Error], [false, null, "AiError", true])
})

test("classifyError: ข้อความไม่มีตัว key แม้ต้นทางสะท้อนกลับมา (ทั้งรู้ key และเดาจากรูปแบบ sk-…)", () => {
  const echoed = apiError(400, `bad request for ${KEY} please retry`)
  assert.ok(!aiError(classifyError(echoed, KEY)).message.includes(KEY))
  const byShape = aiError(classifyError(apiError(400, "x sk-ant-api03-ABCDEFGH12345678 y")))
  assert.ok(!byShape.message.includes("sk-ant-api03-ABCDEFGH12345678"))
  assert.ok(!aiError(classifyError(new Error(`failed with ${KEY}`), KEY)).message.includes(KEY))
  assert.ok(!aiError(classifyError(`raw ${KEY}`, KEY)).message.includes(KEY))
})

test("classifyError: key ที่ไม่ได้ขึ้นต้นด้วย sk-ant- (เช่นโทเคนของพร็อกซี) ก็ถูกลบเมื่อรู้ key; key สั้นเกินไปไม่ถูกใช้ลบ (กันข้อความเละ)", () => {
  const odd = "proxy-token-9f8e7d6c5b4a"
  assert.ok(!aiError(classifyError(apiError(400, `denied for ${odd}`), odd)).message.includes(odd))
  assert.ok(aiError(classifyError(new Error("keep this text"), "e")).message.includes("keep this text"))
})

test("classifyError: key ที่อยู่ตรงรอยตัดความยาวไม่หลุดครึ่งตัว (ลบก่อนตัดความยาว)", () => {
  const e = aiError(classifyError(apiError(400, `${"x".repeat(290)}${KEY}`), KEY))
  assert.ok(!e.message.includes(KEY.slice(0, 10)), "ต้องไม่เหลือส่วนหน้าของ key")
})

// ---------------------------------------------------------------- ทั้งสาย SDK → AiError

test("ทั้งสาย: 401 ที่ต้นทางสะท้อน key กลับมา → AiError fatal ที่ทั้งข้อความและ inspect() (stack/cause) ไม่มี key", async () => {
  const unauthorized = createFakeFetch(() => errorResponse(401, `invalid x-api-key: ${KEY}`, { type: "authentication_error" }))
  const e401 = aiError(await failure(aiFor(unauthorized).ping("m")))
  assert.deepEqual([e401.fatal, e401.status], [true, 401])
  assert.ok(!e401.message.includes(KEY))
  assert.ok(!inspect(e401, { depth: 8, showHidden: true }).includes(KEY), "ห้ามพก error เดิมที่สะท้อน key ไว้ใน cause")
})

test("ทั้งสาย: 429 → ไม่ fatal; เครือข่ายล้ม → ไม่ fatal ไม่มีสถานะ", async () => {
  const limited = createFakeFetch(() => errorResponse(429, "slow down", { type: "rate_limit_error" }))
  const e429 = aiError(await failure(aiFor(limited).translateChunk(translateParams())))
  assert.deepEqual([e429.fatal, e429.status], [false, 429])
  assert.equal(limited.requests.length, 1, "maxRetries 0 = ไม่ลองใหม่")

  const offline = createFakeFetch(() => {
    throw new TypeError("fetch failed")
  })
  const eNet = aiError(await failure(aiFor(offline).chapterNotes(NOTES_PARAMS)))
  assert.deepEqual([eNet.fatal, eNet.status], [false, null])
  assert.match(eNet.message, /^เชื่อมต่อ Claude API ไม่ได้/)
  assert.equal(offline.requests.length, 1, "maxRetries 0 = ไม่ลองใหม่")
})

test("SDK ลองใหม่ให้: maxRetries 1 + 429 พร้อม retry-after-ms แล้วตอบ 200 → สำเร็จ ใช้ 2 คำขอ", async () => {
  const fake = createFakeFetch(
    () => errorResponse(429, "slow down", { type: "rate_limit_error", headers: { "retry-after-ms": "1" } }),
    () => jsonMessage([{ type: "text", text: "pong" }], { input_tokens: 3, output_tokens: 1 }),
  )
  assert.deepEqual(await aiFor(fake, 1).ping("m"), { usage: { inputTokens: 3, outputTokens: 1 } })
  assert.equal(fake.requests.length, 2)
})

test("ค่าเริ่มต้น maxRetries คือ 5: ตอบ 429 ตลอด → ทั้งหมด 6 คำขอแล้วจึงล้มแบบไม่ fatal", async () => {
  const fake = createFakeFetch(() => errorResponse(429, "slow down", { type: "rate_limit_error", headers: { "retry-after-ms": "1" } }))
  const e = aiError(await failure(createAi(KEY, { fetch: fake.fetch }).ping("m")))
  assert.deepEqual([e.fatal, e.status], [false, 429])
  assert.equal(fake.requests.length, 6)
})
