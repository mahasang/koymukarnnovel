import { SiteTextPage } from "./SiteTextPage"

export function Contact() {
  return <SiteTextPage title="ติดต่อ / แจ้งลบเนื้อหา" pick={(site) => site.contactText} emptyTitle="ยังไม่มีช่องทางติดต่อ" emptyHint="เว็บนี้เป็นนิยายที่แปลโดย AI สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม ผู้ถือสิทธิ์ที่ต้องการแจ้งลบหรือแก้ไขเนื้อหาให้ติดต่อเจ้าของเว็บ แต่ตอนนี้เจ้าของเว็บยังไม่ได้ระบุช่องทางติดต่อไว้ในหน้านี้" />
}
