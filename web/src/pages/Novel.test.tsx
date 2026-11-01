import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { Route, Routes } from "react-router"
import { ErrorState } from "../components/ErrorState"
import { ApiError } from "../lib/api"
import type { Progress } from "../lib/progress"
import { KEYS } from "../lib/storage"
import type { ChapterItemDto, NovelDetailDto } from "../lib/types"
import { all, one, text, type El } from "../testing/dom"
import { restoreGlobals, installStorage } from "../testing/helpers"
import { renderPage } from "../testing/render"
import { Novel, NovelContent, NovelPage, NovelView } from "./Novel"

afterEach(restoreGlobals)

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const chapter = (number: number, over: Partial<ChapterItemDto> = {}): ChapterItemDto => ({
  number,
  title: `Chapter ${number}`,
  titleTh: `ตอน ${number}`,
  publishedAt: "2026-10-21 09:00:00",
  published: true,
  ...over,
})
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => chapter(from + i))
const detail = (over: Partial<NovelDetailDto> = {}): NovelDetailDto => ({
  id: 7,
  title: "The Last Lantern",
  titleTh: "ตะเกียงดวงสุดท้าย",
  author: "Elmer Quill",
  synopsisShort: "สั้นๆ",
  tags: ["แฟนตาซี", "ผจญภัย"],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 120,
  latestNumber: 120,
  updatedAt: "2026-10-21 09:00:00",
  published: true,
  synopsis: "ทุกดวงไฟของโลกดับลงในคืนเดียว\nเหลือเพียงตะเกียงดวงสุดท้าย",
  sourceUrl: "https://www.royalroad.com/fiction/1/x",
  licenseNote: "",
  chapters: range(1, 120),
  ...over,
})
const progress = (over: Partial<Progress> = {}): Progress => ({ number: 12, pct: 40, next: 13, at: 1, ...over })
const page = (novel: NovelDetailDto = detail(), p: Progress | null = null) => one(renderPage(<NovelView novel={novel} progress={p} now={NOW} />), "article.novel")
const cta = (root: El) => all(one(root, "div.nv-cta"), "a")

describe("NovelView: หัวเรื่อง (spec 6.2)", () => {
  test("h1 = ชื่อไทย; ชื่อต้นฉบับเป็นบรรทัดรอง; ผู้แต่ง", () => {
    const root = page()
    assert.equal(text(one(root, "h1.nv-title")), "ตะเกียงดวงสุดท้าย")
    assert.equal(text(one(root, "p.nv-orig")), "The Last Lantern")
    assert.equal(text(one(root, "p.nv-author")), "โดย Elmer Quill")
  })

  test("ไม่มีชื่อไทย → h1 เป็นชื่อต้นฉบับ ไม่ซ้ำเป็นบรรทัดรอง · ชื่อไทยกับต้นฉบับเหมือนกัน → ไม่ซ้ำ", () => {
    const noThai = page(detail({ titleTh: "  " }))
    assert.equal(text(one(noThai, "h1.nv-title")), "The Last Lantern")
    assert.equal(all(noThai, "p.nv-orig").length, 0)
    assert.equal(all(page(detail({ titleTh: " The Last Lantern " })), "p.nv-orig").length, 0)
  })

  test("ผู้แต่งว่าง → ไม่มีบรรทัดผู้แต่ง (กล่องเครดิตบอก 'ไม่ระบุ')", () => {
    assert.equal(all(page(detail({ author: "  " })), "p.nv-author").length, 0)
  })

  test("ป้ายสถานะ: ยังไม่จบ (เน้น) / จบแล้ว · จำนวนตอนนับจากรายการที่แสดง · อัปเดตเมื่อไร", () => {
    const facts = one(page(detail({ chapterCount: 999 })), "div.nv-facts")
    const pills = all(facts, "span.pill")
    assert.deepEqual(pills.map(text), ["ยังไม่จบ", "120 ตอน", "อัปเดต เมื่อวาน"])
    assert.equal(pills[0].attrs.class, "pill st")
    assert.equal(pills[1].attrs.class, "pill")
    const done = all(one(page(detail({ status: "completed" })), "div.nv-facts"), "span.pill")
    assert.equal(text(done[0]), "จบแล้ว")
    assert.equal(done[0].attrs.class, "pill")
  })

  test("จำนวนตอนดูจากรายการที่แสดง ไม่ใช่ chapterCount: รายการว่างแต่ chapterCount > 0 → ไม่มีป้าย", () => {
    const pills = all(one(page(detail({ chapters: [], chapterCount: 5, latestNumber: 5 })), "div.nv-facts"), "span.pill")
    assert.deepEqual(pills.map(text), ["ยังไม่จบ", "อัปเดต เมื่อวาน"])
  })

  test("ไม่มีตอน → ไม่มีป้ายจำนวนตอน · วันที่อัปเดตผิดรูปแบบ → ไม่มีป้ายอัปเดต", () => {
    const none = all(one(page(detail({ chapters: [], chapterCount: 0, latestNumber: null, updatedAt: "bad" })), "div.nv-facts"), "span.pill")
    assert.deepEqual(none.map(text), ["ยังไม่จบ"])
  })

  test("แท็กเป็นป้ายแยกต่อแท็ก · ไม่มีแท็ก → ไม่มีกล่องแท็ก", () => {
    assert.deepEqual(all(one(page(), "div.nv-tags"), "span.pill").map(text), ["แฟนตาซี", "ผจญภัย"])
    assert.equal(all(page(detail({ tags: [] })), "div.nv-tags").length, 0)
  })

  test("เรื่องที่ยังไม่เผยแพร่ (ผู้ดูแลเห็น) มีป้ายร่าง · เผยแพร่แล้วไม่มี", () => {
    assert.equal(all(one(page(detail({ published: false })), "div.nv-facts"), "span.draft").length, 1)
    assert.equal(all(page(), "span.draft").length, 0)
  })

  test("ปกมีคำอธิบายรูปเป็นชื่อเรื่อง (เป็นรูปเดียวของเรื่อง)", () => {
    const placeholder = one(one(page(), "div.nv-cover"), "[role=img]")
    assert.equal(placeholder.attrs["aria-label"], "ตะเกียงดวงสุดท้าย")
    const real = one(one(page(detail({ hasCover: true, coverV: 3 })), "div.nv-cover"), "img")
    assert.equal(real.attrs.alt, "ตะเกียงดวงสุดท้าย")
    assert.equal(real.attrs.src, "/covers/7?v=3")
  })
})

