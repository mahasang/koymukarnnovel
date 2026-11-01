import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { installFetch, jsonResponse, restoreGlobals, textResponse, untilAborted } from "../testing/helpers"
import { ApiError, api, publicApi } from "./api"

/** ตัวเรียก API ของหน้าเว็บ ทดสอบกับ fetch ปลอมที่บันทึกคำขอ (เซิร์ฟเวอร์จริงตอบ JSON เสมอ ไม่เคยใช้ 204) */

afterEach(restoreGlobals)

const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name)
const failure = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
  } catch (e) {
    return e
  }
  assert.fail("ควรปฏิเสธ แต่สำเร็จ")
}
const apiError = async (promise: Promise<unknown>): Promise<ApiError> => {
  const e = await failure(promise)
  assert.ok(e instanceof ApiError, `ได้ ${String(e)} ไม่ใช่ ApiError`)
  return e
}

describe("ApiError", () => {
  test("เป็น Error ที่มี name, message, status, code, data", () => {
    const e = new ApiError(404, "ไม่พบนิยาย", "not_found", { id: 9 })
    assert.ok(e instanceof Error)
    assert.equal(e.name, "ApiError")
    assert.equal(e.message, "ไม่พบนิยาย")
    assert.equal(e.status, 404)
    assert.equal(e.code, "not_found")
    assert.deepEqual(e.data, { id: 9 })
  })

  test("ไม่ใส่ code/data → undefined", () => {
    const e = new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
    assert.equal(e.code, undefined)
    assert.equal(e.data, undefined)
  })
})

describe("api: คำขอที่ส่งออกไป", () => {
  test("ไม่ใส่ตัวเลือก → GET ไม่มี body ไม่มี content-type ส่งคุกกี้เฉพาะโดเมนเดียวกัน", async () => {
    const calls = installFetch(() => jsonResponse({ ok: 1 }))
    await api("/api/public/site")
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "/api/public/site")
    assert.equal(calls[0].init.method, "GET")
    assert.equal(calls[0].init.credentials, "same-origin")
    assert.equal(calls[0].init.body, undefined)
    assert.equal(headerOf(calls[0].init, "content-type"), null)
    assert.equal(calls[0].init.signal, undefined)
  })

  test("มี body ไม่ระบุ method → POST ส่งเป็น JSON พร้อม content-type: application/json (เซิร์ฟเวอร์ปฏิเสธ body ชนิดอื่น)", async () => {
    const calls = installFetch(() => jsonResponse({ ok: 1 }))
    await api("/api/admin/login", { body: { password: "ก ข ค" } })
    assert.equal(calls[0].init.method, "POST")
    assert.equal(calls[0].init.body, JSON.stringify({ password: "ก ข ค" }))
    assert.equal(headerOf(calls[0].init, "content-type"), "application/json")
    assert.equal(calls[0].init.credentials, "same-origin")
  })

  test("ระบุ method เอง → ใช้ตามนั้น (PUT/PATCH/DELETE ทั้งมีและไม่มี body)", async () => {
    const calls = installFetch(() => jsonResponse({}))
    await api("/a", { method: "PUT", body: { x: 1 } })
    await api("/b", { method: "PATCH", body: [1, 2] })
    await api("/c", { method: "DELETE" })
    await api("/d", { method: "POST" })
    assert.deepEqual(
      calls.map((c) => [c.init.method, c.init.body, headerOf(c.init, "content-type")]),
      [
        ["PUT", '{"x":1}', "application/json"],
        ["PATCH", "[1,2]", "application/json"],
        ["DELETE", undefined, null],
        ["POST", undefined, null],
      ],
    )
  })

  test("body ที่ค่าเป็นเท็จแต่ระบุไว้ (0, false, สตริงว่าง, null) ก็ส่ง — มีแค่ undefined ที่ถือว่าไม่มี body", async () => {
    const calls = installFetch(() => jsonResponse({}))
    for (const body of [0, false, "", null]) await api("/x", { body })
    assert.deepEqual(
      calls.map((c) => [c.init.method, c.init.body]),
      [["POST", "0"], ["POST", "false"], ["POST", '""'], ["POST", "null"]],
    )
  })

  test("ส่ง signal ต่อให้ fetch (ตัวเดียวกัน)", async () => {
    const calls = installFetch(() => jsonResponse({}))
    const controller = new AbortController()
    await api("/x", { signal: controller.signal })
    assert.equal(calls[0].init.signal, controller.signal)
  })
})

