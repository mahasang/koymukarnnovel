/** ชื่อเรื่องที่แสดงให้ผู้อ่าน: ชื่อไทยก่อน ยังไม่มี (ว่างหรือช่องว่างล้วน) ใช้ชื่อต้นฉบับ — ใช้ร่วมกันทุกหน้า (การ์ด ปก หัวข้อ ชื่อแท็บ) */
export function displayTitle(novel: { title: string; titleTh: string }): string {
  const thai = novel.titleTh.trim()
  return thai !== "" ? thai : novel.title.trim()
}
