import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ApiError } from "../lib/api"
import { all, one, parse, text } from "../testing/dom"
import { findTag, handlerOf } from "../testing/elements"
import { DRAFT_LABEL, DraftBadge } from "./DraftBadge"
import { EmptyState } from "./EmptyState"
import { ErrorState, ErrorStateView } from "./ErrorState"
import { Skeleton } from "./Skeleton"

const render = (node: ReactNode) => parse(renderToStaticMarkup(node))

describe("Skeleton", () => {
  test("แบบตาราง: ประกาศสถานะกำลังโหลดให้โปรแกรมอ่านหน้าจอ และมีการ์ดจำลอง 6 ใบตามค่าเริ่มต้น", () => {
    const root = one(render(<Skeleton variant="grid" />), ".skeleton")
    assert.equal(root.attrs.role, "status")
    assert.equal(root.attrs["aria-busy"], "true")
    assert.match(root.attrs.class, /\bskeleton-grid\b/)
    assert.equal(text(one(root, ".sr-only")), "กำลังโหลด…")
    assert.equal(all(root, ".sk-card").length, 6)
  })

  test("การ์ดจำลองประกอบด้วยปก + บรรทัดชื่อ + บรรทัดสั้น และซ่อนจากโปรแกรมอ่านหน้าจอ", () => {
    const card = one(render(<Skeleton variant="grid" count={1} />), ".sk-card")
    assert.equal(card.attrs["aria-hidden"], "true")
    assert.equal(all(card, ".sk-cover").length, 1)
    assert.equal(all(card, ".sk-line").length, 2)
    assert.equal(all(card, ".sk-short").length, 1)
  })

  test("กำหนดจำนวนการ์ดได้ (รวม 0)", () => {
    assert.equal(all(render(<Skeleton variant="grid" count={12} />), ".sk-card").length, 12)
    assert.equal(all(render(<Skeleton variant="grid" count={0} />), ".sk-card").length, 0)
  })

  test("แบบบรรทัด: 4 บรรทัดตามค่าเริ่มต้น บรรทัดสุดท้ายสั้นกว่า และไม่มีการ์ด", () => {
    const root = one(render(<Skeleton variant="lines" />), ".skeleton")
    assert.match(root.attrs.class, /\bskeleton-lines\b/)
    const lines = all(root, ".sk-line")
    assert.equal(lines.length, 4)
    assert.deepEqual(
      lines.map((line) => line.attrs.class.includes("sk-short")),
      [false, false, false, true],
    )
    assert.ok(lines.every((line) => line.attrs["aria-hidden"] === "true"))
    assert.equal(all(root, ".sk-card").length, 0)
  })

  test("แบบบรรทัด: กำหนดจำนวนได้; บรรทัดเดียวก็ยังสั้น", () => {
    assert.equal(all(render(<Skeleton variant="lines" count={7} />), ".sk-line").length, 7)
    const [only] = all(render(<Skeleton variant="lines" count={1} />), ".sk-line")
    assert.match(only.attrs.class, /sk-short/)
  })

  test("ตัวแปรของแบบหนึ่งไม่รั่วไปอีกแบบ", () => {
    assert.doesNotMatch(one(render(<Skeleton variant="grid" />), ".skeleton").attrs.class, /skeleton-lines/)
    assert.doesNotMatch(one(render(<Skeleton variant="lines" />), ".skeleton").attrs.class, /skeleton-grid/)
  })
})

