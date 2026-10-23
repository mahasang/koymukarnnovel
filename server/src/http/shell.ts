import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import express, { Router, type Request, type Response } from "express"
import type { AppDeps } from "../app.js"
import { VISIBLE_SQL } from "../chapters.js"
import type { Config } from "../config.js"
import type { AccentId, SiteSettings } from "../settings.js"
import { HttpError, notFound } from "../util/errors.js"
import type { Logger } from "../util/log.js"
import { escapeHtml, truncate } from "../util/text.js"
import { isAdminRequest } from "./admin/auth.js"
import { coverVersion } from "./dto.js"
import { parseIdParam, parseNumberParam } from "./validate.js"

/**
 * หน้าเว็บของผู้อ่าน (SPA shell) + SEO · `renderShell` เป็นฟังก์ชันล้วน ส่วน `createShellRouter` ต่อท้ายสุดของแอป
 * ใส่ `<title>` / description / canonical / Open Graph / Twitter ลงใน `<head>` ของ `web/dist/index.html` ทุกคำขอ
 * (ค่าทุกตัวผ่าน `escapeHtml` — ชื่อเรื่องและเรื่องย่อมาจากผู้ใช้) แล้วให้ React รับช่วงต่อฝั่งเบราว์เซอร์
 * ไม่มีสคริปต์ inline (CSP ห้าม) · ไม่ฝังเนื้อหาตอนลงหน้า · ไม่นับยอดอ่านและไม่เขียนอะไรลงฐานข้อมูล
 */

// ═════════════════════════ ใส่ meta ลงแม่แบบ ═════════════════════════

export interface ShellMeta {
  title: string
  description: string
  /** URL สมบูรณ์ของหน้านี้ · ว่าง = ไม่ใส่ `<link rel="canonical">` และ `og:url` (หน้า 404 / หลังบ้าน) */
  canonical: string
  /** URL รูปปกสมบูรณ์ · ไม่ส่ง = ไม่มี `og:image` และ `twitter:card` เป็น `summary` */
  image?: string
  noindex: boolean
  accent: AccentId
  siteName: string
  /** ค่าเริ่มต้น `website` */
  type?: "website" | "book" | "article"
}

const HEAD_END = /<\/head\s*>/i

/** แอตทริบิวต์ของแท็กเดียว (ชื่อตัวพิมพ์เล็ก → ค่า) อ่านทั้งแบบมีเครื่องหมายคำพูดคู่/เดี่ยวและไม่มี · ลำดับใดก็ได้ */
function attributesOf(tag: string): Map<string, string> {
  const out = new Map<string, string>()
  // ชื่อแท็ก (`meta`) ถูกอ่านเป็นแอตทริบิวต์ที่ไม่มีค่าไปด้วย ซึ่งไม่ชนกับชื่อที่เราค้น (name / property / rel)
  for (const m of tag.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out.set((m[1] as string).toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "")
  }
  return out
}

/** meta ที่ shell เป็นเจ้าของเอง: ถ้าแม่แบบมีอยู่แล้วต้องเอาออกก่อน ไม่งั้นหน้าเดียวมีสองค่าที่ขัดกัน */
function isManagedMeta(tag: string): boolean {
  const a = attributesOf(tag)
  const name = (a.get("name") ?? "").toLowerCase()
  const property = (a.get("property") ?? "").toLowerCase()
  return name === "description" || name === "robots" || name.startsWith("twitter:") || property.startsWith("og:")
}

const isCanonicalLink = (tag: string): boolean =>
  (attributesOf(tag).get("rel") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .includes("canonical")

function withoutManagedTags(head: string): string {
  return head
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, (tag) => (isManagedMeta(tag) ? "" : tag))
    .replace(/<link\b[^>]*>/gi, (tag) => (isCanonicalLink(tag) ? "" : tag))
}

