/** แปลงชื่อคอลัมน์ snake_case เป็น camelCase (ชั้นเดียว) — จุดเดียวที่แปลงชื่อก่อนส่ง JSON */
export function camelize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out as T
}
