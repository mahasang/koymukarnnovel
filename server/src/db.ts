import fs from "node:fs"
import path from "node:path"
import { DatabaseSync, type StatementSync } from "node:sqlite"

/**
 * ห่อ `node:sqlite` ไว้ที่เดียว: ส่วนอื่นของระบบเรียกได้แค่ all/get/run/exec/tx/backupTo/close
 * (ตัวไลบรารีเป็นของ experimental จึงไม่ให้โค้ดอื่นแตะตรงๆ)
 */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[]
  get<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | undefined
  run(sql: string, ...p: unknown[]): { changes: number; lastInsertRowid: number }
  exec(sql: string): void
  /** รันเป็นธุรกรรมเดียว throw แล้ว rollback ทั้งก้อน ซ้อนกันได้ (ซ้อนในธุรกรรมเดิม) ห้ามใช้กับฟังก์ชัน async */
  tx<T>(fn: () => T): T
  /** สำเนาฐานข้อมูลที่สอดคล้องกันด้วย `VACUUM INTO` (ปลายทางต้องยังไม่มีไฟล์) */
  backupTo(file: string): void
  close(): void
}

type Param = null | number | bigint | string | NodeJS.ArrayBufferView

const STATEMENT_CACHE_LIMIT = 200

/** undefined → NULL, boolean → 0/1 นอกนั้นส่งต่อให้ SQLite (ค่าที่ผูกไม่ได้จะ throw ทันที ไม่เงียบ) */
function bind(values: unknown[]): Param[] {
  return values.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as Param)))
}

/** แถวจาก node:sqlite ไม่มี prototype → แปลงเป็น object ธรรมดา */
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

function assertSync<T>(result: T): T {
  if (result && typeof (result as { then?: unknown }).then === "function") {
    throw new TypeError("tx ใช้กับฟังก์ชัน async ไม่ได้ (ธุรกรรมจะ commit ก่อนงานเสร็จ)")
  }
  return result
}

/** `":memory:"` ได้ ไฟล์จริงจะสร้างโฟลเดอร์แม่ให้และใช้โหมด WAL */
export function openDb(file: string): Db {
  const memory = file === ":memory:"
  if (!memory) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec("PRAGMA foreign_keys = ON")
  raw.exec("PRAGMA busy_timeout = 5000")
  if (!memory) raw.exec("PRAGMA journal_mode = WAL")

  const cache = new Map<string, StatementSync>()
  const prepare = (sql: string): StatementSync => {
    let st = cache.get(sql)
    if (!st) {
      if (cache.size >= STATEMENT_CACHE_LIMIT) cache.clear()
      st = raw.prepare(sql)
      cache.set(sql, st)
    }
    return st
  }

  let depth = 0
  let nestedFailure: { error: unknown } | undefined

  return {
    all: <T>(sql: string, ...p: unknown[]) => prepare(sql).all(...bind(p)).map((r) => plain<T>(r)),
    get: <T>(sql: string, ...p: unknown[]) => {
      const row = prepare(sql).get(...bind(p))
      return row === undefined ? undefined : plain<T>(row)
    },
    run(sql, ...p) {
      const r = prepare(sql).run(...bind(p))
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    },
    exec: (sql) => raw.exec(sql),

    tx<T>(fn: () => T): T {
      if (depth > 0) {
        // ซ้อนในธุรกรรมเดิม: ถ้าข้างในล้ม จำไว้ เพื่อให้ธุรกรรมนอกสุดยกเลิกทั้งหมดแม้ผู้เรียกกลืน error ไว้
        depth++
        try {
          return assertSync(fn())
        } catch (error) {
          nestedFailure ??= { error }
          throw error
        } finally {
          depth--
        }
      }
      raw.exec("BEGIN IMMEDIATE")
      depth = 1
      try {
        const result = assertSync(fn())
        if (nestedFailure) throw new Error("ธุรกรรมที่ซ้อนอยู่ข้างในล้มเหลว จึงยกเลิกทั้งหมด", { cause: nestedFailure.error })
        raw.exec("COMMIT")
        return result
      } catch (error) {
        try {
          raw.exec("ROLLBACK")
        } catch {
          /* SQLite ยกเลิกธุรกรรมเองไปแล้ว */
        }
        throw error
      } finally {
        depth = 0
        nestedFailure = undefined
      }
    },

    backupTo: (target) => void raw.prepare("VACUUM INTO ?").run(target),
    close() {
      cache.clear()
      raw.close()
    },
  }
}
