/**
 * ตัวช่วยเทสต์: แยกไฟล์ CSS เป็นกฎ (selector, declaration, เงื่อนไข @media) เพื่อตรวจไฟล์สไตล์โดยไม่ต้องมีเบราว์เซอร์
 * รองรับเฉพาะ CSS ที่เขียนในโปรเจกต์นี้: กฎแบนๆ, @media หนึ่งชั้น, @keyframes (ข้ามเนื้อใน), @import (ข้าม) — ไม่ใช่ตัวแยก CSS ทั่วไป
 * import เฉพาะจากไฟล์เทสต์ ไม่เป็นส่วนของหน้าเว็บ
 */

export interface CssRule {
  /** selector ทีละตัว (แยกด้วย , แล้ว) ช่องว่างซ้อนถูกยุบเป็นช่องว่างเดียว */
  selectors: string[]
  /** ชื่อ declaration (ตัวพิมพ์เล็ก) → ค่า (ช่องว่างซ้อนถูกยุบ) · ประกาศซ้ำในกฎเดียวกัน ตัวหลังชนะ */
  decls: Record<string, string>
  /** เงื่อนไขของ @media ที่ครอบอยู่ เช่น `(max-width: 719px)` · ไม่อยู่ใน @media = null */
  media: string | null
}

function parseDeclarations(body: string): Record<string, string> {
  const decls: Record<string, string> = {}
  for (const part of body.split(";")) {
    const colon = part.indexOf(":")
    if (colon <= 0) continue
    decls[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim().replace(/\s+/g, " ")
  }
  return decls
}

export function parseCss(source: string): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const rules: CssRule[] = []
  let at = 0

  const skipBlock = () => {
    // เข้ามาหลังเปิด { แล้ว: ข้ามจนปิดครบทุกชั้น
    let depth = 1
    while (at < css.length && depth > 0) {
      if (css[at] === "{") depth++
      else if (css[at] === "}") depth--
      at++
    }
  }

  const readBlock = (media: string | null) => {
    while (at < css.length) {
      const start = at
      while (at < css.length && css[at] !== "{" && css[at] !== ";" && css[at] !== "}") at++
      const prelude = css.slice(start, at).trim()
      const stop = css[at]
      if (stop === undefined) return
      at++
      if (stop === ";") continue // เช่น @import ...;
      if (stop === "}") return // จบบล็อก @media
      if (prelude.startsWith("@media")) readBlock(prelude.slice("@media".length).trim().replace(/\s+/g, " "))
      else if (prelude.startsWith("@")) skipBlock() // @keyframes, @font-face ฯลฯ
      else {
        const end = css.indexOf("}", at)
        if (end === -1) throw new Error(`กฎ "${prelude}" ไม่มี }`)
        rules.push({
          selectors: prelude
            .split(",")
            .map((selector) => selector.trim().replace(/\s+/g, " "))
            .filter((selector) => selector !== ""),
          decls: parseDeclarations(css.slice(at, end)),
          media,
        })
        at = end + 1
      }
    }
  }

  readBlock(null)
  return rules
}
