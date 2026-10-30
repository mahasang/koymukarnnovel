/** ชื่อเรื่องที่แสดงให้ผู้อ่าน: ชื่อไทยก่อน ยังไม่มี (ว่างหรือช่องว่างล้วน) ใช้ชื่อต้นฉบับ — ใช้ร่วมกันทุกหน้า (การ์ด ปก หัวข้อ ชื่อแท็บ) */
export function displayTitle(novel: { title: string; titleTh: string }): string {
  const thai = novel.titleTh.trim()
  return thai !== "" ? thai : novel.title.trim()
}

/** เลขนิยายจาก URL (`/novel/:id`): จำนวนเต็มบวกไม่มีศูนย์นำหน้า 1–9 หลัก; อย่างอื่น → null (ไม่ต้องยิงคำขอไปถามเซิร์ฟเวอร์) */
export function parseNovelId(raw: string | undefined): number | null {
  return raw !== undefined && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null
}
