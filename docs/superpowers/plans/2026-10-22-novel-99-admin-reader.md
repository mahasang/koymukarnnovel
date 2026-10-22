# Novel 99 — แผนงานลงมือทำ (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง Novel 99 ตาม spec: เว็บอ่านนิยายแปลไทยแบบสาธารณะ + หลังบ้านผู้ดูแลคนเดียว (วางข้อความ → แยกตอน → คิวแปลด้วย Claude → ตรวจ → เผยแพร่) + ช่องทางนำเข้าคำแปลจากภายนอกด้วยโทเค็น

**Architecture:** Node process เดียว (Express 5) เสิร์ฟ React SPA, `/api/public`, `/api/admin`, `/api/import`, `/covers` และ worker คิวแปลในโปรเซสเดียวกัน ข้อมูลอยู่ใน SQLite ไฟล์เดียว (`node:sqlite`, WAL) ซ่อนหลัง `db.ts` ทุกการเรียก Claude ผ่านออบเจ็กต์ `ai` เดียวที่ทดสอบแทนที่ได้ ทุกโมดูลรับ dependency ผ่าน `createApp(deps)` จึงทดสอบด้วย DB ในหน่วยความจำ + AI ปลอดได้

**Tech Stack:** Node ≥ 22.13, TypeScript 7, Express 5, `@anthropic-ai/sdk`, `compression` · React 19, Vite 8, `react-router`, `lucide-react`, `@fontsource/{prompt,sarabun,noto-serif-thai}` · `node:test` + `tsx` · `playwright-core` + Chromium ที่ติดตั้งไว้ (`/opt/pw-browsers/chromium`) ตรวจหน้าจอ

**Spec:** `docs/superpowers/specs/2026-10-22-novel-99-admin-reader-design.md` (ฉบับ 2 อนุมัติแล้ว) อ้างหัวข้อด้วยเลข เช่น "spec 8.5" ผู้ลงมือต้องอ่านทั้ง spec และแผนนี้ ภาพ mockup + `design-reference/{build,admin}.mjs` ในโฟลเดอร์ `…-assets/` เป็นต้นแบบ CSS/เลย์เอาต์ (ค่าสีให้ยึดตารางใน spec 6.5 ไม่ใช่ค่าใน mockup)

## Global Constraints

ทุกงานต้องเป็นไปตามนี้โดยปริยาย (ค่าคัดจาก spec ตรงตัว):

- **รันไทม์:** Node ≥ 22.13 · `node:sqlite` ใช้ได้แค่ `exec`/`prepare`/`run`/`get`/`all` และต้องอยู่หลัง `db.ts` เท่านั้น (spec 12.6) · server เป็น ESM (`"type":"module"`, tsconfig NodeNext, `rootDir: src`) เทสต์อยู่ `server/test` รันด้วย tsx ไม่รวมในการ build
- **โมเดล:** แปลและ ai-fill = `claude-sonnet-5-5` · สรุป/สกัดคำและทดสอบ API = `claude-haiku-4-5-20251001` · SDK `maxRetries: 5` · `max_tokens` ตอนแปล 8000
- **การแปล:** ชิ้นละ `translate` 5000 / `story` 6000 ตัวอักษร · ส่งท้ายผลชิ้นก่อน ~800 ตัวอักษร · เรื่องย่อบริบทไม่เกิน 5 ตอน · คำศัพท์จาก AI ไม่เกิน 15 ต่อตอน · โหมดมีแค่ `translate` กับ `story`
- **คิว:** ผิดพลาดชั่วคราวติดกัน 3 ตอน → หยุดเองด้วยข้อความ "พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API" · 401/403/เครดิตหมด/ไม่มี key → หยุดทันที ตอนที่ทำอยู่กลับเป็น `queued`
- **เวลา/ข้อมูล:** เก็บเวลาเป็น UTC `YYYY-MM-DD HH:MM:SS` · "วัน" ของยอดอ่านและโทเคน = UTC+7 · JSON เป็น camelCase แปลงจาก snake_case ที่จุดเดียว (`util/camel.ts`) · ข้อความผิดพลาดที่ผู้ใช้เห็นเป็นภาษาไทย
- **ขีดจำกัด:** ชื่อเรื่อง/ชื่อตอน ≤ 300 ตัวอักษร · แท็ก ≤ 12 อัน อันละ ≤ 40 · ตอน ≤ 200,000 ตัวอักษร · วางได้ ≤ 100 ตอนต่อครั้ง · body หลังบ้าน 8MB · body นำเข้า 2MB · ปก ≤ 500KB (JPEG/PNG/WebP ตรวจ magic bytes) · นำเข้า: `translation` 1–400,000 ตัวอักษร, `titleTh` ≤ 300, `recap` ≤ 2,000, `terms` ≤ 30 (`source`/`thai` ≤ 200, `note` ≤ 300)
- **อัตรา:** ล็อกอินผิด 10 ครั้ง/15 นาที/IP (429 + `Retry-After`) · `/api/public` 120 คำขอ/นาที/IP · นำเข้า: โทเค็นผิด 10 ครั้ง/15 นาที/IP แยกถังนับ + รวม 60 คำขอ/นาที/IP
- **ความปลอดภัย:** CSP ตรงตัว `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (ห้าม inline script) · cookie `n99_admin` HMAC-SHA256 หมดอายุ 30 วัน `HttpOnly; SameSite=Lax; Path=/` (+`Secure` เมื่อ HTTPS) · ไม่มีเส้นทางสาธารณะใดเรียก Claude · ความลับ (`ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `IMPORT_TOKEN`) อยู่ใน env เท่านั้น ห้ามลง DB/log/หน้าเว็บ · เนื้อหาแสดงเป็นข้อความล้วน (ห้าม `dangerouslySetInnerHTML`) · ใช้ prepared statement ทุกคำสั่ง SQL
- **หน้าเว็บ:** UI ไทยอย่างเดียว `<html lang="th">` · ธีมเริ่มต้น Midnight (สลับ Paper/Sepia/Black ได้) · ความต่างสีทุกคู่ข้อความ/พื้น ≥ 4.5:1 · รองรับ `prefers-reduced-motion` · ทุกหน้ามีสถานะ โหลด/ผิดพลาดพร้อมลองใหม่/ไม่พบ/ว่าง · localStorage ห่อ try/catch เสมอ
- **ขอบเขตงาน:** ห้ามแตะโฟลเดอร์จริงของเจ้าของ `C:\Project\novel-99` ก่อน Task 37 · Claude ไม่ตั้ง/ไม่อ่าน/ไม่แสดงความลับของเจ้าของ · ไม่ติดตั้ง agent skill ใดๆ

**Conventions (ใช้ทุกงาน):** ทำงานที่ `/home/claude/novel-99` สาขา `feat/public-site-admin` ·
`S-TEST <ไฟล์>` = `cd /home/claude/novel-99/server && node --disable-warning=ExperimentalWarning --import tsx --test <ไฟล์>` · `W-TEST <ไฟล์>` = `cd /home/claude/novel-99/web && node --import tsx --test <ไฟล์>` · ชุดเต็ม `npm test` (ที่ราก) · ตรวจชนิด `npm run typecheck` ·
Commit = `git add <ไฟล์ของงานนั้น>` แล้ว `git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "<ข้อความ>"` โดยท้ายข้อความใส่สองบรรทัด `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` และ `Claude-Session: https://claude.ai/code/session_01KzerQaq6Ct5uJeeMPrBS74` · ในแผนเขียนแค่ข้อความ commit ·
เทสต์เขียนแบบ `ชื่อเทสต์ → assertion` ค่าที่ระบุคือค่าจาก spec ที่ต้องอยู่ใน assertion จริง · "ไทย" ในเทสต์ = ข้อความตรงกับ `/[\u0E00-\u0E7F]/`

## Review Focus

ข้อมูลหรือเงื่อนไขที่ spec ไม่ได้พูดถึงตรงๆ แต่ผู้ใช้จริงมีโอกาสเจอมากที่สุด เรียงตามโอกาสเจอ แต่ละข้อมีเทสต์กำกับในงานที่เป็นเจ้าของโค้ด:

1. **วางข้อความที่คัดลอกมาจากเว็บ** (BOM, CRLF, NBSP, หัวข้อ `Chapter 12.5`, ประโยคธรรมดาที่ขึ้นต้นว่า "Chapter 3 was…"): ไม่มีอักขระล่องหนค้างในข้อมูล · `12.5` ไม่ถูกอ่านเป็นตอน 12 เงียบๆ (ขึ้นเป็นแถวไม่มีเลข ติ๊กออก ให้เจ้าของใส่เอง) · ประโยคธรรมดาไม่ถูกจับเป็นหัวข้อ (Task 3, 13, 22)
2. **ลบตอน/เรื่องที่กำลังถูกแปลอยู่:** สตรีมนั้นถูกยกเลิก ไม่มีแถวฟื้นกลับมา ไม่เขียนอะไรลง DB และคิวไปทำตอนถัดไปต่อ (Task 9, 12, 13)
3. **วางข้อความใหญ่เกินกำหนด** (body เกิน 8MB / ตอนเกิน 200,000 ตัวอักษร / นำเข้าเกิน 2MB): ได้ 413/400 เป็น JSON ภาษาไทยที่หน้าเว็บแสดงให้เห็น ไม่ใช่หน้า HTML ผิดพลาดและเซิร์ฟเวอร์ไม่ล้ม (Task 11, 13, 17, 31)
4. **`TRUST_PROXY=0` แต่มีหัว `X-Forwarded-For`** (อยู่หลัง proxy โดยไม่ได้ตั้งค่า หรือมีคนปลอมหัว): ตัวจำกัดล็อกอิน/อัตราต้องไม่ถูกหลบด้วยการเปลี่ยนค่าหัว และ log เตือนครั้งเดียวให้ตั้ง `TRUST_PROXY` (Task 10)
5. **ฟังเสียงย่อหน้าภาษาไทยยาวที่ไม่มีช่องว่าง:** ตัดท่อนตามขอบเขตคำ ท่อนละไม่เกิน 180 ตัวอักษร ไม่ตัดกลางคำ ไม่ปล่อยทั้งย่อหน้าให้เบราว์เซอร์อ่านครั้งเดียวแล้วเงียบ (Task 26)

## การตัดสินใจที่ทำในแผนนี้ (ส่วนที่ spec ปล่อยไว้ — ขอให้เจ้าของตรวจ)

1. **ชุดสี accent:** ค่าตั้งเป็น `default | violet | pink | teal | amber | blue` `default` = ใช้สีของแต่ละธีมตามตาราง spec 6.5 ค่าของ 5 ชุดอยู่ใน Task 20 (คำนวณความต่างสีผ่านทุกคู่แล้ว ต่ำสุด 4.959:1) เซิร์ฟเวอร์ใส่ `<html data-accent>` ใน shell เพื่อไม่ให้จอวาบ
2. **`parseChapters`:** เลขตอนทศนิยมหรืออ่านเลขไม่ได้ให้ `number: null` (ติ๊กออกพร้อมป้ายเตือน) · ข้อความก่อนหัวข้อแรกที่ยาวเกิน 500 ตัวอักษรได้เลข (เลขสูงสุดที่มีและที่วางมา + 1) แก้เองได้
3. **`createApp(deps)` / `app.ts`:** เพิ่มจากโครงใน spec 13 เพื่อให้ทดสอบ HTTP ด้วย DB ในหน่วยความจำและ AI ปลอม · มี `http/admin/*.ts` แยกตามกลุ่มเส้นทาง · `http/validate.ts` และ `http/dto.ts` ใช้ร่วมกัน
4. **`GET /api/public/site` มี `isAdmin`:** ให้หน้าบ้านแสดงลิงก์ไปหลังบ้านและป้ายร่าง (ตอบ `private, no-store` เมื่อเป็นผู้ดูแล)
5. **`POST /api/admin/chapters/bulk`** รับ `{where:"ready", novelId?}` คู่กับ `publish` ไว้ให้ปุ่ม "เผยแพร่ทั้งหมด" บน Dashboard · `translate` โดยไม่มี API key ตอบ 400 `no_api_key` · อัปโหลดปกส่ง `{data: <base64>}` · ไม่อนุญาตให้ล้างคำแปลของตอนที่เผยแพร่อยู่ (400 ให้ซ่อนก่อน)
6. **ช่องทางนำเข้า:** ใส่ `GET` สองเส้นทางตาม spec เป็นขั้นแยกท้าย Task 17 ตัดออกได้ · `PUT` ที่ไม่ส่ง `recap` ล้างเรื่องย่อเดิม (spec 7.11 ข้อ 6)
7. **ประมาณค่าใช้จ่าย:** โทเคนเข้า ≈ ⌈ตัวอักษร/4⌉ + 1500 ต่อตอน · โทเคนออก ≈ ⌈ตัวอักษร/4 × 1.8⌉ · คิดตามราคาที่เจ้าของกรอก (หน่วยตามที่กรอก)
8. **ทดสอบหน้าจอ:** `playwright-core` + Chromium ในเครื่อง · เซิร์ฟเวอร์สำหรับ e2e เป็นไฟล์แยก `e2e/server.ts` ที่ฉีด AI ปลอมเข้า `createApp` (ไม่มี flag ทดสอบในโค้ดจริง) · ภาพหน้าจอเก็บใน `docs/superpowers/verification/`
9. **การส่งมอบ:** พัฒนาและทดสอบในเครื่องของ Claude ทั้งหมด แล้วซิงก์ชุดที่ทดสอบแล้วเข้า `C:\Project\novel-99` ครั้งเดียวใน Task 37 (ไฟล์เดิมที่ต่างจาก prototype รวมแทนเขียนทับ ลบไฟล์ต้องได้รับอนุญาตก่อน ไม่ได้ก็ย้ายไป `_to_delete/`)

## ลำดับงาน

| ช่วง | งาน | ผลที่ได้ |
|---|---|---|
| ฐาน | 1 | workspace พร้อม เอา prototype ออก |
| แกนเซิร์ฟเวอร์ | 2–9 | config, DB+migrate, settings, prompt, ai, โดเมนตอน, คิวแปล (ทดสอบด้วย AI ปลอม) |
| HTTP | 10–19 | auth/ความปลอดภัย, API หลังบ้าน/สาธารณะ/นำเข้า, shell+SEO, เริ่มระบบ+ข้อมูลตัวอย่าง |
| หน้าบ้าน | 20–27 | ธีม, ที่เก็บในเครื่อง, parseChapters, หน้าแรก/เรื่อง/อ่าน/อื่นๆ, PWA |
| หลังบ้าน | 28–34 | layout+ล็อกอิน, Dashboard, นิยาย, เพิ่มตอน, ตารางตอน, แก้ตอน+อภิธาน, ตั้งค่า |
| ตรวจและส่ง | 35–37 | e2e+ภาพหน้าจอ, Docker/README/ตรวจทั้งชุด, ส่งเข้าโฟลเดอร์จริง |

## โครงไฟล์ (ต่อยอด spec 13)

```
server/src/  index.ts config.ts types.ts db.ts migrate.ts settings.ts chunks.ts prompts.ts ai.ts chapters.ts context.ts usage.ts
             queue.ts auth.ts security.ts views.ts covers.ts backup.ts seed.ts app.ts  util/{time,text,camel,errors,log}.ts
             http/{shell,public,import,admin,dto,validate}.ts  http/admin/{auth,novels,chapters,glossary,queue,dashboard,settings}.ts
server/test/ *.test.ts  helpers/{fake-ai,fake-anthropic,http,app}.ts  fixtures/legacy.ts
web/src/     main.tsx App.tsx  lib/{types,api,useFetch,storage,theme,reader-prefs,progress,format,parse-chapters,cost,text,speech,useSpeech,cover-crop,useDocumentTitle}.ts lib/SiteContext.tsx
             components/ pages/ admin/ styles/{tokens,base,public,admin}.css      web/public/ manifest.webmanifest sw.js theme-init.js icon*
e2e/         server.ts run.mjs shot.mjs
```

---

## ช่วงที่ 1 — ฐาน และแกนเซิร์ฟเวอร์ (Task 1–9)

### Task 1: ฐานงาน — สคริปต์ workspace และเอาโค้ด prototype ออก

**Files:** แก้ `package.json`, `server/package.json`, `web/package.json`, `server/tsconfig.json`, `.gitignore` · สร้าง `server/tsconfig.test.json`, `server/test/smoke.test.ts`, `web/src/smoke.test.ts`, `web/src/vite-env.d.ts` · `git rm` `server/src/{claude,db,index}.ts`, `web/src/{App.tsx,api.ts,main.tsx,styles.css}`, `web/src/pages/*` · เก็บไว้ `server/src/env.ts`, `web/src/useSpeech.ts` (แก้ใน Task 26), `web/public/*` (แก้ใน Task 27)
**Interfaces:** Produces: สคริปต์ `npm test | typecheck | build | dev | seed:demo` ที่ใช้ทั้งแผน · โค้ด prototype ดูได้จาก `git show c0e0ba8:<path>` (Task 4 เอา DDL เดิม, Task 6 เอา `splitChunks`/`buildSystem`, Task 26 ย้ายและเขียน `useSpeech.ts` ใหม่จากไฟล์ที่เก็บไว้)

- [ ] **Step 1: ปรับสคริปต์/dependency** — ราก: `workspaces` บรรทัดเดียว, `build` = `npm run build -w server && npm run build -w web`, `concurrently` `^9.2.1` (ตามที่เจ้าของตั้ง spec 15.2), เพิ่ม `test` = `npm test -w server && npm test -w web`, `seed:demo` = `npm run seed:demo -w server`, devDependency `playwright-core` · server: `test` = `node --disable-warning=ExperimentalWarning --import tsx --test "test/**/*.test.ts"`, `typecheck` = `tsc --noEmit && tsc --noEmit -p tsconfig.test.json`, `seed:demo` = `tsx src/seed.ts`, dependency `compression`, dev `@types/compression`; `tsconfig.test.json` extends ตัวหลักด้วย `rootDir: "."`, `include: ["src","test"]` · web: `test` = `node --import tsx --test "src/**/*.test.ts"`, dev `tsx`, dependency `react-router` `lucide-react` `@fontsource/prompt` `@fontsource/sarabun` `@fontsource/noto-serif-thai` · `.gitignore` เพิ่ม `e2e/out`
- [ ] **Step 2:** `cd /home/claude/novel-99 && npm install` → สำเร็จไม่มี error
- [ ] **Step 3:** `git rm` ไฟล์ prototype ตามรายการ สร้าง `web/src/vite-env.d.ts` (`/// <reference types="vite/client" />`) เพื่อให้ `tsc` มีอินพุต
- [ ] **Step 4: smoke test** — `server/test/smoke.test.ts`: `Node >= 22.13` (แยก `process.versions.node`) · `node:sqlite roundtrip` (`:memory:` → `exec` สร้างตาราง → `prepare().run` → `get`/`all` ได้แถวเดิม) · `web/src/smoke.test.ts`: `Intl.Segmenter("th",{granularity:"word"}).segment("ฉันกำลังเดินไปที่ตลาด")` ได้มากกว่า 3 ส่วน (Task 26 พึ่งพา)
- [ ] **Step 5:** `npm run typecheck && npm test` → ผ่านทั้งหมด (ถ้า web ไม่มีเทสต์แล้ว exit ≠ 0 ให้ยืนยันว่ามี `smoke.test.ts` ถูกจับ)
- [ ] **Step 6: Commit** `chore: set up workspace scripts and remove prototype sources`

