/**
 * กราฟแท่ง "ยอดอ่าน 14 วัน" — SVG ล้วน ไม่ใช้ไลบรารีกราฟ
 * `barGeometry` คำนวณตำแหน่งแท่ง (ไม่มี DOM จึงเทสต์ตรงๆ ได้) · `BarChart` เป็นส่วนแสดงผลล้วน ไม่มี hook
 * เส้นกราฟอยู่ใน SVG ที่ยืดตามความกว้างของกล่อง (`preserveAspectRatio="none"`, สูงคงที่ด้วย CSS)
 * ส่วนป้ายวันที่เป็นตาราง HTML ช่องเท่ากันใต้กราฟ: แท่งอยู่กลางช่องของตัวเอง ป้ายจึงตรงแท่งไม่ว่ากล่องกว้างเท่าไร
 */
import { formatCount } from "./format"

export interface Bar {
  x: number
  y: number
  w: number
  h: number
}

export interface DayViews {
  day: string
  count: number
}

/** ค่าที่ใช้วาดได้: ลบ, NaN, อินฟินิตี้ นับเป็น 0 (ไม่ให้แท่งเดียวทำให้ทั้งกราฟเพี้ยน) */
const usable = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)

/**
 * ตำแหน่งแท่งในกรอบกว้าง `width` สูง `height`: ช่องเท่ากันช่องละ `width / n` แต่ละแท่งอยู่กลางช่อง ห่างกัน `gap`
 * สูงตามสัดส่วนของค่าสูงสุด (ศูนย์ทั้งหมด → สูง 0 ไม่หารด้วยศูนย์) · แท่งตั้งบนเส้นฐาน `y + h = height`
 * `gap` ถูกจำกัดไว้ไม่เกินครึ่งช่อง เพื่อให้แท่งไม่บางจนหายเมื่อกล่องแคบ
 */
export function barGeometry(counts: number[], width: number, height: number, gap = 8): Bar[] {
  if (counts.length === 0) return []
  const values = counts.map(usable)
  const peak = Math.max(...values)
  const frameW = Number.isFinite(width) && width > 0 ? width : 0
  const frameH = Number.isFinite(height) && height > 0 ? height : 0
  const cell = frameW / values.length
  const space = Math.min(Math.max(Number.isFinite(gap) ? gap : 0, 0), cell / 2)
  return values.map((value, i) => {
    const h = peak === 0 ? 0 : (value / peak) * frameH
    return { x: i * cell + space / 2, y: frameH - h, w: cell - space, h }
  })
}

/** เลขวันที่ของเดือนจาก `YYYY-MM-DD` ("2026-10-05" → "5") · รูปแบบผิดหรือวันที่ไม่มีจริง → "" */
export function dayOfMonth(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (match === null) return ""
  const [year, month, date] = match.slice(1).map(Number)
  const check = new Date(Date.UTC(year, month - 1, date))
  const real = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date
  return real ? String(date) : ""
}

/** ยอดอ่านรวมทุกวัน (ข้ามค่าที่ใช้ไม่ได้) */
export function totalViews(views: DayViews[]): number {
  return views.reduce((sum, view) => sum + usable(view.count), 0)
}

/** ข้อความอธิบายกราฟสำหรับโปรแกรมอ่านหน้าจอ: ยอดรวม และวันที่สูงสุด (ถ้าสูงสุดซ้ำกัน เลือกวันล่าสุด) */
export function chartSummary(views: DayViews[]): string {
  const head = `ยอดอ่าน ${views.length} วันล่าสุด`
  const total = totalViews(views)
  if (total === 0) return `${head} ยังไม่มียอดอ่าน`
  let peak = views[0]
  for (const view of views) if (usable(view.count) >= usable(peak.count)) peak = view
  return `${head} รวม ${formatCount(total)} ครั้ง สูงสุด ${formatCount(peak.count)} ครั้ง วันที่ ${dayOfMonth(peak.day)}`
}

/** ขนาดในพิกัดของ SVG: ช่องละ 40 × 14 วัน และสูง 120 (ยืดตามกล่องจริงด้วย CSS) */
const CELL = 40
const HEIGHT = 120

export function BarChart({ views }: { views: DayViews[] }) {
  const width = CELL * Math.max(views.length, 1)
  const bars = barGeometry(
    views.map((view) => view.count),
    width,
    HEIGHT
  )
  const empty = totalViews(views) === 0
  return (
    <div className="ad-chart">
      <svg
        className="ad-chart-svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={chartSummary(views)}
      >
        <defs>
          <linearGradient id="ad-bar-fill" x1="0" y1="0" x2="0" y2="1">
            <stop className="ad-bar-top" offset="0" />
            <stop className="ad-bar-bottom" offset="1" />
          </linearGradient>
        </defs>
        <line className="ad-chart-base" x1="0" y1={HEIGHT} x2={width} y2={HEIGHT} />
        {bars.map((bar, i) => (
          <rect key={views[i].day} className="ad-bar" x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx="3">
            <title>{`${dayOfMonth(views[i].day)}: ${formatCount(views[i].count)} ครั้ง`}</title>
          </rect>
        ))}
      </svg>
      <ol className="ad-chart-days" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${Math.max(views.length, 1)}, minmax(0, 1fr))` }}>
        {views.map((view) => (
          <li key={view.day}>{dayOfMonth(view.day)}</li>
        ))}
      </ol>
      {empty && <p className="ad-chart-empty">{`ยังไม่มียอดอ่านใน ${views.length} วันนี้`}</p>}
    </div>
  )
}
