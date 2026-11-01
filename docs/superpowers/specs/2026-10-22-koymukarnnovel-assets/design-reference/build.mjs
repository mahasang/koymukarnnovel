// สร้างภาพตัวอย่างหน้าตา (mockup) ของ koymukarnnovel เพื่อให้ผู้ใช้เลือกแนวทาง — ใช้ชั่วคราวใน scratchpad เท่านั้น
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fontRoot = path.join(here, "node_modules/@fontsource");

const THAI = "U+0E01-0E5B,U+200C-200D,U+25CC";
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

function face(family, pkg, weight, subset) {
  const file = path.join(fontRoot, pkg, "files", `${pkg}-${subset}-${weight}-normal.woff2`);
  const b64 = fs.readFileSync(file).toString("base64");
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${subset === "thai" ? THAI : LATIN};}`;
}
const fonts = [
  ...[500, 600, 700].flatMap((w) => ["thai", "latin"].map((s) => face("Prompt", "prompt", w, s))),
  ...[400, 500, 600].flatMap((w) => ["thai", "latin"].map((s) => face("Sarabun", "sarabun", w, s))),
  ...[400, 600, 700].flatMap((w) => ["thai", "latin"].map((s) => face("Noto Serif Thai", "noto-serif-thai", w, s))),
].join("\n");

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  sort: '<path d="M3 6h13M3 12h9M3 18h5M17 8v12m0 0-3-3m3 3 3-3"/>',
  phones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
};
const icon = (n, s = 16) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

// ---------- ปกนิยาย (วาดเองด้วย CSS/SVG เป็นงานต้นแบบ ไม่ใช่ปกจริงของเรื่องใด) ----------
const NOVELS = [
  { t: "ตะเกียงดวงสุดท้าย", en: "The Last Lantern", au: "Elmer Quill", tags: ["แฟนตาซี", "ผจญภัย"], c: ["#fcd34d", "#c2410c", "#2a0a0a"], m: "lantern", ep: 87, ago: "3 ชั่วโมงที่แล้ว", fresh: true },
  { t: "จักรพรรดิไร้บัลลังก์", en: "The Throneless Emperor", au: "Sora Vance", tags: ["ย้อนยุค"], c: ["#fda4af", "#9f1239", "#1c0a14"], m: "blade", ep: 212, ago: "5 ชั่วโมงที่แล้ว", fresh: true },
  { t: "ดาวเคราะห์ดวงที่ 99", en: "Planet No. 99", au: "M. Hartwell", tags: ["ไซไฟ"], c: ["#7dd3fc", "#1d4ed8", "#0b1026"], m: "planet", ep: 45, ago: "เมื่อวาน" },
  { t: "เชฟแห่งโลกหลังวันสิ้นโลก", en: "The Chef After the End", au: "Dana Brooke", tags: ["วันสิ้นโลก"], c: ["#bef264", "#15803d", "#052e16"], m: "city", ep: 131, ago: "เมื่อวาน" },
  { t: "หอสมุดใต้สมุทร", en: "The Library Under the Sea", au: "Ivo Lindqvist", tags: ["ลึกลับ"], c: ["#5eead4", "#0f766e", "#042f2e"], m: "waves", ep: 60, ago: "2 วันที่แล้ว" },
  { t: "นักดาบผู้ลืมชื่อตัวเอง", en: "The Swordsman Who Forgot His Name", au: "Kai Renwick", tags: ["กำลังภายใน"], c: ["#e2e8f0", "#475569", "#0f172a"], m: "mountain", ep: 304, ago: "2 วันที่แล้ว" },
  { t: "ภรรยาสัญญาของท่านดยุก", en: "The Duke's Contract Wife", au: "Hana Ito", tags: ["โรแมนติก"], c: ["#f9a8d4", "#a21caf", "#2e1065"], m: "flower", ep: 98, ago: "3 วันที่แล้ว" },
  { t: "นักล่าฝันร้าย", en: "Nightmare Hunter", au: "Rook Ellis", tags: ["สยองขวัญ"], c: ["#c4b5fd", "#5b21b6", "#150a2e"], m: "eye", ep: 77, ago: "3 วันที่แล้ว" },
  { t: "เมืองในกระเป๋าเดินทาง", en: "A City in a Suitcase", au: "Noor Aziz", tags: ["แฟนตาซี"], c: ["#fdba74", "#b45309", "#1f1305"], m: "suitcase", ep: 33, ago: "4 วันที่แล้ว" },
  { t: "รหัสลับแห่งฤดูหนาว", en: "Winter Cipher", au: "T. Lindgren", tags: ["สืบสวน"], c: ["#bae6fd", "#0369a1", "#082f49"], m: "snow", ep: 120, ago: "5 วันที่แล้ว" },
  { t: "ครูสอนเวทจอมขี้เกียจ", en: "The Lazy Magic Teacher", au: "Pip Marlow", tags: ["ตลก"], c: ["#fde68a", "#a16207", "#271a04"], m: "book", ep: 54, ago: "1 สัปดาห์ที่แล้ว" },
  { t: "ผู้พิทักษ์ประภาคาร", en: "Keeper of the Lighthouse", au: "Wren Okafor", tags: ["ผจญภัย"], c: ["#a5b4fc", "#3730a3", "#0f0a2e"], m: "waves", ep: 18, ago: "1 สัปดาห์ที่แล้ว", done: true },
];

function motif(m, i) {
  const W = "rgba(255,255,255,";
  switch (m) {
    case "lantern":
      return `<circle cx="100" cy="115" r="78" fill="${W}.16)"/><circle cx="100" cy="115" r="44" fill="${W}.3)"/><rect x="86" y="92" width="28" height="50" rx="8" fill="#fff6d6"/><path d="M90 92q10-20 20 0" fill="none" stroke="#fff6d6" stroke-width="4"/><rect x="90" y="142" width="20" height="6" rx="3" fill="#fff6d6"/>`;
    case "blade":
      return `<circle cx="100" cy="120" r="74" fill="${W}.1)"/><g transform="rotate(32 100 120)"><rect x="95" y="28" width="10" height="170" rx="5" fill="${W}.85)"/><rect x="78" y="192" width="44" height="9" rx="4.5" fill="${W}.75)"/><rect x="96" y="201" width="8" height="26" rx="4" fill="${W}.6)"/></g>`;
    case "planet":
      return `<circle cx="100" cy="115" r="50" fill="${W}.24)"/><circle cx="84" cy="100" r="46" fill="${W}.14)"/><ellipse cx="100" cy="115" rx="88" ry="20" fill="none" stroke="${W}.6)" stroke-width="3" transform="rotate(-18 100 115)"/><circle cx="40" cy="48" r="3" fill="#fff"/><circle cx="165" cy="70" r="2" fill="#fff"/><circle cx="150" cy="185" r="2.5" fill="#fff"/>`;
    case "city":
      return `<circle cx="150" cy="72" r="26" fill="${W}.55)"/><g fill="${W}.3)"><rect x="18" y="150" width="28" height="100"/><rect x="50" y="118" width="32" height="132"/><rect x="86" y="160" width="26" height="90"/><rect x="116" y="96" width="36" height="154"/><rect x="156" y="140" width="28" height="110"/></g>`;
    case "waves":
      return [0, 1, 2, 3]
        .map((k) => `<path d="M-10 ${95 + k * 26} q27-24 55 0 t55 0 t55 0 t55 0" fill="none" stroke="${W}${0.55 - k * 0.1})" stroke-width="${4 - k * 0.5}"/>`)
        .join("") + `<circle cx="140" cy="52" r="20" fill="${W}.6)"/>`;
    case "mountain":
      return `<circle cx="140" cy="78" r="28" fill="${W}.7)"/><polygon points="0,205 62,112 112,178 152,128 200,205" fill="${W}.3)"/><polygon points="0,235 52,162 102,218 162,152 200,228 200,300 0,300" fill="rgba(0,0,0,.28)"/>`;
    case "flower":
      return (
        [0, 1, 2, 3, 4, 5]
          .map((k) => {
            const a = (k * Math.PI) / 3;
            return `<circle cx="${100 + Math.cos(a) * 34}" cy="${112 + Math.sin(a) * 34}" r="26" fill="${W}.3)"/>`;
          })
          .join("") + `<circle cx="100" cy="112" r="20" fill="${W}.85)"/>`
      );
    case "eye":
      return `<path d="M16 118Q100 44 184 118Q100 192 16 118Z" fill="none" stroke="${W}.75)" stroke-width="4"/><circle cx="100" cy="118" r="28" fill="${W}.5)"/><circle cx="100" cy="118" r="11" fill="rgba(0,0,0,.65)"/>`;
    case "suitcase":
      return `<rect x="42" y="88" width="116" height="84" rx="14" fill="${W}.34)"/><path d="M78 88V74a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v14" fill="none" stroke="${W}.75)" stroke-width="6"/><g fill="${W}.8)"><rect x="58" y="108" width="12" height="16" rx="2"/><rect x="78" y="100" width="14" height="24" rx="2"/><rect x="100" y="112" width="12" height="12" rx="2"/><rect x="120" y="102" width="16" height="22" rx="2"/></g>`;
    case "snow":
      return Array.from({ length: 26 }, (_, k) => {
        const x = (k * 73 + i * 11) % 190 + 5;
        const y = (k * 47 + i * 7) % 200 + 20;
        return `<circle cx="${x}" cy="${y}" r="${1.5 + (k % 3)}" fill="${W}.${5 + (k % 4)})"/>`;
      }).join("") + `<circle cx="100" cy="105" r="34" fill="none" stroke="${W}.6)" stroke-width="3"/>`;
    case "book":
      return `<circle cx="100" cy="92" r="34" fill="${W}.22)"/><path d="M100 150Q60 120 18 130V212Q60 200 100 232Z" fill="${W}.5)"/><path d="M100 150Q140 120 182 130V212Q140 200 100 232Z" fill="${W}.32)"/>`;
    default:
      return "";
  }
}

const coverBg = (c) => `radial-gradient(90% 60% at 28% 8%, ${c[0]}bb, transparent 70%), linear-gradient(170deg, ${c[1]}, ${c[2]})`;
const cv = (n, i = 0) =>
  `<div class="cv" style="background:${coverBg(n.c)}"><svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">${motif(n.m, i)}</svg><div class="cv-title">${n.t}</div></div>`;

