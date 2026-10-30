import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { describe, test } from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MOTIFS, coverBackground, placeholderCover } from "../lib/cover"
import { all, one, parse, text } from "../testing/dom"
import { findTag, handlerOf } from "../testing/elements"
import { CoverArt } from "./CoverArt"
import { Cover, CoverView, imageFailed } from "./Cover"

const novel = (over: Partial<{ id: number; title: string; hasCover: boolean; coverV: number }> = {}) => ({
  id: 7,
  title: "ตะเกียงดวงสุดท้าย",
  hasCover: true,
  coverV: 3,
  ...over,
})
const view = (props: Partial<Parameters<typeof CoverView>[0]> = {}) =>
  parse(renderToStaticMarkup(<CoverView novel={novel()} failed={false} onImageError={() => {}} {...props} />))

describe("CoverView: มีรูปปก", () => {
  test("รูปจาก /covers/<id>?v=<coverV> โหลดแบบ lazy/async ในกรอบสัดส่วน 2:3 (คลาส cv)", () => {
    const root = view()
    const frame = one(root, ".cv")
    const img = one(frame, "img")
    assert.equal(img.attrs.src, "/covers/7?v=3")
    assert.equal(img.attrs.loading, "lazy")
    assert.equal(img.attrs.decoding, "async")
    assert.equal(img.attrs.class, "cv-img")
    assert.doesNotMatch(frame.attrs.class, /cv-placeholder/)
    assert.equal(all(root, "svg").length, 0)
    assert.equal(all(root, ".cv-title").length, 0)
  })

  test("ค่าเริ่มต้นเป็นภาพประดับ (alt ว่าง) เพราะชื่อเรื่องอยู่ข้างๆ ในการ์ดอยู่แล้ว; ส่ง alt มาก็ใช้ตามนั้น", () => {
    assert.equal(one(view(), "img").attrs.alt, "")
    assert.equal(one(view({ alt: "ปกนิยาย ตะเกียงดวงสุดท้าย" }), "img").attrs.alt, "ปกนิยาย ตะเกียงดวงสุดท้าย")
  })

  test("รูปโหลดไม่ขึ้น (onError) → เรียก onImageError หนึ่งครั้ง", () => {
    let errors = 0
    const element = CoverView({ novel: novel(), failed: false, onImageError: () => errors++ })
    handlerOf(findTag(element, "img"), "onError")()
    assert.equal(errors, 1)
  })

  test("รูปโหลดไม่ขึ้นแล้ว (failed) → ใช้ปกอัตโนมัติแทน ไม่มีรูปแตก", () => {
    const root = view({ failed: true })
    assert.equal(all(root, "img").length, 0)
    assert.match(one(root, ".cv").attrs.class, /cv-placeholder/)
  })
})

