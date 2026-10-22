import type { Config } from "./config.js"
import type { Db } from "./db.js"
import { badRequest } from "./util/errors.js"
import { normalizeText } from "./util/text.js"

export const ACCENTS = ["default", "violet", "pink", "teal", "amber", "blue"] as const
export type AccentId = (typeof ACCENTS)[number]

export interface SiteSettings {
  siteName: string
  tagline: string
  aboutText: string
  contactText: string
  accent: AccentId
  indexable: boolean
  translateModel: string
  recapModel: string
  prices: Record<string, { in: number; out: number }>
}

export interface Settings {
  get(): SiteSettings
  /** ตรวจทั้งชุดก่อน ผิดช่องใดช่องหนึ่งก็ไม่บันทึกอะไรเลย (HttpError 400) คีย์ที่ไม่รู้จักถูกข้าม */
  update(patch: Partial<SiteSettings>): SiteSettings
  /** ค่าภายในของระบบ (เช่น queue_paused_reason) ไม่ปรากฏใน get() ที่ไม่เคยตั้งได้ "" */
  getInternal(key: string): string
  setInternal(key: string, value: string): void
}

const MAX = { siteName: 80, tagline: 160, aboutText: 5000, contactText: 2000, model: 100 } as const
const MODEL_NAME = /^[\w.\-]+$/
const KEYS = ["siteName", "tagline", "aboutText", "contactText", "accent", "indexable", "translateModel", "recapModel", "prices"] as const

const DEFAULT_TAGLINE = "นิยายแปลไทย อ่านสบาย ทุกที่"
const DEFAULT_ABOUT =
  "เว็บนี้รวบรวมนิยายออนไลน์ภาษาอังกฤษที่ผู้ดูแลคัดมา แปลเป็นภาษาไทยด้วย AI ทีละตอน แล้วตรวจก่อนเผยแพร่ " +
  "ผู้อ่านเข้ามาอ่านได้โดยไม่ต้องสมัครสมาชิก ผู้ดูแลแก้ข้อความนี้ได้ในหน้าตั้งค่า"

const isModelName = (v: unknown): v is string => typeof v === "string" && v.length <= MAX.model && MODEL_NAME.test(v)

function parsePrices(v: unknown): SiteSettings["prices"] | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined
  const out: SiteSettings["prices"] = {}
  for (const [model, price] of Object.entries(v)) {
    if (model === "__proto__" || !isModelName(model) || typeof price !== "object" || price === null) return undefined
    const { in: input, out: output } = price as { in?: unknown; out?: unknown }
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
    if (!ok(input) || !ok(output)) return undefined
    out[model] = { in: input, out: output }
  }
  return out
}

type Checked = { [K in keyof SiteSettings]: (v: unknown) => SiteSettings[K] | undefined }

/** ตัวตรวจของแต่ละช่อง: คืนค่าที่ทำความสะอาดแล้ว หรือ undefined ถ้าใช้ไม่ได้ (ใช้ทั้งตอนบันทึกและตอนอ่านค่าเก่า) */
const CHECK: Checked = {
  siteName: (v) => (typeof v === "string" && v.trim() !== "" && v.trim().length <= MAX.siteName ? v.trim() : undefined),
  tagline: (v) => (typeof v === "string" && v.trim().length <= MAX.tagline ? v.trim() : undefined),
  aboutText: (v) => (typeof v === "string" && normalizeText(v).length <= MAX.aboutText ? normalizeText(v) : undefined),
  contactText: (v) => (typeof v === "string" && normalizeText(v).length <= MAX.contactText ? normalizeText(v) : undefined),
  accent: (v) => ACCENTS.find((a) => a === v),
  indexable: (v) => (typeof v === "boolean" ? v : undefined),
  translateModel: (v) => (isModelName(v) ? v : undefined),
  recapModel: (v) => (isModelName(v) ? v : undefined),
  prices: parsePrices,
}

const INVALID: Record<keyof SiteSettings, string> = {
  siteName: `ชื่อเว็บต้องไม่ว่างและยาวไม่เกิน ${MAX.siteName} ตัวอักษร`,
  tagline: `สโลแกนต้องยาวไม่เกิน ${MAX.tagline} ตัวอักษร`,
  aboutText: `ข้อความหน้าเกี่ยวกับต้องยาวไม่เกิน ${MAX.aboutText} ตัวอักษร`,
  contactText: `ข้อความหน้าติดต่อต้องยาวไม่เกิน ${MAX.contactText} ตัวอักษร`,
  accent: `ชุดสีต้องเป็นหนึ่งใน ${ACCENTS.join(", ")}`,
  indexable: "สวิตช์การค้นหาต้องเป็นค่าจริงหรือเท็จ",
  translateModel: `ชื่อโมเดลแปลใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีด และขีดล่าง ยาวไม่เกิน ${MAX.model} ตัวอักษร`,
  recapModel: `ชื่อโมเดลสรุปใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีด และขีดล่าง ยาวไม่เกิน ${MAX.model} ตัวอักษร`,
  prices: "ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป รูปแบบ {\"ชื่อโมเดล\": {\"in\": 3, \"out\": 15}}",
}

/** ข้อความเก็บตรงๆ ส่วน boolean และ object เก็บเป็น JSON */
const serialize = (key: keyof SiteSettings, value: SiteSettings[keyof SiteSettings]): string =>
  key === "indexable" || key === "prices" ? JSON.stringify(value) : (value as string)

function parseStored(key: keyof SiteSettings, raw: string): unknown {
  if (key !== "indexable" && key !== "prices") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function createSettings(db: Db, cfg: Pick<Config, "translateModel" | "recapModel">): Settings {
  const defaults: SiteSettings = {
    siteName: "koymukarnnovel",
    tagline: DEFAULT_TAGLINE,
    aboutText: DEFAULT_ABOUT,
    contactText: "",
    accent: "default",
    indexable: true,
    translateModel: cfg.translateModel,
    recapModel: cfg.recapModel,
    prices: {},
  }
  const upsert = (key: string, value: string) =>
    db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value)

  const get = (): SiteSettings => {
    const rows = db.all<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => "?").join(", ")})`, ...KEYS)
    const stored = new Map(rows.map((r) => [r.key, r.value]))
    const result = { ...defaults } as Record<string, unknown>
    for (const key of KEYS) {
      const raw = stored.get(key)
      // ไม่เคยตั้ง → ค่าเริ่มต้น  ตั้งเป็นค่าว่างเอง → ว่าง  ค่าเก่าที่ผิดรูป (แก้นอกระบบ) → ค่าเริ่มต้น
      if (raw !== undefined) result[key] = CHECK[key](parseStored(key, raw)) ?? defaults[key]
    }
    return result as unknown as SiteSettings
  }

  return {
    get,

    update(patch) {
      if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw badRequest("รูปแบบข้อมูลการตั้งค่าไม่ถูกต้อง")
      const writes: [string, string][] = []
      for (const key of KEYS) {
        if (!Object.hasOwn(patch, key) || patch[key] === undefined) continue
        const clean = CHECK[key](patch[key])
        if (clean === undefined) throw badRequest(INVALID[key])
        writes.push([key, serialize(key, clean)])
      }
      db.tx(() => {
        for (const [key, value] of writes) upsert(key, value)
      })
      return get()
    },

    getInternal: (key) => db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ?? "",
    setInternal: (key, value) => void upsert(key, value),
  }
}
