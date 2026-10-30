import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { Library } from "../components/Library"
import type { Progress } from "../lib/progress"
import type { NovelCardDto } from "../lib/types"
import { all, one, text, type El } from "../testing/dom"
import { findAll } from "../testing/elements"
import { restoreGlobals } from "../testing/helpers"
import { loadedSite, renderPage } from "../testing/render"
import { Home, HomeView, type HomeViewProps } from "./Home"

afterEach(restoreGlobals)

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const dto = (id: number, over: Partial<NovelCardDto> = {}): NovelCardDto => ({
  id,
  title: `Novel ${id}`,
  titleTh: `นิยาย ${id}`,
  author: "Author",
  synopsisShort: "เรื่องย่อ",
  tags: ["แฟนตาซี"],
  status: "ongoing",
  featured: false,
  hasCover: false,
  coverV: 0,
  chapterCount: 30,
  latestNumber: 30,
  updatedAt: `2026-10-${String(id).padStart(2, "0")} 00:00:00`,
  published: true,
  ...over,
})
const progress = (over: Partial<Progress> = {}): Progress => ({ number: 12, pct: 40, next: 13, at: 1, ...over })

const view = (over: Partial<HomeViewProps> = {}, options: Parameters<typeof renderPage>[1] = {}) =>
  renderPage(<HomeView novels={[dto(1), dto(2), dto(3)]} query="" isAdmin={false} siteName="koymukarnnovel" history={[]} progressOf={() => null} now={NOW} {...over} />, options)
const sectionNames = (root: El) => all(root, "section").map((section) => text(all(section, "h1").concat(all(section, "h2"))[0]).trim())

describe("HomeView: หน้าปกติ", () => {
  test("ลำดับ: Hero → (อ่านต่อ ถ้ามีประวัติ) → อัปเดตล่าสุด → นิยายทั้งหมด", () => {
    const root = view({ history: [2], progressOf: (id) => (id === 2 ? progress() : null) })
    assert.deepEqual(sectionNames(root), ["นิยาย 3", "อ่านต่อจากที่ค้างไว้", "อัปเดตล่าสุด", "นิยายทั้งหมด"])
  })

  test("ไม่มีประวัติการอ่าน → ซ่อนส่วนอ่านต่อทั้งส่วน", () => {
    assert.deepEqual(sectionNames(view()), ["นิยาย 3", "อัปเดตล่าสุด", "นิยายทั้งหมด"])
  })

  test("มี h1 เดียวของหน้า (ชื่อเว็บ ซ่อนไว้ให้โปรแกรมอ่านหน้าจอ) และหัวข้อส่วนต่างๆ เป็น h2", () => {
    const root = view()
    const h1 = all(root, "h1")
    assert.equal(h1.length, 1)
    assert.equal(h1[0].attrs.class, "sr-only")
    assert.equal(text(h1[0]), "koymukarnnovel")
    assert.equal(all(root, "h2").length, 3) // Hero, อัปเดตล่าสุด, นิยายทั้งหมด (ไม่มีประวัติ → ไม่มีอ่านต่อ)
  })

  test("Hero ใช้เรื่องแนะนำ; ถ้าไม่มี ใช้เรื่องที่อัปเดตล่าสุด", () => {
    assert.equal(text(one(view({ novels: [dto(1, { featured: true }), dto(3)] }), ".hero-title")), "นิยาย 1")
    assert.equal(text(one(view({ novels: [dto(1), dto(3)] }), ".hero-title")), "นิยาย 3")
  })

  test("Hero: เรื่องที่เคยอ่านมีปุ่ม 'อ่านต่อ ตอนที่ N' ตามความคืบหน้าของเรื่องนั้น (แม้ไม่ติด 3 เรื่องในแถวอ่านต่อ)", () => {
    const root = view({ novels: [dto(1, { featured: true })], history: [1], progressOf: () => progress({ number: 12, pct: 40 }) })
    const primary = one(one(root, "section.hero"), "a.btn.primary")
    assert.equal(text(primary).trim(), "อ่านต่อ ตอนที่ 12")
    assert.equal(primary.attrs.href, "/novel/1/12")
    const noHistory = view({ novels: [dto(1, { featured: true })], progressOf: () => progress() })
    assert.equal(text(one(one(noHistory, "section.hero"), "a.btn.primary")).trim(), "อ่านต่อ ตอนที่ 12")
  })

  test("แถวอ่านต่อ: ไม่เกิน 3 เรื่อง ตามลำดับประวัติ", () => {
    const novels = [dto(1), dto(2), dto(3), dto(4), dto(5)]
    const root = view({ novels, history: [5, 4, 3, 2, 1], progressOf: () => progress() })
    assert.deepEqual(
      all(one(root, ".resume"), "a.rcard").map((card) => card.attrs.href),
      ["/novel/5/12", "/novel/4/12", "/novel/3/12"],
    )
  })

  test("แถวอัปเดตล่าสุดมีไม่เกิน 12 เรื่อง เรียงล่าสุดก่อน", () => {
    const novels = Array.from({ length: 15 }, (_, i) => dto(i + 1))
    const row = one(view({ novels }), ".row")
    assert.deepEqual(
      all(row, "a.card").map((card) => card.attrs.href),
      Array.from({ length: 12 }, (_, i) => `/novel/${15 - i}`),
    )
  })

  test("ตารางนิยายทั้งหมดมีทุกเรื่อง (ไม่ตัดที่ 12) ทีละหน้า", () => {
    const novels = Array.from({ length: 15 }, (_, i) => dto(i + 1))
    assert.equal(all(one(view({ novels }), ".grid"), "a.card").length, 15)
  })
})

