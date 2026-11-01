import { test } from "node:test"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Db } from "../src/db.js"
import { pointsAtIndexHtml, renderShell, type ShellMeta } from "../src/http/shell.js"
import type { AccentId } from "../src/settings.js"
import { startTestApp, type Client, type TestApp } from "./helpers/app.js"
import { createClock, type Clock } from "./helpers/clock.js"
import { rawRequest, rawSocketRequest } from "./helpers/http.js"
import { seedChapter, seedNovel, type SeedChapter } from "./helpers/seed.js"

const THAI = /[฀-๿]/

// ═════════════════════════ เครื่องมืออ่าน HTML ═════════════════════════

const unescapeHtml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")

const headOf = (html: string): string => /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ""
const titleOf = (html: string): string | null => {
  const m = /<title>([^<]*)<\/title>/.exec(html)
  return m ? unescapeHtml(m[1]!) : null
}
const metaOf = (html: string, key: "name" | "property", name: string): string | null => {
  const m = new RegExp(`<meta ${key}="${name}" content="([^"]*)">`).exec(html)
  return m ? unescapeHtml(m[1]!) : null
}
const canonicalOf = (html: string): string | null => {
  const m = /<link rel="canonical" href="([^"]*)">/.exec(html)
  return m ? unescapeHtml(m[1]!) : null
}
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length
const htmlTag = (html: string): string => /<html\b[^>]*>/.exec(html)?.[0] ?? ""
const hasNoindex = (html: string): boolean => html.includes('<meta name="robots" content="noindex">')

// ═════════════════════════ renderShell (ฟังก์ชันล้วน) ═════════════════════════

const TEMPLATE = `<!doctype html>
<html lang="th"><head><meta charset="UTF-8" /><link rel="icon" href="/icon.svg" /><title>koymukarnnovel</title><script type="module" crossorigin src="/assets/a.js"></script></head><body><div id="root"></div></body></html>
`

const META: ShellMeta = {
  title: "ชื่อหน้า | เว็บทดสอบ",
  description: "คำอธิบายหน้า",
  canonical: "https://k.example/novel/1",
  noindex: false,
  accent: "default",
  siteName: "เว็บทดสอบ",
}

test("renderShell: ใส่ meta ครบชุด แทน <title> ของแม่แบบ และส่วนอื่นของ head/body คงเดิมทุกตัวอักษร", () => {
  const out = renderShell(TEMPLATE, { ...META, image: "https://k.example/covers/1?v=5", type: "book" })

  assert.equal(titleOf(out), "ชื่อหน้า | เว็บทดสอบ")
  assert.equal(count(out, /<title>/g), 1, "ไม่มี title ซ้ำ")
  assert.equal(metaOf(out, "name", "description"), "คำอธิบายหน้า")
  assert.equal(canonicalOf(out), "https://k.example/novel/1")
  assert.equal(metaOf(out, "property", "og:title"), "ชื่อหน้า | เว็บทดสอบ")
  assert.equal(metaOf(out, "property", "og:description"), "คำอธิบายหน้า")
  assert.equal(metaOf(out, "property", "og:type"), "book")
  assert.equal(metaOf(out, "property", "og:url"), "https://k.example/novel/1")
  assert.equal(metaOf(out, "property", "og:image"), "https://k.example/covers/1?v=5")
  assert.equal(metaOf(out, "property", "og:site_name"), "เว็บทดสอบ")
  assert.equal(metaOf(out, "name", "twitter:card"), "summary_large_image")
  assert.ok(!hasNoindex(out))

  // ส่วนที่ไม่เกี่ยวต้องอยู่ครบ: charset, icon, สคริปต์ของแอป และ body
  const head = headOf(out)
  for (const keep of ['<meta charset="UTF-8" />', '<link rel="icon" href="/icon.svg" />', '<script type="module" crossorigin src="/assets/a.js"></script>']) {
    assert.ok(head.includes(keep), keep)
  }
  assert.ok(out.endsWith('</head><body><div id="root"></div></body></html>\n'))
  assert.ok(out.startsWith("<!doctype html>\n<html lang=\"th\"><head>"))
  // meta ทั้งหมดอยู่ใน <head>
  assert.equal(count(out, /<meta (?:name|property)="(?:description|og:|twitter:)/g), count(head, /<meta (?:name|property)="(?:description|og:|twitter:)/g))
  // ใน <head> มีแต่แท็ก (ข้อความเปล่าๆ ที่หลุดเข้าไปใน head ทำให้เบราว์เซอร์ปิด head แล้วเริ่ม body ก่อนเวลา)
  const textLeft = head.replace(/<title>[^<]*<\/title>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "")
  assert.equal(textLeft, "")
})

test("renderShell: ผลลัพธ์ทั้งก้อนตรงกับที่คาดทุกตัวอักษร (ลำดับแท็กคงที่ ไม่มีอักขระเกินหรือขาด)", () => {
  const front = '<!doctype html>\n<html lang="th"><head><meta charset="UTF-8" /><link rel="icon" href="/icon.svg" /><script type="module" crossorigin src="/assets/a.js"></script>'
  const back = '</head><body><div id="root"></div></body></html>\n'

  const full = renderShell(TEMPLATE, { ...META, image: "https://k.example/covers/1?v=5", type: "book" })
  assert.equal(
    full,
    front +
      "<title>ชื่อหน้า | เว็บทดสอบ</title>" +
      '<meta name="description" content="คำอธิบายหน้า">' +
      '<link rel="canonical" href="https://k.example/novel/1">' +
      '<meta property="og:title" content="ชื่อหน้า | เว็บทดสอบ">' +
      '<meta property="og:description" content="คำอธิบายหน้า">' +
      '<meta property="og:type" content="book">' +
      '<meta property="og:url" content="https://k.example/novel/1">' +
      '<meta property="og:image" content="https://k.example/covers/1?v=5">' +
      '<meta property="og:site_name" content="เว็บทดสอบ">' +
      '<meta name="twitter:card" content="summary_large_image">' +
      back,
  )

  const bare = renderShell(TEMPLATE, { ...META, canonical: "", noindex: true, accent: "teal" })
  assert.equal(
    bare,
    front.replace('<html lang="th">', '<html lang="th" data-accent="teal">') +
      "<title>ชื่อหน้า | เว็บทดสอบ</title>" +
      '<meta name="description" content="คำอธิบายหน้า">' +
      '<meta name="robots" content="noindex">' +
      '<meta property="og:title" content="ชื่อหน้า | เว็บทดสอบ">' +
      '<meta property="og:description" content="คำอธิบายหน้า">' +
      '<meta property="og:type" content="website">' +
      '<meta property="og:site_name" content="เว็บทดสอบ">' +
      '<meta name="twitter:card" content="summary">' +
      back,
  )
})

test("renderShell: ไม่มีรูป → ไม่มี og:image และ twitter:card เป็น summary · type เริ่มต้น website · canonical ว่าง → ไม่มี canonical/og:url", () => {
  const out = renderShell(TEMPLATE, { ...META, canonical: "", image: "" })
  assert.equal(metaOf(out, "property", "og:image"), null, "รูปเป็นข้อความว่าง = ไม่มีรูป")
  assert.equal(metaOf(out, "name", "twitter:card"), "summary")
  assert.equal(metaOf(out, "property", "og:type"), "website")
  assert.equal(canonicalOf(out), null)
  assert.equal(metaOf(out, "property", "og:url"), null)
  assert.ok(!out.includes('rel="canonical"'))
  assert.equal(metaOf(out, "property", "og:title"), META.title, "meta อื่นยังอยู่ครบ")

  const article = renderShell(TEMPLATE, { ...META, type: "article" })
  assert.equal(metaOf(article, "property", "og:type"), "article")
})

test("renderShell: noindex=true ใส่ <meta name=\"robots\" content=\"noindex\"> เพียงตัวเดียว · false ไม่ใส่", () => {
  const on = renderShell(TEMPLATE, { ...META, noindex: true })
  assert.equal(count(on, /<meta name="robots"/g), 1)
  assert.ok(hasNoindex(on))
  assert.ok(headOf(on).includes('<meta name="robots" content="noindex">'))
  assert.ok(!renderShell(TEMPLATE, { ...META, noindex: false }).includes('name="robots"'))
})

const NASTY = `<script>"x"</script> & 'q'`

test("renderShell: escape ทุกค่าที่ฝัง (title, description, canonical, image, siteName) — ข้อความกลับมาตรงเดิมเมื่อถอด entity และไม่มี <script> ดิบใน head", () => {
  const out = renderShell(TEMPLATE, {
    ...META,
    title: NASTY,
    description: `${NASTY} "></head><body onload=alert(1)>`,
    canonical: `https://k.example/"><script>x</script>`,
    image: `https://k.example/"><img src=x onerror=alert(1)>`,
    siteName: NASTY,
  })
  assert.equal(titleOf(out), NASTY)
  assert.equal(metaOf(out, "property", "og:title"), NASTY)
  assert.equal(metaOf(out, "name", "description"), `${NASTY} "></head><body onload=alert(1)>`)
  assert.equal(metaOf(out, "property", "og:description"), `${NASTY} "></head><body onload=alert(1)>`)
  assert.equal(metaOf(out, "property", "og:site_name"), NASTY)
  assert.equal(canonicalOf(out), `https://k.example/"><script>x</script>`)
  assert.equal(metaOf(out, "property", "og:url"), `https://k.example/"><script>x</script>`)
  assert.equal(metaOf(out, "property", "og:image"), `https://k.example/"><img src=x onerror=alert(1)>`)

  const head = headOf(out)
  assert.ok(head.includes("&lt;script&gt;&quot;x&quot;&lt;/script&gt; &amp; &#39;q&#39;"))
  assert.ok(!head.includes("<script>"), "ไม่มี <script> ดิบ")
  assert.ok(!head.includes("<img"), "ไม่มี <img> ดิบ")
  assert.ok(!head.includes("onerror=alert(1)>"), "แท็กที่ฉีดเข้าไปไม่หลุดออกมาเป็นแท็กจริง")
  assert.equal(count(out, /<\/head>/g), 1, "ไม่มี </head> เพิ่ม")
  assert.equal(count(out, /<body/g), 1, "ไม่มี <body> เพิ่ม")
})

test("renderShell: ค่าที่ควรมาจากชุดค่าคงที่ (type, accent) ก็ถูก escape กันไว้ ถ้าหลุดชนิดเข้ามา", () => {
  const out = renderShell(TEMPLATE, { ...META, type: '"><script>x</script>' as never, accent: 'x"onload="alert(1)' as never })
  assert.ok(!out.includes("<script>x"), "ไม่มี <script> ดิบ")
  assert.ok(!out.includes('onload="alert(1)'), "แอตทริบิวต์ที่ฉีดเข้าไปไม่ออกมาเป็นแอตทริบิวต์จริง")
  assert.equal(metaOf(out, "property", "og:type"), '"><script>x</script>')
  assert.equal(htmlTag(out), '<html lang="th" data-accent="x&quot;onload=&quot;alert(1)">')
})

test("renderShell: แบบแผนพิเศษของ String.replace ($&, $', $`, $1, $$) ในค่าที่ฝังถูกใส่ตามตัวอักษร", () => {
  const tricky = "A $& B $' C $` D $1 E $$ F $<x> G"
  const out = renderShell(TEMPLATE, { ...META, title: tricky, description: tricky, siteName: tricky, canonical: `https://k.example/${tricky}` })
  assert.equal(titleOf(out), tricky)
  assert.equal(metaOf(out, "name", "description"), tricky)
  assert.equal(metaOf(out, "property", "og:site_name"), tricky)
  assert.equal(canonicalOf(out), `https://k.example/${tricky}`)
  assert.equal(count(out, /<\/head>/g), 1, "ไม่มีส่วนของแม่แบบถูกคัดลอกซ้ำ")
  assert.ok(out.endsWith('</head><body><div id="root"></div></body></html>\n'))
})

