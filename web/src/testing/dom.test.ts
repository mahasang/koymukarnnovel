import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { all, one, parse, text } from "./dom"

describe("parse", () => {
  test("แท็กซ้อนกัน แอตทริบิวต์ และข้อความ", () => {
    const root = parse('<div class="a b" id="x"><p>สวัสดี <b>โลก</b></p></div>')
    const div = one(root, "div")
    assert.deepEqual(div.attrs, { class: "a b", id: "x" })
    assert.equal(one(div, "p").children.length, 2)
    assert.equal(text(div), "สวัสดี โลก")
    assert.equal(one(div, "b").tag, "b")
  })

  test("แอตทริบิวต์แบบไม่มีค่า (boolean) ได้ค่าว่าง และแท็กตัวพิมพ์ใหญ่ถูกแปลงเป็นตัวเล็ก", () => {
    const root = parse('<BUTTON disabled aria-pressed="true">ok</BUTTON>')
    assert.deepEqual(one(root, "button").attrs, { disabled: "", "aria-pressed": "true" })
  })

  test("ชื่อแอตทริบิวต์ไม่แยกตัวพิมพ์ — อ่านเป็นตัวพิมพ์เล็กเสมอ และตัวเลือก [attr] ก็ไม่แยกตัวพิมพ์", () => {
    const root = parse('<input maxLength="3" aria-LABEL="x" viewBox="0 0 1 1"/>')
    const input = one(root, "input")
    assert.deepEqual(input.attrs, { maxlength: "3", "aria-label": "x", viewbox: "0 0 1 1" })
    assert.equal(all(root, "[maxLength]").length, 1)
    assert.equal(all(root, '[MAXLENGTH="3"]').length, 1)
    assert.equal(all(root, '[maxLength="4"]').length, 0)
    assert.equal(all(root, "[ARIA-label=x]").length, 1)
  })

  test("entity ถอดรหัสทั้งในข้อความและค่าแอตทริบิวต์ (&amp; &lt; &gt; &quot; &#x27; &#39; &#x1F600;)", () => {
    const root = parse('<p title="a &amp; b &quot;c&quot;">1 &lt; 2 &gt; 0 &amp; &#x27;q&#39; &#x1F600;</p>')
    const p = one(root, "p")
    assert.equal(p.attrs.title, 'a & b "c"')
    assert.equal(text(p), "1 < 2 > 0 & 'q' 😀")
  })

  test("entity ที่ไม่รู้จักคงไว้ตามเดิม", () => {
    assert.equal(text(parse("<p>&nope;</p>")), "&nope;")
  })

  test("แท็กที่ไม่มีตัวปิด (img, input, br) ไม่กลืนพี่น้อง; รูปแบบ /> ก็ใช้ได้", () => {
    const root = parse('<div><img src="a.png" alt=""><input name="q"><br/><span>จบ</span></div>')
    const div = one(root, "div")
    assert.deepEqual(
      div.children.map((c) => (typeof c === "string" ? c : c.tag)),
      ["img", "input", "br", "span"],
    )
    assert.equal(one(div, "img").attrs.src, "a.png")
  })

  test("ความเห็น HTML ถูกข้าม", () => {
    assert.equal(text(parse("<p>a<!-- ซ่อน -->b</p>")), "ab")
  })

  test("แท็กปิดไม่ตรงกัน หรือไม่ถูกปิด → โยน Error (ไม่ปล่อยให้เทสต์เทียบกับต้นไม้ที่เพี้ยน)", () => {
    assert.throws(() => parse("<div><p></div></p>"), /ไม่ตรง/)
    assert.throws(() => parse("<div><p>"), /ไม่ถูกปิด/)
    assert.throws(() => parse("</div>"), /ไม่ตรง/)
  })

  test("ข้อความล้วนและสตริงว่าง", () => {
    assert.equal(text(parse("เฉยๆ")), "เฉยๆ")
    assert.deepEqual(parse("").children, [])
  })
})

describe("all / one", () => {
  const root = parse(
    '<ul class="list"><li class="item on" data-id="1"><a href="/a" aria-current="page">A</a></li><li class="item" data-id="2"><a href="/b">B</a></li><li data-id="3"><span class="on">C</span></li></ul>',
  )

  test("ตามชื่อแท็ก เรียงตามลำดับในเอกสาร และไม่รวมตัว node เอง", () => {
    assert.deepEqual(
      all(root, "li").map((el) => el.attrs["data-id"]),
      ["1", "2", "3"],
    )
    assert.deepEqual(all(one(root, "ul"), "ul"), [])
  })

  test("ตามคลาส (ต้องมีครบทุกคลาสที่ระบุ และจับเป็นคำเต็ม)", () => {
    assert.equal(all(root, ".item").length, 2)
    assert.equal(all(root, ".item.on").length, 1)
    assert.equal(all(root, ".it").length, 0)
    assert.equal(all(root, "span.on").length, 1)
    assert.equal(all(root, "li.on").length, 1)
  })

  test("ตามแอตทริบิวต์: มีอยู่ / เท่ากับค่า (ใส่หรือไม่ใส่เครื่องหมายคำพูด)", () => {
    assert.equal(all(root, "[aria-current]").length, 1)
    assert.equal(all(root, '[href="/b"]').length, 1)
    assert.equal(all(root, "[href=/b]").length, 1)
    assert.equal(all(root, "[href=/c]").length, 0)
    assert.equal(all(root, "a[href]").length, 2)
    assert.equal(all(root, 'li[data-id="2"].item').length, 1)
    assert.equal(all(root, 'li[data-id="2"].on').length, 0)
  })

  test("one: ตัวแรกที่ตรง; ไม่พบ → โยน Error บอกตัวเลือกที่หา", () => {
    assert.equal(one(root, "a").attrs.href, "/a")
    assert.throws(() => one(root, "table"), /ไม่พบ "table"/)
  })

  test("ตัวเลือกที่ไม่รองรับ → โยน Error", () => {
    assert.throws(() => all(root, "ul li"), /ไม่รองรับ/)
    assert.throws(() => all(root, "a > b"), /ไม่รองรับ/)
    assert.throws(() => all(root, ""), /ไม่รองรับ/)
  })
})
