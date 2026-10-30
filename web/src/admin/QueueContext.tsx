/**
 * สถานะคิวแปลสดของหลังบ้าน: `QueueProvider` ดึง `/api/admin/queue` ตามจังหวะใน `queue-poller.ts` แล้วแจกให้ทุกหน้าผ่าน `useQueue()`
 * ดึงล้มเหลว → ยังเห็นสถานะครั้งก่อน และ `offline` เป็น true จนกว่าจะดึงได้อีกครั้ง
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { admin } from "./adminApi"
import { createQueuePoller, splitQueue, type QueuePoller } from "./queue-poller"
import type { QueueError, QueueState } from "./types"

export interface QueueValue {
  /** null = ยังไม่เคยดึงสำเร็จ */
  state: QueueState | null
  /** ตอนที่แปลผิดพลาดล่าสุด */
  errors: QueueError[]
  /** ดึงใหม่ทันที (เรียกหลังสั่งหยุด/ทำต่อ/ส่งเข้าคิว) */
  reload(): void
  /** ดึงครั้งล่าสุดไม่สำเร็จ (ข้อมูลที่เห็นอาจเก่า) */
  offline: boolean
}

export const QueueContext = createContext<QueueValue | null>(null)

export function useQueue(): QueueValue {
  const value = useContext(QueueContext)
  if (value === null) throw new Error("useQueue ต้องใช้ภายใน QueueProvider")
  return value
}

interface Snapshot {
  state: QueueState | null
  errors: QueueError[]
}

export function QueueProvider({ onUnauthorized, children }: { onUnauthorized(): void; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ state: null, errors: [] })
  const [offline, setOffline] = useState(false)
  const pollerRef = useRef<QueuePoller | null>(null)
  // เก็บตัวล่าสุดไว้ใน ref: เปลี่ยน callback ของผู้ใช้ไม่ต้องสร้างตัวดึงใหม่
  const unauthorizedRef = useRef(onUnauthorized)
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized
  }, [onUnauthorized])

  useEffect(() => {
    const poller = createQueuePoller({
      fetchQueue: () => admin.queue(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (handle) => window.clearTimeout(handle as number),
      isVisible: () => document.visibilityState !== "hidden",
      onData: (queue) => {
        setSnapshot(splitQueue(queue))
        setOffline(false)
      },
      onError: () => setOffline(true),
      onUnauthorized: () => unauthorizedRef.current(),
    })
    pollerRef.current = poller
    const onVisibility = () => poller.visibilityChanged()
    document.addEventListener("visibilitychange", onVisibility)
    poller.start()
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      poller.stop()
      pollerRef.current = null
    }
  }, [])

  const reload = useCallback(() => pollerRef.current?.reload(), [])
  const value = useMemo<QueueValue>(() => ({ state: snapshot.state, errors: snapshot.errors, reload, offline }), [snapshot, reload, offline])
  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>
}