test("renderShell: accent — default ไม่เติมอะไร · อื่นๆ เติม data-accent ต่อท้ายแอตทริบิวต์เดิมของ <html> (ไม่ซ้ำถ้าแม่แบบมีอยู่แล้ว)", () => {
  assert.equal(htmlTag(renderShell(TEMPLATE, { ...META, accent: "default" })), '<html lang="th">')
  assert.equal(htmlTag(renderShell(TEMPLATE, { ...META, accent: "teal" })), '<html lang="th" data-accent="teal">')
  for (const accent of ["violet", "pink", "amber", "blue"] as const) {
    assert.equal(htmlTag(renderShell(TEMPLATE, { ...META, accent })), `<html lang="th" data-accent="${accent}">`)
  }
  const withClass = TEMPLATE.replace('<html lang="th">', '<html lang="th" class="dark">')
  assert.equal(htmlTag(renderShell(withClass, { ...META, accent: "pink" })), '<html lang="th" class="dark" data-accent="pink">')
  // data-accent ที่ค้างในแม่แบบ เขียนได้หลายแบบ: เครื่องหมายคำพูดคู่/เดี่ยว ไม่มีเครื่องหมาย เว้นวรรครอบ = หรือชื่อตัวพิมพ์ใหญ่
  for (const stale of ['data-accent="blue"', "data-accent='blue'", "data-accent=blue", 'data-accent = "blue"', 'DATA-ACCENT="blue"', "data-accent='blue sky'", 'data-accent="blue sky"']) {
    const already = TEMPLATE.replace('<html lang="th">', `<html lang="th" ${stale}>`)
    assert.equal(htmlTag(renderShell(already, { ...META, accent: "amber" })), '<html lang="th" data-accent="amber">', stale)
    assert.equal(htmlTag(renderShell(already, { ...META, accent: "default" })), '<html lang="th">', `default ล้าง data-accent ที่ค้างในแม่แบบ: ${stale}`)
  }
})

test("renderShell: meta เดิมในแม่แบบ (description, robots, canonical, og:*, twitter:*) ถูกแทนที่ ไม่ซ้ำและไม่ขัดกัน · meta อื่นอยู่ครบ", () => {
  const old = `<!doctype html><html lang="th"><head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta content="old description" name="description" />
<meta name="robots" content="index,follow">
<link href="https://old.example/" rel="canonical">
<meta property="og:title" content="old">
<meta property="og:image" content="https://old.example/i.png">
<meta name="twitter:card" content="old">
<meta name="theme-color" content="#0b0b14">
<title>old title</title></head><body></body></html>`
  const out = renderShell(old, { ...META, noindex: false })
  for (const re of [/name="description"/g, /name="robots"/g, /rel="canonical"/g, /property="og:title"/g, /property="og:image"/g, /name="twitter:card"/g]) {
    assert.ok(count(out, re) <= 1, String(re))
  }
  assert.equal(count(out, /<meta[^>]*name="description"/g), 1)
  assert.ok(!out.includes("old description") && !out.includes("old.example") && !out.includes("old title") && !out.includes('content="old"'))
  assert.ok(out.includes('<meta name="viewport" content="width=device-width, initial-scale=1" />'))
  assert.ok(out.includes('<meta name="theme-color" content="#0b0b14">'))
  assert.equal(metaOf(out, "name", "description"), "คำอธิบายหน้า")
  assert.equal(titleOf(out), "ชื่อหน้า | เว็บทดสอบ")
  assert.equal(metaOf(out, "property", "og:image"), null, "ไม่ส่งรูป → ไม่มี og:image เก่าค้าง")

  const noindexed = renderShell(old, { ...META, noindex: true })
  assert.equal(count(noindexed, /name="robots"/g), 1)
  assert.ok(hasNoindex(noindexed))
})

test("renderShell: แม่แบบที่เขียนคนละสไตล์ (แท็กตัวพิมพ์ใหญ่ · ' หรือไม่มีเครื่องหมายคำพูด · title หลายบรรทัด · </HEAD >) แทนที่ได้ครบ ไม่แตะแท็กอื่น", () => {
  const odd = `<!DOCTYPE html>
<HTML LANG="th" DATA-ACCENT="blue"><HEAD>
<META NAME="Description" CONTENT="old">
<meta name = 'robots' content = 'index'>
<meta name=Twitter:Card content=old>
<meta PROPERTY='OG:Image' content='https://old.example/i.png'>
<meta
  property="og:title"
  content="old"
>
<meta/name="twitter:site"/content="old">
<LINK REL="alternate\tCanonical" HREF="https://old.example/">
<link
  rel="canonical"
  href="https://old2.example/"
>
<link rel="stylesheet" href="/assets/a.css">
<TITLE data-rh="true">
  old
  title
</TITLE >
</HEAD >
<body></body></HTML>`
  const out = renderShell(odd, { ...META, noindex: false, accent: "pink" })
  assert.ok(!out.includes("old"), "ไม่มีค่าเก่าค้าง")
  assert.equal(count(out, /name="description"/gi), 1)
  assert.equal(count(out, /robots/gi), 0)
  assert.equal(count(out, /twitter:card/gi), 1)
  assert.equal(count(out, /twitter:site/gi), 0)
  assert.equal(count(out, /og:image/gi), 0)
  assert.equal(count(out, /og:title/gi), 1)
  assert.equal(count(out, /canonical/gi), 1)
  assert.equal(count(out, /<title/gi), 1)
  assert.equal(titleOf(out), META.title)
  assert.equal(htmlTag(out), '<html LANG="th" data-accent="pink">')
  assert.ok(out.includes('<link rel="stylesheet" href="/assets/a.css">'))
  assert.ok(out.includes("<HEAD>") && out.endsWith("</HEAD >\n<body></body></HTML>"), "ส่วนที่ไม่เกี่ยวคงเดิม")
  assert.ok(out.indexOf(`<title>`) < out.indexOf("</HEAD >"), "meta อยู่ก่อนปิด head")
})

test("renderShell: แม่แบบที่ไม่มี <title> ก็ได้ title ใหม่ใน head · ไม่มี </head> → throw (แม่แบบใช้ไม่ได้)", () => {
  const noTitle = TEMPLATE.replace("<title>koymukarnnovel</title>", "")
  const out = renderShell(noTitle, META)
  assert.equal(titleOf(out), "ชื่อหน้า | เว็บทดสอบ")
  assert.ok(headOf(out).includes("<title>"))
  assert.throws(() => renderShell("<html><body></body></html>", META), /head/)
})

// ═════════════════════════ ฉากทดสอบ: web/dist ปลอม + ข้อมูล ═════════════════════════

const SITE = { siteName: "นิยายทดสอบ", tagline: "สโลแกนทดสอบ" } as const
const PUBLIC_URL = "https://k.example"
const EVIL = '<script>"x"</script>'
const EVIL_SYNOPSIS = `${EVIL} $& $' $\` $1 $$ จบ`
const ARIA_SYNOPSIS = "เรื่องราวของอาเรีย\nนักเดินทางผู้ไม่ยอมแพ้\r\n\r\n".repeat(12).trim()

interface Dist {
  dir: string
  /** โฟลเดอร์ข้างบนของ dist (ไว้วางไฟล์ลับนอก dist เพื่อทดสอบการหลุดออกนอกโฟลเดอร์) */
  root: string
  write(name: string, content: string, mtimeSkewSec?: number): void
  remove(name: string): void
}

function makeDist(files: Record<string, string> = {}): Dist {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kn-shell-"))
  const dir = path.join(root, "dist")
  const dist: Dist = {
    dir,
    root,
    write(name, content, mtimeSkewSec = 0) {
      const file = path.join(dir, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
      // เวลาแก้ไฟล์ถูกกำหนดเอง (ไม่พึ่งความละเอียดของนาฬิการะบบไฟล์) ให้ตัวตรวจว่าแม่แบบเปลี่ยนเห็นความต่างแน่นอน
      const when = new Date(Date.now() + mtimeSkewSec * 1000)
      fs.utimesSync(file, when, when)
    },
    remove(name) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    },
  }
  fs.mkdirSync(dir, { recursive: true })
  const all = {
    "index.html": TEMPLATE,
    "assets/a.js": 'console.log("a")\n',
    "sw.js": 'const CACHE = "kn-__BUILD_ID__"\nconst again = "__BUILD_ID__"\n',
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "manifest.webmanifest": '{"name":"koymukarnnovel"}',
    "theme-init.js": "document.documentElement.dataset.theme = 'midnight'\n",
    ".secret": "SECRET-DOTFILE",
    ...files,
  }
  for (const [name, content] of Object.entries(all)) dist.write(name, content)
  fs.writeFileSync(path.join(root, "secret.txt"), "SECRET-OUTSIDE-DIST")
  return dist
}

interface Lib {
  aria: number
  plain: number
  hidden: number
  evil: number
  empty: number
}

function seedCover(db: Db, novelId: number, updatedAt: string): void {
  db.run("INSERT INTO covers (novel_id, mime, data, updated_at) VALUES (?, 'image/png', ?, ?)", novelId, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), updatedAt)
}

const visible = (o: SeedChapter): SeedChapter => ({ status: "done", published: true, translation: "SECRET-TRANSLATION", ...o })

function seedLib(db: Db): Lib {
  const aria = seedNovel(db, { title: "Aria's Tale", titleTh: "นิทานอาเรีย", published: true, synopsis: ARIA_SYNOPSIS, updatedAt: "2026-02-01 00:00:00" })
  seedCover(db, aria, "2026-03-04 05:06:07")
  seedChapter(db, aria, 0, visible({ title: "Prologue", titleTh: "บทนำ", publishedAt: "2026-02-10 10:00:00" }))
  seedChapter(db, aria, 1, visible({ title: "Chapter 1", publishedAt: "2026-02-12 12:00:00" }))
  seedChapter(db, aria, 2, visible({ title: "Chapter 2", translation: "", publishedAt: "2026-02-13 00:00:00" })) // เผยแพร่แต่ยังไม่มีคำแปล
  seedChapter(db, aria, 3, visible({ title: "Chapter 3", published: false })) // แปลแล้วแต่ยังไม่เผยแพร่
  seedChapter(db, aria, 7, visible({ title: "Chapter 7", titleTh: "ตอนเจ็ด", publishedAt: "2026-02-11 09:00:00" }))
  db.run("UPDATE chapters SET updated_at = '2026-02-20 08:00:00' WHERE novel_id = ? AND number = 0", aria)

  const plain = seedNovel(db, { title: "Plain Novel", published: true, synopsis: "", updatedAt: "2026-01-15 00:00:00" })
  seedChapter(db, plain, 1, visible({ title: "Only Chapter", publishedAt: "2026-03-01 00:00:00" }))

  const hidden = seedNovel(db, { title: "Hidden Secret Novel", titleTh: "นิยายลับ", published: false, synopsis: "SECRET-SYNOPSIS" })
  seedCover(db, hidden, "2026-03-05 00:00:00")
  seedChapter(db, hidden, 1, visible({ title: "Hidden Chapter", publishedAt: "2026-03-02 00:00:00" }))

  const evil = seedNovel(db, { title: EVIL, titleTh: EVIL, published: true, synopsis: EVIL_SYNOPSIS, updatedAt: "2026-01-20 00:00:00" })
  seedChapter(db, evil, 1, visible({ title: EVIL, titleTh: EVIL, publishedAt: "2026-03-03 00:00:00" }))

  const empty = seedNovel(db, { title: "Empty Novel", published: true, synopsis: "ยังไม่มีตอน", updatedAt: "2026-01-10 00:00:00" })
  return { aria, plain, hidden, evil, empty }
}

interface Env {
  t: TestApp
  clock: Clock
  dist: Dist
  lib: Lib
  c: Client
  /** ผู้ดูแลที่ล็อกอินแล้ว */
  admin: Client
}

interface Opts {
  publicUrl?: string | null
  trustProxy?: number
  /** false = ไม่สร้าง web/dist เลย (ชี้ไปโฟลเดอร์ที่ไม่มีอยู่) */
  dist?: boolean
  files?: Record<string, string>
  settings?: Partial<{ siteName: string; tagline: string; aboutText: string; contactText: string; accent: AccentId; indexable: boolean }>
  /** true = เทสต์นี้ตั้งใจให้แอปบันทึก error (ไม่ตรวจว่า log ปลอด error) */
  expectErrors?: boolean
}

