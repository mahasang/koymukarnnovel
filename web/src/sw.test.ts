/**
 * `public/sw.js` — service worker ของเว็บ รันในเทสต์ด้วย `vm` กับ `self` / `caches` / `fetch` ปลอม
 * (เซิร์ฟเวอร์แทนที่ `__BUILD_ID__` ด้วยแฮชของ index.html ก่อนส่ง จึงแทนด้วยค่าตรงๆ ที่นี่เหมือนกัน)
 *
 * นโยบาย: เฉพาะ GET ที่ origin เดียวกัน · `/api/admin` `/admin` `/covers` (และ /api อื่นที่ไม่ใช่ /api/public) ไม่ผ่าน SW เลย ·
 * `/assets/*` cache-first · หน้านำทาง / `/api/public/*` / ไฟล์อื่น network-first ตกไปที่แคชเมื่อออฟไลน์ (หน้านำทางที่ไม่เคยแคชตกไปที่ `/`) ·
 * ไม่แคชคำตอบที่ไม่ ok หรือ Cache-Control มี no-store / private · `activate` ลบแคชชื่ออื่นทั้งหมด
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { describe, test } from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(here, "..", "public", "sw.js"), "utf8")
const ORIGIN = "https://reader.test"

class FakeResponse {
  readonly ok: boolean
  readonly headers: { get(name: string): string | null }
  /** ถ้าเป็นสำเนาจาก `clone()` จะชี้กลับไปที่ต้นฉบับ */
  cloneOf: FakeResponse | null = null
  constructor(
    readonly tag: string,
    readonly status = 200,
    private readonly source: Record<string, string> = {},
  ) {
    this.ok = status >= 200 && status < 300
    const lower = new Map(Object.entries(source).map(([name, value]) => [name.toLowerCase(), value]))
    this.headers = { get: (name) => lower.get(name.toLowerCase()) ?? null }
  }
  clone(): FakeResponse {
    const copy = new FakeResponse(this.tag, this.status, this.source)
    copy.cloneOf = this
    return copy
  }
}

interface FakeRequest {
  url: string
  method: string
  mode: string
}
interface FakeEvent {
  request?: FakeRequest
  respondWith?(value: unknown): void
  waitUntil(value: unknown): void
}

/** ผลของคำขอหนึ่งครั้ง: `handled` = SW เรียก respondWith ทันทีระหว่างที่ตัวจัดการทำงาน (บังคับของเบราว์เซอร์: ห้ามเรียกทีหลัง) */
interface Outcome {
  handled: boolean
  respondCalls: number
  response?: FakeResponse
  error?: unknown
  /** งานที่ SW ส่งให้ `waitUntil` ล้มเหลวกี่งาน */
  failedWaits: number
}