// ---------- CSS ----------
const css = `
*{box-sizing:border-box;margin:0;padding:0}
[data-theme="midnight"]{--bg:#0a0c12;--bg-2:#0f121a;--surface:#141824;--surface-2:#1b2132;--line:#252c40;--text:#eceef5;--muted:#8f98ae;--accent:#8b7bff;--accent-2:#ff6f91;--accent-ink:#0b0b14;--shadow:0 12px 30px rgba(0,0,0,.45);--display:'Prompt','Sarabun',sans-serif;--hero-a:rgba(10,12,18,.97);--hero-b:rgba(10,12,18,.72);--hero-c:rgba(10,12,18,.18)}
[data-theme="paper"]{--bg:#f4efe6;--bg-2:#efe8db;--surface:#fffcf6;--surface-2:#f6efe1;--line:#e3d8c3;--text:#2a2118;--muted:#7d6e5b;--accent:#c2410c;--accent-2:#0f766e;--accent-ink:#fff7ed;--shadow:0 10px 26px rgba(80,56,20,.18);--display:'Noto Serif Thai','Prompt',serif;--hero-a:rgba(244,239,230,.97);--hero-b:rgba(244,239,230,.8);--hero-c:rgba(244,239,230,.2)}
[data-theme="sepia"]{--bg:#f2e8d2;--bg-2:#ecdfc3;--surface:#f8efdb;--surface-2:#efe3c8;--line:#dccfae;--text:#3b2f20;--muted:#8a7a62;--accent:#b45309;--accent-2:#0f766e;--accent-ink:#fff7ed;--shadow:0 10px 26px rgba(80,56,20,.18);--display:'Prompt','Sarabun',sans-serif}
html{font-family:'Sarabun','Prompt',sans-serif;-webkit-font-smoothing:antialiased}
body{background:var(--bg);color:var(--text);font-size:16px;line-height:1.6}
a{color:inherit;text-decoration:none}
svg{flex:none}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px}

/* header */
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.top .in{display:flex;align-items:center;gap:26px;height:64px}
.logo{display:flex;align-items:center;gap:10px;font-family:'Prompt';font-weight:700;font-size:20px;letter-spacing:-.01em}
.logo .mark{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;color:var(--accent-ink);font-size:15px;font-weight:700}
.logo b{color:var(--accent);font-weight:700}
.nav{display:flex;gap:4px}
.nav a{padding:8px 15px;border-radius:999px;color:var(--muted);font-weight:500;font-size:15px}
.nav a.on{color:var(--text);background:var(--surface-2)}
.search{margin-left:auto;display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:0 18px;height:42px;width:330px;color:var(--muted);font-size:14.5px}
.iconbtn{width:42px;height:42px;border-radius:999px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;color:var(--text)}

/* hero */
.hero{position:relative;margin-top:24px;border-radius:26px;overflow:hidden;min-height:410px;display:flex;align-items:center;border:1px solid var(--line)}
.hero .bg{position:absolute;inset:-40px;filter:blur(30px) saturate(1.25);transform:scale(1.15)}
.hero .shade{position:absolute;inset:0;background:linear-gradient(90deg,var(--hero-a) 0%,var(--hero-b) 48%,var(--hero-c) 100%),linear-gradient(0deg,var(--bg) 0%,transparent 30%)}
.hero .body{position:relative;display:grid;grid-template-columns:1fr 270px;gap:48px;align-items:center;padding:46px 58px;width:100%}
.chip{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-weight:600;font-size:13px;font-family:'Prompt'}
.hero h1{font-family:var(--display);font-size:46px;line-height:1.18;font-weight:700;margin:16px 0 4px;letter-spacing:-.01em}
.hero .sub{color:var(--muted);font-size:15px}
.hero .facts{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 14px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font-size:13px;font-weight:500}
.pill.st{color:var(--accent-2);border-color:color-mix(in srgb,var(--accent-2) 40%,var(--line));background:color-mix(in srgb,var(--accent-2) 12%,transparent)}
.hero .syn{max-width:560px;font-size:16.5px;color:color-mix(in srgb,var(--text) 82%,transparent);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cta{display:flex;gap:12px;margin-top:24px}
.btn{height:48px;padding:0 24px;border-radius:15px;font-family:'Prompt';font-weight:600;font-size:15.5px;display:inline-flex;align-items:center;justify-content:center;gap:9px;border:1px solid transparent}
.btn.primary{background:var(--accent);color:var(--accent-ink);box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 38%,transparent)}
.btn.ghost{background:var(--surface-2);color:var(--text);border-color:var(--line)}
.btn.full{flex:1}
.poster{width:270px;border-radius:18px;overflow:hidden;transform:rotate(3deg);box-shadow:0 34px 70px rgba(0,0,0,.5);justify-self:center}
.dots{position:absolute;right:58px;bottom:24px;display:flex;gap:7px}
.dots i{width:8px;height:8px;border-radius:99px;background:var(--line)}
.dots i.on{width:26px;background:var(--accent)}

/* covers & cards */
.cv{position:relative;overflow:hidden;container-type:inline-size;aspect-ratio:2/3;width:100%}
.cv svg{position:absolute;inset:0;width:100%;height:100%}
.cv::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 42%,rgba(0,0,0,.6) 100%)}
.cv-title{position:absolute;z-index:2;left:8%;right:8%;bottom:8%;text-align:center;font-family:'Prompt';font-weight:700;font-size:11.5cqw;line-height:1.22;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.55)}
.sec{margin-top:46px}
.sec-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.sec-h h2{font-family:var(--display);font-size:25px;font-weight:700;letter-spacing:-.01em}
.sec-h a{display:inline-flex;align-items:center;gap:4px;color:var(--muted);font-size:14.5px}
.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:22px 20px}
.card{display:block}
.card .box{position:relative;border-radius:14px;overflow:hidden;box-shadow:var(--shadow);border:1px solid color-mix(in srgb,var(--line) 70%,transparent)}
.b-new{position:absolute;z-index:3;top:9px;left:9px;background:var(--accent-2);color:#fff;font-family:'Prompt';font-weight:600;font-size:11.5px;padding:3px 10px;border-radius:999px}
.b-ep{position:absolute;z-index:3;top:9px;right:9px;background:rgba(8,8,14,.72);backdrop-filter:blur(6px);color:#fff;font-family:'Prompt';font-weight:500;font-size:11.5px;padding:3px 9px;border-radius:9px}
.b-done{position:absolute;z-index:3;left:9px;bottom:9px;background:rgba(255,255,255,.9);color:#111;font-family:'Prompt';font-weight:600;font-size:11px;padding:2px 9px;border-radius:999px}
.card h3{font-family:'Prompt';font-weight:600;font-size:15px;line-height:1.38;margin:11px 0 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;line-height:1.5}

/* continue reading */
.resume{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.rcard{display:flex;gap:16px;padding:14px;border-radius:18px;background:var(--surface);border:1px solid var(--line)}
.rcard .th{width:68px;flex:none;border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.rcard .tx{flex:1;min-width:0;display:flex;flex-direction:column}
.rcard h3{font-family:'Prompt';font-weight:600;font-size:16px;line-height:1.3}
.rcard .meta{color:var(--muted);font-size:13px;margin:3px 0 10px}
.bar{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden;margin-top:auto}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.rcard .go{margin-top:10px;display:inline-flex;align-items:center;gap:6px;color:var(--accent);font-family:'Prompt';font-weight:600;font-size:13.5px}

/* chips */
.chips{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:22px;align-items:center}
.fchip{padding:8px 17px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:14.5px;font-weight:500}
.fchip.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.chips .sp{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px}

/* footer */
.foot{margin-top:64px;border-top:1px solid var(--line);background:var(--bg-2);padding:38px 0 30px;color:var(--muted);font-size:14.5px}
.foot .cols{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:40px}
.foot h4{font-family:'Prompt';font-weight:600;color:var(--text);margin-bottom:10px;font-size:15px}
.foot li{list-style:none;margin:5px 0}
.foot .cr{margin-top:28px;padding-top:18px;border-top:1px solid var(--line);font-size:13px}

/* phones */
.stage{display:flex;gap:44px;justify-content:center;padding:44px 40px;background:radial-gradient(80% 60% at 50% 0%,#1a1f33 0%,#0a0c12 70%);min-height:900px}
.cap{text-align:center;color:#aeb6cc;font-family:'Prompt';font-weight:500;font-size:15px;margin-top:16px}
.phone{width:372px;height:790px;border-radius:46px;border:10px solid #04050a;background:var(--bg);color:var(--text);overflow:hidden;position:relative;box-shadow:0 40px 80px rgba(0,0,0,.6),0 0 0 2px #232a3f}
.phone .notch{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:96px;height:24px;border-radius:99px;background:#04050a;z-index:20}
.screen{height:100%;overflow:hidden;position:relative}
.np-hero{position:relative;padding:44px 18px 18px;overflow:hidden}
.np-bg{position:absolute;inset:-30px;filter:blur(26px) saturate(1.3);opacity:.85}
.np-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,12,18,.35),var(--bg) 96%)}
.np-top{position:relative;display:flex;justify-content:space-between}
.ib{width:38px;height:38px;border-radius:99px;background:rgba(10,12,18,.55);backdrop-filter:blur(8px);display:grid;place-items:center;color:#fff}
.np-head{position:relative;display:flex;gap:16px;margin-top:14px}
.np-cover{width:128px;flex:none;border-radius:12px;overflow:hidden;box-shadow:0 18px 36px rgba(0,0,0,.5)}
.np-info{display:flex;flex-direction:column;gap:5px;padding-top:2px;min-width:0}
.np-info h1{font-family:var(--display);font-weight:700;font-size:21px;line-height:1.25}
.np-info .sub{color:var(--muted);font-size:12.5px;line-height:1.35}
.np-info .meta{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px}
.np-info .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.np-body{padding:0 18px}
.tagrow{display:flex;gap:7px;margin:4px 0 14px;flex-wrap:wrap}
.np-body .cta{margin-top:0}
.np-body .btn{height:46px;font-size:14.5px;padding:0 16px}
.syn2{margin-top:14px;font-size:14.5px;color:color-mix(in srgb,var(--text) 80%,transparent);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.more{color:var(--accent);font-size:13.5px;font-weight:600;margin-top:2px}
.credit{margin-top:14px;padding:11px 13px;border-radius:14px;background:var(--surface);border:1px solid var(--line);font-size:12.5px;line-height:1.55;color:var(--muted);display:flex;gap:9px}
.credit svg{color:var(--accent);margin-top:2px}
.credit b{color:var(--text);font-weight:600}
.ch-h{display:flex;align-items:center;justify-content:space-between;margin:20px 0 8px}
.ch-h h2{font-family:'Prompt';font-weight:600;font-size:17px}
.ch-h span{display:inline-flex;gap:6px;align-items:center;color:var(--muted);font-size:13px}
.chrow{display:flex;align-items:center;gap:10px;padding:11px 2px;border-bottom:1px solid var(--line);font-size:14.5px}
.chrow .n{font-family:'Prompt';font-weight:600;min-width:62px}
.chrow .t{flex:1;color:color-mix(in srgb,var(--text) 85%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chrow .d{color:var(--muted);font-size:12px}
.chrow .new{background:var(--accent-2);color:#fff;font-family:'Prompt';font-size:10.5px;font-weight:600;padding:1px 8px;border-radius:99px}

.rd-prog{position:absolute;left:0;top:0;height:3px;width:38%;background:linear-gradient(90deg,var(--accent),var(--accent-2));z-index:10}
.rd-bar{display:flex;align-items:center;gap:10px;padding:40px 14px 10px;background:var(--bg)}
.rd-bar .tt{flex:1;min-width:0;line-height:1.25}
.rd-bar .tt small{display:block;color:var(--muted);font-size:12px}
.rd-bar .tt b{font-family:'Prompt';font-weight:600;font-size:14.5px}
.rd-aa{width:40px;height:40px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;font-family:'Prompt';font-weight:600;font-size:15px}
.rd-body{padding:6px 22px 0}
.rd-body .no{color:var(--muted);font-size:13px;letter-spacing:.04em;margin-top:8px}
.rd-body h1{font-family:var(--display);font-weight:700;font-size:25px;line-height:1.25;margin:4px 0 18px}
.rd-body p{font-size:18.5px;line-height:2;margin-bottom:14px;font-family:'Sarabun'}
.rd-nav{position:absolute;left:0;right:0;bottom:0;display:flex;gap:10px;padding:12px 14px 20px;background:linear-gradient(180deg,transparent,var(--bg) 35%)}
.rd-nav .btn{height:46px;font-size:14px;padding:0 14px}
.dim{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:15}
.sheet{position:absolute;left:0;right:0;bottom:0;z-index:16;background:var(--surface);border-radius:26px 26px 0 0;padding:12px 20px 26px;border-top:1px solid var(--line)}
.sheet .grab{width:40px;height:4px;border-radius:99px;background:var(--line);margin:0 auto 14px}
.sheet h3{font-family:'Prompt';font-weight:600;font-size:17px;margin-bottom:12px}
.lbl{font-size:12.5px;color:var(--muted);margin:14px 0 8px;font-weight:500}
.themes{display:flex;gap:10px}
.sw{flex:1;text-align:center;font-size:12.5px;color:var(--muted)}
.sw i{display:grid;place-items:center;height:46px;border-radius:14px;border:2px solid var(--line);margin-bottom:6px;font-style:normal;font-family:'Prompt';font-weight:600;font-size:16px}
.sw.on i{border-color:var(--accent)}
.sw.on{color:var(--text);font-weight:600}
.slider{display:flex;align-items:center;gap:12px}
.slider .tr{flex:1;height:6px;border-radius:99px;background:var(--surface-2);position:relative}
.slider .tr i{position:absolute;left:0;top:0;bottom:0;width:48%;background:var(--accent);border-radius:99px}
.slider .tr em{position:absolute;left:48%;top:50%;width:20px;height:20px;border-radius:99px;background:#fff;transform:translate(-50%,-50%);box-shadow:0 2px 8px rgba(0,0,0,.4)}
.seg{display:flex;background:var(--surface-2);border-radius:12px;padding:3px;gap:3px}
.seg span{flex:1;text-align:center;padding:8px 0;border-radius:9px;font-size:13.5px;color:var(--muted)}
.seg span.on{background:var(--bg);color:var(--text);font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.tts{display:flex;align-items:center;gap:12px;margin-top:16px;padding:12px 14px;border-radius:16px;background:var(--surface-2)}
.tts .play{width:40px;height:40px;border-radius:99px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center}
.tts .tx{flex:1;font-size:14px;line-height:1.3}
.tts small{color:var(--muted);display:block;font-size:12px}
`;

