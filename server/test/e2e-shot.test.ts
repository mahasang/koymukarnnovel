import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, test } from "node:test"
import { SERVER_DIR, WINDOWS, spawnNode, within, type Child } from "./helpers/boot.js"

/**
 * `e2e/shot.mjs` — ถ่ายภาพหน้าเว็บด้วย Chromium จริง (ใช้ตรวจ UI ด้วยตาตั้งแต่ Task 23 เป็นต้นไป):
 *   1) อาร์กิวเมนต์ผิดต้องหยุดทันทีด้วยรหัส 2 + ข้อความไทย + วิธีใช้ โดยยังไม่เปิดเซิร์ฟเวอร์หรือเบราว์เซอร์
 *   2) รันจริงหนึ่งรอบต่อทางแยก (ข้ามเมื่อไม่มี Chromium): ได้ไฟล์ JPEG, path ออกทาง stdout, คำเตือนออกทาง stderr,
 *      --admin ล็อกอินได้, ชื่อไฟล์เริ่มต้น, และปิดเซิร์ฟเวอร์ชั่วคราว (ลบโฟลเดอร์ฐานข้อมูล) เรียบร้อย
 * เส้นทางที่ถ่ายคือ /api/admin/settings, /, /? ซึ่งให้ภาพได้เสมอไม่ว่า `web/dist` จะ build ไว้หรือยัง
 * ส่วนหน้าตาของธีมจริง (ธีมเข้าหน้า, ฟอนต์โหลดภายใต้ CSP) ตรวจด้วยตาและด้วย tokens/theme-init/build-config.test.ts
 */

const ROOT = path.resolve(SERVER_DIR, "..")
const SHOT = path.join(ROOT, "e2e", "shot.mjs")
const OUT_DIR = path.join(ROOT, "e2e", "out")
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium"
const SKIP_BROWSER = fs.existsSync(CHROMIUM) ? false : `ไม่พบ Chromium ที่ ${CHROMIUM} (ตั้ง CHROMIUM_PATH ได้)`
const USAGE_LINE = "ใช้: node e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม> [--admin] [--out <ไฟล์>]"

/** ปิด shot.mjs ด้วยสัญญาณปกติ (มันปิดเซิร์ฟเวอร์ลูกให้) ไม่จบใน 10 วินาทีค่อยฆ่า — กันเซิร์ฟเวอร์กำพร้าค้างเครื่อง */
async function stop(child: Child): Promise<void> {
  if (child.proc.exitCode !== null || child.proc.signalCode !== null) return
  child.kill(WINDOWS ? "SIGKILL" : "SIGTERM")
  try {
    await within(child.exited, 10_000, "shot.mjs ปิดตัว")
  } catch {
    child.kill("SIGKILL")
    await child.exited
  }
}

interface ShotResult {
  code: number | null
  out: string
  err: string
  /** โฟลเดอร์ `koymukarnnovel-e2e-*` ที่เซิร์ฟเวอร์ชั่วคราวทิ้งไว้ใน TMPDIR ของรอบนี้ (ปกติว่าง) */
  leftovers: string[]
}

/** รัน shot.mjs ด้วย TMPDIR ของตัวเอง (ให้ตรวจได้ว่าเซิร์ฟเวอร์ชั่วคราวถูกลบจริง) รอจนจบแล้วคืนผล */
async function runShot(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<ShotResult> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-shot-test-"))
  const child = spawnNode([SHOT, ...args], { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, ...extraEnv })
  try {
    const code = await within(child.exited, 90_000, `shot.mjs ${args.join(" ")}`)
    const leftovers = fs.readdirSync(tmp).filter((name) => name.startsWith("koymukarnnovel-e2e-"))
    return { code, out: child.out(), err: child.err(), leftovers }
  } finally {
    await stop(child)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

const isJpeg = (file: string): boolean => {
  const bytes = fs.readFileSync(file)
  return bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/** ขนาดภาพ (กว้าง × สูง) อ่านจาก marker SOF ของ JPEG — ไม่ต้องพึ่งไลบรารีรูปภาพ */
function jpegSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file)
  let at = 2 // ข้าม SOI (FF D8)
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++ // ไบต์เติม
      continue
    }
    // SOF0–SOF15 (ยกเว้น DHT=C4, JPG=C8, DAC=CC) เก็บ [ความยาว 2][ความละเอียดบิต 1][สูง 2][กว้าง 2]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) }
    }
    at += 2 + bytes.readUInt16BE(at + 2)
  }
  throw new Error("ไม่พบ SOF ใน JPEG")
}

