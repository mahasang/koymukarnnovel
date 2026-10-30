/**
 * หน้าแดชบอร์ดหลังบ้าน (spec 7.3): เริ่มต้นใช้งาน · การ์ดตัวเลข · คิวแปลสด · ยอดอ่าน 14 วัน · ความคืบหน้าแต่ละเรื่อง · การใช้ AI และสถานะ API
 * ส่วนแสดงผลทุกแผงเป็นฟังก์ชันล้วน (ไม่มี hook — เทสต์ด้วยการเรียกตรงๆ) · `Dashboard` เป็นตัวถือสถานะ: ดึงข้อมูล ต่อคิวสด หยุด/ทำต่อ ลองใหม่ เผยแพร่ทั้งหมด
 * คิวและตอนที่กำลังแปลมาจาก `useQueue()` (ดึงทุก 2 วินาที) ไม่ใช่จาก `dashboard.queue` · ตัวเลขการ์ดโหลดใหม่เมื่อคิวขยับ (ตอนจบ/ผิดพลาด/หยุด)
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react"
import { Check, ChevronRight, FilePlus, Layers, BookOpen, Pause, Play, Plus, RotateCw, Send, TriangleAlert, X } from "lucide-react"
import { Link } from "react-router"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { BarChart, totalViews } from "./chart"
import {
  apiStatus,
  chapterPath,
  chunkProgress,
  formatUsd,
  isNearBottom,
  onboardingComplete,
  onboardingItems,
  progressPercent,
  publishNotice,
  queueIdleNote,
  queueSignature,
  usageTotals,
  waitingRows,
} from "./dashboard-logic"
import { formatCount } from "./format"
import { useQueue } from "./QueueContext"
import type { DashboardDto, NovelProgressDto, QueueError, QueueState, UsageRowDto } from "./types"

const ICON = 18

// ───────────────────────── เริ่มต้นใช้งาน ─────────────────────────

/** แสดงเฉพาะตอนยังทำไม่ครบ 3 ข้อ · ข้อที่ยังไม่ทำและสำคัญ (ช่องทางติดต่อเจ้าของลิขสิทธิ์) ขึ้นสีเด่น */
export function OnboardingPanel({ onboarding }: { onboarding: DashboardDto["onboarding"] }) {
  if (onboardingComplete(onboarding)) return null
  const items = onboardingItems(onboarding)
  const doneCount = items.filter((item) => item.done).length
  return (
    <section className="ad-panel ad-onboard" aria-labelledby="ad-onboard-h">
      <div className="ad-panel-head">
        <h2 id="ad-onboard-h">เริ่มต้นใช้งาน</h2>
        <p className="ad-panel-sub">{`ทำแล้ว ${doneCount} จาก ${items.length} ข้อ`}</p>
      </div>
      <ol className="ad-onboard-list">
        {items.map((item, index) => (
          <li key={item.id} className="ad-onboard-item" data-state={item.done ? "done" : item.warn ? "warn" : "todo"}>
            <Link to={item.to} className="ad-onboard-link">
              <span className="ad-onboard-mark" aria-hidden="true">
                {item.done ? <Check size={ICON} /> : item.warn ? <TriangleAlert size={ICON} /> : index + 1}
              </span>
              <span className="ad-onboard-text">
                <strong>
                  {item.done && <span className="sr-only">ทำแล้ว: </span>}
                  {item.title}
                </strong>
                <span className="ad-onboard-hint">{item.hint}</span>
              </span>
              {item.warn && (
                <span className="ad-pill" data-tone="warn">
                  ควรทำก่อนเผยแพร่
                </span>
              )}
              <ChevronRight size={ICON} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ───────────────────────── การ์ดตัวเลข ─────────────────────────

export interface StatCardsProps {
  counts: DashboardDto["counts"]
  /** มีตอนกำลังแปลอยู่ตอนนี้ (จากคิวสด) */
  translating: boolean
  onPublishAll(): void
}

export function StatCards({ counts, translating, onPublishAll }: StatCardsProps) {
  const hidden = counts.totalNovels - counts.publishedNovels
  return (
    <section className="ad-stats" aria-label="สรุปตัวเลข">
      <div className="ad-stat">
        <p className="ad-stat-label">
          <BookOpen size={ICON} aria-hidden="true" />
          นิยายที่เผยแพร่
        </p>
        <p className="ad-stat-value">
          {formatCount(counts.publishedNovels)}
          <span className="ad-stat-of">{` / ${formatCount(counts.totalNovels)}`}</span>
        </p>
        <p className="ad-stat-hint">{counts.totalNovels === 0 ? "ยังไม่มีนิยาย" : hidden > 0 ? `ซ่อนอยู่ ${formatCount(hidden)} เรื่อง` : "เผยแพร่ครบทุกเรื่อง"}</p>
      </div>
      <div className="ad-stat">
        <p className="ad-stat-label">
          <Check size={ICON} aria-hidden="true" />
          ตอนที่เผยแพร่แล้ว
        </p>
        <p className="ad-stat-value">{formatCount(counts.publishedChapters)}</p>
        <p className="ad-stat-hint">นับรวมทุกเรื่อง</p>
      </div>
      <div className="ad-stat">
        <p className="ad-stat-label">
          <Layers size={ICON} aria-hidden="true" />
          รอคิวแปล
        </p>
        <p className="ad-stat-value">{formatCount(counts.queued)}</p>
        <p className="ad-stat-hint">{translating ? "กำลังแปลอยู่ 1 ตอน" : "ไม่มีตอนกำลังแปล"}</p>
      </div>
      <div className="ad-stat" data-tone={counts.errors > 0 ? "fail" : "calm"}>
        <p className="ad-stat-label">
          <TriangleAlert size={ICON} aria-hidden="true" />
          ผิดพลาด
        </p>
        <p className="ad-stat-value">{formatCount(counts.errors)}</p>
        <p className="ad-stat-hint">{counts.errors > 0 ? "ดูรายการในคิวแปลแล้วกดลองใหม่" : "ไม่มีตอนผิดพลาด"}</p>
      </div>
      <div className="ad-stat">
        <p className="ad-stat-label">
          <Send size={ICON} aria-hidden="true" />
          แปลแล้ว ยังไม่เผยแพร่
        </p>
        <p className="ad-stat-value">{formatCount(counts.readyToPublish)}</p>
        {counts.readyToPublish > 0 ? (
          <button type="button" className="btn primary sm ad-stat-action" onClick={onPublishAll}>
            เผยแพร่ทั้งหมด
          </button>
        ) : (
          <p className="ad-stat-hint">ไม่มีตอนค้างเผยแพร่</p>
        )}
      </div>
    </section>
  )
}

// ───────────────────────── คิวแปลสด ─────────────────────────

export interface QueuePanelProps {
  /** null = ยังไม่เคยดึงสถานะคิวสำเร็จ */
  state: QueueState | null
  errors: QueueError[]
  /** ดึงครั้งล่าสุดไม่สำเร็จ (สิ่งที่เห็นอาจเก่า) */
  offline: boolean
  toggle: { busy: boolean; error: string | null; onToggle(): void }
  retry: { busyIds: number[]; errors: Record<number, string>; onRetry(id: number): void }
  /** กล่องข้อความที่กำลังไหล: ตัวถือสถานะใช้เลื่อนลงท้ายสุดเอง */
  tailRef?: Ref<HTMLDivElement>
  onTailScroll?(): void
}

/** แถวตอนในคิว: "ตอนที่ N" + ชื่อเรื่อง (ลิงก์ไปหน้าแก้ตอน) + ส่วนท้ายแถว (ป้ายสถานะ/ปุ่ม) */
function ChapterRow({ number, novelId, id, novelTitle, detail, tail }: { number: number; novelId: number; id: number; novelTitle: string; detail?: string; tail: ReactNode }) {
  return (
    <>
      <span className="ad-row-num">{`ตอนที่ ${number}`}</span>
      <span className="ad-row-title">
        <Link to={chapterPath(novelId, id)}>{novelTitle}</Link>
        {detail !== undefined && detail !== "" && (
          <span className="ad-row-err" title={detail}>
            {detail}
          </span>
        )}
      </span>
      {tail}
    </>
  )
}

export function QueuePanel(p: QueuePanelProps) {
  const { state } = p
  const remaining = state === null ? 0 : state.waitingTotal + (state.current === null ? 0 : 1)
  const waiting = state === null ? { rows: [], more: 0 } : waitingRows(state)
  const idle = state === null ? null : queueIdleNote(state)
  const progress = state?.current == null ? null : chunkProgress(state.current)
  return (
    <section className="ad-panel ad-queue-panel" aria-labelledby="ad-queue-h">
      <div className="ad-panel-head">
        <h2 id="ad-queue-h">คิวแปล</h2>
        <p className="ad-panel-sub">{state === null ? "แปลทีละตอนตามลำดับ" : `แปลทีละตอนตามลำดับ · เหลือ ${formatCount(remaining)} ตอน`}</p>
        {state !== null && (
          <button type="button" className="btn ghost sm" disabled={p.toggle.busy} onClick={p.toggle.onToggle}>
            {state.paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            {p.toggle.busy ? "กำลังสั่ง…" : state.paused ? "ทำต่อ" : "หยุดคิว"}
          </button>
        )}
      </div>
      {p.offline && (
        <p className="ad-note" role="status">
          เชื่อมต่อคิวไม่ได้ · กำลังลองใหม่ — สิ่งที่เห็นอาจเก่า
        </p>
      )}
      {p.toggle.error !== null && (
        <p className="ad-inline-error" role="alert">
          {p.toggle.error}
        </p>
      )}
      {state === null ? (
        <Skeleton variant="lines" count={3} />
      ) : (
        <>
          {state.current !== null && progress !== null && (
            <>
              <div className="ad-cur">
                <span className="ad-spin" aria-hidden="true" />
                <div className="ad-cur-main">
                  <p className="ad-cur-title">
                    <Link to={chapterPath(state.current.novelId, state.current.chapterId)}>{`${state.current.novelTitle} · ตอนที่ ${state.current.number}`}</Link>
                  </p>
                  <p className="ad-cur-sub">{progress.label}</p>
                  <div className="ad-meter" role="progressbar" aria-label="ความคืบหน้าของตอนที่กำลังแปล" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                    <div className="ad-meter-fill" style={{ width: `${progress.percent}%` }} />
                  </div>
                </div>
              </div>
              <div className="ad-live" tabIndex={0} role="region" aria-label="ข้อความที่กำลังแปล" ref={p.tailRef} onScroll={p.onTailScroll}>
                {state.current.textTail === "" ? "รอข้อความแรก…" : state.current.textTail}
              </div>
            </>
          )}
          {idle !== null && <p className="ad-empty">{idle}</p>}
          {waiting.rows.length > 0 && (
            <ul className="ad-rows" aria-label="ตอนที่รอแปล">
              {waiting.rows.map((row) => (
                <li key={row.id} className="ad-row">
                  <ChapterRow
                    number={row.number}
                    novelId={row.novelId}
                    id={row.id}
                    novelTitle={row.novelTitle}
                    tail={
                      <span className="ad-pill" data-tone="warn">
                        รอคิว
                      </span>
                    }
                  />
                </li>
              ))}
              {waiting.more > 0 && <li className="ad-more">{`และอีก ${formatCount(waiting.more)} ตอน`}</li>}
            </ul>
          )}
        </>
      )}
      {p.errors.length > 0 && (
        <ul className="ad-rows ad-rows-errors" aria-label="ตอนที่แปลผิดพลาด">
          {p.errors.map((row) => {
            const busy = p.retry.busyIds.includes(row.id)
            const failure = p.retry.errors[row.id]
            return (
              <li key={row.id} className="ad-row">
                <ChapterRow
                  number={row.number}
                  novelId={row.novelId}
                  id={row.id}
                  novelTitle={row.novelTitle}
                  detail={row.error}
                  tail={
                    <button type="button" className="ad-retry" disabled={busy} onClick={() => p.retry.onRetry(row.id)} aria-label={`ลองแปลตอนที่ ${row.number} ของ ${row.novelTitle} ใหม่`}>
                      <RotateCw size={14} aria-hidden="true" />
                      {busy ? "กำลังส่ง…" : "ผิดพลาด · ลองใหม่"}
                    </button>
                  }
                />
                {failure !== undefined && (
                  <p className="ad-inline-error ad-row-fail" role="alert">
                    {failure}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ───────────────────────── ยอดอ่าน ความคืบหน้า การใช้ AI ─────────────────────────

export function ChartPanel({ views }: { views: DashboardDto["views"] }) {
  return (
    <section className="ad-panel" aria-labelledby="ad-chart-h">
      <div className="ad-panel-head">
        <h2 id="ad-chart-h">ยอดอ่าน 14 วัน</h2>
        <p className="ad-panel-sub">{`รวม ${formatCount(totalViews(views))} ครั้ง`}</p>
      </div>
      <BarChart views={views} />
    </section>
  )
}

export function ProgressPanel({ progress }: { progress: NovelProgressDto[] }) {
  return (
    <section className="ad-panel" aria-labelledby="ad-prog-h">
      <div className="ad-panel-head">
        <h2 id="ad-prog-h">ความคืบหน้าแต่ละเรื่อง</h2>
        <p className="ad-panel-sub">แปลแล้ว / ตอนที่เพิ่มไว้</p>
      </div>
      {progress.length === 0 ? (
        <p className="ad-empty">ยังไม่มีนิยาย — เพิ่มเรื่องแรกได้จากปุ่มด้านบน</p>
      ) : (
        <ul className="ad-prog">
          {progress.map((novel) => {
            const percent = progressPercent(novel.translated, novel.total)
            return (
              <li key={novel.novelId}>
                <div className="ad-prog-top">
                  <Link className="ad-prog-title" to={`/admin/novels/${novel.novelId}`}>
                    {novel.title}
                  </Link>
                  <span className="ad-prog-count">{`${formatCount(novel.translated)} / ${formatCount(novel.total)}`}</span>
                </div>
                <div className="ad-meter" role="progressbar" aria-label={`ความคืบหน้าการแปลของ ${novel.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <div className="ad-meter-fill" style={{ width: `${percent}%` }} />
                </div>
                <p className="ad-prog-sub">{`เผยแพร่แล้ว ${formatCount(novel.published)} ตอน`}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function UsageBlock({ title, rows, estimate }: { title: string; rows: UsageRowDto[]; estimate: number | null }) {
  const cost = formatUsd(estimate)
  const total = usageTotals(rows)
  return (
    <div className="ad-usage">
      <div className="ad-usage-head">
        <h3>{title}</h3>
        <p className="ad-usage-est">
          {cost !== null ? (
            <>
              {"ค่าใช้จ่ายโดยประมาณ "}
              <strong>{cost}</strong>
            </>
          ) : (
            <>
              {"ประเมินค่าใช้จ่ายไม่ได้ — กรอกราคาโมเดลในหน้า"}
              <Link to="/admin/settings">ตั้งค่า</Link>
            </>
          )}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="ad-empty">ยังไม่ได้ใช้ AI</p>
      ) : (
        <div className="ad-scroll" tabIndex={0} role="region" aria-label={`ตารางการใช้โทเคน ${title}`}>
          <table className="ad-table">
            <thead>
              <tr>
                <th scope="col">โมเดล</th>
                <th scope="col">เข้า</th>
                <th scope="col">ออก</th>
                <th scope="col">ครั้ง</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.model}>
                  <th scope="row">{row.model}</th>
                  <td>{formatCount(row.tokensIn)}</td>
                  <td>{formatCount(row.tokensOut)}</td>
                  <td>{formatCount(row.calls)}</td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="ad-table-total">
                  <th scope="row">รวม</th>
                  <td>{formatCount(total.tokensIn)}</td>
                  <td>{formatCount(total.tokensOut)}</td>
                  <td>{formatCount(total.calls)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function UsagePanel({ usage, estimate, api }: Pick<DashboardDto, "usage" | "estimate" | "api">) {
  const status = apiStatus(api)
  return (
    <section className="ad-panel" aria-labelledby="ad-usage-h">
      <div className="ad-panel-head">
        <h2 id="ad-usage-h">การใช้งาน AI</h2>
        <p className="ad-panel-sub">โทเคนที่ใช้แปลและสรุป</p>
      </div>
      <UsageBlock title="วันนี้" rows={usage.today} estimate={estimate.today} />
      <UsageBlock title="30 วันล่าสุด" rows={usage.last30} estimate={estimate.last30} />
      <div className="ad-api">
        <span className="ad-api-label">เชื่อมต่อ API</span>
        <span className="ad-pill" data-tone={status.tone}>
          {status.tone === "ok" && <Check size={14} aria-hidden="true" />}
          {status.label}
        </span>
        {status.detail !== "" && <p className="ad-api-detail">{status.detail}</p>}
      </div>
    </section>
  )
}

// ───────────────────────── ทั้งหน้า ─────────────────────────

export interface DashboardViewProps {
  data: DashboardDto | null
  /** ข้อผิดพลาดของการดึงแดชบอร์ด (ยังไม่มีข้อมูลเลย → แสดงหน้าผิดพลาด · มีข้อมูลเก่าอยู่ → แสดงข้อมูลเก่าพร้อมแถบเตือน) */
  error: ApiError | null
  loading: boolean
  onReload(): void
  queue: Pick<QueuePanelProps, "state" | "errors" | "offline" | "toggle" | "retry" | "tailRef" | "onTailScroll">
  publish: { open: boolean; notice: string | null; onOpen(): void; onConfirm(): Promise<void>; onCancel(): void; onDismissNotice(): void }
}

export function DashboardView({ data, error, loading, onReload, queue, publish }: DashboardViewProps) {
  const translating = queue.state !== null ? queue.state.current !== null : (data?.queue.current ?? null) !== null
  return (
    <>
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">ภาพรวมวันนี้</p>
          <h1>แดชบอร์ด</h1>
        </div>
        <div className="ad-ph-actions">
          <Link to="/admin/add" className="btn ghost">
            <FilePlus size={ICON} aria-hidden="true" />
            เพิ่มตอน
          </Link>
          <Link to="/admin/novels/new" className="btn primary">
            <Plus size={ICON} aria-hidden="true" />
            เพิ่มเรื่องใหม่
          </Link>
        </div>
      </div>
      {publish.notice !== null && (
        <p className="ad-notice" role="status">
          <span>{publish.notice}</span>
          <button type="button" className="ad-notice-close" aria-label="ปิดข้อความนี้" onClick={publish.onDismissNotice}>
            <X size={16} aria-hidden="true" />
          </button>
        </p>
      )}
      {data === null && error !== null && <ErrorState error={error} onRetry={onReload} />}
      {data === null && error === null && loading && <Skeleton variant="lines" count={6} />}
      {data !== null && (
        <>
          {error !== null && (
            <p className="ad-note" role="alert">
              อัปเดตตัวเลขไม่สำเร็จ — ตัวเลขที่เห็นอาจเก่า{" "}
              <button type="button" className="ad-link-btn" onClick={onReload}>
                ลองใหม่
              </button>
            </p>
          )}
          <OnboardingPanel onboarding={data.onboarding} />
          <StatCards counts={data.counts} translating={translating} onPublishAll={publish.onOpen} />
          <div className="ad-dash-row ad-dash-top">
            <QueuePanel {...queue} />
            <ChartPanel views={data.views} />
          </div>
          <div className="ad-dash-row">
            <ProgressPanel progress={data.progress} />
            <UsagePanel usage={data.usage} estimate={data.estimate} api={data.api} />
          </div>
        </>
      )}
      {/* แผงคิวมาจากคิวสด จึงแสดงได้แม้แดชบอร์ดยังโหลดไม่เสร็จ/ล้มเหลว แต่ไม่ซ้ำเมื่อโหลดสำเร็จแล้ว (อยู่ในแถวด้านบน) */}
      {data === null && queue.state !== null && <QueuePanel {...queue} />}
      {publish.open && data !== null && (
        <ConfirmDialog
          title="เผยแพร่ทุกตอนที่แปลแล้ว?"
          message={`จะเผยแพร่ ${formatCount(data.counts.readyToPublish)} ตอนที่แปลเสร็จแล้วแต่ยังไม่เผยแพร่ ผู้อ่านเห็นได้ทันที (ตอนของนิยายที่ยังซ่อนอยู่ จะยังไม่แสดงจนกว่าคุณจะเปิดเผยแพร่เรื่องนั้น)`}
          confirmLabel="เผยแพร่ทั้งหมด"
          onConfirm={publish.onConfirm}
          onCancel={publish.onCancel}
        />
      )}
    </>
  )
}

const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

export function Dashboard() {
  useDocumentTitle("แดชบอร์ด")
  const { data, error, loading, reload } = useFetch("admin:dashboard", () => admin.dashboard())
  const queue = useQueue()
  const { state, errors } = queue

  // ตัวเลขการ์ดตามคิว: ตอนจบ/ผิดพลาด/หยุด/ทำต่อ → ดึงแดชบอร์ดใหม่ (ครั้งแรกที่ได้สถานะคิวแค่จดไว้ ไม่ดึงซ้ำ)
  const signature = queueSignature(state, errors)
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (state === null) return
    const before = seen.current
    seen.current = signature
    if (before !== null && before !== signature) reload()
  }, [signature])

  // กล่องข้อความที่ไหล: เลื่อนลงท้ายสุดเองเมื่อมีข้อความใหม่ — เว้นแต่ผู้ใช้เลื่อนขึ้นไปอ่านเอง (กลับมาท้ายกล่องเมื่อไรก็ตามต่อ) และเริ่มใหม่ทุกตอน
  const tailRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const followed = useRef<number | null>(null)
  const chapterId = state?.current?.chapterId ?? null
  const textTail = state?.current?.textTail ?? ""
  useLayoutEffect(() => {
    if (followed.current !== chapterId) {
      followed.current = chapterId
      follow.current = true
    }
    const box = tailRef.current
    if (box !== null && follow.current) box.scrollTop = box.scrollHeight
  }, [chapterId, textTail])
  function onTailScroll(): void {
    const box = tailRef.current
    if (box !== null) follow.current = isNearBottom(box.scrollTop, box.clientHeight, box.scrollHeight)
  }

  // หยุด/ทำต่อคิว
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const toggleBusy = useRef(false)
  async function toggle(): Promise<void> {
    if (toggleBusy.current || state === null) return
    toggleBusy.current = true
    setToggling(true)
    setToggleError(null)
    try {
      if (state.paused) await admin.resume()
      else await admin.pause()
      queue.reload()
    } catch (e) {
      setToggleError(messageOf(e, state.paused ? "ทำต่อไม่สำเร็จ ลองอีกครั้ง" : "หยุดคิวไม่สำเร็จ ลองอีกครั้ง"))
    } finally {
      toggleBusy.current = false
      setToggling(false)
    }
  }

  // ตอนผิดพลาด: ลองแปลใหม่ทีละตอน
  const [retrying, setRetrying] = useState<number[]>([])
  const [retryErrors, setRetryErrors] = useState<Record<number, string>>({})
  const retryBusy = useRef(new Set<number>())
  async function retry(id: number): Promise<void> {
    if (retryBusy.current.has(id)) return
    retryBusy.current.add(id)
    setRetrying((ids) => [...ids, id])
    setRetryErrors(({ [id]: _dropped, ...rest }) => rest)
    try {
      await admin.bulk({ ids: [id], action: "translate" })
      queue.reload()
      reload()
    } catch (e) {
      setRetryErrors((current) => ({ ...current, [id]: messageOf(e, "ลองแปลใหม่ไม่สำเร็จ ลองอีกครั้ง") }))
    } finally {
      retryBusy.current.delete(id)
      setRetrying((ids) => ids.filter((x) => x !== id))
    }
  }

  // เผยแพร่ทุกตอนที่แปลแล้ว (ยืนยันก่อน)
  const [publishOpen, setPublishOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  async function publishAll(): Promise<void> {
    const result = await admin.bulk({ where: "ready", action: "publish" })
    setPublishOpen(false)
    setNotice(publishNotice(result))
    reload()
  }

  return (
    <DashboardView
      data={data}
      error={error}
      loading={loading}
      onReload={reload}
      queue={{
        state,
        errors,
        offline: queue.offline,
        toggle: { busy: toggling, error: toggleError, onToggle: () => void toggle() },
        retry: { busyIds: retrying, errors: retryErrors, onRetry: (id) => void retry(id) },
        tailRef,
        onTailScroll,
      }}
      publish={{ open: publishOpen, notice, onOpen: () => setPublishOpen(true), onConfirm: publishAll, onCancel: () => setPublishOpen(false), onDismissNotice: () => setNotice(null) }}
    />
  )
}
