export interface Logger {
  info(m: string): void
  warn(m: string): void
  error(m: string): void
}

/** log ลงคอนโซล ใส่เวลา UTC นำหน้าทุกบรรทัด */
export function consoleLogger(): Logger {
  const stamp = () => new Date().toISOString()
  return {
    info: (m) => console.log(`${stamp()} info: ${m}`),
    warn: (m) => console.warn(`${stamp()} warn: ${m}`),
    error: (m) => console.error(`${stamp()} error: ${m}`),
  }
}

/** เก็บบรรทัดไว้ในหน่วยความจำ (ขึ้นต้น `info: `/`warn: `/`error: `) ไว้ใช้ในเทสต์ */
export function memoryLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    logger: {
      info: (m) => void lines.push(`info: ${m}`),
      warn: (m) => void lines.push(`warn: ${m}`),
      error: (m) => void lines.push(`error: ${m}`),
    },
  }
}
