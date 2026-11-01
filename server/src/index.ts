import "./env.js"
import { describeStartupFailure, exitProcess, installShutdown, startServer } from "./bootstrap.js"
import { consoleLogger } from "./util/log.js"

// ทางเข้าของระบบ (`npm start` / `npm run dev`): ตรรกะทั้งหมดอยู่ใน bootstrap.ts ที่นี่แค่ต่อเข้ากับโปรเซสจริง
const log = consoleLogger()

async function main(): Promise<void> {
  try {
    const running = await startServer(process.env, { log })
    installShutdown(running, { log })
  } catch (e) {
    log.error(describeStartupFailure(e))
    exitProcess(1)
  }
}

void main()
