/**
 * ตัวช่วยเทสต์คอมโพเนนต์: แปลง HTML ที่ React เรนเดอร์ (`renderToStaticMarkup`) เป็นต้นไม้เล็กๆ เพื่อตรวจโครงสร้าง (แท็ก แอตทริบิวต์ ข้อความ)
 * ไม่ใช่ตัวอ่าน HTML ทั่วไป — รองรับเฉพาะรูปแบบที่ React เขียนออกมา (ค่าแอตทริบิวต์ใส่เครื่องหมายคำพูดคู่และ escape แล้ว ไม่มีแท็กที่ไม่ปิด)
 * ชื่อแท็กและชื่อแอตทริบิวต์เป็นตัวพิมพ์เล็กเสมอ (เทสต์อ่านเป็น `viewbox`, `maxlength`, `tabindex`) ไม่ผูกกับตัวพิมพ์ที่ React รุ่นนั้นเลือกเขียน
 * import เฉพาะจากไฟล์เทสต์ ไม่เป็นส่วนของหน้าเว็บ
 */

export interface El {
  tag: string
  attrs: Record<string, string>
  children: Array<El | string>
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decode(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16))
    if (dec !== undefined) return String.fromCodePoint(Number(dec))
    return ENTITIES[(name ?? "").toLowerCase()] ?? whole
  })
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  // ชื่อแอตทริบิวต์ในเอกสาร HTML ไม่แยกตัวพิมพ์ (React อาจเขียน maxLength หรือ maxlength ขึ้นกับรุ่น) — เก็บเป็นตัวพิมพ์เล็กเสมอ
  for (const match of source.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? "")
  return attrs
}

/** อ่าน HTML เป็นต้นไม้ (รากสมมติชื่อ `#root`) — โยน Error ถ้าแท็กปิดไม่ตรงกัน */
export function parse(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] }
  const stack: El[] = [root]
  const top = () => stack[stack.length - 1]
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][^\s/>]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, name, attrSource, selfClosing, text] = match
    if (text !== undefined) {
      top().children.push(decode(text))
    } else if (name === undefined) {
      continue // ความเห็น <!-- -->
    } else if (closing === "/") {
      const open = stack.pop()
      if (open === undefined || open.tag !== name.toLowerCase() || stack.length === 0) throw new Error(`แท็กปิด </${name}> ไม่ตรงกับแท็กที่เปิดอยู่ (${open?.tag})`)
    } else {
      const el: El = { tag: name.toLowerCase(), attrs: parseAttrs(attrSource ?? ""), children: [] }
      top().children.push(el)
      if (selfClosing !== "/" && !VOID_TAGS.has(el.tag)) stack.push(el)
    }
  }
  if (stack.length !== 1) throw new Error(`แท็ก <${top().tag}> ไม่ถูกปิด`)
  return root
}

/** ตัวเลือกแบบเรียบง่ายหนึ่งชุด: `tag` `.class` `[attr]` `[attr=ค่า]` ต่อกันได้ เช่น `a.card[href="/novel/1"]` (ไม่มีตัวเชื่อมลูกหลาน — ใช้เรียกซ้อนกันแทน) */
function matcher(selector: string): (el: El) => boolean {
  const compound = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|[^\]]*))?\])*)$/.exec(selector.trim())
  if (compound === null || selector.trim() === "") throw new Error(`ตัวเลือก "${selector}" ไม่รองรับ`)
  const tag = compound[1]?.toLowerCase()
  const parts = [...(compound[2] ?? "").matchAll(/\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g)]
  return (el) =>
    (tag === undefined || el.tag === tag) &&
    parts.every(([, className, attr, quoted, bare]) => {
      if (className !== undefined) return (el.attrs.class ?? "").split(/\s+/).includes(className)
      const value = quoted ?? bare
      const name = attr?.toLowerCase()
      return name !== undefined && name in el.attrs && (value === undefined || el.attrs[name] === value)
    })
}

/** ลูกหลานทั้งหมดของ `node` ที่ตรงตัวเลือก เรียงตามลำดับในเอกสาร (ไม่รวม `node` เอง) */
export function all(node: El, selector: string): El[] {
  const test = matcher(selector)
  const found: El[] = []
  const visit = (el: El) => {
    for (const child of el.children) {
      if (typeof child === "string") continue
      if (test(child)) found.push(child)
      visit(child)
    }
  }
  visit(node)
  return found
}

/** ลูกหลานตัวแรกที่ตรงตัวเลือก — ไม่พบ → โยน Error (เทสต์จะล้มพร้อมบอกว่าหาอะไรไม่เจอ) */
export function one(node: El, selector: string): El {
  const [first] = all(node, selector)
  if (first === undefined) throw new Error(`ไม่พบ "${selector}"`)
  return first
}

/** ข้อความทั้งหมดใต้ node ต่อกัน (ไม่รวมแท็ก) */
export function text(node: El | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("")
}
