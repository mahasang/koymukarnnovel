import { useEffect, useRef, useState } from "react";
import { ERROR_MARK, MODES, MODE_LABEL, api, streamTranslate, type ChapterDetail, type Mode } from "../api";
import { useSpeech } from "../useSpeech";

const FONT_KEY = "n99_font";

export default function Reader({ id }: { id: number }) {
  const [data, setData] = useState<ChapterDetail | null>(null);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem("n99_mode") as Mode) || "translate");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [font, setFont] = useState(() => Number(localStorage.getItem(FONT_KEY)) || 19);
  const abortRef = useRef<AbortController | null>(null);
  const speech = useSpeech();

  // โหลดตอน
  useEffect(() => {
    let alive = true;
    api
      .chapter(id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setText(d.translations[mode] ?? "");
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // เปลี่ยนโหมด: แสดงของที่แปลไว้แล้ว (ถ้ามี)
  useEffect(() => {
    localStorage.setItem("n99_mode", mode);
    speech.stop();
    if (data && !busy) setText(data.translations[mode] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, String(font));
  }, [font]);

  async function run(force: boolean) {
    if (!data || busy) return;
    speech.stop();
    setBusy(true);
    setError("");
    setText("");
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    let failure = "";
    try {
      await streamTranslate(
        id,
        mode,
        force,
        (chunk) => {
          acc += chunk;
          const at = acc.indexOf(ERROR_MARK);
          if (at >= 0) {
            failure = acc.slice(at + ERROR_MARK.length).trim();
            setText(acc.slice(0, at));
          } else {
            setText(acc);
          }
        },
        ac.signal,
      );
      if (failure) {
        setError(failure);
      } else {
        setData((d) => (d ? { ...d, translations: { ...d.translations, [mode]: acc } } : d));
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  if (error && !data) {
    return (
      <main className="page">
        <a href="#/">‹ กลับ</a>
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!data) return <main className="page muted">กำลังโหลด…</main>;

  const { chapter, novel } = data;
  const cached = data.translations[mode] !== undefined;

  return (
    <main className="page reader">
      <header className="topbar">
        <a href={`#/novel/${novel.id}`} className="back">
          ‹
        </a>
        <div className="grow">
          <h1>
            ตอนที่ {chapter.number}
            {chapter.title ? ` · ${chapter.title}` : ""}
          </h1>
          <small className="muted">{novel.title}</small>
        </div>
      </header>

      <nav className="tabs">
        {MODES.map((m) => (
          <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)} disabled={busy}>
            {MODE_LABEL[m]}
            {data.translations[m] !== undefined ? " ✓" : ""}
          </button>
        ))}
      </nav>

      <div className="toolbar">
        {busy ? (
          <button className="danger" onClick={stopGenerating}>
            หยุด
          </button>
        ) : cached ? (
          <button onClick={() => run(true)}>แปลใหม่</button>
        ) : (
          <button className="primary" onClick={() => run(false)}>
            {mode === "translate" ? "แปลตอนนี้" : mode === "story" ? "เล่าตอนนี้" : "สรุปตอนนี้"}
          </button>
        )}

        {text && !busy && (
          <>
            {speech.state === "idle" && <button onClick={() => speech.play(text)}>🔊 ฟัง</button>}
            {speech.state === "playing" && <button onClick={speech.pause}>⏸ พัก</button>}
            {speech.state === "paused" && <button onClick={speech.resume}>▶ ต่อ</button>}
            {speech.state !== "idle" && <button onClick={speech.stop}>⏹</button>}
          </>
        )}

        <span className="grow" />
        <button className="ghost" aria-label="ลดขนาดตัวอักษร" onClick={() => setFont((f) => Math.max(14, f - 1))}>
          A−
        </button>
        <button className="ghost" aria-label="เพิ่มขนาดตัวอักษร" onClick={() => setFont((f) => Math.min(32, f + 1))}>
          A+
        </button>
      </div>

      {speech.state !== "idle" && (
        <label className="rate">
          ความเร็วเสียง {speech.rate.toFixed(1)}×
          <input
            type="range"
            min="0.6"
            max="1.6"
            step="0.1"
            value={speech.rate}
            onChange={(e) => speech.setRate(Number(e.target.value))}
          />
        </label>
      )}
      {speech.unsupported && <p className="muted">เบราว์เซอร์นี้ไม่มีเสียงอ่านภาษาไทย</p>}

      {error && <p className="error">{error}</p>}

      <article className="prose" style={{ fontSize: font }}>
        {text ? (
          text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
        ) : busy ? (
          <p className="muted">กำลังเริ่ม…</p>
        ) : (
          <p className="muted">ยังไม่ได้{MODE_LABEL[mode]} กดปุ่มด้านบนเพื่อเริ่ม</p>
        )}
        {busy && <span className="cursor" aria-hidden />}
      </article>

      <details className="card" open={showSource} onToggle={(e) => setShowSource(e.currentTarget.open)}>
        <summary>ต้นฉบับ</summary>
        <div className="source">
          {chapter.source_text.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </details>

      <footer className="pager">
        <button disabled={!data.prev || busy} onClick={() => (location.hash = `#/chapter/${data.prev}`)}>
          ‹ ตอนก่อน
        </button>
        <button disabled={!data.next || busy} onClick={() => (location.hash = `#/chapter/${data.next}`)}>
          ตอนถัดไป ›
        </button>
      </footer>
    </main>
  );
}
