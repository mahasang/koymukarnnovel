import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describeStartupFailure, prepareDb } from "./bootstrap.js"
import { loadConfig } from "./config.js"
import type { Db } from "./db.js"
import { consoleLogger, type Logger } from "./util/log.js"
import { nowSql } from "./util/time.js"

/**
 * ข้อมูลตัวอย่างสำหรับ `npm run seed:demo` (spec 10.3): นิยายสมมติที่เขียนเองหนึ่งเรื่อง สามตอนมีคำแปลไทยครบและเผยแพร่แล้ว
 * ไว้ดูหน้าตาและทดสอบโดยไม่ต้องมี API key — ไม่ใช่ข้อความของงานจริงใดๆ ลบทิ้งได้จากหลังบ้านเหมือนเรื่องอื่น
 * เนื้อหาตั้งใจให้ครอบคลุมสิ่งที่ต้องทดสอบเลย์เอาต์: บรรทัด `***` คั่นฉาก, ชื่อตอนยาวเกิน 60 ตัวอักษร, ย่อหน้ายาวมากที่ไม่มีเครื่องหมายวรรคตอน
 */

export const DEMO_TITLE = "Ledger of the Lantern Tide"

const paragraphs = (...parts: string[]): string => parts.join("\n\n")

const DEMO_NOVEL = {
  title: DEMO_TITLE,
  titleTh: "สมุดบันทึกแห่งน้ำขึ้นโคมไฟ (ตัวอย่าง)",
  author: "ผู้เขียนตัวอย่าง",
  styleNote: "ใช้ภาษาไทยเรียบง่าย น้ำเสียงอบอุ่นแบบนิทาน ทับศัพท์ชื่อตัวละครและสถานที่ตามอภิธาน",
  synopsis:
    "ในเมืองท่าเล็กๆ ชื่อซอลต์เมียร์ มิรา แวนซ์ เด็กฝึกคนจุดโคมคนใหม่ พบว่าโคมดวงสุดท้ายบนถนนควิลลอนจะติดก็ต่อเมื่อมีคนอ่านตารางน้ำที่ทะเลเขียนไว้บนขั้นบันไดทุกคืน — นิยายตัวอย่างที่เขียนขึ้นเองเพื่อทดสอบระบบ",
  synopsisSrc:
    "In the small harbor town of Saltmere, a new lamplighter's apprentice discovers that the last lamp on Quillon Street lights only for someone who reads aloud the tide table the sea writes on the harbor stairs each night. (A demo story written for testing the system.)",
  tags: ["ตัวอย่าง", "แฟนตาซี", "เมืองท่า"],
  licenseNote: "นิยายตัวอย่างที่เขียนขึ้นเองเพื่อทดสอบระบบ ไม่ใช่งานของผู้อื่น",
}

interface DemoChapter {
  title: string
  titleTh: string
  source: string
  translation: string
  recap: string
}

