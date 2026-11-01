/**
 * รายการตอนบนหน้าเรื่อง (spec 6.2): 50 ตอนต่อหน้า สลับเรียง ใหม่→เก่า / เก่า→ใหม่ ช่อง "ไปตอนที่ …" และไฮไลต์ตอนที่อ่านล่าสุด
 * แยกเป็น `ChapterListView` (ไม่มี state ทดสอบง่าย) กับ `ChapterList` (เก็บสถานะ + ย้ายโฟกัส/เลื่อนหน้าจอ — ทำได้เฉพาะในเบราว์เซอร์)
 */
import { useEffect, useReducer, useRef, useState, type Ref } from "react"
import { Link } from "react-router"
import {
  INITIAL_LIST,
  ORDER_OPTIONS,
  clampPage,
  listReducer,
  pageCount,
  pageSlice,
  resolveJump,
  type ListAction,
  type ListState,
} from "../lib/chapter-list"
import { useI18n } from "../i18n/I18nProvider"
import type { Locale } from "../i18n/types"
import { formatDate } from "../lib/format"
import { displayTitle } from "../lib/novel"
import type { ChapterItemDto } from "../lib/types"
import { Chip } from "./Chip"
import { DraftBadge } from "./DraftBadge"

const HEADING_ID = "chapters-title"
const JUMP_ID = "chapter-jump"
const JUMP_ERROR_ID = "chapter-jump-error"

export interface ChapterListViewProps {
  novelId: number
  chapters: ChapterItemDto[]
  state: ListState
  /** เลขตอนที่อ่านล่าสุดในเครื่องนี้ (ไม่เคยอ่าน = null; ตอนที่ 0 เป็นตอนจริง) */
  lastRead: number | null
  jumpValue: string
  jumpError: string | null
  onJumpValue: (value: string) => void
  onJumpSubmit: () => void
  dispatch: (action: ListAction) => void
  /** ตัวอ้างอิงถึงรายการ — `ChapterList` ใช้ย้ายโฟกัสไปตอนที่กระโดดไปหา */
  listRef?: Ref<HTMLOListElement>
  /** ตัวอ้างอิงถึงหัวข้อ — `ChapterList` เลื่อนกลับมาที่หัวรายการหลังกดเปลี่ยนหน้า */
  headingRef?: Ref<HTMLHeadingElement>
  /** ภาษาของวันที่ — ผู้ทดสอบเรียกฟังก์ชันนี้ตรงๆ (ไม่ผ่านการเรนเดอร์) จึงใช้ hook ในนี้ไม่ได้: ตัวห่อส่งมาให้ ไม่ส่ง = ไทย */
  locale?: Locale
}

