/** ชื่อเดือนและการเลื่อนปีของวันที่ในแต่ละภาษา — ไทยใช้ พ.ศ. (+543) · อังกฤษและลาวใช้ ค.ศ. */
import type { Locale } from "./types"

export const MONTHS: Record<Locale, readonly string[]> = {
  th: ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  lo: ["ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ", "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ"],
}

export const YEAR_OFFSET: Record<Locale, number> = { th: 543, en: 0, lo: 0 }