function boot(buildId = "t1") {
  const listeners = new Map<string, (event: FakeEvent) => void>()
  const stores = new Map<string, Map<string, FakeResponse>>()
  const state = { online: true, fetches: [] as string[], putFails: false, skipWaiting: 0, claim: 0, matches: [] as Array<{ ignoreVary?: boolean } | undefined> }
  const routes = new Map<string, FakeResponse>()

  const absolute = (input: string | { url: string }) => new URL(typeof input === "string" ? input : input.url, ORIGIN + "/").href
  const caches = {
    async open(name: string) {
      let store = stores.get(name)
      if (store === undefined) {
        store = new Map()
        stores.set(name, store)
      }
      const mine = store
      return {
        async match(request: string | { url: string }, options?: { ignoreVary?: boolean }) {
          state.matches.push(options)
          return mine.get(absolute(request))
        },
        async put(request: string | { url: string }, response: FakeResponse) {
          if (state.putFails) throw new Error("quota exceeded")
          mine.set(absolute(request), response)
        },
      }
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }
  const fetch = async (request: string | { url: string }) => {
    const url = absolute(request)
    state.fetches.push(url)
    if (!state.online) throw new TypeError("Failed to fetch")
    return routes.get(url) ?? new FakeResponse(`404:${url}`, 404)
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => void listeners.set(type, listener),
    skipWaiting: () => {
      state.skipWaiting++
      return Promise.resolve()
    },
    clients: {
      claim: () => {
        state.claim++
        return Promise.resolve()
      },
    },
  }
  vm.runInContext(SOURCE.replaceAll("__BUILD_ID__", buildId), vm.createContext({ self, caches, fetch, URL, console }), { filename: "sw.js" })

  const cacheName = `koymukarnnovel-${buildId}`
  const serve = (url: string, response: FakeResponse) => void routes.set(absolute(url), response)

  async function send(url: string, init: { method?: string; mode?: string; origin?: string } = {}): Promise<Outcome> {
    const request: FakeRequest = { url: new URL(url, init.origin ?? ORIGIN).href, method: init.method ?? "GET", mode: init.mode ?? "cors" }
    let responded: Promise<FakeResponse> | undefined
    let respondCalls = 0
    const waits: Promise<unknown>[] = []
    const listener = listeners.get("fetch")
    assert.ok(listener, "sw.js ต้องฟัง fetch")
    listener({
      request,
      respondWith(value) {
        respondCalls++
        responded = Promise.resolve(value) as Promise<FakeResponse>
      },
      waitUntil(value) {
        waits.push(Promise.resolve(value))
      },
    })
    const outcome: Outcome = { handled: responded !== undefined, respondCalls, failedWaits: 0 }
    if (responded !== undefined) {
      try {
        outcome.response = await responded
      } catch (error) {
        outcome.error = error
      }
    }
    outcome.failedWaits = (await Promise.allSettled(waits)).filter((r) => r.status === "rejected").length
    return outcome
  }
  const nav = (url: string) => send(url, { mode: "navigate" })

  /** ส่งเหตุการณ์ lifecycle (install / activate) แล้วรอให้งานใน `waitUntil` เสร็จ */
  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = []
    const listener = listeners.get(type)
    assert.ok(listener, `sw.js ต้องฟัง ${type}`)
    listener({ waitUntil: (value) => void waits.push(Promise.resolve(value)) })
    await Promise.all(waits)
  }

  const cached = (url: string, name = cacheName) => stores.get(name)?.get(absolute(url))
  return { send, nav, lifecycle, serve, state, stores, cached, cacheName, listeners }
}

const page = (tag: string, headers: Record<string, string> = {}) => new FakeResponse(tag, 200, headers)

describe("sw.js: รุ่นของ build และวงจรชีวิต", () => {
  test("ไฟล์ต้นทางมีตัวยึด __BUILD_ID__ ให้เซิร์ฟเวอร์แทนค่า · ชื่อแคชคือ koymukarnnovel-<รุ่น> ตามรุ่นที่แทน", async () => {
    assert.ok(SOURCE.includes("__BUILD_ID__"))
    for (const id of ["t1", "ab12cd34ef56"]) {
      const sw = boot(id)
      sw.serve("/assets/a.js", page("js"))
      await sw.send("/assets/a.js")
      assert.deepEqual([...sw.stores.keys()], [`koymukarnnovel-${id}`])
    }
  })

  test("install: เรียก skipWaiting ครั้งเดียว (เวอร์ชันใหม่เริ่มทำงานทันที ไม่รอปิดแท็บเก่า)", async () => {
    const sw = boot()
    await sw.lifecycle("install")
    assert.equal(sw.state.skipWaiting, 1)
    assert.equal(sw.state.claim, 0)
  })

  test("activate: ลบแคชชื่ออื่นทั้งหมด (รุ่นเก่า ชื่อรุ่นก่อนหน้า ชื่อแปลกปลอม) เก็บ koymukarnnovel-t1 พร้อมของข้างใน แล้วยึดแท็บที่เปิดอยู่ (clients.claim)", async () => {
    const sw = boot("t1")
    const keep = page("keep")
    for (const name of ["koymukarnnovel-t0", "koymukarnnovel-shell-v1", "other", "koymukarnnovel-t1", "koymukarnnovel-t10"]) sw.stores.set(name, new Map([[`${ORIGIN}/x`, keep]]))
    await sw.lifecycle("activate")
    assert.deepEqual([...sw.stores.keys()], ["koymukarnnovel-t1"])
    assert.equal(sw.cached("/x"), keep)
    assert.equal(sw.state.claim, 1)
  })
})