describe("CoverView: ปกอัตโนมัติ (ไม่มีรูปปก)", () => {
  const bare = () => view({ novel: novel({ hasCover: false }) })

  test("พื้นไล่สีจากแฮชของชื่อเรื่อง + ลายประกอบ + ชื่อเรื่อง", () => {
    const frame = one(bare(), ".cv")
    const art = placeholderCover("ตะเกียงดวงสุดท้าย")
    assert.match(frame.attrs.class, /\bcv\b/)
    assert.match(frame.attrs.class, /\bcv-placeholder\b/)
    assert.ok(frame.attrs.style.includes(coverBackground(art.colors)), frame.attrs.style)
    assert.equal(one(frame, "svg").attrs["data-motif"], art.motif)
    assert.equal(text(one(frame, ".cv-title")), "ตะเกียงดวงสุดท้าย")
    assert.equal(all(frame, "img").length, 0)
  })

  test("ชื่อเรื่องต่างกันได้ปกต่างกัน และชื่อเดียวกันได้ปกเดิมทุกครั้ง", () => {
    const a = one(view({ novel: novel({ hasCover: false, title: "The Last Lantern" }) }), ".cv").attrs.style
    const b = one(view({ novel: novel({ hasCover: false, title: "Planet No. 99" }) }), ".cv").attrs.style
    const again = one(view({ novel: novel({ hasCover: false, title: "The Last Lantern" }) }), ".cv").attrs.style
    assert.notEqual(a, b)
    assert.equal(a, again)
  })

  test("เป็นภาพประดับโดยค่าเริ่มต้น (aria-hidden) เพราะชื่อเรื่องซ้ำกับหัวข้อข้างๆ", () => {
    const frame = one(bare(), ".cv")
    assert.equal(frame.attrs["aria-hidden"], "true")
    assert.equal(frame.attrs.role, undefined)
    assert.equal(frame.attrs["aria-label"], undefined)
  })

  test("ส่ง alt มา (เช่น หน้านิยาย) → เป็นรูปที่มีคำอธิบาย role=img + aria-label และไม่ซ่อน", () => {
    const frame = one(view({ novel: novel({ hasCover: false }), alt: "ปกนิยาย ตะเกียงดวงสุดท้าย" }), ".cv")
    assert.equal(frame.attrs.role, "img")
    assert.equal(frame.attrs["aria-label"], "ปกนิยาย ตะเกียงดวงสุดท้าย")
    assert.equal(frame.attrs["aria-hidden"], undefined)
  })

  test("alt เป็นสตริงว่างนับเป็นไม่ส่ง alt: ยังเป็นภาพประดับ (ไม่มี role=img ที่ไม่มีคำอธิบาย)", () => {
    const frame = one(view({ novel: novel({ hasCover: false }), alt: "" }), ".cv")
    assert.equal(frame.attrs["aria-hidden"], "true")
    assert.equal(frame.attrs.role, undefined)
    assert.equal(frame.attrs["aria-label"], undefined)
  })

  test("ลายประกอบได้ seed ของชื่อเรื่อง (ลายหิมะของชื่อเดียวกันตำแหน่งเดิมเสมอ และต่างจากชื่ออื่น)", () => {
    const title = "Planet No. 99" // ลาย snow (ดูตัวเลขที่ตรึงใน cover.test.ts)
    const art = placeholderCover(title)
    assert.equal(art.motif, "snow")
    const flakes = (root: ReturnType<typeof parse>) => all(one(root, "svg"), "circle").map((c) => `${c.attrs.cx},${c.attrs.cy}`)
    const drawn = flakes(view({ novel: novel({ hasCover: false, title }) }))
    const expected = all(parse(renderToStaticMarkup(<CoverArt motif="snow" seed={art.seed} />)), "circle").map((c) => `${c.attrs.cx},${c.attrs.cy}`)
    assert.deepEqual(drawn, expected)
    assert.notDeepEqual(drawn, flakes(parse(renderToStaticMarkup(<CoverArt motif="snow" seed={0} />))))
  })

  test("ชื่อเรื่องที่มีอักขระพิเศษของ HTML ไม่กลายเป็นแท็ก (escape ครบ)", () => {
    const title = '<img src=x onerror="alert(1)"> & "q"'
    const root = view({ novel: novel({ hasCover: false, title }) })
    assert.equal(all(root, "img").length, 0)
    assert.equal(text(one(root, ".cv-title")), title)
  })

  test("ชื่อว่างก็ยังวาดปกได้ (ไม่โยน)", () => {
    const root = view({ novel: novel({ hasCover: false, title: "" }) })
    assert.equal(text(one(root, ".cv-title")), "")
    assert.equal(all(root, "svg").length, 1)
  })
})

describe("Cover (ตัวที่จำสถานะรูปแตก)", () => {
  test("เรนเดอร์ครั้งแรกแสดงรูปปก", () => {
    const root = parse(renderToStaticMarkup(<Cover novel={novel()} />))
    assert.equal(one(root, "img").attrs.src, "/covers/7?v=3")
  })

  test("ไม่มีรูปปก → ปกอัตโนมัติ และส่ง alt ต่อให้ View", () => {
    const root = parse(renderToStaticMarkup(<Cover novel={novel({ hasCover: false })} alt="ปก" />))
    assert.equal(one(root, ".cv").attrs["aria-label"], "ปก")
  })
})

describe("imageFailed (รูปปกนี้โหลดไม่ขึ้นแล้วหรือยัง)", () => {
  test("ไม่มีรูป (url เป็น null) → ไม่ใช่รูปที่โหลดไม่ขึ้น แม้จะเคยจำ URL ไว้", () => {
    assert.equal(imageFailed(null, null), false)
    assert.equal(imageFailed(null, "/covers/7?v=3"), false)
  })

  test("ยังไม่เคยมีรูปไหนโหลดไม่ขึ้น → ลองโหลดตามปกติ", () => {
    assert.equal(imageFailed("/covers/7?v=3", null), false)
  })

  test("URL เดียวกับที่โหลดไม่ขึ้น → ใช้ปกอัตโนมัติ", () => {
    assert.equal(imageFailed("/covers/7?v=3", "/covers/7?v=3"), true)
  })

  test("เปลี่ยนปก (URL ใหม่) → ลองโหลดรูปใหม่ ไม่ติดสถานะเดิม", () => {
    assert.equal(imageFailed("/covers/7?v=4", "/covers/7?v=3"), false)
    assert.equal(imageFailed("/covers/8?v=3", "/covers/7?v=3"), false)
  })
})