describe("NovelView: ปุ่มหลัก", () => {
  test("ยังไม่เคยอ่าน: 'เริ่มอ่าน' ที่ตอนแรก + 'ตอนล่าสุด' (บอกเลขตอนให้โปรแกรมอ่านหน้าจอ)", () => {
    const [start, latest] = cta(page())
    assert.equal(text(start), "เริ่มอ่าน")
    assert.equal(start.attrs.href, "/novel/7/1")
    assert.equal(start.attrs.class, "btn primary")
    assert.equal(text(latest), "ตอนล่าสุด (ตอนที่ 120)")
    assert.equal(text(one(latest, ".sr-only")), " (ตอนที่ 120)")
    assert.equal(latest.attrs.href, "/novel/7/120")
    assert.equal(latest.attrs.class, "btn ghost")
  })

  test("เคยอ่านค้าง: 'อ่านต่อ ตอนที่ N' ตามตอนที่อยู่ในรายการจริง", () => {
    const [resume, latest] = cta(page(detail(), progress()))
    assert.equal(text(resume), "อ่านต่อ ตอนที่ 12")
    assert.equal(resume.attrs.href, "/novel/7/12")
    assert.equal(latest.attrs.href, "/novel/7/120")
  })

  test("อ่านจบตอนที่เคยเป็นตอนล่าสุดแล้วมีตอนใหม่ → ไปตอนใหม่ (หน้าแรกบอก 'มีตอนใหม่' แล้วพามาที่นี่)", () => {
    const [resume] = cta(page(detail({ chapters: range(1, 14) }), progress({ number: 12, pct: 100, next: null })))
    assert.equal(text(resume), "อ่านต่อ ตอนที่ 13")
    assert.equal(resume.attrs.href, "/novel/7/13")
  })

  test("อ่านทันตอนล่าสุดแล้ว → 'อ่านซ้ำ ตอนที่ N' และไม่มีปุ่ม 'ตอนล่าสุด' ซ้ำ", () => {
    const buttons = cta(page(detail({ chapters: range(1, 14) }), progress({ number: 14, pct: 100, next: null })))
    assert.equal(buttons.length, 1)
    assert.equal(text(buttons[0]), "อ่านซ้ำ ตอนที่ 14")
  })

  test("เรื่องที่มีตอนเดียว → ปุ่มเดียว (ตอนล่าสุดคือตอนเดียวกับที่เริ่มอ่าน)", () => {
    const buttons = cta(page(detail({ chapters: [chapter(1)] })))
    assert.equal(buttons.length, 1)
    assert.equal(text(buttons[0]), "เริ่มอ่าน")
  })

  test("ตอนที่ 0 เป็นตอนแรกได้ (เริ่มอ่านที่ /0 ไม่ใช่ข้าม)", () => {
    const [start, latest] = cta(page(detail({ chapters: range(0, 5) })))
    assert.equal(start.attrs.href, "/novel/7/0")
    assert.equal(latest.attrs.href, "/novel/7/5")
  })

  test("ไม่มีตอนเลย → ไม่มีปุ่มอ่านเลย (แต่ยังมีโครงปุ่ม) และรายการตอนบอกว่ายังไม่มี", () => {
    const root = page(detail({ chapters: [], chapterCount: 0, latestNumber: null }))
    assert.equal(cta(root).length, 0)
    assert.equal(text(one(root, ".ch-empty")), "ยังไม่มีตอนให้อ่าน")
  })
})