### Task 2: `config.ts` — อ่านและตรวจ env

**Files:** สร้าง `server/src/config.ts` · เทสต์ `server/test/config.test.ts`
**Interfaces:** Produces:
```ts
export interface Config { host: string; port: number; publicUrl: string | null; trustProxy: number; dbPath: string; webDist: string;
  adminPassword: string | null; sessionSecret: string; importToken: string | null; anthropicApiKey: string | null;
  translateModel: string; recapModel: string; isLoopbackHost: boolean; hsts: boolean }
export class ConfigError extends Error {}
export function loadConfig(env: NodeJS.ProcessEnv): { config: Config; warnings: string[] }
```

- [ ] **Step 1: เทสต์** — `ค่าเริ่มต้น`: `loadConfig({}).config` ได้ `host "127.0.0.1"`, `port 8787`, `trustProxy 0`, `adminPassword null`, `importToken null`, `publicUrl null`, `translateModel "claude-sonnet-5-5"`, `recapModel "claude-haiku-4-5-20251001"`, `isLoopbackHost true` และ warnings มีข้อความ "หลังบ้านเปิดโดยไม่ต้องล็อกอิน" · `HOST=0.0.0.0` ไม่มีรหัส → throw `ConfigError` ข้อความมี `ADMIN_PASSWORD`; มีรหัส → ผ่านและ `isLoopbackHost false` · `IMPORT_TOKEN` 23 ตัวอักษร → `importToken null` + warning มี `IMPORT_TOKEN`; 24 ตัว → ตั้งค่า ไม่มี warning · `ADMIN_PASSWORD` 9 ตัว → ใช้ได้ + warning · `TRUST_PROXY="2"` → `2`; `"x"` และ `"-1"` → `ConfigError` · `PUBLIC_URL="https://a.example/"` → `"https://a.example"` + `hsts true`; `"ftp://x"` → `ConfigError` · `PORT="70000"` → `ConfigError`, `PORT="0"` ผ่าน · ค่า env ว่าง `""` นับเป็นไม่ตั้ง
- [ ] **Step 2:** `S-TEST test/config.test.ts` → FAIL (module not found)
- [ ] **Step 3: เขียน `loadConfig`** — `dbPath` เริ่มต้น `<server>/data/novel-99.db` และ `webDist` เริ่มต้น `<repo>/web/dist` คำนวณจาก `import.meta.url` (ใช้ได้ทั้ง `src/` และ `dist/`) · loopback = `127.0.0.1`/`localhost`/`::1`
- [ ] **Step 4:** รันซ้ำ → PASS
- [ ] **Step 5: Commit** `feat(server): env config loader with startup safety checks`

### Task 3: ชนิดข้อมูลและ util กลาง

**Files:** สร้าง `server/src/types.ts`, `server/src/util/{time,text,camel,errors,log}.ts` · เทสต์ `server/test/util.test.ts`
**Interfaces:** Produces: `types.ts` — `Mode = "translate"|"story"`, `MODES`, `ChapterStatus = "draft"|"queued"|"translating"|"done"|"error"`, `Term = { source: string; thai: string; note?: string }`, `NovelRow`/`ChapterRow`/`GlossaryRow` (คอลัมน์ snake_case ตาม spec 5.1, ค่า 0/1 เป็น `number`) · `time.ts` — `nowSql(d?: Date): string`, `dayKey(d: Date): string` (UTC+7) · `text.ts` — `normalizeText(s: string): string`, `escapeHtml(s: string): string`, `truncate(s: string, n: number): string` · `camel.ts` — `camelize<T>(row: Record<string, unknown>): T` · `errors.ts` — `class HttpError(status, message, code?, extra?)`, `badRequest(msg, code?)`, `notFound(msg?)`, `conflict(msg, code, extra?)` · `log.ts` — `interface Logger { info(m: string): void; warn(m: string): void; error(m: string): void }`, `consoleLogger(): Logger` (ใส่เวลา), `memoryLogger(): { logger: Logger; lines: string[] }` (ไว้ทดสอบ; บรรทัดขึ้นต้น `warn: `/`info: `/`error: `)

- [ ] **Step 1: เทสต์** — `nowSql(new Date("2026-10-22T01:02:03.456Z")) === "2026-10-22 01:02:03"` · `dayKey(new Date("2026-10-22T17:00:00Z")) === "2026-10-23"` และ `…T16:59:59Z → "2026-10-22"` · **(Review Focus 1)** `normalizeText("﻿a b\r\nc\r\n\r\n\r\n\r\nd  \n") === "a b\nc\n\nd"` และลบ `​` · `escapeHtml('<a href="x">&\'</a>')` ได้ `&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;` · `truncate("กขคงจ", 3) === "กขค…"` (นับ code point) และสั้นกว่า n คืนเดิม · `camelize({title_th:"x",created_at:"y"})` ได้ `{titleTh:"x",createdAt:"y"}` · `new HttpError(409,"m","dup",{a:1})` เก็บ status/code/extra · `memoryLogger().logger.warn("a")` ทำให้ `lines` เป็น `["warn: a"]`
- [ ] **Step 2:** `S-TEST test/util.test.ts` → FAIL
- [ ] **Step 3: เขียนโมดูล** ตาม signature · `normalizeText` ทำตามลำดับ: ลบ BOM/ZWSP → `\r\n?`→`\n` → NBSP/U+2007/U+202F→ช่องว่าง → ตัดช่องว่างท้ายบรรทัด → ยุบบรรทัดว่างตั้งแต่ 3 บรรทัดเป็น 2 → trim ปลาย
- [ ] **Step 4:** รันซ้ำ → PASS แล้ว `npm run typecheck`
- [ ] **Step 5: Commit** `feat(server): shared types and text/time/camel/error utilities`

### Task 4: `db.ts` + `migrate.ts` — ฐานข้อมูลและการย้ายจาก prototype

**Files:** สร้าง `server/src/{db,migrate}.ts` · เทสต์ `server/test/db.test.ts`, `server/test/migrate.test.ts`, `server/test/fixtures/legacy.ts`
**Interfaces:** Produces:
```ts
export interface Db { all<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[]; get<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | undefined;
  run(sql: string, ...p: unknown[]): { changes: number; lastInsertRowid: number }; exec(sql: string): void; tx<T>(fn: () => T): T; backupTo(file: string): void; close(): void }
export function openDb(file: string): Db            // ":memory:" ได้; สร้างโฟลเดอร์แม่; WAL (เฉพาะไฟล์), foreign_keys=ON, busy_timeout=5000
export const SCHEMA_VERSION = 1
export function migrate(db: Db): { fromVersion: number; migratedPrototype: boolean }
export function renameLegacyDb(dbPath: string): boolean   // novel-teller.db(+ -wal/-shm) → novel-99.db(+…) เมื่อยังไม่มีปลายทางเท่านั้น
```

- [ ] **Step 1: เทสต์ `db`** — `undefined` ถูกส่งเป็น NULL, boolean เป็น 0/1, `run` คืน `changes`/`lastInsertRowid` เป็น number · `tx` throw แล้ว rollback ทั้งก้อน และ tx ซ้อนกัน (inner throw → rollback ทั้งหมด) · `backupTo(file)` ได้ไฟล์ที่เปิดด้วย `openDb` แล้วอ่านข้อมูลเดิมได้ (ใช้ `VACUUM INTO ?`) · ไฟล์จริง `PRAGMA journal_mode` = `wal` · ลบ novel แล้ว chapters/glossary/covers หายตาม (cascade)
- [ ] **Step 2: เทสต์ `migrate`** — `fixtures/legacy.ts` สร้าง DB prototype โดยรัน DDL จาก `git show c0e0ba8:server/src/db.ts` (novels/chapters/translations/glossary) ใส่เรื่อง 1 ตอน 1–3: ตอน 1 มีคำแปล `translate` และ `story`, ตอน 2 มีแต่ `story`, ตอน 3 มีแต่ `summary`, พร้อมคำศัพท์ 1 แถว · หลัง `migrate`: `PRAGMA user_version = 1`, `migratedPrototype true`, คอลัมน์ครบตามตาราง spec 5.1 (เทสต์เทียบรายการคอลัมน์จาก `PRAGMA table_info` ของ `novels`/`chapters`/`glossary` โดยต้องมี `novels.published`, `novels.featured`, `novels.mode`, `chapters.translation`, `chapters.recap`, `chapters.auto_publish`, `chapters.queue_seq`, `glossary.auto` และ `updated_at` ของ `novels`/`chapters`), ตอน 1 = ข้อความ `translate` / ตอน 2 = ข้อความ `story` ทั้งคู่ `status "done"`, `published 1`, `published_at` = เวลาของแถวคำแปล, ตอน 3 `status "draft"` `translation ""` แต่แถวใน `translations` ยังอยู่, `novels.mode "translate"` (ถ้ามีแต่ `story` → `"story"`), **ทุกเรื่อง `published 0`**, ตาราง `translations` ยังอยู่ · รันซ้ำ: คืน `{fromVersion:1, migratedPrototype:false}` และข้อมูลที่เจ้าของแก้หลังย้าย (เช่น แก้ `translation`) ไม่ถูกทับ · DB ว่าง: สร้างครบทุกตาราง (`novels chapters glossary covers settings usage views`) + ดัชนี `chapters(novel_id, published, number)` และ `chapters(status, queue_seq)` · `renameLegacyDb`: โฟลเดอร์ชั่วคราวที่มี `novel-teller.db`, `-wal`, `-shm` → ย้ายครบเป็น `novel-99.*` คืน `true`; ถ้ามี `novel-99.db` อยู่แล้ว ไม่แตะและคืน `false`
- [ ] **Step 3:** `S-TEST test/db.test.ts` และ `S-TEST test/migrate.test.ts` → FAIL
- [ ] **Step 4: เขียน `db.ts`** — ห่อ `DatabaseSync` แคช prepared statement ตาม SQL · `tx` นับความลึก (ไม่พึ่ง `isTransaction`) เริ่มด้วย `BEGIN IMMEDIATE`
- [ ] **Step 5: เขียน `migrate.ts`** — ทั้งหมดอยู่ใน `db.tx` · DDL ตาราง/คอลัมน์ตาม spec 5.1 · ตารางที่มีอยู่ใช้ `PRAGMA table_info` แล้ว `ALTER TABLE … ADD COLUMN` เฉพาะที่ขาด · **SQLite ไม่ยอม `ADD COLUMN` ที่ default ไม่คงที่** จึงเพิ่ม `updated_at TEXT NOT NULL DEFAULT ''` แล้ว `UPDATE … SET updated_at = created_at` · ขั้นคัดลอกคำแปลทำเฉพาะเมื่อ `user_version = 0` และพบตาราง `translations` (spec 5.2 ข้อ 3–4) จากนั้นตั้ง `user_version = 1`
- [ ] **Step 6:** รันทั้งสองไฟล์ → PASS · `npm run typecheck`
- [ ] **Step 7: Commit** `feat(server): sqlite wrapper, schema and prototype migration`

### Task 5: `settings.ts` — ค่าตั้งค่า DB → env → ค่าเริ่มต้น

**Files:** สร้าง `server/src/settings.ts` · เทสต์ `server/test/settings.test.ts`
**Interfaces:** Consumes: `Db` (Task 4), `Config` (Task 2), `HttpError` (Task 3). Produces:
```ts
export const ACCENTS = ["default","violet","pink","teal","amber","blue"] as const; export type AccentId = (typeof ACCENTS)[number]
export interface SiteSettings { siteName: string; tagline: string; aboutText: string; contactText: string; accent: AccentId; indexable: boolean;
  translateModel: string; recapModel: string; prices: Record<string, { in: number; out: number }> }
export interface Settings { get(): SiteSettings; update(patch: Partial<SiteSettings>): SiteSettings; getInternal(key: string): string; setInternal(key: string, value: string): void }
export function createSettings(db: Db, cfg: Pick<Config, "translateModel" | "recapModel">): Settings
```

- [ ] **Step 1: เทสต์** — ค่าเริ่มต้น: `siteName "Novel 99"`, `accent "default"`, `indexable true`, `prices {}`, โมเดลมาจาก `cfg` · ลำดับ: ค่าใน DB ชนะ `cfg` · `update` ไม่รู้จักคีย์ → ข้าม · `accent:"bogus"` → `HttpError 400` · `siteName:""` และยาว > 80 → 400 · `tagline` ≤ 160, `aboutText` ≤ 5000, `contactText` ≤ 2000 · ชื่อโมเดลต้องตรง `^[\w.\-]+$` ≤ 100 · `prices` รูป `{"claude-sonnet-5-5":{in:3,out:15}}` ตัวเลข ≥ 0 เท่านั้น ผิดรูป → 400 · `setInternal("queue_paused_reason","x")` แล้ว `getInternal` ได้ `"x"`, ค่าที่ไม่เคยตั้งได้ `""` และ **ไม่ปรากฏใน `get()`**
- [ ] **Step 2:** `S-TEST test/settings.test.ts` → FAIL
- [ ] **Step 3: เขียน** — เก็บเป็นแถว `settings(key, value)`; ค่า boolean/object เก็บเป็น JSON; ค่าเริ่มต้นข้อความ `tagline` "นิยายแปลไทย อ่านสบาย ทุกที่" และ `aboutText` สั้นๆ ภาษาไทยว่าเว็บนี้คืออะไร
- [ ] **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): layered settings store`

### Task 6: `chunks.ts` + `prompts.ts`

**Files:** สร้าง `server/src/{chunks,prompts}.ts` · เทสต์ `server/test/chunks.test.ts`, `server/test/prompts.test.ts`
**Interfaces:** Produces:
```ts
export const CHUNK_SIZE: Record<Mode, number>            // translate 5000, story 6000
export function splitChunks(text: string, max: number): string[]
export const SECTION_TITLES: { rules: string; thai: string; style: string; glossary: string; recaps: string }
export function buildSystem(o: { mode: Mode; novelTitle: string; styleNote: string; glossary: { source: string; thai: string; note: string }[]; recaps: { number: number; recap: string }[] }): string
export function buildUserChunk(o: { chunk: string; index: number; total: number; previousTail?: string }): string
export const RECAP_TOOL: { name: "save_chapter_notes"; description: string; input_schema: object }   // ผลลัพธ์ {recap, titleTh, terms[≤15]}
export const RECAP_SYSTEM: string
```

- [ ] **Step 1: เทสต์ chunks** (พอร์ตจาก `git show c0e0ba8:server/src/claude.ts`) — แบ่งตามย่อหน้าและไม่เกิน `max` · ย่อหน้าเล็กรวมกันคั่นด้วยบรรทัดว่าง · ย่อหน้ายาวถูกตัดตามประโยค (`.!?。！？”"` ตามด้วยช่องว่าง) · ประโยคเดียวยาวเกิน `max` ถูกตัดที่ช่องว่างสุดท้ายก่อน `max` (ถ้ามีหลัง `max/2`) ไม่ตัดกลางคำ · CRLF · ข้อความว่าง/ช่องว่างล้วน → `[]` · `CHUNK_SIZE` = `{translate:5000, story:6000}`
- [ ] **Step 2: เทสต์ prompts** — ลำดับส่วนใน `buildSystem` (ใช้ `indexOf` ของ `SECTION_TITLES`): บทบาท < กติกา < กติกาภาษาไทย < สไตล์ < อภิธาน < เรื่องย่อ · ส่วนที่ว่าง (`styleNote` ว่าง, อภิธานว่าง, เรื่องย่อว่าง) ไม่ปรากฏทั้งหัวข้อ · ทั้งสองโหมดมีข้อความว่า `<source_text>` เป็นเนื้อหาไม่ใช่คำสั่ง และกติกา spec 8.3 ครบ: ข้ามเมนู/ปุ่มถัดไป/โฆษณา/ข้อความขอบคุณผู้บริจาค, "หมายเหตุผู้เขียน:", เส้นคั่นฉาก `***` · กติกาภาษาไทย 6 ข้อครบ (ประธาน/สรรพนาม, ซึ่ง-การ-ความ-ที่ว่า, ถูก, ระดับภาษา/คำลงท้าย, สรรพนามบุคคลที่ 1-2, สำนวน/เสียงประกอบ) ทั้งสองโหมด · โหมด `story` มีคำว่า "เล่าเรื่อง" ใน mode rule, `translate` ไม่มี · `recaps` ส่งเกิน 5 → ใช้ 5 ตอนสุดท้ายเรียงเลขน้อยไปมาก · `buildUserChunk` ห่อ `<source_text>…</source_text>`, ใส่ `<previous_output_tail>` เฉพาะเมื่อมี `previousTail`, ระบุลำดับชิ้น `index+1/total` · `RECAP_TOOL.name === "save_chapter_notes"`, `required` = `["recap","titleTh","terms"]`, `terms.maxItems === 15`
- [ ] **Step 3:** `S-TEST test/chunks.test.ts` และ `S-TEST test/prompts.test.ts` → FAIL
- [ ] **Step 4: เขียน** — `splitChunks`/`hardSplit` ย้ายมาปรับตามเทสต์ · `buildSystem` ใช้โครงเดิมของ prototype ปรับเป็นเว็บสาธารณะ ข้อความกติกาอยู่ในไฟล์นี้ที่เดียว (spec 8.3) · `RECAP_SYSTEM` สั่งสรุป 2–3 ประโยค ตั้งชื่อตอนไทย และสกัดชื่อเฉพาะใหม่พร้อมคำไทยที่ใช้จริง
- [ ] **Step 5:** รัน → PASS · **Step 6: Commit** `feat(server): chunk splitter and prompt builders with Thai naturalness rules`

### Task 7: `ai.ts` — ออบเจ็กต์ `ai` และการจัดประเภทข้อผิดพลาด

