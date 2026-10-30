import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createRef } from "react"
import { Pause, Play, RotateCw } from "lucide-react"
import { ConfirmDialog } from "../components/ConfirmDialog"
import { ErrorState } from "../components/ErrorState"
import { Skeleton } from "../components/Skeleton"
import { ApiError } from "../lib/api"
import { all, one, text, type El } from "../testing/dom"
import { findAll, findTag, handlerOf } from "../testing/elements"
import { renderPage } from "../testing/render"
import { BarChart } from "./chart"
import { ChartPanel, Dashboard, DashboardView, OnboardingPanel, ProgressPanel, QueuePanel, StatCards, UsagePanel, type DashboardViewProps, type QueuePanelProps } from "./Dashboard"
import { onboardingItems } from "./dashboard-logic"
import { QueueContext, type QueueValue } from "./QueueContext"
import type { DashboardDto, QueueError, QueueState } from "./types"

/** หน้าแดชบอร์ด: ส่วนแสดงผลทุกแผงเทสต์ด้วยการเรนเดอร์/เรียกตรง · พฤติกรรมในเบราว์เซอร์ (หยุด/ทำต่อ ลองใหม่ เผยแพร่ทั้งหมด เลื่อนข้อความ) ตรวจด้วยสคริปต์ Playwright */

const noop = () => {}
const idle: QueueState = { paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: 0, current: null, waiting: [] }
const running = (over: Partial<QueueState> = {}): QueueState => ({
  ...idle,
  current: { chapterId: 7, novelId: 2, novelTitle: "ตะเกียงดวงสุดท้าย", number: 88, chunkIndex: 1, chunkTotal: 3, textTail: "ลมหนาวพัดแรงจนเปลวไฟ" },
  ...over,
})
const failed = (id: number, over: Partial<QueueError> = {}): QueueError => ({ id, novelId: 3, novelTitle: "ดาวเคราะห์ดวงที่ 99", number: id - 30, error: "แปลไม่สำเร็จ: หมดเวลา", ...over })

const queueProps = (over: Partial<QueuePanelProps> = {}): QueuePanelProps => ({
  state: idle,
  errors: [],
  offline: false,
  toggle: { busy: false, error: null, onToggle: noop },
  retry: { busyIds: [], errors: {}, onRetry: noop },
  ...over,
})