const DEMO_CHAPTERS: DemoChapter[] = [
  {
    title: "The Last Lamp on Quillon Street",
    titleTh: "โคมดวงสุดท้ายบนถนนควิลลอน",
    source: paragraphs(
      "The lamps of Quillon Street were lit by hand, one at a time, and Mira Vance had been told that this was the whole secret of Saltmere.",
      "\"Light them in order,\" old Odo Pell said, pressing the long brass taper into her hands. \"Never skip one, not even the cracked ones. A street remembers when it has been skipped.\"",
      "So Mira counted as she went. Eleven lamps woke up warm and yellow behind their salt-streaked glass, and the cobbles under them turned the color of honey. The twelfth lamp, the last one, stood at the top of the harbor stairs, and it would not catch. She tried the taper twice. The wick only sighed, as if it were thinking about something else.",
      "\"It does that,\" Odo called from the baker's doorstep. \"It has done that since before you were born. Try again tomorrow.\"",
      "Mira looked down the stairs at the black water. Somewhere out there the tide was turning, and she could have sworn the dark lamp turned with it.",
    ),
    translation: paragraphs(
      "โคมไฟตามถนนควิลลอนต้องจุดด้วยมือ ทีละดวง และมิรา แวนซ์ถูกสอนมาว่านั่นคือความลับทั้งหมดของซอลต์เมียร์",
      "\"จุดให้เรียงตามลำดับนะ\" ลุงโอโด เพลล์พูด พลางวางไม้จุดทองเหลืองด้ามยาวลงในมือเธอ \"อย่าข้ามสักดวง ต่อให้ดวงนั้นจะร้าวก็ตาม ถนนมันจำได้ว่าเมื่อไหร่ที่ถูกข้าม\"",
      "มิราเดินนับไปทีละดวง โคมสิบเอ็ดดวงแรกสว่างขึ้นเป็นสีเหลืองอุ่นอยู่หลังกระจกที่มีคราบเกลือเกาะเป็นทาง พื้นหินใต้โคมกลายเป็นสีน้ำผึ้ง ส่วนดวงที่สิบสองซึ่งเป็นดวงสุดท้ายตั้งอยู่บนยอดบันไดลงท่าเรือ และมันไม่ยอมติดไฟ เธอลองจุดสองครั้ง ไส้เทียนเพียงแต่ถอนหายใจเบาๆ ราวกับกำลังคิดเรื่องอื่นอยู่",
      "\"มันเป็นแบบนี้แหละ\" ลุงโอโดตะโกนมาจากหน้าร้านขนมปัง \"เป็นมาตั้งแต่ก่อนหนูเกิดแล้ว พรุ่งนี้ค่อยลองใหม่\"",
      "มิรามองลงไปตามขั้นบันไดสู่ผืนน้ำสีดำ ที่ไหนสักแห่งข้างนอกนั่น น้ำกำลังเปลี่ยนทิศ และเธอสาบานได้เลยว่าโคมดวงที่มืดอยู่นั้นหันตามไปด้วย",
    ),
    recap: "มิรา แวนซ์ เด็กฝึกคนจุดโคมคนใหม่ของซอลต์เมียร์ จุดโคมบนถนนควิลลอนได้ครบทุกดวง ยกเว้นดวงสุดท้ายบนยอดบันไดท่าเรือที่ไม่ยอมติดไฟเลย",
  },
  {
    title: "What the Tide Wrote on the Stairs",
    titleTh: "สิ่งที่น้ำขึ้นเขียนไว้บนขั้นบันได",
    source: paragraphs(
      "The next evening the twelfth lamp was still dark, and Mira had stopped being polite about it.",
      "\"Light,\" she told it. The wick said nothing. She sat down on the top step with the taper across her knees and watched the tide come in, slow and silver, one stair at a time.",
      "When the water reached the fourth step it stopped, and something odd happened. The wet stone was no longer simply wet. Thin lines were drawn across it, rows of small figures in a careful, rounded hand: 6:40, 7:15, 7:52. She leaned closer. The numbers were fading even as she read them.",
      "***",
      "\"A tide table,\" Odo said, when she dragged him down the stairs to see. He did not sound surprised. \"The sea keeps one for that lamp. It writes it fresh every night, and the lamp lights for whoever reads it aloud, in order, before the water takes it back.\"",
      "\"Why didn't you tell me?\"",
      "\"You didn't ask the right question.\" He scratched his beard. \"Besides, I can't read it. The numbers never stay put for me.\"",
      "Mira looked at the rows of fading figures, then at the dark lamp, and took a very deep breath.",
    ),
    translation: paragraphs(
      "คืนถัดมาโคมดวงที่สิบสองก็ยังมืดอยู่ และมิราเลิกพูดจาสุภาพกับมันแล้ว",
      "\"ติดสิ\" เธอสั่ง ไส้เทียนไม่ตอบอะไร เธอจึงนั่งลงบนขั้นบนสุด วางไม้จุดพาดเข่า แล้วมองน้ำขึ้นมาอย่างช้าๆ เป็นประกายสีเงิน ทีละขั้นบันได",
      "เมื่อน้ำขึ้นมาถึงขั้นที่สี่ก็หยุดนิ่ง แล้วเรื่องแปลกก็เกิดขึ้น หินเปียกนั้นไม่ได้เป็นแค่หินเปียกอีกต่อไป มีเส้นบางๆ ขีดพาดอยู่เป็นแถวตัวเลขเล็กๆ ลายมือกลมเรียบร้อยเหมือนเด็กตั้งใจเขียน 6:40, 7:15, 7:52 เธอโน้มตัวเข้าไปใกล้ ตัวเลขเหล่านั้นกำลังจางลงในขณะที่เธออ่าน",
      "***",
      "\"ตารางน้ำขึ้นน้ำลง\" ลุงโอโดพูดเมื่อเธอลากเขาลงบันไดมาดู น้ำเสียงของเขาไม่ได้แปลกใจเลย \"ทะเลเก็บตารางไว้ให้โคมดวงนี้ มันเขียนใหม่ทุกคืน แล้วโคมจะติดให้คนที่อ่านออกเสียงตามลำดับ ก่อนที่น้ำจะเอามันกลับไป\"",
      "\"ทำไมลุงไม่บอกหนู\"",
      "\"เพราะหนูไม่ได้ถามคำถามที่ถูก\" เขาเกาเคราตัวเอง \"อีกอย่าง ลุงเองก็อ่านมันไม่ได้ ตัวเลขพวกนั้นไม่เคยอยู่นิ่งสำหรับลุง\"",
      "มิรามองแถวตัวเลขที่กำลังจางหาย แล้วมองไปที่โคมที่ยังมืดอยู่ ก่อนจะสูดหายใจเข้าลึกๆ",
    ),
    recap: "มิราพบว่าทะเลเขียนตารางน้ำไว้บนขั้นบันไดทุกคืน และโคมดวงสุดท้ายจะติดเมื่อมีคนอ่านตารางนั้นออกเสียงตามลำดับ แต่ลุงโอโดอ่านมันไม่ได้",
  },
  {
    title: "In Which the Harbormaster Misreads a Tide Table and Pays for Everyone's Breakfast",
    titleTh: "เมื่อนายท่าอ่านตารางน้ำผิดไปหนึ่งบรรทัด จนต้องควักเงินเลี้ยงอาหารเช้าคนทั้งถนนควิลลอน",
    source: paragraphs(
      "Mira read the sea's numbers aloud for six nights. On the seventh the twelfth lamp caught, bright as a new coin, and the whole of Quillon Street stopped to stare.",
      "Harbormaster Brannock stopped too, though only to frown at his own paper chart. \"Your lamp says high water at midnight,\" he announced. \"My table says dawn.\"",
      "\"The sea's table is never wrong,\" said Mira.",
      "\"The Harbor Office table has been printed since my grandfather's day,\" said Brannock, which in his opinion settled the matter.",
      "At a quarter past midnight the tide climbed the stairs, crossed the cobbles and arrived, quite politely, at the baker's front door. By then the whole street was awake and carrying sacks of flour upstairs. Wynn the baker lit every oven out of pure spite, and by dawn there was warm bread for everyone, and honey, and a great deal of good-natured shouting about who owed whom a favor. Brannock paid for every loaf himself, grumbling into his collar, and nobody mentioned the chart again.",
    ),
    translation: paragraphs(
      "มิราอ่านตัวเลขของทะเลออกเสียงติดต่อกันหกคืน พอถึงคืนที่เจ็ด โคมดวงที่สิบสองก็ติดสว่างวาบเหมือนเหรียญใหม่ และคนทั้งถนนควิลลอนต่างหยุดเดินมามอง",
      "นายท่าบรันน็อกก็หยุดเหมือนกัน แต่เพื่อขมวดคิ้วใส่แผนภูมิกระดาษของตัวเอง \"โคมของเธอบอกว่าน้ำขึ้นสูงสุดตอนเที่ยงคืน\" เขาประกาศ \"แต่ตารางของข้าบอกว่าเป็นรุ่งเช้า\"",
      "\"ตารางของทะเลไม่เคยผิดค่ะ\" มิราตอบ",
      "\"ตารางของสำนักงานท่าเรือพิมพ์มาตั้งแต่สมัยปู่ของข้า\" บรันน็อกว่า ซึ่งในความเห็นของเขาแล้วถือว่าจบเรื่อง",
      "ตอนเที่ยงคืนสิบห้านาที น้ำขึ้นไต่บันได ข้ามพื้นหินปูถนน แล้วมาถึงหน้าร้านขนมปังอย่างสุภาพเหลือเกิน ตอนนั้นคนทั้งถนนตื่นกันหมดแล้ว และกำลังช่วยกันแบกถุงแป้งขึ้นไปไว้ชั้นบน วินน์ช่างทำขนมปังจุดเตาอบทุกเตาด้วยความประชดประชัน พอรุ่งสางก็มีขนมปังอุ่นๆ แจกให้ทุกคน มีน้ำผึ้งด้วย และมีเสียงโวยวายอย่างอารมณ์ดีว่าใครติดบุญคุณใครอยู่บ้าง บรันน็อกควักเงินจ่ายค่าขนมปังทุกก้อนด้วยตัวเองพลางบ่นพึมพำอยู่ในคอเสื้อ และไม่มีใครพูดถึงแผนภูมินั้นอีกเลย",
    ),
    recap: "มิราอ่านตารางของทะเลจนโคมติด นายท่าบรันน็อกเชื่อแผนภูมิของตัวเองมากกว่า น้ำจึงขึ้นมาถึงหน้าร้านขนมปังก่อนเวลา ทั้งถนนช่วยกันยกของ และเช้านั้นจบลงด้วยขนมปังอุ่นๆ ที่นายท่าเป็นคนจ่าย",
  },
]

