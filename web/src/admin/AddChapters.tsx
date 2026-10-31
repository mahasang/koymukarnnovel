/**
 * เพิ่มตอน (วางแล้วแปล) — spec 7.5: วางข้อความอังกฤษหลายตอนต่อกัน → ระบบแยกตอนในเบราว์เซอร์ → เจ้าของตรวจ/แก้ → สร้างตอนและเข้าคิวแปลตามเลข
 * `AddChaptersView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `AddChapters` ถือสถานะ: ดึงเรื่อง/ตั้งค่า/เลขตอนที่มีอยู่ แยกตอนแบบหน่วง ~250 ms ส่งและจัดการข้อผิดพลาดของเซิร์ฟเวอร์
 */
import { Plus } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Switch } from "../components/Switch"
import { forceSingle, type ParsedRow, parseChapters, validateSelection } from "../lib/parse-chapters"
import { KEYS, readJson, writeJson } from "../lib/storage"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import {
  type AddOptions,
  applyConflicts,
  buildPayload,
  conflictsOf,
  costLine,
  editRow,
  effectiveOptions,
  novelIdFrom,
  parseNumberInput,
  parseOptions,
  type RowPatch,
  rowNote,
  submitErrorMessage,
  submitLabel,
} from "./add-logic"
import { admin } from "./adminApi"
import { novelTitles } from "./novel-logic"
import { useUnsavedGuard } from "./NovelForm"
import type { AdminNovelDto } from "./types"
import { useMounted } from "./useMounted"

/** หน่วงการแยกตอนหลังหยุดพิมพ์/วาง (ข้อความหลายล้านตัวอักษรไม่ต้องแยกทุกครั้งที่กดแป้น) */
const DEBOUNCE_MS = 250
const EMPTY_SET: ReadonlySet<number> = new Set()

export type SplitMode = "auto" | "single"

export interface AddChaptersViewProps {
  novels: AdminNovelDto[]
  novelId: number | null
  text: string
  mode: SplitMode
  rows: ParsedRow[]
  /** ค่าที่ใช้จริง (ผ่าน `effectiveOptions` แล้ว) */
  options: AddOptions
  apiKeySet: boolean
  /** บรรทัดประมาณการค่าใช้จ่าย (null = ไม่แสดง) */
  cost: string | null
  /** กำลังดึงเลขตอนที่มีอยู่ของเรื่องที่เลือก — ส่งยังไม่ได้ เพราะยังเช็กเลขซ้ำไม่ครบ */
  checking: boolean
  /** ดึงเลขตอนที่มีอยู่ไม่ได้ (เตือนอย่างเดียว เซิร์ฟเวอร์ยังตรวจเลขซ้ำให้ตอนส่ง) */
  existingError: string | null
  busy: boolean
  /** ข้อความที่เซิร์ฟเวอร์ตอบเมื่อส่งไม่สำเร็จ */
  error: string | null
  onNovel(id: number | null): void
  onText(value: string): void
  onMode(mode: SplitMode): void
  onRow(key: string, patch: RowPatch): void
  onOptions(patch: Partial<AddOptions>): void
  onSubmit(): void
}

export function AddChaptersHeader() {
  return (
    <div className="ad-ph">
      <div className="ad-ph-text">
        <p className="ad-eyebrow">วางแล้วแปล</p>
        <h1>เพิ่มตอน</h1>
      </div>
    </div>
  )
}

function RowStatus({ row }: { row: ParsedRow }) {
  const note = rowNote(row.issues)
  return (
    <>
      {note !== null ? (
        <span className="ad-pill" data-tone="fail">
          {note}
        </span>
      ) : row.checked ? (
        <span className="ad-pill" data-tone="ok">
          พร้อม
        </span>
      ) : (
        <span className="ad-pill" data-tone="idle">
          ไม่ได้เลือก
        </span>
      )}
      {row.kind === "preamble" && <span className="ad-akind">ข้อความก่อนหัวข้อแรก</span>}
    </>
  )
}

