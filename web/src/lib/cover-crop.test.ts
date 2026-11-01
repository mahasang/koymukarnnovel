import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  base64Bytes,
  checkCoverFile,
  COVER_HEIGHT,
  COVER_MAX_BYTES,
  COVER_MAX_SOURCE_BYTES,
  COVER_QUALITIES,
  COVER_WIDTH,
  coverCropRect,
  encodeUnderLimit,
  stripDataUrl,
} from "./cover-crop"

describe("coverCropRect: ครอบกึ่งกลางอัตราส่วน 2:3", () => {
  test("ตัวอย่างจาก brief: จัตุรัส · สูงเกิน · ได้สัดส่วนอยู่แล้ว", () => {
    assert.deepEqual(coverCropRect(1000, 1000), { sx: 167, sy: 0, sw: 667, sh: 1000 })
    assert.deepEqual(coverCropRect(600, 1200), { sx: 0, sy: 150, sw: 600, sh: 900 })
    assert.deepEqual(coverCropRect(400, 600), { sx: 0, sy: 0, sw: 400, sh: 600 })
  })

  test("ภาพกว้าง: ใช้ความสูงเต็ม ตัดสองข้างเท่ากัน", () => {
    assert.deepEqual(coverCropRect(1600, 900), { sx: 500, sy: 0, sw: 600, sh: 900 })
  })

  test("ภาพผอมสูง: ใช้ความกว้างเต็ม ตัดบนล่างเท่ากัน", () => {
    assert.deepEqual(coverCropRect(300, 1500), { sx: 0, sy: 525, sw: 300, sh: 450 })
  })

  test("ขอบเขต: สัดส่วนพอดี 2:3 ไม่ว่าด้านไหนเป็นตัวกำหนด (เท่ากับ ≥ ไม่ใช่ >)", () => {
    // 3w = 2h พอดี: ทั้งสองทางให้ผลเดียวกัน เลือกทางภาพกว้าง (ไม่ตัดอะไรเลย)
    assert.deepEqual(coverCropRect(2, 3), { sx: 0, sy: 0, sw: 2, sh: 3 })
    // เกินพอดีหนึ่งพิกเซล
    assert.deepEqual(coverCropRect(401, 600), { sx: 1, sy: 0, sw: 400, sh: 600 })
    assert.deepEqual(coverCropRect(400, 601), { sx: 0, sy: 1, sw: 400, sh: 600 }) // เหลือ 1 พิกเซล ปัด .5 ขึ้น
  })

  test("กรอบที่ครอบอยู่ในภาพเสมอและเป็น 2:3 (คลาดได้ไม่เกินการปัดเศษ) สำหรับทุกขนาดในตาราง", () => {
    for (let w = 1; w <= 60; w++) {
      for (let h = 1; h <= 60; h++) {
        const { sx, sy, sw, sh } = coverCropRect(w, h)
        const at = `${w}x${h}`
        assert.ok(Number.isInteger(sx) && Number.isInteger(sy) && Number.isInteger(sw) && Number.isInteger(sh), at)
        assert.ok(sx >= 0 && sy >= 0 && sw >= 1 && sh >= 1, at)
        assert.ok(sx + sw <= w && sy + sh <= h, at)
        // อย่างน้อยหนึ่งด้านใช้เต็มภาพ (ไม่ครอบเล็กกว่าที่จำเป็น)
        assert.ok(sw === w || sh === h, at)
        // อัตราส่วนคลาดได้ไม่เกินการปัดเศษหนึ่งครั้ง (|3·sw − 2·sh| ≤ 1)
        assert.ok(Math.abs(sw * 3 - sh * 2) <= 1, `${at}: ${sw}x${sh}`)
        // อยู่กลาง: ส่วนที่เหลือสองข้างต่างกันไม่เกินหนึ่งพิกเซล
        assert.ok(Math.abs(sx - (w - sx - sw)) <= 1 && Math.abs(sy - (h - sy - sh)) <= 1, at)
      }
    }
  })

  test("ขนาดที่ใช้ไม่ได้ (0, ลบ, NaN, อินฟินิตี้) → กรอบว่าง ไม่ใช่ NaN", () => {
    for (const [w, h] of [[0, 0], [0, 100], [100, 0], [-5, 100], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]] as const) {
      assert.deepEqual(coverCropRect(w, h), { sx: 0, sy: 0, sw: 0, sh: 0 }, `${w}x${h}`)
    }
  })
})

