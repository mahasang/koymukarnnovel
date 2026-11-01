/**
 * อภิธานศัพท์ของเรื่อง (แท็บ "อภิธานศัพท์", spec 7.8): คำต้นฉบับ · คำไทย · หมายเหตุ · ป้าย "AI" · แก้ในแถว · ลบ · ตัวกรอง "เฉพาะที่ AI เพิ่ม"
 * รายการนี้ถูกส่งเข้า prompt ทุกครั้งที่แปลเรื่องนั้น · แก้แถวไหน เซิร์ฟเวอร์ตั้ง `auto` เป็น 0 ป้าย AI ของแถวนั้นจึงหาย · คำต้นฉบับซ้ำ → ข้อความ 409 ภาษาไทยของเซิร์ฟเวอร์
 * `GlossaryView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `Glossary` ถือสถานะ
 */
import { Check, Pencil, Plus, Trash2, X } from "lucide-react"
import { Fragment, type KeyboardEvent, useRef, useState } from "react"
import { Chip } from "../components/Chip"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { ApiError } from "../lib/api"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { aiCount, deleteTermMessage, draftOfTerm, EMPTY_TERM, filterTerms, summaryLine, termChanges, type TermDraft, type TermErrors, validateTerm } from "./glossary-logic"
import { TextField } from "./NovelForm"
import type { GlossaryDto } from "./types"
import { useMounted } from "./useMounted"

const ICON = 18
const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

export interface GlossaryViewProps {
  rows: GlossaryDto[]
  autoOnly: boolean
  add: TermDraft
  addErrors: TermErrors
  /** ข้อความที่เซิร์ฟเวอร์ตอบเมื่อเพิ่มไม่สำเร็จ (เช่น คำซ้ำ 409) */
  addError: string | null
  adding: boolean
  editingId: number | null
  edit: TermDraft
  editErrors: TermErrors
  editError: string | null
  /** กำลังบันทึกแถวที่แก้ (ปุ่มของทุกแถวปิด) */
  saving: boolean
  notice: string | null
  onAddChange(patch: Partial<TermDraft>): void
  onAdd(): void
  onFilter(autoOnly: boolean): void
  onEdit(row: GlossaryDto): void
  onEditChange(patch: Partial<TermDraft>): void
  onEditSave(): void
  onEditCancel(): void
  onDelete(row: GlossaryDto): void
}

const EDIT_FIELDS: [keyof TermDraft, string, number][] = [
  ["source", "คำต้นฉบับ", 200],
  ["thai", "คำไทย", 200],
  ["note", "หมายเหตุ", 300],
]

