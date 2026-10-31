/**
 * เซิร์ฟเวอร์สำหรับตรวจหน้าเว็บด้วยเบราว์เซอร์จริง (e2e/shot.mjs, e2e/run.mjs): ระบบจริงทั้งชุดเหมือน `npm start`
 * แต่ใช้ฐานข้อมูลชั่วคราว + ข้อมูลตัวอย่างจาก `seedDemo` + AI ปลอม (ไม่เรียก Claude จริง ไม่ต้องมี API key)
 *
 * รัน: `node --import tsx e2e/server.ts` → พิมพ์ `READY http://127.0.0.1:<พอร์ต>` เมื่อพร้อม · ปิดด้วย SIGTERM/SIGINT (ลบฐานข้อมูลชั่วคราวให้)
 * รหัสผ่านหลังบ้านคือ `E2E_ADMIN_PASSWORD` (ไม่ตั้ง = `e2e-admin-password`) เซิร์ฟเวอร์นี้ฟังเฉพาะ 127.0.0.1 และมีแต่ข้อมูลตัวอย่าง
 *
 * `E2E_IMPORT_TOKEN` (≥ 24 ตัวอักษร) เปิดช่องทางนำเข้า `/api/import` ไว้ให้ e2e/run.mjs ตรวจ · ไม่ตั้ง = ปิด (ไม่ใช้ IMPORT_TOKEN ของเครื่อง)
 *
 * ตัวช่วยตรวจเฉพาะไฟล์นี้ — เปิดอีกพอร์ตหนึ่งบน 127.0.0.1 (พิมพ์ `DEBUG http://127.0.0.1:<พอร์ต>`) แยกจากเว็บจริง จึงไม่มีทางดีบักในโค้ดระบบ:
 *   `GET  /__e2e/ai-calls`  → `{ translateChunk, chapterNotes, fillNovel, ping, total }` จำนวนครั้งที่เรียก AI ปลอม
 *   `POST /__e2e/ai-mode`   → ตั้งพฤติกรรมการแปล `{"mode":"ok"|"fail401"|"slow"}` (ok = หน่วงนิดหน่อย, slow = หน่วงนาน, fail401 = key ผิด ร้ายแรง → คิวหยุด)
 *
 * ไม่มี flag ทดสอบในโค้ดจริง: ฉีด AI ปลอมเข้า `startServer` จากข้างนอก · ไม่อ่าน `.env` และไม่ใช้ตัวแปรสภาพแวดล้อมของเครื่อง
 * (`envFor` ตั้งทุกค่าของระบบเป็นค่าว่างก่อน แล้วใส่เฉพาะที่ต้องใช้) ความลับจริงของเจ้าของจึงไม่หลุดเข้ามาและไม่ถูกใช้
 */
import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { describeStartupFailure, exitProcess, installShutdown, startServer } from "../server/src/bootstrap.js"
import { seedDemo } from "../server/src/seed.js"
import { AiError } from "../server/src/ai.js"
import { consoleLogger } from "../server/src/util/log.js"
import { nowSql } from "../server/src/util/time.js"
import { createFakeAi, type FakeAi } from "../server/test/helpers/fake-ai.js"
import { envFor } from "../server/test/helpers/boot.js"
import { seedLibrary, type HeroChoice } from "./demo-library.js"

const DEFAULT_ADMIN_PASSWORD = "e2e-admin-password"
const HERO_CHOICES: readonly HeroChoice[] = ["demo", "cover", "none"]

/**
 * `E2E_LIBRARY=full` เพิ่มนิยายสมมติ ~30 เรื่อง (e2e/demo-library.ts) ไว้ตรวจหน้าแรก · `E2E_HERO=demo|cover|none` เลือกเรื่องแนะนำ
 * ไม่ตั้ง = เหมือนเดิม (เรื่องจาก `seedDemo` เรื่องเดียว) ค่าอื่นนอกรายการ → ผิดพลาดชัดๆ แทนที่จะเงียบแล้วได้ข้อมูลไม่ตรงที่คิด
 */