describe("sw.js: คำขอที่ SW ไม่แตะ (ไม่เรียก respondWith และไม่เรียก fetch เอง)", () => {
  test("ไม่ใช่ GET (POST PUT DELETE HEAD OPTIONS) → เมิน", async () => {
    const sw = boot()
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      for (const url of ["/api/public/novels", "/assets/a.js", "/novel/1"]) {
        const r = await sw.send(url, { method })
        assert.equal(r.handled, false, `${method} ${url}`)
      }
    }
    assert.deepEqual(sw.state.fetches, [])
  })

  test("ข้าม origin → เมิน (รูปปก/ฟอนต์จากที่อื่น, API ของคนอื่น)", async () => {
    const sw = boot()
    for (const url of ["https://other.test/assets/a.js", "https://other.test/api/public/novels", "http://reader.test/assets/a.js", "https://reader.test:8443/assets/a.js"]) {
      assert.equal((await sw.send(url)).handled, false, url)
      assert.equal((await sw.nav(url)).handled, false, url)
    }
    assert.deepEqual(sw.state.fetches, [])
  })

  test("/api/admin · /admin · /covers และ /api อื่นที่ไม่ใช่ /api/public (เช่น /api/import) ไม่ผ่าน SW เลย ทั้งคำขอปกติและการนำทาง · มี query ก็เหมือนกัน", async () => {
    const sw = boot()
    const paths = [
      "/api/admin/me",
      "/api/admin",
      "/api/admin/novels?x=1",
      "/admin",
      "/admin/",
      "/admin/novels",
      "/admin/novels/3/chapters?page=2",
      "/covers",
      "/covers/1",
      "/covers/12?v=3",
      "/api/import",
      "/api/health",
      "/api/publicity",
      "/api/public",
    ]
    for (const url of paths) {
      assert.equal((await sw.send(url)).handled, false, url)
      assert.equal((await sw.nav(url)).handled, false, url)
    }
    assert.deepEqual(sw.state.fetches, [])
    assert.deepEqual([...sw.stores.keys()], [])
  })

  test("/assets เป็นทั้งท่อนพาธเช่นกัน: /assets-old/a.js และ /assetsx ไม่ใช่ไฟล์ที่มีแฮช → network-first (ได้ของใหม่เสมอ ไม่ติดแคชเก่า)", async () => {
    const sw = boot()
    for (const url of ["/assets-old/a.js", "/assetsx"]) {
      sw.serve(url, page("v1"))
      assert.equal((await sw.send(url)).response?.tag, "v1")
      sw.serve(url, page("v2"))
      assert.equal((await sw.send(url)).response?.tag, "v2", url)
    }
  })

  test("ขอบเขตเป็นทั้งท่อนพาธ: /administrator /admin-guide /covers-list ไม่ใช่หลังบ้าน/ปก → ผ่าน SW ตามปกติ", async () => {
    const sw = boot()
    for (const url of ["/administrator", "/admin-guide", "/covers-list", "/adminx/y", "/apiary", "/api-docs"]) assert.equal((await sw.nav(url)).handled, true, url)
  })
})

