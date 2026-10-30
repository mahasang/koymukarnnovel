/**
 * ชั้นหนังสือตัวอย่างหลายเรื่อง ไว้ตรวจหน้าแรกด้วยตา/เบราว์เซอร์จริง (เปิดด้วย `E2E_LIBRARY=full` ที่ `e2e/server.ts` เท่านั้น
 * — ค่าเริ่มต้นมีแค่เรื่องจาก `seedDemo` เหมือนเดิม จึงไม่กระทบเทสต์ที่นับจำนวนเรื่อง)
 *
 * ทุกเรื่อง ชื่อ ผู้เขียน และเนื้อหาเป็นของสมมติที่เขียนขึ้นเองเพื่อทดสอบเลย์เอาต์ ไม่ใช่งานของใคร
 * ครอบคลุมสิ่งที่หน้าแรกต้องรับมือ: มีปก/ไม่มีปก/ไฟล์ปกเสีย · ชื่อยาวมาก · แท็กยาว · เรื่องที่ยังไม่มีตอนเลย · ต่อเนื่อง/จบแล้ว
 * · อัปเดตเมื่อไม่กี่ชั่วโมงก่อนจนถึงหลายเดือนก่อน (ป้าย "ใหม่" ตัดที่ 72 ชั่วโมง) · เรื่องร่างที่เห็นเฉพาะผู้ดูแล · เกิน 24 เรื่อง (ปุ่ม "แสดงเพิ่ม")
 * `db` ต้องมีตาราง novels/chapters/covers แล้ว (ผ่านการ migrate ตอน `startServer`)
 */
import zlib from "node:zlib"
import type { Db } from "../server/src/db.js"
import { nowSql } from "../server/src/util/time.js"

export type HeroChoice = "demo" | "cover" | "none"

interface Spec {
  title: string
  titleTh: string
  author: string
  tags: string[]
  status: "ongoing" | "completed"
  chapters: number
  /** ตอนล่าสุดเผยแพร่เมื่อกี่ชั่วโมงก่อน (ถ้าไม่มีตอนเลย = เวลาแก้ไขเรื่อง) */
  hoursAgo: number
  cover: "png" | "corrupt" | null
  hue: number
  synopsis?: string
  published?: boolean
}

const HOUR = 3600_000

