import assert from "node:assert/strict"
import { describe, mock, test } from "node:test"
import { ApiError } from "./api"
import { fetchReducer, initialFetchState, runLoad, viewFor, type FetchState } from "./useFetch"

/**
 * ส่วนที่ทดสอบได้โดยไม่ต้องมี DOM ของ `useFetch`: ตัวลดสถานะ (reducer), มุมมองที่ hook คืนให้หน้า (viewFor) และตัวรันการโหลดพร้อมยกเลิก (runLoad)
 * ส่วนเชื่อม React (useReducer/useEffect) บางมาก — ตรวจในเบราว์เซอร์จริงทั้งตอน StrictMode, เปลี่ยน key, reload และ unmount (บันทึกไว้ใน ledger)
 */

const err = (status = 500, message = "พัง") => new ApiError(status, message)
const state = (patch: Partial<FetchState<string>>): FetchState<string> => ({ ...initialFetchState<string>(), ...patch })
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
/** ปิดเสียง console.error ชั่วคราว (ผู้เรียกต้อง `.mock.restore()`) และบันทึกว่าถูกเรียกด้วยอะไรบ้าง */
const silenceConsoleError = () => mock.method(console, "error", (..._args: unknown[]) => {})

describe("initialFetchState", () => {
  test("ยังไม่ได้โหลดอะไร: ไม่มี key ไม่มีข้อมูล ไม่มี error ไม่ได้กำลังโหลด", () => {
    assert.deepEqual(initialFetchState(), { key: null, data: null, error: null, loading: false })
  })
})

describe("fetchReducer", () => {
  test("start key ใหม่: กำลังโหลด ล้างข้อมูลและ error ของ key เดิม", () => {
    const next = fetchReducer(state({ key: "a", data: "A", error: err() }), { type: "start", key: "b" })
    assert.deepEqual(next, { key: "b", data: null, error: null, loading: true })
  })

  test("start key เดิม (reload): กำลังโหลด เก็บข้อมูลเดิมไว้ให้เห็นระหว่างรอ แต่ล้าง error", () => {
    const next = fetchReducer(state({ key: "a", data: "A", error: err() }), { type: "start", key: "a" })
    assert.deepEqual(next, { key: "a", data: "A", error: null, loading: true })
  })

  test("start จากสถานะเริ่มต้น → กำลังโหลด key นั้น", () => {
    assert.deepEqual(fetchReducer(initialFetchState<string>(), { type: "start", key: "a" }), { key: "a", data: null, error: null, loading: true })
  })

  test("success ของ key ปัจจุบัน: ได้ข้อมูล เลิกโหลด ล้าง error", () => {
    const next = fetchReducer(state({ key: "a", data: "old", error: err(), loading: true }), { type: "success", key: "a", data: "new" })
    assert.deepEqual(next, { key: "a", data: "new", error: null, loading: false })
  })

  test("failure ของ key ปัจจุบัน: เก็บ error เลิกโหลด และไม่ทิ้งข้อมูลเดิม (reload ล้มเหลวยังมีของเก่าให้ดู)", () => {
    const e = err(404, "ไม่พบ")
    const next = fetchReducer(state({ key: "a", data: "old", loading: true }), { type: "failure", key: "a", error: e })
    assert.equal(next.error, e)
    assert.deepEqual({ ...next, error: null }, { key: "a", data: "old", error: null, loading: false })
  })

  test("success/failure ของ key อื่น (คำตอบมาช้าของ key เก่า) ถูกเมิน — สถานะไม่เปลี่ยนเลย (คืนอ็อบเจกต์เดิม)", () => {
    const current = state({ key: "b", loading: true })
    assert.equal(fetchReducer(current, { type: "success", key: "a", data: "stale" }), current)
    assert.equal(fetchReducer(current, { type: "failure", key: "a", error: err() }), current)
  })

  test("ไม่แก้สถานะเดิม (สร้างอ็อบเจกต์ใหม่เสมอเมื่อมีการเปลี่ยน)", () => {
    const before = state({ key: "a", data: "A" })
    const snapshot = { ...before }
    fetchReducer(before, { type: "start", key: "a" })
    fetchReducer(before, { type: "success", key: "a", data: "B" })
    fetchReducer(before, { type: "failure", key: "a", error: err() })
    assert.deepEqual(before, snapshot)
  })
})

