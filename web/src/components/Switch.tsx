/** สวิตช์เปิด/ปิด (ใช้ในหน้าตั้งค่าหลังบ้านและที่อื่น) — ปุ่ม `role="switch"`; ป้ายอยู่ในปุ่มจึงกดที่ข้อความได้ด้วย */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} className={checked ? "switch on" : "switch"} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-label">{label}</span>
    </button>
  )
}
