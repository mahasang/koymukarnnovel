import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { registerServiceWorker, SW_URL, type SwHost } from "./register-sw"

function fakeHost(over: { serviceWorker?: boolean; readyState?: string; fail?: boolean } = {}) {
  const { serviceWorker = true, readyState = "complete", fail = false } = over
  const calls = { register: [] as string[], listeners: [] as string[] }
  let onLoad: (() => void) | null = null
  const host: SwHost = {
    document: { readyState },
    navigator: serviceWorker
      ? {
          serviceWorker: {
            register: (url: string) => {
              calls.register.push(url)
              return fail ? Promise.reject(new Error("SecurityError")) : Promise.resolve({})
            },
          },
        }
      : {},
    addEventListener: (type, listener) => {
      calls.listeners.push(type)
      onLoad = listener
    },
  }
  return { host, calls, load: () => onLoad?.() }
}

describe("registerServiceWorker", () => {
  test("ลงทะเบียน /sw.js (ที่อยู่เดียวกับที่เซิร์ฟเวอร์แทน __BUILD_ID__ ให้)", async () => {
    assert.equal(SW_URL, "/sw.js")
    const { host, calls } = fakeHost()
    registerServiceWorker(true, host)
    assert.deepEqual(calls.register, ["/sw.js"])
  })

  test("ไม่ใช่ build จริง (โหมดพัฒนา) → ไม่ลงทะเบียนและไม่ดักเหตุการณ์ใดๆ (แคชของ SW จะบังโค้ดที่กำลังแก้)", () => {
    const { host, calls } = fakeHost({ readyState: "loading" })
    registerServiceWorker(false, host)
    assert.deepEqual(calls.register, [])
    assert.deepEqual(calls.listeners, [])
  })

  test("เบราว์เซอร์ไม่รองรับ service worker (หรือเปิดผ่าน http ที่ไม่ปลอดภัย) → ข้ามเงียบๆ ไม่โยนข้อผิดพลาด", () => {
    const { host, calls } = fakeHost({ serviceWorker: false, readyState: "loading" })
    assert.doesNotThrow(() => registerServiceWorker(true, host))
    assert.deepEqual(calls.register, [])
    assert.deepEqual(calls.listeners, [])
  })

  test("หน้ายังโหลดไม่เสร็จ → รอเหตุการณ์ load ก่อนค่อยลงทะเบียน (ไม่แย่งแบนด์วิดท์กับการวาดหน้าแรก) และลงทะเบียนครั้งเดียว", () => {
    const { host, calls, load } = fakeHost({ readyState: "loading" })
    registerServiceWorker(true, host)
    assert.deepEqual(calls.register, [])
    assert.deepEqual(calls.listeners, ["load"])
    load()
    assert.deepEqual(calls.register, ["/sw.js"])
  })

  test("ลงทะเบียนไม่สำเร็จ → กลืนข้อผิดพลาด (ผู้อ่านอ่านต่อได้ตามปกติ ไม่มี unhandled rejection)", async () => {
    const { host, calls } = fakeHost({ fail: true })
    const unhandled: unknown[] = []
    const listener = (reason: unknown) => void unhandled.push(reason)
    process.on("unhandledRejection", listener)
    try {
      registerServiceWorker(true, host)
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      process.off("unhandledRejection", listener)
    }
    assert.deepEqual(calls.register, ["/sw.js"])
    assert.deepEqual(unhandled, [])
  })
})

describe("main.tsx", () => {
  test("เรียก registerServiceWorker ด้วย import.meta.env.PROD เท่านั้น (ไม่ใช่ true ตายตัว: โหมดพัฒนาต้องไม่มี SW)", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "main.tsx"), "utf8")
    assert.match(source, /import \{ registerServiceWorker \} from "\.\/lib\/register-sw"/)
    assert.match(source, /^registerServiceWorker\(import\.meta\.env\.PROD\)$/m)
  })
})