describe("sw.js: /assets/* cache-first", () => {
  test("ครั้งแรกเรียก fetch แล้วแคชสำเนา · ครั้งสองมาจากแคชโดยไม่เรียก fetch (แม้เครือข่ายมีของใหม่หรือออฟไลน์)", async () => {
    const sw = boot()
    const first = page("js-v1", { "Cache-Control": "public, max-age=31536000, immutable" })
    sw.serve("/assets/a.js", first)
    const a = await sw.send("/assets/a.js")
    assert.equal(a.handled, true)
    assert.equal(a.respondCalls, 1)
    assert.equal(a.response, first, "ครั้งแรกตอบด้วยของจากเครือข่าย")
    assert.deepEqual(sw.state.fetches, [`${ORIGIN}/assets/a.js`])
    const stored = sw.cached("/assets/a.js")
    assert.equal(stored?.tag, "js-v1")
    assert.notEqual(stored, first, "แคชเก็บสำเนา (clone) ไม่ใช่ตัวที่ส่งให้หน้า — body อ่านได้ครั้งเดียว")
    assert.equal(stored?.cloneOf, first)

    sw.serve("/assets/a.js", page("js-v2"))
    const b = await sw.send("/assets/a.js")
    assert.equal(b.response?.tag, "js-v1")
    sw.state.online = false
    const c = await sw.send("/assets/a.js")
    assert.equal(c.response?.tag, "js-v1")
    assert.equal(sw.state.fetches.length, 1, "ไม่เรียก fetch อีกเลย")
  })

  test("คนละที่อยู่ = คนละรายการ (รวมพารามิเตอร์) · ไฟล์ที่ไม่เคยแคชและออฟไลน์ → ล้มด้วยข้อผิดพลาดเครือข่าย (ไม่ตอบหน้า / แทน)", async () => {
    const sw = boot()
    sw.serve("/", page("home"))
    await sw.nav("/")
    sw.serve("/assets/a.js", page("a"))
    sw.serve("/assets/b.js", page("b"))
    assert.equal((await sw.send("/assets/a.js")).response?.tag, "a")
    assert.equal((await sw.send("/assets/b.js")).response?.tag, "b")
    sw.state.online = false
    assert.equal((await sw.send("/assets/b.js")).response?.tag, "b")
    const miss = await sw.send("/assets/c.js")
    assert.equal(miss.handled, true)
    assert.ok(miss.error instanceof TypeError)
    assert.equal(miss.response, undefined)
  })

  test("คำตอบที่ไม่ ok (404/500) หรือ no-store / private ไม่ถูกแคช · หน้าได้คำตอบนั้นตามจริง · ครั้งต่อไปถามเครือข่ายใหม่", async () => {
    const sw = boot()
    const cases: Array<[string, FakeResponse]> = [
      ["/assets/missing.js", new FakeResponse("404", 404)],
      ["/assets/boom.js", new FakeResponse("500", 500)],
      ["/assets/nostore.js", page("ns", { "Cache-Control": "no-store" })],
      ["/assets/private.js", page("pv", { "Cache-Control": "private, max-age=60" })],
    ]
    for (const [url, response] of cases) {
      sw.serve(url, response)
      const r = await sw.send(url)
      assert.equal(r.response, response, url)
      assert.equal(sw.cached(url), undefined, url)
      await sw.send(url)
    }
    assert.equal(sw.state.fetches.length, cases.length * 2)
  })
})