async function withShell(fn: (env: Env) => Promise<void>, o: Opts = {}): Promise<void> {
  const clock = createClock()
  const dist = makeDist(o.files)
  const webDist = o.dist === false ? path.join(dist.root, "no-such-dist") : dist.dir
  const t = await startTestApp({ now: clock.now, webDist, config: { publicUrl: o.publicUrl === undefined ? PUBLIC_URL : o.publicUrl, trustProxy: o.trustProxy ?? 0 } })
  try {
    t.settings.update({ ...SITE, ...o.settings })
    const lib = seedLib(t.db)
    const admin = t.client()
    await admin.login()
    await fn({ t, clock, dist, lib, c: t.client(), admin })
    if (!o.expectErrors) assert.deepEqual(t.logs.filter((line) => line.startsWith("error:")), [], "ไม่ควรมี error ใน log ของแอป")
  } finally {
    await t.close()
    fs.rmSync(dist.root, { recursive: true, force: true })
  }
}

const NOT_FOUND_TITLE = `ไม่พบหน้านี้ | ${SITE.siteName}`
const ADMIN_TITLE = `หลังบ้าน | ${SITE.siteName}`

// ═════════════════════════ หน้าแรก · เกี่ยวกับ · ติดต่อ ═════════════════════════

test("GET /: shell 200 พร้อม title, description, canonical และ OG ของเว็บ · แม่แบบอื่นๆ ยังอยู่ · หัว HTML ถูกต้อง", async () => {
  await withShell(async ({ c }) => {
    const r = await c.get("/")
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type")!, /^text\/html; charset=utf-8$/i)
    assert.equal(r.headers.get("cache-control"), "no-cache")
    assert.ok(r.headers.get("content-security-policy"), "หัวความปลอดภัยรวมของแอปติดมาด้วย")
    assert.equal(titleOf(r.text), `${SITE.siteName} — ${SITE.tagline}`)
    assert.equal(metaOf(r.text, "name", "description"), SITE.tagline)
    assert.equal(metaOf(r.text, "property", "og:description"), SITE.tagline)
    assert.equal(canonicalOf(r.text), `${PUBLIC_URL}/`)
    assert.equal(metaOf(r.text, "property", "og:url"), `${PUBLIC_URL}/`)
    assert.equal(metaOf(r.text, "property", "og:type"), "website")
    assert.equal(metaOf(r.text, "property", "og:site_name"), SITE.siteName)
    assert.equal(metaOf(r.text, "name", "twitter:card"), "summary")
    assert.equal(metaOf(r.text, "property", "og:image"), null)
    assert.ok(!hasNoindex(r.text))
    assert.ok(r.text.includes('<script type="module" crossorigin src="/assets/a.js"></script>'))
    assert.ok(r.text.includes('<div id="root"></div>'))
  })
})

test("GET /: ไม่มีสโลแกน → title เป็นชื่อเว็บล้วน description ใช้ข้อความหน้าเกี่ยวกับ (ตัด 160)", async () => {
  await withShell(
    async ({ c }) => {
      const r = await c.get("/")
      assert.equal(titleOf(r.text), SITE.siteName)
      assert.equal(metaOf(r.text, "name", "description"), `${"ก".repeat(160)}…`)
    },
    { settings: { tagline: "", aboutText: "ก".repeat(200) } },
  )
  await withShell(
    async ({ c }) => {
      assert.equal(metaOf((await c.get("/")).text, "name", "description"), SITE.siteName, "ไม่มีทั้งสโลแกนและข้อความเกี่ยวกับ → ใช้ชื่อเว็บ")
    },
    { settings: { tagline: "", aboutText: "" } },
  )
})

test("GET /about, /contact: title เฉพาะหน้า description จากข้อความที่เจ้าของตั้ง (ตัด 160 หลังยุบช่องว่าง) · canonical ของหน้านั้น", async () => {
  await withShell(
    async ({ c }) => {
      const about = await c.get("/about")
      assert.equal(about.status, 200)
      assert.equal(titleOf(about.text), `เกี่ยวกับเว็บนี้ | ${SITE.siteName}`)
      const collapsed = "ข้อความ เกี่ยวกับ ".repeat(20).trim()
      assert.ok(Array.from(collapsed).length > 160)
      assert.equal(metaOf(about.text, "name", "description"), `${Array.from(collapsed).slice(0, 160).join("")}…`)
      assert.equal(canonicalOf(about.text), `${PUBLIC_URL}/about`)

      const contact = await c.get("/contact")
      assert.equal(contact.status, 200)
      assert.equal(titleOf(contact.text), `ติดต่อ / แจ้งลบเนื้อหา | ${SITE.siteName}`)
      assert.equal(metaOf(contact.text, "name", "description"), "อีเมล: owner@example.com")
      assert.equal(canonicalOf(contact.text), `${PUBLIC_URL}/contact`)
    },
    { settings: { aboutText: "ข้อความ\nเกี่ยวกับ\r\n".repeat(20), contactText: "  อีเมล:\n owner@example.com  " } },
  )
  await withShell(async ({ c }) => {
    const contact = await c.get("/contact")
    assert.equal(metaOf(contact.text, "name", "description"), "ช่องทางติดต่อและแจ้งลบเนื้อหา", "ยังไม่มีข้อความติดต่อ → คำอธิบายสำรอง")
  })
  await withShell(
    async ({ c }) => {
      assert.equal(metaOf((await c.get("/about")).text, "name", "description"), SITE.tagline, "เจ้าของลบข้อความเกี่ยวกับจนว่าง → ใช้สโลแกน")
    },
    { settings: { aboutText: "" } },
  )
  await withShell(
    async ({ c }) => {
      assert.equal(metaOf((await c.get("/about")).text, "name", "description"), SITE.siteName, "ไม่มีทั้งข้อความเกี่ยวกับและสโลแกน → ชื่อเว็บ")
    },
    { settings: { aboutText: "", tagline: "" } },
  )
})

test("accent: ตั้งสีอื่น → <html lang=\"th\" data-accent=\"teal\"> ทุกหน้า รวม 404 และหลังบ้าน · default ไม่มี data-accent", async () => {
  await withShell(
    async ({ c, lib }) => {
      for (const p of ["/", "/about", `/novel/${lib.aria}`, `/novel/${lib.aria}/1`, "/admin", "/admin/x", "/ไม่มีอยู่", "/novel/9999"]) {
        assert.equal(htmlTag((await c.get(p)).text), '<html lang="th" data-accent="teal">', p)
      }
    },
    { settings: { accent: "teal" } },
  )
  await withShell(async ({ c }) => {
    assert.equal(htmlTag((await c.get("/")).text), '<html lang="th">')
  })
})

// ═════════════════════════ หน้านิยาย ═════════════════════════

test("GET /novel/:id: เรื่องที่เผยแพร่ → 200 title (ชื่อไทยก่อน) description (เรื่องย่อยุบช่องว่างตัด 160) canonical og:image(ปกพร้อม ?v=) og:type=book", async () => {
  await withShell(async ({ c, lib }) => {
    const r = await c.get(`/novel/${lib.aria}`)
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("cache-control"), "no-cache")
    assert.match(r.headers.get("vary") ?? "", /cookie/i, "คำตอบขึ้นกับ cookie ผู้ดูแล (ร่างเห็นได้เฉพาะผู้ดูแล) แคชกลางต้องแยก")
    const collapsed = ARIA_SYNOPSIS.replace(/\s+/g, " ")
    assert.ok(Array.from(collapsed).length > 160)
    assert.equal(titleOf(r.text), `นิทานอาเรีย | ${SITE.siteName}`)
    assert.equal(metaOf(r.text, "property", "og:title"), `นิทานอาเรีย | ${SITE.siteName}`)
    assert.equal(metaOf(r.text, "name", "description"), `${Array.from(collapsed).slice(0, 160).join("")}…`)
    assert.equal(canonicalOf(r.text), `${PUBLIC_URL}/novel/${lib.aria}`)
    assert.equal(metaOf(r.text, "property", "og:url"), `${PUBLIC_URL}/novel/${lib.aria}`)
    assert.equal(metaOf(r.text, "property", "og:type"), "book")
    assert.equal(metaOf(r.text, "property", "og:site_name"), SITE.siteName)
    assert.equal(metaOf(r.text, "property", "og:image"), `${PUBLIC_URL}/covers/${lib.aria}?v=${Date.parse("2026-03-04T05:06:07Z") / 1000}`)
    assert.equal(metaOf(r.text, "name", "twitter:card"), "summary_large_image")
    assert.ok(!hasNoindex(r.text))
    assert.ok(!r.text.includes("SECRET"), "ไม่มีเนื้อหาตอนหลุดมาในหน้า")
  })
})

test("GET /novel/:id: ไม่มีชื่อไทย → ชื่อเดิม · ไม่มีปก → ไม่มี og:image/summary · ไม่มีเรื่องย่อ → ใช้สโลแกน · เรื่องย่อยาว 160 พอดีไม่มี … / 161 มี …", async () => {
  await withShell(async ({ t, c, lib }) => {
    const plain = await c.get(`/novel/${lib.plain}`)
    assert.equal(plain.status, 200)
    assert.equal(titleOf(plain.text), `Plain Novel | ${SITE.siteName}`)
    assert.equal(metaOf(plain.text, "property", "og:image"), null)
    assert.equal(metaOf(plain.text, "name", "twitter:card"), "summary")
    assert.equal(metaOf(plain.text, "name", "description"), SITE.tagline)

    const exact = seedNovel(t.db, { title: "E", published: true, synopsis: "ก".repeat(160) })
    const over = seedNovel(t.db, { title: "O", published: true, synopsis: "ก".repeat(161) })
    assert.equal(metaOf((await c.get(`/novel/${exact}`)).text, "name", "description"), "ก".repeat(160))
    assert.equal(metaOf((await c.get(`/novel/${over}`)).text, "name", "description"), `${"ก".repeat(160)}…`)

    const empty = await c.get(`/novel/${lib.empty}`)
    assert.equal(empty.status, 200, "เรื่องที่เผยแพร่แล้วแต่ยังไม่มีตอน ก็ยังเป็นหน้าที่มีอยู่")

    const padded = seedNovel(t.db, { title: "P", published: true, synopsis: "  \n สวัสดี \r\n  ชาวโลก  \n" })
    assert.equal(metaOf((await c.get(`/novel/${padded}`)).text, "name", "description"), "สวัสดี ชาวโลก", "ยุบช่องว่าง/ขึ้นบรรทัดใหม่เป็นช่องเดียว และตัดหัวท้าย")

    t.settings.update({ tagline: "" })
    assert.equal(metaOf((await c.get(`/novel/${lib.plain}`)).text, "name", "description"), SITE.siteName, "ไม่มีทั้งเรื่องย่อและสโลแกน → ชื่อเว็บ")
    assert.equal(metaOf((await c.get(`/novel/${lib.plain}/1`)).text, "name", "description"), SITE.siteName, "หน้าตอนก็เช่นกัน")
  })
})

test("shell กลาง (404 · ร่างของผู้ดูแล · /admin): คำอธิบายเรียงลำดับ สโลแกน → ข้อความเกี่ยวกับ (ยุบช่องว่าง) → ชื่อเว็บ", async () => {
  const cases: [NonNullable<Opts["settings"]>, string][] = [
    [{}, SITE.tagline],
    [{ tagline: "", aboutText: "เกี่ยวกับ\nเรา" }, "เกี่ยวกับ เรา"],
    [{ tagline: "", aboutText: "" }, SITE.siteName],
  ]
  for (const [settings, expected] of cases) {
    await withShell(
      async ({ c, admin, lib }) => {
        assert.equal(metaOf((await c.get("/nope")).text, "name", "description"), expected, "404 ทั่วไป")
        assert.equal(metaOf((await c.get("/novel/9999")).text, "name", "description"), expected, "404 ของเรื่อง")
        assert.equal(metaOf((await admin.get(`/novel/${lib.hidden}`)).text, "name", "description"), expected, "ร่างของผู้ดูแล")
        assert.equal(metaOf((await c.get("/admin")).text, "name", "description"), expected, "หลังบ้าน")
      },
      { settings },
    )
  }
})

