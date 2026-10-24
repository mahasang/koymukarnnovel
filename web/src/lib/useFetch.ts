/**
 * `useFetch`: โหลดข้อมูลตาม `key` พร้อมยกเลิกคำขอเก่าเมื่อ key เปลี่ยน/ออกจากหน้า (กันคำตอบเก่ามาทับของใหม่)
 * ตรรกะอยู่ในฟังก์ชันล้วน (`fetchReducer`, `viewFor`, `runLoad`) ที่ทดสอบได้โดยไม่ต้องมี DOM — ตัว hook เป็นแค่ตัวเชื่อมกับ React
 */
import { useCallback, useEffect, useReducer, useState } from "react"
import { ApiError } from "./api"

export interface FetchState<T> {
  /** key ของการโหลดล่าสุดที่เริ่มแล้ว (ข้อมูล/error ในสถานะนี้เป็นของ key นี้) */
  key: string | null
  data: T | null
  error: ApiError | null
  loading: boolean
}

export type FetchAction<T> =
  | { type: "start"; key: string }
  | { type: "success"; key: string; data: T }
  | { type: "failure"; key: string; error: ApiError }

export function initialFetchState<T>(): FetchState<T> {
  return { key: null, data: null, error: null, loading: false }
}

/**
 * start: key ใหม่ล้างข้อมูลเดิม; key เดิม (reload) เก็บข้อมูลเดิมไว้ให้เห็นระหว่างรอ · ทั้งคู่ล้าง error
 * success/failure ของ key อื่น (คำตอบมาช้าของ key เก่า) ถูกเมิน · failure ไม่ทิ้งข้อมูลเดิม (reload ล้มเหลวยังมีของเก่าให้ดู)
 */
export function fetchReducer<T>(state: FetchState<T>, action: FetchAction<T>): FetchState<T> {
  switch (action.type) {
    case "start":
      return { key: action.key, data: state.key === action.key ? state.data : null, error: null, loading: true }
    case "success":
      return action.key === state.key ? { key: action.key, data: action.data, error: null, loading: false } : state
    case "failure":
      return action.key === state.key ? { ...state, error: action.error, loading: false } : state
  }
}

/**
 * สิ่งที่หน้าเห็นสำหรับ key ปัจจุบัน: สถานะที่ยังเป็นของ key เก่า (เรนเดอร์แรกหลังเปลี่ยน key) ไม่โผล่ให้เห็น — เห็นเป็น "กำลังโหลด" ทันที
 * key ว่าง = ยังไม่ต้องโหลด (ไม่ได้กำลังโหลด)
 */
export function viewFor<T>(state: FetchState<T>, key: string | null): { data: T | null; error: ApiError | null; loading: boolean } {
  if (state.key !== key) return { data: null, error: null, loading: key !== null }
  return { data: state.data, error: state.error, loading: state.loading }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  // ไม่ใช่ข้อผิดพลาดที่คาดไว้ (บั๊กในตัวโหลด): ผู้อ่านเห็นข้อความกลางๆ ผู้พัฒนาเห็นของจริงในคอนโซล
  console.error(error)
  return new ApiError(0, "โหลดข้อมูลไม่สำเร็จ")
}

/**
 * เริ่มโหลดทันทีด้วย signal ใหม่ แล้วส่งผลให้ `success`/`failure` หนึ่งครั้ง; คืนฟังก์ชันยกเลิก
 * หลังยกเลิก (signal ถูกยกเลิก) จะไม่เรียก callback ใดอีก แม้ตัวโหลดจะตอบหรือล้มทีหลัง
 */
export function runLoad<T>(load: (signal: AbortSignal) => Promise<T>, on: { success(data: T): void; failure(error: ApiError): void }): () => void {
  const controller = new AbortController()
  const { signal } = controller
  // ครอบด้วย Promise: ตัวโหลดที่โยนทันทีก็กลายเป็นการปฏิเสธ ไม่หลุดออกมาพัง effect
  new Promise<T>((resolve) => resolve(load(signal))).then(
    (data) => {
      if (!signal.aborted) on.success(data)
    },
    (error: unknown) => {
      if (!signal.aborted) on.failure(toApiError(error))
    },
  )
  return () => controller.abort()
}

/**
 * โหลดข้อมูลตาม `key` (ว่าง = ยังไม่โหลด) — key ต้องบอกครบว่าโหลดอะไร (เช่น `novel:12`) เพราะ `load` ไม่ถูกนับเป็นตัวกระตุ้น
 * key เปลี่ยน → ยกเลิกคำขอเก่า ล้างข้อมูลเก่า โหลดใหม่ · `reload()` → โหลด key เดิมซ้ำโดยยังโชว์ข้อมูลเดิมระหว่างรอ
 */
export function useFetch<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): { data: T | null; error: ApiError | null; loading: boolean; reload(): void } {
  const [state, dispatch] = useReducer(fetchReducer<T>, initialFetchState<T>())
  const [attempt, setAttempt] = useState(0)

  // `load` ไม่อยู่ใน deps โดยตั้งใจ: ตัวโหลดที่เขียนสดทุกเรนเดอร์ (`(signal) => publicApi.novel(id, signal)`) ต้องไม่ทำให้โหลดซ้ำ — key เป็นตัวบอกว่าโหลดอะไร
  // effect สร้างใหม่ทุกครั้งที่ key/attempt เปลี่ยนและเรียกตัวโหลดทันที จึงได้ `load` ของเรนเดอร์ล่าสุดเสมอ
  useEffect(() => {
    if (key === null) return undefined
    dispatch({ type: "start", key })
    return runLoad(load, {
      success: (data) => dispatch({ type: "success", key, data }),
      failure: (error) => dispatch({ type: "failure", key, error }),
    })
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...viewFor(state, key), reload }
}
