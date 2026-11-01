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
}
