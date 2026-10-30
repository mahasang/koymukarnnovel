import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import type { ReactNode } from "react"
import { all, one, text, type El } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { loadedSite, renderPage } from "../testing/render"
import type { SiteState } from "../lib/SiteContext"
import { AdminLayout, AdminLayoutView, PausedBanner, type AdminLayoutViewProps, type PausedBannerProps } from "./Layout"
import { QueueContext, type QueueValue } from "./QueueContext"
import type { QueueState } from "./types"

/** โครงหลังบ้าน: เมนูข้าง (≥900px) / แถบบน + ลิ้นชัก (<900px) / แถบเตือนคิวหยุด — พฤติกรรมในเบราว์เซอร์ตรวจแยกด้วยสคริปต์ Playwright */

const idle: QueueState = { paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: 0, current: null, waiting: [] }
const noop = () => {}

const props = (over: Partial<AdminLayoutViewProps> = {}): AdminLayoutViewProps => ({
  siteName: "นิยายของฉัน",
  passwordless: false,
  queue: idle,
  offline: false,
  menuOpen: false,
  loggingOut: false,
  logoutError: null,
  resume: { busy: false, error: null, onResume: noop },
  onToggleMenu: noop,
  onCloseMenu: noop,
  onLogout: noop,
  children: <p className="page">เนื้อหา</p>,
  ...over,
})
const render = (over: Partial<AdminLayoutViewProps> = {}, path = "/admin"): El => renderPage(<AdminLayoutView {...props(over)} />, { path })

const side = (root: El) => one(root, "aside.ad-side")
const navLinks = (root: El) => all(one(side(root), "nav"), "a")

describe("AdminLayoutView: เมนูข้าง", () => {
  test("ลำดับและปลายทางตามสเปก: แดชบอร์ด · นิยาย · เพิ่มตอน · ตั้งค่า (ในเมนู) แล้วดูหน้าเว็บ · ออกจากระบบ ท้ายเมนู", () => {
    const root = render()
    assert.deepEqual(
      navLinks(root).map((a) => [a.attrs.href, text(a)]),
      [
        ["/admin", "แดชบอร์ด"],
        ["/admin/novels", "นิยาย"],
        ["/admin/add", "เพิ่มตอน"],
        ["/admin/settings", "ตั้งค่า"],
      ],
    )
    const external = all(side(root), "a").find((a) => a.attrs.href === "/")!
    assert.equal(text(external).replace(/\s+/g, ""), "ดูหน้าเว็บ↗")
    assert.equal(external.attrs.target, "_blank")
    assert.equal(external.attrs.rel, "noopener")
    const kids = side(root).children.filter((c): c is El => typeof c !== "string")
    const order = kids.map((k) => k.tag + (k.attrs.class ? "." + k.attrs.class.split(" ")[0] : ""))
    assert.ok(order.indexOf("a.ad-it") > order.indexOf("nav.ad-nav"), "ลิงก์ดูหน้าเว็บอยู่ใต้เมนูหลัก")
    assert.equal(text(one(side(root), "button.ad-it")), "ออกจากระบบ")
  })

  test("\"เพิ่มตอน\" เป็นปุ่มเด่น (btn primary) ต่างจากรายการเมนูอื่น", () => {
    const links = navLinks(render())
    const add = links[2]!
    assert.equal(text(add), "เพิ่มตอน")
    assert.match(add.attrs.class ?? "", /\bbtn\b/)
    assert.match(add.attrs.class ?? "", /\bprimary\b/)
    for (const other of links.filter((a) => a !== add)) assert.doesNotMatch(other.attrs.class ?? "", /\bbtn\b/)
  })

  test("รายการที่เปิดอยู่มี aria-current=page และคลาส on: /admin → แดชบอร์ดเท่านั้น (ไม่ติดทุกหน้าย่อย)", () => {
    const at = (path: string) => navLinks(render({}, path)).map((a) => (a.attrs["aria-current"] === "page" ? text(a) : null)).filter(Boolean)
    assert.deepEqual(at("/admin"), ["แดชบอร์ด"])
    assert.deepEqual(at("/admin/novels"), ["นิยาย"])
    assert.deepEqual(at("/admin/novels/7"), ["นิยาย"])
    assert.deepEqual(at("/admin/novels/7/chapters/70"), ["นิยาย"])
    assert.deepEqual(at("/admin/add"), ["เพิ่มตอน"])
    assert.deepEqual(at("/admin/settings"), ["ตั้งค่า"])
    const dash = navLinks(render({}, "/admin"))[0]!
    assert.match(dash.attrs.class ?? "", /\bon\b/)
    assert.doesNotMatch(navLinks(render({}, "/admin"))[1]!.attrs.class ?? "", /\bon\b/)
  })

  test("โลโก้ในเมนูข้างพาไปแดชบอร์ด และใช้ชื่อเว็บ", () => {
    const logo = one(side(render()), "a.logo")
    assert.equal(logo.attrs.href, "/admin")
    assert.equal(text(one(logo, ".logo-name")), "นิยายของฉัน")
  })

  test("เมนูนำทางมีชื่อกำกับ และมีป้ายหมวด \"จัดการ\"", () => {
    const root = render()
    assert.equal(one(root, "nav").attrs["aria-label"], "เมนูหลังบ้าน")
    assert.equal(text(one(root, ".ad-side-label")), "จัดการ")
  })

  test("โหมดไม่มีรหัสผ่าน → ไม่มีปุ่มออกจากระบบ (ไม่มีเซสชันให้ออก)", () => {
    const root = render({ passwordless: true })
    assert.equal(all(root, "button.ad-it").length, 0)
    assert.equal(all(root, ".ad-logout").length, 0)
  })

  test("ออกจากระบบ: กด → onLogout · กำลังออก → ปุ่มถูกปิด · ล้มเหลว → ข้อความเตือนใต้ปุ่ม", () => {
    let logouts = 0
    const view = AdminLayoutView(props({ onLogout: () => logouts++ }))
    handlerOf(findTag(view, "button", (el) => String(el.props.className).includes("ad-it")), "onClick")()
    assert.equal(logouts, 1)
    const busy = render({ loggingOut: true })
    assert.equal(one(busy, "button.ad-it").attrs.disabled, "")
    assert.equal(all(render(), '[role="alert"]').length, 0)
    const failed = render({ logoutError: "ออกจากระบบไม่สำเร็จ ลองอีกครั้ง" })
    assert.equal(text(one(failed, '[role="alert"]')), "ออกจากระบบไม่สำเร็จ ลองอีกครั้ง")
  })
})

