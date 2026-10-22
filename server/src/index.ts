import "./env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { all, get, run } from "./db.js";
import {
  CHUNK_SIZE,
  MAIN_MODEL,
  MODES,
  buildSystem,
  makeRecap,
  splitChunks,
  streamText,
  type GlossaryEntry,
  type Mode,
} from "./claude.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ERROR_MARK = "\n[[ERROR]]";

interface Novel {
  id: number;
  title: string;
  source_url: string;
  style_note: string;
  created_at: string;
}
interface Chapter {
  id: number;
  novel_id: number;
  number: number;
  title: string;
  source_text: string;
  recap: string | null;
}

const app = express();
app.use(express.json({ limit: "5mb" }));

// ---- ป้องกันด้วยรหัส (ถ้าตั้ง ACCESS_TOKEN) ----
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const token = process.env.ACCESS_TOKEN;
  if (!token || req.header("x-access-token") === token) return next();
  res.status(401).json({ error: "ต้องใส่รหัสเข้าใช้งาน" });
});

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const idOf = (v: string | string[] | undefined): number => Number(Array.isArray(v) ? v[0] : v);

// ---- นิยาย ----
app.get("/api/novels", (_req, res) => {
  res.json(
    all(
      `SELECT n.*, (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
       FROM novels n ORDER BY n.id DESC`,
    ),
  );
});

app.post("/api/novels", (req, res) => {
  const title = str(req.body?.title);
  if (!title) return void res.status(400).json({ error: "ต้องใส่ชื่อเรื่อง" });
  const r = run(
    "INSERT INTO novels (title, source_url, style_note) VALUES (?, ?, ?)",
    title,
    str(req.body?.source_url),
    str(req.body?.style_note),
  );
  res.status(201).json(get<Novel>("SELECT * FROM novels WHERE id = ?", r.lastInsertRowid));
});

app.patch("/api/novels/:id", (req, res) => {
  const id = idOf(req.params.id);
  const novel = get<Novel>("SELECT * FROM novels WHERE id = ?", id);
  if (!novel) return void res.status(404).json({ error: "ไม่พบเรื่องนี้" });
  const b = req.body ?? {};
  run(
    "UPDATE novels SET title = ?, source_url = ?, style_note = ? WHERE id = ?",
    str(b.title) || novel.title,
    typeof b.source_url === "string" ? b.source_url.trim() : novel.source_url,
    typeof b.style_note === "string" ? b.style_note.trim() : novel.style_note,
    id,
  );
  res.json(get<Novel>("SELECT * FROM novels WHERE id = ?", id));
});

app.delete("/api/novels/:id", (req, res) => {
  run("DELETE FROM novels WHERE id = ?", idOf(req.params.id));
  res.json({ ok: true });
});

app.get("/api/novels/:id", (req, res) => {
  const id = idOf(req.params.id);
  const novel = get<Novel>("SELECT * FROM novels WHERE id = ?", id);
  if (!novel) return void res.status(404).json({ error: "ไม่พบเรื่องนี้" });
  const chapters = all<{ id: number; number: number; title: string; length: number; modes: string | null }>(
    `SELECT c.id, c.number, c.title, LENGTH(c.source_text) AS length,
            (SELECT group_concat(t.mode) FROM translations t WHERE t.chapter_id = c.id) AS modes
     FROM chapters c WHERE c.novel_id = ? ORDER BY c.number`,
    id,
  ).map((c) => ({ ...c, modes: c.modes ? c.modes.split(",") : [] }));
  const glossary = all(
    "SELECT id, source, thai, note FROM glossary WHERE novel_id = ? ORDER BY source COLLATE NOCASE",
    id,
  );
  res.json({ novel, chapters, glossary });
});