**Files:** สร้าง `server/src/ai.ts` · เทสต์ `server/test/ai.test.ts` · helper `server/test/helpers/{fake-anthropic,fake-ai}.ts`
**Interfaces:** Consumes: `RECAP_TOOL`, `RECAP_SYSTEM` (Task 6), `Term` (Task 3; ผล `chapterNotes` มี `note` เป็น string เสมอ). Produces:
```ts
export interface Usage { inputTokens: number; outputTokens: number }
export interface Ai { hasKey(): boolean;
  translateChunk(p: { model: string; system: string; user: string; maxTokens: number; onText: (t: string) => void; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }>;
  chapterNotes(p: { model: string; thaiText: string; sourceTitle: string }): Promise<{ recap: string; titleTh: string; terms: Term[]; usage: Usage }>;
  fillNovel(p: { model: string; title: string; synopsisSrc: string; author: string }): Promise<{ titleTh: string; synopsis: string; tags: string[]; usage: Usage }>;
  ping(model: string): Promise<{ usage: Usage }> }
export class AiError extends Error { fatal: boolean; status: number | null }
export function classifyError(e: unknown): AiError            // AbortError ผ่านไปไม่ห่อ (ผู้เรียกเช็ก signal.aborted)
export function createAi(apiKey: string | null, o?: { fetch?: typeof fetch; maxRetries?: number }): Ai   // ค่าเริ่มต้น maxRetries 5
```
`fake-anthropic.ts`: `sse(events)` สร้าง `Response` แบบ SSE (`message_start`, `content_block_start/delta/stop`, `message_delta` พร้อม `stop_reason`/`usage`, `message_stop`) และ `jsonMessage(content, usage)` · `fake-ai.ts`: `createFakeAi(script?)` คืน `Ai` ที่บันทึก `calls[]` และจำลองพฤติกรรมรายครั้ง (ข้อความที่ไหลออกมา, หน่วงเวลา+เคารพ `signal`, throw `AiError`) ใช้ใน Task 9–19, 35

- [ ] **Step 1: เทสต์** (ผ่าน `fetch` ปลอมที่ฉีดเข้า SDK) — `translateChunk` ส่ง `onText` ทีละส่วน ("สวัส","ดี") คืน `text "สวัสดี"` + `usage {inputTokens:11, outputTokens:7}` และ body ที่ส่งมี `model`, `max_tokens: 8000`, `system`, `stream: true` · `stop_reason: "max_tokens"` → `AiError` ไม่ fatal ข้อความไทยบอกว่าคำตอบถูกตัด · `chapterNotes` ส่ง `tool_choice {type:"tool",name:"save_chapter_notes"}` อ่านผลจาก `tool_use.input` ตัด `terms` เหลือ 15 และทิ้งรายการที่ขาด `source`/`thai`; ไม่มี `tool_use` → `AiError` ไม่ fatal · `fillNovel` บังคับ tool คืน `titleTh`, `synopsis`, `tags` (≤12 อัน อันละ ≤40) · `ping` เรียกด้วย `max_tokens` เล็ก คืน usage · `classifyError`: 401 และ 403 → fatal; 400 ที่ข้อความมี "credit balance" → fatal ข้อความไทยพูดถึงเครดิต; 429, 500, 529 และ network → ไม่ fatal · ไม่มี key: `hasKey() === false` และทุกเมธอด reject ด้วย `AiError` fatal ข้อความมี `ANTHROPIC_API_KEY` · `maxRetries:1` + ตอบ 429 พร้อมหัว `retry-after-ms: 1` แล้วตอบ 200 → สำเร็จ (พิสูจน์ว่า SDK ลองใหม่) · abort กลางสตรีม → reject ด้วย error ชื่อ `AbortError`
- [ ] **Step 2:** `S-TEST test/ai.test.ts` → FAIL
- [ ] **Step 3: เขียน `createAi`** — `new Anthropic({ apiKey, maxRetries, fetch })`; `translateChunk` ใช้ `messages.stream` + `stream.on("text", onText)` + `finalMessage()`; `chapterNotes`/`fillNovel`/`ping` ใช้ `messages.create`; ข้อความผิดพลาดของ `AiError` เป็นภาษาไทยอ่านง่าย (401/403 "API key ไม่ถูกต้องหรือไม่มีสิทธิ์" · เครดิต "เครดิต API หมดหรือบัญชีมีปัญหา" · 429/529 "Claude API ไม่ว่างหรือถูกจำกัดอัตราชั่วคราว" · 5xx "Claude API ขัดข้อง" · เครือข่าย "เชื่อมต่อ Claude API ไม่ได้" · ไม่มี key "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY" · ถูกตัดเพราะ `max_tokens` "คำตอบยาวเกินและถูกตัด") และไม่มีตัว key ใน message
- [ ] **Step 4:** รัน → PASS · **Step 5: Commit** `feat(server): ai facade with error classification and fakes`

### Task 8: โดเมนตอน — `chapters.ts`, `context.ts`, `usage.ts`, `views.ts`

**Files:** สร้าง `server/src/{chapters,context,usage,views}.ts` · เทสต์ `server/test/chapters.test.ts`, `server/test/views.test.ts` (ใช้ `openDb(":memory:")` + `migrate`)
**Interfaces:** Produces:
```ts
export const VISIBLE_SQL: string          // "c.published = 1 AND c.translation <> '' AND n.published = 1" (alias c = chapters, n = novels)
export function applyTranslation(db: Db, chapterId: number, p: { translation: string; titleTh?: string; recap?: string | null; terms?: Term[]; publish?: boolean; now: string }): boolean   // false ถ้าแถวหายไปแล้ว; undefined = ไม่แตะ
export function enqueueChapters(db: Db, ids: number[], o: { autoPublish: boolean; now: string }): { queued: number[]; skipped: number[] }
export function setPublished(db: Db, ids: number[], publish: boolean, now: string): { changed: number; skipped: number }
export function recordUsage(db: Db, day: string, model: string, u: Usage): void            // upsert (day, model) บวก tokens_in/out, calls+1
export function buildContext(db: Db, chapterId: number): { novel: NovelRow; chapter: ChapterRow; glossary: GlossaryRow[]; recaps: { number: number; recap: string }[]; system: string } | null
// views.ts — นับยอดอ่านโดยไม่เก็บ IP (spec 9.2)
export interface Views { record(o: { ip: string; ua: string; novelId: number; chapterId: number }): boolean }   // true = นับครั้งนี้
export function createViews(d: { db: Db; now: () => Date; max?: number }): Views                              // max เริ่มต้น 200_000
```

- [ ] **Step 1: เทสต์** — `applyTranslation`: ตั้ง `translation`, `translated_at`, `status "done"`, ล้าง `error`, `queue_seq NULL`; **ไม่เผยแพร่** เว้นแต่ `publish:true` (ตั้ง `published_at` ครั้งแรกครั้งเดียว ไม่เปลี่ยนเมื่อเรียกซ้ำ) · `titleTh` ใส่เฉพาะเมื่อ `title_th` ว่าง · `recap`: `undefined` ไม่แตะ, string ตั้งค่า, `null` ล้าง · `terms` เป็น `INSERT OR IGNORE` ด้วย `auto=1` ไม่ทับคำเดิม (`auto=0` ยังอยู่ครบ) · แถวถูกลบไปแล้ว → คืน `false` ไม่ throw · `enqueueChapters`: เรียงตาม `(novel_id, number)` ได้ `queue_seq` ต่อจากค่าสูงสุด, ข้ามตอนที่ `translating`/`queued` อยู่แล้ว, ตั้ง `auto_publish`, ล้าง `error`, ตอน `done` ที่แปลใหม่ **คำแปลเดิมยังอยู่** · `setPublished(true)` ข้ามตอนที่ `translation` ว่างและนับใน `skipped`, `published_at` ตั้งครั้งแรกเท่านั้น, `false` ซ่อนได้ · `recordUsage` เรียกสองครั้งวันเดียวกัน/โมเดลเดียวกันได้แถวเดียว `calls 2` · `buildContext`: `recaps` = ตอนก่อนหน้าที่มีเรื่องย่อไม่เกิน 5 ตอนล่าสุด เรียงเลขน้อยไปมาก (ไม่รวมตอนปัจจุบันและตอนที่เลขมากกว่า) และ `system` เท่ากับ `buildSystem(...)` ที่ประกอบด้วยข้อมูลชุดเดียวกัน
- [ ] **Step 2: เทสต์ `views`** — ip+ua+ตอนเดิมสองครั้งในวันเดียว → `true` แล้ว `false` และ `views(day, novel_id).count` = 1 · UA ต่าง → นับเพิ่ม (2) · วันถัดไป (เลื่อน `now` ข้าม UTC+7 เที่ยงคืน) นับใหม่และชุดในหน่วยความจำถูกล้าง · `max:2` แล้วใส่คีย์ต่างกันตัวที่ 3 → ชุดถูกล้าง (ขนาดไม่เกิน `max`) · ตาราง `views` ไม่มีคอลัมน์หรือค่าที่เป็น IP/UA (ตรวจ `PRAGMA table_info` และเนื้อหาทุกแถว)
- [ ] **Step 3:** `S-TEST test/chapters.test.ts` และ `S-TEST test/views.test.ts` → FAIL · **Step 4: เขียนโมดูล** ทุกฟังก์ชันที่เขียนหลายแถวห่อด้วย `db.tx` · `views` แฮช sha256(`ip|ua|chapterId|เกลือประจำวัน`) เกลือสุ่มใหม่เมื่อ `dayKey` เปลี่ยน แล้ว upsert `views(day, novel_id)` · **Step 5:** รัน → PASS
- [ ] **Step 6: Commit** `feat(server): chapter domain rules, context assembly, usage log and view counter`

### Task 9: `queue.ts` — worker คิวแปล

**Files:** สร้าง `server/src/queue.ts` · เทสต์ `server/test/queue.test.ts` (ใช้ `fake-ai` + DB ในหน่วยความจำ)
**Interfaces:** Consumes: Task 4–8. Produces:
```ts
export interface QueueState { paused: boolean; pausedReason: string; consecutiveErrors: number; waitingTotal: number;
  current: null | { chapterId: number; novelId: number; novelTitle: string; number: number; chunkIndex: number; chunkTotal: number; textTail: string };   // textTail = ท้าย ~2000 ตัวอักษรของผลที่ไหลอยู่
  waiting: { id: number; novelId: number; novelTitle: string; number: number }[] }   // สูงสุด 50 ตามลำดับ queue_seq
export interface Queue { enqueue(ids: number[], o: { autoPublish: boolean }): { queued: number; skipped: number };   // เรียก enqueueChapters แล้ว wake()
  tick(): Promise<"idle" | "done" | "error" | "paused">;
  start(): void; stop(): Promise<void>; wake(): void; pause(reason: string): void; resume(): void; cancelIfCurrent(chapterIds: number[]): boolean; recoverOnStart(): void; state(): QueueState }
export function createQueue(d: { db: Db; settings: Settings; ai: Ai; now?: () => Date; log?: Logger }): Queue
```
อัลกอริทึม `tick()` (spec 8.2–8.5): (1) หยุดอยู่ (`queue_paused_reason` ไม่ว่าง) → `"paused"` (2) `!ai.hasKey()` → `pause("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY …")` (3) หยิบตอนที่ `queue_seq` น้อยสุดด้วย `UPDATE … SET status='translating' WHERE id=? AND status='queued'` (ไม่ได้แถว → ลองตอนถัดไป) (4) `buildContext` → `splitChunks(source, CHUNK_SIZE[mode])` → `translateChunk` ทีละชิ้น ส่งท้ายผลชิ้นก่อน 800 ตัวอักษรใน `buildUserChunk` เก็บผลไว้ในหน่วยความจำ บันทึก `recordUsage` ทุกครั้ง (5) `chapterNotes` ด้วย `recapModel` (ล้มเหลว → log เตือน ตอนยังเป็น `done` ไม่มีเรื่องย่อ) (6) `applyTranslation({publish: auto_publish === 1, recap: notes?.recap ?? null, terms})` ผิดพลาดชั่วคราว → `UPDATE … SET status='error', error=? WHERE id=? AND status='translating'` นับ `consecutiveErrors` ครบ 3 → `pause("พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API")` ผิดพลาดร้ายแรง (`AiError.fatal`) → ตอนกลับ `queued` (คง `queue_seq`) แล้ว `pause(e.message)` · `signal` ที่ถูก abort มี 2 ชนิด: `cancel` (ถูกลบ → ทิ้งเงียบๆ ไม่แตะสถานะ) และ `shutdown` (`stop()` → ตอนกลับ `queued`) · `pause`/`resume` เก็บสาเหตุผ่าน `settings.setInternal("queue_paused_reason")` · `start()` วนลูป `tick()` รอ `wake()` หรือ 5 วินาทีเมื่อ `idle`/`paused`

- [ ] **Step 1: เทสต์** — ทำทีละตอนตามลำดับ `queue_seq` (สองตอนไม่ทับซ้อน) · เขียน `translation`, `recap`, `title_th` (เฉพาะที่ว่าง), `terms` (`INSERT OR IGNORE`), และ `usage` (ต่อ day/model) · ตอนยาว 3 ชิ้น: `translateChunk` ถูกเรียก 3 ครั้ง, `user` ของชิ้นที่ 2 มี tail ≤ 800 ตัวอักษรของชิ้นแรก, `state().current` มี `chunkIndex/chunkTotal` · `system` มีเรื่องย่อไม่เกิน 5 ตอนก่อนหน้า · ผิดพลาดชั่วคราว: ตอนเป็น `error` มีข้อความ คิวทำตอนถัดไป · ติดกัน 3 ตอน → `paused` พร้อมข้อความ "พบข้อผิดพลาดติดกัน 3 ครั้ง ตรวจสอบสถานะ API" และสำเร็จหนึ่งตอนรีเซ็ตตัวนับ · 401 → ตอนกลับ `queued` (ยังมี `queue_seq`), คิวหยุด, เหตุผลถูกเก็บใน settings และ `resume()` แล้วทำต่อได้ · ไม่มี key → `paused` ข้อความมี `ANTHROPIC_API_KEY` และไม่เรียก `ai` · `recoverOnStart` เปลี่ยน `translating` → `queued` · `auto_publish=1` เผยแพร่, `0` ไม่เผยแพร่ · แปลใหม่ของตอนที่เผยแพร่แล้วล้มเหลว → `status error` แต่ `translation` เดิมและ `published 1` ยังอยู่ · `chapterNotes` ล้มเหลว → ตอน `done` ไม่มี recap และมี log เตือน · **(Review Focus 2)** `cancelIfCurrent([id])` ระหว่างสตรีม + ลบแถว → ไม่มีแถวกลับมา ไม่มีการเขียน `usage` เพิ่มหลังยกเลิก `tick()` คืนค่าและตอนถัดไปถูกทำต่อ · `stop()` ระหว่างสตรีม → ตอนกลับ `queued` · ตอนที่ถูกเปลี่ยนเป็น `done` (นำเข้า) ระหว่างรอคิว ไม่ถูกหยิบไปแปล (`ai.calls` ว่าง) · `textTail` ยาวไม่เกิน 2000
- [ ] **Step 2:** `S-TEST test/queue.test.ts` → FAIL · **Step 3: เขียน `createQueue`** ตามอัลกอริทึมด้านบน · **Step 4:** รัน → PASS · `npm run typecheck`
- [ ] **Step 5: Commit** `feat(server): translation queue worker with pause/recover semantics`

---

## ช่วงที่ 2 — HTTP: ความปลอดภัย, API, shell, เริ่มระบบ (Task 10–19)

### Task 10: `auth.ts` + `security.ts`

**Files:** สร้าง `server/src/{auth,security}.ts`, `server/test/helpers/http.ts` (`withServer(app, fn)` และ `rawRequest(...)` ผ่าน `node:http` เพื่อกำหนดหัว `Host`/`X-Forwarded-For` ได้) · เทสต์ `server/test/auth.test.ts`, `server/test/security.test.ts`
**Interfaces:** Produces:
```ts
// auth.ts
export const COOKIE_NAME = "n99_admin"; export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
export function sessionKey(password: string, secret: string): Buffer            // sha256("n99-session-v1\0" + secret + "\0" + password)
export function signSession(key: Buffer, nowMs: number): string                 // base64url(exp) + "." + HMAC-SHA256
export function verifySession(key: Buffer, token: string | undefined, nowMs: number): boolean
export function passwordMatches(input: string, expected: string): boolean       // เทียบ sha256 ด้วย timingSafeEqual
export function cookieHeader(token: string, secure: boolean): string
export function clearCookieHeader(secure: boolean): string
export function parseCookies(header: string | undefined): Record<string, string>
// security.ts
export const CSP: string                                                         // ตรงกับ Global Constraints
export interface RateLimiter { hit(key: string): { allowed: boolean; retryAfterSec: number }; sweep(): void; size(): number }
export function createRateLimiter(o: { windowMs: number; max: number; now?: () => number }): RateLimiter
export interface FailureLimiter { check(key: string): { blocked: boolean; retryAfterSec: number }; recordFailure(key: string): void; reset(key: string): void }
export function createFailureLimiter(o: { windowMs: number; max: number; now?: () => number }): FailureLimiter
export function securityHeaders(o: { hsts: boolean }): RequestHandler
export function originGuard(o: { allowedHosts?: string[] }): RequestHandler     // POST/PUT/PATCH/DELETE: ถ้ามี Origin ต้องตรง Host; ถ้ามี body ต้องเป็น application/json
export function loopbackHostOnly(): RequestHandler                                // Host ต้องเป็น localhost / 127.0.0.1 / [::1] (มี :port ได้)
export function clientIp(req: Request): string                                    // req.ip ?? socket.remoteAddress ?? "unknown"
export function warnForwardedOnce(o: { trustProxy: number; log: Logger }): RequestHandler
```

- [ ] **Step 1: เทสต์ auth** — เซ็น/ตรวจผ่าน, ไม่ผ่านที่ `now + SESSION_TTL_MS + 1` · แก้ payload หรือลายเซ็นแม้ 1 ตัวอักษร / `undefined` / ขยะ → ไม่ผ่าน · เปลี่ยนรหัสผ่านหรือ `SESSION_SECRET` → token เก่าไม่ผ่าน · `passwordMatches` ความยาวต่างกันไม่ throw · `cookieHeader(t,false) === "n99_admin=<t>; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax"` และ `true` ต่อท้าย `; Secure` · `clearCookieHeader` มี `Max-Age=0` · `parseCookies("a=1; n99_admin=xyz; b=2")`
- [ ] **Step 2: เทสต์ security** — ตัวจำกัดอัตรา `max:120`: ครั้งที่ 121 ในหน้าต่างเดียวกัน `allowed:false` + `retryAfterSec ≥ 1`, พ้นหน้าต่างแล้วผ่านใหม่, `sweep()` ล้างคีย์หมดอายุ (`size()` ลด) · ตัวจำกัดความผิดพลาด `max:10, windowMs:15*60_000`: ผิดครบ 10 ครั้ง `check` → blocked, ผ่านไป 15 นาที → ไม่ blocked, `reset` ล้าง, คีย์ต่างกันไม่กระทบกัน · `securityHeaders`: `Content-Security-Policy === CSP`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` มี `camera=()` `microphone=()` `geolocation=()`, HSTS เฉพาะ `hsts:true`, `X-Robots-Tag: noindex` เฉพาะ path ขึ้นต้น `/api` หรือ `/admin` · `originGuard`: POST ที่ `Origin: http://evil.test` กับ `Host: localhost:8787` → 403 ข้อความไทย; Origin ตรงโฮสต์ผ่าน; ไม่มี Origin ผ่าน; มี body + `text/plain` → 415; GET ที่ Origin ต่างโฮสต์ผ่าน · `loopbackHostOnly`: `Host: evil.test` → 403; `localhost:8787`, `127.0.0.1:1`, `[::1]:80` ผ่าน · **(Review Focus 4)** แอปทดลองที่ `trust proxy` = 0 ใช้ `clientIp` + ตัวจำกัดความผิดพลาด: ส่งคำขอผิด 11 ครั้งจากซ็อกเก็ตเดียวโดยเปลี่ยน `X-Forwarded-For` ทุกครั้ง → ครั้งที่ 11 ได้ 429 และ `warnForwardedOnce` เขียน log เตือนเพียง 1 ครั้งซึ่งมีคำว่า `TRUST_PROXY`; เมื่อ `trust proxy` = 1 ค่า XFF ต่างกันแยกถังจริงและไม่มีคำเตือน
- [ ] **Step 3:** `S-TEST test/auth.test.ts` และ `S-TEST test/security.test.ts` → FAIL
- [ ] **Step 4: เขียนโมดูล** · `Logger` (`info/warn/error`) อยู่ใน `util/log.ts` (Task 3) · ตัวจำกัดเก็บ `Map<key,{count,resetAt}>` และ `sweep()` ถูกเรียกเป็นระยะด้วย `setInterval(...).unref()` ที่ผู้สร้าง (ไม่ใช่ใน module scope)
- [ ] **Step 5:** รัน → PASS · **Step 6: Commit** `feat(server): signed admin sessions, rate limiters and security middleware`

