// ภาพตัวอย่างหน้า admin (แดชบอร์ด + เพิ่มตอนแบบวางแล้วแปล) — ใช้ชั่วคราวใน scratchpad เท่านั้น
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fonts, css, icon as baseIcon, ICONS, NOVELS, cv } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

Object.assign(ICONS, {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
});
const icon = baseIcon;

const adminCss = `
.admin{display:grid;grid-template-columns:248px 1fr;min-height:100vh;background:var(--bg)}
.side{background:var(--bg-2);border-right:1px solid var(--line);padding:22px 16px;display:flex;flex-direction:column;gap:4px;height:1100px}
.side .logo{padding:4px 10px 20px}
.side .lbl2{font-size:11.5px;letter-spacing:.08em;color:var(--muted);padding:6px 14px;font-weight:500}
.side .it{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;color:var(--muted);font-weight:500;font-size:15px}
.side .it.on{background:var(--surface-2);color:var(--text)}
.side .it.on svg{color:var(--accent)}
.side .grow{flex:1}
.side .badge{margin-left:auto;background:var(--accent);color:var(--accent-ink);border-radius:99px;font-size:11.5px;font-weight:700;padding:1px 9px;font-family:'Prompt'}
.main{padding:28px 36px 40px;min-width:0}
.ph{display:flex;align-items:center;gap:14px;margin-bottom:22px}
.ph h1{font-family:'Prompt';font-weight:700;font-size:27px;line-height:1.2}
.ph .crumb{color:var(--muted);font-size:13.5px;margin-bottom:2px}
.ph .sp{margin-left:auto;display:flex;gap:10px}
.btn.sm{height:42px;font-size:14.5px;padding:0 18px;border-radius:13px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:18px 20px}
.stat .k{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:14px}
.stat .k svg{color:var(--accent)}
.stat .v{font-family:'Prompt';font-weight:700;font-size:33px;margin-top:8px;line-height:1.1}
.stat .d{font-size:13px;color:var(--muted);margin-top:6px;display:flex;align-items:center;gap:6px}
.stat .d b{color:#4ade80;font-weight:600;display:inline-flex;align-items:center;gap:4px}
.row2{display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin-top:16px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px 22px}
.panel h2{font-family:'Prompt';font-weight:600;font-size:17px;display:flex;align-items:center;gap:10px;margin-bottom:14px}
.panel h2 .sub{margin-left:auto;font-weight:400;color:var(--muted);font-size:13px;font-family:'Sarabun'}
.qnow{display:flex;gap:14px;padding:14px 16px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line)}
.qnow .th{width:46px;flex:none;border-radius:8px;overflow:hidden}
.qnow .tx{flex:1;min-width:0}
.qnow b{font-family:'Prompt';font-weight:600;font-size:15.5px}
.qnow .meta{color:var(--muted);font-size:13px;margin:1px 0 8px}
.spin{width:20px;height:20px;border-radius:99px;border:3px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);flex:none}
.live{margin-top:12px;font-size:14px;color:var(--muted);line-height:1.75;border-left:3px solid var(--accent);padding:2px 0 2px 12px}
.live em{font-style:normal;color:var(--text)}
.qrow{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--line);font-size:14.5px}
.qrow:last-child{border-bottom:0}
.qrow .n{font-family:'Prompt';font-weight:600;min-width:84px}
.qrow .t{flex:1;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bars{display:flex;align-items:flex-end;gap:9px;height:150px;margin-top:8px}
.bars i{flex:1;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 30%,transparent));display:block}
.axis{display:flex;gap:9px;margin-top:8px;color:var(--muted);font-size:11.5px}
.axis span{flex:1;text-align:center}
.prow{display:flex;align-items:center;gap:14px;padding:9px 0}
.prow .th{width:30px;flex:none;border-radius:6px;overflow:hidden}
.prow .tx{flex:1;min-width:0}
.prow .tt{display:flex;justify-content:space-between;font-size:14.5px;margin-bottom:6px}
.prow .tt b{font-family:'Prompt';font-weight:600}
.prow .tt span{color:var(--muted);font-size:13px}
.bar{height:6px;border-radius:99px;background:var(--surface-2);overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.usage{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.usage div{background:var(--surface-2);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.usage small{color:var(--muted);font-size:12.5px;display:block}
.usage b{font-family:'Prompt';font-weight:700;font-size:22px}
.st2{display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:99px;font-size:12.5px;font-weight:600;font-family:'Prompt';white-space:nowrap}
.st2.ok{background:rgba(74,222,128,.14);color:#4ade80}
.st2.q{background:rgba(251,191,36,.14);color:#fbbf24}
.st2.run{background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent)}
.st2.err{background:rgba(248,113,113,.15);color:#f87171}
.st2.off{background:var(--surface-2);color:var(--muted)}
.tabs2{display:flex;gap:6px;border-bottom:1px solid var(--line);margin:-4px 0 22px}
.tabs2 a{padding:11px 16px;color:var(--muted);font-weight:500;font-size:15px;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs2 a.on{color:var(--text);border-color:var(--accent);font-weight:600}
.tabs2 a small{margin-left:6px;background:var(--surface-2);border-radius:99px;padding:1px 8px;font-size:12px}
.paste{display:grid;grid-template-columns:1.45fr 1fr;gap:16px}
.ta{background:var(--bg-2);border:1px solid var(--line);border-radius:14px;padding:16px 18px;font-size:14.5px;line-height:1.8;color:var(--muted);height:372px;overflow:hidden;position:relative}
.ta p{margin-bottom:10px}
.ta::after{content:"";position:absolute;left:0;right:0;bottom:0;height:70px;background:linear-gradient(180deg,transparent,var(--bg-2))}
.hl{display:block;color:var(--text);font-family:'Prompt';font-weight:600;background:color-mix(in srgb,var(--accent) 16%,transparent);border-left:3px solid var(--accent);padding:2px 12px;margin:12px -6px 10px;border-radius:0 8px 8px 0;font-size:14.5px}
.hint{display:flex;align-items:center;gap:10px;margin-top:10px;color:var(--muted);font-size:13px}
.found{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.found .big{font-family:'Prompt';font-weight:700;font-size:34px;line-height:1;color:var(--accent)}
.found .tx{font-size:14px;line-height:1.4;color:var(--muted)}
.found .tx b{color:var(--text);font-weight:600;display:block;font-size:15.5px}
.det{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--line);margin-bottom:8px;font-size:14px}
.det .no{font-family:'Prompt';font-weight:700;min-width:30px;color:var(--accent)}
.det .nm{flex:1;min-width:0}
.det .nm b{font-weight:500;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.det .nm small{color:var(--muted);font-size:12px}
.opt{display:flex;align-items:center;gap:12px;margin:14px 0 0;font-size:14.5px}
.opt .tx{flex:1;line-height:1.35}
.opt small{display:block;color:var(--muted);font-size:12.5px}
.sw2{width:40px;height:23px;border-radius:99px;background:var(--surface-2);border:1px solid var(--line);position:relative;display:inline-block;flex:none}
.sw2::after{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:99px;background:var(--muted)}
.sw2.on{background:var(--accent);border-color:var(--accent)}
.sw2.on::after{left:19px;background:#fff}
.tool{display:flex;gap:10px;align-items:center;margin:26px 0 8px}
.tool .in{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 14px;height:40px;color:var(--muted);font-size:14px;width:260px}
.tool .sel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 14px;height:40px;display:flex;align-items:center;color:var(--text);font-size:14px}
.tool .sp{margin-left:auto}
.tbl{background:var(--surface);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.tbl .th,.tbl .tr{display:grid;grid-template-columns:30px 84px 1fr 170px 90px 104px;align-items:center;gap:12px;padding:12px 18px}
.tbl .th{color:var(--muted);font-size:12.5px;font-weight:500;border-bottom:1px solid var(--line);background:var(--bg-2)}
.tbl .tr{border-bottom:1px solid var(--line);font-size:14.5px}
.tbl .tr:last-child{border-bottom:0}
.tbl .tr .n{font-family:'Prompt';font-weight:600}
.tbl .tr .t small{display:block;color:var(--muted);font-size:12.5px}
.cb{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--line);display:block}
.act{display:flex;gap:6px;justify-content:flex-end}
.act span{width:32px;height:32px;border-radius:9px;border:1px solid var(--line);display:grid;place-items:center;color:var(--muted)}
`;