describe("NovelView: ส่วนล่าง", () => {
  const headings = (root: El) => all(root, "section").map((section) => text(one(section, "h2")))

  test("ลำดับ: เรื่องย่อ → เครดิต → รายการตอน", () => {
    assert.deepEqual(headings(page()), ["เรื่องย่อ", "เครดิตและที่มา", "รายการตอน (120)"])
  })

  test("เรื่องย่อใช้ฉบับเต็ม (ไม่ใช่ synopsisShort) · ว่างแล้วไม่มีส่วนเรื่องย่อ", () => {
    assert.equal(one(page(), "p.nv-syn").children.join(""), "ทุกดวงไฟของโลกดับลงในคืนเดียว\nเหลือเพียงตะเกียงดวงสุดท้าย")
    assert.deepEqual(headings(page(detail({ synopsis: " " }))), ["เครดิตและที่มา", "รายการตอน (120)"])
  })

  test("กล่องเครดิตได้ผู้แต่ง ต้นฉบับ และบันทึกสิทธิ์ของเรื่อง", () => {
    const credit = one(page(detail({ licenseNote: "CC BY-NC" })), "section.credit")
    assert.deepEqual(all(credit, "div.credit-row").map((row) => text(row)), ["ผู้แต่งElmer Quill", "ต้นฉบับroyalroad.com (เปิดในแท็บใหม่)", "บันทึกสิทธิ์CC BY-NC"])
  })

  test("ลิงก์ของแถวตอนชี้ไป /novel/<เลขเรื่องนี้>/<เลขตอน>", () => {
    const hrefs = all(page(detail({ id: 31, chapters: range(1, 3) })), "a.ch-link").map((link) => link.attrs.href)
    assert.deepEqual(hrefs, ["/novel/31/3", "/novel/31/2", "/novel/31/1"])
  })

  test("ตอนที่ 0 ที่อ่านล่าสุดก็ไฮไลต์ (เลข 0 ไม่ถูกมองเป็น 'ไม่เคยอ่าน')", () => {
    const root = page(detail({ chapters: range(0, 3) }), progress({ number: 0, pct: 40, next: 1 }))
    const marked = all(root, "li.last")
    assert.equal(marked.length, 1)
    assert.equal(text(one(marked[0], ".ch-num")), "ตอนที่ 0")
  })

  test("รายการตอนไฮไลต์ตอนที่อ่านล่าสุดจากความคืบหน้า", () => {
    const root = page(detail(), progress({ number: 100 }))
    const marked = all(root, "li.last")
    assert.equal(marked.length, 1)
    assert.equal(text(one(marked[0], ".ch-num")), "ตอนที่ 100")
  })
})

describe("NovelPage: อ่านความคืบหน้าจากเครื่องผู้อ่าน", () => {
  const withProgress = (value: unknown) => installStorage({ initial: { [KEYS.progress]: JSON.stringify(value) } })
  const render = () => one(renderPage(<NovelPage novel={detail()} now={NOW} />), "article.novel")

  test("มีความคืบหน้าของเรื่องนี้ → อ่านต่อ + ไฮไลต์", () => {
    withProgress({ 7: progress() })
    const root = render()
    assert.equal(text(cta(root)[0]), "อ่านต่อ ตอนที่ 12")
  })

  test("ความคืบหน้าเป็นของเรื่องอื่น → เริ่มอ่าน", () => {
    withProgress({ 8: progress() })
    assert.equal(text(cta(render())[0]), "เริ่มอ่าน")
  })

  test("เครื่องไม่มีที่เก็บ/เก็บไม่ได้ → เริ่มอ่าน ไม่พัง", () => {
    installStorage({ absent: true })
    assert.equal(text(cta(render())[0]), "เริ่มอ่าน")
    restoreGlobals()
    installStorage({ accessThrows: true })
    assert.equal(text(cta(render())[0]), "เริ่มอ่าน")
  })

  test("ข้อมูลความคืบหน้าที่เสีย → เริ่มอ่าน", () => {
    withProgress({ 7: { number: "x", pct: 400 } })
    assert.equal(text(cta(render())[0]), "เริ่มอ่าน")
  })
})

