import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MESSAGES } from "./messages"
import { I18nProvider, useI18n } from "./I18nProvider"

function Probe() {
  const { locale, m } = useI18n()
  return (
    <p>
      {locale}:{m.lang.menuLabel}
    </p>
  )
}

const html = (node: React.ReactNode) => renderToStaticMarkup(node).replace(/<!-- -->/g, "")

describe("I18nProvider / useI18n", () => {
  test("ไม่มี provider → ไทย (เทสต์คอมโพเนนต์เดิมไม่ต้องห่อ)", () => {
    assert.equal(html(<Probe />), `<p>th:${MESSAGES.th.lang.menuLabel}</p>`)
  })
  test("fixedLocale ใช้ภาษานั้นเสมอ", () => {
    assert.equal(html(<I18nProvider fixedLocale="lo"><Probe /></I18nProvider>), `<p>lo:${MESSAGES.lo.lang.menuLabel}</p>`)
    assert.equal(html(<I18nProvider fixedLocale="en"><Probe /></I18nProvider>), `<p>en:${MESSAGES.en.lang.menuLabel}</p>`)
  })
  test("provider ซ้อน: ตัวใน fixedLocale=th ชนะตัวนอก (หลังบ้านเป็นไทยเสมอ)", () => {
    assert.equal(html(<I18nProvider fixedLocale="lo"><I18nProvider fixedLocale="th"><Probe /></I18nProvider></I18nProvider>), `<p>th:${MESSAGES.th.lang.menuLabel}</p>`)
  })
  test("ข้อความสามภาษาของชื่อเมนูภาษาต่างกัน", () => {
    assert.notEqual(MESSAGES.en.lang.menuLabel, MESSAGES.th.lang.menuLabel)
    assert.notEqual(MESSAGES.lo.lang.menuLabel, MESSAGES.th.lang.menuLabel)
  })
})