/** `data-accent` บน `<html>`: ชุดสีเริ่มต้นไม่ใส่อะไร (และล้างค่าเก่าที่ค้างในแม่แบบ) · ต่อท้ายแอตทริบิวต์เดิมโดยไม่แตะของเดิม */
function withAccent(head: string, accent: AccentId): string {
  return head.replace(/<html\b([^>]*)>/i, (_tag, attributes: string) => {
    const kept = attributes.replace(/\sdata-accent\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    return `<html${kept}${accent === "default" ? "" : ` data-accent="${escapeHtml(accent)}"`}>`
  })
}

/**
 * แทนที่ meta เดิมของแม่แบบด้วยชุดของหน้านี้ ใส่ก่อน `</head>` · ส่วนอื่นของแม่แบบคงเดิมทุกตัวอักษร
 * (ต่อสตริงจากชิ้นที่ตัดไว้ ไม่ใช้ `String.replace` กับค่าที่ฝัง จึงไม่มีแบบแผนพิเศษอย่าง `$&` มาตีความ)
 * แม่แบบที่ไม่มี `</head>` ใช้ไม่ได้ → throw
 */
export function renderShell(template: string, meta: ShellMeta): string {
  const end = HEAD_END.exec(template)
  if (end === null) throw new Error("แม่แบบหน้าเว็บ (index.html) ไม่มี </head> จึงใส่ meta ไม่ได้")

  const e = escapeHtml
  const tags = [
    `<title>${e(meta.title)}</title>`,
    `<meta name="description" content="${e(meta.description)}">`,
    meta.canonical !== "" ? `<link rel="canonical" href="${e(meta.canonical)}">` : "",
    meta.noindex ? '<meta name="robots" content="noindex">' : "",
    `<meta property="og:title" content="${e(meta.title)}">`,
    `<meta property="og:description" content="${e(meta.description)}">`,
    `<meta property="og:type" content="${e(meta.type ?? "website")}">`,
    meta.canonical !== "" ? `<meta property="og:url" content="${e(meta.canonical)}">` : "",
    meta.image ? `<meta property="og:image" content="${e(meta.image)}">` : "",
    `<meta property="og:site_name" content="${e(meta.siteName)}">`,
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}">`,
  ]
  const head = withAccent(withoutManagedTags(template.slice(0, end.index)), meta.accent)
  return head + tags.join("") + template.slice(end.index)
}

// ═════════════════════════ อ่านแม่แบบจาก web/dist ═════════════════════════

type Template = { ok: true; html: string; buildId: string } | { ok: false; reason: string }

const errorCode = (err: unknown): string => (Object(err) as NodeJS.ErrnoException).code ?? "?"

/**
 * อ่าน `index.html` ใหม่เมื่อไฟล์เปลี่ยน (เวลาแก้ + ขนาด) — build ใหม่แล้วไม่ต้องเริ่มเซิร์ฟเวอร์ใหม่ · ทุกคำขอเสียแค่ `stat` หนึ่งครั้ง
 * `buildId` = SHA-256 ของไฟล์ 12 ตัวแรก (เลขรุ่นของ service worker) · ไม่มีไฟล์/อ่านไม่ได้/ไม่มี `</head>` = ใช้ไม่ได้ (503)
 * และบันทึก `warn` ครั้งเดียวต่อสาเหตุ (คำขอที่ตามมาไม่ท่วม log) · เมื่อกลับมาใช้ได้แล้วล้มอีกจะบันทึกใหม่
 */