test("GET /novel/:id: ชื่อ/เรื่องย่อที่มี <script> เครื่องหมายคำพูด และแบบแผน $ ถูก escape ครบใน title, og:title, description, og:description", async () => {
  await withShell(async ({ c, lib }) => {
    const r = await c.get(`/novel/${lib.evil}`)
    assert.equal(r.status, 200)
    const head = headOf(r.text)
    assert.equal(titleOf(r.text), `${EVIL} | ${SITE.siteName}`)
    assert.equal(metaOf(r.text, "property", "og:title"), `${EVIL} | ${SITE.siteName}`)
    assert.equal(metaOf(r.text, "name", "description"), EVIL_SYNOPSIS)
    assert.equal(metaOf(r.text, "property", "og:description"), EVIL_SYNOPSIS)
    assert.ok(head.includes("&lt;script&gt;&quot;x&quot;&lt;/script&gt;"))
    assert.ok(!head.includes("<script>"), "ไม่มี <script> ดิบใน head")
    assert.ok(!r.text.includes('<script>"x"'), "ไม่มี <script> ดิบในหน้า")
  })
})

test("GET /novel/:id ที่ซ่อน/ไม่มี/id ผิดรูป → shell 404 หน้าเดียวกันทุกตัวอักษร (ไม่เฉลยว่ามีเรื่องซ่อนอยู่) generic + noindex ไม่มีชื่อเรื่องรั่ว", async () => {
  await withShell(async ({ c, lib }) => {
    const missing = await c.get("/novel/9999")
    assert.equal(missing.status, 404)
    assert.match(missing.headers.get("content-type")!, /^text\/html/)
    assert.equal(missing.headers.get("cache-control"), "no-cache")
    assert.match(missing.headers.get("vary") ?? "", /cookie/i)
    assert.equal(titleOf(missing.text), NOT_FOUND_TITLE)
    assert.ok(hasNoindex(missing.text))
    assert.equal(canonicalOf(missing.text), null)
    assert.ok(missing.text.includes('<div id="root"></div>'), "เป็น shell ของ SPA ให้หน้าเว็บแสดง 'ไม่พบหน้านี้' เอง")

    for (const p of [`/novel/${lib.hidden}`, "/novel/abc", "/novel/0", "/novel/01", "/novel/-1", "/novel/1.5", "/novel/1e2", `/novel/${"9".repeat(40)}`, "/novel/%20"]) {
      const r = await c.get(p)
      assert.equal(r.status, 404, p)
      assert.equal(r.text, missing.text, `${p} ต้องเหมือนเรื่องที่ไม่มีอยู่ทุกตัวอักษร`)
      assert.ok(!r.text.includes("นิยายลับ") && !r.text.includes("Hidden Secret") && !r.text.includes("SECRET"), p)
    }
  })
})

// ═════════════════════════ หน้าอ่านตอน ═════════════════════════

test("GET /novel/:id/:number: ตอนที่เผยแพร่ → 200 title ตอน+เรื่อง description จากเรื่องย่อของเรื่อง (ไม่ใช่เนื้อตอน) canonical og:type=article · ตอนเลข 0 ก็ได้", async () => {
  await withShell(async ({ c, lib }) => {
    const first = await c.get(`/novel/${lib.aria}/0`)
    assert.equal(first.status, 200)
    assert.equal(titleOf(first.text), `ตอนที่ 0: บทนำ — นิทานอาเรีย | ${SITE.siteName}`)
    assert.equal(canonicalOf(first.text), `${PUBLIC_URL}/novel/${lib.aria}/0`)
    assert.equal(metaOf(first.text, "property", "og:url"), `${PUBLIC_URL}/novel/${lib.aria}/0`)
    assert.equal(metaOf(first.text, "property", "og:type"), "article")
    assert.equal(metaOf(first.text, "property", "og:image"), `${PUBLIC_URL}/covers/${lib.aria}?v=${Date.parse("2026-03-04T05:06:07Z") / 1000}`)
    assert.equal(metaOf(first.text, "name", "description"), `${Array.from(ARIA_SYNOPSIS.replace(/\s+/g, " ")).slice(0, 160).join("")}…`)
    assert.ok(!first.text.includes("SECRET"), "เนื้อหาตอนไม่ถูกฝังใน shell")
    assert.ok(!hasNoindex(first.text))

    const second = await c.get(`/novel/${lib.aria}/1`)
    assert.equal(titleOf(second.text), `ตอนที่ 1: Chapter 1 — นิทานอาเรีย | ${SITE.siteName}`, "ไม่มีชื่อไทย → ชื่อเดิมของตอน")
    const noCover = await c.get(`/novel/${lib.plain}/1`)
    assert.equal(titleOf(noCover.text), `ตอนที่ 1: Only Chapter — Plain Novel | ${SITE.siteName}`)
    assert.equal(metaOf(noCover.text, "property", "og:image"), null)
    assert.equal(metaOf(noCover.text, "name", "description"), SITE.tagline, "เรื่องไม่มีเรื่องย่อ → สโลแกน")
  })
})

test("GET /novel/:id/:number: ชื่อตอน/เรื่องที่มี <script> ถูก escape", async () => {
  await withShell(async ({ c, lib }) => {
    const r = await c.get(`/novel/${lib.evil}/1`)
    assert.equal(r.status, 200)
    assert.equal(titleOf(r.text), `ตอนที่ 1: ${EVIL} — ${EVIL} | ${SITE.siteName}`)
    assert.ok(!headOf(r.text).includes("<script>"))
    assert.equal(metaOf(r.text, "name", "description"), EVIL_SYNOPSIS)
  })
})

test("GET /novel/:id/:number: ตอนที่ไม่มีชื่อเลย (ทั้งไทยและเดิม) → หัวเรื่องไม่มี ':' ค้าง · vary ตาม cookie", async () => {
  await withShell(async ({ t, c, lib }) => {
    seedChapter(t.db, lib.plain, 2, visible({ title: "", titleTh: "", publishedAt: "2026-03-05 00:00:00" }))
    const r = await c.get(`/novel/${lib.plain}/2`)
    assert.equal(r.status, 200)
    assert.equal(titleOf(r.text), `ตอนที่ 2 — Plain Novel | ${SITE.siteName}`)
    assert.match(r.headers.get("vary") ?? "", /cookie/i)
    assert.equal(r.headers.get("cache-control"), "no-cache")
  })
})

test("GET /novel/:id/:number ที่ไม่เห็น (ไม่มีคำแปล · ยังไม่เผยแพร่ · เรื่องซ่อน · ไม่มีตอน · เลขผิดรูป) → shell 404 เหมือนกันทุกตัวอักษร", async () => {
  await withShell(async ({ c, lib }) => {
    const missing = await c.get(`/novel/${lib.aria}/99`)
    assert.equal(missing.status, 404)
    assert.equal(titleOf(missing.text), NOT_FOUND_TITLE)
    assert.ok(hasNoindex(missing.text))
    const paths = [
      `/novel/${lib.aria}/2`, // เผยแพร่แต่คำแปลว่าง
      `/novel/${lib.aria}/3`, // แปลแล้วแต่ยังไม่เผยแพร่
      `/novel/${lib.hidden}/1`, // เรื่องซ่อน
      "/novel/9999/1",
      `/novel/${lib.aria}/-1`,
      `/novel/${lib.aria}/01`,
      `/novel/${lib.aria}/00`,
      `/novel/${lib.aria}/1.5`,
      `/novel/${lib.aria}/abc`,
      `/novel/${lib.aria}/1e1`,
      `/novel/${lib.aria}/${"9".repeat(400)}`,
      `/novel/${lib.aria}/4`, // ไม่มีตอนนี้ (มีช่องว่างระหว่างเลข)
      `/novel/${lib.empty}/0`,
      `/novel/${lib.aria}/1/extra`,
    ]
    for (const p of paths) {
      const r = await c.get(p)
      assert.equal(r.status, 404, p)
      assert.equal(r.text, missing.text, p)
    }
  })
})

test("Review Focus: ตอนที่มีเลขต่อจากตอนที่มี (ช่องว่างของเลขตอน) ไม่ถูกเลื่อนไปตอนถัดไป", async () => {
  await withShell(async ({ c, lib }) => {
    // aria มีตอน 0,1,7 ที่เห็น: ตอน 2–6 ต้อง 404 ไม่ใช่เด้งไปตอน 7
    for (const n of [2, 3, 4, 5, 6]) assert.equal((await c.get(`/novel/${lib.aria}/${n}`)).status, 404, `ตอน ${n}`)
    assert.equal((await c.get(`/novel/${lib.aria}/7`)).status, 200)
  })
})

// ═════════════════════════ ผู้ดูแล ═════════════════════════

test("ผู้ดูแลที่ล็อกอิน: เรื่อง/ตอนที่ซ่อนหรือไม่มี → 200 (shell กลาง ไม่มีชื่อเรื่องที่ซ่อน, noindex) · ทุกคำตอบ private, no-store · เรื่องปกติได้ meta ของเรื่องนั้น", async () => {
  await withShell(async ({ admin, c, lib }) => {
    for (const p of [`/novel/${lib.hidden}`, `/novel/${lib.hidden}/1`, `/novel/${lib.aria}/3`, `/novel/${lib.aria}/2`, "/novel/9999", `/novel/${lib.aria}/99`]) {
      const r = await admin.get(p)
      assert.equal(r.status, 200, p)
      assert.equal(r.headers.get("cache-control"), "private, no-store", p)
      assert.equal(titleOf(r.text), SITE.siteName, `${p}: ผู้ดูแลได้ shell กลางที่ไม่ใช่หัว "ไม่พบหน้านี้" (หน้าเว็บตั้งชื่อหน้าเองจากข้อมูลหลังบ้าน)`)
      assert.ok(hasNoindex(r.text), p)
      assert.equal(canonicalOf(r.text), null, p)
      assert.ok(!r.text.includes("นิยายลับ") && !r.text.includes("Hidden Secret") && !r.text.includes("SECRET"), p)
    }
    const normal = await admin.get(`/novel/${lib.aria}`)
    assert.equal(normal.status, 200)
    assert.equal(titleOf(normal.text), `นิทานอาเรีย | ${SITE.siteName}`)
    assert.equal(normal.headers.get("cache-control"), "private, no-store")
    assert.ok(!hasNoindex(normal.text))

    const reader = await c.get(`/novel/${lib.hidden}`)
    assert.equal(reader.status, 404, "คนทั่วไปยังได้ 404")
    assert.equal(reader.headers.get("cache-control"), "no-cache")
  })
})

