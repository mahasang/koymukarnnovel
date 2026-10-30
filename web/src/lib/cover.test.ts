import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MOTIFS, coverBackground, coverColors, coverUrl, placeholderCover } from "./cover"

// ---- เครื่องมือวัดสีในเทสต์ (เขียนแยกจากโค้ดจริงโดยตั้งใจ ให้เป็นการตรวจอิสระ) ----
const channel = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const HEX = /^#[0-9a-f]{6}$/
const HUES = Array.from({ length: 360 }, (_, hue) => hue)

describe("coverUrl", () => {
  test("มีปก → /covers/<id>?v=<coverV> (ต่อ ?v= ให้เบราว์เซอร์เห็นปกใหม่ทันทีที่เปลี่ยน)", () => {
    assert.equal(coverUrl({ id: 7, hasCover: true, coverV: 3 }), "/covers/7?v=3")
    assert.equal(coverUrl({ id: 12345, hasCover: true, coverV: 1_700_000_000 }), "/covers/12345?v=1700000000")
  })

  test("coverV เป็น 0 ก็ต่อให้ตามจริง (ไม่ถือว่าไม่มี)", () => {
    assert.equal(coverUrl({ id: 7, hasCover: true, coverV: 0 }), "/covers/7?v=0")
  })

  test("ไม่มีปก → null ไม่ว่า coverV จะเป็นเท่าไร", () => {
    assert.equal(coverUrl({ id: 7, hasCover: false, coverV: 3 }), null)
    assert.equal(coverUrl({ id: 7, hasCover: false, coverV: 0 }), null)
  })
})

describe("placeholderCover: คงที่ต่อชื่อเรื่อง", () => {
  // ตรึงค่าของบางชื่อ: ปกอัตโนมัติของเรื่องหนึ่งต้องไม่เปลี่ยนหน้าตาเมื่ออัปเดตโค้ด (ค่าคำนวณแยกด้วย FNV-1a 32 บิตบนหน่วย UTF-16)
  const pinned: Array<[string, number, number, string]> = [
    ["", 2166136261, 61, "mountain"],
    ["A", 3289118412, 12, "waves"],
    ["The Last Lantern", 2683970388, 108, "city"],
    ["ตะเกียงดวงสุดท้าย", 3324479861, 101, "book"],
    ["สมุดบันทึกแห่งน้ำขึ้นโคมไฟ (ตัวอย่าง)", 1452430876, 76, "city"],
    ["koymukarnnovel", 1614418098, 258, "city"],
    ["Planet No. 99", 3430333686, 246, "snow"],
    // ตัวอักษรประกอบ (é = U+00E9 ต้องถูกทำ NFC ก่อนแฮช) และอักขระนอกระนาบแรก (อีโมจิ = หน่วย UTF-16 สองหน่วย ไม่ใช่ code point เดียว)
    ["caf" + String.fromCodePoint(0xe9), 856211068, 28, "lantern"],
    [String.fromCodePoint(0x1f600) + " Quest", 1557720698, 338, "lantern"],
  ]
  for (const [title, seed, hue, motif] of pinned) {
    test(`ตรึงค่า ${JSON.stringify(title)} → เฉด ${hue} ลาย ${motif}`, () => {
      const cover = placeholderCover(title)
      assert.equal(cover.seed, seed)
      assert.equal(cover.hue, hue)
      assert.equal(cover.motif, motif)
      assert.deepEqual(cover.colors, coverColors(hue))
    })
  }

  test("ชื่อเดียวกันได้ผลเดียวกันทุกครั้ง", () => {
    assert.deepEqual(placeholderCover("นักล่าฝันร้าย"), placeholderCover("นักล่าฝันร้าย"))
  })

  test("ตัดช่องว่างหัวท้ายก่อนคำนวณ (ชื่อที่พิมพ์เว้นวรรคเกินได้ปกเดิม)", () => {
    assert.deepEqual(placeholderCover("  The Last Lantern \n"), placeholderCover("The Last Lantern"))
  })

  test("ตัวอักษรที่ประกอบต่างรูปแต่เป็นตัวเดียวกัน (NFC/NFD) ได้ปกเดียวกัน", () => {
    const composed = "caf" + String.fromCodePoint(0xe9)
    const decomposed = "cafe" + String.fromCodePoint(0x301)
    assert.notEqual(composed, decomposed)
    assert.deepEqual(placeholderCover(composed), placeholderCover(decomposed))
  })

  test("ช่องว่างกลางชื่อมีผล (ชื่อต่างกันได้ปกต่างกัน)", () => {
    assert.notEqual(placeholderCover("a b").seed, placeholderCover("ab").seed)
  })

  test("ผลอยู่ในช่วงเสมอ: เฉด 0–359 เป็นจำนวนเต็ม, ลายอยู่ในรายการ, seed เป็นจำนวนเต็มไม่ติดลบ 32 บิต, สีเป็น #rrggbb 3 ค่า", () => {
    for (const title of ["", " ", "A", "😀", "x".repeat(5000), "ก".repeat(300), ...Array.from({ length: 300 }, (_, i) => `เรื่องที่ ${i}`)]) {
      const { seed, hue, motif, colors } = placeholderCover(title)
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, `seed ${seed}`)
      assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `hue ${hue}`)
      assert.ok(MOTIFS.includes(motif), `motif ${motif}`)
      assert.equal(colors.length, 3)
      for (const color of colors) assert.match(color, HEX)
    }
  })

  test("เรื่องต่างกันได้ปกต่างกันพอสมควร: 200 ชื่อ → เฉดไม่ซ้ำกันอย่างน้อย 110 ค่า และมีครบทุกลาย", () => {
    const covers = Array.from({ length: 200 }, (_, i) => placeholderCover(`นิยายเรื่องที่ ${i + 1}`))
    assert.ok(new Set(covers.map((c) => c.hue)).size >= 110, "เฉดซ้ำกันมากเกินไป")
    assert.deepEqual([...new Set(covers.map((c) => c.motif))].sort(), [...MOTIFS].sort())
  })
})

