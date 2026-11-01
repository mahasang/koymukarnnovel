import type { Messages } from "./messages"

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`

export const en: Messages = {
  locale: "en",
  lang: { menuLabel: "Language" },
  time: {
    justNow: "just now",
    minutesAgo: (n) => plural(n, "minute"),
    hoursAgo: (n) => plural(n, "hour"),
    yesterday: "yesterday",
    daysAgo: (n) => plural(n, "day"),
    weeksAgo: (n) => plural(n, "week"),
  },
  errors: {
    title: "Couldn't load this",
    retry: "Try again",
    networkHint: "Check your internet connection and try again.",
    serverHint: "The server is having a temporary problem. Please try again in a moment.",
    /** ข้อความตามรหัสข้อผิดพลาดของเซิร์ฟเวอร์/เว็บ (ภาษาไทยใช้ข้อความจากเซิร์ฟเวอร์ตรงๆ — ดู errorText) */
    byCode: {
      not_found: "We couldn't find what you were looking for.",
      rate_limited: "Too many requests. Please wait a moment and try again.",
      internal_error: "Something went wrong on our side. Please try again later.",
      bad_request: "That request wasn't valid.",
      bad_json: "The data sent was invalid.",
      too_large: "The data sent was too large.",
      unsupported_media_type: "That data type isn't supported.",
      forbidden_origin: "This request isn't allowed.",
      forbidden_host: "This request isn't allowed.",
      method_not_allowed: "This page is read-only.",
      web_not_built: "The site isn't ready yet.",
      network: "Couldn't connect to the server.",
      unknown_reply: "The server sent a reply we couldn't read.",
      http_error: "The server returned an error.",
      load_failed: "Couldn't load the data.",
    },
    crash: { title: "This page couldn't be displayed", message: "An unexpected error occurred. Please reload this page.", reload: "Reload this page" },
  },
  states: { loading: "Loading…" },
  notFound: { title: "Page not found", hint: "The link may have changed, or this page isn't open for reading yet.", home: "Back to home" },
  layout: { skip: "Skip to main content" },
  header: { menuLabel: "Main menu", home: "Home", about: "About", contact: "Contact", admin: "Admin" },
  footer: {
    note: "Novels translated by AI. Rights to the content belong to the original authors.",
    linksLabel: "Footer links",
    menu: "Menu",
    info: "Information",
    home: "Home",
    about: "About this site",
    contact: "Contact / report content for removal",
  },
  search: { placeholder: "Search title, author, category…", label: "Search novels" },
  theme: {
    change: "Change theme",
    menu: "Theme",
    labels: { midnight: "Midnight", paper: "Paper", sepia: "Sepia", black: "Pitch black" },
  },
}