test("cookie ผู้ดูแลปลอม/หมดอายุ/ผิดรหัส ไม่ได้สิทธิ์ดูร่าง (ได้ 404 เหมือนคนทั่วไป)", async () => {
  await withShell(async ({ c, lib, clock, admin }) => {
    const forged = await c.get(`/novel/${lib.hidden}`, { headers: { cookie: "koymukarnnovel_admin=forged.value" } })
    assert.equal(forged.status, 404)
    const cookie = [...admin.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
    assert.equal((await c.get(`/novel/${lib.hidden}`, { headers: { cookie } })).status, 200, "cookie จริงใช้ได้")
    clock.advance(31 * 24 * 3600 * 1000)
    assert.equal((await c.get(`/novel/${lib.hidden}`, { headers: { cookie } })).status, 404, "cookie หมดอายุ (30 วัน)")
  })
})

// ═════════════════════════ หลังบ้าน · 404 · เส้นทางอื่น ═════════════════════════

test("/admin, /admin/, /admin/x/y → shell 200 พร้อม noindex (และหัว X-Robots-Tag) · ไม่ต้องล็อกอินก็ได้ shell (SPA จัดการเอง) · ไม่ใส่ canonical", async () => {
  await withShell(async ({ c }) => {
    for (const p of ["/admin", "/admin/", "/admin/novels", "/admin/novels/3/edit", "/admin/x?y=1"]) {
      const r = await c.get(p)
      assert.equal(r.status, 200, p)
      assert.equal(titleOf(r.text), ADMIN_TITLE, p)
      assert.ok(hasNoindex(r.text), p)
      assert.equal(canonicalOf(r.text), null, p)
      assert.equal(r.headers.get("x-robots-tag"), "noindex", p)
      assert.equal(r.headers.get("cache-control"), "no-cache", p)
      assert.ok(r.text.includes('<div id="root"></div>'), p)
    }
    assert.equal((await c.get("/administrator")).status, 404, "/administrator ไม่ใช่หลังบ้าน")
  })
})

test("เส้นทางอื่นที่ไม่ใช่ API → shell 404 (HTML) · /api/... → JSON 404 ไม่ใช่ shell · ไฟล์ใน /assets ที่ไม่มี → JSON 404 ไม่ใช่ HTML", async () => {
  await withShell(async ({ c }) => {
    for (const p of ["/ไม่มีอยู่", "/%E0%B9%84%E0%B8%A1%E0%B9%88%E0%B8%A1%E0%B8%B5", "/nope", "/nope/deeper/still", "/novel", "/novel/", "/favicon.ico", "/robots.txt.bak"]) {
      const r = await c.get(p)
      assert.equal(r.status, 404, p)
      assert.match(r.headers.get("content-type")!, /^text\/html/, p)
      assert.equal(titleOf(r.text), NOT_FOUND_TITLE, p)
      assert.ok(hasNoindex(r.text), p)
    }
    const api = await c.get("/api/ไม่มีอยู่")
    assert.equal(api.status, 404)
    assert.equal(api.json.code, "not_found")
    assert.match(api.headers.get("content-type")!, /^application\/json/)

    for (const p of ["/assets/missing.js", "/assets/", "/assets", "/assets/deeper/missing.css"]) {
      const r = await c.get(p)
      assert.equal(r.status, 404, p)
      assert.equal(r.json.code, "not_found", p)
      assert.match(r.json.error, THAI, p)
      assert.match(r.headers.get("content-type")!, /^application\/json/, p)
    }
  })
})

test("วิธีเรียกที่ไม่ใช่ GET/HEAD → 405 JSON ไทย + Allow: GET, HEAD (ทั้งหน้าที่รู้จักและไม่รู้จัก) · HEAD ได้หัวเดียวกับ GET ไม่มี body", async () => {
  await withShell(async ({ c, t }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const p of ["/", "/admin/x", "/novel/1", "/nope", "/sitemap.xml", "/assets/a.js"]) {
        const r = await c.raw(p, { method, headers: { Origin: t.base } })
        assert.equal(r.status, 405, `${method} ${p}`)
        assert.equal(r.headers.get("allow"), "GET, HEAD", `${method} ${p}`)
        assert.equal(r.json.code, "method_not_allowed", `${method} ${p}`)
        assert.match(r.json.error, THAI)
      }
    }
    const head = await c.raw("/", { method: "HEAD" })
    const get = await c.get("/")
    assert.equal(head.status, 200)
    assert.equal(head.text, "")
    assert.equal(head.headers.get("content-type"), get.headers.get("content-type"))
    assert.equal(head.headers.get("cache-control"), get.headers.get("cache-control"))
    assert.equal((await c.raw("/nope", { method: "HEAD" })).status, 404)
  })
})

test("พาธที่ถอดรหัส % ไม่ได้ในเส้นทางที่มีพารามิเตอร์ → 400 JSON (ไม่ใช่ 500 ไม่มี error ใน log)", async () => {
  await withShell(async ({ c }) => {
    const r = await c.get("/novel/%E0%A4%A")
    assert.equal(r.status, 400)
    assert.equal(r.json.code, "bad_request")
    assert.equal((await c.get("/%E0%A4%A")).status, 404)
  })
})

// ═════════════════════════ URL สมบูรณ์: PUBLIC_URL / Host ═════════════════════════

test("ไม่ตั้ง PUBLIC_URL → ใช้หัว Host ของคำขอ (http ตามค่าเริ่มต้น) ทั้ง canonical, og:url, og:image และ robots/sitemap", async () => {
  await withShell(
    async ({ t, lib }) => {
      const host = "books.example.test:8443"
      const r = await rawRequest({ port: t.port, path: `/novel/${lib.aria}`, headers: { Host: host } })
      const text = r.text
      assert.equal(r.status, 200)
      assert.equal(canonicalOf(text), `http://${host}/novel/${lib.aria}`)
      assert.equal(metaOf(text, "property", "og:url"), `http://${host}/novel/${lib.aria}`)
      assert.ok(metaOf(text, "property", "og:image")!.startsWith(`http://${host}/covers/${lib.aria}?v=`))

      const plain = await rawRequest({ port: t.port, path: "/", headers: { Host: "plain.example" } })
      assert.equal(canonicalOf(plain.text), "http://plain.example/")
      const robots = await rawRequest({ port: t.port, path: "/robots.txt", headers: { Host: "plain.example" } })
      assert.ok(robots.text.includes("Sitemap: http://plain.example/sitemap.xml\n"))
      const sitemap = await rawRequest({ port: t.port, path: "/sitemap.xml", headers: { Host: "plain.example" } })
      assert.ok(sitemap.text.includes("<loc>http://plain.example/</loc>"))
    },
    { publicUrl: null },
  )
})

test("Host แปลกปลอม (อักขระที่ไม่ใช่ชื่อโฮสต์) ถูกปฏิเสธ → ใช้ค่าสำรอง ไม่ฝังลงหน้าหรือ sitemap", async () => {
  await withShell(
    async ({ t, lib }) => {
      for (const host of [`evil.example"><script>alert(1)</script>`, "a b.example", "x/../y", "evil.example:99999x", "<b>", "a.example:", `"`, "[::1", "a.example:123456", "a".repeat(256), "a..b", "[g::1]", "user@evil.example", "evil.example:80:80", ":8080", "[]", "[:]x"]) {
        const r = await rawRequest({ port: t.port, path: `/novel/${lib.aria}`, headers: { Host: host } })
        assert.equal(r.status, 200, host)
        assert.equal(canonicalOf(r.text), `http://localhost:${t.config.port}/novel/${lib.aria}`, host)
        assert.ok(!r.text.includes("alert(1)") && !r.text.includes("evil.example"), host)
        const sitemap = await rawRequest({ port: t.port, path: "/sitemap.xml", headers: { Host: host } })
        assert.ok(!sitemap.text.includes("evil.example") && !sitemap.text.includes("alert(1)"), host)
        assert.ok(sitemap.text.includes(`<loc>http://localhost:${t.config.port}/</loc>`), host)
        const robots = await rawRequest({ port: t.port, path: "/robots.txt", headers: { Host: host } })
        assert.ok(robots.text.includes(`Sitemap: http://localhost:${t.config.port}/sitemap.xml\n`), host)
      }
      const valid = ["localhost", "127.0.0.1:8787", "[::1]:8787", "[2001:db8::1]", "[2001:DB8::1]", "[::ffff:1.2.3.4]", "my_service:3000", "a-b.c-d.example", "EXAMPLE.com", "a.example:8", "a.example:65535", "a".repeat(255)]
      for (const host of valid) {
        const r = await rawRequest({ port: t.port, path: "/", headers: { Host: host } })
        assert.equal(canonicalOf(r.text), `http://${host}/`, host)
      }
    },
    { publicUrl: null },
  )
})

test("คำขอ HTTP/1.0 ที่ไม่มีหัว Host เลย → ใช้ค่าสำรอง (ไม่ล้ม 500)", async () => {
  await withShell(
    async ({ t }) => {
      const r = await rawSocketRequest(t.port, "GET / HTTP/1.0\r\n\r\n")
      assert.equal(r.status, 200)
      assert.equal(canonicalOf(r.text), `http://localhost:${t.config.port}/`)
    },
    { publicUrl: null },
  )
})

test("ตั้ง PUBLIC_URL → ใช้ค่านั้นเสมอ ไม่สนหัว Host/X-Forwarded-* ของคำขอ", async () => {
  await withShell(
    async ({ t, lib }) => {
      const r = await rawRequest({
        port: t.port,
        path: `/novel/${lib.aria}`,
        headers: { Host: "evil.example", "X-Forwarded-Host": "evil2.example", "X-Forwarded-Proto": "http" },
      })
      assert.equal(canonicalOf(r.text), `${PUBLIC_URL}/novel/${lib.aria}`)
      assert.ok(!r.text.includes("evil"))
    },
    { trustProxy: 1 },
  )
})

test("ไม่ตั้ง PUBLIC_URL แต่เชื่อ proxy 1 ชั้น → ใช้ X-Forwarded-Proto/Host (เฉพาะ http/https) · ไม่เชื่อ proxy → เมินหัวพวกนี้", async () => {
  await withShell(
    async ({ t }) => {
      const via = await rawRequest({ port: t.port, path: "/about", headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "front.example" } })
      assert.equal(canonicalOf(via.text), "https://front.example/about")
      const weird = await rawRequest({ port: t.port, path: "/about", headers: { "X-Forwarded-Proto": "javascript", "X-Forwarded-Host": "front.example" } })
      assert.equal(canonicalOf(weird.text), "http://front.example/about", "โปรโตคอลที่ไม่ใช่ https ถือเป็น http")
    },
    { publicUrl: null, trustProxy: 1 },
  )
  await withShell(
    async ({ t }) => {
      const r = await rawRequest({ port: t.port, path: "/about", headers: { Host: "real.example", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "front.example" } })
      assert.equal(canonicalOf(r.text), "http://real.example/about")
    },
    { publicUrl: null, trustProxy: 0 },
  )
})

// ═════════════════════════ robots.txt · noindex ═════════════════════════

test("robots.txt (เปิดให้ค้นหา): Disallow: /admin และ /api/ + Sitemap: URL สมบูรณ์ · text/plain · HEAD ได้", async () => {
  await withShell(async ({ c }) => {
    const r = await c.get("/robots.txt")
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type")!, /^text\/plain; charset=utf-8$/i)
    assert.equal(r.headers.get("cache-control"), "no-cache")
    assert.equal(r.text, `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`)
    assert.equal((await c.raw("/robots.txt", { method: "HEAD" })).status, 200)
  })
})

test("ปิด 'ให้เสิร์ชเอนจินค้นเจอ': robots.txt เป็น Disallow: / ล้วน · ทุก shell มี noindex · sitemap.xml 404 · เปิดกลับมาก็กลับเป็นเดิมทันที", async () => {
  await withShell(
    async ({ t, c, lib }) => {
      const robots = await c.get("/robots.txt")
      assert.equal(robots.text, "User-agent: *\nDisallow: /\n")
      assert.ok(!robots.text.includes("Sitemap"))
      for (const p of ["/", "/about", "/contact", `/novel/${lib.aria}`, `/novel/${lib.aria}/1`, "/nope"]) {
        assert.ok(hasNoindex((await c.get(p)).text), p)
      }
      const sitemap = await c.get("/sitemap.xml")
      assert.equal(sitemap.status, 404)
      assert.equal(sitemap.json.code, "not_found")
      assert.match(sitemap.json.error, THAI)

      t.settings.update({ indexable: true })
      assert.ok((await c.get("/robots.txt")).text.includes("Sitemap:"))
      assert.ok(!hasNoindex((await c.get("/")).text))
      assert.equal((await c.get("/sitemap.xml")).status, 200)
    },
    { settings: { indexable: false } },
  )
})

// ═════════════════════════ sitemap.xml ═════════════════════════

interface Entry {
  loc: string
  lastmod: string | null
}
function entriesOf(xml: string): Entry[] {
  return [...xml.matchAll(/<url><loc>([^<]*)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g)].map((m) => ({ loc: unescapeHtml(m[1]!), lastmod: m[2] ?? null }))
}

