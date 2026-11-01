import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ApiError } from "../lib/api"
import { POLL_HIDDEN_MS, POLL_VISIBLE_MS, createQueuePoller, splitQueue } from "./queue-poller"
import type { QueueDto } from "./types"

/** ตัวดึงคิวสด: เวลาและเครือข่ายปลอมทั้งคู่ (ไม่มี DOM) เทสต์สั่งให้เวลาเดิน/คำตอบมาถึงเอง */

const dto = (n: number): QueueDto => ({ paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: n, current: null, waiting: [], errors: [] })

function rig(initiallyVisible = true) {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let nextTimer = 1
  let visible = initiallyVisible
  const pending: { resolve(q: QueueDto): void; reject(e: unknown): void }[] = []
  const log = { data: [] as QueueDto[], errors: [] as unknown[], unauthorized: 0, fetches: 0, cleared: 0 }
  const poller = createQueuePoller({
    fetchQueue: () => {
      log.fetches++
      return new Promise<QueueDto>((resolve, reject) => pending.push({ resolve, reject }))
    },
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimer: (handle) => {
      log.cleared++
      timers.delete(handle as number)
    },
    isVisible: () => visible,
    onData: (q) => log.data.push(q),
    onError: (e) => log.errors.push(e),
    onUnauthorized: () => log.unauthorized++,
  })
  const flush = () => new Promise<void>((r) => setImmediate(r))
  return {
    poller,
    log,
    timers,
    pending,
    /** ค่าเวลาของตัวจับเวลาที่รออยู่ (ต้องมีอันเดียวพอดี หรือไม่มีเลย) */
    waits: () => [...timers.values()].map((t) => t.ms),
    setVisible: (v: boolean) => {
      visible = v
    },
    /** คำตอบของคำขอที่ค้างอยู่ตัวแรกมาถึง */
    async answer(q: QueueDto) {
      pending.shift()!.resolve(q)
      await flush()
    },
    async fail(e: unknown) {
      pending.shift()!.reject(e)
      await flush()
    },
    /** จับเวลาครบ: รันตัวที่รออยู่ */
    async fire() {
      const [[id, t]] = [...timers.entries()]
      timers.delete(id!)
      t!.fn()
      await flush()
    },
  }
}

describe("ค่าคงที่", () => {
  test("แท็บมองเห็นทุก 2 วินาที เบื้องหลังทุก 10 วินาที (ตามสเปก)", () => {
    assert.equal(POLL_VISIBLE_MS, 2000)
    assert.equal(POLL_HIDDEN_MS, 10_000)
  })
})

describe("createQueuePoller: จังหวะดึง", () => {
  test("start ดึงทันที 1 ครั้ง ส่งข้อมูลให้ onData แล้วนัดรอบถัดไป 2 วินาที", async () => {
    const t = rig()
    t.poller.start()
    assert.equal(t.log.fetches, 1)
    assert.deepEqual(t.waits(), [], "ยังไม่นัดรอบถัดไปจนกว่าคำขอแรกจะกลับ (ไม่ซ้อนกัน)")
    await t.answer(dto(1))
    assert.deepEqual(t.log.data, [dto(1)])
    assert.deepEqual(t.waits(), [POLL_VISIBLE_MS])
    await t.fire()
    assert.equal(t.log.fetches, 2)
    await t.answer(dto(2))
    assert.deepEqual(t.log.data, [dto(1), dto(2)])
    assert.deepEqual(t.waits(), [POLL_VISIBLE_MS])
  })

  test("แท็บอยู่เบื้องหลัง → นัดรอบถัดไป 10 วินาที", async () => {
    const t = rig(false)
    t.poller.start()
    await t.answer(dto(0))
    assert.deepEqual(t.waits(), [POLL_HIDDEN_MS])
  })

  test("ตัวจับเวลาที่ถึงเวลาแล้วไม่ถูก clear ซ้ำ (handle เก่าหมดอายุแล้ว)", async () => {
    const t = rig()
    t.poller.start()
    await t.answer(dto(1))
    await t.fire()
    assert.equal(t.log.cleared, 0, "ตั้งตัวจับเวลา → ถึงเวลา → ดึง: ไม่มีการ clear ตัวที่เพิ่งทำงานไปแล้ว")
    await t.answer(dto(2))
    assert.equal(t.log.cleared, 0)
  })

  test("start ซ้ำไม่ดึงซ้อน", async () => {
    const t = rig()
    t.poller.start()
    t.poller.start()
    assert.equal(t.log.fetches, 1)
    await t.answer(dto(0))
    t.poller.start()
    assert.equal(t.log.fetches, 1)
    assert.equal(t.timers.size, 1)
  })

  test("คำขอช้ากว่า 2 วินาที: ไม่มีรอบใหม่ซ้อน (ตัวจับเวลาเริ่มหลังคำตอบกลับเท่านั้น)", async () => {
    const t = rig()
    t.poller.start()
    assert.equal(t.timers.size, 0)
    assert.equal(t.pending.length, 1)
  })
})

