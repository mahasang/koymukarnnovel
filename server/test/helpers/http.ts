import http, { type IncomingHttpHeaders, type RequestListener } from "node:http"
import net, { type AddressInfo } from "node:net"

export interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  text: string
  /** `text` แปลงเป็น JSON ถ้าแปลงได้ ไม่งั้น undefined */
  json: unknown
}

/** เปิดเซิร์ฟเวอร์จริงที่ 127.0.0.1 (พอร์ตสุ่ม) ให้ `fn` ใช้ แล้วปิดเสมอ รวมถึงการเชื่อมต่อที่ยังค้าง */
export async function withServer<T>(app: RequestListener, fn: (s: { port: number; base: string }) => Promise<T>): Promise<T> {
  const server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address() as AddressInfo
  try {
    return await fn({ port, base: `http://127.0.0.1:${port}` })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * ส่งคำขอผ่าน `node:http` โดยตั้งหัวได้เกือบทุกตัว (`fetch` ห้ามตั้ง `Host`) ใช้ซ็อกเก็ตใหม่ทุกคำขอ (`Connection: close`)
 * `body` ที่ส่งมาจะถูกเขียนตามที่ให้ — ไม่มีการตั้ง Content-Type ให้เอง; ถ้าไม่ระบุ `Content-Length`/`Transfer-Encoding` จะใส่ `Content-Length`
 * ให้ทุกเมธอด (Node ไม่ใส่ให้ DELETE/GET ทำให้ body หลุดจากคำขอ) · ใส่ `Host` ว่างไม่ได้ (Node จะแทนด้วยของตัวเอง) ให้ใช้ `rawSocketRequest`
 */
export function rawRequest(o: { port: number; method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
  const headers: Record<string, string> = { Connection: "close", ...o.headers }
  const framed = Object.keys(headers).some((name) => ["content-length", "transfer-encoding"].includes(name.toLowerCase()))
  if (o.body !== undefined && !framed) headers["Content-Length"] = String(Buffer.byteLength(o.body))
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: o.port, method: o.method ?? "GET", path: o.path ?? "/", headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          let json: unknown
          try {
            json = JSON.parse(text)
          } catch {
            json = undefined
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json })
        })
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    req.end(o.body)
  })
}

/**
 * เขียนข้อความคำขอดิบลงซ็อกเก็ตเอง (ต้องมี `Connection: close` หรือ HTTP/1.0 เพื่อให้เซิร์ฟเวอร์ปิดเมื่อตอบเสร็จ)
 * ใช้กับคำขอที่ `node:http` ส่งให้ไม่ได้ เช่น `Host:` ว่าง หรือไม่มีหัว `Host` เลย
 */
export function rawSocketRequest(port: number, request: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1")
    const chunks: Buffer[] = []
    socket.on("connect", () => socket.write(request))
    socket.on("data", (chunk: Buffer) => chunks.push(chunk))
    socket.on("error", reject)
    socket.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(raw)?.[1]
      if (status === undefined) return reject(new Error(`ไม่ได้รับคำตอบ HTTP: ${JSON.stringify(raw.slice(0, 80))}`))
      resolve({ status: Number(status), text: raw.slice(raw.indexOf("\r\n\r\n") + 4) })
    })
  })
}