test("sitemap.xml: หน้าแรก /about /contact + เรื่อง/ตอนที่ผู้อ่านเห็นเท่านั้น พร้อม lastmod (ISO UTC) · URL สมบูรณ์ · XML ถูกต้อง", async () => {
  await withShell(async ({ c, lib }) => {
    const r = await c.get("/sitemap.xml")
    assert.equal(r.status, 200)
    assert.match(r.headers.get("content-type")!, /^application\/xml; charset=utf-8$/i)
    assert.equal(r.headers.get("cache-control"), "no-cache")
    assert.ok(r.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))
    assert.ok(r.text.endsWith("</urlset>\n"))

    const entries = entriesOf(r.text)
    assert.equal(count(r.text, /<url>/g), entries.length, "ทุก <url> อ่านได้ครบ")
    const base = `${PUBLIC_URL}/novel`
    assert.deepEqual(
      entries.slice(0, 3).map((e) => e.loc),
      [`${PUBLIC_URL}/`, `${PUBLIC_URL}/about`, `${PUBLIC_URL}/contact`],
    )
    assert.deepEqual(
      new Map(entries.map((e) => [e.loc, e.lastmod])),
      new Map<string, string | null>([
        [`${PUBLIC_URL}/`, "2026-03-03T00:00:00Z"], // ใหม่สุดของทุกเรื่องที่เห็น (evil/1)
        [`${PUBLIC_URL}/about`, null],
        [`${PUBLIC_URL}/contact`, null],
        [`${base}/${lib.aria}`, "2026-02-12T12:00:00Z"], // เวลาเผยแพร่ล่าสุดของตอนที่เห็น
        [`${base}/${lib.plain}`, "2026-03-01T00:00:00Z"],
        [`${base}/${lib.evil}`, "2026-03-03T00:00:00Z"],
        [`${base}/${lib.empty}`, "2026-01-10T00:00:00Z"], // ไม่มีตอนที่เห็น → เวลาแก้ของเรื่อง
        [`${base}/${lib.aria}/0`, "2026-02-20T08:00:00Z"], // แก้ทีหลังเวลาเผยแพร่ → ใช้เวลาแก้
        [`${base}/${lib.aria}/1`, "2026-02-12T12:00:00Z"], // เวลาแก้เก่ากว่าเวลาเผยแพร่ → ใช้เวลาเผยแพร่
        [`${base}/${lib.aria}/7`, "2026-02-11T09:00:00Z"],
        [`${base}/${lib.plain}/1`, "2026-03-01T00:00:00Z"],
        [`${base}/${lib.evil}/1`, "2026-03-03T00:00:00Z"],
      ]),
    )
    assert.ok(!r.text.includes(`/novel/${lib.hidden}`), "เรื่องซ่อนไม่อยู่ใน sitemap")
    assert.ok(!r.text.includes(`/novel/${lib.aria}/2<`) && !r.text.includes(`/novel/${lib.aria}/3<`), "ตอนที่ไม่เห็นไม่อยู่")
    assert.ok(!r.text.includes("SECRET"))
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.text), "ไม่มีอักขระควบคุมที่ XML ไม่รับ")
    assert.equal(r.text.split("\n").filter((line) => line.startsWith("<url>")).length, entries.length, "หนึ่ง URL ต่อบรรทัด")
  })
})

test("sitemap.xml: เวลาที่รูปแบบผิด (แก้นอกระบบ) ไม่ทำให้ XML เสีย — ไม่ใส่ lastmod ของรายการนั้น และไม่นับเข้าเวลาของหน้าแรก", async () => {
  await withShell(async ({ t, c, lib }) => {
    t.db.run("UPDATE chapters SET published_at = 'ไม่ใช่เวลา' WHERE novel_id = ?", lib.evil) // ไม่ใช่เวลาเลย (และ "ใหม่สุด" ตามตัวอักษร)
    t.db.run("UPDATE chapters SET updated_at = '2026-3-1 00:00:00' WHERE novel_id = ? AND number = 1", lib.plain) // ขาดเลขศูนย์ (และเป็นสตริงที่ 'ใหญ่กว่า' 2026-03-01 เมื่อเทียบตัวอักษร)
    t.db.run("UPDATE chapters SET updated_at = '2026-05-01 00:00:00 junk' WHERE novel_id = ? AND number = 7", lib.aria) // ท้ายมีขยะ
    t.db.run("UPDATE chapters SET updated_at = 'x2026-05-01 00:00:00' WHERE novel_id = ? AND number = 1", lib.aria) // หน้ามีขยะ
    const r = await c.get("/sitemap.xml")
    const map = new Map(entriesOf(r.text).map((e) => [e.loc, e.lastmod]))
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.evil}`), null)
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.evil}/1`), null)
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.plain}/1`), null, "published_at 2026-03-01 แต่ updated_at ผิดรูปที่ 'ใหม่กว่า' ตามตัวอักษร → ทั้งรายการไม่มี lastmod")
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.aria}/7`), null, "มีขยะต่อท้ายเวลา")
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.aria}/1`), null, "มีขยะนำหน้าเวลา")
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.aria}/0`), "2026-02-20T08:00:00Z", "ตอนอื่นไม่กระทบ")
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.plain}`), "2026-03-01T00:00:00Z", "เวลาระดับเรื่องใช้เวลาเผยแพร่ของตอน (ไม่ดูเวลาแก้ที่ผิดรูป)")
    assert.equal(map.get(`${PUBLIC_URL}/`), "2026-03-01T00:00:00Z", "หน้าแรก = ใหม่สุดในบรรดาเวลาของเรื่องที่อ่านออก (evil อ่านไม่ออกจึงไม่นับ)")
    assert.ok(!r.text.includes("ไม่ใช่เวลา") && !r.text.includes("2026-3-1") && !r.text.includes("junk"))
  })
})

test("sitemap.xml: ตอนที่เผยแพร่แล้วแต่ไม่มีเวลาเผยแพร่ (NULL) ใช้เวลาแก้ของตอนเป็น lastmod", async () => {
  await withShell(async ({ t, c, lib }) => {
    seedChapter(t.db, lib.plain, 5, visible({ publishedAt: null }))
    t.db.run("UPDATE chapters SET updated_at = '2026-06-01 12:30:00' WHERE novel_id = ? AND number = 5", lib.plain)
    const map = new Map(entriesOf((await c.get("/sitemap.xml")).text).map((e) => [e.loc, e.lastmod]))
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.plain}/5`), "2026-06-01T12:30:00Z")
    assert.equal(map.get(`${PUBLIC_URL}/novel/${lib.plain}`), "2026-03-01T00:00:00Z", "เวลาระดับเรื่องดูแต่เวลาเผยแพร่")
  })
})

test("sitemap.xml: lastmod รับเฉพาะ 'YYYY-MM-DD HH:MM:SS' เป๊ะ — รูปแบบใกล้เคียงทุกแบบถูกข้าม (ไม่ใส่ lastmod) ส่วนรูปแบบที่ถูกได้ ISO", async () => {
  await withShell(async ({ t, c }) => {
    const novel = seedNovel(t.db, { title: "T", published: true, synopsis: "", updatedAt: "2026-01-01 00:00:00" })
    const cases: [string, string | null][] = [
      ["2026-04-05 06:07:08", "2026-04-05T06:07:08Z"],
      ["2026-3-01 00:00:00", null], // เดือนหลักเดียว
      ["2026-03-1 00:00:00", null], // วันหลักเดียว
      ["20260-03-01 00:00:00", null], // ปีห้าหลัก
      ["026-03-01 00:00:00", null], // ปีสามหลัก
      ["2026-03-01T00:00:00", null], // คั่นด้วย T แล้ว (ไม่ใช่รูปที่ระบบเก็บ)
      ["2026-03-01  00:00:00", null], // เว้นวรรคสองตัว
      ["2026-03-01 0:00:00", null], // ชั่วโมงหลักเดียว
      ["2026-03-01 00:0:00", null], // นาทีหลักเดียว
      ["2026-03-01 00:00:0", null], // วินาทีหลักเดียว
      ["2026-03-01 00:00:000", null], // วินาทีสามหลัก
      ["2026-03-01 00:00:00.123", null], // มีเศษวินาที
      ["2026-03-01", null], // มีแต่วันที่
      ["2026-03-01 00:00:00Z", null], // มี Z ต่อท้ายอยู่แล้ว
    ]
    cases.forEach(([stamp], i) => {
      seedChapter(t.db, novel, i + 1, visible({ title: `C${i + 1}`, publishedAt: null }))
      t.db.run("UPDATE chapters SET updated_at = ? WHERE novel_id = ? AND number = ?", stamp, novel, i + 1)
    })
    const map = new Map(entriesOf((await c.get("/sitemap.xml")).text).map((e) => [e.loc, e.lastmod]))
    cases.forEach(([stamp, expected], i) => {
      assert.equal(map.get(`${PUBLIC_URL}/novel/${novel}/${i + 1}`), expected, stamp)
    })
  })
})

test("sitemap.xml: ไม่มีเรื่องเลย → เหลือสามหน้าหลัก ไม่มี lastmod ที่หน้าแรก", async () => {
  await withShell(async ({ t, c }) => {
    t.db.run("DELETE FROM chapters")
    t.db.run("DELETE FROM covers")
    t.db.run("DELETE FROM novels")
    const entries = entriesOf((await c.get("/sitemap.xml")).text)
    assert.deepEqual(entries, [
      { loc: `${PUBLIC_URL}/`, lastmod: null },
      { loc: `${PUBLIC_URL}/about`, lastmod: null },
      { loc: `${PUBLIC_URL}/contact`, lastmod: null },
    ])
  })
})

test("sitemap.xml: PUBLIC_URL ที่มี & < ' ถูก escape ใน <loc> และ $ ในค่าไม่ถูกตีความ", async () => {
  await withShell(
    async ({ c, lib }) => {
      const r = await c.get("/sitemap.xml")
      assert.ok(r.text.includes("<loc>https://k.example/p&amp;q$&amp;$&#39;/</loc>"), r.text.slice(0, 600))
      assert.ok(r.text.includes(`<loc>https://k.example/p&amp;q$&amp;$&#39;/novel/${lib.aria}</loc>`), r.text.slice(0, 900))
      assert.ok(!r.text.includes("&q") && !r.text.includes("'"), "ไม่มี & หรือ ' ดิบใน XML")
    },
    { publicUrl: "https://k.example/p&q$&$'" },
  )
})

test("sitemap.xml: เก็บผลในหน่วยความจำ 10 นาที (นับจากครั้งที่สร้าง) — เพิ่มตอนแล้วยังไม่เห็นจน 10 นาทีพอดี", async () => {
  await withShell(async ({ t, c, clock, lib }) => {
    const first = await c.get("/sitemap.xml")
    assert.ok(!first.text.includes(`/novel/${lib.aria}/8<`))
    seedChapter(t.db, lib.aria, 8, visible({ title: "Chapter 8", publishedAt: "2026-04-01 00:00:00" }))

    assert.ok(!(await c.get("/sitemap.xml")).text.includes(`/novel/${lib.aria}/8<`), "ทันที: ยังเป็นผลที่เก็บไว้")
    clock.advance(599_000)
    assert.ok(!(await c.get("/sitemap.xml")).text.includes(`/novel/${lib.aria}/8<`), "9 นาที 59 วินาที: ยังไม่หมดอายุ")
    clock.advance(1_000)
    const fresh = await c.get("/sitemap.xml")
    assert.ok(fresh.text.includes(`/novel/${lib.aria}/8<`), "ครบ 10 นาทีพอดี: สร้างใหม่")
    assert.ok(fresh.text.includes("<lastmod>2026-04-01T00:00:00Z</lastmod>"))

    seedChapter(t.db, lib.aria, 9, visible({ title: "Chapter 9", publishedAt: "2026-04-02 00:00:00" }))
    clock.advance(60_000)
    assert.ok(!(await c.get("/sitemap.xml")).text.includes(`/novel/${lib.aria}/9<`), "10 นาทีใหม่นับจากครั้งที่สร้างล่าสุด ไม่ใช่ครั้งแรก")
    clock.advance(9 * 60_000 - 1_000)
    assert.ok(!(await c.get("/sitemap.xml")).text.includes(`/novel/${lib.aria}/9<`), "9 นาที 59 วินาทีนับจากครั้งที่สร้างล่าสุด: ยังไม่หมดอายุ")
    clock.advance(1_000)
    assert.ok((await c.get("/sitemap.xml")).text.includes(`/novel/${lib.aria}/9<`), "ครบ 10 นาทีนับจากครั้งที่สร้างล่าสุด: เห็นตอนที่เพิ่มทีหลัง")
  })
})

