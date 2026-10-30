/**
 * การ์ดใหญ่บนสุดของหน้าแรก (spec 6.1): เรื่องแนะนำ — พื้นหลังเป็นปกเบลอ มีโปสเตอร์เอียง ชื่อ แท็ก เรื่องย่อ และปุ่มอ่าน
 * เลือกเรื่องด้วย `pickHero` · `resume` = ข้อมูลอ่านต่อของเรื่องนี้ในเครื่องผู้อ่าน (ไม่เคยอ่าน = null)
 * ปุ่ม "เริ่มอ่าน" พาไปหน้าเรื่อง (ข้อมูลการ์ดยังไม่รู้เลขตอนแรก — หน้าเรื่องมีรายการตอนและปุ่มเริ่มอ่านที่ถูกตอนเสมอ)
 */
import { Play, Sparkles } from "lucide-react"
import { useId } from "react"
import { Link } from "react-router"
import type { ResumeInfo } from "../lib/library"
import { displayTitle } from "../lib/novel"
import type { NovelCardDto } from "../lib/types"
import { Cover } from "./Cover"
import { DraftBadge } from "./DraftBadge"

/** แท็กที่โชว์ในการ์ดใหญ่ */
const HERO_TAGS = 3

export function Hero({ novel, resume }: { novel: NovelCardDto; resume: ResumeInfo | null }) {
  const headingId = useId()
  const title = displayTitle(novel)
  const original = novel.titleTh.trim() !== "" ? novel.title.trim() : ""
  const author = novel.author.trim()
  const sub = [original, author !== "" ? `โดย ${author}` : ""].filter((part) => part !== "").join(" · ")
  const synopsis = novel.synopsisShort.trim()
  const home = `/novel/${novel.id}`
  const ongoing = novel.status === "ongoing"
  const primaryHref = resume?.href ?? home
  const cover = { id: novel.id, title, hasCover: novel.hasCover, coverV: novel.coverV }

  return (
    <section className="hero" aria-labelledby={headingId}>
      <div className="hero-bg" aria-hidden="true">
        <Cover novel={cover} />
      </div>
      <div className="hero-shade" aria-hidden="true" />
      <div className="hero-body">
        <div className="hero-text">
          <span className="hero-tag">
            <Sparkles aria-hidden="true" size={14} />
            {novel.featured ? "เรื่องแนะนำ" : "อัปเดตล่าสุด"}
          </span>
          <h2 className="hero-title" id={headingId}>
            {title}
          </h2>
          {sub !== "" ? <div className="hero-sub">{sub}</div> : null}
          <div className="hero-facts">
            <span className={ongoing ? "pill st" : "pill"}>{ongoing ? "ยังไม่จบ" : "จบแล้ว"}</span>
            {novel.chapterCount > 0 ? <span className="pill">{novel.chapterCount} ตอน</span> : null}
            {novel.tags.slice(0, HERO_TAGS).map((tag) => (
              <span className="pill" key={tag}>
                {tag}
              </span>
            ))}
            {novel.published ? null : <DraftBadge />}
          </div>
          {synopsis !== "" ? <p className="hero-syn">{synopsis}</p> : null}
          <div className="hero-cta">
            <Link to={primaryHref} className="btn primary">
              <Play aria-hidden="true" size={16} />
              {resume?.label ?? "เริ่มอ่าน"}
            </Link>
            {primaryHref !== home ? (
              <Link to={home} className="btn ghost">
                รายละเอียด
              </Link>
            ) : null}
          </div>
        </div>
        <div className="poster">
          <Cover novel={cover} />
        </div>
      </div>
    </section>
  )
}