### Task 11: `app.ts` + หลังบ้าน: ล็อกอินและด่านตรวจ

**Files:** สร้าง `server/src/app.ts`, `server/src/http/admin.ts`, `server/src/http/admin/auth.ts`, `server/test/helpers/app.ts` · เทสต์ `server/test/admin-auth.test.ts`
**Interfaces:** Produces:
```ts
export interface AppDeps { config: Config; db: Db; settings: Settings; ai: Ai; queue: Queue; views: Views; now: () => Date; log: Logger }
export function createApp(deps: AppDeps): Express
export function createAdminRouter(deps: AppDeps): Router                          // ประกอบ sub-router ใน http/admin/*.ts (Task 12–15)
export function isAdminRequest(deps: AppDeps, req: Request): boolean              // ไม่มีรหัส (loopback) → true; ไม่งั้นตรวจ cookie
// test/helpers/app.ts
export async function startTestApp(o?: { config?: Partial<Config>; ai?: Ai; now?: () => Date; webDist?: string }): Promise<{
  base: string; db: Db; settings: Settings; ai: FakeAi; queue: Queue; config: Config; logs: string[]; cancelCalls: number[][];
  client(): Client; close(): Promise<void> }>     // DB :memory:+migrate, password "test-password-123", importToken 24+ ตัว, ฟัง 127.0.0.1:0
// Client: get/post/put/patch/delete(path, body?) → { status, headers, json, text }; login(); มี cookie jar; POST ใส่ Origin=base + JSON ให้เอง; raw(path, init) สำหรับกรณีพิเศษ
// ผลของ startTestApp มี cancelCalls: number[][] = อาร์กิวเมนต์ของทุกครั้งที่ queue.cancelIfCurrent ถูกเรียก (helper ห่อ queue จริงไว้) และ logs: string[] จาก memoryLogger
```
ลำดับ middleware ใน `createApp`: `trust proxy` = `config.trustProxy` → `securityHeaders` → `compression` → `warnForwardedOnce` → `/healthz` (ตอบ `ok`) → `/api/public` → `/api/admin` → `/api/import` (เมื่อมี `importToken`) → `/covers` → `/api/*` 404 JSON → shell (Task 18) → error handler: `HttpError` → `{error, code?, …extra}`, `entity.too.large` → 413 `{error:"ข้อมูลที่ส่งมาใหญ่เกินกำหนด", code:"too_large"}`, `entity.parse.failed` → 400 ไทย, อื่นๆ → log + 500 ข้อความไทยทั่วไป · ใน admin router: `Cache-Control: no-store` → `originGuard` → `POST /login` (`express.json({limit:"1kb"})`) → `POST /logout` → ด่านตรวจ (401 `{error}`; โหมดไม่มีรหัสต้องผ่าน `loopbackHostOnly` ก่อน) → `express.json({limit:"8mb"})` → `GET /me` (→ `{admin:true, passwordless:boolean}`) → sub-routers (ตรวจตัวตนก่อนอ่าน body)

- [ ] **Step 1: เขียน helper `startTestApp`** และเทสต์ — `GET /api/admin/me` ไม่มี cookie → 401; หลัง `login()` → 200 `{admin:true, passwordless:false}` · รหัสผิด → 401 ข้อความไทย; ผิดครบ 10 ครั้งจาก IP เดียว → ครั้งถัดไป 429 + `Retry-After` · cookie ที่ได้มี `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`, ไม่มี `Secure` บน http; มี `Secure` เมื่อ `trustProxy:1` และส่ง `X-Forwarded-Proto: https` · `logout` ล้าง cookie · CSRF: POST ด้วย Origin ต่างโฮสต์ → 403, `text/plain` → 415 · โหมดไม่มีรหัส (`adminPassword:null`, loopback): `/me` ผ่านโดยไม่มี cookie; ส่ง `Host: evil.test` → 403 · ทุกคำตอบใต้ `/api/admin` มี `Cache-Control: no-store` · `/api/public` ด้วย POST → 405 · `/api/ไม่มีอยู่` → 404 JSON · JSON พัง → 400 ไทย · **(Review Focus 3)** หลัง login ส่ง JSON ขนาด 9MB ไป `/api/admin/me` → 413 `code:"too_large"` ข้อความไทย แล้วคำขอถัดไป `/me` ยังตอบ 200 (เซิร์ฟเวอร์ไม่ล้ม) · ตัว login ที่ส่ง body 2KB → 413
- [ ] **Step 2:** `S-TEST test/admin-auth.test.ts` → FAIL · **Step 3: เขียน** `app.ts`, `admin.ts`, `admin/auth.ts` (`views`/public/import/shell ยังไม่มี — mount เฉพาะที่มีแล้ว โดยแต่ละงานถัดไปเพิ่มบรรทัด mount ของตัวเอง) · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): express app skeleton with admin login, CSRF and error handling`

### Task 12: หลังบ้าน — นิยาย, ปก, ai-fill

**Files:** สร้าง `server/src/http/{validate,dto}.ts`, `server/src/http/admin/novels.ts`, `server/src/covers.ts` · เทสต์ `server/test/admin-novels.test.ts`, `server/test/covers.test.ts`
**Interfaces:** Produces:
```ts
// validate.ts — ทุกตัว throw HttpError 400 ข้อความไทยบอกชื่อฟิลด์
export function obj(v: unknown): Record<string, unknown>
export function str(v: unknown, field: string, o: { max: number; min?: number; optional?: boolean }): string
export function int(v: unknown, field: string, o?: { min?: number; max?: number }): number
export function bool(v: unknown, field: string): boolean
export function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T
export function tags(v: unknown): string[]          // ≤ 12 อัน อันละ ≤ 40 ตัดช่องว่าง ตัดซ้ำ
export function httpUrl(v: unknown, field: string): string   // "" หรือ http/https ยาว ≤ 2000
// dto.ts
export interface AdminNovelDto { id: number; title: string; titleTh: string; author: string; synopsis: string; synopsisSrc: string; tags: string[]; status: "ongoing"|"completed";
  sourceUrl: string; licenseNote: string; styleNote: string; mode: Mode; published: boolean; featured: boolean; hasCover: boolean; coverV: number; chapterCount: number; translatedCount: number; publishedCount: number; createdAt: string; updatedAt: string }
// covers.ts
export function detectImage(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null      // magic bytes
export function createCoversRouter(deps: AppDeps): Router                                          // GET /covers/:novelId
```
เส้นทาง (spec 7.10): `GET/POST /novels`, `GET/PATCH/DELETE /novels/:id`, `PUT/DELETE /novels/:id/cover`, `POST /novels/ai-fill` (ลงทะเบียนก่อน `/novels/:id`)

- [ ] **Step 1: เทสต์** — ทุกเส้นทางไม่ล็อกอินได้ 401 · สร้าง `{title:"T"}` → 201 ค่าเริ่มต้น `mode "translate"`, `status "ongoing"`, `published false`, `featured false`, `tags []` · ตรวจฟิลด์: ไม่มี title / title 301 ตัว / แท็ก 13 อัน / แท็กยาว 41 / `sourceUrl:"javascript:alert(1)"` / `mode:"summary"` → 400 · `PATCH` ส่งบางฟิลด์ได้ · `featured:true` ที่เรื่อง B ปลด `featured` ของเรื่อง A (มีได้เรื่องเดียว) · `GET /novels` มี `chapterCount/translatedCount/publishedCount` ถูกต้อง · **(Review Focus 2)** `DELETE /novels/:id` ทำให้ `cancelCalls` มีรหัสตอนทั้งหมดของเรื่องนั้น แล้วลบตอน/อภิธาน/ปกตามไปด้วย · `ai-fill`: เรียก `ai.fillNovel` ด้วย `settings.translateModel` คืน `{titleTh, synopsis, tags}`, บันทึก `usage`, **ไม่เขียน novel**; ไม่มี key → 400 `code:"no_api_key"` · ปก: `PUT {data: <base64 PNG เล็ก>}` → 200 `{coverV}`; `GET /covers/:id` → 200 `image/png`, `nosniff`, มี `ETag`, `Cache-Control: public, max-age=604800`, ส่ง `If-None-Match` ตรง → 304 · magic bytes ผิด (ข้อความธรรมดา) → 400 · ใหญ่เกิน 500KB → 413 `code:"cover_too_large"` · เรื่องที่ซ่อน: ผู้ใช้ทั่วไป 404, ผู้ดูแลได้ 200 พร้อม `Cache-Control: private, no-store` · `DELETE …/cover` แล้ว GET → 404
- [ ] **Step 2:** `S-TEST test/admin-novels.test.ts` และ `S-TEST test/covers.test.ts` → FAIL · **Step 3: เขียน** validators, dto, router, covers (ตัวแปลง `?v=` เป็นเวลาแก้ปกเป็นวินาที epoch ใน `coverV`) · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): admin novels API, cover upload and AI autofill`

### Task 13: หลังบ้าน — ตอน

**Files:** สร้าง `server/src/http/admin/chapters.ts` · เทสต์ `server/test/admin-chapters.test.ts`
**Interfaces:** Consumes: Task 8, 9, 12. Produces เส้นทาง: `GET /novels/:id/chapters` (แถวเบา: `id, number, title, titleTh, status, error, published, publishedAt, translatedAt, queueSeq, hasTranslation, srcLength`) · `POST /novels/:id/chapters` `{chapters:[{number,title,text}], translate, publish}` → 201 `{created:number[], queued:number}` · `GET /chapters/:id` · `PATCH /chapters/:id` (`title, titleTh, sourceText, translation, recap`) · `DELETE /chapters/:id` · `POST /chapters/bulk` `{ids? , where?: "ready", novelId?, action: "translate"|"publish"|"hide"|"delete", autoPublish?}` (≤ 500 id)

- [ ] **Step 1: เทสต์** — **(Review Focus 1)** สร้างตอนจากข้อความที่มี BOM + CRLF + NBSP → ที่เก็บเป็น `normalizeText` แล้ว · สร้างแบบ `translate:false` → `draft`; `translate:true` → `queued` เรียงตามเลขตอนแม้ส่งมากลับด้าน; `publish:true` ตั้ง `auto_publish` เฉพาะเมื่อ `translate:true` · เลขซ้ำกับที่มีอยู่ หรือซ้ำกันเองในคำขอ → 409 `{code:"duplicate_numbers", conflicts:[…]}` และไม่สร้างอะไรเลย · ตอนละ 200,001 ตัวอักษร (**Review Focus 3**) / 101 ตอน / `number:-1` → 400 ไทย; `number:0` ผ่าน · `translate:true` ไม่มี key → 400 `no_api_key` และไม่สร้างอะไร · `PATCH`: แก้ชื่อ/ต้นฉบับ/เรื่องย่อไม่เปลี่ยนสถานะและไม่เข้าคิว · ส่ง `translation` ให้ตอนที่ยังว่าง → `done`, `translated_at`, ล้าง `error`, ออกจากคิว (`queue_seq` NULL), **ไม่เผยแพร่**, ไม่เรียก `ai` · ส่ง `translation` ให้ตอนที่มีคำแปลแล้ว → แก้ข้อความ สถานะเดิม · ตอน `translating` → 409 `code:"translating"` (แก้ชื่อ/เรื่องย่อยังได้) · ล้าง `translation` ของตอนที่เผยแพร่อยู่ → 400 · bulk `publish`: ข้ามตอนไม่มีคำแปลและคืน `{changed, skipped}`; `where:"ready"` เผยแพร่ทุกตอน `done` ที่ยังไม่เผยแพร่ (จำกัดตาม `novelId` ถ้าส่ง); `hide`; `translate` ข้ามตอน `translating`/`queued`, ไม่มี key → 400, ทำให้ตอน `done` กลับเป็น `queued` โดยคำแปลเดิมอยู่; `autoPublish` ถูกบันทึก · **(Review Focus 2)** `DELETE` ตอนที่ `translating` ทำให้ `cancelCalls` มี `[id]` ก่อนแถวหาย; bulk `delete` เช่นกัน · id ที่ไม่มี → 404
- [ ] **Step 2:** `S-TEST test/admin-chapters.test.ts` → FAIL · **Step 3: เขียน router** (ทุกการเขียนหลายแถวใน `db.tx`; เข้าคิวผ่าน `deps.queue.enqueue` เท่านั้น; ข้อความและคำแปลผ่าน `normalizeText` ก่อนบันทึกเสมอ) · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): admin chapters API with batch create, bulk actions and manual translation`

### Task 14: หลังบ้าน — อภิธานศัพท์และคิว

**Files:** สร้าง `server/src/http/admin/{glossary,queue}.ts` · เทสต์ `server/test/admin-glossary.test.ts`
**Interfaces:** เส้นทาง: `GET /novels/:id/glossary?auto=1`, `POST /novels/:id/glossary`, `PATCH /glossary/:id`, `DELETE /glossary/:id` · `GET /queue` (= `queue.state()` + `errors: {id, novelId, novelTitle, number, error}[]` ตอนผิดพลาดล่าสุดไม่เกิน 20), `POST /queue/pause` `{reason?}` (ค่าเริ่มต้น "หยุดโดยผู้ดูแล"), `POST /queue/resume`

- [ ] **Step 1: เทสต์** — เพิ่ม/แก้/ลบ · `source`/`thai` ≤ 200, `note` ≤ 300 มิฉะนั้น 400 · `source` ซ้ำในเรื่องเดียวกัน → 409 `code:"duplicate"` · `?auto=1` กรองเฉพาะ `auto=1` · แก้ `thai` หรือ `note` ของแถว AI แล้ว `auto` เป็น 0 · `GET /queue` มี `paused`, `current`, `waiting`, `errors` · `pause` เก็บสาเหตุ (`queue.state().pausedReason`) / `resume` ล้างสาเหตุ · ไม่ล็อกอิน → 401
- [ ] **Step 2:** `S-TEST test/admin-glossary.test.ts` → FAIL · **Step 3: เขียน** · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): admin glossary and queue control endpoints`

### Task 15: หลังบ้าน — Dashboard, ตั้งค่า, สำรองข้อมูล

**Files:** สร้าง `server/src/http/admin/{dashboard,settings}.ts`, `server/src/backup.ts` · เทสต์ `server/test/admin-dashboard.test.ts`
**Interfaces:** Produces: `GET /dashboard` → `{ onboarding:{apiKey:boolean, contact:boolean, firstNovel:boolean}, counts:{publishedNovels,totalNovels,publishedChapters,queued,errors,readyToPublish}, queue: QueueState, views:{day:string,count:number}[] (14 วัน เติมศูนย์ เก่า→ใหม่ ตามวัน UTC+7), progress:{novelId,title,translated,total,published}[], usage:{today: UsageRow[], last30: UsageRow[]}, estimate:{today:number|null,last30:number|null}, api:{hasKey:boolean, lastOk:{at:string,ok:boolean,message:string}|null} }` · `GET /settings` → `SiteSettings & {apiKeySet, importTokenSet, importUrl}` · `PUT /settings` · `POST /settings/test-api` → `{ok:boolean, message:string}` (HTTP 200 เสมอ) · `GET /backup` · `createBackupFile(db: Db, dir: string, now: Date): Promise<{path:string; filename:string}>` (ชื่อ `novel-99-YYYYMMDD-HHMM.db` ตามเวลา UTC+7)

- [ ] **Step 1: เทสต์** — Dashboard จากข้อมูลตัวอย่าง: ตัวเลขนับถูก, `views` 14 รายการเติมศูนย์และเรียงเก่า→ใหม่, `onboarding.apiKey` เป็นจริงเมื่อมี API key **หรือ** `IMPORT_TOKEN`, `contact` เป็นจริงเมื่อ `contactText` ไม่ว่าง, ประมาณค่าใช้จ่ายเป็น `null` เมื่อไม่ได้กรอกราคา และ = (1,000,000 in × 3 + 1,000,000 out × 15)/1e6 = 18 เมื่อ `prices` เป็น `{in:3,out:15}` · `GET /settings`: ข้อความ JSON ทั้งก้อน **ไม่มี** รหัสผ่าน, API key, `IMPORT_TOKEN` · `PUT /settings` ตรวจค่า (accent ผิด → 400) · `test-api` สำเร็จ → `{ok:true}` และ `lastOk` ถูกเก็บ; `AiError` → `{ok:false, message ไทย}`; ไม่มี key → `{ok:false}` · `GET /backup` → 200 + `Content-Disposition` ชื่อตรง `/^novel-99-\d{8}-\d{4}\.db$/`; บันทึก body เป็นไฟล์แล้ว `openDb` อ่าน `SELECT COUNT(*) FROM novels` ได้เท่าของจริง; ไฟล์ชั่วคราวถูกลบหลังส่ง · ทุกเส้นทางต้องล็อกอิน
- [ ] **Step 2:** `S-TEST test/admin-dashboard.test.ts` → FAIL · **Step 3: เขียน** (สำรองด้วย `db.backupTo` ไปที่ `os.tmpdir()` แล้ว `res.download` และลบไฟล์ใน callback) · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): admin dashboard, settings and backup endpoints`

### Task 16: API สาธารณะ

**Files:** สร้าง `server/src/http/public.ts` · เทสต์ `server/test/public.test.ts`
**Interfaces:** Consumes: `VISIBLE_SQL`, `Views`, `isAdminRequest`. Produces (camelCase, spec 4.2): `/site` → `{siteName, tagline, aboutText, contactText, accent, indexable, isAdmin}` · `/novels` → การ์ด `{id,title,titleTh,author,synopsisShort,tags,status,featured,hasCover,coverV,chapterCount,latestNumber,updatedAt,published}` (`synopsisShort` = `truncate(synopsis, 280)`; `chapterCount`/`latestNumber` นับเฉพาะตอนที่มองเห็น; `updatedAt` = `published_at` ของตอนที่มองเห็นล่าสุด ไม่มีใช้ `novel.updated_at`) · `/novels/:id` → การ์ด + `{synopsis, sourceUrl, licenseNote, chapters:[{number,title,titleTh,publishedAt,published}]}` · `/novels/:id/chapters/:number` → `{novel:{id,title,titleTh}, chapter:{number,title,titleTh,text,published}, prev:number|null, next:number|null}` · เฉพาะ GET (อย่างอื่น 405) · จำกัดอัตรา 120/นาที/IP · คำตอบปกติ `Cache-Control: no-cache` (ETag ของ Express) · ผู้ดูแล: `private, no-store`

- [ ] **Step 1: เทสต์** — เงื่อนไขมองเห็น: เรื่องซ่อน → `/novels` ไม่มี, `/novels/:id` และตอนของมัน 404; ตอนที่ซ่อนหรือ `translation` ว่าง → 404; `prev/next` ข้ามตอนที่ซ่อน · การ์ด: `chapterCount`/`latestNumber`/`updatedAt` คำนวณจากตอนที่มองเห็นเท่านั้น; `synopsisShort` ยาว ≤ 281 · โหมดผู้ดูแล (cookie): เห็นเรื่อง/ตอนที่ยังไม่เผยแพร่ที่มีคำแปลพร้อม `published:false`, `Cache-Control: private, no-store`, ตอนที่ไม่มีคำแปลยัง 404 · ยอดอ่าน: เรียกตอนเดียวกัน IP+UA เดิมสองครั้ง → `views` ของเรื่องวันนี้ +1, UA ต่าง +1 อีก, ผู้ดูแลไม่นับ, คำตอบ 404 ไม่นับ · ตัวจำกัดอัตรา: คำขอที่ 121 ใน 1 นาที → 429 ข้อความไทย + `Retry-After` · `POST /api/public/novels` → 405 · `/site` มี `isAdmin` ตามสถานะ cookie
- [ ] **Step 2:** `S-TEST test/public.test.ts` → FAIL · **Step 3: เขียน router** (SQL ทุกคำสั่งใช้ `VISIBLE_SQL` ยกเว้นโหมดผู้ดูแลที่ใช้เงื่อนไข `translation <> ''` อย่างเดียว) และเพิ่มบรรทัด mount ใน `createApp` · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): public read API with admin preview and view counting`

