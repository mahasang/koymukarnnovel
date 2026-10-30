/**
 * "นิยายทั้งหมด" (spec 6.1): ชิปกรองสถานะและแท็ก ช่องเลือกการเรียง ตารางปก และปุ่ม "แสดงเพิ่ม" ทีละ 24 เรื่อง
 * ใช้เป็นผลการค้นหาด้วย (`/?q=`): คำค้นที่หน้าแรกอ่านจาก URL ส่งเข้ามาที่ `query`
 * แยกเป็น `LibraryView` (ไม่มี state ทดสอบง่าย) กับ `Library` (เก็บสถานะตัวกรอง + ปุ่มล้างที่พากลับ `/`)
 */
import { ArrowDownUp } from "lucide-react"
import { useEffect, useReducer, useRef, type Ref } from "react"
import { useNavigate } from "react-router"
import {
  INITIAL_LIBRARY,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  filterNovels,
  isSortKey,
  libraryReducer,
  shownCount,
  sortNovels,
  tagCounts,
  visibleTags,
  type LibraryAction,
  type LibraryState,
} from "../lib/library"
import type { NovelCardDto } from "../lib/types"
import { Chip } from "./Chip"
import { EmptyState } from "./EmptyState"
import { NovelCard } from "./NovelCard"

const HEADING_ID = "library-title"

export interface LibraryViewProps {
  /** นิยายทั้งหมดที่เว็บมี (ใช้นับแท็กด้วย) */
  novels: NovelCardDto[]
  /** คำค้นจาก URL (ตัดช่องว่างหัวท้ายแล้ว; ว่าง = ไม่ได้ค้น) */
  query: string
  state: LibraryState
  dispatch: (action: LibraryAction) => void
  /** ล้างคำค้นและตัวกรองทั้งหมด */
  onClear: () => void
  /** หัวข้อของส่วนนี้เป็นหัวข้อหลัก (h1) ของหน้า — เมื่อค้นหา Hero ถูกซ่อนและไม่มีหัวข้ออื่นขึ้นก่อน */
  asPageHeading: boolean
  now?: number
  /** ตัวอ้างอิงถึงตารางปก — `Library` ใช้ย้ายโฟกัสไปเรื่องแรกที่เพิ่งโผล่หลังกด "แสดงเพิ่ม" */
  gridRef?: Ref<HTMLDivElement>
}

export function LibraryView({ novels, query, state, dispatch, onClear, asPageHeading, now, gridRef }: LibraryViewProps) {
  const matched = sortNovels(filterNovels(novels, { query, status: state.status, tag: state.tag }), state.sort)
  const shown = shownCount(matched.length, state.pages)
  const remaining = matched.length - shown
  // ชิปแท็กนับจากเรื่องที่ตรงคำค้น (ไม่รวมสถานะ/แท็กที่เลือก — ชิปจะไม่กระโดดทุกครั้งที่สลับตัวกรอง): ระหว่างค้นหาไม่มีชิปที่กดแล้วว่างเปล่า
  const tags = visibleTags(tagCounts(filterNovels(novels, { query, status: "all", tag: null })), state.tag)
  const Heading = asPageHeading ? "h1" : "h2"
  const heading = query !== "" ? `ผลการค้นหา “${query}”` : "นิยายทั้งหมด"
  const count = matched.length === 0 ? "ไม่พบเรื่อง" : remaining > 0 ? `แสดง ${shown} จาก ${matched.length} เรื่อง` : `${matched.length} เรื่อง`

  return (
    <section aria-labelledby={HEADING_ID}>
      <Heading className="sec-h" id={HEADING_ID}>
        {heading}
      </Heading>
      <div className="lib-bar">
        <div className="chips" role="group" aria-label="สถานะ">
          {STATUS_OPTIONS.map((option) => (
            <Chip key={option.key} selected={state.status === option.key} onClick={() => dispatch({ type: "status", status: option.key })}>
              {option.label}
            </Chip>
          ))}
        </div>
        <label className="sort">
          <ArrowDownUp aria-hidden="true" size={15} />
          <span className="sort-label">เรียงตาม</span>
          <select
            value={state.sort}
            onChange={(event) => {
              const value = event.target.value
              if (isSortKey(value)) dispatch({ type: "sort", sort: value })
            }}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tags.length > 0 ? (
        <div className="chips" role="group" aria-label="แท็ก">
          {tags.map(({ tag }) => (
            <Chip key={tag} selected={state.tag === tag} onClick={() => dispatch({ type: "tag", tag })}>
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}
      {/* ไม่พบ: บอกเฉพาะโปรแกรมอ่านหน้าจอ (ข้อความสถานะว่างด้านล่างบอกคนที่มองเห็นอยู่แล้ว) */}
      <p className={matched.length === 0 ? "lib-count sr-only" : "lib-count"} role="status">
        {count}
      </p>
      {matched.length === 0 ? (
        <EmptyState
          title={query !== "" ? `ไม่พบนิยายที่ตรงกับ “${query}”` : "ไม่พบนิยายที่ตรงกับตัวกรอง"}
          hint="ลองใช้คำอื่น หรือล้างตัวกรองเพื่อดูนิยายทั้งหมด"
          action={
            <button type="button" className="btn ghost" onClick={onClear}>
              {query !== "" ? "ล้างการค้นหา" : "ล้างตัวกรอง"}
            </button>
          }
        />
      ) : (
        <div className="grid" ref={gridRef}>
          {matched.slice(0, shown).map((novel) => (
            <NovelCard key={novel.id} novel={novel} now={now} chip={novel.latestNumber !== null ? `ตอน ${novel.latestNumber}` : null} />
          ))}
        </div>
      )}
      {remaining > 0 ? (
        <div className="more">
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: "more" })}>
            แสดงเพิ่ม <span className="more-left">(อีก {remaining} เรื่อง)</span>
          </button>
        </div>
      ) : null}
    </section>
  )
}

export function Library({ novels, query, asPageHeading, now }: { novels: NovelCardDto[]; query: string; asPageHeading: boolean; now?: number }) {
  const [state, dispatch] = useReducer(libraryReducer, INITIAL_LIBRARY)
  const navigate = useNavigate()
  const gridRef = useRef<HTMLDivElement>(null)
  /** จำนวนการ์ดก่อนกด "แสดงเพิ่ม" = ตำแหน่งของการ์ดใบแรกที่จะโผล่ (null = ไม่ได้รอย้ายโฟกัส) */
  const revealFrom = useRef<number | null>(null)
  useEffect(() => {
    const from = revealFrom.current
    revealFrom.current = null
    // ปุ่ม "แสดงเพิ่ม" หายไปเมื่อแสดงครบ ทำให้โฟกัสของคนใช้คีย์บอร์ดตกไปที่ท้ายหน้า (BODY): ย้ายไปเรื่องแรกที่เพิ่งโผล่ ไม่เลื่อนหน้าหนี
    if (from !== null) (gridRef.current?.children[from] as HTMLElement | undefined)?.focus({ preventScroll: true })
  }, [state.pages])
  const clear = () => {
    dispatch({ type: "reset" })
    if (query !== "") navigate("/")
  }
  const act = (action: LibraryAction) => {
    if (action.type === "more") revealFrom.current = gridRef.current?.children.length ?? null
    dispatch(action)
  }
  return <LibraryView novels={novels} query={query} state={state} dispatch={act} onClear={clear} asPageHeading={asPageHeading} now={now} gridRef={gridRef} />
}
