import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { ApiError } from "../lib/api"
import type { ChapterPageDto } from "../lib/types"
import { all, one, text } from "../testing/dom"
import { ErrorState } from "../components/ErrorState"
import { findAll } from "../testing/elements"
import { restoreGlobals } from "../testing/helpers"
import { renderPage } from "../testing/render"
import { ReaderBodyView, ReaderContent, ReaderNavView, SAVE_DELAY_MS, type ReaderBodyViewProps } from "./Reader"

/** หน้าอ่าน: เนื้อหาตอน (ย่อหน้า เส้นคั่นฉาก ไฮไลต์ตอนอ่านออกเสียง ป้ายร่าง) ปุ่มท้ายตอน และการเลือกสถานะ ไม่พบ/ผิดพลาด/โหลด/หน้าอ่าน */

afterEach(restoreGlobals)

const bodyProps = (over: Partial<ReaderBodyViewProps> = {}): ReaderBodyViewProps => ({
  heading: "ตอนที่ 3: ประตู",
  draft: false,
  paragraphs: ["ย่อหน้าแรก", "ย่อหน้าสอง"],
  activeIndex: null,
  fontSize: 18,
  font: "sarabun",
  ...over,
})
const body = (over: Partial<ReaderBodyViewProps> = {}) => renderPage(<ReaderBodyView {...bodyProps(over)} />)

describe("ReaderBodyView", () => {
  test("หัวตอนเป็น h1 และแต่ละย่อหน้าเป็น <p> ตามลำดับ", () => {
    const root = body()
    assert.equal(text(one(root, "h1.rd-heading")), "ตอนที่ 3: ประตู")
    assert.deepEqual(
      all(root, "p.rd-p").map((p) => text(p)),
      ["ย่อหน้าแรก", "ย่อหน้าสอง"],
    )
  })

  test("ขึ้นบรรทัดภายในย่อหน้าคงไว้ในข้อความ (CSS แสดงด้วย pre-line) และแท็ก HTML ในเนื้อหาไม่ถูกตีความ", () => {
    const root = body({ paragraphs: ["บรรทัดหนึ่ง\nบรรทัดสอง", "<script>alert(1)</script><b>x</b>"] })
    const [first, second] = all(root, "p.rd-p")
    assert.equal(text(first), "บรรทัดหนึ่ง\nบรรทัดสอง")
    assert.equal(text(second), "<script>alert(1)</script><b>x</b>")
    assert.equal(all(root, "script").length, 0)
    assert.equal(all(root, "b").length, 0)
  })

  test("เส้นคั่นฉากเป็นเครื่องหมายกลาง (separator + จุดสามจุดที่ซ่อนจากโปรแกรมอ่านหน้าจอ) แทนที่ข้อความ *** เดิม", () => {
    const root = body({ paragraphs: ["ก่อน", "***", "* * *", "---", "หลัง"] })
    const scenes = all(root, "div.rd-scene")
    assert.equal(scenes.length, 3)
    for (const scene of scenes) {
      assert.equal(scene.attrs.role, "separator")
      assert.equal(text(scene), "")
      const dots = all(scene, "i")
      assert.equal(dots.length, 3)
      for (const dot of dots) assert.equal(dot.attrs["aria-hidden"], "true")
    }
    assert.deepEqual(
      all(root, "p.rd-p").map((p) => text(p)),
      ["ก่อน", "หลัง"],
    )
  })

  test("ลูกลำดับที่ i ของกรอบข้อความ = ย่อหน้าที่ i เสมอ (เสียงอ่านใช้ดัชนีนี้ไฮไลต์/เลื่อนตาม)", () => {
    const paragraphs = ["ก", "***", "ข", "ค", "---", "ง"]
    const container = one(body({ paragraphs }), "div.rd-text")
    const children = container.children.filter((child) => typeof child !== "string")
    assert.equal(children.length, paragraphs.length)
    assert.deepEqual(
      children.map((child) => (typeof child === "string" ? "" : child.tag)),
      ["p", "div", "p", "p", "div", "p"],
    )
  })

  test("ย่อหน้าที่กำลังอ่านออกเสียงเท่านั้นที่ได้คลาส speaking", () => {
    const root = body({ paragraphs: ["ก", "ข", "ค"], activeIndex: 1 })
    assert.deepEqual(
      all(root, "p.rd-p").map((p) => p.attrs.class),
      ["rd-p", "rd-p speaking", "rd-p"],
    )
    assert.equal(all(body({ activeIndex: null }), "p.speaking").length, 0)
  })

  test("ไฮไลต์ที่ชี้เส้นคั่นฉากไม่ทำให้ย่อหน้าอื่นเด่น", () => {
    assert.equal(all(body({ paragraphs: ["ก", "***", "ข"], activeIndex: 1 }), "p.speaking").length, 0)
  })

  test("ตอนที่ยังไม่เผยแพร่ (ผู้ดูแลดูตัวอย่าง) มีป้ายร่างใต้หัวตอน · ตอนที่เผยแพร่แล้วไม่มี", () => {
    assert.equal(text(one(body({ draft: true }), "div.rd-draft")), "ร่าง — เห็นเฉพาะผู้ดูแล")
    assert.equal(all(body({ draft: false }), "span.draft").length, 0)
    assert.equal(all(body({ draft: false }), "div.rd-draft").length, 0)
  })

  test("ขนาดตัวอักษรตั้งที่บทความ · ฟอนต์เซอริฟได้คลาส rd-serif, Sarabun ไม่มี", () => {
    assert.equal(one(body({ fontSize: 24 }), "article").attrs.style, "font-size:24px")
    assert.equal(one(body({ font: "sarabun" }), "article").attrs.class, "rd")
    assert.equal(one(body({ font: "serif" }), "article").attrs.class, "rd rd-serif")
  })

  test("ไม่มีย่อหน้าเลย → บอกว่ายังไม่มีเนื้อหา", () => {
    assert.equal(text(one(body({ paragraphs: [] }), "p.rd-empty")), "ตอนนี้ยังไม่มีเนื้อหา")
    assert.equal(all(body(), "p.rd-empty").length, 0)
  })

  test("ส่ง ref ของกรอบข้อความต่อให้ element", () => {
    const textRef = { current: null }
    const article = ReaderBodyView(bodyProps({ textRef })) as unknown as { props: { children: unknown } }
    const boxes = findAll(article as never, (el) => el.props.className === "rd-text")
    assert.equal(boxes.length, 1)
    assert.equal((boxes[0] as unknown as { ref: unknown }).ref, textRef)
  })
})