describe("api: คำตอบที่สำเร็จ", () => {
  test("คืนค่า JSON ที่แปลงแล้ว (วัตถุ อาร์เรย์ ข้อความไทย)", async () => {
    installFetch(() => jsonResponse({ title: "ราตรีโคมไฟ", tags: ["a", "b"] }))
    assert.deepEqual(await api("/x"), { title: "ราตรีโคมไฟ", tags: ["a", "b"] })
    installFetch(() => jsonResponse([1, 2, 3]))
    assert.deepEqual(await api("/x"), [1, 2, 3])
  })

  test("JSON ที่เป็นค่า null / 0 / false / สตริงว่าง คืนตามจริง ไม่ถูกมองว่า 'ไม่มีคำตอบ'", async () => {
    for (const value of [null, 0, false, ""]) {
      installFetch(() => jsonResponse(value))
      assert.strictEqual(await api("/x"), value)
    }
  })

  test("สถานะ 2xx อื่นๆ (เช่น 201) อ่านเป็นสำเร็จเหมือนกัน", async () => {
    installFetch(() => jsonResponse({ id: 5 }, 201))
    assert.deepEqual(await api("/x", { method: "POST", body: {} }), { id: 5 })
  })

  test("2xx แต่เนื้อหาไม่ใช่ JSON (หน้า HTML ของ dev server, ว่างเปล่า, JSON เสีย) → ApiError บอกว่ารูปแบบไม่รู้จัก ไม่คืน undefined เงียบๆ", async () => {
    for (const response of [textResponse("<!doctype html><title>x</title>"), textResponse(""), textResponse("{oops", 200, "application/json")]) {
      installFetch(() => response)
      const e = await apiError(api("/api/public/site"))
      assert.equal(e.status, 200)
      assert.equal(e.message, "เซิร์ฟเวอร์ตอบกลับในรูปแบบที่ไม่รู้จัก")
      assert.equal(e.code, undefined)
    }
  })
})

describe("api: คำตอบที่ไม่สำเร็จ", () => {
  test("ข้อความ error ของเซิร์ฟเวอร์ (ภาษาไทย) กลายเป็น message; status, code และ body ทั้งก้อน (data) ติดมา", async () => {
    const body = { error: "ไม่พบนิยายเรื่องนี้", code: "not_found", extra: { id: 9 } }
    installFetch(() => jsonResponse(body, 404))
    const e = await apiError(api("/api/public/novels/9"))
    assert.equal(e.status, 404)
    assert.equal(e.message, "ไม่พบนิยายเรื่องนี้")
    assert.equal(e.code, "not_found")
    assert.deepEqual(e.data, body)
  })

  test("ไม่มี code หรือ code ไม่ใช่สตริง → code เป็น undefined แต่ข้อความยังใช้ได้", async () => {
    installFetch(() => jsonResponse({ error: "พัง" }, 500))
    assert.equal((await apiError(api("/x"))).code, undefined)
    installFetch(() => jsonResponse({ error: "พัง", code: 42 }, 500))
    assert.equal((await apiError(api("/x"))).code, undefined)
  })

  test("ทุกสถานะที่ไม่ใช่ 2xx ล้ม (400, 401, 413, 429, 500, 503)", async () => {
    for (const status of [400, 401, 413, 429, 500, 503]) {
      installFetch(() => jsonResponse({ error: `e${status}` }, status))
      const e = await apiError(api("/x"))
      assert.equal(e.status, status)
      assert.equal(e.message, `e${status}`)
    }
  })

  test("ไม่มีข้อความ error ที่ใช้ได้ (ไม่มีช่อง, ไม่ใช่สตริง, สตริงว่าง, ไม่ใช่วัตถุ) → ข้อความกลางๆ บอกสถานะ; data คือ body ที่แปลงได้", async () => {
    const cases: [unknown, unknown][] = [[{}, {}], [{ error: 5 }, { error: 5 }], [{ error: "" }, { error: "" }], [{ error: null }, { error: null }], [["x"], ["x"]], ["text", "text"]]
    for (const [body, data] of cases) {
      installFetch(() => jsonResponse(body, 502))
      const e = await apiError(api("/x"))
      assert.equal(e.status, 502)
      assert.equal(e.message, "เซิร์ฟเวอร์ตอบผิดพลาด (502)", JSON.stringify(body))
      assert.deepEqual(e.data, data)
    }
  })

  test("เนื้อหาไม่ใช่ JSON (หน้า HTML จาก reverse proxy, ว่างเปล่า) → ข้อความกลางๆ, data เป็น undefined", async () => {
    for (const response of [textResponse("<html>Bad Gateway</html>", 502), textResponse("", 502), textResponse("{oops", 502, "application/json")]) {
      installFetch(() => response)
      const e = await apiError(api("/x"))
      assert.equal(e.status, 502)
      assert.equal(e.message, "เซิร์ฟเวอร์ตอบผิดพลาด (502)")
      assert.equal(e.data, undefined)
    }
  })
})