const dto = (over: Partial<DashboardDto> = {}): DashboardDto => ({
  onboarding: { apiKey: true, contact: true, firstNovel: true },
  counts: { publishedNovels: 12, totalNovels: 13, publishedChapters: 1284, queued: 7, errors: 1, readyToPublish: 4 },
  queue: idle,
  views: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(18 + i).padStart(2, "0")}`, count: i * 10 })),
  progress: [
    { novelId: 5, title: "ภรรยาสัญญาของท่านดยุก", translated: 98, total: 140, published: 90 },
    { novelId: 6, title: "หอสมุดใต้สมุทร", translated: 0, total: 0, published: 0 },
  ],
  usage: {
    today: [{ model: "claude-sonnet-5-5", tokensIn: 1820000, tokensOut: 2410000, calls: 12 }],
    last30: [
      { model: "claude-sonnet-5-5", tokensIn: 1000, tokensOut: 500, calls: 3 },
      { model: "claude-haiku-5-5", tokensIn: 200, tokensOut: 100, calls: 2 },
    ],
  },
  estimate: { today: 0.1234, last30: null },
  api: { hasKey: true, lastOk: { at: "2026-10-30 17:28:00", ok: true, message: "" } },
  ...over,
})

const viewProps = (over: Partial<DashboardViewProps> = {}): DashboardViewProps => ({
  data: dto(),
  error: null,
  loading: false,
  onReload: noop,
  queue: queueProps(),
  publish: { open: false, notice: null, onOpen: noop, onConfirm: async () => {}, onCancel: noop, onDismissNotice: noop },
  ...over,
})

const render = (node: React.ReactNode): El => renderPage(node, { path: "/admin" })

describe("OnboardingPanel: เริ่มต้นใช้งาน", () => {
  test("ทำครบทั้งสามข้อ → ไม่แสดงอะไรเลย", () => {
    assert.equal(render(<OnboardingPanel onboarding={{ apiKey: true, contact: true, firstNovel: true }} />).children.length, 0)
  })

  test("ยังไม่ครบ: หัวข้อ จำนวนที่ทำแล้ว และ 3 ข้อเป็นลิงก์ไปหน้าที่ต้องทำ", () => {
    const root = render(<OnboardingPanel onboarding={{ apiKey: true, contact: false, firstNovel: false }} />)
    assert.equal(text(one(root, "h2")), "เริ่มต้นใช้งาน")
    assert.equal(text(one(root, "p.ad-panel-sub")), "ทำแล้ว 1 จาก 3 ข้อ")
    const items = all(root, "li.ad-onboard-item")
    assert.equal(items.length, 3)
    assert.deepEqual(
      items.map((li) => one(li, "a").attrs.href),
      ["/admin/settings", "/admin/settings", "/admin/novels/new"],
    )
    assert.deepEqual(
      items.map((li) => li.attrs["data-state"]),
      ["done", "warn", "todo"],
    )
  })

  test("ข้อที่ทำแล้วบอกโปรแกรมอ่านหน้าจอว่า 'ทำแล้ว' · ข้อช่องทางติดต่อที่ยังไม่ทำมีป้ายเตือน ข้ออื่นไม่มี", () => {
    const items = all(render(<OnboardingPanel onboarding={{ apiKey: true, contact: false, firstNovel: false }} />), "li.ad-onboard-item")
    assert.match(text(one(items[0], "strong")), /^ทำแล้ว: /)
    assert.doesNotMatch(text(one(items[1], "strong")), /ทำแล้ว/)
    assert.equal(all(items[1], "span.ad-pill").map(text).join(), "ควรทำก่อนเผยแพร่")
    assert.equal(all(items[0], "span.ad-pill").length, 0)
    assert.equal(all(items[2], "span.ad-pill").length, 0)
  })

  test("ข้อความของทุกข้อแสดงครบ: ชื่อข้อ คำแนะนำ และป้ายเตือนเป็นโทนเตือน · รายการเชื่อมกับหัวข้อ", () => {
    const root = render(<OnboardingPanel onboarding={{ apiKey: false, contact: false, firstNovel: false }} />)
    assert.equal(one(root, "section.ad-onboard").attrs["aria-labelledby"], one(root, "h2").attrs.id)
    const items = all(one(root, "ol.ad-onboard-list"), "li.ad-onboard-item")
    assert.deepEqual(items.map((li) => text(one(li, "strong"))), ["ตั้งรหัส API สำหรับแปล", "กรอกช่องทางติดต่อเจ้าของลิขสิทธิ์", "สร้างนิยายเรื่องแรก"])
    assert.deepEqual(
      items.map((li) => text(one(li, "span.ad-onboard-hint"))),
      onboardingItems({ apiKey: false, contact: false, firstNovel: false }).map((item) => item.hint),
    )
    assert.equal(one(items[1], "span.ad-pill").attrs["data-tone"], "warn")
  })

  test("ไอคอนตกแต่งซ่อนจากโปรแกรมอ่านหน้าจอ (วงกลมลำดับและลูกศรท้ายแถว)", () => {
    const items = all(render(<OnboardingPanel onboarding={{ apiKey: false, contact: false, firstNovel: false }} />), "li.ad-onboard-item")
    for (const li of items) {
      assert.equal(one(li, "span.ad-onboard-mark").attrs["aria-hidden"], "true")
      const chevron = all(li, "svg").at(-1)
      assert.equal(chevron?.attrs["aria-hidden"], "true")
    }
  })

  test("ข้อที่ยังไม่ทำแสดงเลขลำดับ ข้อที่ทำแล้วแสดงเครื่องหมายถูก (ไอคอน)", () => {
    const items = all(render(<OnboardingPanel onboarding={{ apiKey: true, contact: true, firstNovel: false }} />), "li.ad-onboard-item")
    assert.equal(text(one(items[2], "span.ad-onboard-mark")), "3")
    assert.equal(text(one(items[0], "span.ad-onboard-mark")), "")
    assert.equal(all(items[0], "svg").length >= 1, true)
  })
})

describe("StatCards: การ์ดตัวเลข", () => {
  const cards = (props: Partial<React.ComponentProps<typeof StatCards>> = {}) =>
    all(render(<StatCards counts={dto().counts} translating={false} onPublishAll={noop} {...props} />), "div.ad-stat")
  const label = (card: El) => text(one(card, "p.ad-stat-label"))
  const value = (card: El) => text(one(card, "p.ad-stat-value"))

  test("5 การ์ดตามสเปก พร้อมตัวเลขแบ่งหลักพัน", () => {
    const list = cards()
    assert.deepEqual(list.map(label), ["นิยายที่เผยแพร่", "ตอนที่เผยแพร่แล้ว", "รอคิวแปล", "ผิดพลาด", "แปลแล้ว ยังไม่เผยแพร่"])
    assert.deepEqual(list.map(value), ["12 / 13", "1,284", "7", "1", "4"])
  })

  test("คำใต้ตัวเลขของการ์ดนิยาย: ไม่มีเรื่อง / ซ่อนอยู่ N เรื่อง / เผยแพร่ครบ", () => {
    const hint = (counts: Partial<DashboardDto["counts"]>) => text(one(cards({ counts: { ...dto().counts, ...counts } })[0], "p.ad-stat-hint"))
    assert.equal(hint({ publishedNovels: 0, totalNovels: 0 }), "ยังไม่มีนิยาย")
    assert.equal(hint({ publishedNovels: 12, totalNovels: 13 }), "ซ่อนอยู่ 1 เรื่อง")
    assert.equal(hint({ publishedNovels: 3, totalNovels: 3 }), "เผยแพร่ครบทุกเรื่อง")
  })

  test("การ์ดรอคิวบอกว่ากำลังแปลอยู่หรือไม่", () => {
    assert.equal(text(one(cards({ translating: true })[2], "p.ad-stat-hint")), "กำลังแปลอยู่ 1 ตอน")
    assert.equal(text(one(cards({ translating: false })[2], "p.ad-stat-hint")), "ไม่มีตอนกำลังแปล")
  })

  test("การ์ดผิดพลาดขึ้นสีแดง (data-tone=fail) เมื่อมีตอนผิดพลาดเท่านั้น", () => {
    assert.equal(cards()[3].attrs["data-tone"], "fail")
    assert.equal(cards({ counts: { ...dto().counts, errors: 0 } })[3].attrs["data-tone"], "calm")
    assert.equal(text(one(cards({ counts: { ...dto().counts, errors: 0 } })[3], "p.ad-stat-hint")), "ไม่มีตอนผิดพลาด")
    assert.equal(cards()[0].attrs["data-tone"], undefined)
  })

  test("ส่วนหัวของการ์ดมีชื่อ · ไอคอนซ่อนจากโปรแกรมอ่านหน้าจอ · คำใต้ตัวเลขของการ์ดตอนที่เผยแพร่/ผิดพลาด", () => {
    const root = render(<StatCards counts={dto().counts} translating={false} onPublishAll={noop} />)
    assert.equal(one(root, "section.ad-stats").attrs["aria-label"], "สรุปตัวเลข")
    const list = all(root, "div.ad-stat")
    for (const card of list) assert.equal(one(card, "svg").attrs["aria-hidden"], "true")
    assert.equal(text(one(list[1], "p.ad-stat-hint")), "นับรวมทุกเรื่อง")
    assert.equal(text(one(list[3], "p.ad-stat-hint")), "ดูรายการในคิวแปลแล้วกดลองใหม่") // ผิดพลาด 1 ตอน
  })

  test("\"เผยแพร่ทั้งหมด\": ค้างเพียง 1 ตอนก็มีปุ่ม · ปุ่มเป็นปุ่มปกติ (ไม่ส่งฟอร์ม) แบบ primary ขนาดเล็ก", () => {
    const one1 = render(<StatCards counts={{ ...dto().counts, readyToPublish: 1 }} translating={false} onPublishAll={noop} />)
    const button = one(all(one1, "div.ad-stat")[4], "button")
    assert.equal(button.attrs.type, "button")
    assert.equal(button.attrs.class, "btn primary sm ad-stat-action")
    assert.equal(text(button), "เผยแพร่ทั้งหมด")
  })

  test("\"เผยแพร่ทั้งหมด\": มีตอนค้างจึงมีปุ่ม กดแล้วเรียก onPublishAll · ไม่มีตอนค้างไม่มีปุ่ม", () => {
    let calls = 0
    const tree = StatCards({ counts: dto().counts, translating: false, onPublishAll: () => calls++ })
    const button = findTag(tree, "button")
    assert.equal(button.props.children, "เผยแพร่ทั้งหมด")
    handlerOf(button, "onClick")()
    assert.equal(calls, 1)
    const none = StatCards({ counts: { ...dto().counts, readyToPublish: 0 }, translating: false, onPublishAll: noop })
    assert.equal(findAll(none, (el) => el.type === "button").length, 0)
    assert.equal(text(one(cards({ counts: { ...dto().counts, readyToPublish: 0 } })[4], "p.ad-stat-hint")), "ไม่มีตอนค้างเผยแพร่")
  })
})

describe("QueuePanel: คิวแปลสด", () => {
  const panel = (over: Partial<QueuePanelProps> = {}) => render(<QueuePanel {...queueProps(over)} />)

  test("ยังไม่ได้สถานะคิว: โครงจำลอง ไม่มีปุ่มหยุด/ทำต่อ (ไม่รู้ว่าหยุดอยู่หรือไม่)", () => {
    const root = panel({ state: null })
    assert.equal(all(root, "div.skeleton").length, 1)
    assert.equal(all(root, "button").length, 0)
    assert.equal(text(one(root, "p.ad-panel-sub")), "แปลทีละตอนตามลำดับ")
  })

  test("คิวว่าง: ข้อความคิวว่าง และปุ่ม 'หยุดคิว'", () => {
    const root = panel()
    assert.equal(text(one(root, "p.ad-empty")), "คิวว่าง — ยังไม่มีตอนรอแปล")
    assert.equal(text(one(root, "button.btn")), "หยุดคิว")
    assert.equal(text(one(root, "p.ad-panel-sub")), "แปลทีละตอนตามลำดับ · เหลือ 0 ตอน")
  })

  test("ปุ่มหยุด/ทำต่อ: ไอคอนตรงกับการกระทำ (หยุด = ‖ · ทำต่อ = ▶) และเป็นปุ่ม ghost ขนาดเล็ก", () => {
    const running1 = QueuePanel(queueProps({ state: idle }))
    assert.equal(findAll(running1, (el) => el.type === Pause).length, 1)
    assert.equal(findAll(running1, (el) => el.type === Play).length, 0)
    const paused = QueuePanel(queueProps({ state: { ...idle, paused: true } }))
    assert.equal(findAll(paused, (el) => el.type === Play).length, 1)
    assert.equal(findAll(paused, (el) => el.type === Pause).length, 0)
    assert.equal(one(panel(), "button.btn").attrs.class, "btn ghost sm")
    assert.equal(one(panel(), "button.btn").attrs.type, "button")
  })

  test("จำนวนที่เหลือแบ่งหลักพัน", () => {
    assert.equal(text(one(panel({ state: running({ waitingTotal: 1499 }) }), "p.ad-panel-sub")), "แปลทีละตอนตามลำดับ · เหลือ 1,500 ตอน")
  })

  test("โครงจำลองระหว่างรอสถานะคิวมี 3 บรรทัด", () => {
    const [skeleton] = findAll(QueuePanel(queueProps({ state: null })), (el) => el.type === Skeleton)
    assert.equal(skeleton.props.variant, "lines")
    assert.equal(skeleton.props.count, 3)
  })

  test("คิวหยุดอยู่: ปุ่มเป็น 'ทำต่อ' และข้อความบอกวิธีทำต่อ", () => {
    const root = panel({ state: { ...idle, paused: true } })
    assert.equal(text(one(root, "button.btn")), "ทำต่อ")
    assert.match(text(one(root, "p.ad-empty")), /คิวหยุดอยู่/)
  })

  test("ปุ่มหยุด/ทำต่อเรียก toggle.onToggle · ระหว่างสั่งปุ่มถูกปิดและบอกว่ากำลังสั่ง", () => {
    let calls = 0
    const tree = QueuePanel(queueProps({ toggle: { busy: false, error: null, onToggle: () => calls++ } }))
    handlerOf(findTag(tree, "button"), "onClick")()
    assert.equal(calls, 1)
    const busy = panel({ toggle: { busy: true, error: null, onToggle: noop } })
    assert.equal(one(busy, "button.btn").attrs.disabled !== undefined, true)
    assert.equal(text(one(busy, "button.btn")), "กำลังสั่ง…")
  })

  test("สั่งไม่สำเร็จ: แสดงข้อความผิดพลาด (role=alert)", () => {
    const root = panel({ toggle: { busy: false, error: "หยุดคิวไม่สำเร็จ ลองอีกครั้ง", onToggle: noop } })
    const alert = one(root, "p.ad-inline-error")
    assert.equal(alert.attrs.role, "alert")
    assert.equal(text(alert), "หยุดคิวไม่สำเร็จ ลองอีกครั้ง")
  })

  test("ตอนที่กำลังแปล: ชื่อเรื่อง · ตอนที่ N เป็นลิงก์ไปหน้าแก้ตอน, ส่วนที่แปลอยู่, แถบความคืบหน้า", () => {
    const root = panel({ state: running({ waitingTotal: 2 }) })
    const title = one(one(root, "p.ad-cur-title"), "a")
    assert.equal(text(title), "ตะเกียงดวงสุดท้าย · ตอนที่ 88")
    assert.equal(title.attrs.href, "/admin/novels/2/chapters/7")
    assert.equal(text(one(root, "p.ad-cur-sub")), "กำลังแปล ส่วนที่ 2 จาก 3")
    const meter = one(root, "div.ad-meter")
    assert.equal(meter.attrs.role, "progressbar")
    assert.equal(meter.attrs["aria-valuenow"], "33")
    assert.equal(meter.attrs["aria-valuemin"], "0")
    assert.equal(meter.attrs["aria-valuemax"], "100")
    assert.equal(one(meter, "div.ad-meter-fill").attrs.style, "width:33%")
    assert.equal(meter.attrs["aria-label"], "ความคืบหน้าของตอนที่กำลังแปล")
    assert.equal(one(root, "span.ad-spin").attrs["aria-hidden"], "true")
    assert.equal(text(one(root, "p.ad-panel-sub")), "แปลทีละตอนตามลำดับ · เหลือ 3 ตอน") // 2 ที่รอ + 1 ที่กำลังแปล
    assert.equal(all(root, "p.ad-empty").length, 0)
  })

  test("ข้อความที่กำลังไหล: อยู่ในกล่องที่โฟกัสด้วยแป้นพิมพ์ได้ (เลื่อนอ่านได้) พร้อมชื่อบอกโปรแกรมอ่านหน้าจอ · ยังไม่มีข้อความ → ข้อความรอ", () => {
    const live = one(panel({ state: running() }), "div.ad-live")
    assert.equal(text(live), "ลมหนาวพัดแรงจนเปลวไฟ")
    assert.equal(live.attrs.tabindex, "0")
    assert.equal(live.attrs.role, "region")
    assert.equal(live.attrs["aria-label"], "ข้อความที่กำลังแปล")
    assert.equal(live.attrs["aria-live"], undefined, "ข้อความไหลทุก 2 วินาที ห้ามประกาศทุกครั้ง")
    const empty = running()
    empty.current!.textTail = ""
    assert.equal(text(one(panel({ state: empty }), "div.ad-live")), "รอข้อความแรก…")
  })

  test("กล่องข้อความผูก ref และ onScroll ที่ตัวถือสถานะส่งมา (ใช้เลื่อนลงท้ายสุด)", () => {
    const ref = createRef<HTMLDivElement>()
    const onTailScroll = () => {}
    const tree = QueuePanel(queueProps({ state: running(), tailRef: ref, onTailScroll }))
    const live = findTag(tree, "div", (el) => el.props.className === "ad-live")
    assert.equal(live.props.ref, ref)
    assert.equal(live.props.onScroll, onTailScroll)
  })

  test("ไม่มีตอนที่กำลังแปล → ไม่มีกล่องข้อความ", () => {
    assert.equal(all(panel(), "div.ad-live").length, 0)
    assert.equal(all(panel(), "div.ad-cur").length, 0)
  })

  test("ตอนที่รอ: แถว 'ตอนที่ N' + ชื่อเรื่อง (ลิงก์) + ป้าย 'รอคิว'", () => {
    const waiting = [
      { id: 21, novelId: 2, novelTitle: "ตะเกียงดวงสุดท้าย", number: 89 },
      { id: 22, novelId: 2, novelTitle: "ตะเกียงดวงสุดท้าย", number: 90 },
    ]
    const rows = all(one(panel({ state: running({ waiting, waitingTotal: 2 }) }), "ul[aria-label=ตอนที่รอแปล]"), "li.ad-row")
    assert.equal(rows.length, 2)
    assert.equal(text(one(rows[0], "span.ad-row-num")), "ตอนที่ 89")
    assert.equal(one(one(rows[0], "span.ad-row-title"), "a").attrs.href, "/admin/novels/2/chapters/21")
    assert.equal(text(one(rows[1], "span.ad-pill")), "รอคิว")
    assert.equal(one(rows[1], "span.ad-pill").attrs["data-tone"], "warn")
    assert.equal(text(one(one(rows[0], "span.ad-row-title"), "a")), "ตะเกียงดวงสุดท้าย")
    assert.equal(all(panel({ state: running({ waiting, waitingTotal: 2 }) }), "li.ad-more").length, 0)
  })

  test("รอเพียง 1 ตอนก็แสดงรายการ · เกินเพดานเพียง 1 ตอนก็บอก 'และอีก 1 ตอน'", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, novelId: 2, novelTitle: "ก", number: i + 1 }))
    assert.equal(all(panel({ state: running({ waiting: rows(1), waitingTotal: 1 }) }), "li.ad-row").length, 1)
    const nine = panel({ state: running({ waiting: rows(9), waitingTotal: 9 }) })
    assert.equal(all(nine, "li.ad-row").length, 8)
    assert.equal(text(one(nine, "li.ad-more")), "และอีก 1 ตอน")
  })

  test("รอเกิน 8 ตอน: จำนวนที่เหลือแบ่งหลักพัน", () => {
    const waiting = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i, novelId: 2, novelTitle: "ก", number: i + 1 }))
    assert.equal(text(one(panel({ state: running({ waiting, waitingTotal: 1500 }) }), "li.ad-more")), "และอีก 1,492 ตอน")
  })

  test("รอเกิน 8 ตอน: โชว์ 8 แถวแล้วบอก 'และอีก N ตอน' ตามจำนวนรอทั้งหมด", () => {
    const waiting = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i, novelId: 2, novelTitle: "ก", number: i + 1 }))
    const root = panel({ state: running({ waiting, waitingTotal: 130 }) })
    assert.equal(all(root, "li.ad-row").length, 8)
    assert.equal(text(one(root, "li.ad-more")), "และอีก 122 ตอน")
  })

  test("ตอนผิดพลาด: แถวละตอน (เลขตอน ชื่อเรื่อง ข้อความผิดพลาด) พร้อมปุ่ม 'ผิดพลาด · ลองใหม่'", () => {
    const root = panel({ errors: [failed(46), failed(47, { error: "หมดเวลา" })] })
    const list = one(root, "ul[aria-label=ตอนที่แปลผิดพลาด]")
    const rows = all(list, "li.ad-row")
    assert.equal(rows.length, 2)
    assert.equal(text(one(rows[0], "span.ad-row-num")), "ตอนที่ 16")
    assert.equal(one(one(rows[0], "span.ad-row-title"), "a").attrs.href, "/admin/novels/3/chapters/46")
    assert.equal(text(one(rows[0], "span.ad-row-err")), "แปลไม่สำเร็จ: หมดเวลา")
    assert.equal(one(rows[0], "span.ad-row-err").attrs.title, "แปลไม่สำเร็จ: หมดเวลา")
    assert.equal(text(one(rows[1], "button.ad-retry")), "ผิดพลาด · ลองใหม่")
    assert.equal(text(one(one(rows[0], "span.ad-row-title"), "a")), "ดาวเคราะห์ดวงที่ 99")
    assert.equal(one(list, "button.ad-retry").attrs.type, "button")
    const [errorRow] = findAll(QueuePanel(queueProps({ errors: [failed(46)] })), (el) => "tail" in el.props)
    assert.equal(findAll(errorRow.props.tail as never, (el) => el.type === RotateCw).length, 1)
    assert.equal(list.attrs.class, "ad-rows ad-rows-errors")
    assert.match(one(rows[1], "button.ad-retry").attrs["aria-label"] ?? "", /ลองแปลตอนที่ 17 ของ ดาวเคราะห์ดวงที่ 99 ใหม่/)
  })

  test("ปุ่มลองใหม่เรียก retry.onRetry ด้วยรหัสตอนของแถวนั้น", () => {
    const calls: number[] = []
    const tree = QueuePanel(queueProps({ errors: [failed(46), failed(47)], retry: { busyIds: [], errors: {}, onRetry: (id) => calls.push(id) } }))
    // ปุ่มอยู่ในพร็อป tail ของแถว (ChapterRow ยังไม่ถูกขยาย) จึงหาจากแถวก่อน
    const buttons = findAll(tree, (el) => "tail" in el.props).map((row) => findTag(row.props.tail as never, "button"))
    assert.equal(buttons.length, 2)
    handlerOf(buttons[1], "onClick")()
    handlerOf(buttons[0], "onClick")()
    assert.deepEqual(calls, [47, 46])
  })

  test("กำลังส่งตอนใดตอนหนึ่งใหม่: เฉพาะปุ่มของตอนนั้นถูกปิดและเปลี่ยนข้อความ · ลองไม่สำเร็จ: ข้อความอยู่ใต้แถวนั้นเท่านั้น", () => {
    const root = panel({ errors: [failed(46), failed(47)], retry: { busyIds: [46], errors: { 47: "ยังไม่ได้ตั้งรหัส API" }, onRetry: noop } })
    const rows = all(root, "li.ad-row")
    const [a, b] = rows.map((row) => one(row, "button.ad-retry"))
    assert.equal(a.attrs.disabled !== undefined, true)
    assert.equal(text(a), "กำลังส่ง…")
    assert.equal(b.attrs.disabled, undefined)
    assert.equal(all(rows[0], "p.ad-inline-error").length, 0)
    const alert = one(rows[1], "p.ad-inline-error")
    assert.equal(alert.attrs.role, "alert")
    assert.equal(text(alert), "ยังไม่ได้ตั้งรหัส API")
  })

  test("ตอนผิดพลาดที่ไม่มีข้อความ → ไม่แสดงบรรทัดข้อความว่าง", () => {
    assert.equal(all(panel({ errors: [failed(46, { error: "" })] }), "span.ad-row-err").length, 0)
  })

  test("ข้อความลองใหม่ไม่สำเร็จเป็นของตอนนั้นตามรหัสตอน (ไม่ใช่เลขตอน)", () => {
    const root = panel({ errors: [failed(46), failed(47)], retry: { busyIds: [47], errors: { 46: "ก", 16: "ผิดแถว", 17: "ผิดแถว" }, onRetry: noop } })
    const [a, b] = all(root, "li.ad-row")
    assert.equal(text(one(a, "p.ad-inline-error")), "ก")
    assert.equal(all(b, "p.ad-inline-error").length, 0)
    assert.equal(text(one(b, "button.ad-retry")), "กำลังส่ง…")
    assert.equal(text(one(a, "button.ad-retry")), "ผิดพลาด · ลองใหม่")
  })

  test("ไม่มีตอนผิดพลาด → ไม่มีรายการผิดพลาด", () => {
    assert.equal(all(panel(), "ul.ad-rows-errors").length, 0)
  })

  test("ตอนผิดพลาดแสดงแม้ไม่มีตอนที่กำลังแปลหรือรอ (แค่รายการผิดพลาดอย่างเดียว)", () => {
    const root = panel({ errors: [failed(46)] })
    assert.equal(all(root, "li.ad-row").length, 1)
    assert.equal(text(one(root, "p.ad-empty")), "คิวว่าง — ยังไม่มีตอนรอแปล")
  })

  test("เชื่อมต่อคิวไม่ได้: แจ้งว่าสิ่งที่เห็นอาจเก่า (ยังแสดงสถานะครั้งก่อนไว้)", () => {
    const root = panel({ offline: true, state: running() })
    assert.match(text(one(root, "p.ad-note")), /เชื่อมต่อคิวไม่ได้/)
    assert.equal(one(root, "p.ad-note").attrs.role, "status")
    assert.equal(all(root, "div.ad-cur").length, 1)
    assert.equal(all(panel(), "p.ad-note").length, 0)
  })
})

describe("ChartPanel / ProgressPanel", () => {
  test("ยอดอ่าน 14 วัน: หัวข้อ ยอดรวม และกราฟ 14 แท่ง", () => {
    const root = render(<ChartPanel views={dto().views} />)
    assert.equal(text(one(root, "h2")), "ยอดอ่าน 14 วัน")
    assert.equal(text(one(root, "p.ad-panel-sub")), "รวม 910 ครั้ง") // 0+10+…+130
    assert.equal(all(root, "rect.ad-bar").length, 14)
    assert.equal(one(root, "section.ad-panel").attrs["aria-labelledby"], one(root, "h2").attrs.id)
  })

  test("ยอดรวมแบ่งหลักพัน · กราฟรับข้อมูลทั้ง 14 วันของแดชบอร์ด", () => {
    const views = dto().views.map((view) => ({ ...view, count: 100 * (1 + (Number(view.day.slice(-2)) % 3)) + 34 }))
    const tree = ChartPanel({ views })
    assert.equal(findAll(tree, (el) => el.type === BarChart)[0].props.views, views)
    assert.match(text(one(render(<ChartPanel views={views} />), "p.ad-panel-sub")), /^รวม [\d,]+ ครั้ง$/)
    assert.equal(text(one(render(<ChartPanel views={[{ day: "2026-10-31", count: 1234 }]} />), "p.ad-panel-sub")), "รวม 1,234 ครั้ง")
  })

  test("ความคืบหน้าแต่ละเรื่อง: ชื่อเป็นลิงก์ไปหน้าจัดการเรื่อง, แปลแล้ว/ทั้งหมด, เปอร์เซ็นต์, ที่เผยแพร่แล้ว", () => {
    const root = render(<ProgressPanel progress={dto().progress} />)
    const rows = all(one(root, "ul.ad-prog"), "li")
    assert.equal(rows.length, 2)
    assert.equal(one(rows[0], "a.ad-prog-title").attrs.href, "/admin/novels/5")
    assert.equal(text(one(rows[0], "a.ad-prog-title")), "ภรรยาสัญญาของท่านดยุก")
    assert.equal(text(one(rows[0], "span.ad-prog-count")), "98 / 140")
    assert.equal(one(rows[0], "div.ad-meter").attrs["aria-valuenow"], "70")
    assert.equal(one(rows[0], "div.ad-meter-fill").attrs.style, "width:70%")
    assert.equal(text(one(rows[0], "p.ad-prog-sub")), "เผยแพร่แล้ว 90 ตอน")
    assert.match(one(rows[0], "div.ad-meter").attrs["aria-label"] ?? "", /ภรรยาสัญญาของท่านดยุก/)
  })

  test("หัวข้อย่อยและแถบความคืบหน้า: ชื่อบอกโปรแกรมอ่านหน้าจอ ค่าสูงสุด 100 · ตัวเลขแบ่งหลักพัน", () => {
    const root = render(<ProgressPanel progress={[{ novelId: 9, title: "เรื่องยาว", translated: 1200, total: 2400, published: 1100 }]} />)
    assert.equal(text(one(root, "p.ad-panel-sub")), "แปลแล้ว / ตอนที่เพิ่มไว้")
    assert.equal(text(one(root, "span.ad-prog-count")), "1,200 / 2,400")
    assert.equal(text(one(root, "p.ad-prog-sub")), "เผยแพร่แล้ว 1,100 ตอน")
    const meter = one(root, "div.ad-meter")
    assert.equal(meter.attrs.role, "progressbar")
    assert.equal(meter.attrs["aria-valuemax"], "100")
    assert.equal(meter.attrs["aria-valuemin"], "0")
    assert.equal(meter.attrs["aria-valuenow"], "50")
  })

  test("เรื่องที่ยังไม่มีตอน: 0 / 0 และแถบ 0% (ไม่มี NaN)", () => {
    const list = one(render(<ProgressPanel progress={dto().progress} />), "ul.ad-prog")
    const second = all(list, "li")[1]
    assert.equal(text(one(second, "span.ad-prog-count")), "0 / 0")
    assert.equal(one(second, "div.ad-meter").attrs["aria-valuenow"], "0")
    assert.equal(one(second, "div.ad-meter-fill").attrs.style, "width:0%")
  })

  test("ยังไม่มีนิยาย → ข้อความชวนเพิ่มเรื่องแรก ไม่มีรายการ", () => {
    const root = render(<ProgressPanel progress={[]} />)
    assert.match(text(one(root, "p.ad-empty")), /ยังไม่มีนิยาย/)
    assert.equal(all(root, "ul.ad-prog").length, 0)
  })
})

describe("UsagePanel: การใช้ AI และสถานะ API", () => {
  const panel = (over: Partial<Pick<DashboardDto, "usage" | "estimate" | "api">> = {}) => {
    const data = dto()
    return render(<UsagePanel usage={over.usage ?? data.usage} estimate={over.estimate ?? data.estimate} api={over.api ?? data.api} />)
  }
  const blocks = (root: El) => all(root, "div.ad-usage")

  test("สองช่วง: วันนี้ และ 30 วันล่าสุด", () => {
    const list = blocks(panel())
    assert.deepEqual(list.map((block) => text(one(block, "h3"))), ["วันนี้", "30 วันล่าสุด"])
  })

  test("ตารางต่อโมเดล: เข้า ออก ครั้ง แบ่งหลักพัน · มีแถว 'รวม' เมื่อมีมากกว่าหนึ่งโมเดล", () => {
    const [today, month] = blocks(panel())
    const todayRows = all(one(today, "tbody"), "tr")
    assert.equal(todayRows.length, 1)
    assert.deepEqual(all(todayRows[0], "td").map(text), ["1,820,000", "2,410,000", "12"])
    assert.equal(text(one(todayRows[0], "th")), "claude-sonnet-5-5")
    const monthRows = all(one(month, "tbody"), "tr")
    assert.equal(monthRows.length, 3)
    assert.equal(monthRows[2].attrs.class, "ad-table-total")
    assert.equal(text(one(monthRows[2], "th")), "รวม")
    assert.deepEqual(all(monthRows[2], "td").map(text), ["1,200", "600", "5"])
  })

  test("ตารางอยู่ในกรอบเลื่อนแนวนอนที่โฟกัสด้วยแป้นพิมพ์ได้ พร้อมชื่อ", () => {
    const scroll = one(blocks(panel())[0], "div.ad-scroll")
    assert.equal(scroll.attrs.tabindex, "0")
    assert.equal(scroll.attrs.role, "region")
    assert.match(scroll.attrs["aria-label"] ?? "", /วันนี้/)
  })

  test("หัวตารางตามลำดับ โมเดล · เข้า · ออก · ครั้ง (scope=col) และหัวข้อแผง", () => {
    const root = panel()
    assert.equal(text(one(root, "h2")), "การใช้งาน AI")
    assert.equal(text(one(root, "p.ad-panel-sub")), "โทเคนที่ใช้แปลและสรุป")
    const heads = all(one(blocks(root)[0], "thead"), "th")
    assert.deepEqual(heads.map(text), ["โมเดล", "เข้า", "ออก", "ครั้ง"])
    for (const th of heads) assert.equal(th.attrs.scope, "col")
  })

  test("ค่าใช้จ่ายโดยประมาณ: ตัวเลขดอลลาร์ถ้าประเมินได้ · ประเมินไม่ได้ → ข้อความพร้อมลิงก์ไปตั้งค่า", () => {
    const [today, month] = blocks(panel())
    assert.equal(text(one(one(today, "p.ad-usage-est"), "strong")), "$0.1234")
    assert.equal(text(one(one(month, "p.ad-usage-est"), "a")), "ตั้งค่า")
    assert.equal(text(one(today, "p.ad-usage-est")), "ค่าใช้จ่ายโดยประมาณ $0.1234")
    const hint = one(month, "p.ad-usage-est")
    assert.match(text(hint), /ประเมินค่าใช้จ่ายไม่ได้/)
    assert.equal(one(hint, "a").attrs.href, "/admin/settings")
  })

  test("ยังไม่เคยใช้ AI ในช่วงนั้น → 'ยังไม่ได้ใช้ AI' ไม่มีตาราง และประมาณ $0.00", () => {
    const root = panel({ usage: { today: [], last30: [] }, estimate: { today: 0, last30: 0 } })
    for (const block of blocks(root)) {
      assert.equal(text(one(block, "p.ad-empty")), "ยังไม่ได้ใช้ AI")
      assert.equal(all(block, "table").length, 0)
      assert.equal(text(one(block, "p.ad-usage-est")), "ค่าใช้จ่ายโดยประมาณ $0.00")
    }
  })

  test("สถานะ API: ทดสอบผ่าน → ป้ายเขียว 'API พร้อมใช้งาน' พร้อมเวลาไทย", () => {
    const root = panel()
    const pill = one(one(root, "div.ad-api"), "span.ad-pill")
    assert.equal(pill.attrs["data-tone"], "ok")
    assert.equal(text(pill), "API พร้อมใช้งาน")
    assert.equal(text(one(one(root, "div.ad-api"), "span.ad-api-label")), "เชื่อมต่อ API")
    assert.equal(all(pill, "svg").length, 1, "ผ่านแล้วมีเครื่องหมายถูก")
    assert.equal(text(one(root, "p.ad-api-detail")), "ทดสอบล่าสุด 31 ต.ค. 2569 00:28 น.")
  })

  test("สถานะ API: ไม่มีรหัส (warn) · ทดสอบไม่ผ่าน (fail พร้อมข้อความ) · ไม่เคยทดสอบ (idle)", () => {
    const tone = (api: DashboardDto["api"]) => one(one(panel({ api }), "div.ad-api"), "span.ad-pill").attrs["data-tone"]
    assert.equal(tone({ hasKey: false, lastOk: null }), "warn")
    assert.equal(tone({ hasKey: true, lastOk: { at: "2026-10-30 17:28:00", ok: false, message: "รหัสไม่ถูกต้อง" } }), "fail")
    assert.equal(tone({ hasKey: true, lastOk: null }), "idle")
    const warn = one(one(panel({ api: { hasKey: false, lastOk: null } }), "div.ad-api"), "span.ad-pill")
    assert.equal(all(warn, "svg").length, 0, "ไม่ผ่านไม่มีเครื่องหมายถูก")
    const fail = panel({ api: { hasKey: true, lastOk: { at: "2026-10-30 17:28:00", ok: false, message: "รหัสไม่ถูกต้อง" } } })
    assert.match(text(one(fail, "p.ad-api-detail")), /รหัสไม่ถูกต้อง/)
  })
})

describe("DashboardView: ทั้งหน้า", () => {
  const view = (over: Partial<DashboardViewProps> = {}) => render(<DashboardView {...viewProps(over)} />)

  test("หัวหน้า: 'ภาพรวมวันนี้' + h1 'แดชบอร์ด' + ปุ่ม 'เพิ่มตอน' (ghost) และ 'เพิ่มเรื่องใหม่' (primary)", () => {
    const root = view()
    assert.equal(text(one(root, "p.ad-eyebrow")), "ภาพรวมวันนี้")
    assert.equal(text(one(root, "h1")), "แดชบอร์ด")
    const actions = all(one(root, "div.ad-ph-actions"), "a")
    assert.deepEqual(
      actions.map((a) => [a.attrs.href, text(a), a.attrs.class]),
      [
        ["/admin/add", "เพิ่มตอน", "btn ghost"],
        ["/admin/novels/new", "เพิ่มเรื่องใหม่", "btn primary"],
      ],
    )
  })

  test("มีข้อมูล: ครบทุกแผงตามสเปก 7.3 (การ์ดตัวเลข คิว ยอดอ่าน ความคืบหน้า การใช้ AI)", () => {
    const root = view()
    assert.equal(all(root, "section.ad-stats").length, 1)
    assert.deepEqual(all(root, "section.ad-panel").map((s) => text(one(s, "h2"))), ["คิวแปล", "ยอดอ่าน 14 วัน", "ความคืบหน้าแต่ละเรื่อง", "การใช้งาน AI"])
  })

  test("แต่ละแผงได้ข้อมูลส่วนของตัวเองจากแดชบอร์ด (ไม่ใช่ค่าว่าง/ของส่วนอื่น)", () => {
    const data = dto()
    const tree = DashboardView(viewProps({ data }))
    const props = <T,>(type: unknown) => findAll(tree, (el) => el.type === type)[0].props as Record<string, unknown> & T
    assert.equal(props(ChartPanel).views, data.views)
    assert.equal(props(ProgressPanel).progress, data.progress)
    assert.equal(props(UsagePanel).usage, data.usage)
    assert.equal(props(UsagePanel).estimate, data.estimate)
    assert.equal(props(UsagePanel).api, data.api)
    assert.equal(props(StatCards).counts, data.counts)
    assert.equal(props(OnboardingPanel).onboarding, data.onboarding)
  })

  test("แถวบนมีคิวกับกราฟ (ad-dash-top) · แถวล่างมีความคืบหน้ากับการใช้ AI (ad-dash-row)", () => {
    const root = view()
    const rows = all(root, "div.ad-dash-row")
    assert.equal(rows.length, 2)
    assert.equal(rows[0].attrs.class, "ad-dash-row ad-dash-top")
    assert.equal(rows[1].attrs.class, "ad-dash-row")
    assert.deepEqual(all(rows[0], "section.ad-panel").map((s) => text(one(s, "h2"))), ["คิวแปล", "ยอดอ่าน 14 วัน"])
    assert.deepEqual(all(rows[1], "section.ad-panel").map((s) => text(one(s, "h2"))), ["ความคืบหน้าแต่ละเรื่อง", "การใช้งาน AI"])
  })

  test("เริ่มต้นใช้งานแสดงเมื่อยังไม่ครบ และอยู่เหนือการ์ดตัวเลข · ครบแล้วไม่แสดง", () => {
    const todo = view({ data: dto({ onboarding: { apiKey: false, contact: false, firstNovel: false } }) })
    assert.equal(all(todo, "section.ad-onboard").length, 1)
    const names = findAll(
      DashboardView(viewProps({ data: dto({ onboarding: { apiKey: false, contact: false, firstNovel: false } }) })),
      (el) => el.type === OnboardingPanel || el.type === StatCards,
    ).map((el) => (el.type as { name: string }).name)
    assert.deepEqual(names, ["OnboardingPanel", "StatCards"])
    assert.equal(all(view(), "section.ad-onboard").length, 0)
  })

  test("กำลังโหลดครั้งแรก: โครงจำลอง ไม่มีแผงใดๆ แต่หัวหน้าและปุ่มยังอยู่", () => {
    const root = view({ data: null, loading: true, queue: queueProps({ state: null }) })
    assert.equal(all(root, "div.skeleton").length, 1)
    assert.equal(all(root, "section").length, 0)
    assert.equal(text(one(root, "h1")), "แดชบอร์ด")
    assert.equal(all(one(root, "div.ad-ph-actions"), "a").length, 2)
  })

  test("โครงจำลองแสดงเฉพาะตอนกำลังโหลดครั้งแรกและยังไม่มีข้อผิดพลาด (6 บรรทัด)", () => {
    const skeletons = (props: Partial<DashboardViewProps>) => findAll(DashboardView(viewProps({ queue: queueProps({ state: null }), ...props })), (el) => el.type === Skeleton)
    const [loading] = skeletons({ data: null, loading: true })
    assert.equal(loading.props.variant, "lines")
    assert.equal(loading.props.count, 6)
    assert.equal(skeletons({ data: null, loading: false }).length, 0, "ไม่ได้โหลดและไม่มีข้อมูล → ไม่ต้องมีโครงจำลองค้าง")
    assert.equal(skeletons({ data: null, loading: true, error: new ApiError(500, "x") }).length, 0, "มีข้อผิดพลาดแล้วแสดงหน้าผิดพลาดแทน")
    assert.equal(skeletons({ data: dto(), loading: true }).length, 0, "มีข้อมูลเก่าอยู่ ไม่ต้องกลับไปเป็นโครงจำลอง")
  })

  test("โหลดไม่สำเร็จและยังไม่มีข้อมูลเลย: หน้าผิดพลาดพร้อมปุ่มลองใหม่ที่ดึงแดชบอร์ดใหม่", () => {
    const onReload = () => {}
    const tree = DashboardView(viewProps({ data: null, error: new ApiError(500, "เซิร์ฟเวอร์ขัดข้อง"), onReload, queue: queueProps({ state: null }) }))
    const [state] = findAll(tree, (el) => el.type === ErrorState)
    assert.ok(state)
    assert.equal((state.props.error as ApiError).message, "เซิร์ฟเวอร์ขัดข้อง")
    assert.equal(state.props.onRetry, onReload)
    assert.equal(findAll(tree, (el) => el.type === StatCards).length, 0)
  })

  test("ดึงซ้ำล้มเหลวแต่มีข้อมูลเก่า: ยังแสดงข้อมูลเก่าพร้อมแถบเตือนและปุ่มลองใหม่", () => {
    let reloads = 0
    const tree = DashboardView(viewProps({ error: new ApiError(500, "ล้มเหลว"), onReload: () => reloads++ }))
    assert.equal(findAll(tree, (el) => el.type === ErrorState).length, 0)
    assert.equal(findAll(tree, (el) => el.type === StatCards).length, 1)
    const note = findTag(tree, "p", (el) => el.props.className === "ad-note")
    assert.equal(note.props.role, "alert")
    assert.equal(text(one(view({ error: new ApiError(500, "ล้มเหลว") }), "p.ad-note")), "อัปเดตตัวเลขไม่สำเร็จ — ตัวเลขที่เห็นอาจเก่า ลองใหม่")
    handlerOf(findTag(note, "button"), "onClick")()
    assert.equal(reloads, 1)
    assert.equal(all(view({ error: new ApiError(500, "ล้มเหลว") }), "p.ad-note").length, 1)
  })

  test("แผงคิวมีแผงเดียวเสมอ: ข้างกราฟเมื่อมีข้อมูล · เดี่ยวๆ ถ้าแดชบอร์ดโหลดไม่ได้แต่คิวสดมา · ไม่มีถ้าคิวยังไม่มา", () => {
    const count = (props: Partial<DashboardViewProps>) => findAll(DashboardView(viewProps(props)), (el) => el.type === QueuePanel).length
    assert.equal(count({}), 1)
    assert.equal(count({ data: null, error: new ApiError(500, "x"), queue: queueProps({ state: idle }) }), 1)
    assert.equal(count({ data: null, loading: true, queue: queueProps({ state: running() }) }), 1)
    assert.equal(count({ data: null, loading: true, queue: queueProps({ state: null }) }), 0)
  })

  test("การ์ดรอคิวใช้สถานะคิวสดก่อน (ไม่ใช่ dashboard.queue) และถอยไปใช้ของแดชบอร์ดถ้าคิวสดยังไม่มา", () => {
    const translating = (props: Partial<DashboardViewProps>) => findAll(DashboardView(viewProps(props)), (el) => el.type === StatCards)[0].props.translating
    assert.equal(translating({ queue: queueProps({ state: running() }), data: dto({ queue: idle }) }), true)
    assert.equal(translating({ queue: queueProps({ state: idle }), data: dto({ queue: running() }) }), false)
    assert.equal(translating({ queue: queueProps({ state: null }), data: dto({ queue: running() }) }), true)
    assert.equal(translating({ queue: queueProps({ state: null }), data: dto({ queue: idle }) }), false)
  })

  test("ปุ่ม 'เผยแพร่ทั้งหมด' ที่การ์ดเปิดกล่องยืนยัน (publish.onOpen)", () => {
    let opened = 0
    const tree = DashboardView(viewProps({ publish: { ...viewProps().publish, onOpen: () => opened++ } }))
    const [cards] = findAll(tree, (el) => el.type === StatCards)
    handlerOf(cards, "onPublishAll")()
    assert.equal(opened, 1)
  })

  test("กล่องยืนยันไม่แสดงถ้ายังไม่มีข้อมูล (ไม่มีจำนวนให้บอก) แม้สั่งเปิด", () => {
    const tree = DashboardView(viewProps({ data: null, loading: true, queue: queueProps({ state: null }), publish: { ...viewProps().publish, open: true } }))
    assert.equal(findAll(tree, (el) => el.type === ConfirmDialog).length, 0)
  })

  test("ข้อความในกล่องยืนยัน: จำนวนตอนแบ่งหลักพัน บอกว่าผู้อ่านเห็นทันที และว่าตอนของเรื่องที่ซ่อนอยู่ยังไม่แสดง", () => {
    const data = dto({ counts: { ...dto().counts, readyToPublish: 1500 } })
    const [dialog] = findAll(DashboardView(viewProps({ data, publish: { ...viewProps().publish, open: true } })), (el) => el.type === ConfirmDialog)
    assert.equal(
      dialog.props.message,
      "จะเผยแพร่ 1,500 ตอนที่แปลเสร็จแล้วแต่ยังไม่เผยแพร่ ผู้อ่านเห็นได้ทันที (ตอนของนิยายที่ยังซ่อนอยู่ จะยังไม่แสดงจนกว่าคุณจะเปิดเผยแพร่เรื่องนั้น)",
    )
  })

  test("กล่องยืนยันเผยแพร่ทั้งหมด: ไม่เปิดตอนปิด · เปิดแล้วเป็นกล่องปกติ (ไม่ใช่สีแดงอันตราย) พร้อมจำนวนตอน", () => {
    assert.equal(findAll(DashboardView(viewProps()), (el) => el.type === ConfirmDialog).length, 0)
    const onConfirm = async () => {}
    const onCancel = () => {}
    const tree = DashboardView(viewProps({ publish: { ...viewProps().publish, open: true, onConfirm, onCancel } }))
    const [dialog] = findAll(tree, (el) => el.type === ConfirmDialog)
    assert.ok(dialog)
    assert.equal(dialog.props.title, "เผยแพร่ทุกตอนที่แปลแล้ว?")
    assert.equal(dialog.props.confirmLabel, "เผยแพร่ทั้งหมด")
    assert.equal(dialog.props.danger, undefined, "ไม่ใช่การลบ: ปุ่มยืนยันเป็นสีปกติ")
    assert.match(String(dialog.props.message), /เผยแพร่ 4 ตอน/)
    assert.equal(dialog.props.onConfirm, onConfirm)
    assert.equal(dialog.props.onCancel, onCancel)
  })

  test("ข้อความแจ้งผลหลังเผยแพร่: แสดงพร้อมปุ่มปิด (aria-label) ที่เรียก onDismissNotice · ไม่มีผล → ไม่แสดง", () => {
    assert.equal(all(view(), "p.ad-notice").length, 0)
    const root = view({ publish: { ...viewProps().publish, notice: "เผยแพร่แล้ว 4 ตอน" } })
    const notice = one(root, "p.ad-notice")
    assert.equal(notice.attrs.role, "status")
    assert.equal(text(one(notice, "span")), "เผยแพร่แล้ว 4 ตอน")
    assert.equal(one(notice, "button").attrs["aria-label"], "ปิดข้อความนี้")
    assert.equal(one(notice, "button").attrs.type, "button")
    let dismissed = 0
    const tree = DashboardView(viewProps({ publish: { ...viewProps().publish, notice: "x", onDismissNotice: () => dismissed++ } }))
    handlerOf(findTag(tree, "button", (el) => el.props.className === "ad-notice-close"), "onClick")()
    assert.equal(dismissed, 1)
  })

  test("ส่งต่อคุณสมบัติของคิวทั้งหมดให้แผงคิว (ตัวสลับ ลองใหม่ ref เลื่อน)", () => {
    const ref = createRef<HTMLDivElement>()
    const onTailScroll = () => {}
    const queue = queueProps({ state: running(), errors: [failed(46)], offline: true, tailRef: ref, onTailScroll })
    const [panel] = findAll(DashboardView(viewProps({ queue })), (el) => el.type === QueuePanel)
    for (const key of ["state", "errors", "offline", "toggle", "retry", "tailRef", "onTailScroll"] as const) assert.equal(panel.props[key], queue[key], key)
  })
})

describe("Dashboard (ตัวถือสถานะ): เรนเดอร์ครั้งแรกบนเซิร์ฟเวอร์ — effect ยังไม่ทำงาน", () => {
  const queueValue = (over: Partial<QueueValue> = {}): QueueValue => ({ state: running({ waitingTotal: 3 }), errors: [failed(46)], reload: noop, offline: false, ...over })
  const mount = (value: QueueValue) =>
    render(
      <QueueContext.Provider value={value}>
        <Dashboard />
      </QueueContext.Provider>,
    )

  test("ระหว่างโหลดแดชบอร์ด: หัวหน้า + โครงจำลอง และแผงคิวสดจาก useQueue แสดงแล้ว (ไม่ต้องรอแดชบอร์ด) พร้อมข้อความที่กำลังไหลและรายการผิดพลาด", () => {
    const root = mount(queueValue())
    assert.equal(text(one(root, "h1")), "แดชบอร์ด")
    assert.equal(all(root, "div.skeleton").length, 1)
    assert.equal(text(one(root, "div.ad-live")), "ลมหนาวพัดแรงจนเปลวไฟ")
    assert.equal(text(one(root, "p.ad-panel-sub")), "แปลทีละตอนตามลำดับ · เหลือ 4 ตอน")
    assert.equal(text(one(root, "button.ad-retry")), "ผิดพลาด · ลองใหม่")
    assert.equal(text(one(root, "button.btn")), "หยุดคิว")
  })

  test("สถานะออฟไลน์ของคิวส่งถึงแผงคิว", () => {
    assert.equal(all(mount(queueValue({ offline: false })), "p.ad-note").length, 0)
    assert.match(text(one(mount(queueValue({ offline: true })), "p.ad-note")), /เชื่อมต่อคิวไม่ได้/)
  })

  test("คิวหยุดอยู่ → ปุ่ม 'ทำต่อ' · ยังไม่ได้สถานะคิว → ไม่มีแผงคิว (มีแต่โครงจำลองของหน้า)", () => {
    assert.equal(text(one(mount(queueValue({ state: { ...idle, paused: true } })), "button.btn")), "ทำต่อ")
    const none = mount(queueValue({ state: null, errors: [] }))
    assert.equal(all(none, "section.ad-queue-panel").length, 0)
    assert.equal(all(none, "div.skeleton").length, 1)
  })

  test("ไม่มี QueueProvider → โยนข้อผิดพลาดที่อ่านเข้าใจ (ไม่เงียบ)", () => {
    assert.throws(() => render(<Dashboard />), /useQueue/)
  })
})
