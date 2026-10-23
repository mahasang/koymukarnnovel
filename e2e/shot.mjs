#!/usr/bin/env node
/**
 * ถ่ายภาพหน้าเว็บด้วย Chromium จริง ไว้ตรวจตาด้วยภาพ (ตั้งแต่ Task 23 เป็นต้นไป)
 *
 *   node e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม> [--admin] [--out <ไฟล์>]
 *   เช่น  node e2e/shot.mjs / 1280 midnight
 *         node e2e/shot.mjs /admin 390 paper --admin --out /tmp/admin.jpg
 *
 * ทำอะไร: เปิด e2e/server.ts (ระบบจริง + ฐานข้อมูลชั่วคราว + ข้อมูลตัวอย่าง + AI ปลอม) → (--admin) ล็อกอินหลังบ้านด้วยรหัสสุ่ม
 *   → ตั้งธีมลง localStorage ก่อนหน้าโหลด (ให้ theme-init.js หยิบไปใช้เหมือนผู้อ่านจริง) → เปิดหน้า → รอฟอนต์และรูปโหลดเสร็จ
 *   → บันทึก JPEG ทั้งหน้าที่ e2e/out/ (หรือ --out) → พิมพ์ path ของไฟล์ (บรรทัดเดียวทาง stdout) → ปิดเบราว์เซอร์และเซิร์ฟเวอร์
 * ต้อง `npm run build -w web` ก่อน ไม่งั้นเซิร์ฟเวอร์ตอบหน้าแจ้งว่ายังไม่ได้ build (HTTP 503)
 * สิ่งที่ควรดูพิมพ์ทาง stderr ขึ้นต้นด้วย `⚠`: แถบเลื่อนแนวนอน, error/warning ในคอนโซล (รวม CSP), คำขอที่ล้ม, สถานะ HTTP ≥ 400
 * Chromium: /opt/pw-browsers/chromium (ตั้งตัวแปร CHROMIUM_PATH เพื่อใช้ที่อื่น)
 */
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT_DIR = path.join(ROOT, "e2e", "out")
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium"
// ต้องตรงกับ THEMES ใน web/src/lib/theme.ts (มีเทสต์ตรวจ)
const THEMES = ["midnight", "paper", "sepia", "black"]
const THEME_KEY = "koymukarnnovel.theme"
const VIEWPORT_HEIGHT = 900
const USAGE = `ใช้: node e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม> [--admin] [--out <ไฟล์>]
  เส้นทาง  ขึ้นต้นด้วย / เช่น / หรือ /novel/1
  กว้าง    ความกว้างหน้าจอเป็นพิกเซล 280–2560
  ธีม      ${THEMES.join(" | ")}
  --admin  ล็อกอินหลังบ้านก่อนเปิดหน้า
  --out    ไฟล์ปลายทาง (ไม่ใส่ = e2e/out/<ชื่อตามเส้นทาง>-<กว้าง>-<ธีม>.jpg)`

/** อ่านอาร์กิวเมนต์ (โยน Error ข้อความไทยเมื่อผิด) */
function parseArgs(argv) {
  const positional = []
  let admin = false
  let out = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--admin") admin = true
    else if (arg === "--out") {
      out = argv[++i]
      if (!out) throw new Error("--out ต้องตามด้วยชื่อไฟล์")
    } else if (arg.startsWith("--")) throw new Error(`ไม่รู้จักตัวเลือก ${arg}`)
    else positional.push(arg)
  }
  if (positional.length !== 3) throw new Error("ต้องระบุ <เส้นทาง> <กว้าง> <ธีม> ให้ครบสามอย่าง")
  const [route, widthText, theme] = positional
  if (!route.startsWith("/")) throw new Error(`เส้นทางต้องขึ้นต้นด้วย / (ได้ "${route}")`)
  const width = Number(widthText)
  if (!/^\d+$/.test(widthText) || width < 280 || width > 2560) throw new Error(`ความกว้างต้องเป็นจำนวนเต็ม 280–2560 (ได้ "${widthText}")`)
  if (!THEMES.includes(theme)) throw new Error(`ธีมต้องเป็นหนึ่งใน ${THEMES.join(", ")} (ได้ "${theme}")`)
  return { route, width, theme, admin, out }
}

function defaultFileName({ route, width, theme, admin }) {
  const slug = route === "/" ? "home" : route.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page"
  return `${slug}-${width}-${theme}${admin ? "-admin" : ""}.jpg`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** เปิด e2e/server.ts แล้วรอบรรทัด `READY <url>` */
function startServer(adminPassword) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "e2e/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, E2E_ADMIN_PASSWORD: adminPassword },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`เซิร์ฟเวอร์ e2e ไม่พร้อมภายใน 60 วินาที\n${log}`)), 60_000)
    const onData = (chunk) => {
      log += chunk
      const match = log.match(/^READY (\S+)$/m)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`เซิร์ฟเวอร์ e2e จบก่อนพร้อม (รหัส ${code})\n${log}`))
    })
  })
  return { child, ready }
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5000)])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`)
    process.exitCode = 2
    return
  }
  const { route, width, theme, admin } = options
  const file = path.resolve(options.out ?? path.join(OUT_DIR, defaultFileName(options)))

  const adminPassword = randomBytes(12).toString("hex")
  const { child, ready } = startServer(adminPassword)
  const onSignal = () => {
    child.kill("SIGTERM")
    process.exit(130)
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  let browser
  try {
    const url = await ready
    const { chromium } = await import("playwright-core")
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 1, locale: "th-TH", timezoneId: "Asia/Bangkok" })
    await context.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value)
        } catch (e) {
          // เบราว์เซอร์ปิดการเก็บข้อมูล: ข้ามไป
        }
      },
      [THEME_KEY, theme],
    )
    if (admin) {
      const login = await context.request.post(`${url}/api/admin/login`, { data: { password: adminPassword } })
      if (!login.ok()) throw new Error(`ล็อกอินหลังบ้านไม่สำเร็จ (HTTP ${login.status()})`)
    }

    const page = await context.newPage()
    const notes = []
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") notes.push(`console.${m.type()}: ${m.text()}`)
    })
    page.on("pageerror", (e) => notes.push(`pageerror: ${e.message}`))
    page.on("requestfailed", (r) => notes.push(`requestfailed: ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`))
    page.on("response", (r) => {
      if (r.status() >= 400) notes.push(`HTTP ${r.status()}: ${r.url()}`)
    })

    await page.goto(url + route, { waitUntil: "load", timeout: 30_000 })
    // หน้าที่ดึงข้อมูลต่อเนื่อง (เช่นคิวสด) อาจไม่เคย idle: รอสูงสุด 10 วินาทีแล้วไปต่อ
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {})
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
    })
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    if (size.scroll > size.client) notes.push(`แถบเลื่อนแนวนอน: scrollWidth ${size.scroll} > ความกว้างหน้าจอ ${size.client}`)

    // Playwright สร้างโฟลเดอร์ปลายทางให้เอง (e2e-shot.test.ts ตรวจกรณี --out ที่โฟลเดอร์ยังไม่มี)
    await page.screenshot({ path: file, type: "jpeg", quality: 82, fullPage: true })
    console.log(file)
    for (const note of notes) console.error(`⚠ ${note}`)
  } catch (e) {
    console.error(`ถ่ายภาพไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    await browser?.close().catch(() => {})
    await stopServer(child)
  }
}

await main()
