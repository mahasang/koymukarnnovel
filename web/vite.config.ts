import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// เซิร์ฟเวอร์ API ตอนพัฒนา (พอร์ตเริ่มต้นของ server/src/config.ts)
const API = "http://127.0.0.1:8787"

export default defineConfig({
  plugins: [react()],
  build: {
    // ไม่ฝังไฟล์ใดเป็น data: URI — ฟอนต์ที่ถูกฝังจะโดน CSP (font-src 'self') ปิดกั้นบนเซิร์ฟเวอร์จริง
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    proxy: {
      "/api": API,
      "/covers": API,
    },
  },
})