describe("ReaderNavView", () => {
  const nav = (prev: number | null, next: number | null) => renderPage(<ReaderNavView novelId={7} prev={prev} next={next} />)

  test("ก่อนหน้า · สารบัญ · ถัดไป ตามลำดับ ลิงก์ไปตอนนั้นและหน้านิยาย", () => {
    const root = nav(2, 4)
    assert.equal(one(root, "nav").attrs["aria-label"], "เปลี่ยนตอน")
    const links = all(root, "a")
    assert.deepEqual(
      links.map((link) => [link.attrs.href, text(link).trim(), link.attrs.rel]),
      [
        ["/novel/7/2", "ตอนก่อนหน้า", "prev"],
        ["/novel/7", "สารบัญ", undefined],
        ["/novel/7/4", "ตอนถัดไป", "next"],
      ],
    )
    assert.equal(one(root, "a.rd-next").attrs.class, "btn primary rd-next")
  })

  test("ตอนที่ 0 เป็นตอนจริง: ก่อนหน้า = 0 ยังเป็นลิงก์", () => {
    assert.equal(one(nav(0, 2), "a.rd-prev").attrs.href, "/novel/7/0")
  })

  test("ไม่มีตอนก่อนหน้า/ถัดไป → ข้อความจางๆ ที่กดไม่ได้ (ไม่ใช่ลิงก์) ปุ่มสารบัญยังอยู่", () => {
    const first = nav(null, 2)
    assert.equal(text(one(first, "span.rd-prev")), "ไม่มีตอนก่อนหน้า")
    assert.equal(all(first, "a.rd-prev").length, 0)
    const last = nav(1, null)
    assert.equal(text(one(last, "span.rd-next")), "ยังไม่มีตอนถัดไป")
    assert.equal(all(last, "a.rd-next").length, 0)
    assert.equal(all(nav(null, null), "a").length, 1)
    assert.equal(one(nav(null, null), "a.rd-toc").attrs.href, "/novel/7")
  })
})

const PAGE: ChapterPageDto = {
  novel: { id: 7, title: "Glass Season", titleTh: "ฤดูกระจก" },
  chapter: { number: 3, title: "The Door", titleTh: "ประตู", text: "ย่อหน้าแรก\n\n***\n\nย่อหน้าสอง", published: true },
  prev: 2,
  next: 4,
}
const content = (over: Partial<Parameters<typeof ReaderContent>[0]> = {}) =>
  renderPage(<ReaderContent id={7} number={3} data={PAGE} error={null} onRetry={() => {}} {...over} />, { path: "/novel/7/3" })