describe("ขนาดปกและฐานสอง", () => {
  test("ค่าคงที่ตาม spec: 400×600 และไม่เกิน 500KB (ตรงกับ MAX_COVER_BYTES ของเซิร์ฟเวอร์)", () => {
    assert.equal(COVER_WIDTH, 400)
    assert.equal(COVER_HEIGHT, 600)
    assert.equal(COVER_MAX_BYTES, 500 * 1024)
  })

  test("base64Bytes: ขนาดหลังถอดรหัสตามจำนวน padding", () => {
    assert.equal(base64Bytes(""), 0)
    assert.equal(base64Bytes("QQ=="), 1) // "A"
    assert.equal(base64Bytes("QUI="), 2) // "AB"
    assert.equal(base64Bytes("QUJD"), 3) // "ABC"
    assert.equal(base64Bytes("QUJDRA=="), 4)
    // ตรงกับ Buffer จริง
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1000, 1001, 1002]) {
      const b64 = Buffer.alloc(n, 7).toString("base64")
      assert.equal(base64Bytes(b64), n, String(n))
    }
  })

  test("stripDataUrl: ตัด prefix `data:image/jpeg;base64,` เหลือแต่ฐานสอง · ไม่ใช่ JPEG data URL → throw (เบราว์เซอร์เข้ารหัส JPEG ไม่ได้จะคืน PNG)", () => {
    assert.equal(stripDataUrl("data:image/jpeg;base64,QUJD"), "QUJD")
    assert.throws(() => stripDataUrl("data:image/png;base64,QUJD"), /JPEG/)
    assert.throws(() => stripDataUrl("data:,"), /JPEG/)
    assert.throws(() => stripDataUrl(""), /JPEG/)
    // ไม่แตะเนื้อใน: ถอด prefix เฉพาะส่วนหัว
    assert.equal(stripDataUrl("data:image/jpeg;base64,data:image/jpeg;base64,"), "data:image/jpeg;base64,")
  })
})