const nav = (active) => {
  const it = (ic, label, key, extra = "") => `<a class="it${active === key ? " on" : ""}">${icon(ic, 19)} ${label}${extra}</a>`;
  return `<aside class="side">
    <div class="logo"><span class="mark">K</span><span>koymukarnnovel</span></div>
    <div class="lbl2">จัดการ</div>
    ${it("grid", "แดชบอร์ด", "dash")}
    ${it("book", "นิยาย", "novels")}
    ${it("layers", "คิวแปล", "queue", '<span class="badge">7</span>')}
    ${it("sliders", "ตั้งค่า", "settings")}
    <div class="grow"></div>
    ${it("globe", "ดูหน้าเว็บ", "site")}
    ${it("logout", "ออกจากระบบ", "out")}
  </aside>`;
};
const shell = (body) =>
  `<!doctype html><html lang="th" data-theme="midnight"><head><meta charset="utf-8"><style>${fonts}${css}${adminCss}</style></head><body><div class="admin">${body}</div></body></html>`;

// ---------- แดชบอร์ด ----------
function dashboard() {
  const bars = [32, 41, 38, 55, 47, 62, 58, 44, 71, 66, 80, 74, 92, 100];
  const days = ["9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22"];
  const prog = [
    [NOVELS[0], 87, 90], [NOVELS[2], 45, 120], [NOVELS[4], 60, 60], [NOVELS[6], 98, 140], [NOVELS[9], 120, 200],
  ];
  return shell(`${nav("dash")}<main class="main">
    <div class="ph"><div><div class="crumb">ภาพรวมวันนี้</div><h1>แดชบอร์ด</h1></div>
      <div class="sp"><a class="btn ghost sm">${icon("paste", 17)} เพิ่มตอน</a><a class="btn primary sm">${icon("plus", 17)} เพิ่มเรื่องใหม่</a></div></div>
    <div class="stats">
      <div class="stat"><div class="k">${icon("book", 18)} นิยาย</div><div class="v">12</div><div class="d">ซ่อนอยู่ 1 เรื่อง</div></div>
      <div class="stat"><div class="k">${icon("check", 18)} ตอนที่เผยแพร่แล้ว</div><div class="v">486</div><div class="d"><b>${icon("trend", 14)} +9</b> ใน 7 วัน</div></div>
      <div class="stat"><div class="k">${icon("layers", 18)} รอคิวแปล</div><div class="v">7</div><div class="d">กำลังแปล 1 · ผิดพลาด 1</div></div>
      <div class="stat"><div class="k">${icon("eye", 18)} ยอดอ่านวันนี้</div><div class="v">1,284</div><div class="d"><b>${icon("trend", 14)} 12%</b> จากเมื่อวาน</div></div>
    </div>
    <div class="row2">
      <section class="panel"><h2>คิวแปล <span class="sub">แปลทีละตอนตามลำดับ · เหลือ 6 ตอน</span><a class="btn ghost sm" style="height:34px;padding:0 14px;font-size:13px">${icon("pause", 14)} หยุดคิว</a></h2>
        <div class="qnow"><span class="spin"></span><div class="th">${cv(NOVELS[0])}</div><div class="tx"><b>ตะเกียงดวงสุดท้าย · ตอนที่ 88</b><div class="meta">กำลังแปล ส่วนที่ 2 จาก 3 · เริ่มเมื่อ 1 นาทีที่แล้ว</div><div class="bar"><i style="width:58%"></i></div></div></div>
        <div class="live"><em>ลมหนาวพัดแรงจนเปลวไฟในตะเกียงเอนราบ</em> ไอ-หลานก้าวขึ้นบันไดขั้นที่เก้าร้อย พลางกอดตะเกียงไว้แนบอก ราวกับว่าถ้าปล่อยมือเพียงเสี้ยววินาที…</div>
        <div style="margin-top:12px">
          <div class="qrow"><span class="n">ตอนที่ 89</span><span class="t">ตะเกียงดวงสุดท้าย</span><span class="st2 q">รอคิว</span></div>
          <div class="qrow"><span class="n">ตอนที่ 90</span><span class="t">ตะเกียงดวงสุดท้าย</span><span class="st2 q">รอคิว</span></div>
          <div class="qrow"><span class="n">ตอนที่ 46</span><span class="t">ดาวเคราะห์ดวงที่ 99</span><span class="st2 err">ผิดพลาด · ลองใหม่</span></div>
        </div>
      </section>
      <section class="panel"><h2>ยอดอ่าน 14 วัน <span class="sub">รวม 14,980 ครั้ง</span></h2>
        <div class="bars">${bars.map((b) => `<i style="height:${b}%"></i>`).join("")}</div>
        <div class="axis">${days.map((d) => `<span>${d}</span>`).join("")}</div>
        <div style="margin-top:18px;color:var(--muted);font-size:13.5px;display:flex;gap:10px;align-items:center">${icon("trend", 16)} เรื่องยอดนิยม 7 วัน: <b style="color:var(--text);font-weight:600">ตะเกียงดวงสุดท้าย</b>, จักรพรรดิไร้บัลลังก์</div>
      </section>
    </div>
    <div class="row2" style="grid-template-columns:1fr 1fr">
      <section class="panel"><h2>ความคืบหน้าแต่ละเรื่อง <span class="sub">แปลแล้ว / ตอนที่เพิ่มไว้</span></h2>
        ${prog.map(([n, a, b]) => `<div class="prow"><div class="th">${cv(n)}</div><div class="tx"><div class="tt"><b>${n.t}</b><span>${a} / ${b}</span></div><div class="bar"><i style="width:${(a / b) * 100}%"></i></div></div></div>`).join("")}
      </section>
      <section class="panel"><h2>การใช้งาน AI เดือนนี้ <span class="sub">ตัวเลขตัวอย่าง</span></h2>
        <div class="usage"><div><small>ข้อความเข้า (tokens)</small><b>1.82M</b></div><div><small>ข้อความออก (tokens)</small><b>2.41M</b></div></div>
        <div class="qrow"><span class="n" style="min-width:0">แปลแล้ว</span><span class="t" style="text-align:right;color:var(--text)">143 ตอน เฉลี่ย 29k tokens/ตอน</span></div>
        <div class="qrow"><span class="n" style="min-width:0">โมเดล</span><span class="t" style="text-align:right;color:var(--text)">แปล: Sonnet 5.5 · สรุปย่อ: Haiku 4.5</span></div>
        <div class="qrow"><span class="n" style="min-width:0">เชื่อมต่อ</span><span class="t" style="text-align:right"><span class="st2 ok">${icon("check", 13)} API พร้อมใช้งาน</span></span></div>
      </section>
    </div>
  </main>`);
}