describe("sw.js: network-first (หน้านำทาง · /api/public/* · ไฟล์อื่น)", () => {
  test("หน้านำทางออนไลน์: ได้ของจากเครือข่ายเสมอ (แม้มีแคชเก่า) แล้วเก็บสำเนาล่าสุดไว้", async () => {
    const sw = boot()
    const v1 = page("novel-v1")
    sw.serve("/novel/1", v1)
    const a = await sw.nav("/novel/1")
    assert.equal(a.handled, true)
    assert.equal(a.respondCalls, 1)
    assert.equal(a.response, v1)
    assert.equal(sw.cached("/novel/1")?.cloneOf, v1)

    const v2 = page("novel-v2")
    sw.serve("/novel/1", v2)
    const b = await sw.nav("/novel/1")
    assert.equal(b.response, v2)
    assert.equal(sw.cached("/novel/1")?.tag, "novel-v2")
    assert.equal(sw.state.fetches.length, 2)
  })

  test("หน้านำทางออฟไลน์: ได้จากแคชของหน้านั้น (ไม่ใช่หน้า /)", async () => {
    const sw = boot()
    sw.serve("/", page("home"))
    sw.serve("/novel/1/3", page("chapter-3"))
    await sw.nav("/")
    await sw.nav("/novel/1/3")
    sw.state.online = false
    assert.equal((await sw.nav("/novel/1/3")).response?.tag, "chapter-3")
    assert.equal((await sw.nav("/")).response?.tag, "home")
  })

  test("หน้านำทางที่ไม่เคยแคช + ออฟไลน์ → ได้หน้า / ที่แคชไว้ (ลึกแค่ไหนหรือมี query ก็เหมือนกัน)", async () => {
    const sw = boot()
    sw.serve("/", page("home"))
    await sw.nav("/")
    sw.state.online = false
    for (const url of ["/novel/9", "/novel/9/9", "/about", "/?q=abc", "/nope/x/y"]) {
      const r = await sw.nav(url)
      assert.equal(r.response?.tag, "home", url)
      assert.equal(r.error, undefined, url)
    }
  })

  test("ออฟไลน์ ไม่เคยแคชทั้งหน้านั้นและหน้า / → ล้มด้วยข้อผิดพลาดเครือข่าย (เบราว์เซอร์แสดงหน้าออฟไลน์ของมันเอง)", async () => {
    const sw = boot()
    sw.state.online = false
    const r = await sw.nav("/novel/9")
    assert.equal(r.handled, true)
    assert.ok(r.error instanceof TypeError)
    assert.equal(r.response, undefined)
  })

  test("/api/public/*: ออนไลน์ได้เครือข่ายแล้วแคช · ออฟไลน์ได้จากแคช · ไม่เคยแคชและออฟไลน์ → ล้ม (ห้ามได้หน้า / เป็น JSON แทน แม้หน้า / อยู่ในแคช)", async () => {
    const sw = boot()
    sw.serve("/", page("home"))
    await sw.nav("/")
    const list = page("novels-json", { "Cache-Control": "no-cache", ETag: 'W/"1"' })
    sw.serve("/api/public/novels?page=2", list)
    const online = await sw.send("/api/public/novels?page=2")
    assert.equal(online.response, list)
    assert.equal(sw.cached("/api/public/novels?page=2")?.cloneOf, list)
    sw.state.online = false
    assert.equal((await sw.send("/api/public/novels?page=2")).response?.tag, "novels-json")
    const miss = await sw.send("/api/public/novels?page=3")
    assert.ok(miss.error instanceof TypeError)
    assert.equal(miss.response, undefined)
  })

  test("ไฟล์อื่น (ไอคอน manifest) ก็ network-first: ออนไลน์ได้ของใหม่ ออฟไลน์ได้จากแคช", async () => {
    const sw = boot()
    sw.serve("/manifest.webmanifest", page("m1"))
    assert.equal((await sw.send("/manifest.webmanifest")).response?.tag, "m1")
    sw.serve("/manifest.webmanifest", page("m2"))
    assert.equal((await sw.send("/manifest.webmanifest")).response?.tag, "m2")
    sw.state.online = false
    assert.equal((await sw.send("/manifest.webmanifest")).response?.tag, "m2")
    assert.equal((await sw.send("/icon.svg")).error instanceof TypeError, true)
  })

  test("Cache-Control: no-store / private (ทุกตัวพิมพ์ ทุกตำแหน่งในรายการ) ไม่ถูกแคช · no-cache, max-age, must-revalidate, immutable, ไม่มีหัว ถูกแคชตามปกติ", async () => {
    const sw = boot()
    const notCached = ["private, no-store", "no-store", "private", "PRIVATE, max-age=60", "public, No-Store", "max-age=0,  private ,must-revalidate", "no-cache, no-store, must-revalidate", 'private="X-User", max-age=5']
    const cached = ["no-cache", "public, max-age=0, must-revalidate", "max-age=60", "public, max-age=31536000, immutable", "s-maxage=10", ""]
    let i = 0
    for (const value of notCached) {
      const url = `/api/public/no-${i++}`
      sw.serve(url, page("secret", value === "" ? {} : { "Cache-Control": value }))
      const r = await sw.send(url)
      assert.equal(r.response?.tag, "secret", value)
      assert.equal(sw.cached(url), undefined, `ต้องไม่แคช: ${value}`)
    }
    for (const value of cached) {
      const url = `/api/public/yes-${i++}`
      sw.serve(url, page("ok", value === "" ? {} : { "Cache-Control": value }))
      await sw.send(url)
      assert.equal(sw.cached(url)?.tag, "ok", `ต้องแคช: ${JSON.stringify(value)}`)
    }
    // หน้านำทางของผู้ดูแล (หน้าร่าง) ก็ไม่ถูกแคช
    sw.serve("/novel/5", page("draft", { "Cache-Control": "private, no-store" }))
    await sw.nav("/novel/5")
    assert.equal(sw.cached("/novel/5"), undefined)
  })

  test("คำตอบที่ไม่ ok จากเครือข่าย (404 ของหน้าที่ไม่มี, 500) ส่งต่อให้หน้าตามจริง ไม่เขียนทับแคชดีๆ ที่มีอยู่ และไม่ถูกใช้แทนตอนออฟไลน์", async () => {
    const sw = boot()
    sw.serve("/api/public/novels/1", page("good"))
    await sw.send("/api/public/novels/1")
    const broken = new FakeResponse("boom", 500)
    sw.serve("/api/public/novels/1", broken)
    assert.equal((await sw.send("/api/public/novels/1")).response, broken)
    assert.equal(sw.cached("/api/public/novels/1")?.tag, "good")

    const missing = new FakeResponse("nope", 404)
    sw.serve("/nope", missing)
    assert.equal((await sw.nav("/nope")).response, missing)
    assert.equal(sw.cached("/nope"), undefined)

    sw.state.online = false
    assert.equal((await sw.send("/api/public/novels/1")).response?.tag, "good")
  })

  test("ทุกครั้งที่ค้นแคชใช้ ignoreVary (หัว Vary ของเซิร์ฟเวอร์ เช่น Accept-Encoding ต้องไม่ทำให้ค้นไม่เจอตอนออฟไลน์)", async () => {
    const sw = boot()
    sw.serve("/", page("home"))
    sw.serve("/assets/a.js", page("a"))
    await sw.nav("/")
    await sw.send("/assets/a.js")
    await sw.send("/assets/a.js")
    sw.state.online = false
    await sw.nav("/")
    await sw.nav("/novel/never")
    await sw.send("/api/public/novels")
    assert.ok(sw.state.matches.length >= 6)
    assert.deepEqual(
      sw.state.matches.filter((options) => options?.ignoreVary !== true),
      [],
    )
  })

  test("เขียนแคชไม่สำเร็จ (พื้นที่เต็ม) → หน้ายังได้คำตอบปกติ และงานเบื้องหลังไม่ล้ม (ไม่มี unhandled rejection)", async () => {
    const sw = boot()
    sw.state.putFails = true
    for (const [url, init] of [
      ["/novel/1", { mode: "navigate" }],
      ["/api/public/novels", {}],
      ["/assets/a.js", {}],
    ] as const) {
      const response = page(`ok:${url}`)
      sw.serve(url, response)
      const r = await sw.send(url, init)
      assert.equal(r.response, response, url)
      assert.equal(r.failedWaits, 0, url)
    }
  })
})
