/**
 * ตัวช่วยเทสต์ฝั่งเว็บ — มีแต่ไฟล์เทสต์ที่ import ไม่ถูกรวมเข้าแอปจริง
 * `localStorage` ปลอมกับ `fetch` ปลอมถูกติดตั้งเป็น global ชั่วคราว: เรียก `restoreGlobals()` ใน `afterEach` เพื่อคืนของเดิม
 */

const g = globalThis as Record<string, unknown>
const originals = new Map<string, PropertyDescriptor | undefined>()

function replaceGlobal(name: string, descriptor: PropertyDescriptor | null): void {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(g, name))
  if (descriptor) Object.defineProperty(g, name, { configurable: true, ...descriptor })
  else delete g[name]
}

/** คืน global ทุกตัวที่ติดตั้งไว้เป็นค่าเดิม (ไม่เดิมมีอยู่ก็ลบทิ้ง) */
export function restoreGlobals(): void {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(g, name, descriptor)
    else delete g[name]
  }
  originals.clear()
}

export interface StorageSetup {
  /** ค่าตั้งต้นที่เก็บอยู่ (เป็นสตริงเหมือนของจริง) */
  initial?: Record<string, string>
  /** แค่เข้าถึง `localStorage` ก็โยน (เบราว์เซอร์ปิดการเก็บข้อมูล / อยู่ใน iframe ข้ามไซต์) */
  accessThrows?: boolean
  /** `getItem` โยน */
  readThrows?: boolean
  /** `setItem` โยน (โควตาเต็ม / โหมดส่วนตัวแบบเก่า) */
  writeThrows?: boolean
  /** ไม่มี `localStorage` เลย (นอกเบราว์เซอร์) */
  absent?: boolean
}

/** ติดตั้ง `localStorage` ปลอม คืนที่เก็บจริงด้านหลัง (อ่านดู/แก้ตรงๆ ได้) */
export function installStorage(setup: StorageSetup = {}): Record<string, string> {
  const store: Record<string, string> = { ...setup.initial }
  if (setup.absent) {
    replaceGlobal("localStorage", null)
    return store
  }
  replaceGlobal("localStorage", {
    get() {
      if (setup.accessThrows) throw new DOMException("The operation is insecure.", "SecurityError")
      return {
        getItem(key: string): string | null {
          if (setup.readThrows) throw new Error("denied")
          return Object.hasOwn(store, key) ? store[key] : null
        },
        setItem(key: string, value: string): void {
          if (setup.writeThrows) throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
          store[key] = value
        },
      }
    },
  })
  return store
}

export interface FetchCall {
  url: string
  init: RequestInit
}

/**
 * ติดตั้ง `fetch` ปลอมที่บันทึกทุกการเรียกลง `calls` แล้วตอบตามที่ `reply` คืน (หรือโยน = เครือข่ายล่ม)
 * ทำตัวเหมือน fetch จริงเรื่องการยกเลิก: signal ที่ถูกยกเลิกอยู่ก่อนเรียก → โยน `signal.reason` ทันที
 */
export function installFetch(reply: (call: FetchCall) => unknown): FetchCall[] {
  const calls: FetchCall[] = []
  replaceGlobal("fetch", {
    writable: true,
    value: async (input: unknown, init: RequestInit = {}): Promise<unknown> => {
      const call: FetchCall = { url: String(input), init }
      calls.push(call)
      if (init.signal?.aborted) throw init.signal.reason
      return reply(call)
    },
  })
  return calls
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } })
}

export function textResponse(body: string, status = 200, type = "text/html"): Response {
  return new Response(body, { status, headers: { "content-type": type } })
}

/** รอจน signal ของคำขอถูกยกเลิก แล้วปฏิเสธด้วย `signal.reason` เหมือน fetch จริง (ไว้ทดสอบการยกเลิกกลางคัน) */
export function untilAborted(call: FetchCall): Promise<never> {
  return new Promise((_resolve, reject) => {
    const { signal } = call.init
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}
