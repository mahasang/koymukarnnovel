/**
 * หน้าอ่าน `/novel/:id/:number` (spec 6.3) อยู่นอก Layout: ไม่มีแถบบนของเว็บ/ท้ายเว็บ ให้อ่านเต็มจอ มีแถบบนของหน้าอ่านเองที่ซ่อน/โผล่ตามทิศเลื่อน
 * แยกชั้นแบบเดียวกับหน้าเรื่อง:
 * - `ReaderBodyView` / `ReaderNavView` — เนื้อหาตอนกับปุ่มท้ายตอน (ไม่มี hook ทดสอบโครงสร้างได้ตรงๆ)
 * - `ReaderPage` — ใส่พฤติกรรมของเบราว์เซอร์: เลื่อน→แถบบน/เปอร์เซ็นต์/บันทึกความคืบหน้า, คืนตำแหน่ง, คีย์ ←/→, การตั้งค่า, เสียงอ่าน
 * - `ReaderContent` — เลือกว่าจะแสดง ไม่พบ/ผิดพลาด/กำลังโหลด/หน้าอ่าน · `Reader` — อ่านเลขจาก URL แล้วโหลดตอน
 */
import { ChevronLeft, ChevronRight } from "lucide-react"
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { DraftBadge } from "../components/DraftBadge"
import { ErrorState } from "../components/ErrorState"
import { ReaderBar } from "../components/ReaderBar"
import { ReaderSettings } from "../components/ReaderSettings"
import { Skeleton } from "../components/Skeleton"
import { publicApi, type ApiError } from "../lib/api"
import { displayTitle, parseNovelId } from "../lib/novel"
import { getProgress, saveProgress } from "../lib/progress"
import {
  INITIAL_BAR,
  chapterHeading,
  chapterKeyAction,
  chapterTitle,
  firstVisibleParagraph,
  nextBarState,
  parseChapterParam,
  restoreTop,
  scrollPct,
  shouldRestore,
} from "../lib/reader"
import { clampRate, getReaderPrefs, saveReaderPrefs, type FontId, type ReaderPrefs } from "../lib/reader-prefs"
import { getTheme, setTheme, type ThemeId } from "../lib/theme"
import { isSceneBreak, splitParagraphs } from "../lib/text"
import type { ChapterPageDto } from "../lib/types"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { useSpeech } from "../lib/useSpeech"
import { NotFound } from "./NotFound"

/** หน่วงบันทึกตำแหน่งที่อ่านถึง (มิลลิวินาที) — เลื่อนอยู่ไม่เขียน localStorage ทุกเฟรม */
export const SAVE_DELAY_MS = 500

/** หลังเปิดตอนที่อ่านค้างไว้ รอฟอนต์โหลดเสร็จเพื่อปรับตำแหน่งเลื่อนอีกครั้งได้นานเท่านี้ (มิลลิวินาที) */
export const FONT_SETTLE_MS = 3000
/** ช่องว่าง (px) ระหว่างขอบล่างแถบบนกับย่อหน้าที่เลื่อนตามเสียง */
export const FOLLOW_GAP = 16

export interface ReaderBodyViewProps {
  heading: string
  /** ตอนที่ยังไม่เผยแพร่ที่ผู้ดูแลเห็น */
  draft: boolean
  paragraphs: string[]
  /** ย่อหน้าที่กำลังอ่านออกเสียง (ไม่ได้อ่าน = null) */
  activeIndex: number | null
  fontSize: number
  font: FontId
  /** กรอบของย่อหน้าทั้งหมด — ลูกลำดับที่ i = ย่อหน้าที่ i เสมอ (เส้นคั่นฉากก็นับเป็นหนึ่งลูก) */
  textRef?: Ref<HTMLDivElement>
}