export function GlossaryView(p: GlossaryViewProps) {
  const shown = filterTerms(p.rows, p.autoOnly)
  const locked = p.saving

  const editKeys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault()
      p.onEditSave()
    } else if (event.key === "Escape") p.onEditCancel()
  }

  return (
    <section className="ad-glossary" aria-label="อภิธานศัพท์">
      <p className="ad-hint">รายการนี้ถูกส่งให้ AI ทุกครั้งที่แปลเรื่องนี้ — ใส่ชื่อตัวละคร สถานที่ และคำเฉพาะ เพื่อให้คำแปลตรงกันทุกตอน</p>

      <form
        className="ad-gadd"
        data-kind="add"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          p.onAdd()
        }}
      >
        <TextField id="gl-source" label="คำต้นฉบับ" value={p.add.source} max={200} error={p.addErrors.source} onChange={(source) => p.onAddChange({ source })} />
        <TextField id="gl-thai" label="คำไทย" value={p.add.thai} max={200} error={p.addErrors.thai} onChange={(thai) => p.onAddChange({ thai })} />
        <TextField id="gl-note" label="หมายเหตุ (ไม่บังคับ)" value={p.add.note} max={300} error={p.addErrors.note} onChange={(note) => p.onAddChange({ note })} />
        <div className="ad-gadd-go">
          <button type="submit" className="btn primary" disabled={p.adding}>
            <Plus size={ICON} aria-hidden="true" />
            {p.adding ? "กำลังเพิ่ม…" : "เพิ่มคำ"}
          </button>
        </div>
        {p.addError !== null && (
          <p className="ad-field-error ad-gadd-error" role="alert">
            {p.addError}
          </p>
        )}
      </form>

      {p.rows.length > 0 && (
        <div className="ad-cbar">
          <p className="ad-csummary">{summaryLine(p.rows)}</p>
          <div className="ad-cbar-actions">
            <Chip selected={p.autoOnly} onClick={() => p.onFilter(!p.autoOnly)}>
              {`เฉพาะที่ AI เพิ่ม (${aiCount(p.rows)})`}
            </Chip>
          </div>
        </div>
      )}

      {p.notice !== null && (
        <p className="ad-notice" role="status">
          {p.notice}
        </p>
      )}

      {p.rows.length === 0 ? (
        <EmptyState title="ยังไม่มีคำศัพท์" hint="เพิ่มคำด้านบน หรือรอให้ AI เสนอคำใหม่ระหว่างแปล — คำที่ AI เพิ่มจะมีป้าย “AI”" />
      ) : shown.length === 0 ? (
        <EmptyState title="ยังไม่มีคำที่ AI เพิ่ม" hint="คำที่แก้แล้วจะไม่ถูกนับว่า AI เพิ่ม — ปิดตัวกรองเพื่อดูทั้งหมด" />
      ) : (
        <div className="ad-scroll">
          <table className="ad-table ad-gtable">
            <caption className="sr-only">อภิธานศัพท์ของเรื่อง</caption>
            <thead>
              <tr>
                <th scope="col">คำต้นฉบับ</th>
                <th scope="col">คำไทย</th>
                <th scope="col">หมายเหตุ</th>
                <th scope="col">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) =>
                row.id === p.editingId ? (
                  editRow(p, row.id, editKeys)
                ) : (
                  <tr key={row.id}>
                    <td>
                      <span className="ad-gword">{row.source}</span>
                      {row.auto && (
                        <span className="ad-pill" data-tone="live" title="AI เพิ่มให้ — แก้แล้วป้ายนี้จะหายไป">
                          AI
                        </span>
                      )}
                    </td>
                    <td>{row.thai}</td>
                    <td className="ad-gnote">{row.note === "" ? "—" : row.note}</td>
                    <td>
                      <div className="ad-nact">
                        <button type="button" className="iconbtn" aria-label={`แก้ไขคำ ${row.source}`} disabled={locked} onClick={() => p.onEdit(row)}>
                          <Pencil size={ICON} aria-hidden="true" />
                        </button>
                        <button type="button" className="iconbtn" aria-label={`ลบคำ ${row.source}`} disabled={locked} onClick={() => p.onDelete(row)}>
                          <Trash2 size={ICON} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** แถวที่กำลังแก้ (ฟังก์ชันธรรมดา ไม่ใช่คอมโพเนนต์ — เทสต์เดินต้นไม้ของ `GlossaryView` เห็นช่องกรอกได้ตรงๆ) */
function editRow(p: GlossaryViewProps, id: number, onKeys: (event: KeyboardEvent<HTMLInputElement>) => void) {
  const problems = Object.values(p.editErrors).join(" · ")
  return (
    <Fragment key={id}>
      <tr data-state="editing">
        {EDIT_FIELDS.map(([key, label, max]) => (
          <td key={key}>
            <input
              type="text"
              className="ad-gcell"
              aria-label={label}
              aria-invalid={p.editErrors[key] !== undefined ? true : undefined}
              maxLength={max}
              autoComplete="off"
              value={p.edit[key]}
              disabled={p.saving}
              onChange={(event) => p.onEditChange({ [key]: event.target.value })}
              onKeyDown={onKeys}
            />
          </td>
        ))}
        <td>
          <div className="ad-nact">
            <button type="button" className="iconbtn" aria-label="บันทึกคำที่แก้" disabled={p.saving} onClick={p.onEditSave}>
              <Check size={ICON} aria-hidden="true" />
            </button>
            <button type="button" className="iconbtn" aria-label="ยกเลิกการแก้คำ" disabled={p.saving} onClick={p.onEditCancel}>
              <X size={ICON} aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
      {(problems !== "" || p.editError !== null) && (
        <tr data-state="editing-error">
          <td colSpan={4}>
            {problems !== "" && (
              <p className="ad-field-error" data-kind="edit-error">
                {problems}
              </p>
            )}
            {p.editError !== null && (
              <p className="ad-field-error" role="alert">
                {p.editError}
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}

// ───────────────────────── ตัวถือสถานะ ─────────────────────────

export function Glossary({ novelId }: { novelId: number }) {
  const { data, error, reload } = useFetch(`admin:glossary:${novelId}`, () => admin.glossary(novelId))
  const mounted = useMounted()
  const working = useRef(false)
  const [autoOnly, setAutoOnly] = useState(false)
  const [add, setAdd] = useState<TermDraft>(EMPTY_TERM)
  const [addErrors, setAddErrors] = useState<TermErrors>({})
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState<TermDraft>(EMPTY_TERM)
  const [editErrors, setEditErrors] = useState<TermErrors>({})
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<GlossaryDto | null>(null)

  if (data === null) return error !== null ? <ErrorState error={error} onRetry={reload} /> : <Skeleton variant="lines" />

  const startEdit = (row: GlossaryDto): void => {
    setEditingId(row.id)
    setEdit(draftOfTerm(row))
    setEditErrors({})
    setEditError(null)
    setNotice(null)
  }
  const stopEdit = (): void => {
    setEditingId(null)
    setEditErrors({})
    setEditError(null)
  }

  async function submitAdd(): Promise<void> {
    if (working.current) return
    const errors = validateTerm(add)
    setAddErrors(errors)
    setAddError(null)
    if (Object.keys(errors).length > 0) return
    working.current = true
    setAdding(true)
    setNotice(null)
    try {
      await admin.addTerm(novelId, { source: add.source.trim(), thai: add.thai.trim(), note: add.note.trim() })
      if (!mounted.current) return
      setAdd(EMPTY_TERM)
      setNotice("เพิ่มคำแล้ว")
      reload()
    } catch (e) {
      if (mounted.current) setAddError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setAdding(false)
    }
  }

  async function saveEdit(): Promise<void> {
    if (working.current || editingId === null) return
    const row = data!.find((t) => t.id === editingId)
    if (row === undefined) return stopEdit()
    const errors = validateTerm(edit)
    setEditErrors(errors)
    setEditError(null)
    if (Object.keys(errors).length > 0) return
    const patch = termChanges(row, edit)
    if (Object.keys(patch).length === 0) return stopEdit()
    working.current = true
    setSaving(true)
    try {
      await admin.patchTerm(row.id, patch)
      if (!mounted.current) return
      stopEdit()
      setNotice(row.auto ? "บันทึกแล้ว — คำนี้ไม่ใช่คำที่ AI เพิ่มอีกต่อไป" : "บันทึกแล้ว")
      reload()
    } catch (e) {
      if (mounted.current) setEditError(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function remove(row: GlossaryDto): Promise<void> {
    await admin.deleteTerm(row.id) // ล้มเหลว → กล่องยืนยันแสดงข้อความเอง
    if (!mounted.current) return
    setDeleting(null)
    if (editingId === row.id) stopEdit()
    setNotice("ลบคำแล้ว")
    reload()
  }

  return (
    <>
      <GlossaryView
        rows={data}
        autoOnly={autoOnly}
        add={add}
        addErrors={addErrors}
        addError={addError}
        adding={adding}
        editingId={editingId}
        edit={edit}
        editErrors={editErrors}
        editError={editError}
        saving={saving}
        notice={notice}
        onAddChange={(patch) => {
          setAdd((current) => ({ ...current, ...patch }))
          setAddError(null)
        }}
        onAdd={() => void submitAdd()}
        onFilter={setAutoOnly}
        onEdit={startEdit}
        onEditChange={(patch) => setEdit((current) => ({ ...current, ...patch }))}
        onEditSave={() => void saveEdit()}
        onEditCancel={stopEdit}
        onDelete={setDeleting}
      />
      {deleting !== null && <ConfirmDialog title="ลบคำนี้?" message={deleteTermMessage(deleting)} confirmLabel="ลบ" danger onConfirm={() => remove(deleting)} onCancel={() => setDeleting(null)} />}
    </>
  )
}