describe("AdminLayoutView: บรรทัดสถานะคิว", () => {
  test("แสดงสรุปคิว (role=status) ตามสถานะ", () => {
    const line = (queue: QueueState | null, offline = false) => text(one(render({ queue, offline }), ".ad-queue"))
    assert.equal(line(idle), "คิวว่าง")
    assert.equal(line(null), "กำลังตรวจคิว…")
    assert.equal(line({ ...idle, waitingTotal: 3 }), "รอคิว 3 ตอน")
    assert.equal(line(idle, true), "เชื่อมต่อไม่ได้ · กำลังลองใหม่")
    assert.equal(one(render(), ".ad-queue").attrs.role, "status")
  })
})

describe("AdminLayoutView: แถบบน + ลิ้นชัก (จอแคบ)", () => {
  test("ปุ่มเมนูบอกสถานะและชี้ไปที่เมนูข้าง (aria-expanded / aria-controls)", () => {
    const closed = one(one(render(), "header.ad-topbar"), "button.ad-menu-btn")
    assert.equal(closed.attrs["aria-expanded"], "false")
    assert.equal(closed.attrs["aria-controls"], side(render()).attrs.id)
    assert.equal(closed.attrs["aria-label"], "เมนู")
    const open = one(render({ menuOpen: true }), "button.ad-menu-btn")
    assert.equal(open.attrs["aria-expanded"], "true")
    assert.equal(open.attrs["aria-label"], "ปิดเมนู")
  })

  test("แถบบนมีโลโก้ที่พาไปแดชบอร์ด", () => {
    const logo = one(one(render(), "header.ad-topbar"), "a.logo")
    assert.equal(logo.attrs.href, "/admin")
  })

  test("ปุ่มเมนูเรียก onToggleMenu", () => {
    let toggled = 0
    const view = AdminLayoutView(props({ onToggleMenu: () => toggled++ }))
    handlerOf(findTag(view, "button", (el) => String(el.props.className).includes("ad-menu-btn")), "onClick")()
    assert.equal(toggled, 1)
  })

  test("ลิ้นชักปิด → ไม่มีฉากหลัง · ลิ้นชักเปิด → คลาส menu-open, มีฉากหลังที่คลิกแล้วปิด, เนื้อหาหลักเป็น inert", () => {
    assert.equal(all(render(), ".ad-drawer-scrim").length, 0)
    assert.doesNotMatch(one(render(), ".ad-shell").attrs.class ?? "", /menu-open/)
    assert.equal(one(render(), "main").attrs.inert, undefined)

    const open = render({ menuOpen: true })
    assert.match(one(open, ".ad-shell").attrs.class ?? "", /menu-open/)
    assert.equal(all(open, ".ad-drawer-scrim").length, 1)
    assert.equal(one(open, "main").attrs.inert, "")

    let closed = 0
    const view = AdminLayoutView(props({ menuOpen: true, onCloseMenu: () => closed++ }))
    handlerOf(findTag(view, "div", (el) => String(el.props.className) === "ad-drawer-scrim"), "onClick")()
    assert.equal(closed, 1)
  })
})

