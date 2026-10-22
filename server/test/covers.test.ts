import { test } from "node:test"
import assert from "node:assert/strict"
import express from "express"
import type { AppDeps } from "../src/app.js"
import { MAX_COVER_BYTES, createCoversRouter, detectImage } from "../src/covers.js"
import { createViews } from "../src/views.js"
import { memoryLogger } from "../src/util/log.js"
import { JPEG_GREEN, PNG_BLUE, PNG_RED, WEBP_YELLOW } from "./fixtures/images.js"
import { createClock } from "./helpers/clock.js"
import { startTestApp, withTestApp, type Client, type TestApp } from "./helpers/app.js"
import type { FakeAi } from "./helpers/fake-ai.js"
import { rawRequest, withServer } from "./helpers/http.js"
import { seedNovel } from "./helpers/seed.js"

const THAI = /[฀-๿]/
const NOVELS = "/api/admin/novels"
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const WEBP_SIGNATURE = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBP")])

const bytesOf = (b64: string): Buffer => Buffer.from(b64, "base64")
const epoch = (iso: string): number => Math.floor(Date.parse(iso) / 1000)

/** ไฟล์ขนาด `n` ไบต์พอดีที่ขึ้นต้นด้วยลายเซ็น PNG (ตรวจแค่ magic bytes เลยใช้ได้) */
const pngOfSize = (n: number): Buffer => Buffer.concat([PNG_SIGNATURE, Buffer.alloc(n - PNG_SIGNATURE.length)])

type T = TestApp<FakeAi>

async function adminClient(t: T): Promise<Client> {
  const c = t.client()
  await c.login()
  return c
}

async function createNovel(c: Client, body: Record<string, unknown> = {}): Promise<number> {
  const r = await c.post(NOVELS, { title: "Cover Test", published: true, ...body })
  assert.equal(r.status, 201, r.text)
  return r.json.id
}

const putCover = (c: Client, id: number | string, data: unknown) => c.put(`${NOVELS}/${id}/cover`, { data })

const cookieOf = (c: Client): string => [...c.cookies].map(([name, value]) => `${name}=${value}`).join("; ")

/** GET แบบไบนารี (Client เก็บแค่ข้อความ) · `cookie` ใส่ถ้าต้องการเป็นผู้ดูแล */
async function getBinary(t: { base: string }, path: string, o: { cookie?: string; method?: string } = {}) {
  const headers: Record<string, string> = {}
  if (o.cookie) headers.cookie = o.cookie
  const res = await fetch(t.base + path, { method: o.method ?? "GET", headers, redirect: "manual" })
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
}

/**
 * GET แบบมีเงื่อนไข (`If-None-Match`) ผ่าน node:http · `fetch` เปลี่ยนคำขอที่มีหัวเงื่อนไขเป็น `Cache-Control: no-cache`
 * ซึ่ง Express ถือว่าต้องส่งใหม่เสมอ จึงไม่มีทางได้ 304 (และ "ไม่ตรง → 200" จะผ่านทั้งที่ไม่ได้ทดสอบอะไร)
 */
const conditionalGet = (t: { port: number }, path: string, etag: string) => rawRequest({ port: t.port, path, headers: { "If-None-Match": etag } })

const parseJson = (b: Buffer): unknown => JSON.parse(b.toString("utf8"))

// ═════════════════════════ detectImage ═════════════════════════

test("detectImage: ไฟล์จริงของแต่ละชนิด (JPEG / PNG / WebP) ตรวจจากไบต์ ไม่ดูนามสกุลหรือ mime ที่ผู้ใช้บอก", () => {
  assert.equal(detectImage(bytesOf(JPEG_GREEN)), "image/jpeg")
  assert.equal(detectImage(bytesOf(PNG_RED)), "image/png")
  assert.equal(detectImage(bytesOf(WEBP_YELLOW)), "image/webp")
})

test("detectImage: ลายเซ็นขั้นต่ำก็พอ · WebP ไม่สนค่าขนาดใน RIFF (4 ไบต์กลาง)", () => {
  assert.equal(detectImage(JPEG_SIGNATURE), "image/jpeg")
  assert.equal(detectImage(PNG_SIGNATURE), "image/png")
  assert.equal(detectImage(WEBP_SIGNATURE), "image/webp")
  for (const size of [[0, 0, 0, 0], [0xff, 0xff, 0xff, 0xff], [1, 2, 3, 4]]) {
    assert.equal(detectImage(Buffer.concat([Buffer.from("RIFF"), Buffer.from(size), Buffer.from("WEBPVP8 ")])), "image/webp")
  }
})