test("sitemap.xml: ผลที่เก็บไว้ใช้ร่วมกันได้ทุก Host แต่ URL ในคำตอบตามโฮสต์ของคำขอนั้นๆ (ไม่รั่วข้ามโฮสต์ ไม่เก็บซ้ำต่อโฮสต์)", async () => {
  await withShell(
    async ({ t, lib }) => {
      const a = await rawRequest({ port: t.port, path: "/sitemap.xml", headers: { Host: "a.example" } })
      seedChapter(t.db, lib.aria, 8, visible({ title: "Chapter 8", publishedAt: "2026-04-01 00:00:00" }))
      const b = await rawRequest({ port: t.port, path: "/sitemap.xml", headers: { Host: "b.example" } })
      assert.ok(a.text.includes("<loc>http://a.example/about</loc>") && !a.text.includes("b.example"))
      assert.ok(b.text.includes("<loc>http://b.example/about</loc>") && !b.text.includes("a.example"))
      assert.ok(!b.text.includes(`/novel/${lib.aria}/8<`), "โฮสต์ใหม่ก็ได้ผลที่เก็บไว้ชุดเดียวกัน (ไม่สร้างใหม่ต่อโฮสต์)")
      assert.equal(entriesOf(a.text).length, entriesOf(b.text).length)
    },
    { publicUrl: null },
  )
})

test("sitemap.xml: ไม่เกิน 50,000 URL — หน้าหลัก+ทุกเรื่องมาก่อน ตอนที่เผยแพร่ล่าสุดได้ที่ก่อนตอนเก่า", async () => {
  await withShell(async ({ t, c, lib }) => {
    t.db.run(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50010)
       INSERT INTO chapters (novel_id, number, title, title_th, source_text, translation, status, published, published_at, created_at, updated_at)
       SELECT ?, n + 100, 'c', '', 's', 't', 'done', 1,
              CASE WHEN n <= 30 THEN '2026-04-01 00:00:00' ELSE datetime('2026-04-01 00:00:00', '+' || n || ' seconds') END,
              '2026-01-01 00:00:00', '2026-01-01 00:00:00' FROM seq`,
      lib.plain,
    )
    const r = await c.get("/sitemap.xml")
    assert.equal(r.status, 200)
    assert.equal(count(r.text, /<url>/g), 50_000)
    const locs = new Set(entriesOf(r.text).map((e) => e.loc))
    for (const p of ["/", "/about", "/contact"]) assert.ok(locs.has(`${PUBLIC_URL}${p}`), p)
    for (const n of [lib.aria, lib.plain, lib.evil, lib.empty]) assert.ok(locs.has(`${PUBLIC_URL}/novel/${n}`), `เรื่อง ${n}`)
    const chapter = (n: number) => locs.has(`${PUBLIC_URL}/novel/${lib.plain}/${n + 100}`)
    assert.ok(chapter(50_010), "ตอนใหม่สุดอยู่")
    assert.ok(chapter(31), "ตอนที่ใหม่กว่ากลุ่มเวลาเท่ากันอยู่ครบ")
    // ตอน 1–30 เวลาเผยแพร่เท่ากัน เหลือที่ให้ 13 ตอน: เวลาเท่ากันให้ตอนที่เพิ่มทีหลัง (id สูงกว่า) ก่อน → ตอน 18–30 อยู่ 1–17 ถูกตัด
    assert.ok(chapter(30) && chapter(18), "ตอนในกลุ่มเวลาเท่ากันที่เพิ่มหลังสุดอยู่")
    assert.ok(!chapter(17) && !chapter(1), "ตอนในกลุ่มเวลาเท่ากันที่เพิ่มก่อนถูกตัด")
    assert.ok(!locs.has(`${PUBLIC_URL}/novel/${lib.aria}/0`), "ตอนเก่าจากเรื่องอื่นก็ถูกตัดตามความใหม่")
    assert.ok(r.text.length < 50 * 1024 * 1024)
  })
})

test("sitemap.xml: เรื่องมากเกินเพดานก็ไม่เกิน 50,000 URL — ตัดเรื่องท้ายๆ (id สูง) และไม่เหลือที่ให้ URL ของตอน", async () => {
  await withShell(async ({ t, c, lib }) => {
    t.db.run(
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50010)
       INSERT INTO novels (title, published, created_at, updated_at) SELECT 'n' || n, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00' FROM seq`,
    )
    const firstBulk = lib.empty + 1
    const r = await c.get("/sitemap.xml")
    assert.equal(r.status, 200)
    assert.equal(count(r.text, /<url>/g), 50_000)
    const locs = new Set(entriesOf(r.text).map((e) => e.loc))
    for (const p of ["/", "/about", "/contact"]) assert.ok(locs.has(`${PUBLIC_URL}${p}`), p)
    for (const n of [lib.aria, lib.plain, lib.evil, lib.empty]) assert.ok(locs.has(`${PUBLIC_URL}/novel/${n}`), `เรื่อง ${n}`)
    // เรื่องที่ผู้อ่านเห็นมี 4 + 50,010 เรื่อง: ที่ว่าง 50,000 − 3 = 49,997 เรื่อง → เรื่องจำนวนที่ 49,997 คือ id (firstBulk + 49,992)
    assert.ok(locs.has(`${PUBLIC_URL}/novel/${firstBulk + 49_992}`))
    assert.ok(!locs.has(`${PUBLIC_URL}/novel/${firstBulk + 49_993}`))
    assert.equal(count(r.text, /<loc>[^<]*\/novel\/\d+\/\d+<\/loc>/g), 0, "ไม่มี URL ของตอนเลย")
  })
})

// ═════════════════════════ ไฟล์ใน web/dist · แคช · sw.js ═════════════════════════

test("ไฟล์ใน /assets: Cache-Control public, max-age=31536000, immutable · ชนิดไฟล์ถูก · If-None-Match → 304 · HEAD ได้", async () => {
  await withShell(async ({ c, t }) => {
    const r = await c.get("/assets/a.js")
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable")
    assert.match(r.headers.get("content-type")!, /javascript/)
    assert.equal(r.text, 'console.log("a")\n')
    assert.equal(r.headers.get("x-content-type-options"), "nosniff")

    // `fetch` เติม Cache-Control: no-cache ให้คำขอที่มี If-None-Match เอง จึงต้องส่งผ่าน node:http ตรงๆ เพื่อทดสอบ 304
    const etag = r.headers.get("etag")
    assert.ok(etag)
    const cond = await rawRequest({ port: t.port, path: "/assets/a.js", headers: { "If-None-Match": etag! } })
    assert.equal(cond.status, 304)
    assert.equal(cond.text, "")
    assert.equal(cond.headers["cache-control"], "public, max-age=31536000, immutable")
    assert.equal((await c.raw("/assets/a.js", { method: "HEAD" })).status, 200)
  })
})

test("ไฟล์ราก web/dist (ไอคอน manifest theme-init): ส่งได้ ไม่เก็บแคชยาว (no-cache) · index.html ดิบไม่ถูกเสิร์ฟตรงๆ · ไฟล์ซ่อน (.secret) ไม่ถูกเสิร์ฟ", async () => {
  await withShell(async ({ c }) => {
    const icon = await c.get("/icon.svg")
    assert.equal(icon.status, 200)
    assert.equal(icon.headers.get("cache-control"), "no-cache")
    assert.match(icon.headers.get("content-type")!, /^image\/svg\+xml/)

    const manifest = await c.get("/manifest.webmanifest")
    assert.equal(manifest.status, 200)
    assert.equal(manifest.headers.get("cache-control"), "no-cache")
    assert.match(manifest.headers.get("content-type")!, /manifest\+json|json/)

    const theme = await c.get("/theme-init.js")
    assert.equal(theme.status, 200)
    assert.equal(theme.headers.get("cache-control"), "no-cache")
    assert.match(theme.headers.get("content-type")!, /javascript/)

    for (const p of ["/index.html", "/INDEX.HTML", "/.secret"]) {
      const r = await c.get(p)
      assert.equal(r.status, 404, p)
      assert.equal(titleOf(r.text), NOT_FOUND_TITLE, p)
      assert.ok(!r.text.includes("SECRET-DOTFILE"), p)
    }
    assert.ok(!(await c.get("/index.html")).text.includes("<title>koymukarnnovel</title>"), "แม่แบบดิบไม่หลุดออกมา")
  })
})

test("index.html ดิบไม่ถูกเสิร์ฟผ่านพาธรูปแบบอื่นที่ตัวเสิร์ฟไฟล์ตีความเป็นไฟล์เดียวกัน (// · /./ · /x/../ · %-encode · ตัวพิมพ์ · \\) หรือผ่าน 'ไฟล์เริ่มต้นของโฟลเดอร์'", async () => {
  await withShell(async ({ t }) => {
    const paths = [
      "//index.html", "/./index.html", "/x/../index.html", "/%69ndex.html", "/%2e/index.html", "/INDEX.HTML", "/Index.Html", "/%5Cindex.html", "/index.html/", "/index.html?x=1", "///index.html",
      // พาธที่ชี้ไปที่ตัวโฟลเดอร์ web/dist เอง: ถ้าเปิดไฟล์เริ่มต้นของโฟลเดอร์ (index.html) ไว้ ต้นฉบับดิบจะหลุดออกมาทางนี้
      "///", "/./", "/x/../", "/.", "/x/..",
    ]
    for (const p of paths) {
      const r = await rawRequest({ port: t.port, path: p })
      assert.equal(r.status, 404, p)
      assert.equal(titleOf(r.text), NOT_FOUND_TITLE, `${p}: ได้ shell 404 ไม่ใช่แม่แบบดิบ`)
      assert.ok(!r.text.includes("<title>koymukarnnovel</title>"), p)
    }

    // `//` ตัวจัดเส้นทางของ Express ถือเป็นหน้าแรก (เหมือน /about/ = /about) → ได้ shell หน้าแรกพร้อม meta ครบ ไม่ใช่แม่แบบดิบ
    const home = await rawRequest({ port: t.port, path: "//" })
    assert.equal(home.status, 200)
    assert.equal(titleOf(home.text), `${SITE.siteName} — ${SITE.tagline}`)
    assert.equal(canonicalOf(home.text), `${PUBLIC_URL}/`)
  })
})

test("pointsAtIndexHtml: ตัดสินจากพาธล้วนๆ ไม่พึ่งระบบไฟล์ — รวมแบบที่ Windows/macOS ตีความเป็น index.html (ตัวพิมพ์ใหญ่, \\) ซึ่งทดสอบผ่านเซิร์ฟเวอร์บน Linux ไม่ได้", () => {
  for (const p of [
    "/index.html", "/INDEX.HTML", "/Index.Html", "//index.html", "///index.html", "/./index.html", "/x/../index.html", "/a/b/../../index.html",
    "/%69ndex.html", "/%49NDEX.html", "/%2e/index.html", "/x/%2e%2e/index.html", "/\\index.html", "/%5Cindex.html", "/x\\..\\index.html", "/X%5C..%5CINDEX.HTML",
  ]) {
    assert.equal(pointsAtIndexHtml(p), true, p)
  }
  for (const p of ["/", "/about", "/index.htm", "/index.html.map", "/xindex.html", "/.index.html", "/x/index.html", "/assets/index.html", "/index.html/x", "/index", "/novel/1/index.html", "/theme-init.js"]) {
    assert.equal(pointsAtIndexHtml(p), false, p)
  }
})

test("ขอไฟล์นอก web/dist ด้วย .. (ดิบ/เข้ารหัส %2e %2f) ไม่ได้ — ไม่มีเนื้อไฟล์ลับหลุด", async () => {
  await withShell(async ({ t }) => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt", "/assets/..%2f..%2fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/assets/..%5c..%5csecret.txt"]) {
      const r = await rawRequest({ port: t.port, path: p })
      assert.ok(!r.text.includes("SECRET-OUTSIDE-DIST"), p)
      assert.ok(!r.text.includes("SECRET-DOTFILE"), p)
      assert.equal(r.status, 404, p)
    }
  })
})

