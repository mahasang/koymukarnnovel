import { test } from "node:test"
import assert from "node:assert/strict"
import { AiError } from "../src/ai.js"
import { createFakeAi } from "./helpers/fake-ai.js"

const T = { model: "m", system: "S", user: "U", maxTokens: 100 }

test("fake ai: แปลโดยสตรีมข้อความเป็นสองส่วนผ่าน onText คืนข้อความรวม usage เริ่มต้น และบันทึกการเรียก (ไม่เก็บ onText/signal)", async () => {
  const ai = createFakeAi()
  const got: string[] = []
  const r = await ai.translateChunk({ ...T, onText: (t) => got.push(t) })
  assert.equal(got.length, 2)
  assert.equal(got.join(""), "แปล 1")
  assert.deepEqual(r, { text: "แปล 1", usage: { inputTokens: 100, outputTokens: 50 } })
  assert.deepEqual(ai.calls, [{ method: "translateChunk", ...T }])
  await ai.translateChunk({ ...T, onText: () => {} })
  assert.equal((await ai.translateChunk({ ...T, onText: () => {} })).text, "แปล 3", "n นับแยกตามเมธอด เริ่มที่ 1")
})

test("fake ai: script.translate คืนข้อความล้วน / พฤติกรรม (pieces, usage, error หลังสตรีมครบ) / throw ก่อนสตรีม; รับ n กับพารามิเตอร์ของการเรียก", async () => {
  const seen: { n: number; user: string }[] = []
  const ai = createFakeAi({
    translate: ({ n, user }) => {
      seen.push({ n, user })
      if (n === 1) return "ข้อความเต็ม"
      if (n === 2) return { pieces: ["ก", "ข", "ค"], usage: { inputTokens: 1, outputTokens: 2 } }
      if (n === 3) return { text: "ครึ่งทาง", error: new AiError("พังหลังสตรีม", { fatal: false, status: 500 }) }
      throw new AiError("พังก่อนสตรีม", { fatal: true })
    },
  })
  const run = (user: string) => {
    const got: string[] = []
    return { got, result: ai.translateChunk({ ...T, user, onText: (t) => got.push(t) }) }
  }
  assert.equal((await run("a").result).text, "ข้อความเต็ม")
  const second = run("b")
  assert.deepEqual(await second.result, { text: "กขค", usage: { inputTokens: 1, outputTokens: 2 } })
  assert.deepEqual(second.got, ["ก", "ข", "ค"])
  const third = run("c")
  await assert.rejects(third.result, /พังหลังสตรีม/)
  assert.equal(third.got.join(""), "ครึ่งทาง", "error มาหลังสตรีมครบทุกส่วน")
  const fourth = run("d")
  await assert.rejects(fourth.result, /พังก่อนสตรีม/)
  assert.deepEqual(fourth.got, [])
  assert.deepEqual(seen, [{ n: 1, user: "a" }, { n: 2, user: "b" }, { n: 3, user: "c" }, { n: 4, user: "d" }])
})

test("fake ai: delayMs เคารพ signal — ยกเลิกระหว่างรอ → AbortError และส่วนที่ยังไม่ถึงไม่ถูกส่ง", { timeout: 10_000 }, async () => {
  const ai = createFakeAi({ translate: () => ({ pieces: ["ก", "ข"], delayMs: 200 }) })
  const controller = new AbortController()
  const got: string[] = []
  const pending = ai.translateChunk({ ...T, signal: controller.signal, onText: (t) => got.push(t) })
  setTimeout(() => controller.abort(), 20)
  await assert.rejects(pending, (e: Error) => e.name === "AbortError")
  assert.deepEqual(got, [])

  const early = new AbortController()
  early.abort()
  const earlyGot: string[] = []
  await assert.rejects(ai.translateChunk({ ...T, signal: early.signal, onText: (t) => earlyGot.push(t) }), (e: Error) => e.name === "AbortError")
  assert.deepEqual(earlyGot, [], "ยกเลิกไว้ก่อนแล้ว ต้องไม่ส่งข้อความออกมาเลย")
})

