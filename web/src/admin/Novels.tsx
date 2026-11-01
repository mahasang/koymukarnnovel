/**
 * รายการนิยายหลังบ้าน (spec 7.4): ปก · ชื่อ · สถานะ · แปลแล้ว/ทั้งหมด · สวิตช์เผยแพร่ · แก้ไข / ลบ (ยืนยันก่อนลบ)
 * `NovelsView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `Novels` ดึงรายการ สลับเผยแพร่ ลบ — ผลของแต่ละคำสั่งแก้รายการในหน้าเลย ไม่ดึงใหม่ทั้งหมด
 */
import { Pencil, Plus, Star, Trash2 } from "lucide-react"
import { useRef, useState } from "react"
import { Link } from "react-router"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { Cover } from "../components/Cover"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Switch } from "../components/Switch"
import { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { countsText, deleteMessage, novelTitles, STATUS_TEXT } from "./novel-logic"
import type { AdminNovelDto } from "./types"
import { useMounted } from "./useMounted"

const ICON = 18

export interface NovelsViewProps {
  novels: AdminNovelDto[]
  /** เรื่องที่กำลังบันทึกการสลับเผยแพร่ (สวิตช์ของแถวนั้นปิดอยู่) */
  busyId: number | null
  /** ข้อความเมื่อสั่งสลับเผยแพร่ไม่สำเร็จ */
  error: string | null
  onToggle(novel: AdminNovelDto): void
  onDelete(novel: AdminNovelDto): void
}

const addNovelLink = (
  <Link to="/admin/novels/new" className="btn primary">
    <Plus size={ICON} aria-hidden="true" />
    เพิ่มเรื่องใหม่
  </Link>
)

/** หัวหน้า: อยู่ครบตั้งแต่ตอนกำลังโหลด (หน้าไม่กระโดดเมื่อข้อมูลมา) */
export function NovelsHeader() {
  return (
    <div className="ad-ph">
      <div className="ad-ph-text">
        <p className="ad-eyebrow">จัดการเรื่องและตอน</p>
        <h1>นิยาย</h1>
      </div>
      <div className="ad-ph-actions">{addNovelLink}</div>
    </div>
  )
}

export function NovelsView(p: NovelsViewProps) {
  return (
    <>
      <NovelsHeader />
      {p.error !== null && (
        <p className="ad-inline-error" role="alert">
          {p.error}
        </p>
      )}
      {p.novels.length === 0 ? (
        <EmptyState title="ยังไม่มีนิยาย" hint="เริ่มจากเพิ่มเรื่องแรก แล้ววางตอนภาษาอังกฤษให้ AI แปล" action={addNovelLink} />
      ) : (
        <div className="ad-scroll">
          <table className="ad-table ad-ntable">
            <caption className="sr-only">รายการนิยาย</caption>
            <thead>
              <tr>
                <th scope="col">เรื่อง</th>
                <th scope="col">สถานะ</th>
                <th scope="col">แปลแล้ว / ทั้งหมด</th>
                <th scope="col">เผยแพร่</th>
                <th scope="col">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {p.novels.map((novel) => {
                const { main, sub } = novelTitles(novel)
                return (
                  <tr key={novel.id}>
                    <td className="ad-ncell">
                      <Link to={`/admin/novels/${novel.id}`} className="ad-nlink">
                        <span className="ad-thumb">
                          <Cover novel={{ id: novel.id, title: main, hasCover: novel.hasCover, coverV: novel.coverV }} />
                        </span>
                        <span className="ad-ntext">
                          <strong>{main}</strong>
                          {sub !== "" && <span className="ad-nsub">{sub}</span>}
                        </span>
                      </Link>
                      {novel.featured && (
                        <span className="ad-pill" data-tone="idle">
                          <Star size={13} aria-hidden="true" />
                          แนะนำ
                        </span>
                      )}
                    </td>
                    <td>{STATUS_TEXT[novel.status]}</td>
                    <td>
                      <span className="ad-ncount">{countsText(novel)}</span>
                      <span className="ad-nsub">{`เผยแพร่ ${novel.publishedCount} ตอน`}</span>
                    </td>
                    <td>
                      <Switch checked={novel.published} onChange={() => p.onToggle(novel)} label={`เผยแพร่ ${main}`} disabled={p.busyId === novel.id} />
                    </td>
                    <td>
                      <div className="ad-nact">
                        <Link to={`/admin/novels/${novel.id}`} className="iconbtn" aria-label={`แก้ไข ${main}`}>
                          <Pencil size={ICON} aria-hidden="true" />
                        </Link>
                        <button type="button" className="iconbtn" aria-label={`ลบ ${main}`} onClick={() => p.onDelete(novel)}>
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
      )}
    </>
  )
}

const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

export function Novels() {
  useDocumentTitle("นิยาย")
  const { data, error, reload } = useFetch("admin:novels", () => admin.novels())
  /** รายการหลังสั่งสลับ/ลบ (null = ยังใช้ที่ดึงมา) — ผลของคำสั่งแก้ในหน้าทันที ไม่ต้องรอดึงใหม่ จึงไม่มีช่วงที่สวิตช์โชว์ค่าเก่า */
  const [rows, setRows] = useState<AdminNovelDto[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminNovelDto | null>(null)
  const mounted = useMounted()
  const working = useRef(false)

  const list = rows ?? data
  if (list === null) {
    return (
      <>
        <NovelsHeader />
        {error !== null ? <ErrorState error={error} onRetry={reload} /> : <Skeleton variant="lines" />}
      </>
    )
  }

  async function toggle(novel: AdminNovelDto): Promise<void> {
    if (working.current) return
    working.current = true
    setBusyId(novel.id)
    setToggleError(null)
    try {
      const updated = await admin.patchNovel(novel.id, { published: !novel.published })
      if (mounted.current) setRows((current) => (current ?? list!).map((n) => (n.id === updated.id ? updated : n)))
    } catch (e) {
      if (mounted.current) setToggleError(`${novelTitles(novel).main}: ${messageOf(e)}`)
    } finally {
      working.current = false
      if (mounted.current) setBusyId(null)
    }
  }

  async function remove(novel: AdminNovelDto): Promise<void> {
    await admin.deleteNovel(novel.id) // ล้มเหลว → ConfirmDialog แสดงข้อความเอง
    setRows((current) => (current ?? list!).filter((n) => n.id !== novel.id))
    setPendingDelete(null)
  }

  return (
    <>
      <NovelsView novels={list} busyId={busyId} error={toggleError} onToggle={(novel) => void toggle(novel)} onDelete={setPendingDelete} />
      {pendingDelete !== null && (
        <ConfirmDialog title="ลบนิยายเรื่องนี้?" message={deleteMessage(pendingDelete)} confirmLabel="ลบถาวร" danger onConfirm={() => remove(pendingDelete)} onCancel={() => setPendingDelete(null)} />
      )}
    </>
  )
}