export function ChapterListView({ novelId, chapters, state, lastRead, jumpValue, jumpError, onJumpValue, onJumpSubmit, dispatch, listRef, headingRef, locale = "th" }: ChapterListViewProps) {
  const total = chapters.length
  if (total === 0) {
    return (
      <section className="nv-sec" aria-labelledby={HEADING_ID}>
        <h2 className="nv-h" id={HEADING_ID} ref={headingRef}>
          รายการตอน
        </h2>
        <p className="ch-empty">ยังไม่มีตอนให้อ่าน</p>
      </section>
    )
  }

  const pages = pageCount(total)
  const page = clampPage(state.page, total)
  const rows = pageSlice(chapters, state.order, page)
  const numbers = rows.map((chapter) => chapter.number)
  const range = `${Math.min(...numbers)}–${Math.max(...numbers)}`

  return (
    <section className="nv-sec" aria-labelledby={HEADING_ID}>
      <h2 className="nv-h" id={HEADING_ID} ref={headingRef}>
        รายการตอน<span className="nv-count"> ({total})</span>
      </h2>
      <div className="ch-bar">
        <div className="ch-orders chips" role="group" aria-label="เรียงตอน">
          {ORDER_OPTIONS.map((option) => (
            <Chip key={option.key} selected={state.order === option.key} onClick={() => dispatch({ type: "order", order: option.key })}>
              {option.label}
            </Chip>
          ))}
        </div>
        <form
          className="ch-jump"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            onJumpSubmit()
          }}
        >
          <label htmlFor={JUMP_ID}>ไปตอนที่</label>
          <input
            id={JUMP_ID}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={jumpValue}
            aria-invalid={jumpError !== null ? true : undefined}
            aria-describedby={jumpError !== null ? JUMP_ERROR_ID : undefined}
            onChange={(event) => onJumpValue(event.target.value)}
          />
          <button type="submit" className="btn ghost">
            ไป
          </button>
        </form>
      </div>
      {jumpError !== null ? (
        <p className="ch-err" id={JUMP_ERROR_ID} role="alert">
          {jumpError}
        </p>
      ) : null}
      <ol className="ch-list" ref={listRef}>
        {rows.map((chapter) => {
          const title = displayTitle(chapter)
          const date = chapter.publishedAt !== null ? formatDate(chapter.publishedAt, locale) : ""
          const isLast = chapter.number === lastRead
          const isJump = chapter.number === state.jump
          return (
            <li key={chapter.number} className={["ch-row", isLast ? "last" : "", isJump ? "jump" : ""].filter((name) => name !== "").join(" ")}>
              <Link to={`/novel/${novelId}/${chapter.number}`} className="ch-link">
                <span className="ch-num">ตอนที่ {chapter.number}</span>
                {title !== "" ? <span className="ch-title">{title}</span> : null}
                <span className="ch-meta">
                  {isLast ? <span className="ch-tag">อ่านล่าสุด</span> : null}
                  {chapter.published ? date !== "" ? <span className="ch-date">{date}</span> : null : <DraftBadge compact />}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      {pages > 1 ? (
        <nav className="ch-pager" aria-label="หน้ารายการตอน">
          <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => dispatch({ type: "page", page: page - 1, count: total })}>
            ก่อนหน้า
          </button>
          <span className="ch-page" aria-live="polite">
            หน้า {page} จาก {pages} · ตอนที่ {range}
          </span>
          <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => dispatch({ type: "page", page: page + 1, count: total })}>
            ถัดไป
          </button>
        </nav>
      ) : null}
    </section>
  )
}

export function ChapterList({ novelId, chapters, lastRead }: { novelId: number; chapters: ChapterItemDto[]; lastRead: number | null }) {
  const { locale } = useI18n()
  const [state, dispatch] = useReducer(listReducer, INITIAL_LIST)
  const [jumpValue, setJumpValue] = useState("")
  const [jumpError, setJumpError] = useState<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  /** เปลี่ยนหน้าด้วยปุ่มแบ่งหน้า (ไม่ใช่ตอนเปิดหน้า/กระโดด) → เลื่อนกลับหัวรายการ */
  const scrollToTop = useRef(false)

  useEffect(() => {
    if (!scrollToTop.current) return
    scrollToTop.current = false
    // ปุ่มแบ่งหน้าอยู่ท้ายรายการ: หน้าใหม่ต้องเริ่มอ่านจากแถวแรก ไม่ค้างอยู่ท้ายหน้า
    headingRef.current?.scrollIntoView({ block: "start" })
  }, [state.page])

  useEffect(() => {
    if (state.jumps === 0) return
    // กระโดดไปตอน: ย้ายโฟกัสไปลิงก์ของแถวที่ไฮไลต์ (คนใช้คีย์บอร์ด/โปรแกรมอ่านหน้าจอไปถึงตอนนั้นทันที) แล้วเลื่อนให้อยู่กลางจอ
    const link = listRef.current?.querySelector<HTMLElement>("li.jump a")
    link?.focus({ preventScroll: true })
    link?.scrollIntoView({ block: "center" })
  }, [state.jumps])

  const act = (action: ListAction) => {
    scrollToTop.current = action.type === "page"
    dispatch(action)
  }
  const submit = () => {
    const result = resolveJump(chapters, state.order, jumpValue)
    if (!result.ok) {
      setJumpError(result.message)
      return
    }
    setJumpError(null)
    act({ type: "jump", number: result.number, page: result.page })
  }
  const typeJump = (value: string) => {
    setJumpValue(value)
    setJumpError(null)
  }

  return (
    <ChapterListView
      novelId={novelId}
      chapters={chapters}
      state={state}
      lastRead={lastRead}
      jumpValue={jumpValue}
      jumpError={jumpError}
      onJumpValue={typeJump}
      onJumpSubmit={submit}
      dispatch={act}
      listRef={listRef}
      headingRef={headingRef}
      locale={locale}
    />
  )
}
