import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { matchRoutes, StaticRouter, type RouteObject } from "react-router"
import { About } from "./pages/About"
import { Contact } from "./pages/Contact"
import { Home } from "./pages/Home"
import { NotFound } from "./pages/NotFound"
import { Novel } from "./pages/Novel"
import { Reader } from "./pages/Reader"
import { Layout } from "./components/Layout"
import { all, one, parse, text } from "./testing/dom"
import { App, routes } from "./App"

/** ชนิดของ element ที่หน้าใช้ (เทียบกับคอมโพเนนต์จริง ไม่ใช่ชื่อ) — route ที่ไม่มี element คืน null */
const typeOf = (route: RouteObject) => (route.element !== null && typeof route.element === "object" && "type" in route.element ? route.element.type : null)
/** เส้นทางที่ตรงกับที่อยู่ เรียงจากนอกสุดไปในสุด */
const chain = (path: string) => (matchRoutes(routes, path) ?? []).map((match) => typeOf(match.route))
const paramsOf = (path: string) => matchRoutes(routes, path)?.at(-1)?.params

describe("เส้นทางของแอป", () => {
  test("หน้าแรก / → Layout > Home", () => {
    assert.deepEqual(chain("/"), [Layout, Home])
  })

  test("หน้านิยาย /novel/:id → Layout > Novel", () => {
    assert.deepEqual(chain("/novel/12"), [Layout, Novel])
    assert.deepEqual(paramsOf("/novel/12"), { id: "12" })
  })

  test("หน้าอ่าน /novel/:id/:number → Reader เดี่ยวๆ (ไม่อยู่ใน Layout: อ่านเต็มจอ)", () => {
    assert.deepEqual(chain("/novel/12/3"), [Reader])
    assert.deepEqual(paramsOf("/novel/12/3"), { id: "12", number: "3" })
  })

  test("เกี่ยวกับ / ติดต่อ อยู่ใน Layout", () => {
    assert.deepEqual(chain("/about"), [Layout, About])
    assert.deepEqual(chain("/contact"), [Layout, Contact])
  })

  test("/admin และทุกหน้าใต้ /admin ไปที่หลังบ้านก้อนเดียว (ไม่อยู่ใน Layout) โดยส่วนที่เหลือเป็นพารามิเตอร์ *", () => {
    for (const path of ["/admin", "/admin/", "/admin/novels", "/admin/novels/3/chapters"]) {
      const matches = matchRoutes(routes, path) ?? []
      assert.equal(matches.length, 1, path)
      assert.equal(matches[0]?.route.path, "admin/*", path)
    }
    assert.equal(paramsOf("/admin/novels/3")?.["*"], "novels/3")
  })

  test("ที่อยู่ที่ไม่มีหน้า → ไม่พบหน้านี้ (ใน Layout เพื่อให้ยังมีแถบบนกลับหน้าแรกได้)", () => {
    for (const path of ["/nope", "/novel", "/novel/", "/novel/1/2/3", "/about/extra", "/contact/x/y", "/adminx", "/a/b/c/d"]) {
      assert.deepEqual(chain(path), [Layout, NotFound], path)
    }
  })

  test("ท้ายที่อยู่มี / ก็ถึงหน้าเดียวกัน", () => {
    assert.deepEqual(chain("/about/"), [Layout, About])
    assert.deepEqual(chain("/novel/12/"), [Layout, Novel])
    assert.deepEqual(chain("/novel/12/3/"), [Reader])
  })
})

describe("App (เรนเดอร์ครั้งแรก ขณะข้อมูลเว็บยังโหลดอยู่)", () => {
  const page = (path: string) => parse(renderToStaticMarkup(<StaticRouter location={path}><App /></StaticRouter>))

  test("/about: มีโครงหน้าครบ (ข้ามไปเนื้อหา แถบบน เนื้อหา ท้ายเว็บ) และเนื้อหาไม่ใช่ที่ว่าง: หัวข้อ + skeleton ระหว่างรอข้อความของเจ้าของ", () => {
    const root = page("/about")
    one(root, "a.skip-link")
    one(root, "header.top")
    one(root, "footer.foot")
    const main = one(root, "main")
    assert.equal(text(one(main, "h1")), "เกี่ยวกับเว็บนี้")
    one(main, "[role=status]")
  })

  test("/nope: แสดงหน้า 'ไม่พบหน้านี้' ในโครงหน้าปกติ พร้อมลิงก์กลับหน้าแรก", () => {
    const main = one(page("/nope"), "main")
    assert.match(text(main), /ไม่พบหน้านี้/)
    assert.equal(one(main, "a[href=\"/\"]").tag, "a")
  })

  test("/novel/1/2 (หน้าอ่าน): ไม่มีแถบบนและท้ายเว็บของโครงหน้าสาธารณะ", () => {
    const root = page("/novel/1/2")
    assert.equal(all(root, "header.top").length, 0)
    assert.equal(all(root, "footer.foot").length, 0)
  })
})

describe("App: หลังบ้านโหลดแบบ lazy", () => {
  // ต้องเป็นการเรนเดอร์ /admin ครั้งแรกในไฟล์นี้ (หลังโค้ดหลังบ้านโหลดเสร็จแล้ว จะไม่เห็น fallback อีก)
  test("ระหว่างรอโค้ดหลังบ้าน: แสดงโครงจำลองแบบบรรทัดในกรอบเนื้อหา (ไม่ใช่หน้าขาว) และไม่มีแถบบน/ท้ายเว็บของหน้าสาธารณะ", () => {
    const root = parse(renderToStaticMarkup(<StaticRouter location="/admin/novels"><App /></StaticRouter>))
    const box = one(root, "div.wrap.main")
    assert.match(one(box, "[role=status]").attrs.class, /\bskeleton-lines\b/)
    assert.equal(all(root, "header.top").length, 0)
    assert.equal(all(root, "footer.foot").length, 0)
  })
})