function createTemplateLoader(indexFile: string, log: Logger): () => Template {
  let key = ""
  let current: Template = { ok: false, reason: "" }
  let warned = ""

  /** `signature` = ลายเซ็นของไฟล์ที่ได้ผลนี้ (ไม่อ่านซ้ำจนกว่าไฟล์จะเปลี่ยน) · ไม่ส่ง = ลองใหม่ทุกคำขอ (ไฟล์หาย/อ่านไม่ได้ชั่วคราว) */
  const set = (next: Template, signature = ""): void => {
    current = next
    key = signature
  }

  return () => {
    try {
      const stat = fs.statSync(indexFile, { throwIfNoEntry: false })
      if (stat === undefined) {
        set({ ok: false, reason: "ไม่พบ index.html" })
      } else if (`${stat.mtimeMs}:${stat.size}` !== key) {
        const raw = fs.readFileSync(indexFile)
        const html = raw.toString("utf8")
        set(
          HEAD_END.test(html)
            ? { ok: true, html, buildId: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12) }
            : { ok: false, reason: "index.html ไม่มี </head>" },
          `${stat.mtimeMs}:${stat.size}`,
        )
      }
    } catch (err) {
      set({ ok: false, reason: `อ่าน index.html ไม่ได้ (${errorCode(err)})` })
    }
    if (current.ok) {
      warned = ""
    } else if (current.reason !== warned) {
      warned = current.reason
      log.warn(`หน้าเว็บยังใช้ไม่ได้: ${current.reason} (${indexFile}) — ต้องรัน npm run build ก่อน`)
    }
    return current
  }
}

const UNBUILT_MESSAGE = "ยังไม่ได้สร้างหน้าเว็บ (โฟลเดอร์ web/dist) — ผู้ดูแลรัน npm run build ที่โฟลเดอร์โปรเจกต์ แล้วลองใหม่"
const UNBUILT_PAGE =
  '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex"><title>ยังไม่ได้สร้างหน้าเว็บ</title>' +
  "<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;line-height:1.7}" +
  "code{background:#8883;padding:.1em .4em;border-radius:4px}</style></head><body>" +
  "<h1>ยังไม่ได้สร้างหน้าเว็บ</h1>" +
  "<p>เซิร์ฟเวอร์ทำงานอยู่ แต่ยังไม่พบหน้าเว็บที่ build แล้ว (โฟลเดอร์ <code>web/dist</code>)</p>" +
  "<p>ผู้ดูแลระบบ: รัน <code>npm run build</code> ที่โฟลเดอร์โปรเจกต์ แล้วโหลดหน้านี้ใหม่</p></body></html>"

// ═════════════════════════ URL สมบูรณ์ ═════════════════════════

