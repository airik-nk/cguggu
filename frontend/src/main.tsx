// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import App from "./App";
import "./index.css";

/** 環境變數：後端 API base（與 api.ts 一致的寫法） */
const API_BASE = import.meta.env.VITE_API_BASE || "";

/** 從 /api/ragflow/kb 取得的資料型態（就地宣告，避免外部型別未同步時報錯） */
type KbInfo = {
  id?: string | null;
  name: string;
  description?: string | null;
  doc_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** ───────────────────────── Error Boundary（防呆） ───────────────────────── */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err?: any }> {
  constructor(props: any) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(error: any) {
    return { err: error };
  }
  componentDidCatch(error: any, info: any) {
    // 這裡可加上錯誤上報
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="container" style={{ padding: 24 }}>
          <header className="header" style={{ marginBottom: 12 }}>
            <h1 className="h1">發生錯誤</h1>
            <div className="sub">前端執行時發生未捕捉例外，請查看 Console。</div>
          </header>
          <pre style={{ whiteSpace: "pre-wrap", color: "#b91c1c" }}>
            {String(this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/** ───────────────────────── KB 選單（動態同步 RAGFlow datasets） ───────────────────────── */
function KbMenu() {
  const [items, setItems] = React.useState<KbInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");

  async function fetchKbList(keyword?: string) {
    const u = new URL(`${API_BASE}/api/ragflow/kb`, location.origin);
    if (keyword && keyword.trim()) u.searchParams.set("q", keyword.trim());
    u.searchParams.set("limit", "200");
    const res = await fetch(u.toString());
    const text = await res.text();
    if (!res.ok) {
      // 後端若有結構化錯誤就盡量解出來
      try {
        const j = JSON.parse(text);
        throw new Error(j?.error_message || j?.message || `HTTP ${res.status}: ${res.statusText}`);
      } catch {
        throw new Error(text || `HTTP ${res.status}: ${res.statusText}`);
      }
    }
    try {
      return JSON.parse(text) as KbInfo[];
    } catch {
      return [] as KbInfo[];
    }
  }

  async function reload() {
    try {
      setErr(null);
      setLoading(true);
      const data = await fetchKbList(q);
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    reload(); // 初次載入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container" style={{ padding: 24 }}>
      <header className="header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="h1">Choose a Knowledge Base</h1>
          <div className="sub">資料來源直接同步自 RAGFlow</div>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="搜尋 dataset 名稱"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 260 }}
          />
          <button className="btn" onClick={reload} disabled={loading}>
            {loading ? "查詢中…" : "搜尋 / 重新整理"}
          </button>
        </div>
      </header>

      {err ? (
        <div className="card-pad" style={{ color: "#b91c1c", marginBottom: 12 }}>
          <div className="sub" style={{ whiteSpace: "pre-wrap" }}>讀取 RAGFlow 失敗：{err}</div>
          <div className="sub">
            （你仍可手動前往 <Link to="/kb/Regulation">Regulation</Link> 試用）
          </div>
        </div>
      ) : null}

      <section
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}
      >
        {loading ? (
          <div className="card"><div className="card-pad">載入中…</div></div>
        ) : items.length === 0 ? (
          <div className="card"><div className="card-pad">RAGFlow 目前沒有 dataset</div></div>
        ) : (
          items.map((ds) => (
            <Link
              key={ds.id || ds.name}
              to={`/kb/${encodeURIComponent(ds.name)}`}
              className="card"
              style={{ textDecoration: "none" }}
            >
              <div className="card-pad">
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{ds.name}</div>
                <div className="sub" style={{ marginBottom: 8 }}>
                  {ds.description || "（無描述）"}
                </div>
                <div className="sub" style={{ display: "flex", gap: 12 }}>
                  <span>📄 {ds.doc_count ?? "—"} files</span>
                  <span>🕒 {ds.updated_at ? new Date(ds.updated_at).toLocaleString() : "—"}</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

/** ───────────────────────── Render ───────────────────────── */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* 使用 HashRouter，避免伺服器未設置 SPA fallback 時刷新子路由變空白 */}
      <HashRouter>
        <Routes>
          {/* 預設導向 KB 選單 */}
          <Route path="/" element={<Navigate to="/kb" replace />} />

          {/* KB 選單（動態） */}
          <Route path="/kb" element={<KbMenu />} />

          {/* KB 作用域頁：/kb/:name → App（App.tsx 會從 useParams 讀取 name 當 kb） */}
          <Route path="/kb/:name" element={<App />} />

          {/* 舊連結相容：/reg → /kb/Regulation */}
          <Route path="/reg" element={<Navigate to="/kb/Regulation" replace />} />

          {/* 未匹配 → KB 選單，避免空白頁 */}
          <Route path="*" element={<Navigate to="/kb" replace />} />
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