describe("AdminLayoutView: เนื้อหา", () => {
  test("<main id=ad-main tabindex=-1> ครอบเนื้อหาของหน้า และมีลิงก์ข้ามไปเนื้อหา", () => {
    const root = render()
    const main = one(root, "main")
    assert.equal(main.attrs.id, "ad-main")
    assert.equal(main.attrs.tabindex, "-1")
    assert.equal(text(one(main, ".page")), "เนื้อหา")
    const skip = one(root, "a.skip-link")
    assert.equal(skip.attrs.href, "#ad-main")
  })

  test("คิวไม่หยุด → ไม่มีแถบเตือน; คิวหยุด → มีแถบเตือนเหนือเนื้อหา", () => {
    assert.equal(all(render(), ".ad-banner").length, 0)
    assert.equal(all(render({ queue: null }), ".ad-banner").length, 0)
    const paused = render({ queue: { ...idle, paused: true, pausedReason: "API key ไม่ถูกต้อง" } })
    const main = one(paused, "main")
    const first = main.children.find((c): c is El => typeof c !== "string")!
    assert.match(first.attrs.class ?? "", /ad-banner/)
  })
})

describe("PausedBanner", () => {
  const banner = (over: Partial<PausedBannerProps> = {}) =>
    renderPage(<PausedBanner reason="API key ไม่ถูกต้อง" busy={false} error={null} onResume={noop} {...over} />)

  test("แสดงสาเหตุที่คิวหยุด และปุ่ม \"ทำต่อ\"", () => {
    const root = banner()
    assert.equal(text(one(root, ".ad-banner")).includes("คิวแปลหยุดอยู่"), true)
    assert.equal(text(one(root, ".ad-banner")).includes("API key ไม่ถูกต้อง"), true)
    assert.equal(text(one(root, "button")), "ทำต่อ")
    assert.equal(one(root, ".ad-banner").attrs.role, "status")
  })

  test("ไม่มีสาเหตุ (หยุดเอง) → ข้อความสำรอง ไม่ปล่อยว่าง", () => {
    for (const reason of ["", "   "]) assert.equal(text(one(banner({ reason }), ".ad-banner")).includes("หยุดไว้ชั่วคราว"), true, JSON.stringify(reason))
  })

  test("กดทำต่อ → onResume · กำลังทำ → ปิดปุ่มและบอกว่ากำลังทำ · ล้มเหลว → ข้อความใน role=alert", () => {
    let resumed = 0
    const el = PausedBanner({ reason: "x", busy: false, error: null, onResume: () => resumed++ })
    handlerOf(findTag(el, "button"), "onClick")()
    assert.equal(resumed, 1)
    const busy = banner({ busy: true })
    assert.equal(one(busy, "button").attrs.disabled, "")
    assert.equal(text(one(busy, "button")), "กำลังทำต่อ…")
    assert.equal(all(banner(), '[role="alert"]').length, 0)
    assert.equal(text(one(banner({ error: "ทำต่อไม่สำเร็จ" }), '[role="alert"]')), "ทำต่อไม่สำเร็จ")
  })
})

