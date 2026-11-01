import { en } from "./en"
import { lo } from "./lo"
import { th } from "./th"
import type { Locale } from "./types"

export type Messages = typeof th

export const MESSAGES: Record<Locale, Messages> = { th, en, lo }
