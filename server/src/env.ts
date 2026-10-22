// ต้องถูก import เป็นตัวแรกสุด เพื่อให้ค่าจาก .env พร้อมก่อนโมดูลอื่นอ่านค่า
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, "../.env"));
} catch {
  // ไม่มีไฟล์ .env ก็ไม่เป็นไร (อาจตั้งค่าผ่าน environment variable แทน)
}
