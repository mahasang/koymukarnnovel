#!/usr/bin/env node
/**
 * เรนเดอร์ไอคอน PNG ของ PWA จาก web/public/icon.svg ด้วย Chromium จริง
 *
 *   node e2e/make-icons.mjs
 *
 * เขียน web/public/icon-192.png และ icon-512.png (พื้นทึบเต็มสี่เหลี่ยม ใช้เป็น maskable ได้) แล้วพิมพ์ชื่อไฟล์ทีละบรรทัด
 * รันซ้ำเมื่อแก้ icon.svg เท่านั้น — ผลลัพธ์ถูกคอมมิตไว้แล้ว ไม่ต้องรันตอน build · Chromium: /opt/pw-browsers/chromium (ตัวแปร CHROMIUM_PATH เปลี่ยนได้)
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC = path.join(ROOT, "web", "public")
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium"
const SIZES = [192, 512]

const svg = fs.readFileSync(path.join(PUBLIC, "icon.svg"))
const dataUrl = `data:image/svg+xml;base64,${svg.toString("base64")}`

const { chromium } = await import("playwright-core")
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] })
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="${dataUrl}" width="${size}" height="${size}" style="display:block"></body></html>`)
    await page.evaluate(() => document.getElementById("i").decode())
    const file = path.join(PUBLIC, `icon-${size}.png`)
    fs.writeFileSync(file, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } }))
    console.log(path.relative(ROOT, file))
    await page.close()
  }
} finally {
  await browser.close()
}