describe("createQueuePoller: reload (หลังกดหยุด/ทำต่อ ฯลฯ ให้เห็นผลทันที)", () => {
  test("ตอนว่าง: ยกเลิกตัวจับเวลาเดิมแล้วดึงทันที ไม่ทิ้งตัวจับเวลาค้างสองตัว", async () => {
    const t = rig()
    t.poller.start()
    await t.answer(dto(1))
    assert.equal(t.timers.size, 1)
    t.poller.reload()
    assert.equal(t.log.fetches, 2)
    assert.equal(t.timers.size, 0, "ตัวจับเวลาเก่าต้องถูกยกเลิก")
    await t.answer(dto(2))
    assert.equal(t.timers.size, 1)
  })

  test("ระหว่างคำขอยังค้าง: ไม่ดึงซ้อน แต่ดึงอีกครั้งทันทีหลังคำตอบกลับ (คำขอเดิมอาจออกก่อนการเปลี่ยนแปลง) และหลายครั้งรวมเป็นหนึ่ง", async () => {
    const t = rig()
    t.poller.start()
    t.poller.reload()
    t.poller.reload()
    t.poller.reload()
    assert.equal(t.log.fetches, 1, "ห้ามมีคำขอซ้อนกัน")
    await t.answer(dto(1))
    assert.equal(t.log.fetches, 2, "ดึงเพิ่มอีกหนึ่งครั้งพอดี")
    assert.equal(t.timers.size, 0, "ระหว่างดึงเพิ่มยังไม่นัดรอบ")
    await t.answer(dto(2))
    assert.equal(t.log.fetches, 2)
    assert.deepEqual(t.log.data, [dto(1), dto(2)])
    assert.equal(t.timers.size, 1)
  })

  test("ก่อน start ไม่ทำอะไร", () => {
    const t = rig()
    t.poller.reload()
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 0)
  })
})

describe("createQueuePoller: แท็บสลับมองเห็น/เบื้องหลัง", () => {
  test("กลับมามองเห็น ขณะนัดรอบ 10 วินาทีอยู่ → ดึงทันที และเลิกตัวจับเวลาเก่า", async () => {
    const t = rig(false)
    t.poller.start()
    await t.answer(dto(0))
    assert.deepEqual(t.waits(), [POLL_HIDDEN_MS])
    t.setVisible(true)
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 2)
    assert.equal(t.timers.size, 0)
    await t.answer(dto(0))
    assert.deepEqual(t.waits(), [POLL_VISIBLE_MS])
  })

  test("ไปเบื้องหลัง ขณะนัดรอบ 2 วินาทีอยู่ → เปลี่ยนเป็น 10 วินาที ไม่ดึงเพิ่ม", async () => {
    const t = rig(true)
    t.poller.start()
    await t.answer(dto(0))
    assert.deepEqual(t.waits(), [POLL_VISIBLE_MS])
    t.setVisible(false)
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 1)
    assert.deepEqual(t.waits(), [POLL_HIDDEN_MS])
  })

  test("สลับขณะคำขอยังค้าง → ไม่ดึงซ้อน รอบถัดไปใช้สถานะล่าสุด", async () => {
    const t = rig(true)
    t.poller.start()
    t.setVisible(false)
    t.poller.visibilityChanged()
    t.setVisible(true)
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 1)
    t.setVisible(false)
    await t.answer(dto(0))
    assert.deepEqual(t.waits(), [POLL_HIDDEN_MS])
  })
})