describe("HomeView: ส่งค่าต่อให้ส่วนย่อย", () => {
  test("Hero ใช้ความคืบหน้าของ 'เรื่องที่ขึ้น Hero' เท่านั้น (ไม่ใช่เรื่องอื่น)", () => {
    const root = view({ novels: [dto(1, { featured: true }), dto(2)], history: [1], progressOf: (id) => (id === 1 ? progress({ number: 7, pct: 40 }) : null) })
    assert.equal(text(one(one(root, "section.hero"), "a.btn.primary")).trim(), "อ่านต่อ ตอนที่ 7")
    const other = view({ novels: [dto(1, { featured: true }), dto(2)], history: [2], progressOf: (id) => (id === 2 ? progress({ number: 7 }) : null) })
    assert.equal(text(one(one(other, "section.hero"), "a.btn.primary")).trim(), "เริ่มอ่าน")
  })

  test("เวลา 'ใหม่' และ 'อัปเดต…ที่แล้ว' ของการ์ดในแถวอัปเดตและตารางนับจาก now ที่ส่งเข้ามา", () => {
    const root = view({ novels: [dto(22)] }) // 2026-10-22 00:00 UTC เทียบกับ NOW = 12:00 วันเดียวกัน
    assert.equal(all(one(root, ".row"), ".b-new").length, 1)
    assert.ok(all(one(root, ".row"), ".meta").some((meta) => text(meta).includes("12 ชั่วโมงที่แล้ว")))
    assert.ok(all(one(root, ".grid"), ".meta").some((meta) => text(meta).includes("12 ชั่วโมงที่แล้ว")))
  })

  test("ตารางนิยายทั้งหมดมี key ตามคำค้น: ค้นคำใหม่ = เริ่มตารางใหม่ (ตัวกรอง/จำนวนที่แสดงไม่ติดข้ามคำค้น)", () => {
    const keys = (query: string) =>
      findAll(HomeView({ novels: [dto(1), dto(2)], query, isAdmin: false, siteName: "x", history: [], progressOf: () => null, now: NOW }), (el) => el.type === Library).map((el) => el.key)
    assert.deepEqual(keys("novel"), ["novel"])
    assert.deepEqual(keys("อีกคำ"), ["อีกคำ"])
    assert.deepEqual(keys(""), [""])
  })

  test("รากของหน้าเป็น .home ทั้งหน้าปกติ ผลการค้นหา และหน้าว่าง", () => {
    for (const over of [{}, { query: "novel" }, { novels: [] }]) assert.equal(all(view(over), ".home").length, 1, JSON.stringify(over))
  })
})

describe("HomeView: ค้นหา (?q=)", () => {
  test("ซ่อน Hero อ่านต่อ และอัปเดตล่าสุด เหลือแต่ผลการค้นหา (หัวข้อเป็น h1)", () => {
    const root = view({ query: "novel 2", history: [2], progressOf: () => progress() })
    assert.deepEqual(sectionNames(root), ["ผลการค้นหา “novel 2”"])
    assert.equal(all(root, "section.hero").length, 0)
    assert.equal(all(root, ".resume").length, 0)
    assert.equal(all(root, ".row").length, 0)
    assert.equal(all(root, "h1").length, 1)
    assert.equal(all(root, "h1.sr-only").length, 0)
    assert.deepEqual(all(root, "a.card").map((card) => card.attrs.href), ["/novel/2"])
  })

  test("ไม่พบ → สถานะว่างของผลค้นหา", () => {
    const root = view({ query: "zzz" })
    assert.equal(text(one(root, ".state-title")), "ไม่พบนิยายที่ตรงกับ “zzz”")
    assert.equal(all(root, "a.card").length, 0)
  })
})

describe("HomeView: ยังไม่มีนิยาย", () => {
  test("ผู้อ่านทั่วไป → หน้าว่างที่เป็นมิตร ไม่มีลิงก์หลังบ้าน ไม่มีส่วนอื่น", () => {
    const root = view({ novels: [] })
    assert.equal(text(one(root, ".state-title")), "ยังไม่มีนิยายให้อ่าน")
    assert.ok(text(one(root, ".state-hint")).length > 0)
    assert.equal(all(root, "a").length, 0)
    assert.equal(all(root, "section").length, 0)
    assert.equal(text(one(root, "h1.sr-only")), "koymukarnnovel")
  })

  test("ผู้ดูแลที่ล็อกอินอยู่ → เห็นลิงก์ไปหลังบ้านเพื่อเพิ่มนิยาย", () => {
    const link = one(one(view({ novels: [], isAdmin: true }), ".state-actions"), "a")
    assert.equal(link.attrs.href, "/admin")
    assert.equal(text(link).trim(), "ไปหลังบ้านเพื่อเพิ่มนิยาย")
  })

  test("ค้นหาตอนที่ยังไม่มีนิยายเลย → หน้าว่างเดียวกัน (ไม่ใช่ 'ไม่พบ')", () => {
    assert.equal(text(one(view({ novels: [], query: "x" }), ".state-title")), "ยังไม่มีนิยายให้อ่าน")
  })
})

describe("Home (หน้า)", () => {
  test("ระหว่างโหลดรายการ → โครงจำลอง (ยังไม่มีข้อมูล ไม่มีหน้าขาว)", () => {
    const root = renderPage(<Home />, { state: loadedSite() })
    assert.equal(one(root, "[role=status]").attrs["aria-busy"], "true")
    assert.equal(all(root, "section").length, 0)
  })

  test("เปิดด้วย ?q= ไม่ทำให้หน้าล้ม (ยังโหลดอยู่ → โครงจำลอง)", () => {
    const root = renderPage(<Home />, { path: "/?q=lantern" })
    assert.equal(one(root, ".skeleton").attrs.role, "status")
  })
})