const DEMO_GLOSSARY: { source: string; thai: string; note: string }[] = [
  { source: "Mira Vance", thai: "มิรา แวนซ์", note: "ตัวเอก เด็กฝึกคนจุดโคม" },
  { source: "Odo Pell", thai: "โอโด เพลล์", note: "คนจุดโคมสูงวัย เรียกว่า ลุงโอโด" },
  { source: "Saltmere", thai: "ซอลต์เมียร์", note: "เมืองท่า" },
  { source: "Quillon Street", thai: "ถนนควิลลอน", note: "ถนนที่มีโคมสิบสองดวง" },
  { source: "Harbormaster", thai: "นายท่า", note: "ผู้ดูแลท่าเรือของเมือง" },
  { source: "Brannock", thai: "บรันน็อก", note: "ชื่อนายท่า" },
  { source: "Wynn", thai: "วินน์", note: "ช่างทำขนมปัง" },
]

/**
 * ใส่นิยายตัวอย่างลงฐานข้อมูล: ยังไม่มีเรื่องชื่อ `DEMO_TITLE` จึงสร้าง (เรื่อง ตอน และอภิธาน ในธุรกรรมเดียว) แล้วคืน `{created: true}`
 * มีอยู่แล้วก็ไม่ทำอะไรและคืน `{created: false}` · `now` คือเวลา UTC `YYYY-MM-DD HH:MM:SS` ที่ใช้เป็นเวลาสร้าง/แปล/เผยแพร่ของทุกแถว
 */
