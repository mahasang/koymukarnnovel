/**
 * "ต้นฉบับ" ของนิยาย (ช่อง `sourceUrl` ที่เจ้าของกรอกเอง) → จะแสดงเป็นอะไร
 * เป็นลิงก์ก็ต่อเมื่อขึ้นต้น `http://` หรือ `https://` และมีโฮสต์จริงเท่านั้น (กัน `javascript:`/`data:`/`file:` ฯลฯ ที่กดแล้วรันโค้ด)
 * อย่างอื่นแสดงเป็นข้อความธรรมดา (React escape ให้เสมอ) ไม่เดาเติม https ให้
 */

export type Source = { kind: "none" } | { kind: "text"; text: string } | { kind: "link"; href: string; label: string }

/**
 * ต้องมี `//` ตามด้วยตัวอักษรของโฮสต์ทันที: ตัวแยกวิเคราะห์ URL ของเบราว์เซอร์ผ่อนผัน `https:/x` และ `https:///x`
 * ให้กลายเป็น `https://x/` ซึ่งไม่ใช่สิ่งที่เจ้าของพิมพ์
 */
const HTTP_START = /^https?:\/\/[^\s/?#]/i

export function sourceOf(raw: string): Source {
  const text = raw.trim()
  if (text === "") return { kind: "none" }
  if (HTTP_START.test(text)) {
    try {
      const url = new URL(text)
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "") {
        // ป้ายเป็นชื่อโฮสต์ที่ URL แยกออกมา (หลัง @ ถ้ามีข้อมูลล็อกอิน; โดเมนอักษรอื่นเป็น punycode) ไม่ใช่ข้อความที่พิมพ์
        return { kind: "link", href: url.href, label: url.hostname.replace(/^www\./, "") || url.hostname }
      }
    } catch {
      // โฮสต์ไม่ถูกต้อง (มีช่องว่าง/อักขระต้องห้าม): แสดงเป็นข้อความ
    }
  }
  return { kind: "text", text }
}
