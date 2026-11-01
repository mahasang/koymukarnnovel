/**
 * แยกเนื้อหาตอน (ข้อความดิบจากผู้ดูแล) เป็นย่อหน้าสำหรับหน้าอ่าน
 * - ย่อหน้าคั่นด้วยบรรทัดว่าง · ขึ้นบรรทัดเดียวอยู่ในย่อหน้าเดิม (หน้าอ่านแสดงด้วย `white-space: pre-line`)
 * - เส้นคั่นฉาก (`***` `* * *` `---` `___`) เป็นย่อหน้าของมันเอง แม้ผู้เขียนไม่เว้นบรรทัดว่างรอบมัน
 * - บรรทัดที่มีแต่ช่องว่าง/NBSP/ตัวอักษรไร้ความกว้าง/BOM นับเป็นบรรทัดว่าง (ข้อความที่วางมาจากเว็บอื่นมักปนมา)
 */

/** ขึ้นบรรทัดทุกแบบ: \r\n, \n, \r (Mac เก่า), U+2028, U+2029 */
const LINE_BREAK = /\r\n|[\n\r\u{2028}\u{2029}]/u
/** บรรทัดว่าง: ช่องว่างทุกชนิด + ZWSP/ZWNJ/ZWJ (U+200B–U+200D) + word joiner + BOM */
const BLANK_LINE = /^[\s\u{200B}-\u{200D}\u{2060}\u{FEFF}]*$/u
/** อักขระ * - _ ตัวเดียวกันอย่างน้อยสามตัว คั่นด้วยช่องว่าง/แท็บ (ไม่ข้ามบรรทัด) หรือไม่คั่นก็ได้ */
const SCENE_BREAK = /^([*\-_])(?:[^\S\n\r\u{2028}\u{2029}]*\1){2,}$/u

/** บรรทัดคั่นฉาก เช่น `***` `* * *` `---` `- - -` `___` (อย่างน้อยสามตัวซ้ำ; `--`, `**bold**`, `a***` ไม่ใช่) */
export function isSceneBreak(p: string): boolean {
  return SCENE_BREAK.test(p.trim())
}

/** ย่อหน้าของตอน ตัดช่องว่างรอบย่อหน้า ทิ้งย่อหน้าว่าง (ไม่มีย่อหน้าเลย → `[]`) */
export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  let lines: string[] = []
  const flush = (): void => {
    if (lines.length === 0) return
    const paragraph = lines.join("\n").trim()
    lines = []
    if (paragraph !== "") paragraphs.push(paragraph)
  }
  for (const line of text.split(LINE_BREAK)) {
    if (BLANK_LINE.test(line)) {
      flush()
    } else if (isSceneBreak(line)) {
      flush()
      paragraphs.push(line.trim())
    } else {
      lines.push(line)
    }
  }
  flush()
  return paragraphs
}