export function seedDemo(db: Db, now: string): { created: boolean } {
  return db.tx(() => {
    if (db.get("SELECT 1 AS found FROM novels WHERE title = ?", DEMO_TITLE) !== undefined) return { created: false }

    const novelId = db.run(
      `INSERT INTO novels (title, title_th, author, mode, style_note, published, synopsis, synopsis_src, tags, status,
                           source_url, license_note, featured, created_at, updated_at)
       VALUES (?, ?, ?, 'translate', ?, 1, ?, ?, ?, 'ongoing', '', ?, 1, ?, ?)`,
      DEMO_NOVEL.title,
      DEMO_NOVEL.titleTh,
      DEMO_NOVEL.author,
      DEMO_NOVEL.styleNote,
      DEMO_NOVEL.synopsis,
      DEMO_NOVEL.synopsisSrc,
      JSON.stringify(DEMO_NOVEL.tags),
      DEMO_NOVEL.licenseNote,
      now,
      now,
    ).lastInsertRowid

    DEMO_CHAPTERS.forEach((c, i) => {
      db.run(
        `INSERT INTO chapters (novel_id, number, title, title_th, source_text, translation, recap, status, error,
                               published, published_at, auto_publish, queue_seq, translated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'done', '', 1, ?, 0, NULL, ?, ?, ?)`,
        novelId,
        i + 1,
        c.title,
        c.titleTh,
        c.source,
        c.translation,
        c.recap,
        now,
        now,
        now,
        now,
      )
    })

    for (const g of DEMO_GLOSSARY) {
      db.run("INSERT INTO glossary (novel_id, source, thai, note, auto) VALUES (?, ?, ?, ?, 0)", novelId, g.source, g.thai, g.note)
    }
    return { created: true }
  })
}