export function ReaderBodyView({ heading, draft, paragraphs, activeIndex, fontSize, font, textRef }: ReaderBodyViewProps) {
  const serif = font === "serif"
  return (
    <article className={serif ? "rd rd-serif" : "rd"} style={{ fontSize }}>
      <h1 className="rd-heading">{heading}</h1>
      {draft ? (
        <div className="rd-draft">
          <DraftBadge />
        </div>
      ) : null}
      <div className="rd-text" ref={textRef}>
        {paragraphs.map((paragraph, index) =>
          isSceneBreak(paragraph) ? (
            <div key={index} className="rd-scene" role="separator">
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <i aria-hidden="true" />
            </div>
          ) : (
            <p key={index} className={index === activeIndex ? "rd-p speaking" : "rd-p"}>
              {paragraph}
            </p>
          ),
        )}
      </div>
      {paragraphs.length === 0 ? <p className="rd-empty">ตอนนี้ยังไม่มีเนื้อหา</p> : null}
    </article>
  )
}

/** ไม่วาดเนื้อหาใหม่ตอนเลื่อน (แถบบน/เปอร์เซ็นต์เปลี่ยนบ่อย) — props ของมันเปลี่ยนเฉพาะเมื่อมีเหตุจริง */
const ReaderBody = memo(ReaderBodyView)

export function ReaderNavView({ novelId, prev, next }: { novelId: number; prev: number | null; next: number | null }) {
  const base = `/novel/${novelId}`
  return (
    <nav className="rd-nav" aria-label="เปลี่ยนตอน">
      {prev !== null ? (
        <Link to={`${base}/${prev}`} className="btn ghost rd-prev" rel="prev">
          <ChevronLeft aria-hidden="true" size={18} />
          ตอนก่อนหน้า
        </Link>
      ) : (
        <span className="btn ghost rd-prev off">ไม่มีตอนก่อนหน้า</span>
      )}
      <Link to={base} className="btn ghost rd-toc">
        สารบัญ
      </Link>
      {next !== null ? (
        <Link to={`${base}/${next}`} className="btn primary rd-next" rel="next">
          ตอนถัดไป
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      ) : (
        <span className="btn ghost rd-next off">ยังไม่มีตอนถัดไป</span>
      )}
    </nav>
  )
}

