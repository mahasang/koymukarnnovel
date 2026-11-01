/**
 * หน้าตั้งค่า (spec 7.9): เว็บไซต์ (ชื่อ/สโลแกน/เกี่ยวกับ/ติดต่อ/สีเน้น) · การค้นหา · โมเดล · ราคา · เชื่อมต่อ Claude API (ทดสอบ) ·
 * ช่องทางนำเข้าคำแปล (สถานะ + ที่อยู่ + ตัวอย่างคำสั่ง) · สำรองข้อมูล · รหัสผ่าน/คีย์/โทเค็นตั้งผ่าน .env เท่านั้น
 * `SettingsView` ส่วนแสดงผลล้วน (เทสต์ตรงๆ) · `Settings` ดึงค่าและถือสถานะการแก้ ทดสอบ API คัดลอก และบันทึก
 */
import { Download, Palette } from "lucide-react"
import { useRef, useState, type FormEvent } from "react"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { Switch } from "../components/Switch"
import { syncAccent, ACCENT_IDS } from "../lib/accent"
import { ApiError } from "../lib/api"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useFetch } from "../lib/useFetch"
import { admin } from "./adminApi"
import { TextField, useUnsavedGuard } from "./NovelForm"
import {
  ACCENT_LABEL,
  apiKeyNote,
  BACKUP_HREF,
  draftOfSettings,
  fieldFromError,
  firstInvalidId,
  importExamples,
  importStatusNote,
  isDirty,
  MAX,
  MODEL_SUGGESTIONS,
  priceFieldId,
  priceModels,
  settingsChanges,
  testDiffersNote,
  TOKEN_COMMAND,
  validateSettings,
  type PriceDraft,
  type SettingsDraft,
  type SettingsErrors,
} from "./settings-logic"
import type { SettingsDto } from "./types"
import { useMounted } from "./useMounted"

const ICON = 18

const messageOf = (e: unknown): string => (e instanceof ApiError ? e.message : "ทำไม่สำเร็จ ลองอีกครั้ง")

export interface TestState {
  busy: boolean
  result: { ok: boolean; message: string } | null
}

export interface SettingsViewProps {
  /** ค่าที่บันทึกไว้ (สถานะความลับ ที่อยู่นำเข้า และโมเดลสรุปที่ใช้ทดสอบ) */
  settings: SettingsDto
  draft: SettingsDraft
  errors: SettingsErrors
  /** ข้อผิดพลาดของราคาทั้งก้อนจากเซิร์ฟเวอร์ (ไม่ระบุโมเดล) */
  pricesError: string | null
  saving: boolean
  notice: string | null
  error: string | null
  test: TestState
  /** รหัสของข้อความที่เพิ่งคัดลอก (ใช้เปลี่ยนป้ายปุ่ม) · `copyFailed` = คัดลอกอัตโนมัติไม่ได้ */
  copied: string | null
  copyFailed: boolean
  onChange(patch: Partial<SettingsDraft>): void
  onPrice(model: string, patch: Partial<PriceDraft>): void
  onSave(): void
  onTest(): void
  onCopy(key: string, text: string): void
}

/** กรอบคำสั่ง/ข้อความที่คัดลอกได้ (ฟังก์ชันธรรมดา ไม่ใช่คอมโพเนนต์ เพื่อให้เทสต์เดินเข้าไปหาปุ่มได้) */
function codeBlock(p: { id: string; label: string; text: string; copied: string | null; onCopy(key: string, text: string): void }) {
  return (
    <div key={p.id} className="ad-code-box">
      <div className="ad-code-head">
        <span className="ad-code-label">{p.label}</span>
        <button type="button" className="btn ghost sm" data-copy={p.id} onClick={() => p.onCopy(p.id, p.text)}>
          {p.copied === p.id ? "คัดลอกแล้ว" : "คัดลอก"}
        </button>
      </div>
      <pre className="ad-code" tabIndex={0}>
        <code>{p.text}</code>
      </pre>
    </div>
  )
}

