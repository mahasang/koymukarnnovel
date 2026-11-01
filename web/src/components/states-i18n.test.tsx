import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Route, Routes } from "react-router"
import { ApiError } from "../lib/api"
import { MESSAGES } from "../i18n/messages"
import { NotFound } from "../pages/NotFound"
import { all, one, text } from "../testing/dom"
import { renderPage } from "../testing/render"
import { CrashFallback } from "./AppErrorBoundary"
import { EmptyState } from "./EmptyState"
import { ErrorState } from "./ErrorState"
import { Layout } from "./Layout"
import { Skeleton } from "./Skeleton"

const { th, en, lo } = MESSAGES
const noop = () => {}

describe("สถานะหลายภาษา", () => {
  test("ErrorState ลาว: หัวข้อ ข้อความตามรหัส คำแนะนำ และปุ่มลองใหม่เป็นลาว ไม่มีไทยหลงเหลือ", () => {
    const root = renderPage(<ErrorState error={new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "network")} onRetry={noop} />, { locale: "lo" })
    assert.equal(text(one(root, ".state-title")), lo.errors.title)
    assert.equal(text(one(root, ".state-message")), lo.errors.byCode.network)
    assert.equal(text(one(root, ".state-hint")), lo.errors.networkHint)
    assert.equal(text(one(root, "button")).trim(), lo.errors.retry)
    assert.doesNotMatch(text(root), /[฀-๿]/)
  })

  test("ErrorState อังกฤษ: รหัสที่ไม่รู้จัก → ข้อความไทยของเซิร์ฟเวอร์ แต่คำแนะนำและปุ่มเป็นอังกฤษ", () => {
    const root = renderPage(<ErrorState error={new ApiError(503, "ข้อความไทยของเซิร์ฟเวอร์", "weird")} onRetry={noop} />, { locale: "en" })
    assert.equal(text(one(root, ".state-message")), "ข้อความไทยของเซิร์ฟเวอร์")
    assert.equal(text(one(root, ".state-hint")), en.errors.serverHint)
    assert.equal(text(one(root, "button")).trim(), en.errors.retry)
  })

  test("ErrorState ไทย: ข้อความของเซิร์ฟเวอร์ตามเดิม", () => {
    const root = renderPage(<ErrorState error={new ApiError(404, "ไม่พบนิยายเรื่องนี้", "not_found")} />)
    assert.equal(text(one(root, ".state-message")), "ไม่พบนิยายเรื่องนี้")
    assert.equal(text(one(root, ".state-title")), th.errors.title)
  })

  test("CrashFallback ลาว", () => {
    const root = renderPage(<CrashFallback onReload={noop} />, { locale: "lo" })
    assert.equal(text(one(root, ".state-title")), lo.errors.crash.title)
    assert.equal(text(one(root, ".state-message")), lo.errors.crash.message)
    assert.equal(text(one(root, "button")).trim(), lo.errors.crash.reload)
  })

  test("Skeleton ประกาศ 'กำลังโหลด' ตามภาษา", () => {
    assert.equal(text(one(renderPage(<Skeleton variant="lines" />, { locale: "en" }), ".sr-only")), en.states.loading)
    assert.equal(text(one(renderPage(<Skeleton variant="lines" />, { locale: "lo" }), ".sr-only")), lo.states.loading)
    assert.equal(text(one(renderPage(<Skeleton variant="lines" />), ".sr-only")), "กำลังโหลด…")
  })

  test("NotFound ลาว/อังกฤษ: หัวข้อ คำอธิบาย และปุ่มกลับหน้าแรก", () => {
    for (const locale of ["lo", "en"] as const) {
      const root = renderPage(<NotFound />, { locale })
      assert.equal(text(one(root, ".state-title")), MESSAGES[locale].notFound.title)
      assert.equal(text(one(root, ".state-hint")), MESSAGES[locale].notFound.hint)
      assert.equal(text(one(root, "a.btn")).trim(), MESSAGES[locale].notFound.home)
    }
    assert.equal(text(one(renderPage(<NotFound />), ".state-title")), "ไม่พบหน้านี้")
  })

  test("EmptyState ไม่มีข้อความตายตัว (ข้อความมาจากผู้เรียก)", () => {
    const root = renderPage(<EmptyState title="A" hint="B" />, { locale: "lo" })
    assert.equal(all(root, ".state-title").length, 1)
  })

  test("Layout: ลิงก์ข้ามไปเนื้อหาตามภาษา", () => {
    const root = renderPage(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>x</p>} />
        </Route>
      </Routes>,
      { locale: "lo" },
    )
    assert.equal(text(one(root, "a.skip-link")).trim(), lo.layout.skip)
  })
})