// ---- ตอน ----
app.post("/api/novels/:id/chapters", (req, res) => {
  const novelId = idOf(req.params.id);
  if (!get("SELECT id FROM novels WHERE id = ?", novelId)) {
    return void res.status(404).json({ error: "ไม่พบเรื่องนี้" });
  }
  const text = str(req.body?.text);
  if (!text) return void res.status(400).json({ error: "ต้องวางเนื้อหาตอน" });
  const next = get<{ n: number }>(
    "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM chapters WHERE novel_id = ?",
    novelId,
  )!.n;
  const number = Number.isInteger(req.body?.number) && req.body.number > 0 ? req.body.number : next;
  try {
    const r = run(
      "INSERT INTO chapters (novel_id, number, title, source_text) VALUES (?, ?, ?, ?)",
      novelId,
      number,
      str(req.body?.title),
      text,
    );
    res.status(201).json({ id: r.lastInsertRowid, number });
  } catch {
    res.status(409).json({ error: `มีตอนที่ ${number} อยู่แล้ว` });
  }
});

app.get("/api/chapters/:id", (req, res) => {
  const id = idOf(req.params.id);
  const chapter = get<Chapter>("SELECT * FROM chapters WHERE id = ?", id);
  if (!chapter) return void res.status(404).json({ error: "ไม่พบตอนนี้" });
  const novel = get<Novel>("SELECT * FROM novels WHERE id = ?", chapter.novel_id)!;
  const translations: Record<string, string> = {};
  for (const t of all<{ mode: string; text: string }>(
    "SELECT mode, text FROM translations WHERE chapter_id = ?",
    id,
  )) {
    translations[t.mode] = t.text;
  }
  const prev = get<{ id: number }>(
    "SELECT id FROM chapters WHERE novel_id = ? AND number < ? ORDER BY number DESC LIMIT 1",
    chapter.novel_id,
    chapter.number,
  );
  const next = get<{ id: number }>(
    "SELECT id FROM chapters WHERE novel_id = ? AND number > ? ORDER BY number LIMIT 1",
    chapter.novel_id,
    chapter.number,
  );
  res.json({
    chapter: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      source_text: chapter.source_text,
      recap: chapter.recap,
    },
    novel: { id: novel.id, title: novel.title },
    translations,
    prev: prev?.id ?? null,
    next: next?.id ?? null,
  });
});

app.put("/api/chapters/:id", (req, res) => {
  const id = idOf(req.params.id);
  const ch = get<Chapter>("SELECT * FROM chapters WHERE id = ?", id);
  if (!ch) return void res.status(404).json({ error: "ไม่พบตอนนี้" });
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : ch.source_text;
  if (!text) return void res.status(400).json({ error: "เนื้อหาต้องไม่ว่าง" });
  run(
    "UPDATE chapters SET title = ?, source_text = ? WHERE id = ?",
    typeof req.body?.title === "string" ? req.body.title.trim() : ch.title,
    text,
    id,
  );
  if (text !== ch.source_text) {
    // ต้นฉบับเปลี่ยน คำแปลเดิมใช้ไม่ได้แล้ว
    run("DELETE FROM translations WHERE chapter_id = ?", id);
    run("UPDATE chapters SET recap = NULL WHERE id = ?", id);
  }
  res.json({ ok: true });
});

app.delete("/api/chapters/:id", (req, res) => {
  run("DELETE FROM chapters WHERE id = ?", idOf(req.params.id));
  res.json({ ok: true });
});

// ---- อภิธานศัพท์ ----
app.post("/api/novels/:id/glossary", (req, res) => {
  const novelId = idOf(req.params.id);
  const source = str(req.body?.source);
  const thai = str(req.body?.thai);
  if (!source || !thai) return void res.status(400).json({ error: "ต้องใส่ทั้งคำต้นฉบับและคำไทย" });
  run(
    `INSERT INTO glossary (novel_id, source, thai, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(novel_id, source) DO UPDATE SET thai = excluded.thai, note = excluded.note`,
    novelId,
    source,
    thai,
    str(req.body?.note),
  );
  res.status(201).json({ ok: true });
});

app.delete("/api/glossary/:id", (req, res) => {
  run("DELETE FROM glossary WHERE id = ?", idOf(req.params.id));
  res.json({ ok: true });
});