describe("viewFor: สิ่งที่หน้าเห็น", () => {
  test("key ว่าง (ยังไม่ต้องโหลด) → ไม่มีอะไรเลย ไม่ได้โหลด แม้สถานะค้างของ key เก่า", () => {
    assert.deepEqual(viewFor(initialFetchState<string>(), null), { data: null, error: null, loading: false })
    assert.deepEqual(viewFor(state({ key: "a", data: "A", loading: false }), null), { data: null, error: null, loading: false })
  })

  test("key ตรงกับสถานะ → ข้อมูล/error/loading ตามสถานะ", () => {
    const e = err()
    assert.deepEqual(viewFor(state({ key: "a", data: "A" }), "a"), { data: "A", error: null, loading: false })
    assert.deepEqual(viewFor(state({ key: "a", data: "A", loading: true }), "a"), { data: "A", error: null, loading: true })
    assert.deepEqual(viewFor(state({ key: "a", error: e }), "a"), { data: null, error: e, loading: false })
  })

  test("key เปลี่ยนแล้วแต่สถานะยังเป็นของ key เก่า (เรนเดอร์แรกหลังเปลี่ยน) → กำลังโหลด ไม่มีข้อมูล/error เก่าให้เห็น", () => {
    assert.deepEqual(viewFor(state({ key: "a", data: "A", error: err() }), "b"), { data: null, error: null, loading: true })
  })

  test("เรนเดอร์แรกสุด (สถานะยังไม่เคยเริ่ม) ที่มี key → กำลังโหลดตั้งแต่เฟรมแรก ไม่วาบเป็นหน้าว่าง", () => {
    assert.deepEqual(viewFor(initialFetchState<string>(), "a"), { data: null, error: null, loading: true })
  })
})