function libraryOptions(env: NodeJS.ProcessEnv): { full: boolean; hero: HeroChoice } {
  const library = env.E2E_LIBRARY ?? ""
  if (library !== "" && library !== "full") throw new Error(`E2E_LIBRARY ต้องเป็น "full" หรือไม่ตั้ง (ได้ "${library}")`)
  const hero = env.E2E_HERO ?? "demo"
  if (!(HERO_CHOICES as readonly string[]).includes(hero)) throw new Error(`E2E_HERO ต้องเป็นหนึ่งใน ${HERO_CHOICES.join(", ")} (ได้ "${hero}")`)
  if (library !== "full" && hero !== "demo") throw new Error(`E2E_HERO=${hero} ใช้ได้เฉพาะเมื่อตั้ง E2E_LIBRARY=full ด้วย`)
  return { full: library === "full", hero: hero as HeroChoice }
}

export const AI_MODES = ["ok", "fail401", "slow"] as const
export type AiMode = (typeof AI_MODES)[number]
const PIECE_DELAY_MS: Record<AiMode, number> = { ok: 120, slow: 1500, fail401: 0 }
const KEY_REJECTED = "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP 401)"

/** AI ปลอมที่เปลี่ยนพฤติกรรมการแปลได้ตามโหมด (อ่านโหมดตอนเรียก จึงเปลี่ยนระหว่างที่คิวทำงานอยู่ได้) */
function createModalAi(): { ai: FakeAi; setMode: (mode: AiMode) => void } {
  let mode: AiMode = "ok"
  const ai = createFakeAi({
    translate: ({ n }) => {
      if (mode === "fail401") throw new AiError(KEY_REJECTED, { fatal: true, status: 401 })
      return { text: `แปลจากเครื่องปลอม ครั้งที่ ${n}`, delayMs: PIECE_DELAY_MS[mode] }
    },
  })
  return { ai, setMode: (next) => (mode = next) }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => (body += chunk))
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

/** เซิร์ฟเวอร์ตรวจ (ฟัง 127.0.0.1 พอร์ตสุ่ม): ดูจำนวนการเรียก AI ปลอม / ตั้งโหมด */
function startDebugServer(ai: FakeAi, setMode: (mode: AiMode) => void): Promise<http.Server> {
  const json = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer((req, res) => {
    void (async () => {
      const route = `${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`
      if (route === "GET /__e2e/ai-calls") {
        const count = (method: string): number => ai.calls.filter((c) => c.method === method).length
        return json(res, 200, { translateChunk: count("translateChunk"), chapterNotes: count("chapterNotes"), fillNovel: count("fillNovel"), ping: count("ping"), total: ai.calls.length })
      }
      if (route === "POST /__e2e/ai-mode") {
        let mode: unknown
        try {
          mode = (JSON.parse(await readBody(req)) as { mode?: unknown }).mode
        } catch {
          mode = undefined
        }
        if (typeof mode !== "string" || !(AI_MODES as readonly string[]).includes(mode)) return json(res, 400, { error: `mode ต้องเป็นหนึ่งใน ${AI_MODES.join(", ")}` })
        setMode(mode as AiMode)
        return json(res, 200, { mode })
      }
      json(res, 404, { error: "ไม่พบเส้นทางตรวจ" })
    })().catch(() => json(res, 500, { error: "ขัดข้อง" }))
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

async function main(): Promise<void> {
  const log = consoleLogger()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-e2e-"))
  const cleanup = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      log.warn(`ลบโฟลเดอร์ชั่วคราว ${dir} ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  try {
    const options = libraryOptions(process.env)
    const password = process.env.E2E_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
    const { ai, setMode } = createModalAi()
    const importToken = process.env.E2E_IMPORT_TOKEN ?? ""
    const running = await startServer(envFor(dir, { ADMIN_PASSWORD: password, IMPORT_TOKEN: importToken }), { log, ai })
    seedDemo(running.db, nowSql())
    if (options.full) seedLibrary(running.db, nowSql(), options.hero)
    const debug = await startDebugServer(ai, setMode)
    installShutdown(running, {
      log,
      exit: (code) => {
        debug.closeAllConnections()
        debug.close()
        cleanup()
        exitProcess(code)
      },
    })
    console.log(`DEBUG http://127.0.0.1:${(debug.address() as AddressInfo).port}`)
    console.log(`READY ${running.url}`)
  } catch (e) {
    log.error(describeStartupFailure(e))
    cleanup()
    exitProcess(1)
  }
}

void main()
