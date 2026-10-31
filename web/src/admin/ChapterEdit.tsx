/**
 * หน้าแก้ตอน (spec 7.7): ต้นฉบับ | คำแปล สองคอลัมน์ + ชื่อ/ชื่อไทย/เรื่องย่อ · บันทึก (ส่งเฉพาะฟิลด์ที่เปลี่ยน) · แปลใหม่ · เผยแพร่/ซ่อน · ตอนก่อนหน้า/ถัดไป
 * `ChapterEditView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `ChapterEdit` เป็นหน้าของเส้นทาง · `ChapterEditor` ถือสถานะ:
 * ดึงสถานะซ้ำทุก 2 วินาทีเมื่อรอคิว/กำลังแปล (ช่องที่เจ้าของแก้ค้างไว้ไม่ถูกทับ) และถามก่อนไปตอนอื่นถ้ามีแก้ที่ยังไม่บันทึก
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { POLL_MS, STATUS_TONE } from "./chapter-logic"
import {
  actionState,
  type ChapterDraft,
  changedFields,
  draftOf,
  isDirty,
  LEAVE_MESSAGE,
  lengthLabel,
  lockedFields,
  neighbors,
  rebase,
  saveNotice,
  translationNote,
} from "./chapter-edit-logic"
import { bulkNotice } from "./chapter-logic"
import { thaiDateTime } from "./dashboard-logic"
import { STATUS_LABEL } from "./format"
import { novelTitles } from "./novel-logic"
import { TextField, useUnsavedGuard } from "./NovelForm"
import { useQueue } from "./QueueContext"
import type { AdminChapterDto, AdminChapterRow } from "./types"
import { useMounted } from "./useMounted"

const ICON = 18
const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")
const isLive = (chapter: AdminChapterDto): boolean => chapter.status === "queued" || chapter.status === "translating"

export interface ChapterEditViewProps {
  /** ตอนตามที่เซิร์ฟเวอร์เก็บ */
  chapter: AdminChapterDto
  novelTitle: string
  /** ค่าในช่องตอนนี้ (อาจมีแก้ค้าง) */
  draft: ChapterDraft
  prev: AdminChapterRow | null
  next: AdminChapterRow | null
  saving: boolean
  /** กำลังสั่งแปล/เผยแพร่/ซ่อนอยู่ */
  working: boolean
  notice: string | null
  error: string | null
  onChange(patch: Partial<ChapterDraft>): void
  onSave(): void
  onTranslate(): void
  onToggle(publish: boolean): void
  onGo(row: AdminChapterRow): void
}

