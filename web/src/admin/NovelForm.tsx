/**
 * ฟอร์มนิยาย (spec 7.4) — หน้า `/admin/novels/new` และ `/admin/novels/:id` (แท็บ "ข้อมูล" ทำที่นี่ · "ตอน"/"อภิธานศัพท์" ต่อใน Task 32/33)
 * `NovelFormView` ส่วนแสดงผลล้วน (เทสต์ด้วยการเรียกตรงๆ) · `NovelNew` / `NovelEdit` เป็นตัวถือสถานะ: ร่างข้อมูล บันทึก ให้ AI ช่วยกรอก ปก ลบ
 * กฎของข้อมูล (แท็ก ตรวจก่อนส่ง เติม/ย้อน AI เทียบช่องที่เปลี่ยน) อยู่ใน `novel-logic.ts` ที่ทดสอบโดยไม่ต้องมี DOM
 */
import { Sparkles, Trash2, Undo2 } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { Chip } from "../components/Chip"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Switch } from "../components/Switch"
import { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { CoverField } from "./CoverField"
import {
  aiFillNotice,
  applyAiFill,
  canAiFill,
  changedFields,
  deleteMessage,
  draftFromNovel,
  emptyDraft,
  firstInvalidId,
  inputFromDraft,
  isDirty,
  MODE_HINT,
  MODE_TEXT,
  novelTitles,
  settleAfterSave,
  STATUS_TEXT,
  STYLE_EXAMPLE,
  undoAiFill,
  validateDraft,
  type AiFillUndo,
  type DraftErrors,
  type NovelDraft,
} from "./novel-logic"
import { TagInput } from "./TagInput"
import type { AdminNovelDto, NovelMode, NovelStatus } from "./types"
import { useMounted } from "./useMounted"

const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

// ───────────────────────── ส่วนแสดงผล ─────────────────────────

export interface TextFieldProps {
  id: string
  label: string
  value: string
  /** ความยาวสูงสุดที่เซิร์ฟเวอร์รับ (นับหน่วยเดียวกัน) */
  max: number
  onChange(value: string): void
  required?: boolean
  error?: string
  hint?: string
  /** จำนวนบรรทัด = ช่องหลายบรรทัด (ไม่ระบุ = ช่องบรรทัดเดียว) */
  rows?: number
  type?: "text" | "url"
  placeholder?: string
  /** ส่วนเสริมใต้ช่อง (เช่น ปุ่มใส่ตัวอย่าง) */
  children?: ReactNode
}

/** ป้ายกำกับ + ช่องกรอก + คำอธิบาย + ข้อความผิดพลาด ผูกกันด้วย id/aria-describedby */
export function TextField(p: TextFieldProps) {
  const hintId = `${p.id}-hint`
  const errorId = `${p.id}-error`
  const describedBy = [p.hint !== undefined ? hintId : null, p.error !== undefined ? errorId : null].filter((id) => id !== null).join(" ")
  const common = {
    id: p.id,
    value: p.value,
    maxLength: p.max,
    placeholder: p.placeholder,
    "aria-required": p.required ? true : undefined,
    "aria-invalid": p.error !== undefined ? true : undefined,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    onChange: (event: { target: { value: string } }) => p.onChange(event.target.value),
  }
  return (
    <div className="ad-field">
      <label htmlFor={p.id}>
        {p.label}
        {p.required && (
          <span className="ad-req" aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>
      {p.rows !== undefined ? <textarea rows={p.rows} {...common} /> : <input type={p.type ?? "text"} inputMode={p.type === "url" ? "url" : undefined} autoComplete="off" {...common} />}
      {p.hint !== undefined && (
        <p id={hintId} className="ad-hint">
          {p.hint}
        </p>
      )}
      {p.error !== undefined && (
        <p id={errorId} className="ad-field-error">
          {p.error}
        </p>
      )}
      {p.children}
    </div>
  )
}

export interface AiState {
  busy: boolean
  error: string | null
  notice: string | null
  /** ยังย้อนกลับค่าที่ AI เติมได้ (ยังไม่ได้แก้ช่องที่ AI เติมต่อ) */
  canUndo: boolean
}

export interface NovelFormViewProps {
  mode: "create" | "edit"
  draft: NovelDraft
  /** ข้อผิดพลาดที่แสดงตอนนี้ (ตัวถือสถานะเป็นคนเลือกว่าจะโชว์เมื่อไร) */
  errors: DraftErrors
  /** มีการแก้ไขที่ยังไม่บันทึก (ใช้ตอนแก้ไขเรื่องเดิม) */
  dirty: boolean
  saving: boolean
  saveError: string | null
  notice: string | null
  ai: AiState
  /** ช่องปก (ตัวถือสถานะส่งเข้ามา) */
  cover: ReactNode
  onChange(patch: Partial<NovelDraft>): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
  onAiFill(): void
  onAiUndo(): void
  /** มีเฉพาะตอนแก้ไขเรื่องเดิม */
  onDelete?(): void
}

const STATUSES: NovelStatus[] = ["ongoing", "completed"]
const MODES: NovelMode[] = ["translate", "story"]

export function NovelFormView(p: NovelFormViewProps) {
  const { draft, errors, ai } = p
  const aiReady = canAiFill(draft)
  return (
    <form className="ad-form" onSubmit={p.onSubmit} noValidate>
      <div className="ad-form-grid">
        <div className="ad-form-main">
          <section className="ad-panel" aria-labelledby="nf-h-src">
            <div className="ad-panel-head">
              <h2 id="nf-h-src">ต้นฉบับ</h2>
              <p className="ad-panel-sub">จากเว็บที่คุณอ่าน</p>
            </div>
            <div className="ad-fields">
              <TextField id="nf-title" label="ชื่อต้นฉบับ" value={draft.title} max={300} required error={errors.title} onChange={(title) => p.onChange({ title })} />
              <TextField id="nf-author" label="ผู้แต่ง" value={draft.author} max={200} onChange={(author) => p.onChange({ author })} />
              <TextField id="nf-synopsisSrc" label="เรื่องย่อต้นฉบับ" value={draft.synopsisSrc} max={10000} rows={5} onChange={(synopsisSrc) => p.onChange({ synopsisSrc })} />
              <div className="ad-ai">
                <button type="button" className="btn ghost" data-ai="fill" disabled={!aiReady || ai.busy} onClick={p.onAiFill}>
                  <Sparkles size={17} aria-hidden="true" />
                  {ai.busy ? "AI กำลังทำงาน…" : "ให้ AI ช่วยแปลชื่อ + เรื่องย่อ + แนะนำแท็ก"}
                </button>
                <p className="ad-hint">ผลจะเติมลงช่องภาษาไทยด้านล่างให้แก้ต่อ และจะไม่ถูกเก็บจนกว่าคุณจะกดปุ่มบันทึก</p>
                {!aiReady && <p className="ad-hint">กรอกชื่อต้นฉบับก่อน AI ถึงจะแปลให้ได้</p>}
                {ai.error !== null && (
                  <p className="ad-field-error" role="alert" data-ai="error">
                    {ai.error}
                  </p>
                )}
                {ai.notice !== null && (
                  <p className="ad-ai-note" role="status" data-ai="notice">
                    {ai.notice}
                  </p>
                )}
                {ai.canUndo && (
                  <button type="button" className="btn ghost sm" data-ai="undo" onClick={p.onAiUndo}>
                    <Undo2 size={16} aria-hidden="true" />
                    ย้อนกลับ
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="ad-panel" aria-labelledby="nf-h-th">
            <div className="ad-panel-head">
              <h2 id="nf-h-th">ภาษาไทย</h2>
              <p className="ad-panel-sub">สิ่งที่ผู้อ่านเห็น</p>
            </div>
            <div className="ad-fields">
              <TextField id="nf-titleTh" label="ชื่อภาษาไทย" value={draft.titleTh} max={300} onChange={(titleTh) => p.onChange({ titleTh })} />
              <TextField id="nf-synopsis" label="เรื่องย่อภาษาไทย" value={draft.synopsis} max={10000} rows={5} onChange={(synopsis) => p.onChange({ synopsis })} />
              <div className="ad-field">
                <label htmlFor="nf-tags">แท็ก</label>
                <TagInput id="nf-tags" tags={draft.tags} onChange={(tags) => p.onChange({ tags })} />
              </div>
            </div>
          </section>

          <section className="ad-panel" aria-labelledby="nf-h-tr">
            <div className="ad-panel-head">
              <h2 id="nf-h-tr">การแปลและที่มา</h2>
            </div>
            <div className="ad-fields">
              <TextField
                id="nf-sourceUrl"
                label="ลิงก์ต้นฉบับ"
                value={draft.sourceUrl}
                max={2000}
                type="url"
                placeholder="https://"
                hint="ไม่บังคับ — ผู้อ่านเห็นเป็นลิงก์ “อ่านต้นฉบับ”"
                error={errors.sourceUrl}
                onChange={(sourceUrl) => p.onChange({ sourceUrl })}
              />
              <TextField
                id="nf-licenseNote"
                label="บันทึกสิทธิ์ / การอนุญาต"
                value={draft.licenseNote}
                max={2000}
                rows={2}
                hint="เก็บไว้ดูเอง เช่น ได้รับอนุญาตจากผู้แต่งทางอีเมลเมื่อไร (ผู้อ่านไม่เห็น)"
                onChange={(licenseNote) => p.onChange({ licenseNote })}
              />
              <div className="ad-field" role="group" aria-labelledby="nf-mode-label">
                <span id="nf-mode-label" className="ad-label">
                  โหมดการแปล
                </span>
                <div className="ad-chips">
                  {MODES.map((mode) => (
                    <Chip key={mode} selected={draft.mode === mode} onClick={() => p.onChange({ mode })}>
                      {MODE_TEXT[mode]}
                    </Chip>
                  ))}
                </div>
                <p className="ad-hint">{MODE_HINT[draft.mode]}</p>
              </div>
              <TextField
                id="nf-styleNote"
                label="สไตล์การแปล"
                value={draft.styleNote}
                max={3000}
                rows={5}
                hint="บอก AI เรื่องสรรพนาม น้ำเสียง หรือคำที่ต้องคงไว้ — ใช้กับทุกตอนของเรื่องนี้"
                onChange={(styleNote) => p.onChange({ styleNote })}
              >
                {draft.styleNote.trim() === "" && (
                  <button type="button" className="ad-link-btn" onClick={() => p.onChange({ styleNote: STYLE_EXAMPLE })}>
                    ใส่ตัวอย่าง
                  </button>
                )}
              </TextField>
            </div>
          </section>
        </div>

        <aside className="ad-form-side">
          <section className="ad-panel" aria-labelledby="nf-h-cover">
            <div className="ad-panel-head">
              <h2 id="nf-h-cover">ปก</h2>
            </div>
            {p.cover}
          </section>

          <section className="ad-panel" aria-labelledby="nf-h-show">
            <div className="ad-panel-head">
              <h2 id="nf-h-show">การแสดงผล</h2>
            </div>
            <div className="ad-fields">
              <div className="ad-field" role="group" aria-labelledby="nf-status-label">
                <span id="nf-status-label" className="ad-label">
                  สถานะของเรื่อง
                </span>
                <div className="ad-chips">
                  {STATUSES.map((status) => (
                    <Chip key={status} selected={draft.status === status} onClick={() => p.onChange({ status })}>
                      {STATUS_TEXT[status]}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="ad-field">
                <Switch checked={draft.published} onChange={(published) => p.onChange({ published })} label="เผยแพร่ให้ผู้อ่านเห็น" />
                <p className="ad-hint">เรื่องใหม่เป็นร่างจนกว่าจะเปิดสวิตช์นี้ · ผู้อ่านเห็นเฉพาะตอนที่เผยแพร่แล้ว จึงต้องเผยแพร่ทีละตอนด้วย</p>
              </div>
              <div className="ad-field">
                <Switch checked={draft.featured} onChange={(featured) => p.onChange({ featured })} label="เรื่องแนะนำ (ขึ้นเด่นที่หน้าแรก)" />
                <p className="ad-hint">มีได้เรื่องเดียว — เปิดที่เรื่องนี้จะยกเลิกเรื่องแนะนำเดิม</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="ad-form-bar">
        <div className="ad-form-bar-main">
          <button type="submit" className="btn primary" disabled={p.saving || (p.mode === "edit" && !p.dirty)}>
            {p.saving ? "กำลังบันทึก…" : p.mode === "create" ? "สร้างเรื่อง" : "บันทึก"}
          </button>
          {p.mode === "edit" && p.dirty && !p.saving && <span className="ad-form-note">มีการแก้ไขที่ยังไม่บันทึก</span>}
          {p.notice !== null && (
            <p className="ad-form-note ad-form-ok" role="status">
              {p.notice}
            </p>
          )}
          {p.saveError !== null && (
            <p className="ad-field-error" role="alert">
              {p.saveError}
            </p>
          )}
        </div>
        {p.mode === "edit" && p.onDelete !== undefined && (
          <button type="button" className="btn ghost sm ad-danger-ghost" onClick={p.onDelete}>
            <Trash2 size={17} aria-hidden="true" />
            ลบเรื่องนี้
          </button>
        )}
      </div>
    </form>
  )
}

// ───────────────────────── แท็บของหน้าเรื่อง ─────────────────────────

export type NovelTab = "info" | "chapters" | "glossary"

/** แท็บจาก `?tab=` · ไม่มี/ไม่รู้จัก → ข้อมูล */
export function parseTab(value: string | null): NovelTab {
  return value === "chapters" || value === "glossary" ? value : "info"
}

export function NovelTabs({ id, tab, chapterCount }: { id: number; tab: NovelTab; chapterCount: number }) {
  const items: [NovelTab, string][] = [
    ["info", "ข้อมูล"],
    ["chapters", "ตอน"],
    ["glossary", "อภิธานศัพท์"],
  ]
  return (
    <nav className="ad-tabs" aria-label="ส่วนต่างๆ ของเรื่อง">
      {items.map(([key, label]) => (
        <Link key={key} to={key === "info" ? `/admin/novels/${id}` : `/admin/novels/${id}?tab=${key}`} className="ad-tab" aria-current={tab === key ? "page" : undefined}>
          {label}
          {key === "chapters" && (
            <>
              {" "}
              <span className="ad-tab-n">{chapterCount}</span>
            </>
          )}
        </Link>
      ))}
    </nav>
  )
}

// ───────────────────────── ตัวถือสถานะ ─────────────────────────

/** เตือนของเบราว์เซอร์ตอนปิด/รีเฟรชแท็บขณะมีแก้ไขค้าง (ไม่ใช่ `confirm()`) · เปลี่ยนหน้าในแอปไม่ถูกกัน */
function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])
}

/** ร่างข้อมูล + ปุ่ม "ให้ AI ช่วย" (ใช้ร่วมกันทั้งสร้างและแก้ไข) */
function useNovelDraft(initial: NovelDraft) {
  const mounted = useMounted()
  const [draft, setDraft] = useState(initial)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [ai, setAi] = useState<AiState>({ busy: false, error: null, notice: null, canUndo: false })
  const undoRef = useRef<AiFillUndo | null>(null)
  const aiWorking = useRef(false)

  function patch(change: Partial<NovelDraft>): void {
    setDraft((current) => ({ ...current, ...change }))
    // แก้ช่องที่ AI เติมต่อเอง → ย้อนกลับไม่ได้แล้ว (ไม่งั้นการย้อนจะทับสิ่งที่เพิ่งพิมพ์)
    if ("titleTh" in change || "synopsis" in change || "tags" in change) setAi((current) => (current.canUndo ? { ...current, canUndo: false } : current))
  }

  async function fillWithAi(): Promise<void> {
    const start = draftRef.current
    if (aiWorking.current || !canAiFill(start)) return
    aiWorking.current = true
    setAi({ busy: true, error: null, notice: null, canUndo: false })
    try {
      const result = await admin.aiFill({ title: start.title, synopsisSrc: start.synopsisSrc, author: start.author })
      if (!mounted.current) return
      // ใช้ร่างล่าสุด (เจ้าของอาจพิมพ์ช่องอื่นระหว่างรอ AI) ไม่ใช่ร่างตอนกดปุ่ม
      const before = draftRef.current
      const out = applyAiFill(before, result)
      const changed = out.draft.titleTh !== before.titleTh || out.draft.synopsis !== before.synopsis || out.draft.tags.length !== before.tags.length
      undoRef.current = out.undo
      setDraft((current) => ({ ...current, titleTh: out.draft.titleTh, synopsis: out.draft.synopsis, tags: out.draft.tags }))
      setAi({ busy: false, error: null, notice: aiFillNotice(before, out.draft), canUndo: changed })
    } catch (e) {
      if (mounted.current) setAi({ busy: false, error: messageOf(e), notice: null, canUndo: false })
    } finally {
      aiWorking.current = false
    }
  }

  function undoAi(): void {
    const undo = undoRef.current
    if (undo === null) return
    setDraft((current) => undoAiFill(current, undo))
    setAi({ busy: false, error: null, notice: "ย้อนกลับค่าที่ AI เติมแล้ว", canUndo: false })
  }

  return { draft, setDraft, draftRef, patch, ai, fillWithAi, undoAi }
}

function focusField(id: string | null): void {
  if (id !== null) document.getElementById(id)?.focus()
}

/** `/admin/novels/new` */
export function NovelNew() {
  useDocumentTitle("เพิ่มนิยายใหม่")
  const navigate = useNavigate()
  const mounted = useMounted()
  const { draft, patch, ai, fillWithAi, undoAi } = useNovelDraft(emptyDraft())
  const [pendingCover, setPendingCover] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const working = useRef(false)

  const errors = validateDraft(draft)
  useUnsavedGuard(!saving && (isDirty(emptyDraft(), draft) || pendingCover !== null))

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (working.current) return
    setShowErrors(true)
    if (firstInvalidId(errors) !== null) {
      focusField(firstInvalidId(errors))
      return
    }
    working.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const created = await admin.createNovel(inputFromDraft(draft))
      let notice = "สร้างเรื่องแล้ว — ต่อไปเพิ่มตอนได้เลย"
      if (pendingCover !== null) {
        try {
          await admin.putCover(created.id, pendingCover)
        } catch (e) {
          notice = `สร้างเรื่องแล้ว แต่อัปโหลดปกไม่สำเร็จ: ${messageOf(e)} — เลือกปกใหม่ได้ในหน้านี้`
        }
      }
      // เรื่องถูกสร้างแล้ว: ไปหน้าแก้ไขของมันเสมอ (กดซ้ำจะไม่สร้างซ้ำ)
      navigate(`/admin/novels/${created.id}`, { replace: true, state: { notice } })
    } catch (e) {
      if (mounted.current) setSaveError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <>
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">
            <Link to="/admin/novels">นิยาย</Link> / เรื่องใหม่
          </p>
          <h1>เพิ่มนิยายใหม่</h1>
        </div>
      </div>
      <NovelFormView
        mode="create"
        draft={draft}
        errors={showErrors ? errors : {}}
        dirty={false}
        saving={saving}
        saveError={saveError}
        notice={null}
        ai={ai}
        cover={<CoverField novel={null} title={novelTitles(draft).main || "ชื่อเรื่อง"} pending={pendingCover} onPending={setPendingCover} onSaved={() => {}} onRemoved={() => {}} />}
        onChange={patch}
        onSubmit={(event) => void submit(event)}
        onAiFill={() => void fillWithAi()}
        onAiUndo={undoAi}
      />
    </>
  )
}

/** `/admin/novels/:id` */
export function NovelEdit() {
  const { id: raw } = useParams()
  const id = raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
  const { data, error, loading, reload } = useFetch(`admin:novel:${id}`, () => (id === null ? Promise.reject(new ApiError(404, "ไม่พบนิยายเรื่องนี้", "not_found")) : admin.novel(id)))
  useDocumentTitle(data !== null ? `จัดการ ${novelTitles(data).main}` : "นิยาย")

  if (data === null || loading) {
    const heading = (
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">
            <Link to="/admin/novels">นิยาย</Link>
          </p>
          <h1>จัดการนิยาย</h1>
        </div>
      </div>
    )
    if (error === null) return <>{heading}<Skeleton variant="lines" /></>
    if (error.status === 404) {
      return (
        <>
          {heading}
          <EmptyState
            title="ไม่พบนิยายเรื่องนี้"
            hint="อาจถูกลบไปแล้ว"
            action={
              <Link to="/admin/novels" className="btn primary">
                กลับไปรายการนิยาย
              </Link>
            }
          />
        </>
      )
    }
    return <>{heading}<ErrorState error={error} onRetry={reload} /></>
  }
  return <NovelEditor key={data.id} initial={data} />
}

function NovelEditor({ initial }: { initial: AdminNovelDto }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const tab = parseTab(params.get("tab"))
  const mounted = useMounted()
  const [novel, setNovel] = useState(initial)
  const [saved, setSaved] = useState(() => draftFromNovel(initial))
  const { draft, setDraft, draftRef, patch, ai, fillWithAi, undoAi } = useNovelDraft(saved)
  const [pendingCover, setPendingCover] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => {
    const state: unknown = location.state
    return typeof state === "object" && state !== null && "notice" in state && typeof state.notice === "string" ? state.notice : null
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const working = useRef(false)

  const errors = validateDraft(draft)
  const dirty = isDirty(saved, draft)
  useUnsavedGuard(dirty && !saving)
  const { main } = novelTitles(novel)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (working.current) return
    setShowErrors(true)
    if (firstInvalidId(errors) !== null) {
      focusField(firstInvalidId(errors))
      return
    }
    const changes = changedFields(saved, draft)
    if (Object.keys(changes).length === 0) return
    const submitted = draft
    working.current = true
    setSaving(true)
    setSaveError(null)
    setNotice(null)
    try {
      const updated = await admin.patchNovel(novel.id, changes)
      if (!mounted.current) return
      const server = draftFromNovel(updated)
      setNovel(updated)
      setSaved(server)
      // ช่องที่เจ้าของพิมพ์เพิ่มระหว่างรอไม่ถูกทับ
      setDraft(settleAfterSave(submitted, draftRef.current, server))
      setShowErrors(false)
      setNotice("บันทึกแล้ว")
    } catch (e) {
      if (mounted.current) setSaveError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    await admin.deleteNovel(novel.id) // ล้มเหลว → ConfirmDialog แสดงข้อความเอง
    navigate("/admin/novels", { replace: true })
  }

  return (
    <>
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">
            <Link to="/admin/novels">นิยาย</Link> / {main}
          </p>
          <h1>{main}</h1>
        </div>
        <div className="ad-ph-actions">
          <Link to={`/novel/${novel.id}`} className="btn ghost sm">
            ดูหน้านิยาย
          </Link>
          <Link to={`/admin/add?novel=${novel.id}`} className="btn primary sm">
            เพิ่มตอน
          </Link>
        </div>
      </div>
      <NovelTabs id={novel.id} tab={tab} chapterCount={novel.chapterCount} />
      {tab === "info" ? (
        <NovelFormView
          mode="edit"
          draft={draft}
          errors={showErrors ? errors : {}}
          dirty={dirty}
          saving={saving}
          saveError={saveError}
          notice={notice}
          ai={ai}
          cover={
            <CoverField
              novel={novel}
              title={main}
              pending={pendingCover}
              onPending={setPendingCover}
              onSaved={(coverV) => setNovel((current) => ({ ...current, hasCover: true, coverV }))}
              onRemoved={() => setNovel((current) => ({ ...current, hasCover: false, coverV: 0 }))}
            />
          }
          onChange={(change) => {
            setNotice(null)
            patch(change)
          }}
          onSubmit={(event) => void submit(event)}
          onAiFill={() => void fillWithAi()}
          onAiUndo={undoAi}
          onDelete={() => setConfirmDelete(true)}
        />
      ) : (
        <EmptyState title={tab === "chapters" ? "ตารางตอนกำลังสร้างในขั้นถัดไป" : "อภิธานศัพท์กำลังสร้างในขั้นถัดไป"} hint="ระหว่างนี้แก้ข้อมูลเรื่องได้ที่แท็บ “ข้อมูล”" />
      )}
      {confirmDelete && <ConfirmDialog title="ลบนิยายเรื่องนี้?" message={deleteMessage(novel)} confirmLabel="ลบถาวร" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)} />}
    </>
  )
}
