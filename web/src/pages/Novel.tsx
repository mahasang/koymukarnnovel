/**
 * หน้าเรื่อง `/novel/:id` (spec 6.2): ปก ชื่อ ผู้แต่ง สถานะ แท็ก ปุ่ม "เริ่มอ่าน"/"อ่านต่อ ตอนที่ N" + "ตอนล่าสุด"
 * เรื่องย่อ (พับได้) กล่องเครดิต และรายการตอน 50 ตอนต่อหน้า
 * แยกเป็น `NovelView` (ไม่ดึงข้อมูล ไม่อ่าน localStorage) · `NovelPage` (อ่านความคืบหน้าในเครื่อง ตั้งชื่อแท็บ) ·
 * `NovelContent` (เลือกว่าจะแสดง ไม่พบ/ผิดพลาด/กำลังโหลด/หน้าเรื่อง) · `Novel` (อ่านเลขจาก URL แล้วโหลดข้อมูล)
 */
import { Play } from "lucide-react"
import { useMemo } from "react"
import { Link, useParams } from "react-router"
import { ChapterList } from "../components/ChapterList"
import { Cover } from "../components/Cover"
import { CreditBox } from "../components/CreditBox"
import { DraftBadge } from "../components/DraftBadge"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Synopsis } from "../components/Synopsis"
import { publicApi, type ApiError } from "../lib/api"
import { latestChapter, readAction } from "../lib/chapter-list"
import { useI18n } from "../i18n/I18nProvider"
import { timeAgo } from "../lib/format"
import { displayTitle, parseNovelId } from "../lib/novel"
import { getProgress, type Progress } from "../lib/progress"
import type { NovelDetailDto } from "../lib/types"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { NotFound } from "./NotFound"

export function NovelView({ novel, progress, now }: { novel: NovelDetailDto; progress: Progress | null; now?: number }) {
  const title = displayTitle(novel)
  // ไม่มีชื่อไทย → `title` ก็คือชื่อต้นฉบับอยู่แล้ว จึงไม่ซ้ำเป็นบรรทัดรอง
  const original = novel.title.trim() !== title ? novel.title.trim() : ""
  const author = novel.author.trim()
  const ongoing = novel.status === "ongoing"
  const { m } = useI18n()
  const updated = timeAgo(novel.updatedAt, m, now)
  const base = `/novel/${novel.id}`
  const action = readAction(novel.chapters, progress)
  const latest = latestChapter(novel.chapters)
  // ปุ่ม "ตอนล่าสุด" ซ้ำกับปุ่มหลักเมื่อทั้งสองพาไปตอนเดียวกัน (เรื่องที่มีตอนเดียว หรืออ่านทันแล้ว) — เหลือปุ่มเดียว
  const showLatest = latest !== null && latest !== action?.number

  return (
    <article className="novel">
      <div className="nv-head">
        <div className="nv-cover">
          <Cover novel={{ id: novel.id, title, hasCover: novel.hasCover, coverV: novel.coverV }} alt={title} />
        </div>
        <div className="nv-info">
          <h1 className="nv-title">{title}</h1>
          {original !== "" ? <p className="nv-orig">{original}</p> : null}
          {author !== "" ? <p className="nv-author">โดย {author}</p> : null}
          <div className="nv-facts">
            <span className={ongoing ? "pill st" : "pill"}>{ongoing ? "ยังไม่จบ" : "จบแล้ว"}</span>
            {novel.chapters.length > 0 ? <span className="pill">{novel.chapters.length} ตอน</span> : null}
            {updated !== "" ? <span className="pill">อัปเดต {updated}</span> : null}
            {novel.published ? null : <DraftBadge />}
          </div>
          {novel.tags.length > 0 ? (
            <div className="nv-tags">
              {novel.tags.map((tag) => (
                <span className="pill" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          <div className="nv-cta">
            {action !== null ? (
              <Link to={`${base}/${action.number}`} className="btn primary">
                <Play aria-hidden="true" size={16} />
                {action.label}
              </Link>
            ) : null}
            {showLatest ? (
              <Link to={`${base}/${latest}`} className="btn ghost">
                ตอนล่าสุด<span className="sr-only"> (ตอนที่ {latest})</span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
      <Synopsis text={novel.synopsis} />
      <CreditBox author={novel.author} sourceUrl={novel.sourceUrl} licenseNote={novel.licenseNote} />
      <ChapterList novelId={novel.id} chapters={novel.chapters} lastRead={progress?.number ?? null} />
    </article>
  )
}

export function NovelPage({ novel, now }: { novel: NovelDetailDto; now?: number }) {
  // อ่านครั้งเดียวต่อเรื่อง (หน้านี้วาดใหม่ได้จากเหตุอื่น เช่น ข้อมูลเว็บเปลี่ยน — ไม่ต้องแยกวิเคราะห์ localStorage ซ้ำ); กลับมาจากหน้าอ่านคือเปิดหน้านี้ใหม่ จึงได้ค่าล่าสุดเสมอ
  // (สถานะของรายการตอน/ช่องพิมพ์อยู่ใน ChapterList เอง การพิมพ์จึงไม่ทำให้หน้านี้วาดใหม่)
  const progress = useMemo(() => getProgress(novel.id), [novel.id])
  useDocumentTitle(displayTitle(novel))
  return <NovelView novel={novel} progress={progress} now={now} />
}

export interface NovelContentProps {
  /** เลขนิยายจาก URL; `null` = ใช้ไม่ได้ */
  id: number | null
  data: NovelDetailDto | null
  error: ApiError | null
  onRetry: () => void
  now?: number
}

export function NovelContent({ id, data, error, onRetry, now }: NovelContentProps) {
  if (id === null || error?.status === 404) return <NotFound />
  if (error !== null) return <ErrorState error={error} onRetry={onRetry} />
  if (data === null) return <Skeleton variant="lines" count={8} />
  return <NovelPage key={data.id} novel={data} now={now} />
}

export function Novel() {
  const id = parseNovelId(useParams().id)
  const { data, error, reload } = useFetch(id === null ? null : `novel:${id}`, (signal) => publicApi.novel(id ?? 0, signal))
  return <NovelContent id={id} data={data} error={error} onRetry={reload} />
}