describe("api: เครือข่ายล่มและการยกเลิก", () => {
  test("เครือข่ายล่ม (fetch โยน TypeError) → ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')", async () => {
    installFetch(() => {
      throw new TypeError("Failed to fetch")
    })
    const e = await apiError(api("/x"))
    assert.equal(e.status, 0)
    assert.equal(e.message, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
    assert.equal(e.code, undefined)
    assert.equal(e.data, undefined)
  })

  test("เครือข่ายขาดระหว่างอ่านเนื้อหาคำตอบ → ApiError(0) เหมือนกัน", async () => {
    installFetch(() => ({ ok: true, status: 200, text: () => Promise.reject(new TypeError("terminated")) }))
    const e = await apiError(api("/x"))
    assert.equal(e.status, 0)
    assert.equal(e.message, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
  })

  test("ยกเลิกก่อนส่ง (signal ถูกยกเลิกอยู่แล้ว) → โยนเหตุผลการยกเลิกตัวเดิม ไม่ใช่ ApiError", async () => {
    installFetch(() => jsonResponse({}))
    const controller = new AbortController()
    controller.abort()
    const e = await failure(api("/x", { signal: controller.signal }))
    assert.equal(e, controller.signal.reason)
    assert.equal((e as DOMException).name, "AbortError")
  })

  test("ยกเลิกกลางคัน (ระหว่างรอคำตอบ) → โยนเหตุผลการยกเลิกตัวเดิม ไม่ใช่ ApiError", async () => {
    installFetch(untilAborted)
    const controller = new AbortController()
    const pending = failure(api("/x", { signal: controller.signal }))
    controller.abort()
    const e = await pending
    assert.equal(e, controller.signal.reason)
    assert.ok(!(e instanceof ApiError))
  })

  test("ยกเลิกด้วยเหตุผลของเราเอง → โยนเหตุผลนั้นตรงๆ", async () => {
    installFetch(untilAborted)
    const controller = new AbortController()
    const reason = new Error("เปลี่ยนหน้าแล้ว")
    const pending = failure(api("/x", { signal: controller.signal }))
    controller.abort(reason)
    assert.equal(await pending, reason)
  })

  test("ยกเลิกระหว่างอ่านเนื้อหาคำตอบ → โยนเหตุผลการยกเลิก ไม่แปลงเป็น 'เชื่อมต่อไม่ได้'", async () => {
    const controller = new AbortController()
    installFetch(() => ({
      ok: true,
      status: 200,
      text: () => {
        controller.abort()
        return Promise.reject(controller.signal.reason)
      },
    }))
    const e = await failure(api("/x", { signal: controller.signal }))
    assert.equal(e, controller.signal.reason)
    assert.ok(!(e instanceof ApiError))
  })

  test("เครือข่ายล่มโดยที่ signal ยังไม่ถูกยกเลิก → ApiError(0) (มี signal แต่ไม่ได้ยกเลิก ก็ยังเป็นเครือข่ายล่ม)", async () => {
    installFetch(() => {
      throw new TypeError("Failed to fetch")
    })
    const e = await apiError(api("/x", { signal: new AbortController().signal }))
    assert.equal(e.status, 0)
  })
})

describe("publicApi", () => {
  test("site/novels/novel/chapter เรียกเส้นทางสาธารณะที่ถูกต้องด้วย GET และคืนข้อมูลที่ได้", async () => {
    const calls = installFetch(({ url }) => jsonResponse({ url }))
    assert.deepEqual(await publicApi.site(), { url: "/api/public/site" })
    assert.deepEqual(await publicApi.novels(), { url: "/api/public/novels" })
    assert.deepEqual(await publicApi.novel(12), { url: "/api/public/novels/12" })
    assert.deepEqual(await publicApi.chapter(12, 7), { url: "/api/public/novels/12/chapters/7" })
    assert.deepEqual(calls.map((c) => c.init.method), ["GET", "GET", "GET", "GET"])
  })

  test("ตอนที่ 0 (บทนำ) ก็เรียกได้ — เลข 0 ไม่ถูกมองเป็นว่าง", async () => {
    const calls = installFetch(() => jsonResponse({}))
    await publicApi.chapter(3, 0)
    assert.equal(calls[0].url, "/api/public/novels/3/chapters/0")
  })

  test("ส่ง signal ต่อให้ทุกเส้นทาง (ตัวเดียวกัน) ไม่ส่ง = ไม่มี signal", async () => {
    const calls = installFetch(() => jsonResponse({}))
    const { signal } = new AbortController()
    await publicApi.site(signal)
    await publicApi.novels(signal)
    await publicApi.novel(1, signal)
    await publicApi.chapter(1, 2, signal)
    assert.ok(calls.every((c) => c.init.signal === signal))
    await publicApi.site()
    await publicApi.novels()
    await publicApi.novel(1)
    await publicApi.chapter(1, 2)
    assert.ok(calls.slice(4).every((c) => c.init.signal === undefined))
  })

  test("เซิร์ฟเวอร์ตอบ 404 → ApiError 404 พร้อมข้อความไทยจากเซิร์ฟเวอร์", async () => {
    installFetch(() => jsonResponse({ error: "ไม่พบนิยายเรื่องนี้", code: "not_found" }, 404))
    const e = await apiError(publicApi.novel(999))
    assert.equal(e.status, 404)
    assert.equal(e.code, "not_found")
    assert.equal(e.message, "ไม่พบนิยายเรื่องนี้")
  })
})