export function ReaderPage({ page }: { page: ChapterPageDto }) {
  const { novel, chapter, prev, next } = page
  const navigate = useNavigate()
  const novelTitle = displayTitle(novel)
  const paragraphs = useMemo(() => splitParagraphs(chapter.text), [chapter.text])
  const [prefs, setPrefs] = useState<ReaderPrefs>(getReaderPrefs)
  const [theme, setThemeState] = useState<ThemeId>(getTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const speech = useSpeech(paragraphs, prefs.rate)
  const listening = speech.state !== "idle"
  const pinned = settingsOpen || listening
  const settingsId = useId()

  const barRef = useRef<HTMLElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const [barVisible, setBarVisible] = useState(INITIAL_BAR.visible)
  const [pct, setPct] = useState(0)
  const barState = useRef(INITIAL_BAR)
  const pinnedRef = useRef(pinned)
  const latestPct = useRef(0)
  const saveTimer = useRef(0)
  const dirty = useRef(false)

  const persist = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = 0
    if (!dirty.current) return
    dirty.current = false
    // ร่าง (ผู้ดูแลดูตัวอย่าง) ไม่เข้าประวัติการอ่านของเครื่องนี้
    if (chapter.published) saveProgress(novel.id, { number: chapter.number, pct: latestPct.current, next })
  }, [novel.id, chapter.number, chapter.published, next])

  /** มีตำแหน่งใหม่รอบันทึก: นับ 0.5 วินาทีใหม่ทุกครั้งที่เลื่อน (บันทึกครั้งเดียวหลังหยุดเลื่อน) */
  const markDirty = useCallback(() => {
    dirty.current = true
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(persist, SAVE_DELAY_MS)
  }, [persist])

  const measure = useCallback(() => {
    const y = window.scrollY
    barState.current = nextBarState(barState.current, y, pinnedRef.current)
    setBarVisible(barState.current.visible)
    const value = scrollPct(y, document.documentElement.scrollHeight, window.innerHeight)
    setPct(Math.round(value))
    if (value !== latestPct.current) {
      latestPct.current = value
      markDirty()
    }
  }, [markDirty])

  // เปิดตอน: ตอนที่อ่านค้างไว้ → เลื่อนกลับที่เดิม · อย่างอื่นเริ่มบนสุด (หน้านี้อยู่นอก Layout ที่ปกติเลื่อนขึ้นบนให้)
  // แล้วบันทึกตำแหน่งเริ่มต้นนั้นเลย (เปิดตอนแล้วยังไม่เลื่อนก็นับว่าอ่านเรื่องนี้อยู่ — "อ่านต่อ" ชี้มาที่ตอนนี้)
  useLayoutEffect(() => {
    const saved = getProgress(novel.id)
    const resumePct = saved !== null && shouldRestore(saved, chapter.number) ? saved.pct : null
    const place = () => (resumePct === null ? 0 : restoreTop(resumePct, document.documentElement.scrollHeight, window.innerHeight))
    window.scrollTo({ top: place(), left: 0, behavior: "instant" })
    measure()
    markDirty()
    if (resumePct === null) return
    // ฟอนต์เว็บโหลดเสร็จหลังจากนั้นทำให้ความสูงหน้าเปลี่ยน (ฟอนต์สำรองกับ Sarabun ตัดบรรทัดไม่เท่ากัน) → เปอร์เซ็นต์เดิมชี้ที่ใหม่
    // คำนวณตำแหน่งซ้ำตอนฟอนต์โหลดเสร็จ ภายใน FONT_SETTLE_MS แรก และเฉพาะตราบที่ผู้อ่านยังไม่ได้เลื่อนเอง
    let live = true
    const settle = () => {
      if (!live) return
      window.scrollTo({ top: place(), left: 0, behavior: "instant" })
      measure()
    }
    const stop = () => {
      live = false
    }
    const fonts = document.fonts as FontFaceSet | undefined
    void fonts?.ready.then(settle)
    fonts?.addEventListener?.("loadingdone", settle)
    const taken = ["wheel", "touchstart", "pointerdown", "keydown"] as const
    for (const type of taken) window.addEventListener(type, stop, { passive: true, capture: true })
    const timer = window.setTimeout(stop, FONT_SETTLE_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
      fonts?.removeEventListener?.("loadingdone", settle)
      for (const type of taken) window.removeEventListener(type, stop, { capture: true })
    }
  }, [novel.id, chapter.number, measure, markDirty])

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame === 0)
        frame = window.requestAnimationFrame(() => {
          frame = 0
          measure()
        })
    }
    const flush = () => persist()
    const onHide = () => {
      if (document.visibilityState === "hidden") persist()
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onHide)
      window.cancelAnimationFrame(frame)
      persist() // ออกจากตอน (ไปตอนอื่น/หน้าอื่น) ภายใน 0.5 วินาที ตำแหน่งสุดท้ายไม่หาย
    }
  }, [measure, persist])

  // กำลังฟัง/เปิดแผงตั้งค่า → แถบต้องอยู่ให้กดได้
  useEffect(() => {
    pinnedRef.current = pinned
    barState.current = nextBarState(barState.current, window.scrollY, pinned)
    setBarVisible(barState.current.visible)
  }, [pinned])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = chapterKeyAction(event, { prev, next }, settingsOpen)
      if (action === null) return
      const target = action === "next" ? next : prev
      if (target === null) return
      event.preventDefault()
      void navigate(`/novel/${novel.id}/${target}`)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [prev, next, settingsOpen, novel.id, navigate])

  // ย่อหน้าที่กำลังอ่านออกเสียงหลุดจอ → เลื่อนตาม (`behavior: auto` = ตาม CSS: นุ่มนวล ยกเว้นผู้ใช้ตั้งลดการเคลื่อนไหว)
  // วัดจากขอบล่างของแถบบนจริง: ตอนฟังแถบมีแถวควบคุมเสียงเพิ่ม (สูงกว่าปกติ และสูงขึ้นอีกถ้าแถวห่อบนจอแคบ) ค่า scroll-margin ตายตัวจึงไม่พอ
  useEffect(() => {
    if (speech.state !== "playing") return
    const element = textRef.current?.children[speech.index]
    if (!(element instanceof HTMLElement)) return
    const rect = element.getBoundingClientRect()
    const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0
    if (rect.top < barBottom || rect.bottom > window.innerHeight) window.scrollBy({ top: rect.top - barBottom - FOLLOW_GAP, left: 0, behavior: "auto" })
  }, [speech.index, speech.state])

  useDocumentTitle(chapterTitle(novel, chapter))

  const hasSpeakable = paragraphs.some((paragraph) => !isSceneBreak(paragraph))
  const listenAvailable = speech.supported && speech.hasThaiVoice && hasSpeakable

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    const updated = { ...prefs, ...patch }
    setPrefs(updated)
    saveReaderPrefs(updated)
  }
  const listen = () => {
    const bottoms = Array.from(textRef.current?.children ?? [], (element) => element.getBoundingClientRect().bottom)
    speech.play(firstVisibleParagraph(bottoms, barRef.current?.getBoundingClientRect().bottom ?? 0))
  }
  const changeRate = (rate: number) => {
    speech.setRate(rate)
    updatePrefs({ rate: clampRate(rate) })
  }
  const chooseTheme = (choice: ThemeId) => {
    setTheme(choice)
    setThemeState(choice)
  }
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div className="reader">
      <ReaderBar
        novelId={novel.id}
        novelTitle={novelTitle}
        number={chapter.number}
        visible={barVisible}
        pct={pct}
        listenAvailable={listenAvailable}
        speechState={speech.state}
        rate={speech.rate}
        settingsOpen={settingsOpen}
        settingsId={settingsId}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onListen={listen}
        onStop={speech.stop}
        onPause={speech.pause}
        onResume={speech.resume}
        onPrev={speech.prev}
        onNext={speech.next}
        onRate={changeRate}
        rootRef={barRef}
        settingsButtonRef={settingsButtonRef}
      />
      <ReaderSettings
        open={settingsOpen}
        toggleRef={settingsButtonRef}
        id={settingsId}
        theme={theme}
        fontSize={prefs.fontSize}
        font={prefs.font}
        voiceMissing={!speech.supported || !speech.hasThaiVoice}
        onTheme={chooseTheme}
        onFontSize={(fontSize) => updatePrefs({ fontSize })}
        onFont={(font) => updatePrefs({ font })}
        onClose={closeSettings}
      />
      <main className="rd-main">
        <ReaderBody
          heading={chapterHeading(chapter)}
          draft={!chapter.published}
          paragraphs={paragraphs}
          activeIndex={listening ? speech.index : null}
          fontSize={prefs.fontSize}
          font={prefs.font}
          textRef={textRef}
        />
        <ReaderNavView novelId={novel.id} prev={prev} next={next} />
      </main>
    </div>
  )
}