describe("ErrorState", () => {
  test("ประกาศเป็น alert พร้อมหัวข้อและข้อความของข้อผิดพลาด (ภาษาไทยจากเซิร์ฟเวอร์)", () => {
    const root = one(render(<ErrorState error={new ApiError(404, "ไม่พบนิยายเรื่องนี้", "not_found")} />), ".state")
    assert.equal(root.attrs.role, "alert")
    assert.match(root.attrs.class, /\bstate-error\b/)
    assert.equal(text(one(root, "h2.state-title")), "โหลดข้อมูลไม่สำเร็จ")
    assert.equal(one(root, "div.state-icon").attrs["aria-hidden"], "true")
    assert.equal(text(one(root, "p.state-message")), "ไม่พบนิยายเรื่องนี้")
  })

  test("ไม่ได้คำตอบเลย (status 0) มีคำแนะนำให้ตรวจอินเทอร์เน็ต", () => {
    const root = one(render(<ErrorState error={new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")} />), ".state")
    assert.equal(text(one(root, "p.state-hint")), "ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง")
  })

  test("เซิร์ฟเวอร์ขัดข้อง (5xx) มีคำแนะนำให้ลองใหม่ภายหลัง", () => {
    const root = one(render(<ErrorState error={new ApiError(503, "บริการไม่พร้อม")} />), ".state")
    assert.equal(text(one(root, "p.state-hint")), "เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ในอีกสักครู่")
  })

  test("ข้อผิดพลาด 4xx ไม่มีคำแนะนำเพิ่ม (ไม่มีย่อหน้า hint)", () => {
    const root = one(render(<ErrorState error={new ApiError(429, "ขอเร็วเกินไป")} />), ".state")
    assert.equal(all(root, "p.state-hint").length, 0)
  })

  test("มี onRetry → ปุ่ม 'ลองใหม่' (type=button) และกดแล้วเรียก onRetry", () => {
    let retries = 0
    const element = ErrorStateView({ error: new ApiError(0, "x"), onRetry: () => retries++ })
    const button = findTag(element, "button")
    assert.equal(button.props.type, "button")
    handlerOf(button, "onClick")()
    assert.equal(retries, 1)
    const root = render(<ErrorState error={new ApiError(0, "x")} onRetry={() => {}} />)
    assert.equal(text(one(root, "button")).trim(), "ลองใหม่")
  })

  test("ไม่มี onRetry → ไม่มีปุ่ม", () => {
    assert.equal(all(render(<ErrorState error={new ApiError(500, "x")} />), "button").length, 0)
  })

  test("ข้อความที่มีอักขระพิเศษของ HTML ถูก escape (ไม่เป็นแท็ก)", () => {
    const root = render(<ErrorState error={new ApiError(400, "<script>alert(1)</script>")} />)
    assert.equal(all(root, "script").length, 0)
    assert.equal(text(one(root, "p.state-message")), "<script>alert(1)</script>")
  })
})

describe("EmptyState", () => {
  test("หัวข้อ + คำอธิบาย + ปุ่ม/ลิงก์ที่ส่งมา", () => {
    const root = one(
      render(<EmptyState title="ยังไม่มีนิยาย" hint="กลับมาใหม่เร็วๆ นี้" action={<a href="/admin">ไปหลังบ้าน</a>} />),
      ".state",
    )
    assert.match(root.attrs.class, /\bstate-empty\b/)
    assert.equal(one(root, "div.state-icon").attrs["aria-hidden"], "true")
    assert.equal(text(one(root, "h2.state-title")), "ยังไม่มีนิยาย")
    assert.equal(text(one(root, "p.state-hint")), "กลับมาใหม่เร็วๆ นี้")
    assert.equal(one(one(root, ".state-actions"), "a").attrs.href, "/admin")
  })

  test("ไม่ใส่คำอธิบายหรือปุ่ม → ไม่มีย่อหน้า/กล่องปุ่มว่างๆ", () => {
    const root = one(render(<EmptyState title="ว่าง" />), ".state")
    assert.equal(all(root, "p").length, 0)
    assert.equal(all(root, ".state-actions").length, 0)
  })

  test("คำอธิบายเป็นสตริงว่างนับเป็นไม่ใส่", () => {
    assert.equal(all(render(<EmptyState title="ว่าง" hint="" />), "p").length, 0)
  })

  test("ไม่ประกาศเป็น alert (เป็นเนื้อหาปกติ ไม่ใช่ข้อผิดพลาด)", () => {
    assert.equal(one(render(<EmptyState title="ว่าง" />), ".state").attrs.role, undefined)
  })
})

describe("DraftBadge (ป้ายร่าง — เห็นเฉพาะผู้ดูแล)", () => {
  test("ข้อความเต็มตาม spec 6.8", () => {
    assert.equal(DRAFT_LABEL, "ร่าง — เห็นเฉพาะผู้ดูแล")
    const badge = one(render(<DraftBadge />), ".draft")
    assert.equal(text(badge).trim(), DRAFT_LABEL)
    assert.doesNotMatch(badge.attrs.class, /draft-compact/)
  })

  test("แบบย่อ (บนปก): เห็นแค่ 'ร่าง' แต่โปรแกรมอ่านหน้าจอและคำอธิบายตอนวางเมาส์ได้ข้อความเต็ม", () => {
    const badge = one(render(<DraftBadge compact />), ".draft")
    assert.match(badge.attrs.class, /\bdraft-compact\b/)
    assert.equal(badge.attrs.title, DRAFT_LABEL)
    const visible = one(badge, "[aria-hidden=true]")
    assert.equal(text(visible), "ร่าง")
    assert.equal(text(one(badge, ".sr-only")), DRAFT_LABEL)
  })

  test("แบบเต็มไม่มี title ซ้ำซ้อน", () => {
    assert.equal(one(render(<DraftBadge />), ".draft").attrs.title, undefined)
  })
})