export function ChapterEditView(p: ChapterEditViewProps) {
  const { chapter, draft } = p
  const dirty = isDirty(draftOf(chapter), draft)
  const act = actionState(chapter, dirty)
  const locked = lockedFields(chapter.status)
  const note = translationNote(chapter)
  const main = chapter.titleTh !== "" ? chapter.titleTh : chapter.title
  const idle = !p.saving && !p.working
  const when = chapter.translatedAt === null ? "" : thaiDateTime(chapter.translatedAt)

  return (
    <form
      className="ad-form"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        p.onSave()
      }}
    >
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">
            <Link to="/admin/novels">นิยาย</Link> / <Link to={`/admin/novels/${chapter.novelId}?tab=chapters`}>{p.novelTitle}</Link>
          </p>
          <h1>{`ตอนที่ ${chapter.number} — ${main}`}</h1>
        </div>
        <div className="ad-ph-actions ad-ce-nav">
          <button
            type="button"
            className="btn ghost sm"
            data-nav="prev"
            disabled={p.prev === null || p.saving}
            aria-label={p.prev === null ? "ไม่มีตอนก่อนหน้า" : `ไปตอนก่อนหน้า (ตอนที่ ${p.prev.number})`}
            onClick={() => p.prev !== null && p.onGo(p.prev)}
          >
            <ChevronLeft size={ICON} aria-hidden="true" />
            ก่อนหน้า
          </button>
          <button
            type="button"
            className="btn ghost sm"
            data-nav="next"
            disabled={p.next === null || p.saving}
            aria-label={p.next === null ? "ไม่มีตอนถัดไป" : `ไปตอนถัดไป (ตอนที่ ${p.next.number})`}
            onClick={() => p.next !== null && p.onGo(p.next)}
          >
            ถัดไป
            <ChevronRight size={ICON} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="ad-ce-stat">
        <span className="ad-pill" data-tone={STATUS_TONE[chapter.status]}>
          {STATUS_LABEL[chapter.status]}
        </span>
        {` ${chapter.published ? "เผยแพร่แล้ว" : "ยังไม่เผยแพร่"} · แปลเมื่อ ${when === "" ? "—" : when}`}
      </p>
      {chapter.status === "error" && chapter.error !== "" && <p className="ad-ce-error">{`การแปลครั้งล่าสุดล้มเหลว: ${chapter.error}`}</p>}

      <div className="ad-panel">
        <div className="ad-fields">
          <TextField id="ce-title" label="ชื่อตอน (ต้นฉบับ)" value={draft.title} max={300} onChange={(title) => p.onChange({ title })} />
          <TextField id="ce-titleTh" label="ชื่อตอน (ภาษาไทย)" value={draft.titleTh} max={300} onChange={(titleTh) => p.onChange({ titleTh })} />
          <TextField
            id="ce-recap"
            label="เรื่องย่อของตอน"
            value={draft.recap}
            max={2000}
            rows={3}
            hint="AI ใช้เป็นความจำให้ตอนถัดไป — แก้ให้ตรงเรื่องจะช่วยให้ตอนต่อไปแปลต่อเนื่อง"
            onChange={(recap) => p.onChange({ recap })}
          />
        </div>
      </div>

      <div className="ad-ce-cols">
        <section className="ad-panel" aria-labelledby="ce-h-src">
          <div className="ad-panel-head">
            <h2 id="ce-h-src">ต้นฉบับ</h2>
            <p className="ad-panel-sub" data-count="sourceText">
              {lengthLabel(draft.sourceText)}
            </p>
          </div>
          <TextField id="ce-sourceText" label="ข้อความต้นฉบับ" value={draft.sourceText} max={200000} rows={22} disabled={locked.sourceText} onChange={(sourceText) => p.onChange({ sourceText })} />
        </section>
        <section className="ad-panel" aria-labelledby="ce-h-tr">
          <div className="ad-panel-head">
            <h2 id="ce-h-tr">คำแปล</h2>
            <p className="ad-panel-sub" data-count="translation">
              {lengthLabel(draft.translation)}
            </p>
          </div>
          <TextField id="ce-translation" label="ข้อความคำแปล" value={draft.translation} max={400000} rows={22} disabled={locked.translation} hint={note ?? undefined} onChange={(translation) => p.onChange({ translation })} />
        </section>
      </div>

      <div className="ad-form-bar">
        <div className="ad-form-bar-main">
          <button type="submit" className="btn primary" disabled={!act.canSave || p.saving || p.working}>
            {p.saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          <button type="button" className="btn ghost" data-act="translate" disabled={!act.canTranslate || !idle} onClick={p.onTranslate}>
            {act.translateLabel}
          </button>
          <button type="button" className="btn ghost" data-act="toggle" disabled={!act.canToggle || !idle} onClick={() => p.onToggle(act.toggleTo)}>
            {act.toggleLabel}
          </button>
          {dirty && !p.saving && <span className="ad-form-note">มีการแก้ไขที่ยังไม่บันทึก</span>}
          {p.notice !== null && (
            <p className="ad-form-note ad-form-ok" role="status">
              {p.notice}
            </p>
          )}
          {p.error !== null && (
            <p className="ad-field-error" role="alert">
              {p.error}
            </p>
          )}
        </div>
        {act.reason !== null && (
          <p className="ad-hint" data-kind="reason">
            {act.reason}
          </p>
        )}
      </div>
    </form>
  )
}

// ───────────────────────── ตัวถือสถานะ ─────────────────────────