test("detectImage: ผิดแค่ไบต์เดียวของลายเซ็นก็ไม่ผ่าน (ทุกตำแหน่งของทุกชนิด)", () => {
  const cases: [string, Buffer, number[]][] = [
    ["JPEG", JPEG_SIGNATURE, [0, 1, 2]],
    ["PNG", PNG_SIGNATURE, [0, 1, 2, 3, 4, 5, 6, 7]],
    ["WebP", WEBP_SIGNATURE, [0, 1, 2, 3, 8, 9, 10, 11]],
  ]
  for (const [name, signature, positions] of cases) {
    for (const at of positions) {
      const broken = Buffer.from(signature)
      broken[at] = broken[at]! ^ 0x01
      assert.equal(detectImage(broken), null, `${name}: ไบต์ที่ ${at} ผิดต้องไม่ผ่าน`)
    }
  }
})

test("detectImage: สั้นกว่าลายเซ็น (ทุกความยาวที่ตัดสั้น) หรือว่างเปล่า → null โดยไม่โยน error", () => {
  assert.equal(detectImage(Buffer.alloc(0)), null)
  for (const signature of [JPEG_SIGNATURE, PNG_SIGNATURE, WEBP_SIGNATURE]) {
    for (let n = 0; n < signature.length; n++) assert.equal(detectImage(signature.subarray(0, n)), null, `ตัดเหลือ ${n} ไบต์`)
  }
})

test("detectImage: ไฟล์ชนิดอื่นที่อาจแฝงสคริปต์หรือหน้าตาคล้ายกัน → null (GIF, SVG, HTML, PDF, BMP, TIFF, RIFF ที่ไม่ใช่ WebP, ZIP, ข้อความ)", () => {
  const others: Record<string, Buffer> = {
    gif87: Buffer.from("GIF87a\x01\x00\x01\x00"),
    gif89: Buffer.from("GIF89a\x01\x00\x01\x00"),
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    xmlSvg: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    html: Buffer.from("<!doctype html><script>alert(1)</script>"),
    pdf: Buffer.from("%PDF-1.7\n"),
    bmp: Buffer.from("BM\x36\x00\x00\x00\x00\x00"),
    tiff: Buffer.from("II*\x00\x08\x00\x00\x00"),
    wav: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt ")]),
    avi: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("AVI LIST")]),
    zip: Buffer.from("PK\x03\x04\x14\x00"),
    text: Buffer.from("hello world, this is not an image"),
    json: Buffer.from('{"image":true}'),
  }
  for (const [name, bytes] of Object.entries(others)) assert.equal(detectImage(bytes), null, name)
})

test("detectImage: ลายเซ็นต้องอยู่ที่ไบต์แรก — มี BOM, ช่องว่าง หรือขยะนำหน้าไม่ผ่าน", () => {
  for (const signature of [JPEG_SIGNATURE, PNG_SIGNATURE, WEBP_SIGNATURE]) {
    for (const prefix of [Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(" "), Buffer.from("\n"), Buffer.from("xx"), Buffer.from([0])]) {
      assert.equal(detectImage(Buffer.concat([prefix, signature, Buffer.alloc(16)])), null)
    }
  }
})

test("ขีดจำกัดขนาดปกคือ 500KB (500 × 1024 ไบต์)", () => {
  assert.equal(MAX_COVER_BYTES, 500 * 1024)
})

// ═════════════════════════ อัปโหลด + เปิดดูปก ═════════════════════════