export function AddChaptersView(p: AddChaptersViewProps) {
  if (p.novels.length === 0) {
    return (
      <>
        <AddChaptersHeader />
        <EmptyState
          title="ยังไม่มีนิยาย"
          hint="ต้องมีเรื่องก่อนถึงจะเพิ่มตอนได้ — สร้างเรื่องแรกแล้วกลับมาวางตอนภาษาอังกฤษ"
          action={
            <Link to="/admin/novels/new" className="btn primary">
              <Plus size={18} aria-hidden="true" />
              เพิ่มเรื่องใหม่
            </Link>
          }
        />
      </>
    )
  }

  const selection = validateSelection(p.rows)
  const noNovel = p.novelId === null
  const canSubmit = !p.busy && !p.checking && !noNovel && selection.count > 0 && selection.error === null

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    p.onSubmit()
  }

  return (
    <>
      <AddChaptersHeader />
      <form className="ad-add" onSubmit={submit} noValidate>
        <div className="ad-field">
          <label htmlFor="add-novel">เรื่อง</label>
          <select id="add-novel" value={p.novelId === null ? "" : String(p.novelId)} onChange={(event) => p.onNovel(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">— เลือกเรื่อง —</option>
            {p.novels.map((novel) => (
              <option key={novel.id} value={String(novel.id)}>
                {novelTitles(novel).main}
              </option>
            ))}
          </select>
          {p.existingError !== null && <p className="ad-hint">{p.existingError}</p>}
        </div>

        <div className="ad-field">
          <label htmlFor="add-text">วางข้อความภาษาอังกฤษ (วางได้หลายตอนต่อกัน)</label>
          <textarea id="add-text" rows={14} value={p.text} placeholder={"Chapter 1: ชื่อตอน\n…เนื้อหา…\n\nChapter 2: …"} spellCheck={false} onChange={(event) => p.onText(event.target.value)} />
          <p className="ad-hint">ระบบหาบรรทัดหัวข้ออย่าง “Chapter 12: ชื่อตอน” (หรือ Ch. / Episode / Ep.) แล้วแยกตอนให้เอง</p>
        </div>

        <div className="ad-add-actions">
          <button type="button" className="btn ghost" data-split="auto" aria-pressed={p.mode === "auto"} onClick={() => p.onMode("auto")}>
            แยกตอนอัตโนมัติ
          </button>
          <button type="button" className="btn ghost" data-split="single" aria-pressed={p.mode === "single"} onClick={() => p.onMode("single")}>
            ไม่ต้องแยกตอน
          </button>
        </div>

        <section className="ad-panel" aria-label="ตอนที่แยกได้">
          <div className="ad-panel-head">
            <h2 className="ad-found">{`พบ ${p.rows.length} ตอน`}</h2>
            {p.rows.length > 0 && <span className="ad-panel-sub">{`ติ๊กไว้ ${selection.count} ตอน`}</span>}
          </div>
          {p.rows.length === 0 ? (
            <p className="ad-empty">วางข้อความด้านบน ระบบจะแสดงตอนที่แยกได้ตรงนี้ให้ตรวจก่อนส่ง</p>
          ) : (
            <div className="ad-scroll">
              <table className="ad-table ad-atable">
                <caption className="sr-only">ตอนที่แยกได้จากข้อความที่วาง</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">เลือก</span>
                    </th>
                    <th scope="col">เลขตอน</th>
                    <th scope="col">ชื่อตอน</th>
                    <th scope="col">จำนวนคำ</th>
                    <th scope="col">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((row, index) => (
                    <tr key={row.key}>
                      <td>
                        <input type="checkbox" className="ad-acheck" checked={row.checked} aria-label={`เลือกแถวที่ ${index + 1}`} onChange={(event) => p.onRow(row.key, { checked: event.target.checked })} />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="ad-anum"
                          value={row.number === null ? "" : String(row.number)}
                          aria-label={`เลขตอน (แถวที่ ${index + 1})`}
                          aria-invalid={row.issues.includes("duplicate") || row.issues.includes("bad_number") ? true : undefined}
                          onChange={(event) => {
                            const number = parseNumberInput(event.target.value)
                            if (number !== undefined) p.onRow(row.key, { number })
                          }}
                        />
                      </td>
                      <td>
                        <input type="text" className="ad-atitle" value={row.title} maxLength={300} aria-label={`ชื่อตอน (แถวที่ ${index + 1})`} onChange={(event) => p.onRow(row.key, { title: event.target.value })} />
                      </td>
                      <td>{row.words.toLocaleString("en-US")}</td>
                      <td>
                        <RowStatus row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="ad-add-opts">
          <Switch checked={p.options.translate} onChange={(translate) => p.onOptions({ translate })} label="แปลทันที" disabled={!p.apiKeySet} />
          {!p.apiKeySet && (
            <p className="ad-hint">
              ยังไม่ได้ตั้งคีย์ API จึงบันทึกเป็นร่างอย่างเดียว — <Link to="/admin/settings">ตั้งคีย์ที่หน้าตั้งค่า</Link>
            </p>
          )}
          <Switch checked={p.options.publish} onChange={(publish) => p.onOptions({ publish })} label="เผยแพร่เองเมื่อแปลเสร็จ" disabled={!p.options.translate} />
          {p.apiKeySet && !p.options.translate && <p className="ad-hint">เผยแพร่เองได้เมื่อเลือกแปลทันที</p>}
        </div>

        {p.cost !== null && (
          <p className="ad-hint" data-kind="cost">
            {p.cost}
          </p>
        )}
        {selection.error !== null && (
          <p className="ad-inline-error" data-kind="selection">
            {selection.error}
          </p>
        )}
        {noNovel && (
          <p className="ad-hint" data-kind="need-novel">
            เลือกเรื่องก่อนถึงจะส่งได้
          </p>
        )}
        {p.checking && (
          <p className="ad-hint" role="status">
            กำลังตรวจเลขตอนที่มีอยู่ของเรื่องนี้…
          </p>
        )}
        {p.error !== null && (
          <p className="ad-inline-error" role="alert">
            {p.error}
          </p>
        )}

        <div className="ad-add-submit">
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {p.busy ? "กำลังส่ง…" : submitLabel(selection.count, p.options.translate)}
          </button>
        </div>
      </form>
    </>
  )
}

/** อ่านตัวเลือกที่จำไว้ (ล้มเหลว/ค่าเสีย → ค่าเริ่มต้น) */
const loadOptions = (): AddOptions => parseOptions(readJson<unknown>(KEYS.addOptions, null))

export function AddChapters() {
  useDocumentTitle("เพิ่มตอน")
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const novels = useFetch("admin:novels", () => admin.novels())
  const settings = useFetch("admin:settings", () => admin.settings())
  const novelId = novelIdFrom(params.get("novel"), novels.data ?? [])
  const chapters = useFetch(novelId === null ? null : `admin:chapters:${novelId}`, () => admin.chapters(novelId!))
  /** เลขตอนที่เรื่องนี้มีอยู่แล้ว (ที่ดึงมา) */
  const base = useMemo<ReadonlySet<number>>(() => (chapters.data === null ? EMPTY_SET : new Set(chapters.data.map((c) => c.number))), [chapters.data])
  /** เลขที่เซิร์ฟเวอร์ตอบว่าชนตอนส่ง (เผื่อมีคนเพิ่มตอนระหว่างนั้น) — ล้างเมื่อเปลี่ยนเรื่อง */
  const [extra, setExtra] = useState<ReadonlySet<number>>(EMPTY_SET)
  const existing = useMemo<ReadonlySet<number>>(() => (extra.size === 0 ? base : new Set([...base, ...extra])), [base, extra])

  const [text, setText] = useState("")
  const [mode, setMode] = useState<SplitMode>("auto")
  const modeRef = useRef<SplitMode>("auto")
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [options, setOptions] = useState<AddOptions>(loadOptions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const working = useRef(false)
  const mounted = useMounted()

  const parse = (source: string, kind: SplitMode, known: ReadonlySet<number>): ParsedRow[] => (kind === "single" ? forceSingle(source, known) : parseChapters(source, known))

  // แยกตอนใหม่เมื่อข้อความหรือเลขที่มีอยู่เปลี่ยน (หน่วงหลังหยุดวาง) — โหมดอ่านจาก ref เพื่อให้ปุ่มโหมดแยกทันที ไม่ผ่านการหน่วง
  useEffect(() => {
    if (text.trim() === "") {
      setRows([])
      return undefined
    }
    const timer = setTimeout(() => setRows(parse(text, modeRef.current, base)), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, base])

  useUnsavedGuard(text.trim() !== "" && !sent)

  if (novels.error !== null) return <ErrorState error={novels.error} onRetry={novels.reload} />
  if (settings.error !== null) return <ErrorState error={settings.error} onRetry={settings.reload} />
  if (novels.data === null || settings.data === null) {
    return (
      <>
        <AddChaptersHeader />
        <Skeleton variant="lines" />
      </>
    )
  }
  const settingsData = settings.data
  const apiKeySet = settingsData.apiKeySet
  const effective = effectiveOptions(options, apiKeySet)
  const price = settingsData.prices[settingsData.translateModel]
  const cost = effective.translate ? costLine(rows.filter((r) => r.checked).map((r) => r.text.length), price) : null

  function changeText(value: string): void {
    setText(value)
    setError(null)
    if (value.trim() === "") {
      modeRef.current = "auto"
      setMode("auto")
    }
  }

  function changeMode(next: SplitMode): void {
    modeRef.current = next
    setMode(next)
    setRows(text.trim() === "" ? [] : parse(text, next, existing))
  }

  function changeNovel(id: number | null): void {
    setExtra(EMPTY_SET)
    setError(null)
    setParams(id === null ? {} : { novel: String(id) }, { replace: true })
  }

  function changeOptions(patch: Partial<AddOptions>): void {
    const next = { ...options, ...patch }
    setOptions(next)
    writeJson(KEYS.addOptions, next)
  }

  async function submit(): Promise<void> {
    if (working.current || novelId === null) return
    const selection = validateSelection(rows)
    if (selection.count === 0 || selection.error !== null) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await admin.createChapters(novelId, buildPayload(rows, effective))
      setSent(true)
      navigate(`/admin/novels/${novelId}?tab=chapters`)
    } catch (e) {
      if (!mounted.current) return
      const conflicts = conflictsOf(e)
      if (conflicts !== null) {
        const marked = applyConflicts(rows, existing, conflicts)
        setRows(marked.rows)
        setExtra(new Set([...extra, ...conflicts]))
      }
      setError(submitErrorMessage(e))
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <AddChaptersView
      novels={novels.data}
      novelId={novelId}
      text={text}
      mode={mode}
      rows={rows}
      options={effective}
      apiKeySet={apiKeySet}
      cost={cost}
      checking={novelId !== null && chapters.loading}
      existingError={chapters.error === null ? null : "ดึงรายการตอนที่มีอยู่ไม่ได้ จึงเช็กเลขซ้ำล่วงหน้าไม่ได้ (เซิร์ฟเวอร์ยังตรวจให้ตอนส่ง)"}
      busy={busy}
      error={error}
      onNovel={changeNovel}
      onText={changeText}
      onMode={changeMode}
      onRow={(key, patch) => setRows((current) => editRow(current, existing, key, patch))}
      onOptions={changeOptions}
      onSubmit={() => void submit()}
    />
  )
}
