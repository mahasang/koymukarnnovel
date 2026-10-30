import { Link } from "react-router"

/** โลโก้ K + ชื่อเว็บ (ใช้คลาส `.logo` ชุดเดียวกับหน้าบ้าน) */
export function AdminBrand({ name, to }: { name: string; to: string }) {
  return (
    <Link to={to} className="logo">
      <span className="mark" aria-hidden="true">
        K
      </span>
      <span className="logo-name">{name}</span>
    </Link>
  )
}
