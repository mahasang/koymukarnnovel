import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SiteContext, SiteProvider, useSite } from "./SiteContext"

/** สิ่งที่ useSite() ให้หน้า เขียนออกมาเป็นข้อความบรรทัดเดียวไว้เทียบ */
function Probe() {
  const { site, loading, error } = useSite()
  return <p>{`${loading}|${site === null ? "no-site" : site.siteName}|${error === null ? "no-error" : error.message}`}</p>
}

describe("SiteContext", () => {
  test("useSite นอก SiteProvider → โยน Error ที่บอกวิธีแก้ (ลืมครอบ provider ต้องรู้ทันที ไม่ใช่ได้ค่าเงียบๆ)", () => {
    assert.throws(() => renderToStaticMarkup(<Probe />), /useSite ต้องใช้ภายใน <SiteProvider>/)
  })

  test("ใน SiteProvider ตอนเรนเดอร์แรก: กำลังโหลด ยังไม่มีข้อมูลเว็บ ไม่มี error", () => {
    assert.equal(
      renderToStaticMarkup(
        <SiteProvider>
          <Probe />
        </SiteProvider>,
      ),
      "<p>true|no-site|no-error</p>",
    )
  })

  test("SiteContext.Provider ให้ค่าที่ส่งเข้าไปตรงๆ (ใช้ในเทสต์ของคอมโพเนนต์อื่น)", () => {
    const value = {
      site: { siteName: "คลังนิยาย", tagline: "", aboutText: "", contactText: "", accent: "default" as const, indexable: true, isAdmin: false },
      loading: false,
      error: null,
    }
    assert.equal(
      renderToStaticMarkup(
        <SiteContext.Provider value={value}>
          <Probe />
        </SiteContext.Provider>,
      ),
      "<p>false|คลังนิยาย|no-error</p>",
    )
  })
})
