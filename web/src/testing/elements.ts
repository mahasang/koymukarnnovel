/**
 * ตัวช่วยเทสต์คอมโพเนนต์ที่ไม่มี hook: เรียกฟังก์ชันคอมโพเนนต์ตรงๆ ได้ต้นไม้ React element (ยังไม่เรนเดอร์) แล้วค้นหา element และเรียก handler ได้
 * ใช้ตรวจพฤติกรรมที่ `renderToStaticMarkup` มองไม่เห็น (onClick, onChange ฯลฯ) โดยไม่ต้องมี DOM — import เฉพาะจากไฟล์เทสต์
 */
import { isValidElement, type ReactElement, type ReactNode } from "react"

export type AnyElement = ReactElement<Record<string, unknown>>

/** เดินต้นไม้ element (เฉพาะที่เขียนอยู่ใน JSX ของคอมโพเนนต์นั้น ไม่ขยายคอมโพเนนต์ลูก) ตามลำดับเอกสาร */
export function walk(node: ReactNode, visit: (el: AnyElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child as ReactNode, visit)
    return
  }
  if (!isValidElement(node)) return
  const el = node as AnyElement
  visit(el)
  walk(el.props.children as ReactNode, visit)
}

/** element ทั้งหมดที่ตรงเงื่อนไข เรียงตามลำดับเอกสาร (`type` เป็นชื่อแท็กสำหรับ element ปกติ) */
export function findAll(node: ReactNode, test: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = []
  walk(node, (el) => {
    if (test(el)) found.push(el)
  })
  return found
}

/** element ตัวแรกตามชื่อแท็ก (และเงื่อนไขเพิ่ม) — ไม่พบ → โยน Error */
export function findTag(node: ReactNode, tag: string, test: (el: AnyElement) => boolean = () => true): AnyElement {
  const [first] = findAll(node, (el) => el.type === tag && test(el))
  if (first === undefined) throw new Error(`ไม่พบ <${tag}>`)
  return first
}

/** handler ที่ผูกไว้กับ element (เช่น `onClick`) — ไม่มี → โยน Error */
export function handlerOf(el: AnyElement, name: string): (...args: unknown[]) => unknown {
  const handler = el.props[name]
  if (typeof handler !== "function") throw new Error(`<${String(el.type)}> ไม่มี ${name}`)
  return handler as (...args: unknown[]) => unknown
}