test("sw.js: แทน __BUILD_ID__ ทุกตัวด้วยแฮช 12 หลักของ index.html · no-cache · text/javascript · เปลี่ยน index.html → เลขรุ่นเปลี่ยน", async () => {
  await withShell(async ({ c, dist }) => {
    const r = await c.get("/sw.js")
    assert.equal(r.status, 200)
    assert.equal(r.headers.get("cache-control"), "no-cache")
    assert.match(r.headers.get("content-type")!, /^text\/javascript; charset=utf-8$/i)
    const id = crypto.createHash("sha256").update(TEMPLATE).digest("hex").slice(0, 12)
    assert.equal(r.text, `const CACHE = "kn-${id}"\nconst again = "${id}"\n`)
    assert.ok(!r.text.includes("__BUILD_ID__"))
    assert.equal((await c.get("/sw.js")).text, r.text, "คำขอซ้ำได้เลขเดิม")
    assert.equal((await c.raw("/sw.js", { method: "HEAD" })).status, 200)

    const next = TEMPLATE.replace("a.js", "b.js")
    dist.write("index.html", next, 10)
    const after = await c.get("/sw.js")
    const nextId = crypto.createHash("sha256").update(next).digest("hex").slice(0, 12)
    assert.notEqual(nextId, id)
    assert.equal(after.text, `const CACHE = "kn-${nextId}"\nconst again = "${nextId}"\n`)
  })
})

test("sw.js ไม่มีไฟล์ใน dist → 404 JSON ไทย · ไม่มี dist ทั้งโฟลเดอร์ → 503 (ไม่ใช่ 404: เบราว์เซอร์จะไม่ถอด service worker ทิ้งเมื่อกำลัง build)", async () => {
  await withShell(async ({ c, dist }) => {
    dist.remove("sw.js")
    const r = await c.get("/sw.js")
    assert.equal(r.status, 404)
    assert.equal(r.json.code, "not_found")
    assert.match(r.json.error, THAI)
  })
  await withShell(
    async ({ c }) => {
      const r = await c.get("/sw.js")
      assert.equal(r.status, 503)
      assert.equal(r.json.code, "web_not_built")
      assert.match(r.json.error, /npm run build/)
    },
    { dist: false },
  )
})

test("sw.js อ่านไม่ได้ด้วยเหตุอื่นที่ไม่ใช่ 'ไม่มีไฟล์' (เป็นโฟลเดอร์) → 500 JSON ทั่วไป + บันทึก error (ไม่ปลอมเป็น 404 ที่เบราว์เซอร์ตีความว่าเลิกใช้ service worker)", async () => {
  await withShell(
    async ({ c, t, dist }) => {
      dist.remove("sw.js")
      fs.mkdirSync(path.join(dist.dir, "sw.js"))
      const r = await c.get("/sw.js")
      assert.equal(r.status, 500)
      assert.equal(r.json.code, "internal_error")
      assert.ok(!JSON.stringify(r.json).includes("EISDIR"), "ไม่รั่วรายละเอียดของระบบไฟล์ไปกับคำตอบ")
      assert.ok(t.logs.some((line) => line.startsWith("error:") && line.includes("/sw.js") && line.includes("EISDIR")), t.logs.join("\n"))

      fs.rmdirSync(path.join(dist.dir, "sw.js"))
      dist.write("sw.js", "const v = '__BUILD_ID__'\n")
      assert.equal((await c.get("/sw.js")).status, 200, "แก้แล้วกลับมาใช้ได้ทันที")
    },
    { expectErrors: true },
  )
})

test("แม่แบบ index.html: อ่านใหม่เมื่อ 'เวลาแก้' หรือ 'ขนาด' อย่างใดอย่างหนึ่งต่างไป · เท่าเดิมทั้งคู่ = ไม่อ่านซ้ำ (ทุกคำขอเสียแค่ stat หนึ่งครั้ง)", async () => {
  await withShell(async ({ c, dist }) => {
    const file = path.join(dist.dir, "index.html")
    const stamp = (sec: number): Date => new Date(Date.UTC(2020, 0, 1, 0, 0, sec))
    const put = (content: string, sec: number): void => {
      fs.writeFileSync(file, content)
      fs.utimesSync(file, stamp(sec), stamp(sec)) // เวลาแก้กำหนดเอง ไม่พึ่งความละเอียดของระบบไฟล์
    }
    const bundle = async (): Promise<string | undefined> => /\/assets\/(\w+)\.js/.exec((await c.get("/")).text)?.[1]

    put(TEMPLATE, 0)
    assert.equal(await bundle(), "a")
    put(TEMPLATE.replace("a.js", "b.js"), 0) // เนื้อหาเปลี่ยนแต่ขนาดและเวลาเท่าเดิม → ตัวตรวจ (ซึ่งดูแค่สองอย่างนี้) ไม่เห็นความต่าง
    assert.equal(await bundle(), "a", "ลายเซ็นเท่าเดิม → ใช้แม่แบบที่เก็บไว้ ไม่อ่านไฟล์ซ้ำ")
    put(TEMPLATE.replace("a.js", "b.js"), 1) // ขนาดเท่าเดิม เวลาต่าง → อ่านใหม่
    assert.equal(await bundle(), "b")
    put(TEMPLATE.replace("a.js", "cc.js"), 1) // เวลาเท่าเดิม ขนาดต่าง → อ่านใหม่
    assert.equal(await bundle(), "cc")
  })
})

test("แม่แบบ index.html ถูกอ่านใหม่เมื่อไฟล์เปลี่ยน (build ใหม่โดยไม่ต้องเริ่มเซิร์ฟเวอร์ใหม่) · ลบแล้ว 503 · คืนมาก็กลับมาใช้ได้", async () => {
  await withShell(async ({ c, dist }) => {
    assert.ok((await c.get("/")).text.includes("/assets/a.js"))
    dist.write("index.html", TEMPLATE.replace("a.js", "b.js"), 10)
    const rebuilt = await c.get("/")
    assert.ok(rebuilt.text.includes("/assets/b.js") && !rebuilt.text.includes("/assets/a.js"))
    assert.ok((await c.get("/nope")).text.includes("/assets/b.js"), "shell 404 ก็ใช้แม่แบบใหม่")

    dist.remove("index.html")
    const gone = await c.get("/")
    assert.equal(gone.status, 503)
    assert.equal((await c.get("/admin/x")).status, 503)

    dist.write("index.html", TEMPLATE, 20)
    const back = await c.get("/")
    assert.equal(back.status, 200)
    assert.ok(back.text.includes("/assets/a.js"))
  })
})

test("แม่แบบที่ใช้ไม่ได้ (ไม่มี </head>) → 503 เหมือนยังไม่ build · ไม่ล้ม", async () => {
  await withShell(async ({ c }) => {
    const r = await c.get("/")
    assert.equal(r.status, 200)
  })
  await withShell(
    async ({ c, t, dist }) => {
      const warns = () => t.logs.filter((line) => line.startsWith("warn:"))
      for (let i = 0; i < 3; i++) {
        const r = await c.get(i === 0 ? "/" : "/about")
        assert.equal(r.status, 503)
        assert.match(r.text, /npm run build/)
      }
      assert.equal(warns().length, 1, `คำขอซ้ำสาเหตุเดิมไม่บันทึกซ้ำ: ${t.logs.join("\n")}`)
      assert.ok(warns()[0]!.includes("index.html") && warns()[0]!.includes("</head>") && warns()[0]!.includes("npm run build"), warns()[0])
      assert.ok(warns()[0]!.includes(path.join(dist.dir, "index.html")), `log บอกพาธเต็มของไฟล์ที่ต้องดู: ${warns()[0]}`)

      dist.write("index.html", TEMPLATE, 10) // build ใหม่ใช้ได้
      assert.equal((await c.get("/")).status, 200)
      assert.equal(warns().length, 1)

      dist.write("index.html", "<html><body>broken</body></html>", 20) // เสียแบบเดิมอีกหลังเคยกลับมาใช้ได้ → บันทึกอีกครั้ง
      assert.equal((await c.get("/")).status, 503)
      assert.equal((await c.get("/")).status, 503)
      assert.equal(warns().length, 2)

      dist.remove("index.html") // เปลี่ยนสาเหตุ → บันทึกใหม่ (ครั้งเดียว)
      assert.equal((await c.get("/")).status, 503)
      assert.equal((await c.get("/")).status, 503)
      assert.equal(warns().length, 3)
      assert.ok(warns()[2]!.includes("ไม่พบ index.html"), warns()[2])
    },
    { files: { "index.html": "<html><body>broken</body></html>" } },
  )
})

test("index.html อ่านไม่ได้ (เป็นโฟลเดอร์) → 503 บอกรหัสข้อผิดพลาดใน log · ไม่ล้ม · แก้แล้วกลับมาใช้ได้", async () => {
  await withShell(async ({ c, t, dist }) => {
    dist.remove("index.html")
    fs.mkdirSync(path.join(dist.dir, "index.html"))
    const r = await c.get("/")
    assert.equal(r.status, 503)
    assert.ok(t.logs.some((line) => line.startsWith("warn:") && line.includes("EISDIR")), t.logs.join("\n"))
    assert.equal((await c.get("/")).status, 503)
    assert.equal(t.logs.filter((line) => line.startsWith("warn:")).length, 1)

    fs.rmdirSync(path.join(dist.dir, "index.html"))
    dist.write("index.html", TEMPLATE)
    assert.equal((await c.get("/")).status, 200)
  })
})

test("ไม่มี web/dist: หน้าเว็บทุกหน้าตอบ 503 HTML ไทยบอกให้ build · robots/sitemap/healthz/API ยังทำงาน · /assets → 404 JSON", async () => {
  await withShell(
    async ({ c, lib }) => {
      for (const p of ["/", "/about", "/contact", `/novel/${lib.aria}`, `/novel/${lib.aria}/1`, "/admin", "/admin/x", "/nope"]) {
        const r = await c.get(p)
        assert.equal(r.status, 503, p)
        assert.match(r.headers.get("content-type")!, /^text\/html; charset=utf-8$/i, p)
        assert.equal(r.headers.get("cache-control"), "no-store", p)
        assert.match(r.text, THAI, p)
        assert.match(r.text, /npm run build/, p)
        assert.ok(!r.text.includes("<script"), p)
        assert.ok(hasNoindex(r.text), `${p}: หน้านี้ไม่ควรถูกเก็บเข้าดัชนีค้นหา`)
      }
      assert.equal((await c.raw("/", { method: "HEAD" })).status, 503)

      assert.equal((await c.get("/robots.txt")).status, 200)
      assert.equal((await c.get("/sitemap.xml")).status, 200)
      assert.equal((await c.get("/healthz")).status, 200)
      assert.equal((await c.get("/api/public/site")).status, 200)
      assert.equal((await c.get("/assets/a.js")).status, 404)
    },
    { dist: false },
  )
})

// ═════════════════════════ สถานะภายใน ═════════════════════════

test("shell อ่านค่าตั้งปัจจุบันทุกคำขอ: เปลี่ยนชื่อเว็บ/สโลแกนแล้วเห็นทันที", async () => {
  await withShell(async ({ t, c }) => {
    t.settings.update({ siteName: "ชื่อใหม่", tagline: "สโลแกนใหม่" })
    const r = await c.get("/")
    assert.equal(titleOf(r.text), "ชื่อใหม่ — สโลแกนใหม่")
    assert.equal(metaOf(r.text, "property", "og:site_name"), "ชื่อใหม่")
  })
})

test("shell ไม่เปลี่ยนข้อมูล: อ่านหน้าทุกแบบแล้วไม่มีแถวใหม่ ไม่นับยอดอ่าน ไม่เรียก AI ไม่มี log", async () => {
  await withShell(async ({ t, c, lib }) => {
    const tables = ["novels", "chapters", "glossary", "covers", "usage", "views", "settings"]
    const snapshot = () => tables.map((name) => t.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${name}`)!.n)
    const before = snapshot()
    const settingsBefore = JSON.stringify(t.db.all("SELECT * FROM settings ORDER BY key"))
    for (const p of ["/", "/about", "/contact", `/novel/${lib.aria}`, `/novel/${lib.aria}/1`, "/nope", "/admin", "/sitemap.xml", "/robots.txt", "/sw.js"]) await c.get(p)
    assert.deepEqual(snapshot(), before)
    assert.equal(JSON.stringify(t.db.all("SELECT * FROM settings ORDER BY key")), settingsBefore)
    assert.deepEqual(t.ai.calls, [])
    assert.deepEqual(t.logs.slice(), [])
  })
})
