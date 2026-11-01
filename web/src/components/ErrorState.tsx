import { RotateCw, TriangleAlert } from "lucide-react"
import type { ApiError } from "../lib/api"
import { useI18n } from "../i18n/I18nProvider"
import { MESSAGES } from "../i18n/messages"
import type { Messages } from "../i18n/messages"
import { errorHint, errorText } from "../lib/errors"

/** สถานะ "ผิดพลาด" พร้อมปุ่มลองใหม่ — ข้อความหลักตามภาษาผู้อ่านจากรหัสข้อผิดพลาด (ไทย = ข้อความของเซิร์ฟเวอร์) */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { m } = useI18n()
  return <ErrorStateView error={error} onRetry={onRetry} m={m} />
}

/** ส่วนแสดงผลล้วน (ไม่ใช้ hook — เทสต์เรียกเป็นฟังก์ชันตรงๆ ได้; ไม่ส่ง `m` = ภาษาไทย) */
export function ErrorStateView({ error, onRetry, m = MESSAGES.th }: { error: ApiError; onRetry?: () => void; m?: Messages }) {
  const hint = errorHint(error.status, m)
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon" aria-hidden="true">
        <TriangleAlert size={26} />
      </div>
      <h2 className="state-title">{m.errors.title}</h2>
      <p className="state-message">{errorText(error, m)}</p>
      {hint !== null ? <p className="state-hint">{hint}</p> : null}
      {onRetry ? (
        <div className="state-actions">
          <button type="button" className="btn ghost" onClick={onRetry}>
            <RotateCw aria-hidden="true" size={16} />
            {m.errors.retry}
          </button>
        </div>
      ) : null}
    </div>
  )
}