// ---------- เพิ่มตอน (วางแล้วแปล) ----------
function chapters() {
  const rows = [
    [87, "ลมหนาวที่ช่องเขา", "Wind at the Pass", '<span class="st2 ok">' + icon("check", 13) + " แปลแล้ว</span>", true],
    [86, "ความลับของผู้เฒ่า", "The Old Man's Secret", '<span class="st2 ok">' + icon("check", 13) + " แปลแล้ว</span>", true],
    [85, "เสียงกระซิบในเปลวไฟ", "A Whisper in the Flame", '<span class="st2 ok">' + icon("check", 13) + " แปลแล้ว</span>", false],
    [84, "บันไดหินเก้าร้อยขั้น", "Nine Hundred Steps", `<span class="st2 err">${icon("alert", 13)} ผิดพลาด</span>`, true],
  ];
  return shell(`${nav("novels")}<main class="main">
    <div class="ph"><div><div class="crumb">นิยาย / ตะเกียงดวงสุดท้าย</div><h1>เพิ่มตอนใหม่</h1></div>
      <div class="sp"><a class="btn ghost sm">${icon("eye", 17)} ดูหน้านิยาย</a></div></div>
    <div class="tabs2"><a>ข้อมูลเรื่อง</a><a class="on">ตอน<small>90</small></a><a>ศัพท์เฉพาะ<small>42</small></a><a>ตั้งค่าการแปล</a></div>
    <div class="paste">
      <section class="panel" style="padding:18px 18px 14px"><h2 style="margin-bottom:10px">${icon("paste", 18)} วางเนื้อหาต้นฉบับ (ภาษาอังกฤษ) <span class="sub">วางได้ทีละหลายตอน</span></h2>
        <div class="ta">
          <span class="hl">Chapter 88: The Stone Stairs</span>
          <p>The wind had teeth that night. Ai Lan climbed the ninth hundred step with the lantern pressed against his chest, and every gust tried to take it from him.</p>
          <p>"Don't look down," the old man had said. So he looked up, at the tower that had no door.</p>
          <span class="hl">Chapter 89: A Door With No Wall</span>
          <p>By dawn the tower had moved. Or perhaps he had. The mountain kept its secrets the way a locked drawer keeps a letter, quietly and without apology.</p>
          <p>He set the lantern down on the frost-white stone and, for the first time in three days, let himself breathe.</p>
          <span class="hl">Chapter 90: What the Flame Remembered</span>
          <p>The flame did not flicker when he spoke its name. It leaned toward him instead, the way a child leans toward a story.</p>
        </div>
        <div class="hint">${icon("sparkle", 15)} ไม่ต้องจัดรูปแบบ แค่คัดลอกจากเว็บมาวาง ระบบหาหัวข้อ "Chapter N" ให้เอง</div>
      </section>
      <section class="panel"><h2>ตรวจพบอัตโนมัติ</h2>
        <div class="found"><span class="big">3</span><div class="tx"><b>ตอน จะแยกให้อัตโนมัติ</b>รวมประมาณ 5,900 คำ</div></div>
        <div class="det"><span class="no">88</span><div class="nm"><b>The Stone Stairs</b><small>1,820 คำ</small></div>${icon("edit", 16)}</div>
        <div class="det"><span class="no">89</span><div class="nm"><b>A Door With No Wall</b><small>2,104 คำ</small></div>${icon("edit", 16)}</div>
        <div class="det"><span class="no">90</span><div class="nm"><b>What the Flame Remembered</b><small>1,977 คำ</small></div>${icon("edit", 16)}</div>
        <div class="opt"><div class="tx">แปลทันทีหลังบันทึก<small>ระบบแปลทีละตอนเบื้องหลัง ปิดหน้านี้ได้</small></div><span class="sw2 on"></span></div>
        <div class="opt"><div class="tx">เผยแพร่ให้ผู้อ่านเมื่อแปลเสร็จ<small>ปิดไว้ถ้าอยากตรวจก่อน</small></div><span class="sw2 on"></span></div>
        <div style="display:flex;gap:10px;margin-top:18px"><a class="btn primary full sm">${icon("sparkle", 16)} บันทึกและแปล 3 ตอน</a><a class="btn ghost sm">เก็บเป็นร่าง</a></div>
      </section>
    </div>
    <div class="tool"><div class="in">${icon("search", 16)} ค้นหาตอน…</div><div class="sel">สถานะ: ทั้งหมด</div><div class="sp"><a class="btn ghost sm">${icon("refresh", 16)} แปลตอนที่ยังไม่แปลทั้งหมด</a></div></div>
    <div class="tbl">
      <div class="th"><span class="cb"></span><span>ตอนที่</span><span>ชื่อตอน</span><span>สถานะ</span><span>เผยแพร่</span><span></span></div>
      ${rows
        .map(
          (r) => `<div class="tr"><span class="cb"></span><span class="n">${r[0]}</span><span class="t">${r[1]}<small>${r[2]}</small></span><span>${r[3]}</span><span><span class="sw2${r[4] ? " on" : ""}"></span></span><span class="act"><span>${icon(r[3].includes("err") ? "refresh" : "edit", 15)}</span><span>${icon("trash", 15)}</span></span></div>`,
        )
        .join("")}
    </div>
  </main>`);
}

const out = process.argv[2] ?? here;
fs.writeFileSync(path.join(out, "admin-dashboard.html"), dashboard());
fs.writeFileSync(path.join(out, "admin-chapters.html"), chapters());
console.log("admin pages written");