### Task 17: ช่องทางนำเข้า `/api/import`

**Files:** สร้าง `server/src/http/import.ts` · เทสต์ `server/test/import.test.ts`
**Interfaces:** Consumes: `applyTranslation`, `buildContext`, ตัวจำกัด (Task 10). Produces: `createImportRouter(deps: AppDeps): Router` — mount เฉพาะเมื่อ `config.importToken` ไม่ใช่ null (ไม่งั้นตกไป 404 JSON ของ `/api` เหมือนไม่มีอยู่) · `PUT /novels/:novelId/chapters/:number/translation` body `{translation, titleTh?, recap?, terms?: {source,thai,note?}[], overwrite?: boolean}` → 200 `{ok:true, chapter:{number, status:"done", published:false}}` · `GET /novels/:novelId/chapters?status=` → `[{number,title,status,hasTranslation,chars,published}]` · `GET /novels/:novelId/chapters/:number` → `{novel:{id,title,titleTh,mode,styleNote}, chapter:{number,title,sourceText,status,hasTranslation}, glossary:[{source,thai,note}], recaps:[{number,recap}], systemPrompt}`
ลำดับด่าน: จำกัด 60/นาที/IP → ตรวจ Bearer (ผิด/ขาด → `recordFailure` แล้ว 401; ตัวจำกัดความผิดพลาด 10/15 นาที → 429) → `express.json({limit:"2mb"})` (ต้องเป็น `application/json`) → 404 ตอนไม่พบ → 400 ตรวจฟิลด์ → 409 ตามสถานะ

- [ ] **Step 1: เทสต์** (spec 11 แถว "ช่องทางนำเข้า") — ปิดอยู่: ไม่ตั้ง token หรือ token 23 ตัว → ทุกเส้นทาง 404 body เดียวกับ `/api/ไม่มีอยู่` · ไม่มี/ผิด `Authorization` → 401; token ใน query string ไม่ถูกรับ; cookie ผู้ดูแลอย่างเดียวไม่พอ; ผิด 10 ครั้ง → ครั้งที่ 11 ได้ 429 + `Retry-After`; ถูกต้องแต่เกิน 60 คำขอ/นาที → 429 · `PUT` สำเร็จกับตอน `draft`: `translation` ถูกบันทึก (ผ่าน `normalizeText`), `status "done"`, `translated_at` ตั้ง, `error ""`, `queue_seq NULL`, `published` เท่าเดิม (0), ตาราง `usage` ว่าง, `ai.calls.length === 0`, `titleTh` ไม่ทับค่าที่มี (ใส่เฉพาะที่ว่าง), `recap` บันทึก และ **ไม่ส่ง `recap` → `recap` เป็น NULL**, `terms` ลงอภิธานเป็น `auto=1` ไม่ทับคำเดิม · ตอน `queued` ออกจากคิว · ตอนที่ `auto_publish=1` ยัง **ไม่เผยแพร่** · 409: `translating` → `code "translating"`, `published` → `"published"`, มีคำแปลแล้วไม่ส่ง `overwrite` → `"has_translation"` (ส่ง `overwrite:true` แล้วผ่าน แต่ไม่ช่วยกรณี `translating`/`published`) · 404: ไม่พบเรื่อง/ตอน · 400: `translation` ว่าง/ขาด, `titleTh` 301 ตัว, `recap` 2001, `terms` 31 รายการ, `source` 201 ตัว, ชนิดผิด; `translation` 400,001 ตัวอักษร → 400; 415: `Content-Type` ไม่ใช่ JSON · **(Review Focus 3)** body เกิน 2MB → 413 JSON ไทย · log หนึ่งบรรทัดต่อการนำเข้ามีเลขเรื่อง/ตอน/ความยาว แต่ไม่มีเนื้อหาและไม่มี token · ไม่มีหัว `Access-Control-Allow-*` ในคำตอบใดๆ
- [ ] **Step 2: เทสต์ส่วนเสริม GET** — list กรอง `?status=draft` ได้เฉพาะ draft, สถานะนอกรายการ → 400 · brief: `systemPrompt` **เท่ากับ** `buildContext(db, id).system` ที่คิวใช้, มีอภิธานและเรื่องย่อไม่เกิน 5 ตอน, ไม่มีข้อมูลหลังบ้านอื่น (ไม่มี `published` ของเรื่อง, ไม่มี counts)
- [ ] **Step 3:** `S-TEST test/import.test.ts` → FAIL · **Step 4: เขียน router** (ส่วน GET แยกเป็นฟังก์ชัน `mountReadRoutes` ตัดออกได้) เทียบ Bearer ด้วย sha256 + `timingSafeEqual` · **Step 5:** รัน → PASS
- [ ] **Step 6: Commit** `feat(server): token-protected translation import channel`

### Task 18: shell + SEO — `http/shell.ts`

**Files:** สร้าง `server/src/http/shell.ts` · เทสต์ `server/test/shell.test.ts` (สร้าง `web/dist` ปลอมในโฟลเดอร์ชั่วคราว: `index.html` มี `<html lang="th"><head><title>Novel 99</title></head>`, `assets/a.js`, `sw.js` ที่มี `__BUILD_ID__`)
**Interfaces:** Produces: `renderShell(template: string, meta: { title: string; description: string; canonical: string; image?: string; noindex: boolean; accent: AccentId; siteName: string }): string` · `createShellRouter(deps: AppDeps): Router` ครอบ `/`, `/novel/:id`, `/novel/:id/:number`, `/about`, `/contact`, `/admin/*splat`, `/sitemap.xml`, `/robots.txt`, `/sw.js`, ไฟล์ใน `config.webDist`, 404 shell

- [ ] **Step 1: เทสต์** — meta ถูก escape: ชื่อเรื่อง `<script>"x"</script>` ได้ `&lt;script&gt;&quot;x&quot;…` ใน `<title>`, `og:title`, `description` และไม่มี `<script>x` ดิบใน `<head>` · มี `og:title/description/type/url/image/site_name`, `twitter:card`, `<link rel="canonical">` ขึ้นต้นด้วย `PUBLIC_URL` (ไม่ตั้ง → ใช้หัว `Host`) · `og:image` เป็น URL ปกสมบูรณ์เมื่อมีปก · เรื่อง/ตอนที่ซ่อนหรือไม่มี → shell สถานะ 404 (ผู้ดูแล → 200) · `/admin/x` → 200 + `noindex` · `/ไม่มีอยู่` → 404 shell · `/api/ไม่มีอยู่` → 404 JSON ไม่ใช่ shell · `accent` ≠ default → `<html lang="th" data-accent="teal">` · `indexable=false` → `robots.txt` มี `Disallow: /`, shell มี `<meta name="robots" content="noindex">`, `sitemap.xml` 404; เปิดอยู่ → `robots.txt` มี `Disallow: /admin`, `Disallow: /api/` และ `Sitemap:` · `sitemap.xml` มีหน้าแรก `/about` `/contact` + เรื่อง/ตอนที่เผยแพร่เท่านั้น พร้อม `lastmod` และ URL สมบูรณ์; ผลถูกเก็บ 10 นาที (เพิ่มตอนหลังเรียกครั้งแรกแล้วยังไม่เห็น → เลื่อนเวลาจำลอง 11 นาที → เห็น) · หัวแคช: `/assets/a.js` `public, max-age=31536000, immutable`; `index.html` และ `sw.js` `no-cache` · `/sw.js` มี `__BUILD_ID__` ถูกแทนด้วยแฮชของ `index.html` (ชื่อ cache ผูกเวอร์ชัน build) · ไม่มี `web/dist` → shell ตอบ 503 ข้อความไทยบอกให้ build
- [ ] **Step 2:** `S-TEST test/shell.test.ts` → FAIL · **Step 3: เขียน** (อ่าน template ตอนสร้าง router; ใช้ `escapeHtml` ทุกค่าที่ฝัง; `description` ใช้ `truncate(synopsis, 160)`; sitemap ไม่เกิน 50,000 URL) และ mount ท้ายสุดของ `createApp` · **Step 4:** รัน → PASS
- [ ] **Step 5: Commit** `feat(server): SPA shell with escaped meta tags, sitemap and robots`

### Task 19: `index.ts` เริ่มระบบ + `seed.ts`

**Files:** สร้าง `server/src/{index,seed}.ts` · เทสต์ `server/test/bootstrap.test.ts`
**Interfaces:** Produces: `index.ts` — `import "./env.js"` เป็นบรรทัดแรก → `loadConfig` (ConfigError → พิมพ์ข้อความ exit 1) → พิมพ์ warnings → `renameLegacyDb` → `openDb` → `migrate` → `createSettings`/`createAi(config.anthropicApiKey)`/`createQueue`/`createViews` → `queue.recoverOnStart()` → `createApp` → `listen` แล้ว log `listening on http://HOST:PORT` → `queue.start()` · SIGTERM/SIGINT: ปิด server, `await queue.stop()`, `db.close()`, exit 0 · `seed.ts` — `seedDemo(db: Db, now: string): { created: boolean }` และ main สำหรับ `npm run seed:demo` (ใช้ `DB_PATH` เดียวกับระบบ)
เนื้อหาตัวอย่าง: นิยายสมมติที่เขียนเองหนึ่งเรื่อง สามตอนมีคำแปลไทยครบ `published=1` ตอนหนึ่งมีบรรทัด `***` คั่นฉาก และชื่อตอนหนึ่งยาวเกิน 60 ตัวอักษร (ไว้ทดสอบเลย์เอาต์) ห้ามใช้ข้อความของงานจริง

- [ ] **Step 1: เทสต์** — รัน `tsx src/index.ts` เป็น child process (`HOST=127.0.0.1 PORT=0 DB_PATH=<tmp>`) อ่าน log หา URL แล้ว `GET /healthz` → `ok` · `HOST=0.0.0.0` ไม่มี `ADMIN_PASSWORD` → exit code 1 ข้อความมี `ADMIN_PASSWORD` · SIGTERM → exit 0 ภายใน 5 วินาที · เริ่มบน DB ที่ยังมี `novel-teller.db` → ถูกเปลี่ยนชื่อและย้ายข้อมูล · `seedDemo` สร้าง 1 เรื่อง 3 ตอน (`done`+`published`) และเรียกซ้ำได้ `{created:false}` ไม่ซ้ำ
- [ ] **Step 2:** `S-TEST test/bootstrap.test.ts` → FAIL · **Step 3: เขียน** · **Step 4:** รัน → PASS · `npm run typecheck` · `npm run build -w server` สำเร็จ (ผล `server/dist/index.js`)
- [ ] **Step 5: Commit** `feat(server): bootstrap, graceful shutdown and demo seed`

---

## ช่วงที่ 3 — หน้าบ้านสาธารณะ (Task 20–27)

Task 20–22 เป็นโมดูลและเครื่องมือ จบด้วยเทสต์ผ่านและ `npm run typecheck -w web` (ยังไม่มี `main.tsx` จึง build ไม่ได้จนถึง Task 23) · ตั้งแต่ Task 23 ทุกงานจบด้วย `npm run typecheck -w web && npm run build -w web` ผ่าน และ "ตรวจตาด้วยภาพ": `npm run build -w web && node e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม>` แล้วเปิดไฟล์ภาพด้วย Read เทียบกับ mockup ที่อนุมัติ (`…-assets/*.jpg`) ผลต้องตรงเลย์เอาต์ ไม่มีแถบเลื่อนแนวนอน ฟอนต์ไทยแสดงถูก

### Task 20: โครงหน้าเว็บ — design tokens, ธีม, ตัวช่วยตรวจภาพ

**Files:** แก้ `web/vite.config.ts`, `web/index.html` · สร้าง `web/src/styles/{tokens,base}.css`, `web/public/theme-init.js`, `web/src/lib/theme.ts`, `e2e/server.ts`, `e2e/shot.mjs` · เทสต์ `web/src/styles/tokens.test.ts`, `web/src/theme-init.test.ts`
**Interfaces:** Produces: `theme.ts` — `THEMES = ["midnight","paper","sepia","black"] as const`, `ThemeId`, `THEME_LABELS`, `getTheme(): ThemeId`, `setTheme(t: ThemeId): void` (เก็บ `n99.theme`, ตั้ง `<html data-theme>`) · CSS variables `--bg --surface --line --text --muted --accent --accent-2 --accent-ink` · `e2e/server.ts` — บูต `createApp` จริงด้วย DB ชั่วคราว + `seedDemo` + AI ปลอม (`createFakeAi`) บน `127.0.0.1:0` แล้วพิมพ์ `READY <url>` · `e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม> [--admin] [--out ไฟล์]` — รัน server ข้างบน, (ถ้า `--admin`) ล็อกอินก่อน, ตั้ง `n99.theme`, เปิดหน้าด้วย `playwright-core` + `/opt/pw-browsers/chromium` (`--no-sandbox`), รอ `document.fonts.ready`, บันทึก JPEG ที่ `e2e/out/` แล้วพิมพ์ path

ค่าสีธีม (ตาราง spec 6.5) และชุด accent เขียนใน `tokens.css` ด้วยตัวแปรช่วย `--a-dark --a2-dark --a-light --a2-light` ที่ตั้งโดย `html[data-accent=…]` ส่วนบล็อกธีมใช้ `var(--a-dark, <ค่าของธีม>)` จึงได้ "default = สีของแต่ละธีม" โดยไม่ต้องเขียนซ้ำ:

| accent | dark (accent / accent-2) | light (accent / accent-2) |
|---|---|---|
| violet | `#8b7bff` / `#ff6f91` | `#6d28d9` / `#be185d` |
| pink | `#ff7aa8` / `#ffb36b` | `#be185d` / `#9a3412` |
| teal | `#2dd4bf` / `#60a5fa` | `#0d6e66` / `#1d4ed8` |
| amber | `#fbbf24` / `#fb7185` | `#92400e` / `#9f1239` |
| blue | `#60a5fa` / `#a78bfa` | `#1d4ed8` / `#6d28d9` |

`--accent-ink`: Midnight/Black `#0b0b14`, Paper/Sepia `#fff7ed` · ธีมมืด = Midnight, Black · ธีมสว่าง = Paper, Sepia

- [ ] **Step 1: เทสต์ `tokens.test.ts`** — อ่าน `tokens.css` แยกบล็อก แล้วสำหรับทุกธีม × ทุก accent (รวม default) คำนวณความต่างสี WCAG: `text`, `muted`, `accent`, `accent-2` เทียบ `bg` และ `surface` ≥ 4.5 และ `accent-ink` เทียบ `accent` ≥ 4.5 · ค่าตรงตาราง spec 6.5 (เช่น `paper.bg === "#f4efe6"`, `sepia.muted === "#6e604a"`, `black.bg === "#000000"`) กันแก้พลาด · ธีมเริ่มต้นเมื่อไม่มี `data-theme` คือ Midnight
- [ ] **Step 2: เทสต์ `theme-init.test.ts`** — รัน `theme-init.js` ใน `vm` ด้วย `document`/`localStorage` ปลอม: ค่า `n99.theme` ที่ถูกต้องถูกตั้งเป็น `data-theme` · ค่าไม่ถูกต้องถูกเมิน · `localStorage` ที่ throw ไม่ทำให้สคริปต์ throw
- [ ] **Step 3:** `W-TEST src/styles/tokens.test.ts` และ `W-TEST src/theme-init.test.ts` → FAIL
- [ ] **Step 4: เขียน** `tokens.css`, `base.css` (reset, Sarabun เนื้อหา/Prompt หัวข้อ, `:focus-visible` ชัดเจน, `prefers-reduced-motion`), `theme-init.js` (สคริปต์คลาสสิกไฟล์เล็ก ห่อ try/catch), `theme.ts`, `index.html` (`<html lang="th">`, `<script src="/theme-init.js"></script>` ก่อน CSS, ลิงก์ manifest/ไอคอน — Vite เตือนเรื่องสคริปต์ที่ไม่ใช่ module ถือว่าปกติ), `vite.config.ts` (proxy `/api` และ `/covers` ไป `127.0.0.1:8787`, `build.assetsInlineLimit: 0` เพื่อไม่ให้ฟอนต์กลายเป็น `data:` ที่ CSP `font-src 'self'` ปิดกั้น) · เขียน `e2e/server.ts` และ `e2e/shot.mjs` ตาม Interfaces
- [ ] **Step 5:** เทสต์ทั้งสองไฟล์ → PASS · `npm run typecheck -w web` · ตรวจ `e2e/server.ts`: รัน `node --import tsx e2e/server.ts` ต้องพิมพ์ `READY http://127.0.0.1:<พอร์ต>` แล้ว `curl -s <url>/healthz` ได้ `ok` และ `curl -s <url>/api/public/novels` ได้ JSON ที่มีเรื่องตัวอย่าง 1 เรื่อง (ปิดโปรเซสหลังตรวจ; หน้าเว็บยังไม่มีให้ดู จึงตรวจภาพจริงเริ่ม Task 23)
- [ ] **Step 6: Commit** `feat(web): design tokens, themes with contrast tests and screenshot tooling`