/** ชื่อโฮสต์ (หรือ IPv6 ใน []) + พอร์ตได้ · ตัวอักษรอื่นทั้งหมดถูกปฏิเสธ เพราะค่านี้ไปอยู่ใน canonical / og:url / sitemap */
const HOST_PATTERN = /^(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/
const MAX_HOST_LENGTH = 255

/**
 * ฐานของ URL สมบูรณ์ (ไม่มี `/` ท้าย): `PUBLIC_URL` ถ้าตั้งไว้ ไม่งั้นโฮสต์ของคำขอ (ผ่าน `trust proxy` แล้ว ไม่เชื่อ proxy = ไม่สน X-Forwarded-*)
 * โฮสต์ที่ไม่ใช่รูปชื่อโฮสต์ → `http://localhost:พอร์ต` (หัว Host ปลอมฝังอะไรลงหน้าหรือ sitemap ไม่ได้) · โปรโตคอลมีแค่ https หรือ http
 */
function baseUrlOf(config: Config, req: Request): string {
  if (config.publicUrl !== null) return config.publicUrl
  const host = req.host as string | undefined
  if (host === undefined || host.length > MAX_HOST_LENGTH || !HOST_PATTERN.test(host)) return `http://localhost:${config.port}`
  return `${req.protocol === "https" ? "https" : "http"}://${host}`
}

// ═════════════════════════ ข้อความของหน้า ═════════════════════════

const DESCRIPTION_MAX = 160
const CONTACT_FALLBACK = "ช่องทางติดต่อและแจ้งลบเนื้อหา"

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()

/** คำอธิบายหน้า: ข้อความแรกที่ไม่ว่าง (หลังยุบช่องว่างและขึ้นบรรทัดใหม่เป็นช่องเดียว) ตัดที่ 160 ตัวอักษร · ไม่มีเลย = ว่าง */
function summarize(...candidates: string[]): string {
  for (const text of candidates) {
    const one = collapse(text)
    if (one !== "") return truncate(one, DESCRIPTION_MAX)
  }
  return ""
}

type PageMeta = Pick<ShellMeta, "title" | "description"> & Partial<ShellMeta>

const metaOf = (s: SiteSettings, page: PageMeta): ShellMeta => ({ canonical: "", noindex: !s.indexable, accent: s.accent, siteName: s.siteName, ...page })

/** shell กลางของหน้าที่ไม่มี/ผู้ขอมองไม่เห็น: ไม่มีอะไรเฉพาะเรื่อง (เรื่องซ่อนกับเรื่องไม่มีจึงเหมือนกันทุกตัวอักษร) */
const notFoundMeta = (s: SiteSettings): ShellMeta =>
  metaOf(s, { title: `ไม่พบหน้านี้ | ${s.siteName}`, description: summarize(s.tagline, s.aboutText, s.siteName), noindex: true })

/** shell กลางที่ผู้ดูแลได้เมื่อเปิดเรื่อง/ตอนที่ผู้อ่านมองไม่เห็น: 200 เพื่อให้หน้าเว็บโหลดตัวอย่างร่างจาก API หลังบ้านเอง */
const draftMeta = (s: SiteSettings): ShellMeta => metaOf(s, { title: s.siteName, description: summarize(s.tagline, s.aboutText, s.siteName), noindex: true })

// ═════════════════════════ sitemap ═════════════════════════

const SITEMAP_TTL_MS = 10 * 60_000
const SITEMAP_MAX_URLS = 50_000
const SITEMAP_STATIC_PAGES = 3
const BASE_TOKEN = "{{BASE}}"
const SQL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** เรื่องที่ผู้อ่านเห็น + เวลาล่าสุดแบบเดียวกับการ์ดใน API สาธารณะ (เวลาเผยแพร่ล่าสุดของตอนที่เห็น ไม่มี = เวลาแก้ของเรื่อง) */
const SITEMAP_NOVELS_SQL = `
  SELECT n.id, COALESCE(MAX(c.published_at), n.updated_at) AS last_update
  FROM novels n
  LEFT JOIN chapters c ON c.novel_id = n.id AND ${VISIBLE_SQL}
  WHERE n.published = 1
  GROUP BY n.id
  ORDER BY n.id`

/** ตอนที่ผู้อ่านเห็น ใหม่สุดก่อน (เมื่อเกินเพดานตอนเก่าสุดถูกตัด) · เวลา = ที่ใหม่กว่าระหว่างเวลาเผยแพร่กับเวลาแก้ */
const SITEMAP_CHAPTERS_SQL = `
  SELECT c.novel_id, c.number, MAX(COALESCE(c.published_at, ''), c.updated_at) AS last_update
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE ${VISIBLE_SQL}
  ORDER BY last_update DESC, c.id DESC
  LIMIT ?`

/** เวลาในฐานข้อมูล (UTC `YYYY-MM-DD HH:MM:SS`) เป็น ISO 8601 ของ sitemap · รูปแบบอื่น (แก้นอกระบบ) ไม่ใส่ lastmod ดีกว่าทำ XML เสีย */
const lastmodOf = (v: string | null): string | null => (v !== null && SQL_TIME.test(v) ? `${v.replace(" ", "T")}Z` : null)

const urlEntry = (loc: string, lastmod: string | null): string =>
  `<url><loc>${BASE_TOKEN}${loc}</loc>${lastmod === null ? "" : `<lastmod>${lastmod}</lastmod>`}</url>`

// ═════════════════════════ router ═════════════════════════

interface NovelPageRow {
  id: number
  title: string
  title_th: string
  synopsis: string
  cover_updated_at: string | null
}
interface ChapterPageRow extends NovelPageRow {
  number: number
  chapter_title: string
  chapter_title_th: string
}

const COVER_SQL = "(SELECT cv.updated_at FROM covers cv WHERE cv.novel_id = n.id) AS cover_updated_at"
const NOVEL_PAGE_SQL = `SELECT n.id, n.title, n.title_th, n.synopsis, ${COVER_SQL} FROM novels n WHERE n.id = ? AND n.published = 1`
const CHAPTER_PAGE_SQL = `
  SELECT n.id, n.title, n.title_th, n.synopsis, ${COVER_SQL}, c.number, c.title AS chapter_title, c.title_th AS chapter_title_th
  FROM chapters c JOIN novels n ON n.id = c.novel_id
  WHERE c.novel_id = ? AND c.number = ? AND ${VISIBLE_SQL}`

const INDEX_HTML_PATH = "/index.html"

/** พาธนี้ (ถอดรหัส % รวมเครื่องหมาย `\` และ `.`/`..` แบบที่ตัวเสิร์ฟไฟล์ทำ) ชี้ไปที่ index.html หรือไม่ — ตัวดิบต้องไม่หลุดออกไปซ้ำกับหน้าแรก */
export function pointsAtIndexHtml(urlPath: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return false // ถอดรหัสไม่ได้ ตัวเสิร์ฟไฟล์ปฏิเสธเอง
  }
  return path.posix.normalize(`/${decoded.replaceAll("\\", "/")}`).toLowerCase() === INDEX_HTML_PATH
}

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
const REVALIDATE_CACHE = "no-cache"
const ADMIN_CACHE = "private, no-store"

