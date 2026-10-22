/**
 * ล้างข้อความที่คัดลอกมาจากเว็บ ตามลำดับ: ลบ BOM/ZWSP → ขึ้นบรรทัดใหม่แบบเดียว (\n)
 * → NBSP/U+2007/U+202F เป็นช่องว่างปกติ → ตัดช่องว่างท้ายบรรทัด
 * → ยุบบรรทัดว่างที่ติดกันเหลือหนึ่งบรรทัด → ตัดหัวท้าย
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[﻿​]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

/** ตัดที่ n code point แล้วต่อ "…" (ถ้าสั้นกว่าหรือเท่ากับ n คืนเดิม) */
export function truncate(s: string, n: number): string {
  const chars = Array.from(s)
  return chars.length <= n ? s : chars.slice(0, n).join("") + "…"
}