### Task 21: ที่เก็บในเครื่อง, API client, ชนิดข้อมูล

**Files:** สร้าง `web/src/lib/{types,api,useFetch,storage,progress,reader-prefs,format}.ts` · เทสต์ `web/src/lib/{storage,progress,reader-prefs,format}.test.ts`
**Interfaces:** Produces:
```ts
// storage.ts — ทุกฟังก์ชันห่อ try/catch; ใช้ได้เมื่อ localStorage ถูกปิด
export const KEYS = { theme: "n99.theme", reader: "n99.reader", progress: "n99.progress", history: "n99.history" } as const
export function readJson<T>(key: string, fallback: T): T; export function writeJson(key: string, value: unknown): boolean
// progress.ts
export interface Progress { number: number; pct: number; next: number | null; at: number }
export function getProgress(novelId: number): Progress | null
export function saveProgress(novelId: number, p: { number: number; pct: number; next: number | null }, now?: number): void   // อัปเดต history ด้วย
export function getHistory(): number[]                                       // novelId ล่าสุดก่อน สูงสุด 10
export function resumeTarget(p: Progress): { number: number; fromPct: number }   // pct ≥ 95 และมี next → {next, 0}; ไม่งั้นตอนเดิมที่ pct เดิม (pct ≥ 95 ไม่มี next → {number, 0})
// reader-prefs.ts
export interface ReaderPrefs { fontSize: number; font: "sarabun" | "serif"; rate: number }      // เริ่มต้น 18 / "sarabun" / 1
export function clampFontSize(n: number): number                             // 16–26 ขั้นละ 2 (ปัดเป็นเลขคู่ใกล้สุดในช่วง)
export function getReaderPrefs(): ReaderPrefs; export function saveReaderPrefs(p: ReaderPrefs): void
// format.ts
export function isNew(updatedAt: string, now?: number): boolean              // 'YYYY-MM-DD HH:MM:SS' เป็น UTC; ภายใน 3 วัน
export function resumePercent(number: number, latestNumber: number): number  // round(number/latest*100) จำกัด 0–100
export function thaiDate(sql: string): string
// api.ts
export class ApiError extends Error { status: number; code?: string; data?: unknown }
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>   // JSON เข้า/ออก, credentials same-origin, ไม่ใช่ 2xx → ApiError(message = body.error), เครือข่ายล่ม → ApiError(0,"เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")
export const publicApi: { site(): Promise<SiteDto>; novels(): Promise<NovelCardDto[]>; novel(id: number): Promise<NovelDetailDto>; chapter(id: number, n: number): Promise<ChapterPageDto> }
// useFetch.ts
export function useFetch<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): { data: T | null; error: ApiError | null; loading: boolean; reload(): void }
// types.ts — SiteDto, NovelCardDto, NovelDetailDto, ChapterPageDto เหมือนที่ Task 16 กำหนด
```

- [ ] **Step 1: เทสต์** — `storage`: `localStorage` ที่ throw → `readJson` คืน fallback, `writeJson` คืน `false`, JSON เสียคืน fallback · `progress`: `saveProgress` เก็บ `{number,pct,next,at}` ต่อเรื่อง; `getHistory` ล่าสุดก่อน, ใส่ 12 เรื่องเหลือ 10, เรื่องเดิมที่อ่านซ้ำเลื่อนขึ้นหน้าสุดไม่ซ้ำ; `resumeTarget`: `pct 94 → {number, fromPct:94}`, `pct 95 + next 5 → {number:5, fromPct:0}`, `pct 100 ไม่มี next → {number, fromPct:0}` · `reader-prefs`: `clampFontSize(15)=16`, `17=18`, `30=26`; ค่าเริ่มต้น `18/"sarabun"/1`; ข้อมูลเสียกลับไปค่าเริ่มต้น · `format`: `isNew("2026-10-20 00:00:00", Date.UTC(2026,9,22))` จริง และ `"2026-10-18 …"` เท็จ; `resumePercent(5,20)=25`, `(30,20)=100`, `(1,0)=0`
- [ ] **Step 2:** `W-TEST` ทั้งสี่ไฟล์ → FAIL · **Step 3: เขียนโมดูล** · **Step 4:** รัน → PASS · `npm run typecheck -w web`
- [ ] **Step 5: Commit** `feat(web): safe local storage, reading progress, api client and shared types`

### Task 22: `parseChapters` และประมาณค่าใช้จ่าย

**Files:** สร้าง `web/src/lib/{parse-chapters,cost}.ts` · เทสต์ `web/src/lib/{parse-chapters,cost}.test.ts`
**Interfaces:** Produces:
```ts
export interface ParsedRow { key: string; kind: "chapter" | "preamble" | "single"; number: number | null; title: string; text: string; words: number; checked: boolean;
  issues: ("duplicate" | "bad_number" | "empty" | "too_long")[] }
export const MAX_CHAPTERS = 100; export const MAX_CHARS = 200_000
export function parseChapters(text: string, existing: ReadonlySet<number>): ParsedRow[]
export function forceSingle(text: string, existing: ReadonlySet<number>): ParsedRow[]        // ปุ่ม "ไม่ต้องแยกตอน"
export function revalidate(rows: ParsedRow[], existing: ReadonlySet<number>): ParsedRow[]     // หลังแก้เลข/ชื่อ: คำนวณ issues ใหม่ และติ๊กออกแถวที่มี issue ใหม่
export function validateSelection(rows: ParsedRow[]): { count: number; error: string | null }  // ข้อความไทย: เกิน 100 ตอน / ตอนยาวเกิน / เลขซ้ำ / ยังไม่มีเลข / ข้อความรวมเกิน 7.5MB (เผื่อไม่ให้ชน body 8MB ของเซิร์ฟเวอร์)
export function estimateTokens(chars: number): { input: number; output: number }
export function estimateCost(chars: number[], price: { in: number; out: number } | undefined): { input: number; output: number; cost: number | null }
```

- [ ] **Step 1: เทสต์ `parseChapters`** (spec 7.5) — หัวข้อที่รู้จัก: `Chapter 1: The Start`, `Chapter 2 - Next`, `CHAPTER 3 – X`, `Ch. 4 | Y`, `Ch 5. Z`, `Episode 6: A`, `Ep. 7 — B`, `chapter 8` (ไม่มีชื่อ) · ไม่ใช่หัวข้อ: `Chapter 3 was the hardest day.` (ไม่มีตัวคั่น ตัวแรกเป็นตัวพิมพ์เล็ก), บรรทัดที่ขึ้นต้น `Chapter 9:` แต่ยาวเกิน 120 ตัวอักษร, `Chapters of life` · ไม่มีตัวคั่นแต่เป็นหัวข้อ: `Ch 5 Zero`, `Chapter 7 3rd attempt`, `Chapter 7 第一章` · **(Review Focus 1)** ข้อความมี BOM + CRLF + NBSP (`Chapter 1: Title`) ถูกจัดการเหมือนข้อความปกติ · `Chapter 12.5: Interlude` → แถว `number:null`, `issues` มี `bad_number`, `checked:false`, ชื่อ "Interlude" · `Chapter 12. The Return` → เลข 12 ชื่อ "The Return" · ข้อความก่อนหัวข้อแรก: สั้นกว่า 500 ตัวอักษร → แถว `preamble` ไม่ติ๊ก; ตั้งแต่ 500 ขึ้นไป → ติ๊ก และ `number` = (เลขสูงสุดของที่มีอยู่และที่วางมา) + 1 · ไม่พบหัวข้อเลย → แถว `single` ติ๊ก `number` = สูงสุดที่มี + 1 (ไม่มีเลย = 1); `forceSingle` ให้ผลแบบเดียวกันแม้มีหัวข้อ · เลขซ้ำกับที่มีอยู่ → `issues` มี `duplicate` และไม่ติ๊ก; ซ้ำกันเองในที่วาง → ตัวหลังถูกทำเครื่องหมาย · หัวข้อไม่มีเนื้อหา → `empty` ไม่ติ๊ก · เนื้อหาเกิน 200,000 ตัวอักษร → `too_long` ไม่ติ๊ก · `words` นับตามช่องว่าง · `validateSelection`: ติ๊ก 101 ตอน → error "เลือกได้ไม่เกิน 100 ตอนต่อครั้ง"; **(Review Focus 3)** ติ๊กหลายตอนที่ข้อความรวม 7,600,000 ตัวอักษร (แต่ละตอนไม่เกิน 200,000) → error ที่มี "7.5MB"; ไม่มีเลข/เลขซ้ำที่ติ๊กอยู่ → error ไทยตามสาเหตุ; ไม่มีปัญหา → `error: null` และ `count` = จำนวนที่ติ๊ก
- [ ] **Step 2: เทสต์ `cost`** — `estimateTokens(4000) = {input:2500, output:1800}` · `estimateCost([4000,4000], {in:3,out:15})` = `{input:5000, output:3600, cost:0.069}` · ไม่ส่งราคา → `cost:null`
- [ ] **Step 3:** `W-TEST src/lib/parse-chapters.test.ts` และ `W-TEST src/lib/cost.test.ts` → FAIL · **Step 4: เขียน** (ฟังก์ชันบริสุทธิ์ ไม่แตะ DOM; ทำความสะอาดข้อความด้วยตรรกะเดียวกับ `normalizeText` ของเซิร์ฟเวอร์ในไฟล์นี้เอง เพราะ web ไม่ import จาก server) · **Step 5:** รัน → PASS
- [ ] **Step 6: Commit** `feat(web): chapter heading parser and cost estimator`

### Task 23: โครงหน้าสาธารณะและคอมโพเนนต์กลาง

**Files:** สร้าง `web/src/{main.tsx,App.tsx}`, `web/src/lib/{SiteContext.tsx,useDocumentTitle.ts}`, `web/src/components/{Layout,Header,Footer,ThemeMenu,Cover,NovelCard,Chip,Switch,Skeleton,ErrorState,EmptyState,DraftBadge}.tsx`, `web/src/styles/public.css` · หน้าแอปเต็มอื่นเป็นตัวแทนชั่วคราวจนกว่างานถัดไปจะเสร็จ
**Interfaces:** Produces: `<Layout/>` (Header + `<Outlet/>` + Footer, เลื่อนขึ้นบนเมื่อเปลี่ยนเส้นทาง) · `useSite(): { site: SiteDto | null; loading: boolean; error: ApiError | null }` · `<Cover novel={{id,title,hasCover,coverV}} />` (มีปก → `<img src="/covers/{id}?v={coverV}" loading="lazy">`; ไม่มี → ปกตัวอย่างสร้างจากแฮชของชื่อ: ไล่สีที่คงที่ต่อชื่อ + ชื่อเรื่องด้วย CSS/SVG) · `<NovelCard novel badge? chip? />` · `<ErrorState error onRetry />` · `<EmptyState title hint? action? />` · `<Skeleton variant="grid"|"lines" />` · routes: `/`, `/novel/:id`, `/novel/:id/:number` (ไม่อยู่ใน `<Layout/>`), `/about`, `/contact`, `/admin/*` (lazy `import("./admin/AdminApp")`), `*` → NotFound · `main.tsx` import ฟอนต์ `@fontsource/prompt/{thai,latin}-{500,600}.css`, `@fontsource/sarabun/{thai,latin}-{400,600}.css`, `@fontsource/noto-serif-thai/{thai,latin}-{400,600}.css` และ `BrowserRouter`

- [ ] **Step 1: เขียนโค้ด** ตาม spec 6.1 (Header ติดบน พื้นเบลอ โลโก้ "99" ในสี่เหลี่ยมไล่สี `--accent`→`--accent-2` เมนู หน้าแรก/เกี่ยวกับ/ติดต่อ, ช่องค้นหาไป `/?q=`, ปุ่มธีม, ลิงก์หลังบ้านเมื่อ `site.isAdmin`) และ 6.5 (CSS ธรรมดาตาม token; พอร์ตคลาส `.top .card .chips .btn` จาก `design-reference/build.mjs`; skeleton/error/empty ครบ) · ตั้ง `<html data-accent>` จาก `site.accent` ถ้าต่างจากที่เซิร์ฟเวอร์ใส่มา (โหมด dev ของ Vite)
- [ ] **Step 2: ตรวจ** `npm run typecheck -w web && npm run build -w web` ผ่าน · ตรวจตา: `node e2e/shot.mjs /about 1280 midnight` และ `… 390 paper` — Header/Footer/ธีมถูกต้อง ไม่มีแถบเลื่อนแนวนอน
- [ ] **Step 3: Commit** `feat(web): public app shell, header/footer, cover placeholder and state components`

### Task 24: หน้าแรก

**Files:** สร้าง `web/src/pages/Home.tsx` และคอมโพเนนต์ย่อยที่ต้องใช้ (`Hero`, `ContinueRow`, `NovelRow`, `NovelGrid`) · แก้ `public.css`
**Interfaces:** Consumes: `publicApi.novels()`, `getHistory`/`getProgress`/`resumeTarget`/`resumePercent`/`isNew` (Task 21)

- [ ] **Step 1: เขียนหน้าตาม spec 6.1 ครบ 6 ส่วน** · ค่าที่แผนกำหนดเพิ่ม: Hero ใช้ `featured` ถ้าไม่มีใช้เรื่องที่ `updatedAt` ล่าสุดที่มีปก · "อัปเดตล่าสุด" 12 เรื่อง ป้าย "ใหม่" เมื่อ `isNew` ชิป "ตอน {latestNumber}" · แถบความคืบหน้าใน "อ่านต่อ" = `resumePercent(progress.number, latestNumber)`% · `/?q=` ค้นชื่อ/ชื่อไทย/ผู้แต่ง/แท็ก (ไม่สนตัวพิมพ์) แล้วซ่อน Hero กับ "อ่านต่อ" · ตารางปก 6/4/3 คอลัมน์ (เดสก์ท็อป/แท็บเล็ต/มือถือ) ทีละ 24 + "แสดงเพิ่ม" · เรื่อง `published:false` มี `DraftBadge` · ไม่มีเรื่อง → `EmptyState` (ผู้ดูแลเห็นลิงก์ `/admin`)
- [ ] **Step 2: ตรวจ** typecheck + build · seed ข้อมูลตัวอย่างผ่าน `e2e/server.ts` · ตรวจตา `/` ที่ 1280 midnight เทียบ `home-midnight.jpg`, 1280 paper เทียบ `home-paper.jpg`, 390 midnight เทียบ `phones.jpg`; ตรวจ `/?q=zzz` (ไม่พบ → สถานะว่างของผลค้นหา)
- [ ] **Step 3: Commit** `feat(web): home page with hero, continue reading, updates and filterable library`

### Task 25: หน้าเรื่อง

**Files:** สร้าง `web/src/pages/Novel.tsx` · แก้ `public.css`

- [ ] **Step 1: เขียนหน้าตาม spec 6.2** · ค่าที่แผนกำหนดเพิ่ม: ปุ่ม "เริ่มอ่าน"/"อ่านต่อ ตอนที่ N" ใช้ `resumeTarget` · เรื่องย่อพับที่ 5 บรรทัด (ปุ่ม "อ่านเพิ่ม") แสดงเป็นข้อความล้วน · ลิงก์ต้นฉบับเฉพาะ http/https ด้วย `target="_blank" rel="noopener noreferrer nofollow"` · รายการตอน 50/หน้า สลับเรียงได้ ช่อง "ไปตอนที่ …" พาไปหน้าที่มีตอนนั้นและไฮไลต์ ตอนที่อ่านล่าสุดไฮไลต์ · 404 → `NotFound`, ผิดพลาด → `ErrorState` ลองใหม่ · `useDocumentTitle`
- [ ] **Step 2: ตรวจ** typecheck + build · ตรวจตา `/novel/1` ที่ 1280 midnight และ 390 paper (กล่องเครดิต, รายการตอน, ปุ่มบนมือถือไม่ล้นจอ)
- [ ] **Step 3: Commit** `feat(web): novel detail page with credits box and paged chapter list`

### Task 26: หน้าอ่านและฟังเสียง

**Files:** `git mv web/src/useSpeech.ts web/src/lib/useSpeech.ts` (เขียนใหม่) · สร้าง `web/src/pages/Reader.tsx`, `web/src/components/{ReaderBar,ReaderSettings}.tsx`, `web/src/lib/{text,speech}.ts` · เทสต์ `web/src/lib/{text,speech}.test.ts`
**Interfaces:** Produces:
```ts
// text.ts
export function splitParagraphs(text: string): string[]       // แยกที่บรรทัดว่าง ตัดช่องว่าง ทิ้งย่อหน้าว่าง
export function isSceneBreak(p: string): boolean              // "***" "* * *" "---" "- - -" "___" (อย่างน้อย 3 ตัวอักษรซ้ำ)
// speech.ts
export function splitForSpeech(text: string, max?: number, segmenter?: Intl.Segmenter | null): string[]   // max เริ่มต้น 180
// useSpeech.ts
export function useSpeech(paragraphs: string[]): { supported: boolean; hasThaiVoice: boolean; state: "idle"|"playing"|"paused"; index: number; rate: number;
  setRate(r: number): void; play(from?: number): void; pause(): void; resume(): void; stop(): void; next(): void; prev(): void }
```

- [ ] **Step 1: เทสต์ `text`** — `splitParagraphs("a\n\n\nb\n  \nc")` ได้ `["a","b","c"]` · `isSceneBreak`: `***`, `* * *`, `---`, `- - -`, `___` จริง; `**bold**`, `--`, `a***` เท็จ
- [ ] **Step 2: เทสต์ `splitForSpeech`** — **(Review Focus 5)** ย่อหน้าไทยไม่มีช่องว่างยาว ~1,000 ตัวอักษร (ซ้ำประโยคตัวอย่างหลายรอบ) → ทุกท่อน ≤ 180, `join("")` เท่ากับต้นฉบับ, และทุกรอยตัดตรงกับขอบเขตคำของ `Intl.Segmenter("th",{granularity:"word"})` · ภาษาอังกฤษที่มีช่องว่างตัดที่ช่องว่าง ไม่ตัดกลางคำ ท่อน ≤ 180 · ไทยที่มีช่องว่างคั่นวลีตัดที่ช่องว่างก่อน · ส่ง `segmenter = null` (เบราว์เซอร์ที่ไม่มี) → ตัดแข็งที่ `max` แต่ `join("")` ยังเท่าต้นฉบับ · ข้อความว่าง → `[]`
- [ ] **Step 3:** `W-TEST src/lib/text.test.ts` และ `W-TEST src/lib/speech.test.ts` → FAIL · **Step 4: เขียน `text.ts`, `speech.ts`** (ตัดตามประโยค `.!?。！？` ก่อน → ช่องว่าง → ขอบเขตคำจาก Segmenter ตามลำดับ สะสมจนใกล้ `max`)
- [ ] **Step 5: เขียน `useSpeech` และ `Reader.tsx`** · `useSpeech`: `th-TH` เลือกเสียงไทยถ้ามี เล่นทีละท่อนจาก `splitForSpeech` `index` เปลี่ยนเมื่อเริ่มย่อหน้าใหม่ `rate` 0.8–1.4 `hasThaiVoice=false` เมื่อรายชื่อเสียงโหลดแล้วไม่มีไทย `stop()` ตอน unmount · `Reader` ตาม spec 6.3 ทั้งหมด (แถบบนซ่อน/โผล่ตามทิศเลื่อน, เนื้อหา ~680px `line-height: 1.9` ย่อหน้าจากบรรทัดว่างและ `white-space: pre-line` ภายใน, เส้นคั่นฉากเป็นเครื่องหมายกลาง, แผงตั้งค่าธีม/ขนาด 16–26/ฟอนต์ เก็บ `n99.reader`, ปุ่มท้ายตอนและคีย์ ←/→ ที่ไม่ทำงานเมื่อโฟกัสช่องกรอกหรือมี modifier, จำตำแหน่งด้วย `saveProgress` หน่วง 0.5 วินาทีแล้วเลื่อนกลับตอนเปิด, ≥ 95% = จบตอน) · ไม่มีเสียงไทยซ่อนปุ่มฟังพร้อมคำอธิบายสั้น · ตอนร่างมี `DraftBadge` · `<title>` ตามตอน
- [ ] **Step 6: ตรวจ** เทสต์ทั้งสองผ่าน, typecheck + build · ตรวจตา `/novel/1/1` ที่ 390 midnight, 390 sepia, 1280 paper (ตัวอักษร ระยะบรรทัด เครื่องหมายคั่นฉาก แผงตั้งค่า)
- [ ] **Step 7: Commit** `feat(web): reader with themes, progress memory and paragraph-aware speech`

