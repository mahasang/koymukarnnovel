import { useI18n } from "../i18n/I18nProvider"
import { SiteTextPage } from "./SiteTextPage"

export function About() {
  const { m } = useI18n()
  return <SiteTextPage title={m.about.aboutTitle} pick={(site) => site.aboutText} emptyTitle={m.about.aboutEmptyTitle} emptyHint={m.about.aboutEmptyHint} />
}