/**
 * `npm run seed:demo`: เปิดฐานข้อมูลตาม `DB_PATH` เดียวกับระบบ (ย้ายไฟล์ชื่อเก่ามาก่อนเหมือนตอนเริ่มระบบ จะได้ไม่สร้างไฟล์ใหม่เปล่าๆ ทับทางข้อมูลเดิม)
 * แล้วใส่ตัวอย่าง คืนรหัสออก (0 = สำเร็จ รวมถึงกรณีมีอยู่แล้ว, 1 = ล้มเหลว)
 */
export function runSeed(env: NodeJS.ProcessEnv, log: Logger): number {
  try {
    const { config } = loadConfig(env)
    const { db } = prepareDb(config.dbPath, log)
    try {
      const { created } = seedDemo(db, nowSql())
      log.info(
        created
          ? `สร้างนิยายตัวอย่าง "${DEMO_TITLE}" (${DEMO_CHAPTERS.length} ตอน) ลงฐานข้อมูล ${config.dbPath} แล้ว — ลบได้จากหลังบ้านเหมือนเรื่องอื่น`
          : `มีนิยายตัวอย่าง "${DEMO_TITLE}" อยู่แล้ว ไม่สร้างซ้ำ`,
      )
      return 0
    } finally {
      db.close()
    }
  } catch (e) {
    log.error(describeStartupFailure(e))
    return 1
  }
}

/** ไฟล์นี้ถูกสั่งรันตรงๆ (ไม่ใช่ถูก import)? เทียบที่ตั้งจริงของทั้งสองฝั่ง เพราะบน Windows ตัวพิมพ์ใหญ่เล็กของชื่อไดรฟ์/โฟลเดอร์อาจต่างกัน */
function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  const canonical = (p: string): string => {
    try {
      return fs.realpathSync.native(p)
    } catch {
      return path.resolve(p)
    }
  }
  return canonical(fileURLToPath(metaUrl)) === canonical(entry)
}

if (isMainModule(import.meta.url)) {
  // โหลด server/.env เฉพาะตอนรันเป็นสคริปต์ (ให้ได้ DB_PATH เดียวกับระบบ) · ถูก import เฉยๆ ไม่แตะ .env เลย
  await import("./env.js")
  process.exitCode = runSeed(process.env, consoleLogger())
}