describe("MOTIFS", () => {
  test("รายการลายประกอบปก (ลำดับมีผลต่อการเลือกลายของแต่ละชื่อ จึงตรึงไว้)", () => {
    assert.deepEqual([...MOTIFS], ["lantern", "planet", "city", "waves", "mountain", "flower", "snow", "book"])
  })
})

describe("coverColors: สีของปกที่อ่านชื่อเรื่องสีขาวออกทุกเฉด", () => {
  test("สีกลางของไล่สีมีความต่างกับตัวอักษรขาว ≥ 4.5:1 ทุกเฉด 0–359 (ตัวอักษรบนปกอ่านออกไม่ว่าชื่อจะได้สีอะไร)", () => {
    for (const hue of HUES) {
      const [, mid] = coverColors(hue)
      assert.ok(contrast("#ffffff", mid) >= 4.5, `เฉด ${hue}: ${mid} ต่างจากขาว ${contrast("#ffffff", mid).toFixed(2)}`)
    }
  })

  test("สีปลายล่าง (ใต้ชื่อเรื่อง) เข้มมาก: ต่างจากขาว ≥ 12:1 ทุกเฉด", () => {
    for (const hue of HUES) {
      const [, , dark] = coverColors(hue)
      assert.ok(contrast("#ffffff", dark) >= 12, `เฉด ${hue}: ${dark} ต่างจากขาว ${contrast("#ffffff", dark).toFixed(2)}`)
    }
  })

  test("ความสว่างของแต่ละชั้นสม่ำเสมอทุกเฉด (ปกทุกใบหนักเบาเท่ากัน): กลาง ≈ 0.16, ปลายล่าง ≈ 0.012", () => {
    for (const hue of HUES) {
      const [, mid, dark] = coverColors(hue)
      assert.ok(Math.abs(luminance(mid) - 0.16) < 0.012, `เฉด ${hue}: กลาง ${luminance(mid).toFixed(3)}`)
      assert.ok(Math.abs(luminance(dark) - 0.012) < 0.006, `เฉด ${hue}: ปลาย ${luminance(dark).toFixed(4)}`)
    }
  })

  test("ไฮไลต์สว่างกว่าสีกลาง และสีกลางสว่างกว่าสีปลาย ทุกเฉด", () => {
    for (const hue of HUES) {
      const [hi, mid, dark] = coverColors(hue)
      assert.ok(luminance(hi) > luminance(mid) + 0.2, `เฉด ${hue}: ไฮไลต์ ${hi} ไม่สว่างพอ`)
      assert.ok(luminance(mid) > luminance(dark) + 0.1, `เฉด ${hue}: กลาง ${mid} ไม่สว่างกว่าปลาย ${dark}`)
    }
  })

  test("ทุกเฉดได้สีเป็น #rrggbb ตัวพิมพ์เล็ก และเฉดต่างกันได้สีกลางต่างกัน", () => {
    const mids = new Set<string>()
    for (const hue of HUES) {
      const colors = coverColors(hue)
      for (const color of colors) assert.match(color, HEX)
      mids.add(colors[1])
    }
    assert.ok(mids.size >= 340, `สีกลางไม่ซ้ำกัน ${mids.size} จาก 360`)
  })

  test("เฉดแดง/เขียว/น้ำเงินจริงๆ ออกโทนตามเฉด (สีกลางของเฉด 0 ไปทางแดง, 120 ทางเขียว, 240 ทางน้ำเงิน)", () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [r0, g0, b0] = channels(coverColors(0)[1])
    const [r1, g1, b1] = channels(coverColors(120)[1])
    const [r2, g2, b2] = channels(coverColors(240)[1])
    assert.ok(r0 > g0 && r0 > b0, "เฉด 0 ต้องแดงนำ")
    assert.ok(g1 > r1 && g1 > b1, "เฉด 120 ต้องเขียวนำ")
    assert.ok(b2 > r2 && b2 > g2, "เฉด 240 ต้องน้ำเงินนำ")
  })
})