// ---------- หน้าแรก ----------
const timeLabel = (n) => `${icon("clock", 13)} ${n.ago}`;
function card(n, i) {
  return `<a class="card"><div class="box">${cv(n, i)}${n.fresh ? '<span class="b-new">ใหม่</span>' : ""}<span class="b-ep">ตอน ${n.ep}</span>${n.done ? '<span class="b-done">จบแล้ว</span>' : ""}</div><h3>${n.t}</h3><div class="meta">${icon("user", 13)} ${n.au}</div><div class="meta">${timeLabel(n)}</div></a>`;
}
function resumeCard(n, ch, pct, i) {
  return `<div class="rcard"><div class="th">${cv(n, i)}</div><div class="tx"><h3>${n.t}</h3><div class="meta">ตอนที่ ${ch} · อ่านแล้ว ${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div><span class="go">อ่านต่อ ${icon("right", 14)}</span></div></div>`;
}
function home(theme) {
  const f = NOVELS[0];
  const moon = theme === "midnight" ? "moon" : "sun";
  return `<!doctype html><html lang="th" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fonts}${css}</style></head><body>
<header class="top"><div class="wrap in">
  <div class="logo"><span class="mark">K</span><span>koymukarnnovel</span></div>
  <nav class="nav"><a class="on">หน้าแรก</a><a>นิยายทั้งหมด</a><a>อัปเดตล่าสุด</a><a>จบแล้ว</a></nav>
  <div class="search">${icon("search", 17)}<span>ค้นหาชื่อเรื่อง ผู้แต่ง หมวดหมู่…</span></div>
  <span class="iconbtn">${icon(moon, 18)}</span>
</div></header>
<main class="wrap">
  <section class="hero">
    <div class="bg" style="background:${coverBg(f.c)}"></div><div class="shade"></div>
    <div class="body">
      <div>
        <span class="chip">${icon("sparkle", 14)} แนะนำสัปดาห์นี้</span>
        <h1>${f.t}</h1>
        <div class="sub">${f.en} · โดย ${f.au}</div>
        <div class="facts"><span class="pill st">ยังไม่จบ</span><span class="pill">${f.ep} ตอน</span><span class="pill">แฟนตาซี</span><span class="pill">ผจญภัย</span></div>
        <p class="syn">ทุกดวงไฟของโลกดับลงในคืนเดียว เหลือเพียงตะเกียงเก่าดวงเดียวที่ตกอยู่ในมือของเด็กหนุ่มลูกช่างซ่อมรองเท้า เขาต้องพาแสงสุดท้ายนี้ข้ามเทือกเขาไปให้ถึงหอคอยร้าง ก่อนที่ความมืดจะกลืนทุกคนที่เขารัก</p>
        <div class="cta"><a class="btn primary">${icon("play", 16)} เริ่มอ่านตอนที่ 1</a><a class="btn ghost">รายละเอียด</a></div>
      </div>
      <div class="poster">${cv(f, 0)}</div>
    </div>
    <div class="dots"><i class="on"></i><i></i><i></i><i></i></div>
  </section>

  <section class="sec"><div class="sec-h"><h2>อ่านต่อจากที่ค้างไว้</h2></div>
    <div class="resume">${resumeCard(NOVELS[2], 12, 40, 2)}${resumeCard(NOVELS[4], 31, 72, 4)}${resumeCard(NOVELS[6], 5, 15, 6)}</div>
  </section>

  <section class="sec"><div class="sec-h"><h2>อัปเดตล่าสุด</h2><a>ดูทั้งหมด ${icon("right", 15)}</a></div>
    <div class="grid">${NOVELS.slice(0, 6).map(card).join("")}</div>
  </section>

  <section class="sec"><div class="sec-h"><h2>นิยายทั้งหมด</h2></div>
    <div class="chips"><span class="fchip on">ทั้งหมด</span><span class="fchip">แฟนตาซี</span><span class="fchip">ไซไฟ</span><span class="fchip">โรแมนติก</span><span class="fchip">ลึกลับ</span><span class="fchip">กำลังภายใน</span><span class="fchip">จบแล้ว</span>
      <span class="sp">${icon("sort", 15)} เรียงตาม: อัปเดตล่าสุด</span></div>
    <div class="grid">${NOVELS.slice(6, 12).map((n, k) => card({ ...n, fresh: false }, k + 6)).join("")}</div>
  </section>
</main>
<footer class="foot"><div class="wrap">
  <div class="cols">
    <div><div class="logo" style="color:var(--text);margin-bottom:12px"><span class="mark">K</span><span>koymukarnnovel</span></div><p>คลังนิยายออนไลน์แปลไทย แปลด้วย AI และตรวจทานโดยผู้ดูแล เครดิตต้นฉบับเป็นของผู้แต่งและเจ้าของผลงาน แต่ละเรื่องมีลิงก์ไปยังต้นฉบับ</p></div>
    <div><h4>เมนู</h4><ul><li>หน้าแรก</li><li>นิยายทั้งหมด</li><li>อัปเดตล่าสุด</li></ul></div>
    <div><h4>ข้อมูล</h4><ul><li>เกี่ยวกับเว็บไซต์</li><li>ติดต่อ / แจ้งลบเนื้อหา</li><li>ที่มาและเครดิต</li></ul></div>
  </div>
  <div class="cr">© 2026 koymukarnnovel</div>
</div></footer>
</body></html>`;
}