describe("createQueuePoller: ล้มเหลว", () => {
  test("ดึงไม่สำเร็จ → onError (ไม่ใช่ onData) แล้วลองใหม่ตามรอบปกติ", async () => {
    const t = rig()
    t.poller.start()
    await t.answer(dto(3))
    await t.fire()
    const boom = new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
    await t.fail(boom)
    assert.deepEqual(t.log.errors, [boom])
    assert.deepEqual(t.log.data, [dto(3)], "ข้อมูลเดิมไม่ถูกแตะ")
    assert.equal(t.log.unauthorized, 0)
    assert.deepEqual(t.waits(), [POLL_VISIBLE_MS])
    await t.fire()
    await t.answer(dto(4))
    assert.deepEqual(t.log.data, [dto(3), dto(4)])
  })

  test("ข้อผิดพลาดอื่นของเซิร์ฟเวอร์ (403/500/ไม่ใช่ ApiError) ก็ยังลองต่อ ไม่ถือว่าหมดสิทธิ์", async () => {
    const t = rig()
    t.poller.start()
    await t.fail(new ApiError(500, "พัง"))
    await t.fire()
    await t.fail(new ApiError(403, "ห้าม", "forbidden_host"))
    await t.fire()
    await t.fail(new Error("อะไรก็ไม่รู้"))
    assert.equal(t.log.errors.length, 3)
    assert.equal(t.log.unauthorized, 0)
    assert.equal(t.timers.size, 1)
  })

  test("fetchQueue ที่โยนทันที (ไม่ใช่ Promise ที่ล้ม) ก็นับเป็นล้มเหลว: onError แล้วนัดรอบใหม่ ไม่ค้างสถานะกำลังดึง", async () => {
    const errors: unknown[] = []
    const timers: number[] = []
    let calls = 0
    const boom = new Error("โยนทันที")
    const poller = createQueuePoller({
      fetchQueue: () => {
        calls++
        throw boom
      },
      setTimer: (_fn, ms) => timers.push(ms),
      clearTimer: () => {},
      isVisible: () => true,
      onData: () => assert.fail("ไม่ควรมีข้อมูล"),
      onError: (e) => errors.push(e),
      onUnauthorized: () => assert.fail("ไม่ใช่ 401"),
    })
    poller.start()
    await new Promise<void>((r) => setImmediate(r))
    assert.deepEqual(errors, [boom])
    assert.deepEqual(timers, [POLL_VISIBLE_MS], "นัดรอบถัดไปตามปกติ")
    poller.reload()
    assert.equal(calls, 2, "ไม่ค้างอยู่ในสถานะกำลังดึง: reload ดึงได้ทันที")
  })

  test("ข้อผิดพลาดที่ไม่ใช่ ApiError แต่มี status 401 ไม่ใช่เซสชันหมดอายุ (นับเฉพาะคำตอบ 401 จริงของเซิร์ฟเวอร์)", async () => {
    const t = rig()
    t.poller.start()
    await t.fail(Object.assign(new Error("ปลอม"), { status: 401 }))
    assert.equal(t.log.unauthorized, 0)
    assert.equal(t.log.errors.length, 1)
    assert.equal(t.timers.size, 1)
  })

  test("401 (เซสชันหมดอายุ) → onUnauthorized ครั้งเดียว หยุดดึง ไม่แจ้งเป็นข้อผิดพลาดทั่วไป", async () => {
    const t = rig()
    t.poller.start()
    await t.answer(dto(1))
    await t.fire()
    await t.fail(new ApiError(401, "ต้องเข้าสู่ระบบ", "unauthorized"))
    assert.equal(t.log.unauthorized, 1)
    assert.deepEqual(t.log.errors, [])
    assert.equal(t.timers.size, 0, "หลัง 401 ห้ามนัดรอบใหม่")
    t.poller.reload()
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 2, "หลัง 401 ห้ามดึงอีก")
  })

  test("401 ที่มี reload ค้างอยู่ → ก็หยุด ไม่ดึงซ้ำ", async () => {
    const t = rig()
    t.poller.start()
    t.poller.reload()
    await t.fail(new ApiError(401, "ต้องเข้าสู่ระบบ", "unauthorized"))
    assert.equal(t.log.fetches, 1)
    assert.equal(t.log.unauthorized, 1)
  })
})

describe("createQueuePoller: stop", () => {
  test("ยกเลิกตัวจับเวลาที่นัดไว้ และไม่ดึง/นัดอีก", async () => {
    const t = rig()
    t.poller.start()
    await t.answer(dto(1))
    t.poller.stop()
    assert.equal(t.timers.size, 0)
    t.poller.reload()
    t.poller.visibilityChanged()
    assert.equal(t.log.fetches, 1)
  })

  test("คำตอบที่มาถึงหลัง stop ถูกทิ้ง ไม่เรียก onData/onError และไม่นัดรอบใหม่", async () => {
    const t = rig()
    t.poller.start()
    t.poller.stop()
    await t.answer(dto(9))
    assert.deepEqual(t.log.data, [])
    assert.equal(t.timers.size, 0)

    const u = rig()
    u.poller.start()
    u.poller.stop()
    await u.fail(new ApiError(500, "พัง"))
    assert.deepEqual(u.log.errors, [])
    const v = rig()
    v.poller.start()
    v.poller.stop()
    await v.fail(new ApiError(401, "ต้องเข้าสู่ระบบ", "unauthorized"))
    assert.equal(v.log.unauthorized, 0)
  })

  test("start ใหม่หลัง stop (React StrictMode ติดตั้ง-ถอด-ติดตั้ง) ใช้ตัวดึงใหม่ได้ ไม่ปนผลของตัวเก่า", async () => {
    const t = rig()
    t.poller.start()
    t.poller.stop()
    t.poller.start()
    assert.equal(t.log.fetches, 2)
    await t.answer(dto(1)) // ของรอบแรกที่ถูกทิ้ง
    assert.deepEqual(t.log.data, [], "ผลของคำขอก่อน stop ต้องไม่ถูกนับ")
    await t.answer(dto(2))
    assert.deepEqual(t.log.data, [dto(2)])
    assert.equal(t.timers.size, 1)
  })
})

describe("splitQueue", () => {
  test("แยก errors ออกจากสถานะคิว (state ไม่มีช่อง errors)", () => {
    const q: QueueDto = { ...dto(2), errors: [{ id: 1, novelId: 2, novelTitle: "ก", number: 3, error: "พัง" }] }
    const { state, errors } = splitQueue(q)
    assert.deepEqual(errors, q.errors)
    assert.equal("errors" in state, false)
    assert.equal(state.waitingTotal, 2)
  })
})