test("fake ai: ยกเลิกในจังหวะส่งชิ้นสุดท้าย → AbortError (ไม่คืนผลสำเร็จทั้งที่ถูกยกเลิกแล้ว)", async () => {
  const ai = createFakeAi({ translate: () => ({ pieces: ["ก"] }) })
  const controller = new AbortController()
  await assert.rejects(
    ai.translateChunk({ ...T, signal: controller.signal, onText: () => controller.abort() }),
    (e: Error) => e.name === "AbortError",
  )
})

test("fake ai: chapterNotes / fillNovel / ping — ค่าเริ่มต้น, script override, note ว่างเสมอ, บันทึกการเรียกตามลำดับ", async () => {
  const ai = createFakeAi()
  const notes = await ai.chapterNotes({ model: "r", thaiText: "ไทย", sourceTitle: "Ch 1", knownTerms: ["Kael"] })
  assert.deepEqual(notes, { recap: "สรุปตอน 1", titleTh: "ชื่อตอน 1", terms: [], usage: { inputTokens: 100, outputTokens: 50 } })
  assert.deepEqual(await ai.fillNovel({ model: "f", title: "T", synopsisSrc: "", author: "" }), {
    titleTh: "ชื่อไทย",
    synopsis: "เรื่องย่อภาษาไทย",
    tags: ["แฟนตาซี"],
    usage: { inputTokens: 100, outputTokens: 50 },
  })
  assert.deepEqual(await ai.ping("p"), { usage: { inputTokens: 100, outputTokens: 50 } })

  ai.script = {
    notes: ({ n }) => ({ recap: `r${n}`, terms: [{ source: "Kael", thai: "เคล" }, { source: "Mana", thai: "มานา", note: "พลัง" }] }),
    fill: () => ({ titleTh: "ก", tags: [] }),
    ping: () => ({ usage: { inputTokens: 3, outputTokens: 4 } }),
  }
  const again = await ai.chapterNotes({ model: "r", thaiText: "ไทย", sourceTitle: "Ch 2" })
  assert.equal(again.recap, "r2")
  assert.equal(again.titleTh, "ชื่อตอน 2")
  assert.deepEqual(again.terms, [{ source: "Kael", thai: "เคล", note: "" }, { source: "Mana", thai: "มานา", note: "พลัง" }])
  assert.deepEqual((await ai.fillNovel({ model: "f", title: "T", synopsisSrc: "", author: "" })).tags, [])
  assert.deepEqual(await ai.ping("p"), { usage: { inputTokens: 3, outputTokens: 4 } })

  assert.deepEqual(
    ai.calls.map((c) => c.method),
    ["chapterNotes", "fillNovel", "ping", "chapterNotes", "fillNovel", "ping"],
  )
})

test("fake ai: ไม่มี key → hasKey() เท็จ ทุกเมธอดบันทึกการเรียกแล้วล้มแบบ fatal (ANTHROPIC_API_KEY) สลับสถานะระหว่างเทสต์ได้", async () => {
  const ai = createFakeAi({ hasKey: false })
  assert.equal(ai.hasKey(), false)
  const fatal = (e: unknown) => e instanceof AiError && e.fatal === true && e.message.includes("ANTHROPIC_API_KEY")
  await assert.rejects(ai.translateChunk({ ...T, onText: () => {} }), fatal)
  await assert.rejects(ai.chapterNotes({ model: "r", thaiText: "ไทย", sourceTitle: "" }), fatal)
  await assert.rejects(ai.fillNovel({ model: "f", title: "T", synopsisSrc: "", author: "" }), fatal)
  await assert.rejects(ai.ping("p"), fatal)
  assert.equal(ai.calls.length, 4, "ไม่มี key ก็ยังบันทึกว่ามีการเรียก")

  ai.script.hasKey = true
  assert.equal(ai.hasKey(), true)
  assert.equal((await ai.translateChunk({ ...T, onText: () => {} })).text, "แปล 2")
})
