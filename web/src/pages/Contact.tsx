import { SiteTextPage } from "./SiteTextPage"

export function Contact() {
  return <SiteTextPage title="ติดต่อ / แจ้งลบเนื้อหา" pick={(site) => site.contactText} emptyTitle="ยังไม่มีช่องทางติดต่อ" emptyHint="เจ้าของเว็บยังไม่ได้ระบุช่องทางติดต่อและแจ้งลบเนื้อหา" />
}