### Task 27: หน้าเกี่ยวกับ/ติดต่อ/ไม่พบ และ PWA

**Files:** สร้าง `web/src/pages/{About,Contact,NotFound}.tsx`, `e2e/make-icons.mjs` · แก้ `web/public/{manifest.webmanifest,sw.js,icon.svg}` และ `icon-192.png`/`icon-512.png` (เรนเดอร์จาก SVG ด้วย Chromium) · เทสต์ `web/src/sw.test.ts`
**Interfaces:** Produces: `sw.js` มีตัวยึด `__BUILD_ID__` ที่เซิร์ฟเวอร์แทนค่า (Task 18) · นโยบาย: เมธอด GET ที่ origin เดียวกันเท่านั้น · `/api/admin`, `/admin`, `/covers` ไม่ผ่าน SW เลย · `/assets/*` cache-first · หน้านำทางและ `/api/public/*` และไฟล์อื่น network-first ตกไปที่ cache เมื่อออฟไลน์ (หน้านำทางที่ไม่เคยแคชตกไปที่ `/`) · ไม่แคชคำตอบที่ `Cache-Control` มี `no-store` หรือ `private` · `activate` ลบ cache ที่ชื่อไม่ตรง `n99-<BUILD_ID>`

- [ ] **Step 1: เทสต์ `sw.test.ts`** (โหลด `sw.js` แทน `__BUILD_ID__` เป็น `t1` แล้วรันใน `vm` ด้วย `self`, `caches`, `fetch` ปลอม; เก็บ handler จาก `addEventListener`) — `/assets/a.js` ครั้งแรกเรียก fetch แล้วแคช ครั้งสองมาจากแคชโดยไม่เรียก fetch · คำขอนำทางออนไลน์ได้เครือข่ายและแคช; ออฟไลน์ได้จากแคช; ออฟไลน์และไม่เคยแคช → ได้ `/` · `/api/public/novels` ทำงานแบบเดียวกัน · `/api/admin/me`, `/admin/x`, `/covers/1` → `respondWith` ไม่ถูกเรียก · คำตอบที่มี `Cache-Control: private, no-store` ไม่ถูกแคช · POST และข้าม origin ถูกเมิน · `activate` ลบ cache ชื่ออื่นแต่เก็บ `n99-t1`
- [ ] **Step 2:** `W-TEST src/sw.test.ts` → FAIL · **Step 3: เขียน `sw.js`** ตามนโยบาย และลงทะเบียนใน `main.tsx` เฉพาะ `import.meta.env.PROD`
- [ ] **Step 4: หน้า** `About` และ `Contact` แสดง `site.aboutText`/`site.contactText` เป็นข้อความล้วน (`white-space: pre-wrap`) หน้าติดต่อที่ยังไม่มีข้อความแสดงคำอธิบายเรื่องแจ้งลบเนื้อหา · `NotFound` มีลิงก์กลับหน้าแรก · `manifest.webmanifest`: ชื่อ Novel 99, `lang th`, `theme_color` และ `background_color` `#0a0c12` · `icon.svg` เป็นโลโก้ "99" ในสี่เหลี่ยมไล่สี และ `node e2e/make-icons.mjs` เรนเดอร์ PNG 192/512
- [ ] **Step 5: ตรวจ** เทสต์ผ่าน, typecheck + build · `node e2e/shot.mjs /nope 390 midnight` เห็นหน้า "ไม่พบหน้านี้" · ตรวจว่า build ออก `dist/sw.js` และ `dist/theme-init.js`
- [ ] **Step 6: Commit** `feat(web): about/contact/not-found pages and offline-capable service worker`

---

## ช่วงที่ 4 — หลังบ้าน (Task 28–34)

หน้าหลังบ้านทุกหน้าเป็นภาษาไทย ใช้ token เดียวกับหน้าบ้าน ต้นแบบ CSS/เลย์เอาต์อยู่ที่ `design-reference/admin.mjs` (`adminCss`, `nav`, `dashboard()`, `chapters()`) และภาพ `admin-dashboard.jpg`, `admin-chapters.jpg` ตรวจตาด้วย `node e2e/shot.mjs <เส้นทาง> <กว้าง> <ธีม> --admin` ทุกงานจบด้วย `npm run typecheck -w web && npm run build -w web` ผ่าน · ไม่ใช้กล่องโต้ตอบของเบราว์เซอร์ (`alert/confirm`) ใช้ `ConfirmDialog` ที่ทำเอง

### Task 28: โครงหลังบ้าน — ล็อกอิน, layout, คิวสด

**Files:** สร้าง `web/src/admin/{AdminApp,Login,Layout,adminApi,types,QueueContext,format}.ts(x)`, `web/src/components/ConfirmDialog.tsx`, `web/src/styles/admin.css` · แก้ `web/src/App.tsx` (lazy `/admin/*`)
**Interfaces:** Produces:
```ts
// adminApi.ts — ห่อ api() ของ Task 21; ชนิดข้อมูลใน admin/types.ts ตรงกับ Interfaces ของ Task 12–15
export const admin: { me(): Promise<{ admin: true; passwordless: boolean }>; login(password: string): Promise<void>; logout(): Promise<void>;
  dashboard(): Promise<DashboardDto>; queue(): Promise<QueueDto>; pause(reason?: string): Promise<void>; resume(): Promise<void>;
  novels(): Promise<AdminNovelDto[]>; novel(id: number): Promise<AdminNovelDto>; createNovel(b: NovelInput): Promise<AdminNovelDto>; patchNovel(id: number, b: Partial<NovelInput>): Promise<AdminNovelDto>;
  deleteNovel(id: number): Promise<void>; putCover(id: number, data: string): Promise<{ coverV: number }>; deleteCover(id: number): Promise<void>; aiFill(b: { title: string; synopsisSrc: string; author: string }): Promise<{ titleTh: string; synopsis: string; tags: string[] }>;
  chapters(novelId: number): Promise<AdminChapterRow[]>; createChapters(novelId: number, b: { chapters: { number: number; title: string; text: string }[]; translate: boolean; publish: boolean }): Promise<{ created: number[]; queued: number }>;
  chapter(id: number): Promise<AdminChapterDto>; patchChapter(id: number, b: Partial<{ title: string; titleTh: string; sourceText: string; translation: string; recap: string }>): Promise<AdminChapterDto>;
  deleteChapter(id: number): Promise<void>; bulk(b: BulkInput): Promise<{ changed?: number; skipped?: number; queued?: number; deleted?: number }>;
  glossary(novelId: number, autoOnly?: boolean): Promise<GlossaryDto[]>; addTerm(novelId: number, b: TermInput): Promise<GlossaryDto>; patchTerm(id: number, b: Partial<TermInput>): Promise<GlossaryDto>; deleteTerm(id: number): Promise<void>;
  settings(): Promise<SettingsDto>; putSettings(b: Partial<SiteSettingsInput>): Promise<SettingsDto>; testApi(): Promise<{ ok: boolean; message: string }> }
// QueueContext.tsx
export function useQueue(): { state: QueueState | null; errors: QueueError[]; reload(): void }   // ดึง /api/admin/queue ทุก 2 วินาทีเมื่อแท็บมองเห็น, 10 วินาทีเมื่ออยู่เบื้องหลัง
// format.ts
export const STATUS_LABEL: Record<ChapterStatus, string>      // draft "ร่าง", queued "รอคิว", translating "กำลังแปล", done "แปลเสร็จ", error "ผิดพลาด"
```
เส้นทาง: `/admin` (Dashboard), `/admin/novels`, `/admin/novels/new`, `/admin/novels/:id` (แท็บ `?tab=info|chapters|glossary`), `/admin/novels/:id/chapters/:chapterId`, `/admin/add` (`?novel=ID`), `/admin/settings`

- [ ] **Step 1: เขียนโค้ด** — `AdminApp` เรียก `admin.me()`: 401 → `Login`; `passwordless` → ข้ามล็อกอิน · `Login` ช่องรหัสเดียว ผิด → "รหัสผ่านไม่ถูกต้อง", 429 → แจ้งให้รอตาม `Retry-After` · `Layout` เมนูข้าง 248px: Dashboard · นิยาย · **+ เพิ่มตอน** (ปุ่มเด่น) · ตั้งค่า · "ดูหน้าเว็บ ↗" · ออกจากระบบ; กว้าง < 900px ยุบเป็นแถบบน + ลิ้นชัก; เหนือเนื้อหามีแถบเตือนเมื่อ `state.paused` แสดงสาเหตุ + ปุ่ม "ทำต่อ" · `ConfirmDialog` (focus trap, Esc ปิด, ปุ่มอันตรายสีแดง)
- [ ] **Step 2: ตรวจตา** `node e2e/shot.mjs /admin 1280 midnight` (หน้าล็อกอินเมื่อไม่ผ่าน `--admin`) และ `… /admin 1280 midnight --admin`, `… 390 …` — เมนู/แถบบน/ลิ้นชักถูกต้อง
- [ ] **Step 3: Commit** `feat(web): admin shell with login, navigation, live queue polling and confirm dialog`

### Task 29: Dashboard

**Files:** สร้าง `web/src/admin/{Dashboard,chart}.tsx` · เทสต์ `web/src/admin/chart.test.ts`
**Interfaces:** Produces: `barGeometry(counts: number[], width: number, height: number, gap?: number): { x: number; y: number; w: number; h: number }[]` (สูงตามสัดส่วนของค่าสูงสุด; ศูนย์ทั้งหมด → ความสูง 0; ไม่หารด้วยศูนย์)

- [ ] **Step 1: เทสต์** — `barGeometry([0,5,10], 300, 100)`: แท่งสุดท้าย `h=100`, แท่งกลาง `h=50`, แท่งแรก `h=0`, แต่ละแท่ง `y + h === 100` และไม่ซ้อนกัน · `barGeometry([0,0], …)` ไม่มี `NaN`
- [ ] **Step 2:** `W-TEST src/admin/chart.test.ts` → FAIL · **Step 3: เขียน `chart.tsx`** (SVG ล้วน) และ **Dashboard** ตาม spec 7.3 ครบทุกส่วน · ค่าที่แผนกำหนดเพิ่ม: "เริ่มต้นใช้งาน" 3 ข้อแสดงเมื่อยังไม่ครบ ข้อช่องทางติดต่อเตือนสีเด่น · "เผยแพร่ทั้งหมด" ยืนยันก่อนแล้วเรียก `bulk({where:"ready", action:"publish"})` · ตอนผิดพลาดลองใหม่ด้วย `bulk({ids:[id], action:"translate"})` · คิวสดใช้ `useQueue` และเลื่อน `textTail` ลงท้ายสุดเอง
- [ ] **Step 4:** เทสต์ผ่าน · ตรวจตา `/admin 1280 midnight --admin` เทียบ `admin-dashboard.jpg` และ 390 · **Step 5: Commit** `feat(web): admin dashboard with queue panel, chart and onboarding`

### Task 30: นิยาย — รายการ, ฟอร์ม, ปก

**Files:** สร้าง `web/src/lib/cover-crop.ts`, `web/src/admin/{Novels,NovelForm,TagInput,CoverField}.tsx` · เทสต์ `web/src/lib/cover-crop.test.ts`
**Interfaces:** Produces: `coverCropRect(w: number, h: number): { sx: number; sy: number; sw: number; sh: number }` (ครอบกึ่งกลางอัตราส่วน 2:3) · `cropToCoverBase64(img: HTMLImageElement): Promise<string>` (canvas 400×600 → JPEG; ลดคุณภาพทีละขั้นจนผลถอดฐานสองแล้ว ≤ 500KB; คืน base64 ไม่มี prefix `data:`) · หน้า `Novels` และ `NovelForm` (แท็บ "ข้อมูล" ทำในงานนี้; แท็บ "ตอน"/"อภิธานศัพท์" ต่อใน Task 32/33)

- [ ] **Step 1: เทสต์** — `coverCropRect(1000,1000)` = `{sx:167, sy:0, sw:667, sh:1000}` · `(600,1200)` = `{sx:0, sy:150, sw:600, sh:900}` · `(400,600)` = `{sx:0, sy:0, sw:400, sh:600}` (กำหนด `sw = round(sh*2/3)`, `sx = round((w-sw)/2)` กรณีกว้างเกิน; `sh = round(w*3/2)`, `sy = round((h-sh)/2)` กรณีสูงเกิน)
- [ ] **Step 2:** `W-TEST src/lib/cover-crop.test.ts` → FAIL · **Step 3: เขียน `cover-crop.ts`** แล้ว **Novels** และ **NovelForm** แท็บ "ข้อมูล" ตาม spec 7.4 · ค่าที่แผนกำหนดเพิ่ม: ปุ่ม AI เติมลงช่องให้แก้ต่อและ **ยังไม่บันทึก** จนกดบันทึก (ไม่มี key → แสดงข้อความจากเซิร์ฟเวอร์) · ปก: เลือกไฟล์ → `cropToCoverBase64` → ตัวอย่าง → `putCover` · แท็กพิมพ์แล้ว Enter · ลบเรื่องผ่าน `ConfirmDialog`
- [ ] **Step 4:** เทสต์ผ่าน · ตรวจตา `/admin/novels` และ `/admin/novels/1 …` ที่ 1280 และ 390 · **Step 5: Commit** `feat(web): admin novels list and form with cover cropping and AI autofill`

### Task 31: เพิ่มตอน (วางแล้วแปล) — flow หลัก

**Files:** สร้าง `web/src/admin/AddChapters.tsx` · ต่อยอด `parse-chapters.ts` (ถ้าต้องเพิ่มตัวช่วย) พร้อมเทสต์
**Interfaces:** Consumes: `parseChapters`, `forceSingle`, `revalidate`, `validateSelection`, `estimateCost`, `admin.*`

- [ ] **Step 1: เขียนหน้าตาม spec 7.5** · ค่าที่แผนกำหนดเพิ่ม: เลือกเรื่องจาก `?novel=` (ไม่มีเรื่องเลย → ลิงก์สร้างเรื่อง) และดึงเลขตอนที่มีไว้เทียบ · ตรวจหัวข้อทันที (หน่วง ~250 ms) ด้วย `parseChapters`; แถวซ้ำ/ไม่มีเลข/ว่าง/ยาวเกินมีป้ายเตือนและไม่ติ๊ก; ปุ่ม "ไม่ต้องแยกตอน" (`forceSingle`) กับ "แยกตอนอัตโนมัติ" · ตัวเลือกจำค่าล่าสุดใน localStorage: "แปลทันที" (ปิดให้พร้อมคำอธิบายเมื่อ `apiKeySet` เป็นเท็จ → บันทึกเป็นร่าง) และ "เผยแพร่เองเมื่อแปลเสร็จ" (ค่าเริ่มต้นปิด; ปิดให้เมื่อไม่แปลทันที) · ประมาณค่าใช้จ่ายด้วย `estimateCost` เมื่อมีราคาของ `translateModel` · ปุ่ม "แปล N ตอน"/"บันทึกเป็นร่าง" ปิดเมื่อ `validateSelection` มี error ส่ง `createChapters` เรียงตามเลข สำเร็จพาไป `/admin/novels/:id?tab=chapters` · 409 `duplicate_numbers` → ทำเครื่องหมายแถวที่ซ้ำ · **(Review Focus 3)** ฝั่ง client เตือนก่อนส่งเมื่อรวมเกิน 7.5MB (`validateSelection`) และเมื่อเซิร์ฟเวอร์ตอบ 413/400 แสดงข้อความภาษาไทยจากเซิร์ฟเวอร์ในหน้า ไม่ใช่หน้าขาว
- [ ] **Step 2: ตรวจ** typecheck + build · ตรวจตา `node e2e/shot.mjs "/admin/add?novel=1" 1280 midnight --admin` (ว่าง) — หน้าเต็มเส้นทางวางข้อความจริงตรวจใน Task 35
- [ ] **Step 3: Commit** `feat(web): paste-and-translate chapter intake with live heading detection`

### Task 32: ตารางตอน (แท็บ "ตอน")

**Files:** สร้าง `web/src/admin/ChapterTable.tsx` · แก้ `NovelForm.tsx` ให้แท็บ "ตอน" แสดงตาราง

- [ ] **Step 1: เขียนตาม spec 7.6** · ค่าที่แผนกำหนดเพิ่ม: ชิปสถานะใช้ `STATUS_LABEL` · สวิตช์เผยแพร่ของตอนไม่มีคำแปลถูกปิดพร้อมคำอธิบาย · ลบผ่าน `ConfirmDialog` · "เผยแพร่ตอนที่แปลเสร็จทั้งหมด" ใช้ `bulk({where:"ready", novelId})` แล้วรายงานจำนวนที่ข้าม · ดึงรายการซ้ำทุก 2 วินาทีเมื่อมีแถว `queued`/`translating` · บนมือถือตารางเลื่อนแนวนอนได้
- [ ] **Step 2: ตรวจตา** `/admin/novels/1?tab=chapters` ที่ 1280 เทียบ `admin-chapters.jpg` และ 390 · **Step 3: Commit** `feat(web): admin chapter table with bulk actions and live status`

### Task 33: แก้ตอน + อภิธานศัพท์

**Files:** สร้าง `web/src/admin/{ChapterEdit,Glossary}.tsx` · แก้ `NovelForm.tsx` แท็บ "อภิธานศัพท์"

