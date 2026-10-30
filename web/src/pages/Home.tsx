/**
 * หน้าแรก `/` (spec 6.1): Hero → อ่านต่อจากที่ค้างไว้ → อัปเดตล่าสุด → นิยายทั้งหมด (กรอง/เรียง/แสดงเพิ่ม)
 * `/?q=คำค้น` ซ่อน Hero อ่านต่อ และอัปเดตล่าสุด แสดงเฉพาะผลการค้นหาในส่วนนิยายทั้งหมด (ค้นฝั่งผู้อ่านจากรายการที่โหลดมาแล้ว)
 * แยกเป็น `HomeView` (ไม่ดึงข้อมูล ไม่อ่าน localStorage ทดสอบง่าย) กับ `Home` (ดึงข้อมูล อ่านประวัติ/ความคืบหน้าในเครื่อง ตั้งชื่อแท็บ)
 */
import { Link, useLocation } from "react-router"
import { ContinueRow } from "../components/ContinueRow"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Hero } from "../components/Hero"
import { Library } from "../components/Library"
import { NovelRow } from "../components/NovelRow"
import { Skeleton } from "../components/Skeleton"
import { publicApi } from "../lib/api"
import { continueItems, latestUpdates, pickHero, resumeInfo } from "../lib/library"
import { getHistory, getProgress, type Progress } from "../lib/progress"
import { shownSiteName, FALLBACK_SITE_NAME } from "../lib/title"
import { queryOf } from "../lib/search"
import { useSite } from "../lib/SiteContext"
import type { NovelCardDto } from "../lib/types"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"

export interface HomeViewProps {
  novels: NovelCardDto[]
  /** คำค้นจาก URL ตัดช่องว่างหัวท้ายแล้ว (ว่าง = หน้าแรกปกติ) */
  query: string
  isAdmin: boolean
  siteName: string
  /** id นิยายที่เพิ่งอ่าน ล่าสุดก่อน (จากเครื่องผู้อ่าน) */
  history: number[]
  progressOf: (id: number) => Progress | null
  now?: number
}

export function HomeView({ novels, query, isAdmin, siteName, history, progressOf, now }: HomeViewProps) {
  if (novels.length === 0) {
    return (
      <div className="home">
        <h1 className="sr-only">{siteName}</h1>
        <EmptyState
          title="ยังไม่มีนิยายให้อ่าน"
          hint="กลับมาใหม่เร็วๆ นี้"
          action={
            isAdmin ? (
              <Link to="/admin" className="btn primary">
                ไปหลังบ้านเพื่อเพิ่มนิยาย
              </Link>
            ) : undefined
          }
        />
      </div>
    )
  }

  const searching = query !== ""
  if (searching) {
    // key={query}: ค้นคำใหม่ = ตารางเริ่มใหม่ (ตัวกรองและจำนวนที่แสดงกลับค่าเริ่มต้น)
    return (
      <div className="home">
        <Library key={query} novels={novels} query={query} asPageHeading now={now} />
      </div>
    )
  }

  const hero = pickHero(novels)
  const heroProgress = hero === null ? null : progressOf(hero.id)
  return (
    <div className="home">
      <h1 className="sr-only">{siteName}</h1>
      {hero !== null ? <Hero novel={hero} resume={heroProgress === null ? null : resumeInfo(hero, heroProgress)} /> : null}
      <ContinueRow items={continueItems(novels, history, progressOf)} />
      <NovelRow title="อัปเดตล่าสุด" novels={latestUpdates(novels)} now={now} />
      <Library key="" novels={novels} query="" asPageHeading={false} now={now} />
    </div>
  )
}

export function Home() {
  const { pathname, search } = useLocation()
  const query = queryOf(pathname, search).trim()
  const status = useSite()
  const { data, error, reload } = useFetch("novels", (signal) => publicApi.novels(signal))
  useDocumentTitle(query === "" ? null : `ค้นหา “${query}”`)

  if (error !== null) return <ErrorState error={error} onRetry={reload} />
  if (data === null) return <Skeleton variant="grid" />
  return <HomeView novels={data} query={query} isAdmin={status.site?.isAdmin ?? false} siteName={shownSiteName(status) ?? FALLBACK_SITE_NAME} history={getHistory()} progressOf={getProgress} />
}
