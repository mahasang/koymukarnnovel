/**
 * ลายประกอบของปกอัตโนมัติ — วาดด้วย SVG ล้วน (ไม่มีรูป ไม่มีฟอนต์) ขนาดอ้างอิง 200×300 แล้วขยายครอบกรอบ `.cv`
 * ทุกลายใช้ขาวโปร่งแสงซ้อนกันบนพื้นไล่สีของปก จึงอ่านออกบนทุกสีพื้น · พอร์ตมาจากต้นแบบ `design-reference/build.mjs`
 */
import type { ReactNode } from "react"
import type { Motif } from "../lib/cover"

const white = (alpha: string) => `rgba(255,255,255,${alpha})`
const round = (n: number) => Math.round(n * 100) / 100

/** รูปทรงของแต่ละลาย — `Record<Motif, …>` ทำให้ลายใหม่ใน `MOTIFS` ที่ยังไม่มีรูปวาดเป็น error ตอน typecheck */
const SHAPES: Record<Motif, (seed: number) => ReactNode> = {
  lantern: () => (
    <>
      <circle cx="100" cy="115" r="78" fill={white(".16")} />
      <circle cx="100" cy="115" r="44" fill={white(".3")} />
      <rect x="86" y="92" width="28" height="50" rx="8" fill="#fff6d6" />
      <path d="M90 92q10-20 20 0" fill="none" stroke="#fff6d6" strokeWidth="4" />
      <rect x="90" y="142" width="20" height="6" rx="3" fill="#fff6d6" />
    </>
  ),
  planet: () => (
    <>
      <circle cx="100" cy="115" r="50" fill={white(".24")} />
      <circle cx="84" cy="100" r="46" fill={white(".14")} />
      <ellipse cx="100" cy="115" rx="88" ry="20" fill="none" stroke={white(".6")} strokeWidth="3" transform="rotate(-18 100 115)" />
      <circle cx="40" cy="48" r="3" fill="#fff" />
      <circle cx="165" cy="70" r="2" fill="#fff" />
      <circle cx="150" cy="185" r="2.5" fill="#fff" />
    </>
  ),
  city: () => (
    <>
      <circle cx="150" cy="72" r="26" fill={white(".55")} />
      <g fill={white(".3")}>
        <rect x="18" y="150" width="28" height="100" />
        <rect x="50" y="118" width="32" height="132" />
        <rect x="86" y="160" width="26" height="90" />
        <rect x="116" y="96" width="36" height="154" />
        <rect x="156" y="140" width="28" height="110" />
      </g>
    </>
  ),
  waves: () => (
    <>
      {[0, 1, 2, 3].map((k) => (
        <path key={k} d={`M-10 ${95 + k * 26} q27-24 55 0 t55 0 t55 0 t55 0`} fill="none" stroke={white((0.55 - k * 0.1).toFixed(2))} strokeWidth={4 - k * 0.5} />
      ))}
      <circle cx="140" cy="52" r="20" fill={white(".6")} />
    </>
  ),
  mountain: () => (
    <>
      <circle cx="140" cy="78" r="28" fill={white(".7")} />
      <polygon points="0,205 62,112 112,178 152,128 200,205" fill={white(".3")} />
      <polygon points="0,235 52,162 102,218 162,152 200,228 200,300 0,300" fill="rgba(0,0,0,.28)" />
    </>
  ),
  flower: () => (
    <>
      {[0, 1, 2, 3, 4, 5].map((k) => {
        const angle = (k * Math.PI) / 3
        return <circle key={k} cx={round(100 + Math.cos(angle) * 34)} cy={round(112 + Math.sin(angle) * 34)} r="26" fill={white(".3")} />
      })}
      <circle cx="100" cy="112" r="20" fill={white(".85")} />
    </>
  ),
  // เกล็ดหิมะกระจายตำแหน่งตาม seed ของชื่อเรื่อง (ชื่อเดียวกันได้ตำแหน่งเดิมเสมอ) · x อยู่ใน [5,195) y อยู่ใน [20,220) รัศมี 1.5–3.5
  snow: (seed) => (
    <>
      {Array.from({ length: 26 }, (_, k) => (
        <circle key={k} cx={((k * 73 + seed * 11) % 190) + 5} cy={((k * 47 + seed * 7) % 200) + 20} r={1.5 + (k % 3)} fill={white(`.${5 + (k % 4)}`)} />
      ))}
      <circle cx="100" cy="105" r="34" fill="none" stroke={white(".6")} strokeWidth="3" />
    </>
  ),
  book: () => (
    <>
      <circle cx="100" cy="92" r="34" fill={white(".22")} />
      <path d="M100 150Q60 120 18 130V212Q60 200 100 232Z" fill={white(".5")} />
      <path d="M100 150Q140 120 182 130V212Q140 200 100 232Z" fill={white(".32")} />
    </>
  ),
}

/** ภาพประดับล้วน: ซ่อนจากโปรแกรมอ่านหน้าจอและไม่รับโฟกัส (ชื่อเรื่องจริงอยู่ในข้อความรอบๆ) */
export function CoverArt({ motif, seed }: { motif: Motif; seed: number }) {
  return (
    <svg data-motif={motif} viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {SHAPES[motif](seed)}
    </svg>
  )
}
