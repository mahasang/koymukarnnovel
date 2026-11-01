/** ช่องค้นหาในแถบบน: กรอกแล้วกด Enter ไปที่หน้าแรกพร้อมคำค้น (หน้าแรกอ่านพารามิเตอร์ `q` แล้วแสดงเฉพาะผลลัพธ์) */

/** ความยาวคำค้นสูงสุดที่ช่องกรอกรับ */
export const SEARCH_MAX_LENGTH = 100

/**
 * ครึ่งตัวของอักขระสองหน่วย UTF-16 (surrogate เดี่ยว) เกิดได้เมื่อ `maxLength` ตัดกลางอีโมจิ — `encodeURIComponent` โยน URIError กับมัน
 * โหมด `u` ทำให้คู่ที่สมบูรณ์ถูกอ่านเป็นตัวเดียว (ไม่ตรงกับช่วงนี้) จึงจับได้เฉพาะตัวเดี่ยวจริงๆ
 */
const LONE_SURROGATE = /[\u{D800}-\u{DFFF}]/gu
const REPLACEMENT_CHARACTER = "\u{FFFD}"

/** เส้นทางของคำค้น: ตัดช่องว่างหัวท้าย ว่างเปล่า → `/` (ล้างผลค้นหา) · ไม่ว่าง → `/?q=<คำค้นที่เข้ารหัสแล้ว>` */
export function searchPath(query: string): string {
  const text = query.trim().replace(LONE_SURROGATE, REPLACEMENT_CHARACTER)
  return text === "" ? "/" : `/?q=${encodeURIComponent(text)}`
}

/**
 * คำค้นที่ช่องค้นหาแสดง: เฉพาะหน้าแรก (`/`) ที่ URL มี `?q=` · หน้าอื่นว่างเสมอ (ค้นหาเริ่มจากหน้าแรก)
 * คืนข้อความตามที่พิมพ์ ไม่ตัดช่องว่าง — การตัดเป็นหน้าที่ของผู้ใช้ค่า
 */
export function queryOf(pathname: string, search: string): string {
  return pathname === "/" ? (new URLSearchParams(search).get("q") ?? "") : ""
}