export function SettingsView(p: SettingsViewProps) {
  const { settings, draft, errors } = p
  const dirty = isDirty(draftOfSettings(settings), draft)
  const models = priceModels(draft)
  const diff = testDiffersNote(settings.recapModel, draft.recapModel)
  const examples = importExamples(settings.importUrl)

  return (
    <div className="ad-st">
      <div className="ad-ph">
        <div className="ad-ph-text">
          <p className="ad-eyebrow">ระบบ</p>
          <h1>ตั้งค่า</h1>
        </div>
      </div>

      <form
        className="ad-form"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          p.onSave()
        }}
      >
        <section className="ad-panel" aria-labelledby="st-h-site">
          <div className="ad-panel-head">
            <h2 id="st-h-site">เว็บไซต์</h2>
          </div>
          <div className="ad-fields">
            <TextField id="st-siteName" label="ชื่อเว็บ" value={draft.siteName} max={MAX.siteName} required error={errors.siteName} onChange={(siteName) => p.onChange({ siteName })} />
            <TextField id="st-tagline" label="สโลแกน" value={draft.tagline} max={MAX.tagline} error={errors.tagline} hint="บรรทัดสั้นๆ ใต้ชื่อเว็บ (ว่างได้)" onChange={(tagline) => p.onChange({ tagline })} />
            <TextField id="st-aboutText" label="ข้อความหน้าเกี่ยวกับ" value={draft.aboutText} max={MAX.aboutText} rows={6} error={errors.aboutText} onChange={(aboutText) => p.onChange({ aboutText })} />
            <TextField
              id="st-contactText"
              label="ข้อความหน้าติดต่อ / แจ้งลบเนื้อหา"
              value={draft.contactText}
              max={MAX.contactText}
              rows={4}
              error={errors.contactText}
              hint="ช่องทางที่เจ้าของผลงานใช้ติดต่อ เช่น อีเมล — ว่างได้"
              onChange={(contactText) => p.onChange({ contactText })}
            />
            <div className="ad-field">
              <span className="ad-label" id="st-accent-label">
                ชุดสีเน้น
              </span>
              <div className="ad-swatches" role="group" aria-labelledby="st-accent-label">
                {ACCENT_IDS.map((id) => (
                  <button key={id} type="button" className="ad-swatch" data-accent={id} aria-pressed={draft.accent === id} onClick={() => p.onChange({ accent: id })}>
                    <span className="ad-swatch-dot" aria-hidden="true">
                      {id === "default" && <Palette size={16} />}
                    </span>
                    {ACCENT_LABEL[id]}
                  </button>
                ))}
              </div>
              <p className="ad-hint">“ตามธีม” = ใช้สีประจำของแต่ละธีม (ม่วง/ส้ม/น้ำตาล) · สีที่เลือกใช้กับทั้งหน้าบ้านและหลังบ้าน</p>
            </div>
          </div>
        </section>

        <section className="ad-panel" aria-labelledby="st-h-search">
          <div className="ad-panel-head">
            <h2 id="st-h-search">การค้นหา</h2>
          </div>
          <Switch id="st-indexable" checked={draft.indexable} label="ให้เสิร์ชเอนจินค้นเจอ" onChange={(indexable) => p.onChange({ indexable })} />
          <p className="ad-hint">{draft.indexable ? "เปิด: Google และเสิร์ชเอนจินอื่นเก็บหน้านิยายของเว็บนี้ได้" : "ปิด: บอกเสิร์ชเอนจินไม่ให้เก็บหน้าของเว็บนี้ (คนที่มีลิงก์ยังเปิดอ่านได้)"}</p>
        </section>

        <section className="ad-panel" aria-labelledby="st-h-model">
          <div className="ad-panel-head">
            <h2 id="st-h-model">โมเดล</h2>
          </div>
          <div className="ad-fields">
            <TextField
              id="st-translateModel"
              label="โมเดลแปล"
              value={draft.translateModel}
              max={MAX.model}
              required
              list="st-models"
              error={errors.translateModel}
              hint="ใช้แปลทุกตอน — เลือกจากรายการแนะนำหรือพิมพ์ชื่อโมเดลเอง"
              onChange={(translateModel) => p.onChange({ translateModel })}
            />
            <TextField
              id="st-recapModel"
              label="โมเดลสรุป / สกัดคำศัพท์"
              value={draft.recapModel}
              max={MAX.model}
              required
              list="st-models"
              error={errors.recapModel}
              hint="ใช้สรุปเรื่องย่อของตอน กรอกข้อมูลเรื่องด้วย AI และทดสอบการเชื่อมต่อ — เลือกรุ่นเล็กจะประหยัด"
              onChange={(recapModel) => p.onChange({ recapModel })}
            />
            <datalist id="st-models">
              {MODEL_SUGGESTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </section>

        <section className="ad-panel" aria-labelledby="st-h-price">
          <div className="ad-panel-head">
            <h2 id="st-h-price">ราคา (ไม่บังคับ)</h2>
            <p className="ad-panel-sub">ดอลลาร์ต่อ 1 ล้านโทเคน</p>
          </div>
          <p className="ad-hint">กรอกแล้ว Dashboard จะประมาณค่าใช้จ่ายให้ · เว้นว่างทั้งคู่ = ไม่ประมาณ · ดูราคาจริงที่หน้าราคาของ Anthropic</p>
          {p.pricesError !== null && (
            <p className="ad-field-error" role="alert" data-kind="prices-error">
              {p.pricesError}
            </p>
          )}
          <div className="ad-scroll">
            <table className="ad-table ad-ptable">
              <caption className="sr-only">ราคาต่อ 1 ล้านโทเคนของแต่ละโมเดล</caption>
              <thead>
                <tr>
                  <th scope="col">โมเดล</th>
                  <th scope="col">ราคาเข้า (input)</th>
                  <th scope="col">ราคาออก (output)</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const price = draft.prices[model] ?? { in: "", out: "" }
                  const error = errors.prices?.[model]
                  const errorId = `st-price-${model}-error`
                  return (
                    <tr key={model}>
                      <th scope="row" className="ad-pmodel">
                        {model}
                        {error !== undefined && (
                          <span id={errorId} className="ad-field-error" data-kind="price-error">
                            {error}
                          </span>
                        )}
                      </th>
                      <td>
                        <input
                          id={priceFieldId(model, "in")}
                          className="ad-pcell"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`ราคาเข้าของ ${model}`}
                          aria-invalid={error !== undefined ? true : undefined}
                          aria-describedby={error !== undefined ? errorId : undefined}
                          value={price.in}
                          maxLength={12}
                          onChange={(event) => p.onPrice(model, { in: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          id={priceFieldId(model, "out")}
                          className="ad-pcell"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`ราคาออกของ ${model}`}
                          aria-invalid={error !== undefined ? true : undefined}
                          aria-describedby={error !== undefined ? errorId : undefined}
                          value={price.out}
                          maxLength={12}
                          onChange={(event) => p.onPrice(model, { out: event.target.value })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="ad-form-bar">
          <div className="ad-form-bar-main">
            <button type="submit" className="btn primary" disabled={!dirty || p.saving}>
              {p.saving ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
            </button>
            {dirty && !p.saving && <span className="ad-form-note">มีการแก้ไขที่ยังไม่บันทึก</span>}
            {p.notice !== null && (
              <p className="ad-form-note ad-form-ok" role="status">
                {p.notice}
              </p>
            )}
            {p.error !== null && (
              <p className="ad-field-error" role="alert">
                {p.error}
              </p>
            )}
          </div>
        </div>
      </form>

      <section className="ad-panel" aria-labelledby="st-h-api">
        <div className="ad-panel-head">
          <h2 id="st-h-api">เชื่อมต่อ Claude API</h2>
        </div>
        <p className="ad-st-status">
          <span className="ad-pill" data-tone={settings.apiKeySet ? "ok" : "warn"}>
            {settings.apiKeySet ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง"}
          </span>
          <span>{apiKeyNote(settings.apiKeySet)}</span>
        </p>
        <div className="ad-st-actions">
          <button type="button" className="btn ghost" data-act="test-api" disabled={!settings.apiKeySet || p.test.busy} onClick={p.onTest}>
            {p.test.busy ? "กำลังทดสอบ…" : "ทดสอบการเชื่อมต่อ"}
          </button>
          <span className="ad-hint">{`ส่งคำขอสั้นๆ ด้วยโมเดลสรุป (${settings.recapModel})`}</span>
        </div>
        {diff !== null && <p className="ad-hint" data-kind="test-diff">{diff}</p>}
        {p.test.result !== null &&
          (p.test.result.ok ? (
            <p className="ad-notice" role="status" data-kind="test-result">
              {p.test.result.message}
            </p>
          ) : (
            <p className="ad-inline-error" role="alert" data-kind="test-result">
              {p.test.result.message}
            </p>
          ))}
      </section>

      <section className="ad-panel" aria-labelledby="st-h-import">
        <div className="ad-panel-head">
          <h2 id="st-h-import">ช่องทางนำเข้าคำแปล</h2>
        </div>
        <p className="ad-st-status">
          <span className="ad-pill" data-tone={settings.importTokenSet ? "ok" : "warn"}>
            {settings.importTokenSet ? "เปิดใช้อยู่" : "ปิดอยู่"}
          </span>
          <span>{importStatusNote(settings.importTokenSet)}</span>
        </p>
        <p className="ad-hint">ไว้ให้ผู้แปลภายนอก (เช่น Claude Code ในเครื่อง) ส่งคำแปลกลับเข้าเว็บโดยไม่ผ่านคิวและไม่เสียค่า API — ช่องทางนี้สร้าง ลบ หรือเผยแพร่ตอนไม่ได้ ต้องเปิดตอนในหลังบ้านตรวจแล้วกดเผยแพร่เอง</p>
        {!settings.importTokenSet && (
          <div className="ad-st-howto" data-kind="howto">
            <p className="ad-st-step">วิธีเปิดใช้</p>
            <ol className="ad-st-steps">
              <li>สร้างค่าสุ่มยาวๆ ด้วยคำสั่งนี้ในเครื่องที่รันเซิร์ฟเวอร์</li>
              <li>ใส่ค่าที่ได้ในไฟล์ .env เป็นบรรทัด IMPORT_TOKEN=ค่าที่ได้ (ต้องยาวอย่างน้อย 24 ตัวอักษร)</li>
              <li>รีสตาร์ทเซิร์ฟเวอร์</li>
            </ol>
            {codeBlock({ id: "token-command", label: "สร้างค่าสุ่ม", text: TOKEN_COMMAND, copied: p.copied, onCopy: p.onCopy })}
          </div>
        )}
        {codeBlock({ id: "import-url", label: "ที่อยู่ของช่องทางนำเข้า", text: settings.importUrl, copied: p.copied, onCopy: p.onCopy })}
        {examples.map((example, index) => codeBlock({ id: `import-example-${index}`, label: `ตัวอย่าง: ${example.label}`, text: example.command, copied: p.copied, onCopy: p.onCopy }))}
        <p className="ad-hint">แทน YOUR_TOKEN ด้วยค่า IMPORT_TOKEN ใน .env ของเซิร์ฟเวอร์ · เลข 1 ในที่อยู่คือรหัสเรื่องและเลขตอน</p>
        {p.copyFailed && (
          <p className="ad-inline-error" role="alert" data-kind="copy-failed">
            คัดลอกอัตโนมัติไม่ได้ในเบราว์เซอร์นี้ — เลือกข้อความในกรอบแล้วคัดลอกเอง
          </p>
        )}
      </section>

      <section className="ad-panel" aria-labelledby="st-h-backup">
        <div className="ad-panel-head">
          <h2 id="st-h-backup">สำรองข้อมูล</h2>
        </div>
        <p className="ad-hint">ดาวน์โหลดไฟล์ฐานข้อมูล koymukarnnovel-ปีเดือนวัน-เวลา.db ที่สอดคล้องกันแม้ระบบกำลังแปลอยู่ — เก็บไว้ที่ปลอดภัย (ในไฟล์มีเนื้อหาทั้งหมดและการตั้งค่าของเว็บ ไม่มีรหัสผ่าน คีย์ API หรือโทเค็น)</p>
        <div className="ad-st-actions">
          <a className="btn ghost" href={BACKUP_HREF} download data-act="backup">
            <Download size={ICON} aria-hidden="true" />
            ดาวน์โหลดไฟล์สำรอง
          </a>
        </div>
      </section>

      <p className="ad-note" data-kind="env-note">
        รหัสผ่านผู้ดูแล, ANTHROPIC_API_KEY และ IMPORT_TOKEN ตั้งผ่านตัวแปรสภาพแวดล้อม (ไฟล์ .env) เท่านั้น ไม่เก็บในฐานข้อมูลและแก้จากหน้านี้ไม่ได้
      </p>
    </div>
  )
}

// ───────────────────────── ตัวถือสถานะ ─────────────────────────

/** คัดลอกข้อความลงคลิปบอร์ด: ใช้ API สมัยใหม่ก่อน (ต้องเป็น https หรือ localhost) ไม่ได้ก็ลองวิธีเก่า · คืน false ถ้าไม่สำเร็จ */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // ลองวิธีเก่าต่อ
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

function SettingsEditor({ initial }: { initial: SettingsDto }) {
  const mounted = useMounted()
  const busy = useRef(false)
  const testing = useRef(false)
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(() => draftOfSettings(initial))
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [pricesError, setPricesError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ busy: false, result: null })
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)

  const dirty = isDirty(draftOfSettings(saved), draft)
  useUnsavedGuard(dirty && !saving)
  useDocumentTitle("ตั้งค่า")

  const edited = (): void => {
    setNotice(null)
    setError(null)
  }

  async function save(): Promise<void> {
    if (busy.current) return
    const found = validateSettings(draft)
    setErrors(found)
    setPricesError(null)
    edited()
    const target = firstInvalidId(found, draft)
    if (target !== null) {
      document.getElementById(target)?.focus()
      return
    }
    const patch = settingsChanges(saved, draft)
    if (Object.keys(patch).length === 0) return
    const submitted = draft
    busy.current = true
    setSaving(true)
    try {
      const server = await admin.putSettings(patch)
      if (!mounted.current) return
      setSaved(server)
      // ช่องที่พิมพ์เพิ่มระหว่างรอไม่ถูกทับ (ไม่ได้พิมพ์เพิ่ม → ใช้ค่าที่เซิร์ฟเวอร์ตอบ เช่นข้อความที่จัดรูปแล้ว)
      setDraft((current) => (current === submitted ? draftOfSettings(server) : current))
      syncAccent(document.documentElement, server.accent)
      setNotice("บันทึกการตั้งค่าแล้ว")
    } catch (e) {
      if (!mounted.current) return
      const field = fieldFromError(e)
      if (field === null) setError(messageOf(e))
      else if (field.field === "prices") setPricesError(field.message)
      else if (field.field === "accent" || field.field === "indexable") setError(field.message)
      else {
        setErrors({ [field.field]: field.message })
        document.getElementById(`st-${field.field}`)?.focus()
      }
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function runTest(): Promise<void> {
    if (testing.current) return
    testing.current = true
    setTest({ busy: true, result: null })
    try {
      const result = await admin.testApi()
      if (mounted.current) setTest({ busy: false, result })
    } catch (e) {
      if (mounted.current) setTest({ busy: false, result: { ok: false, message: messageOf(e) } })
    } finally {
      testing.current = false
    }
  }

  async function copy(key: string, text: string): Promise<void> {
    const ok = await copyText(text)
    if (!mounted.current) return
    setCopied(ok ? key : null)
    setCopyFailed(!ok)
  }

  return (
    <SettingsView
      settings={saved}
      draft={draft}
      errors={errors}
      pricesError={pricesError}
      saving={saving}
      notice={notice}
      error={error}
      test={test}
      copied={copied}
      copyFailed={copyFailed}
      onChange={(patch) => {
        edited()
        setDraft((current) => ({ ...current, ...patch }))
        const keys = Object.keys(patch)
        setErrors((current) => {
          const next = { ...current }
          for (const key of keys) delete next[key as keyof SettingsErrors]
          return next
        })
      }}
      onPrice={(model, patch) => {
        edited()
        setPricesError(null)
        setDraft((current) => ({ ...current, prices: { ...current.prices, [model]: { ...(current.prices[model] ?? { in: "", out: "" }), ...patch } } }))
        setErrors((current) => {
          if (current.prices?.[model] === undefined) return current
          const { [model]: _gone, ...rest } = current.prices
          return { ...current, prices: Object.keys(rest).length > 0 ? rest : undefined }
        })
      }}
      onSave={() => void save()}
      onTest={() => void runTest()}
      onCopy={(key, text) => void copy(key, text)}
    />
  )
}

/** หน้าของเส้นทาง `/admin/settings` */
export function Settings() {
  const { data, error, reload } = useFetch("admin:settings-page", () => admin.settings())
  useDocumentTitle("ตั้งค่า")
  if (data === null) {
    return error !== null ? (
      <ErrorState error={error} onRetry={reload} />
    ) : (
      <>
        <div className="ad-ph">
          <div className="ad-ph-text">
            <p className="ad-eyebrow">ระบบ</p>
            <h1>ตั้งค่า</h1>
          </div>
        </div>
        <Skeleton variant="lines" />
      </>
    )
  }
  return <SettingsEditor initial={data} />
}
