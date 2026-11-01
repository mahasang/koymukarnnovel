// service worker ของ koymukarnnovel: ให้ติดตั้งเป็นแอปได้ และเปิดหน้าที่เคยเปิดแล้วได้แม้ออฟไลน์
// เซิร์ฟเวอร์แทน __BUILD_ID__ ด้วยแฮชของ index.html ทุกครั้งที่ส่งไฟล์นี้ → ออก build ใหม่ = ชื่อแคชใหม่ = ไฟล์นี้เปลี่ยน = SW รุ่นใหม่เข้ามาแทน
// นโยบาย (มีเทสต์ครบใน src/sw.test.ts):
//   - เฉพาะ GET ที่ origin เดียวกัน
//   - /api ทุกเส้นที่ไม่ใช่ /api/public/ (รวม /api/admin), /admin, /covers ไม่ผ่าน SW เลย (หลังบ้านและรูปปกให้เบราว์เซอร์จัดการเอง)
//   - /assets/* (ชื่อไฟล์มีแฮชในตัว) → cache-first
//   - หน้านำทาง, /api/public/* และไฟล์อื่น → network-first ตกไปที่แคชเมื่อออฟไลน์ · หน้านำทางที่ไม่เคยแคชตกไปที่ "/"
//   - ไม่แคชคำตอบที่ไม่ ok หรือ Cache-Control มี no-store / private (เช่น หน้าร่างที่เห็นเฉพาะผู้ดูแล)
const CACHE = "koymukarnnovel-__BUILD_ID__";

self.addEventListener("install", () => {
  self.skipWaiting();
});

// ลบแคชทุกชื่อที่ไม่ใช่ของรุ่นนี้ แล้วยึดแท็บที่เปิดอยู่
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

/** ไม่ให้ SW แตะ: /api/* ที่ไม่ใช่ /api/public/*, /admin, /covers (เทียบทั้งท่อนพาธ: /administrator ไม่ใช่หลังบ้าน) */
function passesThrough(pathname) {
  if (pathname.startsWith("/api/")) return !pathname.startsWith("/api/public/");
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/covers" || pathname.startsWith("/covers/");
}

/** แคชได้เฉพาะคำตอบ ok ที่ไม่ห้ามเก็บ (no-store / private) — no-cache แคชได้: แปลว่า "ถามเซิร์ฟเวอร์ก่อนใช้" ซึ่ง network-first ทำอยู่แล้ว */
function storable(response) {
  if (!response.ok) return false;
  const control = response.headers.get("Cache-Control");
  if (control === null) return true;
  return !control.split(",").some((directive) => {
    const name = directive.trim().toLowerCase().split("=")[0];
    return name === "no-store" || name === "private";
  });
}

/** เก็บสำเนาไว้เบื้องหลัง (ต้อง clone ก่อนส่งตัวจริงให้หน้า) · เขียนไม่สำเร็จ เช่น พื้นที่เต็ม ไม่กระทบคำตอบที่หน้าได้ */
function remember(event, request, response) {
  if (!storable(response)) return;
  const copy = response.clone();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.put(request, copy))
      .catch(() => {}),
  );
}

async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  remember(event, request, response);
  return response;
}

async function networkFirst(event, request) {
  try {
    const response = await fetch(request);
    remember(event, request, response);
    return response;
  } catch (error) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    // เฉพาะหน้านำทางที่ตกไปหน้าแรกได้ (เป็น HTML) — คำขอข้อมูลหรือไฟล์ที่ไม่มีในแคชต้องล้มตามจริง ไม่ใช่ได้ HTML ไปแทน
    if (request.mode === "navigate") {
      const home = await cache.match("/", { ignoreVary: true });
      if (home) return home;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || passesThrough(url.pathname)) return;
  event.respondWith(url.pathname.startsWith("/assets/") ? cacheFirst(event, request) : networkFirst(event, request));
});