function ChapterEditor({ initial, novelTitle, siblings }: { initial: AdminChapterDto; novelTitle: string; siblings: AdminChapterRow[] }) {
  const navigate = useNavigate()
  const queue = useQueue()
  const mounted = useMounted()
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(() => draftOf(initial))
  const [saving, setSaving] = useState(false)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<AdminChapterRow | null>(null)
  const [tick, setTick] = useState(0)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const draftRef = useRef(draft)
  draftRef.current = draft
  const busy = useRef(false)
  /** เพิ่มทุกครั้งที่เราเปลี่ยนตอนเอง: ผลดึงซ้ำที่เริ่มก่อนหน้านั้นเป็นของเก่า ไม่ใช้ */
  const version = useRef(0)

  const dirty = isDirty(draftOf(saved), draft)
  useUnsavedGuard(dirty && !saving)
  useDocumentTitle(`แก้ตอนที่ ${saved.number}`)
  const near = neighbors(siblings, saved.id)

  function adopt(next: AdminChapterDto): void {
    setDraft((current) => rebase(current, draftOf(savedRef.current), draftOf(next)))
    setSaved(next)
  }

  // ดึงซ้ำทุก POLL_MS ตราบที่ตอนยังรอคิว/กำลังแปล · ดึงล้มเหลวก็ลองใหม่ต่อ (ของเดิมยังโชว์)
  useEffect(() => {
    if (!isLive(saved)) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      const started = version.current
      admin
        .chapter(saved.id)
        .then((next) => {
          if (!cancelled && mounted.current && !busy.current && started === version.current) adopt(next)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled && mounted.current) setTick((n) => n + 1)
        })
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [saved.id, saved.status, tick])

  async function refresh(): Promise<void> {
    adopt(await admin.chapter(saved.id))
    queue.reload()
  }

  async function save(): Promise<void> {
    if (busy.current) return
    const submitted = draftRef.current
    const patch = changedFields(draftOf(savedRef.current), submitted)
    if (Object.keys(patch).length === 0) return
    busy.current = true
    version.current += 1
    setSaving(true)
    setNotice(null)
    setError(null)
    try {
      const before = savedRef.current
      const server = await admin.patchChapter(before.id, patch)
      if (!mounted.current) return
      // ช่องที่พิมพ์เพิ่มระหว่างรอไม่ถูกทับ
      setDraft((current) => rebase(current, submitted, draftOf(server)))
      setSaved(server)
      setNotice(saveNotice(patch, before, server))
      queue.reload()
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function command(task: () => Promise<string>): Promise<void> {
    if (busy.current) return
    busy.current = true
    version.current += 1
    setWorking(true)
    setNotice(null)
    setError(null)
    try {
      const message = await task()
      if (!mounted.current) return
      await refresh()
      if (mounted.current) setNotice(message)
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    } finally {
      busy.current = false
      if (mounted.current) setWorking(false)
    }
  }

  const translate = () => command(async () => bulkNotice("translate", await admin.bulk({ ids: [saved.id], action: "translate" })))
  const toggle = (publish: boolean) => command(async () => bulkNotice(publish ? "publish" : "hide", await admin.bulk({ ids: [saved.id], action: publish ? "publish" : "hide" })))

  const go = (row: AdminChapterRow) => (dirty ? setLeaving(row) : navigate(`/admin/novels/${saved.novelId}/chapters/${row.id}`))

  return (
    <>
      <ChapterEditView
        chapter={saved}
        novelTitle={novelTitle}
        draft={draft}
        prev={near.prev}
        next={near.next}
        saving={saving}
        working={working}
        notice={notice}
        error={error}
        onChange={(patch) => {
          setNotice(null)
          setDraft((current) => ({ ...current, ...patch }))
        }}
        onSave={() => void save()}
        onTranslate={() => void translate()}
        onToggle={(publish) => void toggle(publish)}
        onGo={go}
      />
      {leaving !== null && (
        <ConfirmDialog
          title="ไปตอนอื่นโดยไม่บันทึก?"
          message={LEAVE_MESSAGE}
          confirmLabel="ไปต่อ ไม่บันทึก"
          cancelLabel="อยู่ที่นี่ต่อ"
          danger
          onConfirm={() => navigate(`/admin/novels/${saved.novelId}/chapters/${leaving.id}`)}
          onCancel={() => setLeaving(null)}
        />
      )}
    </>
  )
}

/** หน้าของเส้นทาง `/admin/novels/:id/chapters/:chapterId` */
export function ChapterEdit() {
  const { id: rawNovel, chapterId: rawChapter } = useParams()
  const parse = (raw: string | undefined) => (raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null)
  const novelId = parse(rawNovel)
  const chapterId = parse(rawChapter)
  const chapter = useFetch(chapterId === null ? null : `admin:chapter:${chapterId}`, () => admin.chapter(chapterId!))
  const novel = useFetch(novelId === null ? null : `admin:novel:${novelId}`, () => admin.novel(novelId!))
  const list = useFetch(novelId === null ? null : `admin:chapter-nav:${novelId}`, () => admin.chapters(novelId!))
  useDocumentTitle("แก้ไขตอน")

  const heading = (
    <div className="ad-ph">
      <div className="ad-ph-text">
        <p className="ad-eyebrow">
          <Link to="/admin/novels">นิยาย</Link>
        </p>
        <h1>แก้ไขตอน</h1>
      </div>
    </div>
  )
  const back = (
    <Link to={novelId === null ? "/admin/novels" : `/admin/novels/${novelId}?tab=chapters`} className="btn primary">
      กลับไปรายการตอน
    </Link>
  )
  const missing = (
    <>
      {heading}
      <EmptyState title="ไม่พบตอนนี้ในเรื่องนี้" hint="อาจถูกลบไปแล้ว หรือที่อยู่ไม่ถูกต้อง" action={back} />
    </>
  )

  if (novelId === null || chapterId === null) return missing
  if (chapter.data === null || novel.data === null) {
    const failure = chapter.error ?? novel.error
    if (failure === null) {
      return (
        <>
          {heading}
          <Skeleton variant="lines" />
        </>
      )
    }
    if (failure.status === 404) return missing
    return (
      <>
        {heading}
        <ErrorState
          error={failure}
          onRetry={() => {
            chapter.reload()
            novel.reload()
          }}
        />
      </>
    )
  }
  if (chapter.data.novelId !== novelId) return missing
  // key = รหัสตอน: ไปตอนอื่นแล้วล้างร่างและสถานะทั้งหมด
  return <ChapterEditor key={chapter.data.id} initial={chapter.data} novelTitle={novelTitles(novel.data).main} siblings={list.data ?? []} />
}
