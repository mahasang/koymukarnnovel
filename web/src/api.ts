export type Mode = "translate" | "story" | "summary";

export const MODES: Mode[] = ["translate", "story", "summary"];
export const MODE_LABEL: Record<Mode, string> = {
  translate: "แปลเต็ม",
  story: "เล่าเรื่อง",
  summary: "สรุป",
};

export interface NovelRow {
  id: number;
  title: string;
  source_url: string;
  style_note: string;
  chapter_count?: number;
}
export interface ChapterRow {
  id: number;
  number: number;
  title: string;
  length: number;
  modes: Mode[];
}
export interface GlossaryRow {
  id: number;
  source: string;
  thai: string;
  note: string;
}
export interface NovelDetail {
  novel: NovelRow;
  chapters: ChapterRow[];
  glossary: GlossaryRow[];
}
export interface ChapterDetail {
  chapter: { id: number; number: number; title: string; source_text: string; recap: string | null };
  novel: { id: number; title: string };
  translations: Partial<Record<Mode, string>>;
  prev: number | null;
  next: number | null;
}

const TOKEN_KEY = "n99_token";

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("x-access-token", token);
  return headers;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    /* ไม่ใช่ JSON */
  }
  return res.statusText || `HTTP ${res.status}`;
}

function askToken(): boolean {
  const t = window.prompt("ใส่รหัสเข้าใช้งาน (ACCESS_TOKEN ที่ตั้งไว้ฝั่งเซิร์ฟเวอร์)");
  if (!t) return false;
  localStorage.setItem(TOKEN_KEY, t.trim());
  return true;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = authHeaders(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && retry && askToken()) return request<T>(path, init, false);
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  novels: () => request<NovelRow[]>("/api/novels"),
  createNovel: (b: { title: string; source_url?: string; style_note?: string }) =>
    request<NovelRow>("/api/novels", json("POST", b)),
  novel: (id: number) => request<NovelDetail>(`/api/novels/${id}`),
  updateNovel: (id: number, b: Partial<NovelRow>) => request<NovelRow>(`/api/novels/${id}`, json("PATCH", b)),
  deleteNovel: (id: number) => request<{ ok: true }>(`/api/novels/${id}`, { method: "DELETE" }),
  addChapter: (novelId: number, b: { number?: number; title?: string; text: string }) =>
    request<{ id: number; number: number }>(`/api/novels/${novelId}/chapters`, json("POST", b)),
  chapter: (id: number) => request<ChapterDetail>(`/api/chapters/${id}`),
  updateChapter: (id: number, b: { title?: string; text?: string }) =>
    request<{ ok: true }>(`/api/chapters/${id}`, json("PUT", b)),
  deleteChapter: (id: number) => request<{ ok: true }>(`/api/chapters/${id}`, { method: "DELETE" }),
  addTerm: (novelId: number, b: { source: string; thai: string; note?: string }) =>
    request<{ ok: true }>(`/api/novels/${novelId}/glossary`, json("POST", b)),
  deleteTerm: (id: number) => request<{ ok: true }>(`/api/glossary/${id}`, { method: "DELETE" }),
};

export const ERROR_MARK = "\n[[ERROR]]";

/** เรียกแปล/เล่า แล้วรับข้อความที่สตรีมกลับมาทีละส่วน */
export async function streamTranslate(
  chapterId: number,
  mode: Mode,
  force: boolean,
  onText: (chunk: string) => void,
  signal: AbortSignal,
  retry = true,
): Promise<void> {
  const headers = authHeaders({ "Content-Type": "application/json" });
  const res = await fetch(`/api/chapters/${chapterId}/translate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode, force }),
    signal,
  });
  if (res.status === 401 && retry && askToken()) {
    return streamTranslate(chapterId, mode, force, onText, signal, false);
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  if (!res.body) throw new Error("เบราว์เซอร์นี้ไม่รองรับการรับข้อความแบบสตรีม");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(decoder.decode(value, { stream: true }));
  }
}