test("PUT ปก PNG → 200 {coverV = เวลาแก้ปกเป็นวินาที epoch}; GET /covers/:id (ผู้อ่านทั่วไป) ได้ไบต์เดิม + หัวครบ", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)

    const put = await putCover(c, id, PNG_RED)
    assert.equal(put.status, 200)
    assert.deepEqual(put.json, { coverV: epoch("2026-10-22T01:02:03Z") })

    const dto = await c.get(`${NOVELS}/${id}`)
    assert.equal(dto.json.hasCover, true)
    assert.equal(dto.json.coverV, put.json.coverV)

    const res = await getBinary(t, `/covers/${id}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, bytesOf(PNG_RED))
    assert.equal(res.headers.get("content-type"), "image/png")
    assert.equal(res.headers.get("x-content-type-options"), "nosniff")
    assert.equal(res.headers.get("cache-control"), "public, max-age=604800")
    assert.equal(res.headers.get("content-length"), String(bytesOf(PNG_RED).length))
    assert.match(res.headers.get("etag") ?? "", /^(W\/)?"[^"]+"$/)

    // ตัวแปลง ?v= ไม่มีผลกับคำตอบ (ไว้ให้เบราว์เซอร์เห็นปกใหม่ทันที)
    const withV = await getBinary(t, `/covers/${id}?v=${put.json.coverV}`)
    assert.equal(withV.status, 200)
    assert.deepEqual(withV.body, bytesOf(PNG_RED))
  })
})

test("mime ที่ตอบมาจากการตรวจไบต์ของเซิร์ฟเวอร์ (JPEG / WebP) และไม่เชื่อฟิลด์ mime ที่ผู้ใช้ส่งมา", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)

    assert.equal((await putCover(c, id, JPEG_GREEN)).status, 200)
    const jpeg = await getBinary(t, `/covers/${id}`)
    assert.equal(jpeg.headers.get("content-type"), "image/jpeg")
    assert.deepEqual(jpeg.body, bytesOf(JPEG_GREEN))

    assert.equal((await putCover(c, id, WEBP_YELLOW)).status, 200)
    const webp = await getBinary(t, `/covers/${id}`)
    assert.equal(webp.headers.get("content-type"), "image/webp")
    assert.deepEqual(webp.body, bytesOf(WEBP_YELLOW))

    const sneaky = await c.put(`${NOVELS}/${id}/cover`, { data: PNG_RED, mime: "text/html", contentType: "text/html" })
    assert.equal(sneaky.status, 200)
    const png = await getBinary(t, `/covers/${id}`)
    assert.equal(png.headers.get("content-type"), "image/png")
    assert.equal(t.db.get<{ mime: string }>("SELECT mime FROM covers WHERE novel_id = ?", id)!.mime, "image/png")
  })
})

test("ETag: ส่ง If-None-Match ตรง → 304 ไม่มี body (คง ETag และ Cache-Control); ไม่ตรง → 200; รูปต่างกัน ETag ต่างกัน; รูปเดิมอัปโหลดซ้ำ ETag เดิม", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    await putCover(c, id, PNG_RED)

    const first = await getBinary(t, `/covers/${id}`)
    const etag = first.headers.get("etag")!
    assert.ok(etag)
    assert.equal((await getBinary(t, `/covers/${id}`)).headers.get("etag"), etag, "ETag คงที่ระหว่างคำขอ")

    const fresh = await conditionalGet(t, `/covers/${id}`, etag)
    assert.equal(fresh.status, 304)
    assert.equal(fresh.text, "")
    assert.equal(fresh.headers.etag, etag)
    assert.equal(fresh.headers["cache-control"], "public, max-age=604800")

    const stale = await conditionalGet(t, `/covers/${id}`, '"not-the-etag"')
    assert.equal(stale.status, 200)
    assert.equal(stale.headers["content-type"], "image/png")
    assert.equal(stale.headers["content-length"], String(bytesOf(PNG_RED).length))

    await putCover(c, id, PNG_BLUE)
    const changed = await conditionalGet(t, `/covers/${id}`, etag)
    assert.equal(changed.status, 200, "รูปเปลี่ยนแล้ว ETag เก่าต้องไม่ได้ 304")
    assert.notEqual(changed.headers.etag, etag)
    assert.deepEqual((await getBinary(t, `/covers/${id}`)).body, bytesOf(PNG_BLUE))

    await putCover(c, id, PNG_RED)
    assert.equal((await getBinary(t, `/covers/${id}`)).headers.get("etag"), etag, "รูปไบต์เดียวกันได้ ETag เดิม")
  })
})

test("HEAD /covers/:id → 200 พร้อมหัวเดียวกับ GET และไม่มี body", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    await putCover(c, id, PNG_RED)
    const res = await getBinary(t, `/covers/${id}`, { method: "HEAD" })
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 0)
    assert.equal(res.headers.get("content-type"), "image/png")
    assert.equal(res.headers.get("cache-control"), "public, max-age=604800")
  })
})

test("อัปโหลดปกใหม่: ไบต์เปลี่ยน, coverV เพิ่มตามเวลา (ที่ ?v= เปลี่ยน), updatedAt ของเรื่องขยับ; อัปโหลดสองครั้งในวินาทีเดียวกัน coverV เท่าเดิม", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    const before = (await c.get(`${NOVELS}/${id}`)).json
    assert.equal(before.updatedAt, "2026-10-22 01:02:03")

    clock.advance(5_000)
    const first = await putCover(c, id, PNG_RED)
    assert.equal(first.json.coverV, epoch("2026-10-22T01:02:08Z"))
    assert.equal((await c.get(`${NOVELS}/${id}`)).json.updatedAt, "2026-10-22 01:02:08")

    const sameSecond = await putCover(c, id, PNG_BLUE)
    assert.equal(sameSecond.json.coverV, first.json.coverV)
    assert.deepEqual((await getBinary(t, `/covers/${id}`)).body, bytesOf(PNG_BLUE))

    clock.advance(60_000)
    const later = await putCover(c, id, PNG_RED)
    assert.equal(later.json.coverV, first.json.coverV + 60)
    assert.deepEqual((await getBinary(t, `/covers/${id}`)).body, bytesOf(PNG_RED))
    const dto = (await c.get(`${NOVELS}/${id}`)).json
    assert.equal(dto.coverV, later.json.coverV)
    assert.equal(dto.updatedAt, "2026-10-22 01:03:08")
    assert.equal(t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers")!.n, 1, "แทนที่แถวเดิม ไม่เพิ่มแถว")
  })
})

// ═════════════════════════ ปฏิเสธไฟล์ที่ไม่ใช่รูป / ใหญ่เกิน ═════════════════════════

test("อัปโหลดสิ่งที่ไม่ใช่ JPEG/PNG/WebP → 400 invalid_image ข้อความไทย ไม่เขียนอะไร และปกเดิมไม่ถูกแตะ", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    await putCover(c, id, PNG_RED)
    const stored = () => t.db.get<{ mime: string; data: Uint8Array; updated_at: string }>("SELECT mime, data, updated_at FROM covers WHERE novel_id = ?", id)!
    const original = stored()
    const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64")

    const bad: Record<string, string> = {
      "ข้อความธรรมดา": b64("hello world"),
      "ว่างเปล่า": "",
      "ไม่ใช่ base64": "!!!!",
      gif: b64("GIF89a\x01\x00\x01\x00"),
      svg: b64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      html: b64("<!doctype html><script>alert(1)</script>"),
      pdf: b64("%PDF-1.7\n"),
      "PNG ตัดสั้น": b64(PNG_SIGNATURE.subarray(0, 7)),
      "data URL": `data:image/png;base64,${PNG_RED}`,
    }
    for (const [name, data] of Object.entries(bad)) {
      const r = await putCover(c, id, data)
      assert.equal(r.status, 400, name)
      assert.equal(r.json.code, "invalid_image", name)
      assert.match(r.json.error, THAI, name)
      for (const kind of ["JPEG", "PNG", "WebP"]) assert.ok(r.json.error.includes(kind), `${name}: ข้อความต้องบอกชนิดที่รับ`)
    }
    const after = stored()
    assert.equal(after.mime, original.mime)
    assert.deepEqual(after.data, original.data)
    assert.equal(after.updated_at, original.updated_at)
  })
})

test("ไม่มีปกอยู่เดิม: อัปโหลดไฟล์ผิดแล้วไม่มีแถวใน covers และ GET → 404", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    const r = await putCover(c, id, Buffer.from("not an image").toString("base64"))
    assert.equal(r.status, 400)
    assert.equal(t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers")!.n, 0)
    assert.equal((await getBinary(t, `/covers/${id}`)).status, 404)
    assert.equal((await c.get(`${NOVELS}/${id}`)).json.hasCover, false)
  })
})

test("body ผิดรูป: ไม่มี data / data ไม่ใช่ข้อความ / body ไม่ใช่ออบเจ็กต์ / ไม่มี body → 400 และไม่เขียนอะไร", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    const path = `${NOVELS}/${id}/cover`
    for (const body of [{}, { data: 123 }, { data: null }, { data: ["x"] }, { data: { a: 1 } }, { picture: PNG_RED }]) {
      const r = await c.put(path, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, "invalid_field", JSON.stringify(body))
      assert.match(r.json.error, THAI)
      assert.ok(r.json.error.includes("data"), "ข้อความระบุชื่อฟิลด์ data")
    }
    for (const body of [[], [PNG_RED]]) {
      const r = await c.put(path, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, "bad_request")
    }
    // JSON ที่ไม่ใช่ออบเจ็กต์/อาร์เรย์ ตัวอ่าน JSON (โหมดเข้มงวด) ปฏิเสธเองก่อนถึงเส้นทางนี้
    for (const body of ["x", 5, null]) {
      const r = await c.put(path, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.json.code, "bad_json")
    }
    const none = await c.put(path)
    assert.equal(none.status, 400)
    assert.equal(none.json.code, "bad_request")
    assert.equal(t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers")!.n, 0)
  })
})

test("ขนาด: 500KB พอดีผ่าน, เกิน 1 ไบต์ → 413 cover_too_large (ปกเดิมอยู่ครบ); ไฟล์ใหญ่ที่ไม่ใช่รูปก็ได้ 413 (ตรวจขนาดก่อนชนิด)", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    await putCover(c, id, PNG_RED)

    const tooBig = await putCover(c, id, pngOfSize(MAX_COVER_BYTES + 1).toString("base64"))
    assert.equal(tooBig.status, 413)
    assert.equal(tooBig.json.code, "cover_too_large")
    assert.match(tooBig.json.error, THAI)
    assert.ok(tooBig.json.error.includes("500KB"))
    assert.deepEqual((await getBinary(t, `/covers/${id}`)).body, bytesOf(PNG_RED), "ปกเดิมไม่ถูกแตะ")

    const bigGarbage = await putCover(c, id, Buffer.alloc(MAX_COVER_BYTES + 1, 0x41).toString("base64"))
    assert.equal(bigGarbage.status, 413)
    assert.equal(bigGarbage.json.code, "cover_too_large")

    const exact = pngOfSize(MAX_COVER_BYTES)
    const ok = await putCover(c, id, exact.toString("base64"))
    assert.equal(ok.status, 200)
    const served = await getBinary(t, `/covers/${id}`)
    assert.equal(served.status, 200)
    assert.equal(served.body.length, MAX_COVER_BYTES)
    assert.ok(served.body.equals(exact))
  })
})

// ═════════════════════════ ลบปก ═════════════════════════

test("DELETE ปก → 200 {ok:true}: GET /covers → 404, hasCover=false/coverV=0, updatedAt ขยับ; ลบซ้ำ 200 โดยไม่ขยับ updatedAt", async () => {
  const clock = createClock("2026-10-22T01:02:03Z")
  await withTestApp({ now: clock.now }, async (t) => {
    const c = await adminClient(t)
    const id = await createNovel(c)
    await putCover(c, id, PNG_RED)
    clock.advance(10_000)

    const del = await c.delete(`${NOVELS}/${id}/cover`)
    assert.equal(del.status, 200)
    assert.deepEqual(del.json, { ok: true })
    assert.equal((await getBinary(t, `/covers/${id}`)).status, 404)
    assert.equal((await getBinary(t, `/covers/${id}`, { cookie: cookieOf(c) })).status, 404, "ผู้ดูแลก็ไม่เห็นปกที่ลบแล้ว")
    const dto = (await c.get(`${NOVELS}/${id}`)).json
    assert.equal(dto.hasCover, false)
    assert.equal(dto.coverV, 0)
    assert.equal(dto.updatedAt, "2026-10-22 01:02:13")
    assert.equal(t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers")!.n, 0)

    clock.advance(10_000)
    const again = await c.delete(`${NOVELS}/${id}/cover`)
    assert.equal(again.status, 200)
    assert.deepEqual(again.json, { ok: true })
    assert.equal((await c.get(`${NOVELS}/${id}`)).json.updatedAt, "2026-10-22 01:02:13", "ไม่มีอะไรให้ลบ → ไม่ขยับ updatedAt")
    // เรื่องยังอยู่
    assert.equal((await c.get(`${NOVELS}/${id}`)).status, 200)
  })
})

test("ลบปกของเรื่องหนึ่งไม่กระทบปกของอีกเรื่อง", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const a = await createNovel(c, { title: "A" })
    const b = await createNovel(c, { title: "B" })
    await putCover(c, a, PNG_RED)
    await putCover(c, b, PNG_BLUE)
    assert.equal((await c.delete(`${NOVELS}/${a}/cover`)).status, 200)
    assert.equal((await getBinary(t, `/covers/${a}`)).status, 404)
    assert.deepEqual((await getBinary(t, `/covers/${b}`)).body, bytesOf(PNG_BLUE))
  })
})

// ═════════════════════════ เรื่องที่ไม่มีอยู่ / รหัสผิดรูป ═════════════════════════

test("ไม่มีเรื่องนั้น: PUT/DELETE ปก → 404 (ตรวจเรื่องก่อนตรวจ body) และรหัสผิดรูปในพาธ → 404", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    for (const r of [await putCover(c, 999, PNG_RED), await putCover(c, 999, "ไม่ใช่รูป"), await c.put(`${NOVELS}/999/cover`, [1]), await c.delete(`${NOVELS}/999/cover`)]) {
      assert.equal(r.status, 404)
      assert.equal(r.json.code, "not_found")
      assert.match(r.json.error, THAI)
    }
    for (const bad of ["abc", "0", "-1", "1.5", "007", "99999999999999999999"]) {
      assert.equal((await putCover(c, bad, PNG_RED)).status, 404, bad)
      assert.equal((await c.delete(`${NOVELS}/${bad}/cover`)).status, 404, bad)
    }
    assert.equal(t.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM covers")!.n, 0)
  })
})

test("GET /covers/:id: ไม่มีปก / ไม่มีเรื่อง / รหัสผิดรูป → 404 JSON ไทย", async () => {
  await withTestApp({}, async (t) => {
    const id = seedNovel(t.db, { published: true }) // เรื่องที่เผยแพร่แล้วแต่ไม่มีปก
    for (const path of [`/covers/${id}`, "/covers/999", "/covers/abc", "/covers/0", "/covers/-1", "/covers/1.5", "/covers/007", "/covers/99999999999999999999"]) {
      const res = await getBinary(t, path)
      assert.equal(res.status, 404, path)
      const body = parseJson(res.body) as { error: string; code: string }
      assert.equal(body.code, "not_found", path)
      assert.match(body.error, THAI, path)
    }
  })
})

test("GET /covers/:id รับเฉพาะรหัสรูปแบบมาตรฐาน: 01, 1.0, 1e0, +1, มีช่องว่าง/ตัวอักษรต่อท้าย ไม่ใช่ปกของเรื่อง 1", async () => {
  await withTestApp({}, async (t) => {
    const id = seedNovel(t.db, { published: true })
    t.db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', ?, '2026-01-01 00:00:00')", id, bytesOf(PNG_RED))
    assert.equal((await getBinary(t, `/covers/${id}`)).status, 200)
    for (const odd of [`0${id}`, `${id}.0`, `${id}e0`, `+${id}`, `%20${id}`, `${id}%20`, `${id}abc`]) {
      assert.equal((await getBinary(t, `/covers/${odd}`)).status, 404, odd)
    }
  })
})

// ═════════════════════════ เรื่องที่ซ่อน ═════════════════════════

test("เรื่องที่ซ่อน: ผู้อ่านทั่วไป 404 (เหมือน 'ไม่มีปก' ทุกประการ), ผู้ดูแลได้ 200 + Cache-Control: private, no-store; เผยแพร่แล้วทุกคนเห็น", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const hidden = await createNovel(c, { title: "Hidden", published: false })
    await putCover(c, hidden, PNG_RED)
    const noCover = await createNovel(c, { title: "No cover", published: true })

    const publicRes = await getBinary(t, `/covers/${hidden}`)
    assert.equal(publicRes.status, 404)
    // ตอบเหมือนกันทุกตัวอักษรกับเรื่องที่ไม่มีปก/ไม่มีเรื่อง — ผู้อ่านเดาไม่ได้ว่ามีเรื่องซ่อนอยู่
    for (const path of [`/covers/${noCover}`, "/covers/9999", "/covers/abc", "/covers/0"]) {
      const other = await getBinary(t, path)
      assert.equal(other.status, 404)
      assert.deepEqual(parseJson(other.body), parseJson(publicRes.body))
    }

    const admin = await getBinary(t, `/covers/${hidden}`, { cookie: cookieOf(c) })
    assert.equal(admin.status, 200)
    assert.deepEqual(admin.body, bytesOf(PNG_RED))
    assert.equal(admin.headers.get("content-type"), "image/png")
    assert.equal(admin.headers.get("cache-control"), "private, no-store")
    assert.equal(admin.headers.get("x-content-type-options"), "nosniff")

    // เผยแพร่แล้ว → ผู้อ่านทั่วไปเห็น และได้ cache สาธารณะ; ผู้ดูแลก็ได้หัวสาธารณะเหมือนกัน (ไม่ใช่ร่างอีกแล้ว)
    assert.equal((await c.patch(`${NOVELS}/${hidden}`, { published: true })).status, 200)
    const nowPublic = await getBinary(t, `/covers/${hidden}`)
    assert.equal(nowPublic.status, 200)
    assert.equal(nowPublic.headers.get("cache-control"), "public, max-age=604800")
    const adminPublic = await getBinary(t, `/covers/${hidden}`, { cookie: cookieOf(c) })
    assert.equal(adminPublic.headers.get("cache-control"), "public, max-age=604800")

    // ซ่อนอีกครั้ง → ผู้อ่านทั่วไปกลับไป 404
    assert.equal((await c.patch(`${NOVELS}/${hidden}`, { published: false })).status, 200)
    assert.equal((await getBinary(t, `/covers/${hidden}`)).status, 404)
  })
})

test("เรื่องที่ซ่อน: cookie ที่ไม่ใช่ของผู้ดูแล (ปลอม/เสีย) ไม่ได้สิทธิ์", async () => {
  await withTestApp({}, async (t) => {
    const c = await adminClient(t)
    const hidden = await createNovel(c, { published: false })
    await putCover(c, hidden, PNG_RED)
    const [name] = [...c.cookies.keys()]
    for (const cookie of [`${name}=garbage`, `${name}=`, "other=1", `${name}=${c.cookies.get(name)}x`]) {
      assert.equal((await getBinary(t, `/covers/${hidden}`, { cookie })).status, 404, cookie)
    }
    assert.equal((await getBinary(t, `/covers/${hidden}`, { cookie: cookieOf(c) })).status, 200)
  })
})

test("โหมดไม่มีรหัสผ่าน: เรื่องที่ซ่อนเห็นได้จากเครื่องนี้ (Host เป็น loopback) แต่ Host อื่นที่ชี้มาเครื่องนี้ได้ 404", async () => {
  const t = await startTestApp({ config: { adminPassword: null } })
  try {
    const c = t.client()
    const hidden = await createNovel(c, { published: false })
    assert.equal((await putCover(c, hidden, PNG_RED)).status, 200)

    const local = await getBinary(t, `/covers/${hidden}`)
    assert.equal(local.status, 200)
    assert.equal(local.headers.get("cache-control"), "private, no-store")

    const rebinding = await rawRequest({ port: t.port, path: `/covers/${hidden}`, headers: { Host: "evil.test" } })
    assert.equal(rebinding.status, 404)
  } finally {
    await t.close()
  }
})

// ═════════════════════════ ตัว router เองปลอดภัยโดยไม่พึ่ง middleware รวม ═════════════════════════

test("createCoversRouter ตั้ง Content-Type, nosniff และ Cache-Control เอง (ไม่พึ่งหัวรวมของแอป) และซ่อนปกเรื่องที่ซ่อนจากคนทั่วไป", async () => {
  await withTestApp({}, async (t) => {
    const deps: AppDeps = {
      config: t.config,
      db: t.db,
      settings: t.settings,
      ai: t.ai,
      queue: t.queue,
      views: createViews({ db: t.db, now: () => new Date() }),
      now: () => new Date(),
      log: memoryLogger().logger,
    }
    const bare = express()
    bare.use("/covers", createCoversRouter(deps))
    // ตัวจัดการ error แบบเรียบๆ แทน errorHandler ของแอป (กันตัวจัดการเริ่มต้นของ Express พิมพ์ stack ลงหน้าจอเทสต์)
    bare.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => void res.status(err.status ?? 500).end())
    const shown = seedNovel(t.db, { published: true })
    const hidden = seedNovel(t.db, { published: false })
    for (const id of [shown, hidden]) {
      t.db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/jpeg', ?, '2026-01-01 00:00:00')", id, bytesOf(JPEG_GREEN))
    }
    await withServer(bare, async ({ base }) => {
      const res = await getBinary({ base }, `/covers/${shown}`)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get("x-content-type-options"), "nosniff")
      assert.equal(res.headers.get("content-type"), "image/jpeg")
      assert.equal(res.headers.get("cache-control"), "public, max-age=604800")
      assert.deepEqual(res.body, bytesOf(JPEG_GREEN))
      assert.equal((await getBinary({ base }, `/covers/${hidden}`)).status, 404)
    })
  })
})
