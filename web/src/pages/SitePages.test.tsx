import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { ApiError } from "../lib/api"
import { all, one, text } from "../testing/dom"
import { loadedSite, renderPage } from "../testing/render"
import { About } from "./About"
import { Contact } from "./Contact"
import { NotFound } from "./NotFound"

const about = (aboutText: string) => one(renderPage(<About />, { path: "/about", state: loadedSite({ aboutText }) }), "article.prose")
const contact = (contactText: string) => one(renderPage(<Contact />, { path: "/contact", state: loadedSite({ contactText }) }), "article.prose")

describe("หน้าเกี่ยวกับ", () => {
  test("แสดง site.aboutText ตามที่เจ้าของพิมพ์ — ขึ้นบรรทัดใหม่และเว้นบรรทัดคงเดิม (pre-wrap อยู่ที่ .prose-text) ใต้หัวข้อ h1", () => {
    const root = about("เว็บนี้แปลนิยายไว้อ่านเอง\n\nบรรทัดสอง\n  ย่อหน้าเว้นวรรค")
    assert.equal(text(one(root, "h1")), "เกี่ยวกับเว็บนี้")
    assert.equal(text(one(root, "p.prose-text")), "เว็บนี้แปลนิยายไว้อ่านเอง\n\nบรรทัดสอง\n  ย่อหน้าเว้นวรรค")
  })

  test("แสดงข้อความตามที่เซิร์ฟเวอร์ส่งมาทุกตัวอักษร ไม่ตัดช่องว่างหัวท้ายเอง (การทำความสะอาดเป็นหน้าที่ของเซิร์ฟเวอร์ตอนบันทึก)", () => {
    assert.equal(text(one(about("  ย่อหน้า\n\n"), "p.prose-text")), "  ย่อหน้า\n\n")
  })

  test("เป็นข้อความล้วน: แท็ก HTML ในข้อความแสดงตามตัวอักษร ไม่ถูกตีความ และ URL ไม่ถูกแปลงเป็นลิงก์", () => {
    const root = about('<b>ตัวหนา</b> <img src=x onerror=alert(1)> https://example.com/a?b=1&c=2')
    assert.equal(all(root, "b").length, 0)
    assert.equal(all(root, "img").length, 0)
    assert.equal(all(root, "a").length, 0)
    assert.match(text(one(root, "p.prose-text")), /<b>ตัวหนา<\/b> <img src=x onerror=alert\(1\)> https:\/\/example\.com\/a\?b=1&c=2/)
  })

  test("ยังไม่มีข้อความ (ว่าง หรือมีแต่ช่องว่าง/ขึ้นบรรทัด) → ข้อความบอกสถานะ ไม่ใช่หน้าว่าง", () => {
    for (const aboutText of ["", "   \n \n  "]) {
      const root = about(aboutText)
      assert.equal(text(one(root, "h1")), "เกี่ยวกับเว็บนี้")
      assert.equal(all(root, "p.prose-text").length, 0)
      assert.equal(text(one(root, "h2.state-title")), "ยังไม่มีข้อความแนะนำเว็บ")
    }
  })

  test("ระหว่างโหลดข้อมูลเว็บ → โครงจำลอง (ไม่ใช่หน้าเปล่า) · โหลดล้มเหลว → ข้อความผิดพลาดพร้อมรหัส alert", () => {
    const loading = one(renderPage(<About />, { path: "/about", state: { site: null, loading: true, error: null } }), "article.prose")
    one(loading, "[role=status]")
    const failed = one(renderPage(<About />, { path: "/about", state: { site: null, loading: false, error: new ApiError(500, "เซิร์ฟเวอร์ขัดข้อง") } }), "article.prose")
    assert.match(text(one(failed, "[role=alert]")), /เซิร์ฟเวอร์ขัดข้อง/)
  })
})

describe("หน้าติดต่อ / แจ้งลบเนื้อหา", () => {
  test("แสดง site.contactText เป็นข้อความล้วนเหมือนหน้าเกี่ยวกับ ใต้หัวข้อ 'ติดต่อ / แจ้งลบเนื้อหา'", () => {
    const root = contact("อีเมล: owner@example.com\nLINE: @koymu")
    assert.equal(text(one(root, "h1")), "ติดต่อ / แจ้งลบเนื้อหา")
    assert.equal(text(one(root, "p.prose-text")), "อีเมล: owner@example.com\nLINE: @koymu")
    assert.equal(all(root, ".state").length, 0)
  })

  test("ยังไม่มีข้อความติดต่อ → อธิบายเรื่องแจ้งลบเนื้อหา: เว็บแปลโดย AI สิทธิ์เป็นของเจ้าของผลงานเดิม ผู้ถือสิทธิ์ติดต่อเจ้าของเว็บได้ แต่ยังไม่มีช่องทาง", () => {
    for (const contactText of ["", "  \n "]) {
      const root = contact(contactText)
      assert.equal(all(root, "p.prose-text").length, 0)
      assert.equal(text(one(root, "h2.state-title")), "ยังไม่มีช่องทางติดต่อ")
      const hint = text(one(root, "p.state-hint"))
      for (const part of ["แปลโดย AI", "สิทธิ์ในเนื้อหาเป็นของเจ้าของผลงานเดิม", "แจ้งลบ", "ติดต่อเจ้าของเว็บ", "ยังไม่ได้ระบุช่องทางติดต่อ"]) assert.ok(hint.includes(part), part)
    }
  })
})

describe("หน้าไม่พบ", () => {
  test("บอกว่าไม่พบหน้านี้ พร้อมปุ่มลิงก์กลับหน้าแรก", () => {
    const root = renderPage(<NotFound />, { path: "/nope" })
    assert.equal(text(one(root, "h2.state-title")), "ไม่พบหน้านี้")
    const link = one(root, "a")
    assert.equal(link.attrs.href, "/")
    assert.equal(text(link), "กลับหน้าแรก")
    assert.match(link.attrs.class, /\bbtn\b/)
    assert.match(link.attrs.class, /\bprimary\b/)
  })
})