describe("runLoad", () => {
  test("โหลดสำเร็จ → เรียก success ด้วยข้อมูลหนึ่งครั้ง ไม่เรียก failure", async () => {
    const success = mock.fn()
    const failure = mock.fn()
    runLoad(async () => "ข้อมูล", { success, failure })
    await tick()
    assert.deepEqual(success.mock.calls.map((c) => c.arguments), [["ข้อมูล"]])
    assert.equal(failure.mock.callCount(), 0)
  })

  test("โหลดล้ม ด้วย ApiError → ส่ง ApiError ตัวนั้นเอง (ไม่ห่อซ้ำ) ไม่บันทึกลงคอนโซล", async () => {
    const consoleError = silenceConsoleError()
    try {
      const success = mock.fn()
      const failure = mock.fn()
      const e = err(404, "ไม่พบ")
      runLoad(() => Promise.reject(e), { success, failure })
      await tick()
      assert.equal(success.mock.callCount(), 0)
      assert.equal(failure.mock.callCount(), 1)
      assert.equal(failure.mock.calls[0].arguments[0], e)
      assert.equal(consoleError.mock.callCount(), 0)
    } finally {
      consoleError.mock.restore()
    }
  })

  test("โหลดล้มด้วยข้อผิดพลาดอื่น (บั๊กในตัวโหลด) → ApiError(0, 'โหลดข้อมูลไม่สำเร็จ') และบันทึกของจริงลงคอนโซลให้ผู้พัฒนาเห็น", async () => {
    const consoleError = silenceConsoleError()
    try {
      const failure = mock.fn()
      const bug = new TypeError("x is undefined")
      runLoad(() => Promise.reject(bug), { success: () => {}, failure })
      await tick()
      const received = failure.mock.calls[0].arguments[0] as ApiError
      assert.ok(received instanceof ApiError)
      assert.equal(received.status, 0)
      assert.equal(received.message, "โหลดข้อมูลไม่สำเร็จ")
      assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments.includes(bug)), [true])
    } finally {
      consoleError.mock.restore()
    }
  })

  test("ตัวโหลดโยนทันที (ไม่ใช่ปฏิเสธ promise) ก็จัดเป็น failure ไม่ทำให้ effect พัง", async () => {
    const consoleError = silenceConsoleError()
    try {
      const failure = mock.fn()
      assert.doesNotThrow(() =>
        runLoad(
          () => {
            throw new Error("พังทันที")
          },
          { success: () => {}, failure },
        ),
      )
      await tick()
      assert.equal(failure.mock.callCount(), 1)
      assert.equal((failure.mock.calls[0].arguments[0] as ApiError).message, "โหลดข้อมูลไม่สำเร็จ")
    } finally {
      consoleError.mock.restore()
    }
  })

  test("ตัวโหลดได้ signal ที่ยังไม่ถูกยกเลิก และเรียกทันที (ไม่รอรอบถัดไป)", () => {
    let seen: AbortSignal | undefined
    runLoad(
      (signal) => {
        seen = signal
        return new Promise<string>(() => {})
      },
      { success: () => {}, failure: () => {} },
    )
    assert.ok(seen)
    assert.equal(seen.aborted, false)
  })

  test("ยกเลิกก่อนโหลดเสร็จ → signal ถูกยกเลิก และคำตอบที่มาทีหลังไม่ถูกส่งต่อ (ทั้งสำเร็จและล้มเหลว)", async () => {
    const success = mock.fn()
    const failure = mock.fn()
    let signalSeen!: AbortSignal
    let resolve!: (v: string) => void
    const cancel = runLoad(
      (signal) => {
        signalSeen = signal
        return new Promise<string>((r) => (resolve = r))
      },
      { success, failure },
    )
    cancel()
    assert.equal(signalSeen.aborted, true)
    resolve("มาช้า")
    await tick()
    assert.equal(success.mock.callCount(), 0)

    let reject!: (e: unknown) => void
    const cancel2 = runLoad(() => new Promise<string>((_, r) => (reject = r)), { success, failure })
    cancel2()
    reject(err())
    await tick()
    assert.equal(failure.mock.callCount(), 0)
  })

  test("ตัวโหลดที่เห็น signal ถูกยกเลิกแล้วปฏิเสธด้วย AbortError (fetch จริงทำแบบนี้) → เงียบ ไม่ใช่ failure ไม่บันทึกคอนโซล", async () => {
    const consoleError = silenceConsoleError()
    try {
      const failure = mock.fn()
      const cancel = runLoad(
        (signal) => new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
        { success: () => {}, failure },
      )
      cancel()
      await tick()
      assert.equal(failure.mock.callCount(), 0)
      assert.equal(consoleError.mock.callCount(), 0)
    } finally {
      consoleError.mock.restore()
    }
  })

  test("ยกเลิกหลังโหลดเสร็จแล้ว (เรียก cancel ซ้ำ ๆ) ไม่เกิดอะไรขึ้น และข้อมูลที่ส่งไปแล้วคงอยู่", async () => {
    const success = mock.fn()
    const cancel = runLoad(async () => "A", { success, failure: () => {} })
    await tick()
    assert.doesNotThrow(() => {
      cancel()
      cancel()
    })
    assert.equal(success.mock.callCount(), 1)
  })

  test("แต่ละการเรียก runLoad แยกกัน: ยกเลิกอันแรกไม่กระทบอันที่สอง (key เปลี่ยน/reload เริ่มโหลดใหม่ทันที)", async () => {
    const first = mock.fn()
    const second = mock.fn()
    const cancelFirst = runLoad(async () => "1", { success: first, failure: () => {} })
    runLoad(async () => "2", { success: second, failure: () => {} })
    cancelFirst()
    await tick()
    assert.equal(first.mock.callCount(), 0)
    assert.deepEqual(second.mock.calls.map((c) => c.arguments), [["2"]])
  })
})
