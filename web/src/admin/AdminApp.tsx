// จุดเข้าของหลังบ้านที่ App โหลดแบบ lazy: ไฟล์นี้ผูก CSS หลังบ้านไว้ในก้อนเดียวกัน (ผู้อ่านทั่วไปไม่ต้องโหลดมัน)
// ตรรกะทั้งหมดอยู่ใน AdminShell ซึ่งไม่ import CSS เพื่อให้ node:test โหลดไปทดสอบได้
import "../styles/admin.css"
export { AdminShell as default } from "./AdminShell"