describe("ReaderContent", () => {
  test("เลขนิยายหรือเลขตอนใช้ไม่ได้ → ไม่พบหน้านี้ (ห่อด้วยโครงเนื้อหาเพราะหน้านี้อยู่นอก Layout)", () => {
    for (const over of [{ id: null }, { number: null }, { id: null, number: null, data: null }]) {
      const root = content(over)
      assert.equal(text(one(root, "main.wrap")).includes("ไม่พบหน้านี้"), true)
      assert.equal(all(root, "header.rb").length, 0)
    }
  })

  test("เซิร์ฟเวอร์ตอบ 404 (ตอนไม่มี/ซ่อนอยู่) → ไม่พบหน้านี้", () => {
    const root = content({ data: null, error: new ApiError(404, "ไม่พบ") })
    assert.equal(text(root).includes("ไม่พบหน้านี้"), true)
  })

  test("ผิดพลาดอื่น → ข้อความผิดพลาดพร้อมปุ่มลองใหม่", () => {
    const root = content({ data: null, error: new ApiError(500, "เซิร์ฟเวอร์ขัดข้อง") })
    assert.equal(text(one(root, "p.state-message")), "เซิร์ฟเวอร์ขัดข้อง")
    assert.equal(text(one(root, "button.btn")).includes("ลองใหม่"), true)
    assert.equal(all(root, "article").length, 0)
  })

  test("กำลังโหลด → โครงจำลอง ไม่มีแถบบน/เนื้อหา", () => {
    const root = content({ data: null })
    assert.equal(all(root, "div.skeleton").length, 1)
    assert.equal(all(root, "header.rb").length, 0)
    assert.equal(all(root, "article").length, 0)
  })

  test("มีข้อมูล → หน้าอ่านเต็ม: แถบบน หัวตอน ย่อหน้า เส้นคั่นฉาก ปุ่มท้ายตอน", () => {
    const root = content()
    assert.equal(text(one(root, "span.rb-novel")), "ฤดูกระจก")
    assert.equal(text(one(root, "span.rb-chapter")), "ตอนที่ 3")
    assert.equal(text(one(root, "h1.rd-heading")), "ตอนที่ 3: ประตู")
    assert.deepEqual(
      all(root, "p.rd-p").map((p) => text(p)),
      ["ย่อหน้าแรก", "ย่อหน้าสอง"],
    )
    assert.equal(all(root, "div.rd-scene").length, 1)
    assert.equal(one(root, "a.rd-next").attrs.href, "/novel/7/4")
    assert.equal(one(root, "a.rd-prev").attrs.href, "/novel/7/2")
    assert.equal(all(root, "span.draft").length, 0)
    assert.equal(all(root, "section.rs").length, 0) // แผงตั้งค่าปิดอยู่
  })

  test("ตอนร่างที่ผู้ดูแลเปิดดู → มีป้ายร่าง", () => {
    const root = content({ data: { ...PAGE, chapter: { ...PAGE.chapter, published: false } } })
    assert.equal(text(one(root, "div.rd-draft")), "ร่าง — เห็นเฉพาะผู้ดูแล")
  })

  test("เนื้อหาที่มีแต่เส้นคั่นฉาก/ว่าง → ไม่มีปุ่มฟัง และบอกว่ายังไม่มีเนื้อหา", () => {
    const root = content({ data: { ...PAGE, chapter: { ...PAGE.chapter, text: "***\n\n  \n\n---" } } })
    assert.equal(all(root, "button[aria-label=ฟังเสียงอ่าน]").length, 0)
    assert.equal(all(root, "p.rd-p").length, 0)
  })

  test("บนเซิร์ฟเวอร์/เบราว์เซอร์ที่ไม่มีเสียงอ่าน ไม่มีปุ่มฟัง (แต่ยังมีปุ่มตั้งค่า)", () => {
    const root = content()
    assert.equal(all(root, "button[aria-label=ฟังเสียงอ่าน]").length, 0)
    assert.equal(all(root, "button[aria-label=ตั้งค่าการอ่าน]").length, 1)
  })

  test("หน่วงบันทึกความคืบหน้า 0.5 วินาทีตาม spec 6.3", () => {
    assert.equal(SAVE_DELAY_MS, 500)
  })
})

describe("ช่องว่างที่ mutation พบ", () => {
  test("ย่อหน้าเดียวไม่ใช่ 'ไม่มีเนื้อหา'", () => {
    assert.equal(all(body({ paragraphs: ["ย่อหน้าเดียว"] }), "p.rd-empty").length, 0)
  })

  test("ปุ่มท้ายตอนที่ไม่มีตอนทางนั้นมี class off (CSS ทำให้จางและกดไม่ได้)", () => {
    const root = renderPage(<ReaderNavView novelId={7} prev={null} next={null} />)
    assert.equal(one(root, "span.rd-prev").attrs.class, "btn ghost rd-prev off")
    assert.equal(one(root, "span.rd-next").attrs.class, "btn ghost rd-next off")
    const both = renderPage(<ReaderNavView novelId={7} prev={1} next={3} />)
    assert.equal(all(both, ".off").length, 0)
  })

  test("โครงจำลองตอนโหลดมี 12 บรรทัด", () => {
    assert.equal(all(content({ data: null }), "div.sk-line").length, 12)
  })

  test("ReaderContent ส่งปุ่มลองใหม่ต่อให้ ErrorState และใช้ key ตามนิยาย:ตอน (เปลี่ยนตอน = สร้างหน้าอ่านใหม่ทั้งหน้า)", () => {
    const retry = () => {}
    const failed = ReaderContent({ id: 7, number: 3, data: null, error: new ApiError(500, "x"), onRetry: retry }) as never
    const states = findAll(failed, (el) => el.type === ErrorState)
    assert.equal(states.length, 1)
    assert.equal(states[0].props.onRetry, retry)
    const page = (number: number) => ReaderContent({ id: 7, number, data: { ...PAGE, chapter: { ...PAGE.chapter, number } }, error: null, onRetry: retry }) as unknown as { key: string }
    assert.equal(page(3).key, "7:3")
    assert.notEqual(page(3).key, page(4).key)
  })
})