// ---- แปล / เล่า (สตรีมข้อความกลับทีละส่วน) ----
app.post("/api/chapters/:id/translate", async (req, res) => {
  const chapter = get<Chapter>("SELECT * FROM chapters WHERE id = ?", idOf(req.params.id));
  if (!chapter) return void res.status(404).json({ error: "ไม่พบตอนนี้" });
  const mode = req.body?.mode as Mode;
  if (!MODES.includes(mode)) return void res.status(400).json({ error: "โหมดไม่ถูกต้อง" });
  const force = req.body?.force === true;

  const cached = get<{ text: string }>(
    "SELECT text FROM translations WHERE chapter_id = ? AND mode = ?",
    chapter.id,
    mode,
  );
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  if (cached && !force) return void res.end(cached.text);

  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const novel = get<Novel>("SELECT * FROM novels WHERE id = ?", chapter.novel_id)!;
    const glossary = all<GlossaryEntry>(
      "SELECT source, thai, note FROM glossary WHERE novel_id = ?",
      novel.id,
    );
    const recaps = all<{ number: number; recap: string }>(
      `SELECT number, recap FROM chapters
       WHERE novel_id = ? AND number < ? AND recap IS NOT NULL
       ORDER BY number DESC LIMIT 5`,
      novel.id,
      chapter.number,
    ).reverse();
    const system = buildSystem({
      mode,
      novelTitle: novel.title,
      styleNote: novel.style_note,
      glossary,
      recaps,
    });

    const chunks = splitChunks(chapter.source_text, CHUNK_SIZE[mode]);
    const header = `ตอนที่ ${chapter.number}${chapter.title ? `: ${chapter.title}` : ""}`;
    const outputs: string[] = [];
    let wrote = false;
    const write = (t: string) => {
      wrote = true;
      res.write(t);
    };

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) write("\n\n");
      const prevTail = outputs.length ? outputs[outputs.length - 1].slice(-800) : "";
      const user = [
        `${header} (ส่วนที่ ${i + 1}/${chunks.length})`,
        prevTail ? `<previous_output_tail>\n${prevTail}\n</previous_output_tail>` : "",
        `<source_text>\n${chunks[i]}\n</source_text>`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const out = await streamText({
        model: MAIN_MODEL,
        system,
        user,
        maxTokens: 8000,
        onText: write,
        signal: ac.signal,
      });
      outputs.push(out.trim());
    }

    const finalText = outputs.join("\n\n");
    run(
      `INSERT INTO translations (chapter_id, mode, text) VALUES (?, ?, ?)
       ON CONFLICT(chapter_id, mode) DO UPDATE SET text = excluded.text, created_at = CURRENT_TIMESTAMP`,
      chapter.id,
      mode,
      finalText,
    );

    // เก็บเรื่องย่อไว้เป็นความจำให้ตอนถัดไป (ไม่ให้ล้มทั้งงานถ้าขั้นนี้พลาด)
    if (mode !== "summary" || !chapter.recap) {
      try {
        const recap = await makeRecap(finalText);
        if (recap) run("UPDATE chapters SET recap = ? WHERE id = ?", recap, chapter.id);
      } catch (e) {
        console.warn("สร้างเรื่องย่อไม่สำเร็จ:", e instanceof Error ? e.message : e);
      }
    }
    res.end();
    void wrote;
  } catch (e) {
    if (ac.signal.aborted) return void res.end();
    const msg = e instanceof Error ? e.message : String(e);
    console.error("translate error:", msg);
    if (!res.headersSent) {
      res.type("application/json");
      res.status(500).json({ error: msg });
    } else {
      res.write(`${ERROR_MARK} ${msg}`);
      res.end();
    }
  }
});

// ---- เสิร์ฟหน้าเว็บที่ build แล้ว ----
const webDist = path.resolve(here, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const bad = err instanceof SyntaxError;
  res.status(bad ? 400 : 500).json({ error: bad ? "ข้อมูลที่ส่งมาไม่ถูกต้อง" : err.message });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Novel 99 พร้อมใช้งานที่ http://${host}:${port}`);
  if (host !== "127.0.0.1" && !process.env.ACCESS_TOKEN) {
    console.warn("คำเตือน: เปิดให้เครื่องอื่นเข้าถึงได้ แต่ยังไม่ได้ตั้ง ACCESS_TOKEN");
  }
});