const NAMED: Spec[] = [
  { title: "The Cartographer of Quiet Rooms", titleTh: "นักทำแผนที่แห่งห้องเงียบ", author: "เวรน อัลดัส", tags: ["ลึกลับ", "ดราม่า", "แฟนตาซี"], status: "ongoing", chapters: 9, hoursAgo: 2, cover: "png", hue: 215, synopsis: "ลีโอวาดแผนที่ของห้องที่ไม่มีใครเคยเข้า แล้วพบว่าแผนที่เริ่มวาดห้องใหม่เองทุกคืน นิยายตัวอย่างที่เขียนขึ้นเพื่อทดสอบระบบ" },
  { title: "Salt and Starlight Bakery", titleTh: "ร้านขนมปังเกลือกับแสงดาว", author: "มาร์ตา ฮอลโลเวย์", tags: ["ชีวิตประจำวัน", "อบอุ่น", "โรแมนติก"], status: "ongoing", chapters: 6, hoursAgo: 26, cover: "png", hue: 25, synopsis: "ร้านขนมปังเล็กๆ ที่เปิดเฉพาะตอนดาวตก" },
  { title: "Clockwork Orchard", titleTh: "", author: "ทอม เบรนต์", tags: ["แฟนตาซี", "สตีมพังค์"], status: "completed", chapters: 12, hoursAgo: 5 * 24, cover: "png", hue: 140 },
  { title: "The Ninth Lighthouse Keeper", titleTh: "ผู้เฝ้าประภาคารคนที่เก้า", author: "ซิลเวีย โอ", tags: ["สยองขวัญ", "ลึกลับ"], status: "ongoing", chapters: 4, hoursAgo: 49, cover: null, hue: 260 },
  { title: "Moonlit Courier", titleTh: "พนักงานส่งของใต้แสงจันทร์", author: "ฮิโระ ทานาเบะ", tags: ["แฟนตาซี", "ผจญภัย"], status: "ongoing", chapters: 15, hoursAgo: 71, cover: "png", hue: 280, synopsis: "จดหมายทุกฉบับต้องส่งถึงมือผู้รับก่อนฟ้าสาง และคืนนี้ผู้รับคือมังกร" },
  {
    title: "The Improbable Annals of the Seventh Deputy Archivist of the Drowned Library of Vael",
    titleTh: "บันทึกที่เป็นไปไม่ได้ของรองผู้จัดเก็บเอกสารลำดับที่เจ็ดแห่งหอสมุดจมน้ำเวล เล่มที่หนึ่งว่าด้วยตู้เอกสารที่ไม่มีใครเปิด",
    author: "เอลิซาเบธ ไวท์ฟอร์ด-แมคเกรเกอร์ ผู้ที่สาม",
    tags: ["แฟนตาซีเชิงปรัชญาที่มีชื่อยาวมากเป็นพิเศษ", "ลึกลับ", "ตลก", "ผจญภัย", "ดราม่า"],
    status: "ongoing",
    chapters: 3,
    hoursAgo: 7 * 24,
    cover: null,
    hue: 190,
    synopsis: "รองผู้จัดเก็บเอกสารลำดับที่เจ็ดพบว่าหอสมุดที่จมอยู่ใต้น้ำยังคงมีเวลาเปิดทำการ",
  },
  { title: "Paper Kites Over Harbor Nine", titleTh: "ว่าวกระดาษเหนือท่าเรือเก้า", author: "ลูซี่ เกรย์", tags: ["ชีวิตประจำวัน", "เด็ก"], status: "completed", chapters: 10, hoursAgo: 10 * 24, cover: "png", hue: 170 },
  { title: "Sunday Detective Club", titleTh: "ชมรมนักสืบวันอาทิตย์", author: "ปีเตอร์ นาคาโมโตะ", tags: ["สืบสวน", "ตลก"], status: "ongoing", chapters: 7, hoursAgo: 12 * 24, cover: "png", hue: 45 },
  { title: "Glass Season", titleTh: "ฤดูกระจก", author: "อานา เดอลา", tags: ["ดราม่า", "โรแมนติก"], status: "completed", chapters: 20, hoursAgo: 20 * 24, cover: null, hue: 330 },
  { title: "Thirty-One Doors", titleTh: "ประตูสามสิบเอ็ดบาน", author: "คาร์ล ฟอสส์", tags: ["ลึกลับ", "ปริศนา"], status: "ongoing", chapters: 8, hoursAgo: 25 * 24, cover: "corrupt", hue: 0 },
  { title: "Embers of the Tin Crown", titleTh: "ถ่านไฟแห่งมงกุฎดีบุก", author: "เรเชล โอคอนเนอร์", tags: ["แฟนตาซี", "สงคราม"], status: "ongoing", chapters: 5, hoursAgo: 30 * 24, cover: "png", hue: 10 },
  { title: "Rainy Day Ramen", titleTh: "ราเมนวันฝนตก", author: "ยูกิ ซาโตะ", tags: ["อาหาร", "อบอุ่น"], status: "completed", chapters: 14, hoursAgo: 45 * 24, cover: null, hue: 200 },
  { title: "Ghosts Pay Rent Too", titleTh: "ผีก็จ่ายค่าเช่า", author: "แดนนี่ ลู", tags: ["ตลก", "ผี"], status: "ongoing", chapters: 3, hoursAgo: 60 * 24, cover: "png", hue: 100 },
  { title: "Orbit Garden", titleTh: "สวนวงโคจร", author: "นีน่า ปาเทล", tags: ["ไซไฟ", "อวกาศ"], status: "ongoing", chapters: 2, hoursAgo: 90 * 24, cover: "png", hue: 240 },
  { title: "Untold Chapters", titleTh: "ตอนที่ยังไม่เล่า", author: "ผู้เขียนตัวอย่าง", tags: ["ตัวอย่าง"], status: "ongoing", chapters: 0, hoursAgo: 5, cover: null, hue: 60 },
  { title: "The Salt Road (draft)", titleTh: "เส้นทางเกลือ (ร่าง)", author: "ผู้เขียนตัวอย่าง", tags: ["ร่าง", "แฟนตาซี"], status: "ongoing", chapters: 2, hoursAgo: 3, cover: "png", hue: 300, published: false },
]

const FILLER_ADJ = ["Amber", "Hollow", "Velvet", "Thistle", "Cobalt", "Marrow", "Pewter", "Saffron", "Willow", "Quartz", "Juniper", "Tallow", "Indigo", "Cinder"]
const FILLER_NOUN = ["Letters", "Gate", "Harvest", "Choir", "Bridge", "Almanac", "Lantern", "Orchard", "Ferry", "Tower", "Garden", "Market", "Station", "Archive"]
const FILLER_TAGS = ["แฟนตาซี", "ลึกลับ", "ดราม่า", "ตลก", "โรแมนติก", "ผจญภัย", "ไซไฟ", "ชีวิตประจำวัน"]

function fillers(): Spec[] {
  return FILLER_ADJ.map((adj, i) => ({
    title: `${adj} ${FILLER_NOUN[i]}`,
    titleTh: i % 3 === 0 ? "" : `${FILLER_NOUN[i] === "Letters" ? "จดหมาย" : "เรื่องเล่า"}${adj.toLowerCase()} ${i + 1}`,
    author: `ผู้เขียนตัวอย่าง ${i + 1}`,
    tags: [FILLER_TAGS[i % FILLER_TAGS.length], FILLER_TAGS[(i + 3) % FILLER_TAGS.length]],
    status: i % 4 === 0 ? ("completed" as const) : ("ongoing" as const),
    chapters: 1 + (i % 5),
    hoursAgo: (100 + i * 9) * 24,
    cover: i % 3 === 1 ? ("png" as const) : null,
    hue: (i * 47) % 360,
  }))
}

