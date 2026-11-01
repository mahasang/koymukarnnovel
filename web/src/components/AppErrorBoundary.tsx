/**
 * ตาข่ายสุดท้ายกันหน้าขาว (spec 6.5): หน้าใดเรนเดอร์พังโดยไม่คาดคิด หรือโหลดไฟล์ของหน้าไม่ได้ (เช่น เปิดแท็บค้างไว้ข้ามการอัปเดตเว็บ)
 * ผู้อ่านเห็นข้อความที่เป็นมิตรกับปุ่มโหลดใหม่ แทนหน้าว่างเปล่า · ย้ายไปหน้าอื่น (resetKey เปลี่ยน) ก็ลองใหม่ให้เอง
 * ไม่แสดงรายละเอียดของข้อผิดพลาดให้ผู้อ่าน (React บันทึกไว้ในคอนโซลให้ผู้ดูแลอยู่แล้ว)
 */
import { RotateCw, TriangleAlert } from "lucide-react"
import { Component, type ReactNode } from "react"

export function CrashFallback({ onReload }: { onReload: () => void }) {
  return (
    <div className="wrap">
      <div className="state state-error" role="alert">
        <div className="state-icon" aria-hidden="true">
          <TriangleAlert size={26} />
        </div>
        <h2 className="state-title">หน้านี้แสดงผลไม่สำเร็จ</h2>
        <p className="state-message">เกิดข้อผิดพลาดที่ไม่คาดคิด ลองโหลดหน้านี้ใหม่อีกครั้ง</p>
        <div className="state-actions">
          <button type="button" className="btn ghost" onClick={onReload}>
            <RotateCw aria-hidden="true" size={16} />
            โหลดหน้านี้ใหม่
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  children: ReactNode
  /** เปลี่ยนค่านี้ (เช่น ที่อยู่หน้า) เมื่อมี error อยู่ → ล้าง error แล้วลองเรนเดอร์ใหม่ */
  resetKey: string
  /** ค่าเริ่มต้น = โหลดหน้าเว็บใหม่ทั้งหน้า (ส่งเฉพาะตอนทดสอบ) */
  onReload?: () => void
}

interface State {
  error: Error | null
}

const reloadPage = () => window.location.reload()

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error !== null) return <CrashFallback onReload={this.props.onReload ?? reloadPage} />
    return this.props.children
  }
}