describe("NovelContent: เลือกสิ่งที่แสดงตามผลการโหลด", () => {
  const content = (over: Partial<Parameters<typeof NovelContent>[0]> = {}) => renderPage(<NovelContent id={7} data={null} error={null} onRetry={() => {}} {...over} />)

  test("เลขนิยายใช้ไม่ได้ → ไม่พบหน้านี้", () => {
    assert.equal(text(one(content({ id: null }), "h2.state-title")), "ไม่พบหน้านี้")
  })

  test("เซิร์ฟเวอร์ตอบ 404 → ไม่พบหน้านี้ (ไม่ใช่หน้าผิดพลาด)", () => {
    const root = content({ error: new ApiError(404, "ไม่พบนิยาย", "not_found") })
    assert.equal(text(one(root, "h2.state-title")), "ไม่พบหน้านี้")
    assert.equal(all(root, ".state-error").length, 0)
  })

  test("ผิดพลาดอื่น (500, เครือข่ายล่ม) → ข้อความผิดพลาด + ปุ่มลองใหม่ที่เรียก onRetry", () => {
    for (const status of [500, 0, 403]) {
      const root = content({ error: new ApiError(status, "ข้อความจากเซิร์ฟเวอร์") })
      assert.equal(text(one(root, ".state-message")), "ข้อความจากเซิร์ฟเวอร์")
      assert.equal(text(one(one(root, ".state-actions"), "button")), "ลองใหม่")
    }
    let retried = 0
    const onRetry = () => (retried += 1)
    const tree = NovelContent({ id: 7, data: null, error: new ApiError(500, "x"), onRetry })
    assert.equal((tree as { type: unknown }).type, ErrorState)
    assert.equal((tree as { props: { onRetry: unknown } }).props.onRetry, onRetry)
    assert.equal(retried, 0)
  })

  test("กำลังโหลด → โครงจำลอง ไม่ใช่หน้าขาว", () => {
    const skeleton = one(content(), ".skeleton")
    assert.equal(skeleton.attrs.role, "status")
    assert.equal(text(one(skeleton, ".sr-only")), "กำลังโหลด…")
  })

  test("มีข้อมูล → หน้าเรื่อง", () => {
    assert.equal(text(one(content({ data: detail() }), "h1.nv-title")), "ตะเกียงดวงสุดท้าย")
  })

  test("โหลดซ้ำล้มเหลวทั้งที่มีข้อมูลเดิม → แสดงข้อผิดพลาด (เหมือนหน้าแรก) ไม่แกล้งทำเป็นสำเร็จ", () => {
    const root = content({ data: detail(), error: new ApiError(500, "ล่ม") })
    assert.equal(all(root, ".state-error").length, 1)
    assert.equal(all(root, "h1.nv-title").length, 0)
  })

  test("404 ชนะข้อมูลเดิม (เรื่องถูกถอดแล้ว)", () => {
    const root = content({ data: detail(), error: new ApiError(404, "ไม่พบ") })
    assert.equal(text(one(root, "h2.state-title")), "ไม่พบหน้านี้")
  })
})

describe("Novel (เส้นทาง /novel/:id)", () => {
  const at = (path: string) =>
    renderPage(
      <Routes>
        <Route path="/novel/:id" element={<Novel />} />
      </Routes>,
      { path },
    )

  test("เลขที่ไม่ใช่เลขนิยาย → ไม่พบหน้านี้ ทันที (ไม่รอโหลด)", () => {
    for (const path of ["/novel/abc", "/novel/0", "/novel/07", "/novel/1.5", "/novel/-3", "/novel/1e3"]) {
      const root = at(path)
      assert.equal(text(one(root, "h2.state-title")), "ไม่พบหน้านี้", path)
      assert.equal(all(root, ".skeleton").length, 0, path)
    }
  })

  test("เลขถูกต้อง → เริ่มโหลด (โครงจำลอง)", () => {
    assert.equal(all(at("/novel/5"), ".skeleton").length, 1)
  })
})