describe("AdminLayout (ตัวมี state): ต่อสายจริง", () => {
  const src = readFileSync(new URL("./Layout.tsx", import.meta.url), "utf8")
  test("ใช้คิวสด, ทำต่อแล้วดึงใหม่, ออกจากระบบแล้วแจ้งผู้ใช้, ปิดลิ้นชักเมื่อ Esc/เปลี่ยนหน้า/จอกว้างขึ้น", () => {
    assert.match(src, /useQueue\(\)/)
    assert.match(src, /await admin\.resume\(\)/)
    assert.match(src, /reload\(\)/)
    assert.match(src, /await admin\.logout\(\)/)
    assert.match(src, /onLoggedOut\(\)/)
    assert.match(src, /event\.key !== "Escape" \|\| !menuOpen/)
    assert.match(src, /matchMedia\("\(min-width: 900px\)"\)/)
    assert.match(src, /shouldResetScroll\(/)
    assert.match(src, /behavior: "instant"/)
    // ลิ้นชักเปิดอยู่ตอนเปลี่ยนหน้า: เนื้อหายัง inert ต้องปลดก่อนโฟกัสไม่งั้นโฟกัสไม่ติด (เจอจริงในเบราว์เซอร์)
    assert.match(src, /main\.inert = false\s+main\.focus\(\{ preventScroll: true \}\)/)
  })
})

// กันของหายเงียบๆ: ทุก element ในมุมมองมี key/ชนิดที่ React รับได้
test("ไม่มี children ซ้อนผิดชนิด: เรนเดอร์ครบโดยไม่โยน", () => {
  const node: ReactNode = <AdminLayoutView {...props({ menuOpen: true, queue: { ...idle, paused: true } })} />
  assert.ok(findAll(node, () => true).length >= 1)
})

describe("AdminLayoutView: รายละเอียดที่ต้องไม่หลุด", () => {
  test("ลิงก์ข้ามไปเนื้อหามีข้อความภาษาไทยที่อ่านออกเสียงได้", () => {
    assert.equal(text(one(render(), "a.skip-link")), "ข้ามไปยังเนื้อหาหลัก")
  })

  test("ไอคอนปุ่มเมนู: ปิดอยู่ = ขีดสามเส้น · เปิดอยู่ = กากบาท (บอกว่ากดแล้วปิด)", () => {
    const iconOf = (root: El) => one(one(root, "button.ad-menu-btn"), "svg").attrs.class ?? ""
    assert.match(iconOf(render()), /lucide-menu/)
    assert.doesNotMatch(iconOf(render()), /lucide-x/)
    assert.match(iconOf(render({ menuOpen: true })), /lucide-x/)
    assert.doesNotMatch(iconOf(render({ menuOpen: true })), /lucide-menu/)
  })

  test("\"ตั้งค่า\" เป็นรายการเมนูธรรมดาที่ไฮไลต์เมื่ออยู่หน้านั้น (ไม่ใช่ปุ่มเด่น) และรายการอื่นไม่ไฮไลต์พร้อมกัน", () => {
    const links = navLinks(render({}, "/admin/settings"))
    const settings = links.find((a) => a.attrs.href === "/admin/settings")!
    assert.equal(settings.attrs["aria-current"], "page")
    assert.match(settings.attrs.class ?? "", /\bad-it\b.*\bon\b/)
    assert.doesNotMatch(settings.attrs.class ?? "", /btn/)
    for (const a of links.filter((l) => l !== settings)) assert.equal(a.attrs["aria-current"], undefined, a.attrs.href)
  })

  test("แป้น Esc ผูกที่รากของโครง (ให้ปิดลิ้นชักได้จากทุกที่ในหน้า)", () => {
    let seen = 0
    const view = AdminLayoutView(props({ onKeyDown: () => seen++ }))
    handlerOf(view as unknown as Parameters<typeof handlerOf>[0], "onKeyDown")()
    assert.equal(seen, 1)
  })

  test("แถบเตือนได้สาเหตุ สถานะกำลังทำ ข้อความผิดพลาด และปุ่มทำต่อจาก props ของโครง", () => {
    const onResume = () => {}
    const view = AdminLayoutView(
      props({ queue: { ...idle, paused: true, pausedReason: "เครดิตหมด" }, resume: { busy: true, error: "ทำต่อไม่สำเร็จ", onResume } }),
    )
    const [banner] = findAll(view, (el) => el.type === PausedBanner)
    assert.ok(banner, "ต้องมีแถบเตือน")
    assert.equal(banner.props.reason, "เครดิตหมด")
    assert.equal(banner.props.busy, true)
    assert.equal(banner.props.error, "ทำต่อไม่สำเร็จ")
    assert.equal(banner.props.onResume, onResume)
  })
})

describe("AdminLayout (ตัวมี state): ค่าที่ต่อเข้าโครงตอนเรนเดอร์ครั้งแรก", () => {
  const stateless = (over: Partial<QueueValue> = {}, o: { passwordless?: boolean; site?: SiteState } = {}) =>
    renderPage(
      <QueueContext.Provider value={{ state: idle, errors: [], reload: noop, offline: false, ...over }}>
        <AdminLayout passwordless={o.passwordless ?? false} onLoggedOut={noop}>
          <p className="page">เนื้อหา</p>
        </AdminLayout>
      </QueueContext.Provider>,
      { path: "/admin", state: o.site },
    )

  test("ตั้งรหัสผ่านไว้ → มีปุ่มออกจากระบบ; ไม่ได้ตั้ง (passwordless) → ไม่มี · เริ่มต้นไม่มีข้อความผิดพลาดและลิ้นชักปิด", () => {
    const withPw = stateless()
    assert.equal(all(withPw, "button.ad-it").length, 1)
    assert.equal(all(withPw, '[role="alert"]').length, 0)
    assert.doesNotMatch(one(withPw, ".ad-shell").attrs.class ?? "", /menu-open/)
    assert.equal(all(stateless({}, { passwordless: true }), "button.ad-it").length, 0)
  })

  test("คิวสดไหลเข้าโครง: หยุด → แถบเตือนพร้อมสาเหตุ (ปุ่มทำต่อกดได้) · ไม่หยุด → ไม่มีแถบ · ยังไม่ได้สถานะ → กำลังตรวจคิว", () => {
    const paused = stateless({ state: { ...idle, paused: true, pausedReason: "API key ไม่ถูกต้อง" } })
    assert.match(text(one(paused, ".ad-banner")), /API key ไม่ถูกต้อง/)
    const resume = one(one(paused, ".ad-banner"), "button")
    assert.equal(text(resume), "ทำต่อ")
    assert.equal(resume.attrs.disabled, undefined)
    assert.equal(text(one(paused, ".ad-queue")), "คิวหยุดอยู่")
    assert.equal(all(stateless(), ".ad-banner").length, 0)
    assert.equal(text(one(stateless({ state: null }), ".ad-queue")), "กำลังตรวจคิว…")
  })

  test("ดึงคิวไม่สำเร็จ (offline) → บรรทัดสถานะบอกว่าเชื่อมต่อไม่ได้", () => {
    assert.equal(text(one(stateless({ offline: true }), ".ad-queue")), "เชื่อมต่อไม่ได้ · กำลังลองใหม่")
    assert.equal(text(one(stateless({ offline: false }), ".ad-queue")), "คิวว่าง")
  })

  test("ชื่อเว็บมาจากข้อมูลเว็บ; ยังโหลดไม่เสร็จ → koymukarnnovel (ไม่ปล่อยว่าง)", () => {
    const named = stateless({}, { site: loadedSite({ siteName: "นิยายของฉัน" }) })
    assert.deepEqual(
      all(named, ".logo-name").map(text),
      ["นิยายของฉัน", "นิยายของฉัน"],
    )
    const loading = stateless({}, { site: { site: null, loading: true, error: null } })
    assert.deepEqual(
      all(loading, ".logo-name").map(text),
      ["koymukarnnovel", "koymukarnnovel"],
    )
  })
})
