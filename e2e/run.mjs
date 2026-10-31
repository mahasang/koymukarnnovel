#!/usr/bin/env node
/**
 * ตรวจทั้งระบบด้วย Chromium จริง (Task 35): หน้าบ้านผู้อ่าน + หลังบ้านผู้ดูแล บนระบบจริงทั้งชุด (e2e/server.ts: ฐานข้อมูลชั่วคราว + AI ปลอม)
 *
 *   node e2e/run.mjs            รัน `npm run build` ก่อน แล้วบูตเซิร์ฟเวอร์ e2e และเดินสถานการณ์ทั้งหมด
 *   E2E_SKIP_BUILD=1 node e2e/run.mjs   ข้ามการ build (ใช้ตอนเพิ่ง build ไปแล้ว)
 *   E2E_SHOTS=0 node e2e/run.mjs        ไม่เขียนภาพ (ค่าเริ่มต้นเขียนที่ docs/superpowers/verification/)
 *
 * ทุกข้อตรวจเป็น assertion: ล้ม → exit 1 พร้อมรายการที่ล้ม · ผ่านหมด → พิมพ์ `PASS n/N` และ exit 0
 * ไม่แตะ `server/data` หรือ `.env` ของเครื่อง: เซิร์ฟเวอร์ e2e ใช้ฐานข้อมูลชั่วคราวและไม่อ่านตัวแปรสภาพแวดล้อมของระบบ
 * Chromium: /opt/pw-browsers/chromium (ตั้ง CHROMIUM_PATH เพื่อใช้ที่อื่น)
 */
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SHOT_DIR = path.join(ROOT, "docs", "superpowers", "verification")
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium"
const WRITE_SHOTS = process.env.E2E_SHOTS !== "0"
const THEME_KEY = "koymukarnnovel.theme"
const THEMES = ["midnight", "paper"]
const WIDTHS = [390, 1280]

// ───────────────────────── ตัวช่วย ─────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let total = 0
const failures = []
const check = (name, ok, detail = "") => {
  total++
  if (!ok) failures.push(detail ? `${name} — ${detail}` : name)
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? `  — ${detail}` : ""}`)
}
/** รอจนเงื่อนไข (async) เป็นจริง — โพลในโนด */
const until = async (fn, ms = 10_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true
    await sleep(120)
  }
  return false
}
const section = (title) => console.log(`\n── ${title}`)

function build() {
  console.log("build …")
  const result = spawnSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" })
  if (result.status !== 0) {
    console.error(`${result.stdout}\n${result.stderr}`)
    throw new Error("npm run build ล้มเหลว")
  }
}

function startServer(env) {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "e2e/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`เซิร์ฟเวอร์ e2e ไม่พร้อมภายใน 60 วินาที\n${log}`)), 60_000)
    const onData = (chunk) => {
      log += chunk
      const url = log.match(/^READY (\S+)$/m)
      const debug = log.match(/^DEBUG (\S+)$/m)
      if (url && debug) {
        clearTimeout(timer)
        resolve({ url: url[1], debug: debug[1] })
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`เซิร์ฟเวอร์ e2e จบก่อนพร้อม (รหัส ${code})\n${log}`))
    })
  })
  return { child, ready, log: () => log }
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(6000)])
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
}

// ───────────────────────── ข้อมูลทดสอบ ─────────────────────────

/** ต้นฉบับอังกฤษยาว ~12,000 ตัวอักษร (แปลเป็น 3 ส่วน) แยกย่อหน้าด้วยบรรทัดว่างแบบ CRLF */
const englishBody = (n) =>
  Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of chapter ${n}. ${"The lantern light wavered over the tide pools while the keeper counted every ledger entry twice. ".repeat(4)}`).join("\r\n\r\n")

/** คำแปลไทยยาวสำหรับตอนที่ใช้ทดสอบการเลื่อนอ่าน */
const thaiBody = (n) =>
  Array.from({ length: 70 }, (_, i) => `ย่อหน้าที่ ${i + 1} ของตอนที่ ${n}: ลมเช้าพัดผ่านทุ่งหญ้ากว้าง เสียงระฆังจากหอคอยเก่าดังก้องไปไกล นักเดินทางเงยหน้ามองฟ้าสีเทาแล้วก้าวต่อไปบนถนนที่ยาวไม่รู้จบ`).join("\n\n")