export interface ReaderContentProps {
  /** เลขนิยาย/เลขตอนจาก URL; `null` = ใช้ไม่ได้ */
  id: number | null
  number: number | null
  data: ChapterPageDto | null
  error: ApiError | null
  onRetry: () => void
}

/** หน้าอ่านอยู่นอก Layout — สถานะอื่นที่ไม่ใช่ตัวหน้าอ่านจึงห่อด้วยโครงเนื้อหาเอง */
function Plain({ children }: { children: ReactNode }) {
  return <main className="wrap main">{children}</main>
}

export function ReaderContent({ id, number, data, error, onRetry }: ReaderContentProps) {
  if (id === null || number === null || error?.status === 404) {
    return (
      <Plain>
        <NotFound />
      </Plain>
    )
  }
  if (error !== null) {
    return (
      <Plain>
        <ErrorState error={error} onRetry={onRetry} />
      </Plain>
    )
  }
  if (data === null) {
    return (
      <Plain>
        <Skeleton variant="lines" count={12} />
      </Plain>
    )
  }
  return <ReaderPage key={`${data.novel.id}:${data.chapter.number}`} page={data} />
}

export function Reader() {
  const params = useParams()
  const id = parseNovelId(params.id)
  const number = parseChapterParam(params.number)
  const { data, error, reload } = useFetch(id === null || number === null ? null : `chapter:${id}:${number}`, (signal) => publicApi.chapter(id ?? 0, number ?? 0, signal))
  return <ReaderContent id={id} number={number} data={data} error={error} onRetry={reload} />
}
