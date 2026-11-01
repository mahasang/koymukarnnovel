import { useI18n } from "../i18n/I18nProvider"
import { SiteTextPage } from "./SiteTextPage"

export function Contact() {
  const { m } = useI18n()
  return <SiteTextPage title={m.about.contactTitle} pick={(site) => site.contactText} emptyTitle={m.about.contactEmptyTitle} emptyHint={m.about.contactEmptyHint} />
}
