/**
 * แอปหน้าเว็บ: ตารางเส้นทาง (เขียนเป็นข้อมูล `routes` ให้เทสต์ตรวจได้ด้วย `matchRoutes`) + ข้อมูลเว็บ + ตาข่ายกันหน้าขาว
 * ในโครงหน้าสาธารณะ (`Layout`): หน้าแรก, หน้านิยาย, เกี่ยวกับ, ติดต่อ และ "ไม่พบหน้านี้" สำหรับที่อยู่อื่นทั้งหมด
 * นอกโครงหน้า: หน้าอ่าน (เต็มจอ) และหลังบ้าน (โหลดแบบ lazy — ผู้อ่านทั่วไปไม่ต้องโหลดโค้ดหลังบ้าน)
 */
import { lazy, Suspense } from "react"
import { useLocation, useRoutes, type RouteObject } from "react-router"
import { AppErrorBoundary } from "./components/AppErrorBoundary"
import { Layout } from "./components/Layout"
import { Skeleton } from "./components/Skeleton"
import { I18nProvider } from "./i18n/I18nProvider"
import { SiteProvider } from "./lib/SiteContext"
import { About } from "./pages/About"
import { Contact } from "./pages/Contact"
import { Home } from "./pages/Home"
import { NotFound } from "./pages/NotFound"
import { Novel } from "./pages/Novel"
import { Reader } from "./pages/Reader"

const AdminApp = lazy(() => import("./admin/AdminApp"))

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: "novel/:id", element: <Novel /> },
      { path: "about", element: <About /> },
      { path: "contact", element: <Contact /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  { path: "novel/:id/:number", element: <Reader /> },
  {
    path: "admin/*",
    element: (
      <Suspense
        fallback={
          <div className="wrap main">
            <Skeleton variant="lines" />
          </div>
        }
      >
        <I18nProvider fixedLocale="th">
          <AdminApp />
        </I18nProvider>
      </Suspense>
    ),
  },
]

export function App() {
  const { pathname } = useLocation()
  const page = useRoutes(routes)
  return (
    <I18nProvider>
      <AppErrorBoundary resetKey={pathname}>
        <SiteProvider>{page}</SiteProvider>
      </AppErrorBoundary>
    </I18nProvider>
  )
}