describe("coverColors: ตรึงค่าสีของบางเฉด", () => {
  // ปกอัตโนมัติของแต่ละเรื่องต้องไม่เปลี่ยนสีเมื่ออัปเดตโค้ด — ค่าด้านล่างคำนวณแยกด้วยโปรแกรมอื่น (หาความสว่างเชิงสัมพัทธ์ตามนิยาม WCAG แบบแบ่งครึ่ง 30 รอบ)
  // ไม่ได้คัดลอกผลจากโค้ดจริง: [ไฮไลต์ (อิ่มตัว 0.9, สว่าง 0.6), กลาง (0.7, 0.16), ปลายล่าง (0.55, 0.012)]
  const golden: Array<[number, [string, string, string]]> = [
    [0, ["#fbbcbc", "#d72626", "#361010"]],
    [30, ["#f9c189", "#a25f1d", "#281a0c"]],
    [60, ["#d2d20b", "#737314", "#1e1e09"]],
    [90, ["#78e50c", "#497c16", "#152009"]],
    [120, ["#0cec0c", "#178117", "#0a220a"]],
    [150, ["#0ce97b", "#17804b", "#0a2115"]],
    [180, ["#0ce2e2", "#167c7c", "#092020"]],
    [210, ["#a5d0fa", "#2271c0", "#0d1e2e"]],
    [240, ["#c7c7fc", "#5e5ee3", "#15154a"]],
    [270, ["#dec0fc", "#9347df", "#27123d"]],
    [300, ["#fbb4fb", "#bf22bf", "#310e31"]],
    [330, ["#fbb8da", "#cf257a", "#340f22"]],
    [359, ["#fbbbbd", "#d72629", "#361010"]],
  ]
  for (const [hue, colors] of golden) {
    test(`เฉด ${hue} → ${colors.join(" ")}`, () => {
      assert.deepEqual(coverColors(hue), colors)
    })
  }
})

describe("coverBackground", () => {
  test("ไล่สีเดียวกับต้นแบบ: ไฮไลต์วงรีมุมบนซ้ายโปร่ง 73% ทับไล่สีเฉียง 170° จากสีกลางไปสีปลายล่าง", () => {
    assert.equal(
      coverBackground(["#aabbcc", "#112233", "#000011"]),
      "radial-gradient(90% 60% at 28% 8%, #aabbccbb, transparent 70%), linear-gradient(170deg, #112233, #000011)",
    )
  })
})
