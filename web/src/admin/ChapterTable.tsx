/**
 * ตารางตอนของเรื่อง (แท็บ "ตอน", spec 7.6): เลือกหลายแถวแล้ว แปล/แปลใหม่ · เผยแพร่ · ซ่อน · ลบ (ยืนยันก่อน) + ลัด "เผยแพร่ตอนที่แปลเสร็จทั้งหมด"
 * `ChapterTableView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `ChapterTable` ดึงรายการ (ดึงซ้ำทุก 2 วินาทีเมื่อมีตอนรอคิว/กำลังแปล) สั่งงานและรายงานผล
 */
import { Pencil, Plus, RotateCw, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Switch } from "../components/Switch"
import { ApiError } from "../lib/api"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import {
  type BulkAction,
  bulkNotice,
  deleteMessage,
  hasLive,
  idsOf,
  POLL_MS,
  publishSwitch,
  readyCount,
  selectionAfter,
  STATUS_TONE,
  summaryText,
  toggleAll,
  toggleOne,
  translateLabel,
} from "./chapter-logic"
import { publishNotice, thaiDateTime } from "./dashboard-logic"
import { STATUS_LABEL } from "./format"
import { useQueue } from "./QueueContext"
import type { AdminChapterRow } from "./types"
import { useMounted } from "./useMounted"

const ICON = 18

export interface ChapterTableViewProps {
  novelId: number
  rows: AdminChapterRow[]
  selected: ReadonlySet<number>
  /** กำลังทำคำสั่งอยู่: ปุ่มและสวิตช์ทั้งหมดปิด (กดซ้ำไม่ได้) */
  pending: boolean
  notice: string | null
  error: string | null
  onToggle(id: number): void
  onToggleAll(): void
  onClear(): void
  onPublish(row: AdminChapterRow, next: boolean): void
  onRetry(row: AdminChapterRow): void
  onDeleteRows(rows: AdminChapterRow[]): void
  onBulk(action: "translate" | "publish" | "hide"): void
  onPublishReady(): void
}

