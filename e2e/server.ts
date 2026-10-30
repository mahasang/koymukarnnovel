/**
 * เซิร์ฟเวอร์สำหรับตรวจหน้าเว็บด้วยเบราว์เซอร์จริง (e2e/shot.mjs, e2e/run.mjs): ระบบจริงทั้งชุดเหมือน `npm start`
 * แต่ใช้ฐานข้อมูลชั่วคราว + ข้อมูลตัวอย่างจาก `seedDemo` + AI ปลอม (ไม่เรียก Claude จริง ไม่ต้องมี API key)
 *
 * รัน: `node --import tsx e2e/server.ts` → พิมพ์ `READY http://127.0.0.1:<พอร์ต>` เมื่อพร้อม · ปิดด้วย SIGTERM/SIGINT (ลบฐานข้อมูลชั่วคราวให้)
 * รหัสผ่านหลังบ้านคือ `E2E_ADMIN_PASSWORD` (ไม่ตั้ง = `e2e-admin-password`) เซิร์ฟเวอร์นี้ฟังเฉพาะ 127.0.0.1 และมีแต่ข้อมูลตัวอย่าง
 *
 * ไม่มี flag ทดสอบในโค้ดจริง: ฉีด AI ปลอมเข้า `startServer` จากข้างนอก · ไม่อ่าน `.env` และไม่ใช้ตัวแปรสภาพแวดล้อมของเครื่อง
 * (`envFor` ตั้งทุกค่าของระบบเป็นค่าว่างก่อน แล้วใส่เฉพาะที่ต้องใช้) ความลับจริงของเจ้าของจึงไม่หลุดเข้ามาและไม่ถูกใช้
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describeStartupFailure, exitProcess, installShutdown, startServer } from "../server/src/bootstrap.js"
import { seedDemo } from "../server/src/seed.js"
import { consoleLogger } from "../server/src/util/log.js"
import { nowSql } from "../server/src/util/time.js"
import { createFakeAi } from "../server/test/helpers/fake-ai.js"
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
    const running = await startServer(envFor(dir, { ADMIN_PASSWORD: password }), { log, ai: createFakeAi() })
    seedDemo(running.db, nowSql())
    if (options.full) seedLibrary(running.db, nowSql(), options.hero)
    installShutdown(running, {
      log,
      exit: (code) => {
        cleanup()
        exitProcess(code)
      },
    })
    console.log(`READY ${running.url}`)
  } catch (e) {
    log.error(describeStartupFailure(e))
    cleanup()
    exitProcess(1)
  }
}

void main()
