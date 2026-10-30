import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { QueueContext, QueueProvider, useQueue, type QueueValue } from "./QueueContext"

/** React ส่วนของคิวสด (ตัวดึงจริงทดสอบใน queue-poller.test.ts · การทำงานใน effect จริงตรวจในเบราว์เซอร์จริง) */

function Probe() {
  const q = useQueue()
  return <p data-state={q.state === null ? "none" : "some"} data-errors={q.errors.length} data-offline={String(q.offline)} data-reload={typeof q.reload} />
}

describe("useQueue", () => {
  test("นอก QueueProvider → โยน (ลืมครอบจะได้รู้ตั้งแต่ตอนพัฒนา ไม่ใช่เห็นคิวว่างเงียบๆ)", () => {
    assert.throws(() => renderToStaticMarkup(<Probe />), /QueueProvider/)
  })

  test("ค่าที่ Provider จ่ายให้ตรงตามที่ใส่", () => {
    const value: QueueValue = {
      state: { paused: false, pausedReason: "", consecutiveErrors: 0, waitingTotal: 0, current: null, waiting: [] },
      errors: [{ id: 1, novelId: 1, novelTitle: "ก", number: 1, error: "พัง" }],
      reload() {},
      offline: true,
    }
    const html = renderToStaticMarkup(
      <QueueContext.Provider value={value}>
        <Probe />
      </QueueContext.Provider>,
    )
    assert.match(html, /data-state="some"/)
    assert.match(html, /data-errors="1"/)
    assert.match(html, /data-offline="true"/)
    assert.match(html, /data-reload="function"/)
  })
})

describe("QueueProvider", () => {
  test("ก่อนดึงครั้งแรก: state = null, errors ว่าง, ไม่ offline, มี reload ให้เรียกได้ (ไม่โยน)", () => {
    const html = renderToStaticMarkup(
      <QueueProvider onUnauthorized={() => {}}>
        <Probe />
      </QueueProvider>,
    )
    assert.match(html, /data-state="none"/)
    assert.match(html, /data-errors="0"/)
    assert.match(html, /data-offline="false"/)
    assert.match(html, /data-reload="function"/)
  })

  test("ต่อสายจริง: ดึงผ่าน admin.queue, จับเวลาด้วย window.setTimeout, ดูแท็บจาก document.visibilityState และเฝ้า visibilitychange", () => {
    const src = readFileSync(new URL("./QueueContext.tsx", import.meta.url), "utf8")
    assert.match(src, /fetchQueue:\s*\(\)\s*=>\s*admin\.queue\(\)/)
    assert.match(src, /window\.setTimeout\(fn, ms\)/)
    assert.match(src, /window\.clearTimeout/)
    assert.match(src, /document\.visibilityState !== "hidden"/)
    assert.match(src, /addEventListener\("visibilitychange"/)
    assert.match(src, /removeEventListener\("visibilitychange"/)
    assert.match(src, /poller\.start\(\)/)
    assert.match(src, /poller\.stop\(\)/)
    assert.match(src, /onUnauthorized:\s*\(\)\s*=>\s*unauthorizedRef\.current\(\)/)
  })
})