// ---------- มือถือ ----------
const SYN =
  "ทุกดวงไฟของโลกดับลงในคืนเดียว เหลือเพียงตะเกียงเก่าดวงเดียวที่ตกอยู่ในมือของเด็กหนุ่มลูกช่างซ่อมรองเท้า เขาต้องพาแสงสุดท้ายนี้ข้ามเทือกเขาไปให้ถึงหอคอยร้าง ก่อนที่ความมืดจะกลืนทุกคนที่เขารัก";
const PARAS = [
  "ลมหนาวพัดผ่านช่องเขาในคืนที่ดวงจันทร์ซ่อนตัวอยู่หลังเมฆ ไอ-หลานกำตะเกียงทองเหลืองเก่าไว้แน่น แสงเล็กๆ ในนั้นสั่นไหวราวกับรู้ตัวว่าเป็นดวงสุดท้ายของโลกใบนี้",
  "“อย่าให้มันดับนะ” เสียงผู้เฒ่าดังมาจากเงามืดด้านหลัง “ตราบใดที่ยังมีแสง หมู่บ้านก็ยังจำทางกลับได้”",
  "เด็กหนุ่มพยักหน้า ทั้งที่นิ้วเริ่มชาจากความหนาว เขาไม่เคยเล่าให้ใครฟังว่าเมื่อคืนก่อน เปลวไฟในตะเกียงเคยกระซิบเรียกชื่อของเขา",
  "เขาก้าวขึ้นบันไดหินทีละขั้น ทุกครั้งที่ลมแรงขึ้น แสงก็หรี่ลงจนเหลือเพียงจุดเล็กๆ แล้วก็สว่างวาบขึ้นมาใหม่ราวกับกำลังสู้อยู่เคียงข้างเขา",
];
function readerPhone(theme, withSheet) {
  return `<div class="phone" data-theme="${theme}"><div class="notch"></div><div class="screen">
  <div class="rd-prog"></div>
  <div class="rd-bar"><span class="iconbtn" style="width:38px;height:38px">${icon("left", 18)}</span><div class="tt"><small>ตะเกียงดวงสุดท้าย</small><b>ตอนที่ 12</b></div><span class="rd-aa">Aa</span></div>
  <div class="rd-body"><div class="no">ตอนที่ 12</div><h1>ลมหนาวที่ช่องเขา</h1>${PARAS.map((p) => `<p>${p}</p>`).join("")}</div>
  <div class="rd-nav"><a class="btn ghost" style="flex:1">${icon("left", 16)} ก่อนหน้า</a><a class="btn ghost" style="width:52px;padding:0">${icon("list", 18)}</a><a class="btn primary" style="flex:1">ถัดไป ${icon("right", 16)}</a></div>
  ${
    withSheet
      ? `<div class="dim"></div><div class="sheet"><div class="grab"></div><h3>การแสดงผล</h3>
    <div class="lbl">ธีม</div>
    <div class="themes"><div class="sw"><i style="background:#fff;color:#222">ก</i>สว่าง</div><div class="sw"><i style="background:#f2e8d2;color:#3b2f20">ก</i>ซีเปีย</div><div class="sw on"><i style="background:#141824;color:#eceef5">ก</i>มืด</div><div class="sw"><i style="background:#000;color:#cfcfcf">ก</i>ดำสนิท</div></div>
    <div class="lbl">ขนาดตัวอักษร</div>
    <div class="slider"><span style="font-size:13px;color:var(--muted)">ก</span><div class="tr"><i></i><em></em></div><span style="font-size:20px">ก</span></div>
    <div class="lbl">ชนิดตัวอักษร</div>
    <div class="seg"><span class="on">Sarabun</span><span style="font-family:'Noto Serif Thai'">Noto Serif</span><span>Prompt</span></div>
    <div class="tts"><span class="play">${icon("play", 16)}</span><div class="tx"><b style="font-family:'Prompt';font-weight:600">ฟังเสียงอ่าน</b><small>ความเร็ว 1.0×</small></div>${icon("phones", 20)}</div>
  </div>`
      : ""
  }
</div></div>`;
}
function novelPhone() {
  const f = NOVELS[0];
  const rows = [
    [87, "ลมหนาวที่ช่องเขา", "3 ชม.", true],
    [86, "ความลับของผู้เฒ่า", "1 วัน", false],
    [85, "เสียงกระซิบในเปลวไฟ", "2 วัน", false],
    [84, "บันไดหินเก้าร้อยขั้น", "3 วัน", false],
    [83, "หอคอยที่ไม่มีประตู", "4 วัน", false],
  ];
  return `<div class="phone" data-theme="midnight"><div class="notch"></div><div class="screen">
  <div class="np-hero"><div class="np-bg" style="background:${coverBg(f.c)}"></div><div class="np-shade"></div>
    <div class="np-top"><span class="ib">${icon("left", 18)}</span><span class="ib">${icon("share", 17)}</span></div>
    <div class="np-head"><div class="np-cover">${cv(f, 0)}</div>
      <div class="np-info"><h1>${f.t}</h1><div class="sub">${f.en}</div><div class="meta">${icon("user", 13)} ${f.au}</div>
        <div class="row"><span class="pill st">ยังไม่จบ</span><span class="pill">${f.ep} ตอน</span></div></div></div>
  </div>
  <div class="np-body">
    <div class="tagrow"><span class="pill">แฟนตาซี</span><span class="pill">ผจญภัย</span><span class="pill">${icon("clock", 12)} อัปเดต 3 ชม.ที่แล้ว</span></div>
    <div class="cta"><a class="btn primary full">${icon("play", 15)} เริ่มอ่านตอนที่ 1</a><a class="btn ghost">ตอนล่าสุด</a></div>
    <p class="syn2">${SYN}</p><div class="more">อ่านต่อ</div>
    <div class="credit">${icon("sparkle", 15)}<div><b>ต้นฉบับ:</b> ${f.en} โดย ${f.au} · <b>ที่มา</b> ${icon("external", 11)}<br>แปลโดย AI ตรวจทานโดยผู้ดูแล</div></div>
    <div class="ch-h"><h2>สารบัญ (${f.ep} ตอน)</h2><span>${icon("sort", 14)} ใหม่ → เก่า</span></div>
    ${rows.map((r) => `<div class="chrow"><span class="n">ตอนที่ ${r[0]}</span><span class="t">${r[1]}</span>${r[3] ? '<span class="new">ใหม่</span>' : `<span class="d">${r[2]}</span>`}</div>`).join("")}
  </div></div></div>`;
}
function phones() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${fonts}${css}</style></head><body style="background:#0a0c12"><div class="stage">
  <div>${novelPhone()}<div class="cap">หน้าข้อมูลนิยาย</div></div>
  <div>${readerPhone("sepia", false)}<div class="cap">หน้าอ่าน (ธีมซีเปีย)</div></div>
  <div>${readerPhone("midnight", true)}<div class="cap">ตั้งค่าการอ่าน + ฟังเสียงอ่าน</div></div>
</div></body></html>`;
}

export { fonts, css, icon, ICONS, NOVELS, cv, coverBg };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? here;
  fs.writeFileSync(path.join(out, "home-midnight.html"), home("midnight"));
  fs.writeFileSync(path.join(out, "home-paper.html"), home("paper"));
  fs.writeFileSync(path.join(out, "phones.html"), phones());
  console.log("written to", out);
}