/** รันแล้วลบไฟล์ภาพเริ่มต้น (e2e/out/…) ที่เกิดขึ้น — โฟลเดอร์นั้นอยู่ใน .gitignore แต่ไม่ควรให้เทสต์ทิ้งภาพไว้ */
async function runWithDefaultName(args: string[], fileName: string, width: number, check: (r: ShotResult) => void): Promise<void> {
  const expected = path.join(OUT_DIR, fileName)
  try {
    const result = await runShot(args)
    assert.equal(result.code, 0, `${result.out}\n${result.err}`)
    assert.equal(result.out.trim(), expected)
    assert.ok(fs.existsSync(expected), `ไม่พบไฟล์ ${expected}`)
    assert.ok(isJpeg(expected), "ต้องเป็นไฟล์ JPEG")
    assert.equal(jpegSize(expected).width, width, "ความกว้างของภาพต้องเท่าที่ขอ (หน้านี้ไม่ล้นจอ)")
    check(result)
  } finally {
    fs.rmSync(expected, { force: true })
  }
}

describe("e2e/shot.mjs: อาร์กิวเมนต์", { concurrency: 4 }, () => {
  const cases: [string, string[], RegExp][] = [
    ["ไม่ใส่อะไรเลย", [], /ต้องระบุ <เส้นทาง> <กว้าง> <ธีม> ให้ครบสามอย่าง/],
    ["ขาดธีม", ["/", "1280"], /ต้องระบุ/],
    ["เกินมาหนึ่งตัว", ["/", "1280", "midnight", "extra"], /ต้องระบุ/],
    ["เส้นทางไม่ขึ้นต้นด้วย /", ["home", "1280", "midnight"], /เส้นทางต้องขึ้นต้นด้วย \/ \(ได้ "home"\)/],
    ["กว้างน้อยกว่า 280", ["/", "279", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม 280–2560 \(ได้ "279"\)/],
    ["กว้างเกิน 2560", ["/", "2561", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม 280–2560 \(ได้ "2561"\)/],
    ["กว้างไม่ใช่ตัวเลข", ["/", "abc", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม/],
    ["กว้างเป็นทศนิยม", ["/", "12.5", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม/],
    ["กว้างเป็นเลขฐานสิบหก (Number() อ่านได้ แต่เราไม่รับ)", ["/", "0x200", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม/],
    ["กว้างติดลบ", ["/", "-300", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม/],
    ["กว้างเป็นสตริงว่าง", ["/", "", "midnight"], /ความกว้างต้องเป็นจำนวนเต็ม/],
    ["กว้าง 280 ผ่านด่านความกว้าง (ไปล้มที่ธีม)", ["/", "280", "nope"], /ธีมต้องเป็นหนึ่งใน midnight, paper, sepia, black \(ได้ "nope"\)/],
    ["กว้าง 2560 ผ่านด่านความกว้าง (ไปล้มที่ธีม)", ["/", "2560", "nope"], /ธีมต้องเป็นหนึ่งใน midnight, paper, sepia, black/],
    ["ชื่อธีมต้องตรงตัวพิมพ์", ["/", "1280", "Midnight"], /ธีมต้องเป็นหนึ่งใน/],
    ["ชื่อธีมที่เป็นชื่อสมบัติของ Object ไม่ใช่ธีม", ["/", "1280", "constructor"], /ธีมต้องเป็นหนึ่งใน/],
    ["ตัวเลือกที่ไม่รู้จัก", ["/", "1280", "midnight", "--bogus"], /ไม่รู้จักตัวเลือก --bogus/],
    ["--out ไม่มีค่าตามหลัง", ["/", "1280", "midnight", "--out"], /--out ต้องตามด้วยชื่อไฟล์/],
  ]
  for (const [name, args, message] of cases) {
    test(`${name} → รหัส 2 + ข้อความไทย + วิธีใช้ และยังไม่เปิดเซิร์ฟเวอร์`, async () => {
      const result = await runShot(args)
      assert.equal(result.code, 2, `${result.out}\n${result.err}`)
      assert.match(result.err, message)
      assert.ok(result.err.includes(USAGE_LINE), result.err)
      assert.equal(result.out, "", "ไม่มีอะไรออกทาง stdout (stdout มีไว้ให้ path ของภาพอย่างเดียว)")
      assert.deepEqual(result.leftovers, [])
    })
  }
})

describe("e2e/shot.mjs: ถ่ายภาพจริง", { concurrency: 2 }, () => {
  test("ถ่ายตาม --out (path สัมพัทธ์ก็ได้ สร้างโฟลเดอร์ให้) · พิมพ์ path เต็มบรรทัดเดียวทาง stdout · เตือน HTTP 401 ทาง stderr เมื่อไม่ได้ใส่ --admin · ปิดเซิร์ฟเวอร์ชั่วคราวแล้ว", { skip: SKIP_BROWSER }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-shot-out-"))
    try {
      const file = path.join(dir, "nested", "dir", "x.jpg")
      // ส่ง path แบบสัมพัทธ์กับ cwd ของโปรเซส (server/) — ต้องได้ path เต็มกลับมาทาง stdout
      const result = await runShot(["/api/admin/settings", "600", "sepia", "--out", path.relative(SERVER_DIR, file)])
      assert.equal(result.code, 0, `${result.out}\n${result.err}`)
      assert.equal(result.out, `${file}\n`)
      assert.ok(isJpeg(file), "ต้องเป็นไฟล์ JPEG")
      assert.deepEqual(jpegSize(file), { width: 600, height: 900 }, "หน้าสั้นกว่าจอ: ภาพเท่าขนาดจอ 600 × 900")
      assert.match(result.err, /^⚠ HTTP 401: http:\/\/127\.0\.0\.1:\d+\/api\/admin\/settings$/m)
      assert.doesNotMatch(result.err, /แถบเลื่อนแนวนอน/, "หน้าไม่ล้นจอ ต้องไม่เตือนแถบเลื่อน")
      if (!WINDOWS) assert.deepEqual(result.leftovers, [], "เซิร์ฟเวอร์ชั่วคราวต้องลบโฟลเดอร์ฐานข้อมูลของมันตอนปิด")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("--admin ล็อกอินหลังบ้านก่อนเปิดหน้า (ไม่มี 401) · ชื่อไฟล์เริ่มต้น = <เส้นทาง>-<กว้าง>-<ธีม>-admin.jpg ใน e2e/out", { skip: SKIP_BROWSER }, async () => {
    await runWithDefaultName(["/api/admin/settings", "600", "black", "--admin"], "api-admin-settings-600-black-admin.jpg", 600, (result) => {
      assert.doesNotMatch(result.err, /HTTP 401/)
    })
  })

  test("เส้นทาง / ตั้งชื่อไฟล์ว่า home · กว้างต่ำสุด 280 ถ่ายได้", { skip: SKIP_BROWSER }, async () => {
    await runWithDefaultName(["/", "280", "paper"], "home-280-paper.jpg", 280, () => {})
  })

  test("เส้นทางที่ไม่เหลือตัวอักษรให้ตั้งชื่อ (/?) ใช้ชื่อ page · กว้างสูงสุด 2560 ถ่ายได้", { skip: SKIP_BROWSER }, async () => {
    await runWithDefaultName(["/?", "2560", "sepia"], "page-2560-sepia.jpg", 2560, () => {})
  })

  test("ตัวเลขและตัวพิมพ์ในเส้นทางอยู่ในชื่อไฟล์เริ่มต้นด้วย (/api/public/novels/1 → api-public-novels-1)", { skip: SKIP_BROWSER }, async () => {
    await runWithDefaultName(["/api/public/novels/1", "600", "paper"], "api-public-novels-1-600-paper.jpg", 600, () => {})
  })

  test("เปิด Chromium ไม่ได้ → รหัส 1 + ข้อความไทย ไม่มีอะไรออก stdout และเซิร์ฟเวอร์ชั่วคราวถูกปิดลบทิ้ง (ไม่ค้างเครื่อง)", async () => {
    const result = await runShot(["/", "600", "paper"], { CHROMIUM_PATH: path.join(os.tmpdir(), "ไม่มี-chromium-ตัวนี้") })
    assert.equal(result.code, 1, `${result.out}\n${result.err}`)
    assert.match(result.err, /^ถ่ายภาพไม่สำเร็จ: /m)
    assert.equal(result.out, "")
    if (!WINDOWS) assert.deepEqual(result.leftovers, [], "ล้มกลางทางก็ต้องปิดเซิร์ฟเวอร์ชั่วคราวและลบโฟลเดอร์ของมัน")
  })

  test("หน้าที่ล้นจอ (/sitemap.xml ที่ 280px: บรรทัด xmlns ยาวตัดไม่ได้) → เตือนแถบเลื่อนแนวนอนทาง stderr และภาพเต็มหน้ากว้างกว่าจอ", { skip: SKIP_BROWSER }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "koymukarnnovel-shot-out-"))
    try {
      const file = path.join(dir, "wide.jpg")
      const result = await runShot(["/sitemap.xml", "280", "midnight", "--out", file])
      assert.equal(result.code, 0, `${result.out}\n${result.err}`)
      const warned = result.err.match(/^⚠ แถบเลื่อนแนวนอน: scrollWidth (\d+) > ความกว้างหน้าจอ 280$/m)
      assert.ok(warned, result.err)
      assert.ok(Number(warned[1]) > 280)
      assert.ok(jpegSize(file).width > 280, "ภาพเต็มหน้า (fullPage) ต้องกว้างตามเนื้อหาที่ล้น ไม่ถูกตัดที่ขอบจอ")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