/**
 * หน้าเว็บทั้งหมด (ต่อท้ายสุดของ `createApp` หลัง API ทุกเส้น): robots.txt · sitemap.xml · sw.js · หน้าอ่าน · หลังบ้าน · ไฟล์ใน `web/dist` · 404
 * รับเฉพาะ GET/HEAD · ผู้อ่านได้ `no-cache` + ETag (ถามซ้ำทุกครั้งแต่ได้ 304 ถ้าไม่เปลี่ยน) · เรื่อง/ตอนที่ซ่อน ไม่มี หรือพารามิเตอร์ผิดรูป
 * ตอบ shell 404 ตัวเดียวกันทุกตัวอักษร (เดาไม่ได้ว่ามีเรื่องซ่อนอยู่) · ผู้ดูแลได้ 200 ทุกกรณี (`private, no-store`) เพื่อดูตัวอย่างร่างได้
 * ยังไม่มี `web/dist` → หน้าเว็บทุกหน้า 503 บอกให้ build (robots/sitemap/API ยังใช้ได้)
 */
export function createShellRouter(deps: AppDeps): Router {
  const { config, db, settings, log } = deps
  const router = Router()
  const template = createTemplateLoader(path.join(config.webDist, "index.html"), log)

  const sendPage = (res: Response, status: number, meta: ShellMeta, cache: string = REVALIDATE_CACHE): void => {
    const t = template()
    if (!t.ok) {
      res.status(503).type("html").set("Cache-Control", "no-store").send(UNBUILT_PAGE)
      return
    }
    res.status(status).type("html").set("Cache-Control", cache).send(renderShell(t.html, meta))
  }

  /** `meta` = หน้าที่มีอยู่และผู้อ่านเห็น · null = ซ่อน/ไม่มี/ผิดรูป (ผู้อ่านได้ 404 กลาง ผู้ดูแลได้ 200 กลาง) */
  const sendReaderPage = (req: Request, res: Response, found: (s: SiteSettings, base: string) => ShellMeta | null): void => {
    res.vary("Cookie")
    const admin = isAdminRequest(deps, req)
    const s = settings.get()
    const meta = found(s, baseUrlOf(config, req))
    const cache = admin ? ADMIN_CACHE : REVALIDATE_CACHE
    if (meta !== null) sendPage(res, 200, meta, cache)
    else if (admin) sendPage(res, 200, draftMeta(s), cache)
    else sendPage(res, 404, notFoundMeta(s), cache)
  }

  const novelMeta = (s: SiteSettings, base: string, row: NovelPageRow, extra: Partial<ShellMeta> = {}): ShellMeta => {
    const version = coverVersion(row.cover_updated_at)
    return metaOf(s, {
      title: `${row.title_th || row.title} | ${s.siteName}`,
      description: summarize(row.synopsis, s.tagline, s.siteName),
      canonical: `${base}/novel/${row.id}`,
      image: version > 0 ? `${base}/covers/${row.id}?v=${version}` : undefined,
      type: "book",
      ...extra,
    })
  }

  // ── เฉพาะอ่านข้อมูล ──
  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") {
      next()
      return
    }
    res.setHeader("Allow", "GET, HEAD")
    next(new HttpError(405, "หน้าเว็บรับเฉพาะการอ่านข้อมูล (GET)", "method_not_allowed"))
  })

  // ── robots.txt / sitemap.xml ──
  router.get("/robots.txt", (req, res) => {
    const body = settings.get().indexable
      ? `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${baseUrlOf(config, req)}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n"
    res.type("text/plain").set("Cache-Control", REVALIDATE_CACHE).send(body)
  })

  // ผลเก็บเป็นข้อความที่มีตัวแทน {{BASE}} แทนฐาน URL แล้วแทนตอนส่ง: โฮสต์ที่ต่างกันใช้ผลชุดเดียวกัน ไม่เก็บซ้ำต่อโฮสต์
  let sitemap: { builtAt: number; xml: string } | null = null
  const buildSitemap = (): string => {
    const novels = db.all<{ id: number; last_update: string | null }>(SITEMAP_NOVELS_SQL).slice(0, SITEMAP_MAX_URLS - SITEMAP_STATIC_PAGES)
    const chapters = db.all<{ novel_id: number; number: number; last_update: string | null }>(
      SITEMAP_CHAPTERS_SQL,
      SITEMAP_MAX_URLS - SITEMAP_STATIC_PAGES - novels.length,
    )
    const newest = novels
      .map((n) => lastmodOf(n.last_update))
      .filter((t): t is string => t !== null)
      .sort()
      .at(-1)
    const entries = [
      urlEntry("/", newest ?? null),
      urlEntry("/about", null),
      urlEntry("/contact", null),
      ...novels.map((n) => urlEntry(`/novel/${n.id}`, lastmodOf(n.last_update))),
      ...chapters.map((c) => urlEntry(`/novel/${c.novel_id}/${c.number}`, lastmodOf(c.last_update))),
    ]
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`
  }
  router.get("/sitemap.xml", (req, res) => {
    if (!settings.get().indexable) throw notFound("ไม่มี sitemap เพราะเว็บปิดไม่ให้เสิร์ชเอนจินค้นเจอ")
    const now = deps.now().getTime()
    if (sitemap === null || now - sitemap.builtAt >= SITEMAP_TTL_MS) sitemap = { builtAt: now, xml: buildSitemap() }
    const base = escapeHtml(baseUrlOf(config, req))
    res.type("application/xml").set("Cache-Control", REVALIDATE_CACHE).send(sitemap.xml.replaceAll(BASE_TOKEN, () => base))
  })

  // ── service worker: ชื่อ cache ผูกกับรุ่นของ build (แฮชของ index.html) ──
  router.get("/sw.js", async (_req, res) => {
    const t = template()
    if (!t.ok) throw new HttpError(503, UNBUILT_MESSAGE, "web_not_built")
    let source: string
    try {
      source = await fs.promises.readFile(path.join(config.webDist, "sw.js"), "utf8")
    } catch (err) {
      if (errorCode(err) === "ENOENT") throw notFound("ไม่พบไฟล์ sw.js")
      throw err
    }
    res.type("text/javascript").set("Cache-Control", REVALIDATE_CACHE).send(source.replaceAll("__BUILD_ID__", () => t.buildId))
  })

  // ── หน้าสำหรับผู้อ่าน ──
  router.get("/", (req, res) => {
    const s = settings.get()
    sendPage(
      res,
      200,
      metaOf(s, {
        title: s.tagline === "" ? s.siteName : `${s.siteName} — ${s.tagline}`,
        description: summarize(s.tagline, s.aboutText, s.siteName),
        canonical: `${baseUrlOf(config, req)}/`,
      }),
    )
  })
  router.get("/about", (req, res) => {
    const s = settings.get()
    sendPage(
      res,
      200,
      metaOf(s, {
        title: `เกี่ยวกับเว็บนี้ | ${s.siteName}`,
        description: summarize(s.aboutText, s.tagline, s.siteName),
        canonical: `${baseUrlOf(config, req)}/about`,
      }),
    )
  })
  router.get("/contact", (req, res) => {
    const s = settings.get()
    sendPage(
      res,
      200,
      metaOf(s, {
        title: `ติดต่อ / แจ้งลบเนื้อหา | ${s.siteName}`,
        description: summarize(s.contactText) || CONTACT_FALLBACK,
        canonical: `${baseUrlOf(config, req)}/contact`,
      }),
    )
  })

  router.get("/novel/:id", (req, res) => {
    sendReaderPage(req, res, (s, base) => {
      const id = parseIdParam(req.params.id)
      const row = id === null ? undefined : db.get<NovelPageRow>(NOVEL_PAGE_SQL, id)
      return row === undefined ? null : novelMeta(s, base, row)
    })
  })

  router.get("/novel/:id/:number", (req, res) => {
    sendReaderPage(req, res, (s, base) => {
      const id = parseIdParam(req.params.id)
      const number = parseNumberParam(req.params.number)
      const row = id === null || number === null ? undefined : db.get<ChapterPageRow>(CHAPTER_PAGE_SQL, id, number)
      if (row === undefined) return null
      const name = row.chapter_title_th || row.chapter_title
      const heading = name === "" ? `ตอนที่ ${row.number}` : `ตอนที่ ${row.number}: ${name}`
      return novelMeta(s, base, row, {
        title: `${heading} — ${row.title_th || row.title} | ${s.siteName}`,
        canonical: `${base}/novel/${row.id}/${row.number}`,
        type: "article",
      })
    })
  })

  // ── หลังบ้าน: shell เปล่า (ล็อกอินและข้อมูลเป็นหน้าที่ของหน้าเว็บกับ /api/admin) ไม่ให้เสิร์ชเอนจินเก็บ ──
  router.get(["/admin", "/admin/*splat"], (_req, res) => {
    const s = settings.get()
    sendPage(res, 200, metaOf(s, { title: `หลังบ้าน | ${s.siteName}`, description: summarize(s.tagline, s.aboutText, s.siteName), noindex: true }))
  })

  // ── ไฟล์ใน web/dist ──
  // /assets/* ชื่อไฟล์มีแฮชของเนื้อหา → แคชได้ตลอดไป · ไม่พบไฟล์ = 404 แบบ JSON (ไม่ส่ง HTML ของหน้าเว็บไปให้ตัวโหลดสคริปต์/สไตล์ตีความเป็นไฟล์)
  const files = { index: false, redirect: false, dotfiles: "ignore", cacheControl: false } as const
  router.use(
    "/assets",
    express.static(path.join(config.webDist, "assets"), { ...files, setHeaders: (res) => void res.setHeader("Cache-Control", IMMUTABLE_CACHE) }),
    (_req, _res, next) => next(notFound("ไม่พบไฟล์นี้")),
  )
  // ไฟล์ที่ชื่อคงที่ (ไอคอน manifest theme-init) ต้องถามซ้ำทุกครั้ง · index.html ดิบไม่ถูกเสิร์ฟ (ตัวจริงออกทางหน้าเว็บพร้อม meta)
  const rootFiles = express.static(config.webDist, { ...files, setHeaders: (res) => void res.setHeader("Cache-Control", REVALIDATE_CACHE) })
  router.use((req, res, next) => {
    if (pointsAtIndexHtml(req.path)) next()
    else rootFiles(req, res, next)
  })

  // ── ที่เหลือคือหน้าที่ไม่มี ──
  router.use((_req, res) => {
    sendPage(res, 404, notFoundMeta(settings.get()))
  })

  return router
}
