/**
 * ตัวดึงสถานะคิวแปลสดสำหรับหลังบ้าน (ไม่ผูกกับ React/เบราว์เซอร์ เพื่อทดสอบได้ — `QueueContext.tsx` เอาไปต่อสายจริง)
 * กติกา:
 *   - ดึงครั้งเดียวต่อเวลา: รอบถัดไปนัดหลังคำตอบกลับเท่านั้น (คำขอที่ช้าไม่ทำให้คำขอซ้อนกัน)
 *   - แท็บมองเห็น 2 วินาที / อยู่เบื้องหลัง 10 วินาที · กลับมามองเห็นแล้วดึงทันที
 *   - `reload()` (หลังสั่งหยุด/ทำต่อ ฯลฯ) ดึงทันที; ถ้ามีคำขอค้างอยู่จะดึงอีกหนึ่งครั้งหลังมันกลับ (ตัวที่ค้างอาจออกก่อนการเปลี่ยนแปลง) หลายครั้งรวมเป็นหนึ่ง
 *   - ล้มเหลว → `onError` แล้วลองตามรอบปกติ · 401 (เซสชันหมดอายุ) → `onUnauthorized` แล้วหยุดถาวร
 *   - หลัง `stop()` คำตอบของคำขอเก่าถูกทิ้งหมด (รวมกรณี start ใหม่ทันที)
 */
import { ApiError } from "../lib/api"
import type { QueueDto, QueueError, QueueState } from "./types"

export const POLL_VISIBLE_MS = 2000
export const POLL_HIDDEN_MS = 10_000

export interface QueuePollerDeps {
  fetchQueue(): Promise<QueueDto>
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  isVisible(): boolean
  onData(queue: QueueDto): void
  onError(error: unknown): void
  onUnauthorized(): void
}

export interface QueuePoller {
  start(): void
  stop(): void
  reload(): void
  /** เรียกเมื่อแท็บสลับมองเห็น/เบื้องหลัง */
  visibilityChanged(): void
}

export function createQueuePoller(deps: QueuePollerDeps): QueuePoller {
  let running = false
  let inFlight = false
  let again = false
  let timer: unknown = null
  /** เพิ่มทุกครั้งที่ stop: คำขอที่ออกก่อนหน้านั้นรู้ว่าตัวเองเก่าแล้ว */
  let generation = 0

  function clear(): void {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  function schedule(): void {
    clear()
    if (!running) return
    timer = deps.setTimer(() => {
      timer = null
      poll()
    }, deps.isVisible() ? POLL_VISIBLE_MS : POLL_HIDDEN_MS)
  }

  function poll(): void {
    if (!running) return
    if (inFlight) {
      again = true
      return
    }
    clear()
    inFlight = true
    again = false
    const mine = generation
    let request: Promise<QueueDto>
    try {
      request = deps.fetchQueue()
    } catch (error) {
      request = Promise.reject(error)
    }
    request.then(
      (queue) => finish(mine, { queue }),
      (error: unknown) => finish(mine, { error }),
    )
  }

  function finish(mine: number, outcome: { queue: QueueDto } | { error: unknown }): void {
    if (mine !== generation) return
    inFlight = false
    if ("queue" in outcome) {
      deps.onData(outcome.queue)
    } else if (outcome.error instanceof ApiError && outcome.error.status === 401) {
      running = false
      generation++
      again = false
      deps.onUnauthorized()
      return
    } else {
      deps.onError(outcome.error)
    }
    if (again) poll()
    else schedule()
  }

  return {
    start() {
      if (running) return
      running = true
      poll()
    },
    stop() {
      running = false
      generation++
      inFlight = false
      again = false
      clear()
    },
    reload() {
      poll()
    },
    visibilityChanged() {
      if (!running || inFlight) return
      if (deps.isVisible()) poll()
      else schedule()
    },
  }
}

/** แยกคำตอบ `/api/admin/queue` เป็นสถานะคิว กับรายการตอนที่ผิดพลาด */
export function splitQueue(dto: QueueDto): { state: QueueState; errors: QueueError[] } {
  const { errors, ...state } = dto
  return { state, errors }
}
