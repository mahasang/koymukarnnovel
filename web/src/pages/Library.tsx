import { useEffect, useState, type FormEvent } from "react";
import { api, type NovelRow } from "../api";

export default function Library() {
  const [novels, setNovels] = useState<NovelRow[] | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [style, setStyle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api
      .novels()
      .then(setNovels)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const n = await api.createNovel({ title, source_url: url, style_note: style });
      location.hash = `#/novel/${n.id}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>📖 Novel 99</h1>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>นิยายของฉัน</h2>
        {novels === null && !error && <p className="muted">กำลังโหลด…</p>}
        {novels?.length === 0 && <p className="muted">ยังไม่มีเรื่อง เพิ่มเรื่องแรกด้านล่างได้เลย</p>}
        <ul className="list">
          {novels?.map((n) => (
            <li key={n.id}>
              <a className="row" href={`#/novel/${n.id}`}>
                <span className="grow">
                  <strong>{n.title}</strong>
                  <small className="muted">{n.chapter_count ?? 0} ตอน</small>
                </span>
                <span aria-hidden>›</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>เพิ่มเรื่องใหม่</h2>
        <form className="card stack" onSubmit={onSubmit}>
          <label>
            ชื่อเรื่อง
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ชื่อนิยาย" required />
          </label>
          <label>
            ลิงก์ต้นฉบับ (ไว้จำเฉยๆ ไม่บังคับ)
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          </label>
          <label>
            สไตล์การแปล/เล่า (ไม่บังคับ)
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              rows={3}
              placeholder="เช่น แนวแฟนตาซีจีนกำลังภายใน ใช้ภาษากึ่งโบราณ เรียกตัวเอกว่า “เขา”"
            />
          </label>
          <button className="primary" disabled={saving}>
            {saving ? "กำลังบันทึก…" : "เพิ่มเรื่อง"}
          </button>
        </form>
      </section>
    </main>
  );
}
