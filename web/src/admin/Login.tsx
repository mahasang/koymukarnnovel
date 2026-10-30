/** หน้าล็อกอินหลังบ้าน: ช่องรหัสผ่านช่องเดียว (เซิร์ฟเวอร์ไม่มีชื่อผู้ใช้) */
import { useId, useRef, useState, type FormEvent } from "react"
import { Link } from "react-router"
import { useDocumentTitle } from "../lib/useDocumentTitle"
import { useSite } from "../lib/SiteContext"
import { AdminBrand } from "./AdminBrand"
import { attemptLogin } from "./login"

export interface LoginViewProps {
  siteName: string
  password: string
  busy: boolean
  error: string | null
  inputId: string
  errorId: string
  onPassword(value: string): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
  inputRef?: React.Ref<HTMLInputElement>
}

/** ส่วนแสดงผลล้วน (ไม่มี hook) — ทดสอบด้วยการเรียกตรงๆ */
export function LoginView(p: LoginViewProps) {
  return (
    <main className="ad-login">
      <form className="ad-login-card" onSubmit={p.onSubmit} noValidate>
        <AdminBrand name={p.siteName} to="/" />
        <h1 className="ad-login-title">เข้าสู่ระบบหลังบ้าน</h1>
        <div className="ad-field">
          <label htmlFor={p.inputId}>รหัสผ่าน</label>
          <input
            id={p.inputId}
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={p.password}
            readOnly={p.busy}
            aria-invalid={p.error !== null ? true : undefined}
            aria-describedby={p.error !== null ? p.errorId : undefined}
            onChange={(event) => p.onPassword(event.target.value)}
            ref={p.inputRef}
          />
        </div>
        {p.error !== null && (
          <p id={p.errorId} className="ad-login-error" role="alert">
            {p.error}
          </p>
        )}
        <button type="submit" className="btn primary full" disabled={p.busy}>
          {p.busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
        <Link to="/" className="ad-login-back">
          ← กลับหน้าเว็บ
        </Link>
      </form>
    </main>
  )
}

/** `onSuccess` = ล็อกอินผ่านแล้ว (ผู้ใช้ไปตรวจสถานะใหม่และเปิดหลังบ้าน) */
export function Login({ onSuccess }: { onSuccess(): void }) {
  const { site } = useSite()
  useDocumentTitle("เข้าสู่ระบบหลังบ้าน")
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await attemptLogin(password)
    if (result.ok) {
      onSuccess()
      return
    }
    setError(result.message)
    setBusy(false)
    inputRef.current?.focus()
  }

  return (
    <LoginView
      siteName={site?.siteName ?? "koymukarnnovel"}
      password={password}
      busy={busy}
      error={error}
      inputId={inputId}
      errorId={errorId}
      onPassword={setPassword}
      onSubmit={(event) => void submit(event)}
      inputRef={inputRef}
    />
  )
}
