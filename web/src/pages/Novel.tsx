import { useEffect, useState, type FormEvent } from "react";
import { MODE_LABEL, api, type NovelDetail } from "../api";

type Tab = "chapters" | "glossary" | "settings";

export default function Novel({ id }: { id: number }) {
  const [data, setData] = useState<NovelDetail | null>(null);
  const [tab, setTab] = useState<Tab>("chapters");
  const [error, setError] = useState("");

  const load = () =>
    api
      .novel(id)
      .then(setData)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <a href="#/">‹ กลับ</a>
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!data) return <main className="page muted">กำลังโหลด…</main>;

  return (
    <main className="page">
      <header className="topbar">
        <a href="#/" className="back">
          ‹
        </a>
        <h1 className="grow">{data.novel.title}</h1>
      </header>

      <nav className="tabs">
        {(
          [
            ["chapters", `ตอน (${data.chapters.length})`],
            ["glossary", `ศัพท์ (${data.glossary.length})`],
            ["settings", "ตั้งค่า"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "chapters" && <Chapters id={id} data={data} reload={load} />}
      {tab === "glossary" && <Glossary id={id} data={data} reload={load} />}
      {tab === "settings" && <Settings id={id} data={data} reload={load} />}
    </main>
  );
}

function Chapters({ id, data, reload }: { id: number; data: NovelDetail; reload: () => Promise<void> }) {
  const nextNumber = data.chapters.reduce((m, c) => Math.max(m, c.number), 0) + 1;
  const [number, setNumber] = useState(String(nextNumber));
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setNumber(String(nextNumber)), [nextNumber]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.addChapter(id, { number: Number(number) || undefined, title, text });
      setTitle("");
      setText("");
      await reload();
      location.hash = `#/chapter/${r.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="list">
        {data.chapters.map((c) => (
          <li key={c.id}>
            <a className="row" href={`#/chapter/${c.id}`}>
              <span className="grow">
                <strong>
                  ตอนที่ {c.number}
                  {c.title ? ` · ${c.title}` : ""}
                </strong>
                <small className="muted">
                  {c.modes.length ? c.modes.map((m) => MODE_LABEL[m]).join(" · ") : "ยังไม่ได้แปล"}
                </small>
              </span>
              <span aria-hidden>›</span>
            </a>
          </li>
        ))}
        {data.chapters.length === 0 && <p className="muted">ยังไม่มีตอน วางตอนแรกด้านล่างได้เลย</p>}
      </ul>

      <h2>เพิ่มตอนใหม่</h2>
      <form className="card stack" onSubmit={add}>
        <div className="split">
          <label className="narrow">
            ตอนที่
            <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" />
          </label>
          <label className="grow">
            ชื่อตอน (ไม่บังคับ)
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <label>
          เนื้อหาต้นฉบับ (ภาษาอังกฤษ)
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="คัดลอกเนื้อหาตอนจากเว็บมาวางที่นี่"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !text.trim()}>
          {busy ? "กำลังบันทึก…" : "บันทึกตอน"}
        </button>
      </form>
    </>
  );
}

function Glossary({ id, data, reload }: { id: number; data: NovelDetail; reload: () => Promise<void> }) {
  const [source, setSource] = useState("");
  const [thai, setThai] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.addTerm(id, { source, thai, note });
      setSource("");
      setThai("");
      setNote("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <p className="muted">
        คำที่ตกลงไว้ จะถูกส่งให้ AI ทุกครั้งที่แปล ชื่อตัวละครและศัพท์เฉพาะจะได้ตรงกันทุกตอน
      </p>
      <ul className="list">
        {data.glossary.map((g) => (
          <li key={g.id} className="row">
            <span className="grow">
              <strong>{g.source}</strong> → {g.thai}
              {g.note && <small className="muted">{g.note}</small>}
            </span>
            <button
              className="ghost"
              aria-label={`ลบ ${g.source}`}
              onClick={async () => {
                await api.deleteTerm(g.id);
                await reload();
              }}
            >
              ✕
            </button>
          </li>
        ))}
        {data.glossary.length === 0 && <p className="muted">ยังไม่มีคำศัพท์</p>}
      </ul>

      <form className="card stack" onSubmit={add}>
        <div className="split">
          <label className="grow">
            ต้นฉบับ
            <input value={source} onChange={(e) => setSource(e.target.value)} required />
          </label>
          <label className="grow">
            คำไทย
            <input value={thai} onChange={(e) => setThai(e.target.value)} required />
          </label>
        </div>
        <label>
          หมายเหตุ (ไม่บังคับ)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ตัวเอก ผู้ชาย" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary">เพิ่มคำศัพท์</button>
      </form>
    </>
  );
}

function Settings({ id, data, reload }: { id: number; data: NovelDetail; reload: () => Promise<void> }) {
  const [title, setTitle] = useState(data.novel.title);
  const [url, setUrl] = useState(data.novel.source_url);
  const [style, setStyle] = useState(data.novel.style_note);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.updateNovel(id, { title, source_url: url, style_note: style });
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <form className="card stack" onSubmit={save}>
        <label>
          ชื่อเรื่อง
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          ลิงก์ต้นฉบับ
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </label>
        <label>
          สไตล์การแปล/เล่า
          <textarea value={style} onChange={(e) => setStyle(e.target.value)} rows={4} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary">{saved ? "บันทึกแล้ว ✓" : "บันทึก"}</button>
        {data.novel.source_url && (
          <a href={data.novel.source_url} target="_blank" rel="noreferrer noopener">
            เปิดหน้าต้นฉบับ ↗
          </a>
        )}
      </form>

      <button
        className="danger"
        onClick={async () => {
          if (!window.confirm(`ลบเรื่อง “${data.novel.title}” พร้อมทุกตอนและคำแปล? ย้อนกลับไม่ได้`)) return;
          await api.deleteNovel(id);
          location.hash = "#/";
        }}
      >
        ลบเรื่องนี้
      </button>
    </>
  );
}
