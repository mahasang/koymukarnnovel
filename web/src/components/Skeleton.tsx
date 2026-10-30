/**
 * โครงจำลองระหว่างโหลด (shimmer วาดด้วย CSS): `grid` = การ์ดปกเรียงเป็นตาราง · `lines` = บรรทัดข้อความ (บรรทัดสุดท้ายสั้นกว่า)
 * ประกาศ "กำลังโหลด…" ให้โปรแกรมอ่านหน้าจอครั้งเดียว ส่วนรูปจำลองทั้งหมดซ่อนจากโปรแกรมอ่านหน้าจอ
 */
export function Skeleton({ variant, count }: { variant: "grid" | "lines"; count?: number }) {
  const total = count ?? (variant === "grid" ? 6 : 4)
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-busy="true">
      <span className="sr-only">กำลังโหลด…</span>
      {Array.from({ length: total }, (_, index) =>
        variant === "grid" ? (
          <div key={index} className="sk-card" aria-hidden="true">
            <div className="sk sk-cover" />
            <div className="sk sk-line" />
            <div className="sk sk-line sk-short" />
          </div>
        ) : (
          <div key={index} className={index === total - 1 ? "sk sk-line sk-short" : "sk sk-line"} aria-hidden="true" />
        ),
      )}
    </div>
  )
}
