/**
 * เปลือกหลังบ้าน (`/admin/*`): ถามเซิร์ฟเวอร์ว่าเป็นผู้ดูแลหรือยัง (`admin.me`) แล้วแสดง
 *   401 → หน้าล็อกอิน · ข้อผิดพลาดอื่น → ข้อความ + ลองใหม่ · ผ่าน → คิวสด + โครง (เมนู/แถบบน) + หน้าตามที่อยู่
 * ล็อกอินสำเร็จ / ออกจากระบบ / คิวตอบ 401 (เซสชันหมดอายุ) ล้วนแค่ "ตรวจสิทธิ์ใหม่" — เซิร์ฟเวอร์เป็นผู้ตัดสินเสมอ
 * หน้าแต่ละหน้า (แดชบอร์ด นิยาย …) เป็นที่ว่างไว้ก่อน ขั้นถัดไปแทนที่ทีละหน้า
 */
import { Link, useRoutes, type RouteObject } from "react-router"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import type { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { Dashboard } from "./Dashboard"
import { AdminLayout } from "./Layout"
import { Login } from "./Login"
import { QueueProvider } from "./QueueContext"
import type { MeDto } from "./types"

export interface MeView {
  data: MeDto | null
  error: ApiError | null
  loading: boolean
}

export type ShellPhase = "loading" | "login" | "error" | "ready"

/**
 * ข้อผิดพลาดมาก่อนข้อมูลเสมอ: `useFetch` เก็บข้อมูลเก่าไว้ตอนตรวจซ้ำล้มเหลว จึงมี 401 ที่ยังมีข้อมูลเก่าค้างได้ (เซสชันหมดอายุ) ต้องไปหน้าล็อกอิน
 * กำลังตรวจซ้ำและยังไม่มีข้อผิดพลาด (เช่น เพิ่งล็อกอินสำเร็จ) → ใช้งานต่อจากข้อมูลเดิม ไม่กะพริบเป็นโครงโหลด
 */
export function shellPhase(me: MeView): ShellPhase {
  if (me.error !== null) return me.error.status === 401 ? "login" : "error"
  return me.data !== null ? "ready" : "loading"
}

function ComingSoon({ title }: { title: string }) {
  useDocumentTitle(title)
  return (
    <>
      <div className="ad-ph">
        <h1>{title}</h1>
      </div>
      <EmptyState title="หน้านี้ยังไม่พร้อมใช้งาน" hint="กำลังสร้างในขั้นถัดไป" />
    </>
  )
}

function AdminNotFound() {
  useDocumentTitle("ไม่พบหน้านี้")
  return (
    <>
      <div className="ad-ph">
        <h1>ไม่พบหน้านี้ในหลังบ้าน</h1>
      </div>
      <EmptyState
        title="ที่อยู่นี้ไม่มีหน้าใดตรงกัน"
        hint="ลองกลับแดชบอร์ดแล้วเลือกจากเมนู"
        action={
          <Link to="/admin" className="btn primary">
            กลับแดชบอร์ด
          </Link>
        }
      />
    </>
  )
}

/** เส้นทางสัมพัทธ์กับ `/admin` (`handle.page` ไว้ให้เทสต์อ่านว่าตรงหน้าไหน) */
export const adminRoutes: RouteObject[] = [
  { index: true, element: <Dashboard />, handle: { page: "dashboard" } },
  { path: "novels", element: <ComingSoon title="นิยาย" />, handle: { page: "novels" } },
  { path: "novels/new", element: <ComingSoon title="เพิ่มนิยายใหม่" />, handle: { page: "novel-new" } },
  { path: "novels/:id", element: <ComingSoon title="จัดการนิยาย" />, handle: { page: "novel" } },
  { path: "novels/:id/chapters/:chapterId", element: <ComingSoon title="แก้ไขตอน" />, handle: { page: "chapter" } },
  { path: "add", element: <ComingSoon title="เพิ่มตอน" />, handle: { page: "add" } },
  { path: "settings", element: <ComingSoon title="ตั้งค่า" />, handle: { page: "settings" } },
  { path: "*", element: <AdminNotFound />, handle: { page: "not-found" } },
]

function AdminRoutes() {
  return useRoutes(adminRoutes)
}

/** ส่วนแสดงผล (ไม่มี hook ของตัวเอง): เลือกหน้าจากผลตรวจสิทธิ์ — `reload` = ตรวจสิทธิ์ใหม่ */
export function AdminShellView({ me, reload }: { me: MeView; reload(): void }) {
  switch (shellPhase(me)) {
    case "loading":
      return (
        <main className="ad-solo">
          <Skeleton variant="lines" />
        </main>
      )
    case "login":
      return <Login onSuccess={reload} />
    case "error":
      return (
        <main className="ad-solo">
          <ErrorState error={me.error!} onRetry={reload} />
        </main>
      )
    case "ready":
      return (
        <QueueProvider onUnauthorized={reload}>
          <AdminLayout passwordless={me.data!.passwordless} onLoggedOut={reload}>
            <AdminRoutes />
          </AdminLayout>
        </QueueProvider>
      )
  }
}

export function AdminShell() {
  const { reload, ...me } = useFetch("admin:me", () => admin.me())
  return <AdminShellView me={me} reload={reload} />
}