describe("CoverArt (ลายประกอบ)", () => {
  // จำนวนรูปทรงของแต่ละลาย (ตรึงไว้ให้ลายที่พอร์ตมาจากต้นแบบไม่หายไปโดยไม่รู้ตัว)
  const SHAPES: Record<(typeof MOTIFS)[number], Record<string, number>> = {
    lantern: { circle: 2, rect: 2, path: 1 },
    planet: { circle: 5, ellipse: 1 },
    city: { circle: 1, rect: 5 },
    waves: { path: 4, circle: 1 },
    mountain: { circle: 1, polygon: 2 },
    flower: { circle: 7 },
    snow: { circle: 27 },
    book: { circle: 1, path: 2 },
  }
  const art = (motif: (typeof MOTIFS)[number], seed = 1) => one(parse(renderToStaticMarkup(<CoverArt motif={motif} seed={seed} />)), "svg")

  test("ทุกลายเป็น svg ประดับ (ซ่อนจากโปรแกรมอ่านหน้าจอ ไม่รับโฟกัส) ขนาดอ้างอิง 200×300 ครอบเต็มกรอบ", () => {
    for (const motif of MOTIFS) {
      const svg = art(motif)
      assert.equal(svg.attrs["data-motif"], motif)
      assert.equal(svg.attrs["aria-hidden"], "true")
      assert.equal(svg.attrs.focusable, "false")
      assert.equal(svg.attrs.viewbox, "0 0 200 300")
      assert.equal(svg.attrs.preserveaspectratio, "xMidYMid slice")
    }
  })

  test("รูปทรงของแต่ละลายครบตามที่พอร์ตมา", () => {
    for (const motif of MOTIFS) {
      const svg = art(motif)
      for (const [tag, count] of Object.entries(SHAPES[motif])) assert.equal(all(svg, tag).length, count, `${motif}: ${tag}`)
    }
  })

  test("ลายหิมะแปรผันตาม seed (ตำแหน่งเกล็ดต่างกัน) แต่ seed เดียวกันได้เหมือนเดิมเสมอ", () => {
    const flakes = (seed: number) => all(art("snow", seed), "circle").map((c) => `${c.attrs.cx},${c.attrs.cy},${c.attrs.r}`)
    assert.deepEqual(flakes(5), flakes(5))
    assert.notDeepEqual(flakes(5), flakes(6))
  })

  test("เกล็ดหิมะทุกเม็ดอยู่ในกรอบ 200×300 และขนาด/ความโปร่งอยู่ในช่วงที่ตั้งไว้ (ทุก seed 0–96)", () => {
    for (let seed = 0; seed < 97; seed++) {
      for (const flake of all(art("snow", seed), "circle").slice(0, 26)) {
        const cx = Number(flake.attrs.cx)
        const cy = Number(flake.attrs.cy)
        const r = Number(flake.attrs.r)
        assert.ok(cx >= 5 && cx < 195, `seed ${seed}: cx ${cx}`)
        assert.ok(cy >= 20 && cy < 220, `seed ${seed}: cy ${cy}`)
        assert.ok(r >= 1.5 && r <= 3.5, `seed ${seed}: r ${r}`)
      }
    }
  })

  test("seed ที่มาจากแฮชใหญ่ๆ (32 บิต) ก็วาดได้ในกรอบ", () => {
    for (const seed of [0, 4294967295, 3289118412, 2166136261]) {
      for (const flake of all(art("snow", seed), "circle").slice(0, 26)) {
        const cx = Number(flake.attrs.cx)
        const cy = Number(flake.attrs.cy)
        assert.ok(cx >= 5 && cx < 195 && cy >= 20 && cy < 220, `seed ${seed}: ${cx},${cy}`)
      }
    }
  })
})

describe("CoverArt: ตรึงรูปวาดของแต่ละลาย", () => {
  // รูปวาดของปกอัตโนมัติต้องไม่เปลี่ยนหน้าตาเมื่ออัปเดตโค้ด (เจ้าของและผู้อ่านจำปกของเรื่องได้) — เทียบลายนิ้วมือ (SHA-256 ย่อ 16 ตัวแรก) ของ SVG ที่เรนเดอร์
  // แก้รูปวาดโดยตั้งใจ → เทสต์นี้ล้มพร้อมพิมพ์ SVG จริงให้ดู: ตรวจภาพแล้วค่อยแก้ค่าที่นี่ · ลายหิมะขึ้นกับ seed จึงตรึงหลาย seed
  const golden: Array<[(typeof MOTIFS)[number], number, string]> = [
    ["lantern", 1234567, "e79f8ce198e636ff"],
    ["planet", 1234567, "31846ef1513221b1"],
    ["city", 1234567, "138eb9a78b325f46"],
    ["waves", 1234567, "75d80bc577193355"],
    ["mountain", 1234567, "1b5eff3a43e78bdf"],
    ["flower", 1234567, "6a128abfb5894b38"],
    ["snow", 0, "f661101dd770488e"],
    ["snow", 1234567, "68aca6c2a31b27b7"],
    ["snow", 3289118412, "6fe02cfe528aa7e4"],
    ["book", 1234567, "ecda195b9702ca7e"],
  ]
  for (const [motif, seed, fingerprint] of golden) {
    test(`${motif} (seed ${seed})`, () => {
      const markup = renderToStaticMarkup(<CoverArt motif={motif} seed={seed} />)
      assert.equal(createHash("sha256").update(markup).digest("hex").slice(0, 16), fingerprint, markup)
    })
  }

  test("ทุกลายใน MOTIFS ถูกตรึงไว้อย่างน้อยหนึ่งค่า (เพิ่มลายใหม่แล้วลืมตรึง → ล้ม)", () => {
    assert.deepEqual([...new Set(golden.map(([motif]) => motif))].sort(), [...MOTIFS].sort())
  })
})