- [ ] **Step 1: ChapterEdit ตาม spec 7.7** · ค่าที่แผนกำหนดเพิ่ม: บันทึกส่งเฉพาะฟิลด์ที่เปลี่ยน · ไปตอนก่อนหน้า/ถัดไปถามยืนยันถ้ามีการแก้ที่ยังไม่บันทึก · ตอนที่ยังไม่มีคำแปล: ช่องคำแปลว่างพร้อมคำอธิบายว่าวางคำแปลที่แปลเองได้ ไม่เสียค่า API และไม่เผยแพร่เอง · ตอน `translating`: ช่องคำแปลถูกปิดพร้อมข้อความให้รอหรือหยุดคิว (ชื่อ/เรื่องย่อยังแก้ได้) และแสดงข้อความ 409 จากเซิร์ฟเวอร์ · ดึงสถานะซ้ำทุก 2 วินาทีเมื่อ `queued`/`translating`
- [ ] **Step 2: Glossary ตาม spec 7.8** · ค่าที่แผนกำหนดเพิ่ม: แก้แถวแล้วป้าย "AI" หาย (เซิร์ฟเวอร์ตั้ง `auto` เป็น 0) · ซ้ำ → แสดงข้อความ 409 ภาษาไทย
- [ ] **Step 3: ตรวจตา** `/admin/novels/1/chapters/1 1280` (มีคำแปล) และตอนร่าง, `/admin/novels/1?tab=glossary 390` · **Step 4: Commit** `feat(web): chapter editor with manual translation paste and glossary tab`

### Task 34: ตั้งค่า

**Files:** สร้าง `web/src/admin/Settings.tsx`

- [ ] **Step 1: เขียนตาม spec 7.9** · ค่าที่แผนกำหนดเพิ่ม: ชุดสี accent 6 แบบ (`default…blue`) แสดงเป็น swatch จากตัวแปร `--a-dark`/`--a-light` ตามธีมปัจจุบัน · โมเดลมีรายการแนะนำ `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-4-5-20251001` · ช่องทางนำเข้าแสดงสถานะ `IMPORT_TOKEN`, `importUrl` และคำสั่ง `curl` ตัวอย่างที่ใช้ `YOUR_TOKEN` พร้อมปุ่มคัดลอก (ยังไม่ตั้ง → แสดงวิธีสร้างค่าสุ่มและตั้งใน `.env`) · สำรองข้อมูลเป็นลิงก์ `/api/admin/backup` · แจ้งว่ารหัสผ่าน/API key/โทเค็นตั้งผ่านตัวแปรสภาพแวดล้อมเท่านั้น · แสดงข้อผิดพลาดตรวจค่าจากเซิร์ฟเวอร์ต่อฟิลด์
- [ ] **Step 2: ตรวจตา** `/admin/settings` ที่ 1280 และ 390 · **Step 3: Commit** `feat(web): admin settings page with accent presets, API test and import channel info`

---

## ช่วงที่ 5 — ตรวจ ส่งมอบ (Task 35–37)

### Task 35: ตรวจด้วยเบราว์เซอร์จริงทั้งระบบ + ภาพหน้าจอ

**Files:** แก้ `e2e/server.ts` (เพิ่มเส้นทางดีบักเฉพาะไฟล์นี้: `GET /__e2e/ai-calls` ส่งจำนวนครั้งที่เรียก AI ปลอม, `POST /__e2e/ai-mode` ตั้ง `ok | fail401 | slow`) · สร้าง `e2e/run.mjs` · ภาพออกที่ `docs/superpowers/verification/` (commit)
**Interfaces:** `node e2e/run.mjs` — รัน `npm run build` ก่อน แล้วบูต `e2e/server.ts`; ทุกข้อตรวจเป็น assertion ล้มแล้ว exit ≠ 0; พิมพ์ `PASS n/N`

- [ ] **Step 1: เขียนสถานการณ์หน้าบ้าน** — ธีม Midnight และ Paper × กว้าง 390 และ 1280: `/`, `/novel/1`, `/novel/1/1` เก็บภาพ; `document.documentElement.scrollWidth <= innerWidth` (ไม่มีแถบเลื่อนแนวนอน); `document.fonts.check("16px Sarabun")` จริง · สลับธีมจากเมนู → `data-theme` เปลี่ยนและคงอยู่หลังโหลดใหม่ · ปรับขนาดตัวอักษรใน Reader → `getComputedStyle` เปลี่ยนตาม · เลื่อนอ่านไป ~50% รอ 0.7 วินาที โหลดใหม่ → ตำแหน่งกลับมาใกล้เดิม · เลื่อนจนสุด → หน้าแรก "อ่านต่อ" ชี้ตอนถัดไป · ปุ่มลูกศรขวาไปตอนถัดไป · ออฟไลน์ (`context.setOffline(true)`) หลังเคยเปิดแล้ว → หน้าตอนยังเปิดได้จาก service worker · ผู้อ่านทั่วไปเข้า `/admin` ได้หน้าล็อกอิน และ `GET /api/admin/me` ได้ 401
- [ ] **Step 2: เขียนสถานการณ์หลังบ้าน** — ล็อกอินรหัสผิด (ข้อความผิด) แล้วรหัสถูก → Dashboard มี "เริ่มต้นใช้งาน" · สร้างเรื่อง (ชื่อ + แท็ก) · เพิ่มตอน: วางข้อความ 3 ตอนแบบ CRLF มีหัวข้อ `Chapter 1: …` ถึง 3 → แผง "พบ 3 ตอน" · แปลทันที (AI ปลอมหน่วงเล็กน้อย) → Dashboard เห็นข้อความไหลสดและส่วน x/y → ครบเป็น "แปลเสร็จ" · ตอนยังไม่เผยแพร่: ผู้อ่านทั่วไป (context ใหม่) ได้ 404 แต่ผู้ดูแลเห็นพร้อมป้าย "ร่าง — เห็นเฉพาะผู้ดูแล" · กด "เผยแพร่ตอนที่แปลเสร็จทั้งหมด" → ผู้อ่านเห็นทันที · ซ่อนอีกตอนแล้ว 404 · วางตอนที่ปิดแปลทันที → `draft` → วางคำแปลเองในหน้าแก้ตอน → `done` และ `/__e2e/ai-calls` ไม่เพิ่ม · นำเข้าผ่านโทเค็น (`fetch PUT` พร้อม `Authorization: Bearer`) → ตอนเป็น `done` ไม่เผยแพร่เอง; ซ้ำโดยไม่ส่ง `overwrite` → 409 · ตั้ง AI ปลอมเป็น `fail401` แล้วสั่งแปลหนึ่งตอน → แถบเตือนคิวหยุดพร้อมสาเหตุ ตอนยังเป็น `queued` → ตั้งกลับ `ok` กด "ทำต่อ" → แปลสำเร็จ · **(Review Focus 3)** ส่ง JSON 9MB ไป `/api/admin/me` ด้วย fetch → 413 ข้อความไทย แล้วหน้าเว็บยังใช้งานได้ · ดาวน์โหลดไฟล์สำรองแล้วเปิดด้วย `node:sqlite` นับเรื่องได้ถูก
- [ ] **Step 3:** `node e2e/run.mjs` → `PASS n/n`; เปิดภาพสำคัญด้วย Read ตรวจตา (หน้าแรก/เรื่อง/อ่านทั้งสองธีม, Dashboard, ตารางตอน, ตั้งค่า) แก้ปัญหาที่เห็นแล้วรันซ้ำ
- [ ] **Step 4: Commit** `test(e2e): browser verification of public site and admin flows with screenshots`

### Task 36: Docker, README, ตัวอย่าง env และตรวจทั้งชุด

**Files:** สร้าง `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.dockerignore` · เขียนใหม่ `README.md`, `server/.env.example`

- [ ] **Step 1: `server/.env.example`** — ตัวแปรทั้งหมดใน spec 10.1 พร้อมคำอธิบายไทยสั้นๆ (`ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `HOST`, `PORT`, `PUBLIC_URL`, `TRUST_PROXY`, `DB_PATH`, `TRANSLATE_MODEL`, `RECAP_MODEL`, `SESSION_SECRET`, `IMPORT_TOKEN` + บรรทัดคำสั่งสร้างค่าสุ่ม) ไม่มีค่าจริง
- [ ] **Step 2: Docker** — `Dockerfile` หลายขั้นบน `node:22-bookworm-slim`: ขั้น build `npm ci` + `npm run build`; ขั้นรันติดตั้งเฉพาะ production dependency ของ server คัดลอก `server/dist` + `web/dist`, `NODE_ENV=production`, `HEALTHCHECK` เรียก `/healthz` · `docker-compose.yml` 2 บริการ: `app` (`env_file: ./server/.env`, `HOST=0.0.0.0`, `PORT=8787`, `DB_PATH=/data/novel-99.db`, `TRUST_PROXY=1`, volume `n99-data:/data`, `restart: unless-stopped`) และ `caddy` (`caddy:2`, พอร์ต 80/443, mount `Caddyfile`, volume เก็บใบรับรอง) · `Caddyfile`: `{$DOMAIN} { reverse_proxy app:8787 }` · `.dockerignore`: `.git node_modules **/dist .env server/data *.db*`
- [ ] **Step 3: README (ไทย)** ตาม spec 10.2: ต้องมีอะไรบ้าง (Node ≥ 22.13) · รันในเครื่อง (`npm install && npm run build && npm start` เปิด `http://localhost:8787`, หลังบ้านที่ `/admin`) · ตาราง env · ลองแปลหนึ่งตอนสั้นๆ ด้วยคีย์จริง (ปุ่ม "ทดสอบการเชื่อมต่อ") · ช่องทางนำเข้า (ตั้ง `IMPORT_TOKEN`, ตัวอย่าง `curl` พร้อม `YOUR_TOKEN`) · Docker Compose + Caddy (ต้องมีโดเมน, `PUBLIC_URL`, `TRUST_PROXY=1`) · Cloudflare Tunnel (`TRUST_PROXY=1`, มี proxy เพิ่มชั้นใช้ `2`) · สำรอง/อัปเดต (ก๊อปโฟลเดอร์ `data` ทั้งโฟลเดอร์เพราะ WAL) · `npm run seed:demo` · ข้อควรรู้เรื่องลิขสิทธิ์และการตอบคำขอแจ้งลบ (ย่อจาก spec 12.1)
- [ ] **Step 4: ตรวจ Docker** — `docker compose config` ต้องผ่าน; ถ้ามี daemon ใช้ได้ `docker build -t novel-99 .` แล้วรันชั่วคราวเช็ก `/healthz`; ถ้าไม่มี daemon ให้บันทึกในรายงานส่งมอบตรงๆ ว่า **ยังไม่ได้ build จริง**
- [ ] **Step 5: ตรวจทั้งชุดตาม `superpowers:verification-before-completion`** — `npm run typecheck`, `npm test`, `npm run build`, `node e2e/run.mjs` ผ่านทั้งหมด · `git grep -nE "sk-ant-|ADMIN_PASSWORD=.+|IMPORT_TOKEN=.+"` ไม่พบค่าจริง (เฉพาะชื่อตัวแปรและตัวอย่างว่าง) · `git status` สะอาด · ทบทวน spec ข้อ 3 "เกณฑ์ที่ถือว่าเสร็จ" ทีละข้อพร้อมหลักฐาน (ชื่อเทสต์/ภาพ) · เรียกผู้ตรวจอิสระหนึ่งรอบทั้งสาขาถ้าเจ้าของเลือกวิธี Native
- [ ] **Step 6: Commit** `docs: README, env example and container deployment files`

### Task 37: ส่งมอบเข้าโฟลเดอร์จริง `C:\Project\novel-99`

**Files:** เขียนเฉพาะในโฟลเดอร์ของเจ้าของผ่านเครื่องมือเชื่อมต่อเครื่อง (ถ้าไม่ได้เชื่อมต่อให้บอกเจ้าของให้เปิดแชตนี้ในแอปเดสก์ท็อปบนเครื่องนั้นแล้วส่งข้อความ) · **ไม่แตะ** `server\data`, `server\.env`, `node_modules`

- [ ] **Step 1: ตรวจก่อนเขียน (preflight)** — `get_device_info` + `device_list_dir` โฟลเดอร์โปรเจกต์ · สำหรับทุกไฟล์ที่จะเขียนทับและมีอยู่ใน baseline (`git show c0e0ba8:<path>`) ให้ stage ไฟล์ของเจ้าของมาเทียบ SHA-256 กับ baseline: เหมือน = เขียนทับได้; ต่างจาก baseline = **หยุดและถามเจ้าของ** (สามไฟล์ที่รู้อยู่แล้วว่าต่าง: `package.json`, `package-lock.json`, `server/src/index.ts` จัดการตามขั้นถัดไป) · ถ้าพบไฟล์ใหม่หรือไฟล์อื่นต่างจาก baseline รายงานก่อนทำต่อ
- [ ] **Step 2: ประกอบชุดส่งมอบในเครื่อง Claude** — `git archive HEAD` ลงโฟลเดอร์ชั่วคราว แล้ว: ไม่รวม `package-lock.json` (เจ้าของสร้างใหม่ด้วย `npm install`) · `package.json` รากใช้ฉบับของเรา (ซึ่งคงสามข้อที่เจ้าของตั้ง: workspaces บรรทัดเดียว, build รัน server ก่อน web, `concurrently ^9.2.1` จาก Task 1) · `server/src/index.ts` เป็นฉบับใหม่ (ความสามารถ `PUT /api/chapters/:id/translation` ย้ายไปเป็นช่องทางนำเข้าแล้ว) · ไฟล์ prototype ที่ถูกแทน: `server/src/{claude,db}.ts`, `web/src/{api.ts,styles.css,useSpeech.ts}`, `web/src/pages/*.tsx` ต้องหายจากโฟลเดอร์ของเจ้าของ
- [ ] **Step 3: ลบไฟล์เดิมอย่างปลอดภัย** — ขออนุญาตลบครั้งเดียวด้วย `device_request_delete_permission` (ระบุโฟลเดอร์โปรเจกต์ + เหตุผล) ถ้าไม่ได้รับ/ไม่ตอบ ให้ย้ายไปโฟลเดอร์ `_to_delete/` (คงโครงพาธเดิม) แล้วบอกรายการให้เจ้าของลบเอง
- [ ] **Step 4: เขียนไฟล์** — ส่งชุดเป็นไฟล์ `.tar.gz` เดียว (`SendUserFile` ได้ `fileUuid` → `device_commit_files` ไปที่ `…\_incoming\n99.tar.gz`) แล้วแตกด้วย `device_bash` (`tar -xzf` ลงโฟลเดอร์โปรเจกต์ที่ mount) หรือเขียนเป็นชุดไม่เกิน 50 ไฟล์/ครั้งด้วย `device_commit_files` · จัดการไฟล์ชั่วคราว `_incoming` ด้วยวิธีเดียวกับขั้นลบ
- [ ] **Step 5: ตรวจหลังเขียน** — `device_bash`: จำนวนไฟล์และ SHA-256 ของไฟล์สำคัญตรงกับในเครื่อง Claude · `server/data` และ `server/.env` เวลาแก้ไขไม่เปลี่ยน · ไม่รัน `npm install`/`npm start` บนเครื่องเจ้าของเอง
- [ ] **Step 6: ข้อความส่งมอบ (ไทย)** — บอกสั้นๆ: ทำอะไรเสร็จและทดสอบอะไรแล้ว (ตัวเลขเทสต์จริง + ภาพหน้าจอ) · **สิ่งที่ยังไม่ได้ทดสอบ:** การเรียก Claude API จริง (ต้องลองแปลตอนสั้นๆ หนึ่งตอนด้วยคีย์จริง), Docker ถ้าไม่ได้ build จริง, การย้ายข้อมูลจริงของเจ้าของ (ทดสอบกับ DB prototype จำลองเท่านั้น) · **ขั้นตอนของเจ้าของ:** (1) ปิดแอป แล้วก๊อปโฟลเดอร์ `server\data` ทั้งโฟลเดอร์เก็บไว้ (ข้อมูลส่วนใหญ่อยู่ในไฟล์ `-wal`) (2) `node -v` ต้อง ≥ 22.13 (3) `npm install` (4) ตั้ง `server\.env` เอง: `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `IMPORT_TOKEN` (5) `npm run build` แล้ว `npm start` เปิด `http://localhost:8787` และ `/admin` (6) เรื่องที่ย้ายมาจาก prototype เป็น "ยังไม่เผยแพร่" ให้กดเผยแพร่เอง
- [ ] **Step 7: ปิดงาน** — `superpowers:finishing-a-development-branch` เสนอทางเลือกการ merge/PR ให้เจ้าของ (ที่เก็บในเครื่อง Claude ยังไม่เคยถูก push)

---

## ตารางครอบคลุม spec

| spec | งาน |
|---|---|
| 1–3 เป้าหมาย/ขอบเขต · เกณฑ์เสร็จ 1 อ่าน | 24–26, 35 · 2 flow เจ้าของ: 28–33, 35 · 3 API ล่ม: 9, 29, 35 · 4 ไม่มีทางเรียก Claude จากสาธารณะ: 10, 11, 16, 35 · 5 ข้อมูลเดิม: 4, 19 · 6 สำรอง: 15, 34, 35 · 7 นำเข้า: 13, 17, 33, 35 · 8 เทสต์+ภาพ: ทุกงาน, 35, 36 |
| 4.1–4.3 เส้นทาง/API สาธารณะ/sitemap | 11, 16, 18 |
| 5.1–5.2 โมเดลข้อมูล/ย้ายจาก prototype | 4, 8, 19 |
| 6.1–6.4 หน้าแรก/เรื่อง/อ่าน/อื่นๆ · 6.5 ธีม · 6.6 PWA · 6.7 localStorage · 6.8 ดูร่าง | 24–27 · 20 · 27 · 21 · 16, 25, 26 |
| 7.1–7.2 โครง/ล็อกอิน · 7.3 Dashboard · 7.4 นิยาย · 7.5 เพิ่มตอน · 7.6 ตารางตอน · 7.7 แก้ตอน · 7.8 อภิธาน · 7.9 ตั้งค่า | 28 · 15, 29 · 12, 30 · 22, 31 · 13, 32 · 13, 33 · 14, 33 · 15, 34 |
| 7.10 API หลังบ้าน · 7.11 ช่องทางนำเข้า | 11–15 · 17, 33, 34 |
| 8.1–8.5 สถานะ/worker/แปล/สรุป/ข้อผิดพลาด | 7, 8, 9 (prompt 6) |
| 9.1 ยืนยันตัวตน · 9.2 หน้าบ้าน · 9.3 ข้อมูลเข้า · 9.4 ปก · 9.5 ความลับ · 9.6 นำเข้า | 10, 11 · 10, 16, 18 · 11–13 · 12 · 36 (ตรวจ grep) · 17 |
| 10.1–10.3 env/รัน/ตัวอย่าง | 2, 36, 19 |
| 11 การทดสอบ · 12 ความเสี่ยง · 13 โครงโค้ด · 15 วิธีทำงาน | ทุกงาน · 29, 33, 36, README · โครงไฟล์ด้านบน · 37 |
