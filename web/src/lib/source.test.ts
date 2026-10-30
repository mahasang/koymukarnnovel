import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { sourceOf } from "./source"

describe("sourceOf: ต้นฉบับของนิยาย", () => {
  test("ว่าง/ช่องว่างล้วน → none", () => {
    assert.deepEqual(sourceOf(""), { kind: "none" })
    assert.deepEqual(sourceOf("   \n "), { kind: "none" })
  })

  test("http/https → ลิงก์ ป้ายเป็นชื่อโฮสต์ (ตัด www.) href เป็นรูปที่ URL ปรับให้แล้ว", () => {
    assert.deepEqual(sourceOf("https://www.royalroad.com/fiction/12345/some-title"), { kind: "link", href: "https://www.royalroad.com/fiction/12345/some-title", label: "royalroad.com" })
    assert.deepEqual(sourceOf("http://example.org"), { kind: "link", href: "http://example.org/", label: "example.org" })
    assert.deepEqual(sourceOf("  https://Example.COM/Path?q=1#x  "), { kind: "link", href: "https://example.com/Path?q=1#x", label: "example.com" })
  })

  test("ชื่อโฮสต์ที่ไม่ได้ขึ้นต้นด้วย www. ไม่ถูกตัด และมีพอร์ตก็ยังเป็นลิงก์", () => {
    assert.deepEqual(sourceOf("https://wwwexample.com/"), { kind: "link", href: "https://wwwexample.com/", label: "wwwexample.com" })
    assert.deepEqual(sourceOf("http://localhost:8080/x"), { kind: "link", href: "http://localhost:8080/x", label: "localhost" })
  })

  test("ชื่อ scheme ตัวพิมพ์ใหญ่ก็เป็นลิงก์ (URL ปรับเป็นตัวเล็กให้) · 'www.' ถูกตัดเฉพาะหน้าโฮสต์เท่านั้น", () => {
    assert.deepEqual(sourceOf("HTTPS://EXAMPLE.ORG/Fic"), { kind: "link", href: "https://example.org/Fic", label: "example.org" })
    assert.deepEqual(sourceOf("https://notwww.example.org/"), { kind: "link", href: "https://notwww.example.org/", label: "notwww.example.org" })
    assert.deepEqual(sourceOf("https://a.www.example.org/"), { kind: "link", href: "https://a.www.example.org/", label: "a.www.example.org" })
    assert.deepEqual(sourceOf("https://www.www.example.org/"), { kind: "link", href: "https://www.www.example.org/", label: "www.example.org" })
  })

  test("โฮสต์ที่เหลือว่างหลังตัด www. → ใช้ชื่อโฮสต์เดิมเป็นป้าย (ไม่ให้ป้ายว่าง)", () => {
    assert.deepEqual(sourceOf("https://www./x"), { kind: "link", href: "https://www./x", label: "www." })
  })

  test("โดเมนภาษาอื่นแสดงเป็น punycode (ไม่ปลอมตัวเป็นโดเมนที่หน้าตาเหมือน)", () => {
    const result = sourceOf("https://аpple.com/")
    assert.equal(result.kind, "link")
    assert.ok(result.kind === "link" && result.label.startsWith("xn--"), JSON.stringify(result))
  })

  test("ข้อมูลล็อกอินในลิงก์ไม่หลอกป้าย: ป้ายเป็นโฮสต์จริงหลัง @", () => {
    const result = sourceOf("https://royalroad.com@evil.example/x")
    assert.equal(result.kind === "link" && result.label, "evil.example")
  })

  test("โปรโตคอลอื่นไม่เป็นลิงก์ (javascript:, data:, ftp:, mailto:, file:, vbscript:) — แสดงเป็นข้อความธรรมดา", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://example.com/x", "mailto:a@b.co", "file:///etc/passwd", "vbscript:msgbox(1)"]) {
      assert.deepEqual(sourceOf(bad), { kind: "text", text: bad.trim() }, bad)
    }
  })

  test("ข้อความที่ไม่ใช่ URL (ชื่อเว็บ, ไม่มี scheme, //โฮสต์) → ข้อความธรรมดา ไม่เดาเติม https", () => {
    assert.deepEqual(sourceOf("Royal Road"), { kind: "text", text: "Royal Road" })
    assert.deepEqual(sourceOf("royalroad.com/fiction/1"), { kind: "text", text: "royalroad.com/fiction/1" })
    assert.deepEqual(sourceOf("//evil.example/x"), { kind: "text", text: "//evil.example/x" })
    assert.deepEqual(sourceOf("https:/broken"), { kind: "text", text: "https:/broken" })
  })

  test("https:// ที่ไม่มีโฮสต์ → ข้อความธรรมดา (ไม่เป็นลิงก์ที่กดแล้วไม่ไปไหน)", () => {
    assert.equal(sourceOf("https://").kind, "text")
    assert.equal(sourceOf("https:///path").kind === "link", false)
  })

  test("ช่องว่างกลางเส้นทางถูกเข้ารหัสเป็น %20 (ลิงก์ยังใช้ได้) · ข้อความที่มีคำนำหน้า URL ไม่ถูกมองเป็นลิงก์", () => {
    assert.deepEqual(sourceOf("https://example.com/a b"), { kind: "link", href: "https://example.com/a%20b", label: "example.com" })
    assert.deepEqual(sourceOf("see https://example.com"), { kind: "text", text: "see https://example.com" })
    assert.equal(sourceOf("https://exa mple.com/").kind, "text")
  })
})