// ───────────────────────── สถานการณ์ ─────────────────────────

async function main() {
  if (process.env.E2E_SKIP_BUILD !== "1") build()
  const adminPassword = randomBytes(12).toString("hex")
  const importToken = randomBytes(18).toString("hex")
  const server = startServer({ E2E_ADMIN_PASSWORD: adminPassword, E2E_IMPORT_TOKEN: importToken })
  const onSignal = () => {
    server.child.kill("SIGTERM")
    process.exit(130)
  }
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)

  let browser
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-e2e-run-"))
  try {
    const { url, debug } = await server.ready
    const { chromium } = await import("playwright-core")
    browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
    if (WRITE_SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true })

    // ── สิ่งที่ต้องไม่เกิดบนหน้าใดเลย: error ในคอนโซล / pageerror / คำขอที่ล้ม (ยกเว้นที่ตั้งใจให้ล้ม)
    const problems = []
    const EXPECTED = /status of (400|401|404|409|413|429)|ERR_INTERNET_DISCONNECTED|Failed to load resource: net::ERR_FAILED/
    const watch = (page, label) => {
      page.on("console", (m) => {
        if ((m.type() === "error" || m.type() === "warning") && !EXPECTED.test(m.text())) problems.push(`[${label}] console.${m.type()}: ${m.text().slice(0, 200)}`)
      })
      page.on("pageerror", (e) => problems.push(`[${label}] pageerror: ${e.message.slice(0, 200)}`))
    }
    const newContext = (opts = {}) => browser.newContext({ locale: "th-TH", timezoneId: "Asia/Bangkok", deviceScaleFactor: 1, ...opts })
    const shot = async (page, name, fullPage = true) => {
      if (!WRITE_SHOTS) return
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: "jpeg", quality: 72, fullPage })
    }

    const aiCalls = async () => (await fetch(`${debug}/__e2e/ai-calls`)).json()
    const aiMode = async (mode) => {
      const r = await fetch(`${debug}/__e2e/ai-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) })
      if (!r.ok) throw new Error(`ตั้งโหมด AI ${mode} ไม่สำเร็จ: ${r.status}`)
    }

    // ── เตรียมข้อมูล (ผ่าน API ของผู้ดูแล) ──────────────────────────────
    const adminCtx = await newContext({ viewport: { width: 1280, height: 900 } })
    const asAdmin = adminCtx.request
    const login = await asAdmin.post(`${url}/api/admin/login`, { data: { password: adminPassword } })
    check("เตรียมข้อมูล: ล็อกอินหลังบ้านผ่าน API ได้", login.ok())
    const adminJson = async (method, p, data) => {
      const r = await asAdmin.fetch(`${url}${p}`, { method, data })
      return { status: r.status(), body: await r.json().catch(() => null) }
    }
    const importPut = (novelId, number, body, token = importToken) =>
      fetch(`${url}/api/import/novels/${novelId}/chapters/${number}/translation`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      })

    const publicNovels = await (await fetch(`${url}/api/public/novels`)).json()
    const demo = publicNovels.find((n) => n.title === "Ledger of the Lantern Tide")
    check("ข้อมูลตัวอย่างพร้อม: นิยายตัวอย่าง 3 ตอนที่เผยแพร่แล้ว", demo !== undefined && demo.chapterCount === 3)
    const DEMO = demo.id

    // นิยายยาวสำหรับทดสอบการเลื่อนอ่าน (ตอนละ ~70 ย่อหน้า เผยแพร่แล้ว)
    const made = await adminJson("POST", "/api/admin/novels", { title: "The Long Road Home", titleTh: "ทางกลับบ้านอันยาวไกล", author: "E2E Author", synopsisSrc: "A traveller walks a very long road.", tags: ["ผจญภัย"], published: true })
    const LONG = made.body?.id
    check("เตรียมข้อมูล: สร้างนิยายยาวสำหรับทดสอบการเลื่อนอ่าน", made.status === 201 && Number.isInteger(LONG), JSON.stringify(made))
    const longCreated = await adminJson("POST", `/api/admin/novels/${LONG}/chapters`, { chapters: [1, 2, 3].map((n) => ({ number: n, title: `Road ${n}`, text: `Road text ${n}` })), translate: false })
    for (const n of [1, 2, 3]) await importPut(LONG, n, { translation: thaiBody(n), titleTh: `ถนนช่วงที่ ${n}`, recap: `สรุปช่วงที่ ${n}` })
    const longPub = await adminJson("POST", "/api/admin/chapters/bulk", { action: "publish", ids: longCreated.body.created })
    check("เตรียมข้อมูล: นิยายยาว 3 ตอนแปลและเผยแพร่แล้ว", longPub.status === 200, JSON.stringify(longPub.body))

    // ═════════════════ หน้าบ้าน ═════════════════
    section("หน้าบ้าน: ธีม × ความกว้าง")
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const ctx = await newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
        await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) }, [THEME_KEY, theme])
        const page = await ctx.newPage()
        watch(page, `public ${theme} ${width}`)
        const pages = [
          ["home", "/", ".hero, .card, .poster"],
          ["novel", `/novel/${DEMO}`, "h1.nv-title"],
          ["reader", `/novel/${DEMO}/1`, "p.rd-p"],
        ]
        for (const [name, route, ready] of pages) {
          await page.goto(url + route, { waitUntil: "load" })
          await page.waitForSelector(ready, { timeout: 10_000 })
          await page.evaluate(() => document.fonts.load("16px Sarabun", "สวัสดี"))
          const m = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            inner: window.innerWidth,
            theme: document.documentElement.getAttribute("data-theme"),
            font: document.fonts.check("16px Sarabun", "สวัสดี"),
          }))
          check(`${name} · ${theme} · ${width}px: ไม่มีแถบเลื่อนแนวนอน · data-theme ตรง · ฟอนต์ Sarabun โหลดจริง`, m.scroll <= m.inner && m.theme === theme && m.font === true, JSON.stringify(m))
          await shot(page, `public-${name}-${theme}-${width}`)
        }
        await ctx.close()
      }
    }

    section("หน้าบ้าน: ธีมจากเมนู · ขนาดตัวอักษร · จำตำแหน่งอ่าน · อ่านต่อ · ลูกศร")
    {
      const ctx = await newContext({ viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()
      watch(page, "reader flow")
      await page.goto(url + "/", { waitUntil: "load" })
      await page.waitForSelector("header.top")
      const themeNow = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"))
      const before = await themeNow()
      await page.locator('header.top button[aria-label="เปลี่ยนธีม"]').click()
      await page.locator('[role="menuitemradio"]', { hasText: "กระดาษ" }).click()
      check("สลับธีมจากเมนู → data-theme เปลี่ยนเป็น paper", before !== "paper" && (await themeNow()) === "paper", `${before} → ${await themeNow()}`)
      await page.reload({ waitUntil: "load" })
      await page.waitForSelector("header.top")
      check("โหลดใหม่แล้วธีมยังอยู่ (จำในเครื่อง)", (await themeNow()) === "paper")

      await page.goto(`${url}/novel/${LONG}/1`, { waitUntil: "load" })
      await page.waitForSelector("p.rd-p")
      const fontSize = () => page.locator("article.rd").evaluate((el) => getComputedStyle(el).fontSize)
      const size0 = await fontSize()
      await page.getByRole("button", { name: "ตั้งค่าการอ่าน" }).first().click()
      await page.locator("input.rs-range").focus()
      await page.keyboard.press("End")
      const size1 = await fontSize()
      check("ปรับขนาดตัวอักษรในหน้าอ่าน → ขนาดจริงของบทความเปลี่ยนตาม", size0 !== size1 && size1 === "26px", `${size0} → ${size1}`)
      await page.keyboard.press("Escape")
      await page.keyboard.press("Home")
      await page.evaluate(() => localStorage.setItem("koymukarnnovel.reader", JSON.stringify({ fontSize: 18, font: "sans" })))

      // เลื่อนไป ~50% รอ 0.7 วินาที โหลดใหม่ → กลับมาใกล้เดิม
      await page.goto(`${url}/novel/${LONG}/1`, { waitUntil: "load" })
      await page.waitForSelector("p.rd-p")
      const range = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
      const scrollY = () => page.evaluate(() => Math.round(window.scrollY))
      const scrollTo = (y) => page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y)
      const R = await range()
      check("ตอนยาวพอให้เลื่อนได้ (ใช้ทดสอบตำแหน่งอ่าน)", R > 1500, `range=${R}`)
      await scrollTo(Math.round(R * 0.5))
      await sleep(700)
      await page.reload({ waitUntil: "load" })
      await page.waitForSelector("p.rd-p")
      await sleep(600)
      const restored = (await scrollY()) / (await range())
      check("เลื่อนไป ~50% แล้วโหลดใหม่ → ตำแหน่งกลับมาใกล้เดิม (±3%)", Math.abs(restored - 0.5) <= 0.03, `${(restored * 100).toFixed(1)}%`)

      // เลื่อนจนสุด → หน้าแรก "อ่านต่อ" ชี้ตอนถัดไป
      await scrollTo(await range())
      await sleep(800)
      await page.goto(url + "/", { waitUntil: "load" })
      await page.waitForSelector(".resume a.rcard")
      const hrefs = await page.locator(".resume a.rcard").evaluateAll((as) => as.map((a) => a.getAttribute("href")))
      check("อ่านจนสุดตอน 1 → หน้าแรก 'อ่านต่อ' ชี้ตอนถัดไป (ตอน 2)", hrefs.includes(`/novel/${LONG}/2`), hrefs.join(" "))
      await shot(page, "public-home-continue-paper-1280")

      // ปุ่มลูกศรขวา → ตอนถัดไป
      await page.goto(`${url}/novel/${LONG}/1`, { waitUntil: "load" })
      await page.waitForSelector("p.rd-p")
      await page.keyboard.press("ArrowRight")
      check("กดลูกศรขวา → ไปตอนถัดไป", await until(async () => page.url().endsWith(`/novel/${LONG}/2`)), page.url())
      await ctx.close()
    }

    section("หน้าบ้าน: ออฟไลน์ผ่าน service worker · ผู้อ่านทั่วไปกับหลังบ้าน")
    {
      const ctx = await newContext({ viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()
      watch(page, "offline")
      await page.goto(`${url}/novel/${DEMO}`, { waitUntil: "load" })
      await page.waitForSelector("h1.nv-title")
      await page.goto(`${url}/novel/${DEMO}/2`, { waitUntil: "load" })
      await page.waitForSelector("p.rd-p")
      await page.waitForFunction(() => navigator.serviceWorker.ready.then((r) => r.active?.state === "activated"))
      await page.reload({ waitUntil: "load" })
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
      await page.waitForSelector("p.rd-p")
      await sleep(500)
      await ctx.setOffline(true)
      await page.reload({ waitUntil: "load" })
      const ok = await page.waitForSelector("p.rd-p", { timeout: 10_000 }).then(() => true, () => false)
      check("ออฟไลน์ (หลังเคยเปิดแล้ว) → หน้าตอนยังเปิดและอ่านได้จาก service worker", ok && (await page.locator("p.rd-p").count()) > 0)
      await ctx.setOffline(false)
      await ctx.close()
    }
    {
      const ctx = await newContext({ viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()
      watch(page, "visitor")
      await page.goto(url + "/admin", { waitUntil: "load" })
      const loginForm = await page.waitForSelector("form.ad-login-card", { timeout: 10_000 }).then(() => true, () => false)
      const me = await ctx.request.get(url + "/api/admin/me")
      check("ผู้อ่านทั่วไปเข้า /admin ได้หน้าล็อกอิน · GET /api/admin/me ได้ 401", loginForm && me.status() === 401, `me=${me.status()}`)
      await ctx.close()
    }

    // ═════════════════ หลังบ้าน ═════════════════
    section("หลังบ้าน: ล็อกอิน · Dashboard · สร้างเรื่อง")
    const ctx = await newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    watch(page, "admin")
    page.on("dialog", async (d) => {
      problems.push(`[admin] native dialog: ${d.type()} ${d.message().slice(0, 80)}`)
      await d.dismiss()
    })
    await page.goto(url + "/admin", { waitUntil: "load" })
    await page.waitForSelector("form.ad-login-card")
    await shot(page, "admin-login-1280", false)
    await page.fill('input[name="password"]', "รหัสที่ไม่ถูกต้อง")
    await page.keyboard.press("Enter")
    check("ล็อกอินรหัสผิด → ข้อความ 'รหัสผ่านไม่ถูกต้อง' และยังอยู่หน้าล็อกอิน", (await page.waitForSelector(".ad-login-error", { timeout: 5000 }).then((el) => el.innerText())) === "รหัสผ่านไม่ถูกต้อง" && (await page.locator("form.ad-login-card").count()) === 1)
    await page.fill('input[name="password"]', adminPassword)
    await page.keyboard.press("Enter")
    await page.waitForSelector("main h1")
    check("รหัสถูก → Dashboard มีส่วน 'เริ่มต้นใช้งาน'", (await page.locator("main h1").innerText()) === "แดชบอร์ด" && (await page.locator(".ad-onboard h2").innerText()) === "เริ่มต้นใช้งาน")
    await page.waitForSelector(".ad-stats")
    await shot(page, "admin-dashboard-1280")

    await page.goto(url + "/admin/novels/new", { waitUntil: "load" })
    await page.waitForSelector("#nf-title")
    await page.fill("#nf-title", "Ledger Keeper's Lantern")
    await page.fill("#nf-author", "E2E Author")
    await page.fill("#nf-synopsisSrc", "A keeper counts ledger entries by lantern light.")
    await page.fill("#nf-tags", "แฟนตาซี")
    await page.keyboard.press("Enter")
    await page.fill("#nf-tags", "ลึกลับ")
    await page.keyboard.press("Enter")
    await shot(page, "admin-novel-form-1280")
    await page.getByRole("button", { name: "สร้างเรื่อง" }).click()
    await page.waitForURL(/\/admin\/novels\/\d+/, { timeout: 10_000 })
    const N = Number(new URL(page.url()).pathname.split("/").pop())
    const createdNovel = (await adminJson("GET", `/api/admin/novels/${N}`)).body
    check("สร้างเรื่อง (ชื่อ + แท็ก): ไปหน้าแก้ไข · เก็บชื่อและแท็ก 2 อัน · ยังเป็นร่าง", Number.isInteger(N) && createdNovel.title === "Ledger Keeper's Lantern" && createdNovel.tags.length === 2 && createdNovel.published === false, JSON.stringify(createdNovel).slice(0, 160))
    check("ผู้อ่านเห็นเรื่องร่างไม่ได้ (404)", (await fetch(`${url}/api/public/novels/${N}`)).status === 404)
    // เผยแพร่เรื่อง เพื่อทดสอบการเผยแพร่ตอนต่อ (ตอนยังเป็นร่างทั้งหมด)
    check("เผยแพร่เรื่อง (ตอนยังไม่เผยแพร่)", (await adminJson("PATCH", `/api/admin/novels/${N}`, { published: true })).status === 200 && (await fetch(`${url}/api/public/novels/${N}`)).status === 200)

    section("หลังบ้าน: วาง 3 ตอน (CRLF) → แปลทันที → Dashboard เห็นสด")
    await aiMode("slow")
    await page.goto(`${url}/admin/add?novel=${N}`, { waitUntil: "load" })
    await page.waitForSelector("#add-text")
    const pasted = [1, 2, 3].map((n) => `Chapter ${n}: Tide ${n}\r\n\r\n${englishBody(n)}`).join("\r\n\r\n")
    check("ข้อความที่วางเป็น CRLF จริง", pasted.includes("\r\n"))
    await page.locator("#add-text").fill(pasted)
    check("แผง 'พบ 3 ตอน' ขึ้น · ปุ่ม 'แปล 3 ตอน'", await until(async () => /พบ 3 ตอน/.test(await page.locator(".ad-found").innerText())) && (await page.locator("button[type=submit]").innerText()) === "แปล 3 ตอน", await page.locator(".ad-found").innerText())
    await shot(page, "admin-add-chapters-1280")
    await page.locator("button[type=submit]").click()
    check("ส่งแล้วไปหน้าตอนของเรื่อง", await until(async () => page.url().includes(`/admin/novels/${N}?tab=chapters`)), page.url())

    await page.goto(url + "/admin", { waitUntil: "load" })
    const streamed = await until(async () => /แปลจากเครื่องปลอม/.test(await page.locator(".ad-live").innerText()), 20_000)
    const partLabel = await page.locator(".ad-cur-sub").innerText().catch(() => "")
    check("Dashboard เห็นข้อความที่กำลังแปลไหลสด · เห็นส่วนที่ x จาก y", streamed && /ส่วนที่ \d+ จาก \d+/.test(partLabel), partLabel)
    await shot(page, "admin-dashboard-live-1280")
    await aiMode("ok")
    const allDone = await until(async () => {
      const rows = (await adminJson("GET", `/api/admin/novels/${N}/chapters`)).body
      return rows.length === 3 && rows.every((c) => c.status === "done")
    }, 90_000)
    check("ครบ 3 ตอนเป็น 'แปลเสร็จ'", allDone)
    const chapters = (await adminJson("GET", `/api/admin/novels/${N}/chapters`)).body
    check("แปลเสร็จแล้วตอนยังไม่เผยแพร่ (ผู้ดูแลต้องตรวจก่อน)", chapters.every((c) => c.published === false))

    section("หลังบ้าน: เผยแพร่ · ซ่อน · ผู้อ่านเห็น/ไม่เห็น")
    const visitor = await newContext({ viewport: { width: 1280, height: 900 } })
    const visitorPage = await visitor.newPage()
    watch(visitorPage, "visitor2")
    const asVisitorStatus = async (n) => (await visitor.request.get(`${url}/api/public/novels/${N}/chapters/${n}`)).status()
    check("ตอนที่ยังไม่เผยแพร่: ผู้อ่านทั่วไปได้ 404", (await asVisitorStatus(1)) === 404)
    await visitorPage.goto(`${url}/novel/${N}/1`, { waitUntil: "load" })
    await visitorPage.waitForSelector("main.wrap")
    check("ผู้อ่านเปิดหน้าตอนร่างเห็น 'ไม่พบหน้านี้'", await until(async () => (await visitorPage.locator("main.wrap").innerText()).includes("ไม่พบหน้านี้")))
    await page.goto(`${url}/novel/${N}/1`, { waitUntil: "load" })
    await page.waitForSelector("article.rd")
    check("ผู้ดูแลเห็นตอนร่างพร้อมป้าย 'ร่าง — เห็นเฉพาะผู้ดูแล'", (await page.locator(".rd-draft").innerText()).includes("ร่าง — เห็นเฉพาะผู้ดูแล"))

    await page.goto(`${url}/admin/novels/${N}?tab=chapters`, { waitUntil: "load" })
    await page.waitForSelector(".ad-ctable")
    check("ตารางตอน: 3 แถว สถานะ 'แปลเสร็จ' ทั้งหมด", (await page.locator(".ad-ctable tbody tr").count()) === 3 && (await page.locator(".ad-ctable .ad-pill", { hasText: "แปลเสร็จ" }).count()) === 3)
    await page.locator('[data-act="publish-ready"]').click()
    check("กด 'เผยแพร่ตอนที่แปลเสร็จทั้งหมด' → แจ้ง 'เผยแพร่แล้ว 3 ตอน'", await until(async () => (await page.locator("p.ad-notice").innerText()) === "เผยแพร่แล้ว 3 ตอน"))
    check("ผู้อ่านเห็นตอนทันที (200) และเปิดอ่านได้", (await asVisitorStatus(1)) === 200 && (await asVisitorStatus(2)) === 200)
    await visitorPage.goto(`${url}/novel/${N}/1`, { waitUntil: "load" })
    check("หน้าตอนของผู้อ่านแสดงเนื้อหา", await visitorPage.waitForSelector("p.rd-p", { timeout: 10_000 }).then(() => true, () => false))
    await shot(page, "admin-chapters-table-1280")
    await page.getByRole("switch", { name: "เผยแพร่ตอนที่ 3" }).click()
    check("ซ่อนตอน 3 → ผู้อ่านได้ 404 (ตอนอื่นยังเห็น)", (await until(async () => (await asVisitorStatus(3)) === 404)) && (await asVisitorStatus(2)) === 200)

    section("หลังบ้าน: ปิดแปลทันที → วางคำแปลเอง → ไม่เรียก AI")
    await page.goto(`${url}/admin/add?novel=${N}`, { waitUntil: "load" })
    await page.waitForSelector("#add-text")
    await page.locator("#add-text").fill(`Chapter 4: Manual Tide\r\n\r\n${englishBody(4).slice(0, 1500)}`)
    await until(async () => (await page.locator(".ad-atable tbody tr").count()) === 1)
    await page.getByRole("switch", { name: "แปลทันที" }).click()
    check("ปิดแปลทันที → ปุ่ม 'บันทึกเป็นร่าง'", (await page.locator("button[type=submit]").innerText()) === "บันทึกเป็นร่าง")
    await page.locator("button[type=submit]").click()
    await until(async () => page.url().includes("tab=chapters"))
    const ch4 = (await adminJson("GET", `/api/admin/novels/${N}/chapters`)).body.find((c) => c.number === 4)
    check("ตอน 4 บันทึกเป็น 'draft'", ch4?.status === "draft", JSON.stringify(ch4?.status))
    const callsBefore = await aiCalls()
    await page.goto(`${url}/admin/novels/${N}/chapters/${ch4.id}`, { waitUntil: "load" })
    await page.waitForSelector("#ce-translation")
    await page.fill("#ce-translation", "นี่คือคำแปลที่ผู้ดูแลวางเอง โดยไม่ผ่าน AI")
    await page.getByRole("button", { name: "บันทึก", exact: true }).click()
    const doneByHand = await until(async () => (await adminJson("GET", `/api/admin/chapters/${ch4.id}`)).body.status === "done")
    const callsAfter = await aiCalls()
    check("วางคำแปลเองแล้วบันทึก → 'done' · จำนวนการเรียก AI ไม่เพิ่ม", doneByHand && callsAfter.total === callsBefore.total && callsAfter.translateChunk === callsBefore.translateChunk, `${JSON.stringify(callsBefore)} → ${JSON.stringify(callsAfter)}`)

    section("หลังบ้าน: นำเข้าผ่านโทเค็น")
    const made5 = await adminJson("POST", `/api/admin/novels/${N}/chapters`, { chapters: [{ number: 5, title: "Imported Tide", text: "Imported text." }], translate: false })
    check("สร้างตอน 5 (ร่าง) สำหรับนำเข้า", made5.status === 201)
    const noAuth = await importPut(N, 5, { translation: "x" }, "")
    check("นำเข้าโดยไม่มีโทเค็น → 401", noAuth.status === 401)
    const imp = await importPut(N, 5, { translation: "คำแปลที่นำเข้าผ่านโทเค็น", titleTh: "คลื่นที่นำเข้า" })
    const impBody = await imp.json()
    const ch5 = (await adminJson("GET", `/api/admin/chapters/${made5.body.created[0]}`)).body
    check("นำเข้าด้วย Bearer → 200 ตอนเป็น 'done' และไม่เผยแพร่เอง", imp.status === 200 && ch5.status === "done" && ch5.published === false && impBody.chapter.published === false, `${imp.status} ${ch5.status} ${ch5.published}`)
    const again = await importPut(N, 5, { translation: "คำแปลอีกครั้ง" })
    const againBody = await again.json()
    check("นำเข้าซ้ำโดยไม่ส่ง overwrite → 409 (has_translation)", again.status === 409 && againBody.code === "has_translation", `${again.status} ${JSON.stringify(againBody)}`)

    section("หลังบ้าน: AI ปลอมคืน 401 → คิวหยุด → ทำต่อ")
    const made6 = await adminJson("POST", `/api/admin/novels/${N}/chapters`, { chapters: [{ number: 6, title: "Doomed Tide", text: englishBody(6).slice(0, 3000) }], translate: false })
    const id6 = made6.body.created[0]
    await aiMode("fail401")
    await page.goto(`${url}/admin/novels/${N}?tab=chapters`, { waitUntil: "load" })
    await page.waitForSelector(".ad-ctable")
    await page.getByRole("checkbox", { name: "เลือกตอนที่ 6" }).check()
    await page.locator('[data-kind="bulk"] [data-act="translate"]').click()
    const banner = await page.waitForSelector(".ad-banner", { timeout: 15_000 }).then((el) => el.innerText(), () => "")
    check("แถบเตือนคิวหยุดพร้อมสาเหตุ (API key ไม่ถูกต้อง)", banner.includes("คิวแปลหยุดอยู่") && banner.includes("API key ไม่ถูกต้อง"), banner.replace(/\s+/g, " "))
    check("ตอนยังเป็น 'queued' (ไม่ถูกทำให้ล้ม)", (await adminJson("GET", `/api/admin/chapters/${id6}`)).body.status === "queued")
    await shot(page, "admin-queue-paused-1280", false)
    await aiMode("ok")
    await page.locator(".ad-banner button").click()
    const resumed = await until(async () => (await adminJson("GET", `/api/admin/chapters/${id6}`)).body.status === "done", 30_000)
    check("ตั้ง AI กลับเป็น ok แล้วกด 'ทำต่อ' → แปลสำเร็จ แถบเตือนหาย", resumed && (await page.locator(".ad-banner").count()) === 0)

    section("ความทนทาน · สำรองข้อมูล · ตั้งค่า")
    const big = await page.evaluate(async () => {
      const body = JSON.stringify({ x: "a".repeat(9 * 1024 * 1024) })
      const r = await fetch("/api/admin/me", { method: "POST", headers: { "content-type": "application/json" }, body })
      return { status: r.status, body: await r.json().catch(() => null) }
    })
    check("ส่ง JSON 9MB → 413 พร้อมข้อความไทย", big.status === 413 && /ใหญ่เกินกำหนด/.test(big.body?.error ?? ""), JSON.stringify(big))
    await page.goto(url + "/admin", { waitUntil: "load" })
    await page.waitForSelector(".ad-stats")
    check("หลัง 413 หน้าเว็บยังใช้งานได้ (แดชบอร์ดโหลดปกติ)", (await page.locator("main h1").innerText()) === "แดชบอร์ด")

    const backup = await asAdmin.get(`${url}/api/admin/backup`)
    const dbFile = path.join(tmp, "backup.db")
    fs.writeFileSync(dbFile, await backup.body())
    const { DatabaseSync } = await import("node:sqlite")
    const copy = new DatabaseSync(dbFile, { readOnly: true })
    const counts = { novels: copy.prepare("SELECT COUNT(*) AS c FROM novels").get().c, chapters: copy.prepare("SELECT COUNT(*) AS c FROM chapters").get().c }
    copy.close()
    const liveNovels = (await adminJson("GET", "/api/admin/novels")).body.length
    check("ไฟล์สำรองเปิดด้วย node:sqlite ได้ · นับเรื่องตรงกับของจริง", backup.ok() && /koymukarnnovel-\d{8}-\d{4}\.db/.test(backup.headers()["content-disposition"] ?? "") && counts.novels === liveNovels && counts.chapters > 10, JSON.stringify({ counts, liveNovels }))

    await page.goto(url + "/admin/settings", { waitUntil: "load" })
    await page.waitForSelector("h1")
    await page.waitForSelector("#st-siteName")
    await shot(page, "admin-settings-1280")
    await page.setViewportSize({ width: 390, height: 844 })
    await sleep(300)
    check("หน้าตั้งค่า 390px: ไม่มีแถบเลื่อนแนวนอน", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await shot(page, "admin-settings-390")
    await page.goto(url + "/admin", { waitUntil: "load" })
    await page.waitForSelector(".ad-stats")
    check("แดชบอร์ด 390px: ไม่มีแถบเลื่อนแนวนอน", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await shot(page, "admin-dashboard-390")

    section("สรุปสิ่งผิดปกติในคอนโซล")
    check("ไม่มี error/warning ในคอนโซลหรือ pageerror ตลอดการเดินทั้งหมด (ยกเว้น 4xx ที่ตั้งใจ)", problems.length === 0, problems.slice(0, 5).join(" | "))
    await ctx.close()
    await visitor.close()
    await adminCtx.close()
  } finally {
    await browser?.close().catch(() => {})
    await stopServer(server.child)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log("")
  if (failures.length > 0) {
    console.log(`FAIL ${total - failures.length}/${total}`)
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${total}/${total}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
