import { RotateCw, TriangleAlert } from "lucide-react"
import type { ApiError } from "../lib/api"
import { errorHint } from "../lib/errors"

/** สถานะ "ผิดพลาด" พร้อมปุ่มลองใหม่ — ข้อความหลักคือ `error.message` (ภาษาไทยจากเซิร์ฟเวอร์) */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const hint = errorHint(error.status)
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon" aria-hidden="true">
        <TriangleAlert size={26} />
      </div>
      <h2 className="state-title">โหลดข้อมูลไม่สำเร็จ</h2>
      <p className="state-message">{error.message}</p>
      {hint !== null ? <p className="state-hint">{hint}</p> : null}
      {onRetry ? (
        <div className="state-actions">
          <button type="button" className="btn ghost" onClick={onRetry}>
            <RotateCw aria-hidden="true" size={16} />
            ลองใหม่
          </button>
        </div>
      ) : null}
    </div>
  )
}
