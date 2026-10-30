import { SiteTextPage } from "./SiteTextPage"

export function About() {
  return <SiteTextPage title="เกี่ยวกับเว็บนี้" pick={(site) => site.aboutText} emptyTitle="ยังไม่มีข้อความแนะนำเว็บ" emptyHint="เจ้าของเว็บยังไม่ได้เขียนข้อความในหน้านี้" />
}