describe("encodeUnderLimit: ลดคุณภาพทีละขั้นจนผลไม่เกินเพดาน", () => {
  const sized = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64")

  test("ขั้นคุณภาพเริ่ม 0.9 ลดลงเรื่อยๆ และไม่เกิน 1", () => {
    assert.equal(COVER_QUALITIES[0], 0.9)
    for (let i = 1; i < COVER_QUALITIES.length; i++) assert.ok(COVER_QUALITIES[i]! < COVER_QUALITIES[i - 1]!)
    assert.ok(COVER_QUALITIES.at(-1)! > 0)
  })

  test("พอดีตั้งแต่ครั้งแรก → ลองครั้งเดียวที่คุณภาพสูงสุด", () => {
    const asked: number[] = []
    const out = encodeUnderLimit((q) => (asked.push(q), sized(1000)), 5000)
    assert.deepEqual(asked, [COVER_QUALITIES[0]])
    assert.equal(base64Bytes(out), 1000)
  })

  test("ใหญ่เกิน → ลดคุณภาพจนผ่านแล้วหยุดทันที (ไม่ลองต่อ)", () => {
    const asked: number[] = []
    const sizes = [900_000, 700_000, 520_000, 400_000, 300_000]
    const out = encodeUnderLimit((q) => {
      asked.push(q)
      return sized(sizes[asked.length - 1]!)
    }, COVER_MAX_BYTES)
    assert.deepEqual(asked, COVER_QUALITIES.slice(0, 4))
    assert.equal(base64Bytes(out), 400_000)
  })

  test("ขั้นคุณภาพมีแปดขั้นตามลำดับ และขั้นสุดท้าย (0.2) ยังถูกลองก่อนยอมแพ้", () => {
    assert.deepEqual([...COVER_QUALITIES], [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2])
    const asked: number[] = []
    const out = encodeUnderLimit((q) => (asked.push(q), sized(q === 0.2 ? 100 : 900_000)), COVER_MAX_BYTES)
    assert.equal(asked.length, 8)
    assert.equal(base64Bytes(out), 100)
  })

  test("ขนาดเท่าเพดานพอดีผ่าน · เกินหนึ่งไบต์ไม่ผ่าน", () => {
    assert.equal(base64Bytes(encodeUnderLimit(() => sized(COVER_MAX_BYTES), COVER_MAX_BYTES)), COVER_MAX_BYTES)
    const asked: number[] = []
    const out = encodeUnderLimit((q) => (asked.push(q), sized(asked.length === 1 ? COVER_MAX_BYTES + 1 : COVER_MAX_BYTES)), COVER_MAX_BYTES)
    assert.equal(asked.length, 2)
    assert.equal(base64Bytes(out), COVER_MAX_BYTES)
  })

  test("ลดจนสุดแล้วยังใหญ่เกิน → throw ข้อความไทย (ไม่ส่งไฟล์ใหญ่ให้เซิร์ฟเวอร์ปฏิเสธ)", () => {
    const asked: number[] = []
    assert.throws(() => encodeUnderLimit((q) => (asked.push(q), sized(10_000)), 5000), /ใหญ่เกินไป/)
    assert.deepEqual(asked, [...COVER_QUALITIES])
  })
})

describe("checkCoverFile: ตรวจไฟล์ก่อนถอดรหัส", () => {
  test("รูปที่เบราว์เซอร์ถอดรหัสได้ผ่าน", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) assert.equal(checkCoverFile({ type, size: 1000 }), null, type)
  })

  test("ไม่ใช่รูป / SVG / ไม่ทราบชนิด → ข้อความไทยบอกชนิดที่รับ", () => {
    for (const type of ["application/pdf", "image/svg+xml", "text/html", ""]) assert.match(checkCoverFile({ type, size: 1000 }) ?? "", /JPEG, PNG หรือ WebP/, type)
  })

  test("ใหญ่เกิน 25MB ไม่ผ่าน · พอดี 25MB ผ่าน", () => {
    assert.equal(COVER_MAX_SOURCE_BYTES, 25 * 1024 * 1024)
    assert.equal(checkCoverFile({ type: "image/png", size: COVER_MAX_SOURCE_BYTES }), null)
    assert.match(checkCoverFile({ type: "image/png", size: COVER_MAX_SOURCE_BYTES + 1 }) ?? "", /ใหญ่เกิน 25MB/)
  })
})

describe("coverCropRect: เลขคี่ปัดครึ่งขึ้น · base64Bytes ไม่มีช่องว่างท้าย", () => {
  test("ภาพแคบความกว้างคี่ (ความสูงที่ต้องการลงท้าย .5) ปัดขึ้นเหมือน sw", () => {
    // 401 × 1.5 = 601.5 → 602 · (1000 − 602) / 2 = 199
    assert.deepEqual(coverCropRect(401, 1000), { sx: 0, sy: 199, sw: 401, sh: 602 })
  })

  test("base64 ที่ไม่มี = ท้าย (ความยาวไม่ใช่ทวีคูณของ 4) นับไบต์แบบปัดลง: 'QUJDRA' = ABCD = 4 ไบต์", () => {
    assert.equal(base64Bytes("QUJDRA"), 4)
    assert.equal(base64Bytes("QUJDREU"), 5) // ABCDE
    assert.equal(base64Bytes("QUJD"), 3)
  })
})