/** HSL (องศา, 0–1, 0–1) → RGB 0–255 */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "ascii")
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}

/** ปก PNG 200×300 (สัดส่วน 2:3) ไล่สีตามแนวตั้ง มีดวงจันทร์และแถบแนวนอน — สร้างด้วย zlib ไม่ต้องพึ่งไลบรารีรูปภาพ */
export function coverPng(hue: number): Buffer {
  const w = 200
  const h = 300
  const top = hsl(hue, 0.55, 0.32)
  const bottom = hsl((hue + 40) % 360, 0.6, 0.12)
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      const t = y / (h - 1)
      let rgb = top.map((c, i) => Math.round(c + (bottom[i]! - c) * t))
      const dx = x - 138
      const dy = y - 92
      if (dx * dx + dy * dy < 34 * 34) rgb = hsl((hue + 20) % 360, 0.8, 0.85)
      else if (y > 188 && y % 22 < 5) rgb = rgb.map((c) => Math.min(255, c + 36))
      raw.set(rgb, row + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 8 บิตต่อช่อง
  ihdr[9] = 2 // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

/** ไฟล์ที่ขึ้นต้นเป็น PNG แต่ข้างในพัง — เซิร์ฟเวอร์ส่งให้ได้ (HTTP 200) แต่เบราว์เซอร์ถอดรหัสไม่ได้ ใช้ทดสอบ `Cover` ตอนรูปโหลดไม่ขึ้น */
export function corruptPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this is not really a png", "ascii")])
}

const isoOf = (now: string, msAgo: number): string => nowSql(new Date(new Date(`${now.replace(" ", "T")}Z`).getTime() - msAgo))

/**
 * ใส่นิยายสมมติ ~30 เรื่อง (รวมเรื่องร่างหนึ่งเรื่อง) · `hero`: demo = คงเรื่องแนะนำของ `seedDemo` (ไม่มีปก) ·
 * cover = ย้าย "แนะนำ" ไปเรื่องที่มีปก · none = ไม่มีเรื่องแนะนำเลย (ทดสอบ fallback: เรื่องล่าสุดที่มีปก)
 */
export function seedLibrary(db: Db, now: string, hero: HeroChoice = "demo"): { novels: number } {
  const specs = [...NAMED, ...fillers()]
  return db.tx(() => {
    for (const s of specs) {
      const last = isoOf(now, s.hoursAgo * HOUR)
      const created = isoOf(now, (s.hoursAgo + s.chapters * 6 + 24) * HOUR)
      const id = db.run(
        `INSERT INTO novels (title, title_th, author, mode, style_note, published, synopsis, synopsis_src, tags, status,
                             source_url, license_note, featured, created_at, updated_at)
         VALUES (?, ?, ?, 'translate', '', ?, ?, '', ?, ?, '', 'นิยายตัวอย่างที่เขียนขึ้นเองเพื่อทดสอบระบบ', ?, ?, ?)`,
        s.title,
        s.titleTh,
        s.author,
        s.published === false ? 0 : 1,
        s.synopsis ?? `เรื่องสมมติสำหรับทดสอบหน้าตาของชั้นหนังสือ (${s.title}) ข้อความนี้ไม่ใช่เนื้อหาของงานจริงใดๆ`,
        JSON.stringify(s.tags),
        s.status,
        hero === "cover" && s.title === "Moonlit Courier" ? 1 : 0,
        created,
        last,
      ).lastInsertRowid
      for (let n = 1; n <= s.chapters; n++) {
        const at = isoOf(now, (s.hoursAgo + (s.chapters - n) * 6) * HOUR)
        db.run(
          `INSERT INTO chapters (novel_id, number, title, title_th, source_text, translation, recap, status, error,
                                 published, published_at, auto_publish, queue_seq, translated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '', 'done', '', 1, ?, 0, NULL, ?, ?, ?)`,
          id,
          n,
          `Chapter ${n}`,
          `ตอนที่ ${n}`,
          `Sample chapter ${n} of ${s.title}. Written for testing only.`,
          `ตอนที่ ${n} ของ ${s.titleTh || s.title} — ข้อความตัวอย่างที่เขียนขึ้นเองเพื่อทดสอบระบบ`,
          at,
          at,
          at,
          at,
        )
      }
      if (s.cover !== null) {
        db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', ?, ?)", id, s.cover === "png" ? coverPng(s.hue) : corruptPng(), last)
      }
    }
    if (hero !== "demo") db.run("UPDATE novels SET featured = 0 WHERE featured = 1 AND title = ?", "Ledger of the Lantern Tide")
    return { novels: specs.length }
  })
}