export function ChapterTableView(p: ChapterTableViewProps) {
  const addLink = (
    <Link to={`/admin/add?novel=${p.novelId}`} className="btn primary sm">
      <Plus size={ICON} aria-hidden="true" />
      เพิ่มตอน
    </Link>
  )
  if (p.rows.length === 0) {
    return <EmptyState title="ยังไม่มีตอน" hint="วางข้อความภาษาอังกฤษแล้วให้ AI แปลทีละตอน" action={addLink} />
  }

  const chosen = p.rows.filter((row) => p.selected.has(row.id))
  const everyone = chosen.length === p.rows.length
  const ready = readyCount(p.rows)

  return (
    <div className="ad-chapters">
      <div className="ad-cbar">
        <p className="ad-csummary">{summaryText(p.rows)}</p>
        <div className="ad-cbar-actions">
          <button type="button" className="btn ghost sm" data-act="publish-ready" disabled={p.pending || ready === 0} title={ready === 0 ? "ไม่มีตอนที่แปลเสร็จและรอเผยแพร่" : undefined} onClick={p.onPublishReady}>
            เผยแพร่ตอนที่แปลเสร็จทั้งหมด
          </button>
          {addLink}
        </div>
      </div>

      {p.notice !== null && (
        <p className="ad-notice" role="status">
          {p.notice}
        </p>
      )}
      {p.error !== null && (
        <p className="ad-inline-error" role="alert">
          {p.error}
        </p>
      )}

      {chosen.length > 0 && (
        <div className="ad-bulk" data-kind="bulk">
          <span className="ad-bulk-count">{`เลือกแล้ว ${chosen.length} ตอน`}</span>
          <button type="button" className="btn ghost sm" data-act="translate" disabled={p.pending} onClick={() => p.onBulk("translate")}>
            {translateLabel(chosen)}
          </button>
          <button type="button" className="btn ghost sm" data-act="publish" disabled={p.pending} onClick={() => p.onBulk("publish")}>
            เผยแพร่
          </button>
          <button type="button" className="btn ghost sm" data-act="hide" disabled={p.pending} onClick={() => p.onBulk("hide")}>
            ซ่อน
          </button>
          <button type="button" className="btn ghost sm ad-danger-ghost" data-act="delete" disabled={p.pending} onClick={() => p.onDeleteRows(chosen)}>
            ลบ
          </button>
          <button type="button" className="ad-link-btn" data-act="clear" onClick={p.onClear}>
            ล้างการเลือก
          </button>
        </div>
      )}

      <div className="ad-scroll">
        <table className="ad-table ad-ctable">
          <caption className="sr-only">ตารางตอนของเรื่อง</caption>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  className="ad-acheck"
                  aria-label="เลือกทั้งหมด"
                  checked={everyone}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !everyone
                  }}
                  onChange={() => p.onToggleAll()}
                />
              </th>
              <th scope="col">ตอนที่</th>
              <th scope="col">ชื่อตอน</th>
              <th scope="col">สถานะ</th>
              <th scope="col">เผยแพร่</th>
              <th scope="col">แปลเมื่อ</th>
              <th scope="col">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((row) => {
              const sw = publishSwitch(row)
              const main = row.titleTh !== "" ? row.titleTh : row.title
              return (
                <tr key={row.id}>
                  <td>
                    <input type="checkbox" className="ad-acheck" aria-label={`เลือกตอนที่ ${row.number}`} checked={p.selected.has(row.id)} onChange={() => p.onToggle(row.id)} />
                  </td>
                  <th scope="row">{row.number}</th>
                  <td>
                    <Link to={`/admin/novels/${p.novelId}/chapters/${row.id}`} className="ad-clink">
                      {main}
                    </Link>
                    {row.titleTh !== "" && row.title !== "" && <span className="ad-csub">{row.title}</span>}
                    {row.status === "error" && row.error !== "" && <span className="ad-cerr">{row.error}</span>}
                  </td>
                  <td>
                    <span className="ad-pill" data-tone={STATUS_TONE[row.status]}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td>
                    <Switch checked={row.published} onChange={(next) => p.onPublish(row, next)} label={`เผยแพร่ตอนที่ ${row.number}`} disabled={p.pending || sw.disabled} />
                    {sw.reason !== null && <span className="ad-cwhy">{sw.reason}</span>}
                  </td>
                  <td className="ad-ctime">{row.translatedAt === null || thaiDateTime(row.translatedAt) === "" ? "—" : thaiDateTime(row.translatedAt)}</td>
                  <td>
                    <div className="ad-nact">
                      <Link to={`/admin/novels/${p.novelId}/chapters/${row.id}`} className="iconbtn" aria-label={`แก้ไขตอนที่ ${row.number}`}>
                        <Pencil size={ICON} aria-hidden="true" />
                      </Link>
                      {row.status === "error" && (
                        <button type="button" className="iconbtn" aria-label={`ลองใหม่ตอนที่ ${row.number}`} disabled={p.pending} onClick={() => p.onRetry(row)}>
                          <RotateCw size={ICON} aria-hidden="true" />
                        </button>
                      )}
                      <button type="button" className="iconbtn" aria-label={`ลบตอนที่ ${row.number}`} disabled={p.pending} onClick={() => p.onDeleteRows([row])}>
                        <Trash2 size={ICON} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

export function ChapterTable({ novelId, onCount }: { novelId: number; onCount(count: number): void }) {
  const { data, error, loading, reload } = useFetch(`admin:chapter-table:${novelId}`, () => admin.chapters(novelId))
  const queue = useQueue()
  const mounted = useMounted()
  const working = useRef(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AdminChapterRow[] | null>(null)

  const rows = data ?? []
  const live = data !== null && hasLive(data)

  // ป้ายจำนวนตอนบนแท็บตามรายการล่าสุด (ลบ/เพิ่มแล้วตรงกัน)
  useEffect(() => {
    if (data !== null) onCount(data.length)
  }, [data])

  // ดึงซ้ำทุก POLL_MS ตราบที่ยังมีตอนรอคิว/กำลังแปล · ดึงล้มเหลวก็ลองใหม่ต่อ (รายการเดิมยังโชว์)
  useEffect(() => {
    if (!live || loading) return undefined
    const timer = window.setTimeout(reload, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [live, loading, reload])

  if (data === null) {
    return error !== null ? <ErrorState error={error} onRetry={reload} /> : <Skeleton variant="lines" />
  }

  const chosen = selectionAfter(selected, rows)

  /** ทำคำสั่งทีละอย่าง (กันกดซ้ำ) แล้วแจ้งผลและดึงรายการใหม่ · `silent` = ไม่แจ้งผลสำเร็จ (สวิตช์เผยแพร่ของแถวเดียว) */
  async function run(task: () => Promise<string | null>): Promise<void> {
    if (working.current) return
    working.current = true
    setPending(true)
    setNotice(null)
    setFailure(null)
    try {
      const message = await task()
      if (!mounted.current) return
      setNotice(message)
      reload()
      queue.reload()
    } catch (e) {
      if (mounted.current) setFailure(messageOf(e))
    } finally {
      working.current = false
      if (mounted.current) setPending(false)
    }
  }

  const bulk = (action: BulkAction, ids: number[], silent = false) =>
    run(async () => {
      const result = await admin.bulk({ ids, action })
      return silent ? null : bulkNotice(action, result)
    })

  async function remove(target: AdminChapterRow[]): Promise<void> {
    const result = await admin.bulk({ ids: target.map((row) => row.id), action: "delete" }) // ล้มเหลว → กล่องยืนยันแสดงข้อความเอง
    if (!mounted.current) return
    setDeleting(null)
    setNotice(bulkNotice("delete", result))
    setFailure(null)
    reload()
  }

  return (
    <>
      <ChapterTableView
        novelId={novelId}
        rows={rows}
        selected={chosen}
        pending={pending}
        notice={notice}
        error={failure}
        onToggle={(id) => setSelected(toggleOne(chosen, id))}
        onToggleAll={() => setSelected(toggleAll(chosen, rows))}
        onClear={() => setSelected(new Set())}
        onPublish={(row, next) => void bulk(next ? "publish" : "hide", [row.id], true)}
        onRetry={(row) => void bulk("translate", [row.id])}
        onDeleteRows={setDeleting}
        onBulk={(action) => void bulk(action, idsOf(chosen, rows))}
        onPublishReady={() => void run(async () => publishNotice(await admin.bulk({ where: "ready", action: "publish", novelId })))}
      />
      {deleting !== null && (
        <ConfirmDialog
          title={deleting.length === 1 ? "ลบตอนนี้?" : `ลบ ${deleting.length} ตอน?`}
          message={deleteMessage(deleting)}
          confirmLabel="ลบถาวร"
          danger
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
