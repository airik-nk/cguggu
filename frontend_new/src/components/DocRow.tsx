import { useEffect, useMemo, useState } from "react";
import type { DocumentDTO, DocumentVersionDTO, RagStatus } from "../api/types";
import { deleteDoc, toggleVersion, getRagStatus } from "../api";

type Props = {
  kb: string;
  doc: DocumentDTO;
  latest: DocumentVersionDTO | null;
  onChanged: () => void;
};

type ChunkMethod =
  | "naive"         // General
  | "qa"            // Q&A
  | "resume"        // Resume
  | "manual"        // Manual
  | "paper"         // Paper
  | "book"          // Book
  | "laws"          // Laws
  | "presentation"; // Presentation
// 如需更多： "table" | "one" | "tag" | "picture" | "email"

const labelOf = (m?: string) => ({
  naive: "General",
  qa: "Q&A",
  resume: "Resume",
  manual: "Manual",
  paper: "Paper",
  book: "Book",
  laws: "Laws",
  presentation: "Presentation",
  table: "Table",
  one: "One",
  tag: "Tag",
  picture: "Picture",
  email: "Email",
}[String(m || "").toLowerCase()] || m || "");

async function safeFetchJSON(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text(); // 先取文字，避免空回應時 .json() 爆掉
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!resp.ok) {
    const msg = (data && (data.error || data.message)) || `${resp.status} ${resp.statusText}`;
    throw new Error(msg);
  }
  return data || {};
}

export function DocRow({ kb, doc, latest, onChanged }: Props) {
  const [rag, setRag] = useState<RagStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  // ───────────────────────── Chunking 設定 ─────────────────────────
  const [cfgOpen, setCfgOpen] = useState(false);
  const [mtd, setMtd] = useState<ChunkMethod>("naive");
  const [saving, setSaving] = useState(false);

  const chunkMethod = useMemo(
    () => (rag && ((rag as any).chunk_method || (rag as any).chunking_method)) as string | undefined,
    [rag]
  );

  async function onToggle() {
    if (!latest) return;
    try {
      await toggleVersion(latest.id);
      onChanged();
    } catch (e: any) {
      alert(e?.message || "切換失敗");
    }
  }

  async function onDelete() {
    if (!confirm(`確定刪除「${doc.title}」及其所有版本？`)) return;
    try {
      await deleteDoc(doc.id, { kb });
      onChanged();
    } catch (e: any) {
      alert(e?.message || "刪除失敗");
    }
  }

  async function refreshRag() {
    try {
      setChecking(true);
      const s = await getRagStatus(doc.id, { kb });
      setRag(s);
    } catch (e: any) {
      console.warn("RAG status error:", e?.message);
      setRag({ found: false, status: "ERROR" } as RagStatus);
    } finally {
      setChecking(false);
    }
  }

  // 重新觸發（使用目前預設 chunk_method）
  async function doResync() {
    try {
      setResyncing(true);
      const data = await safeFetchJSON(`/api/docs/${doc.id}/ragflow/resync?kb=${encodeURIComponent(kb)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!data?.success) throw new Error(data?.error || "重觸發失敗");
      alert("已重新觸發解析");
      refreshRag();
    } catch (e: any) {
      alert(e?.message || "重觸發失敗");
    } finally {
      setResyncing(false);
    }
  }

  // 保存為文件預設並重解析（官方支援的方式）
  async function saveChunkingAndReparse() {
    try {
      setSaving(true);
      const payload = { chunking_method: mtd, reparse: true }; // 後端會轉為 chunk_method 並重跑
      const data = await safeFetchJSON(`/api/docs/${doc.id}/ragflow/chunking?kb=${encodeURIComponent(kb)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!data?.success) throw new Error(data?.error || "保存失敗");
      alert("已保存為預設並重新解析。");
      setCfgOpen(false);
      refreshRag();
    } catch (e: any) {
      alert(e?.message || "保存失敗");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (latest) refreshRag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, kb]);

  useEffect(() => {
    if (cfgOpen) {
      setMtd(((chunkMethod || "naive") as ChunkMethod));
    }
  }, [cfgOpen, chunkMethod]);

  const ragClass =
    rag?.status === "SUCCESS"
      ? "badge ok"
      : rag?.status === "PENDING"
      ? "badge muted"
      : rag?.status === "ERROR"
      ? "badge"
      : "badge muted";

  const chunkTag = chunkMethod ? ` · ${labelOf(chunkMethod)}` : "";

  return (
    <tr>
      <td className="px-3 py-2">{doc.date_issued}</td>
      <td className="px-3 py-2 text-sm text-gray-600">{doc.doc_no}</td>
      <td className="px-3 py-2 text-sm text-gray-600">{doc.title}</td>
      <td className="px-3 py-2">
        {latest ? (
          <div className="text-sm">
            <div className="text-xs text-gray-500">{doc.department}</div>
          </div>
        ) : (
          <span className="text-xs text-gray-400">尚無版本</span>
        )}
      </td>

      <td className="px-3 py-2">
        {latest && (
          <span
            className={
              "inline-flex items-center px-2 py-1 rounded-full text-xs " +
              (latest.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")
            }
          >
            {latest.is_active ? "生效" : "失效"}
          </span>
        )}
      </td>

      <td className="px-3 py-2">
        {latest ? (
          <span className={ragClass}>
            RAG {checking ? "檢查中…" : rag?.status || "—"}
            {rag?.chunks != null ? ` · ${rag.chunks}片` : ""}
            {chunkTag}
          </span>
        ) : (
          <span className="badge muted">—</span>
        )}
        {latest && (
          <span style={{ marginLeft: 8, display: "inline-flex", gap: 6 }}>
            <button onClick={refreshRag} className="btn btn-xs">重新整理</button>
            <button onClick={doResync} className="btn btn-xs" disabled={resyncing}>
              {resyncing ? "重觸發中…" : "重觸發"}
            </button>
            <button onClick={() => setCfgOpen(true)} className="btn btn-xs">
              調整分段
            </button>
            {(rag as any)?.url && (
              <a href={(rag as any).url} target="_blank" rel="noreferrer" className="btn btn-xs">
                在 RAGFlow 開啟
              </a>
            )}
          </span>
        )}

        {/* ───────────────────────── Chunking 設定彈窗 ───────────────────────── */}
        {cfgOpen && (
          <div className="modal" onClick={() => (!saving && setCfgOpen(false))}>
            <div className="panel" onClick={(e) => e.stopPropagation()}>
              <h3 className="section-title" style={{ marginBottom: 8 }}>
                調整分段方式（{doc.title}）
              </h3>

              <div className="grid" style={{ marginTop: 6 }}>
                <label className="row">
                  <span>方法</span>
                  <select className="input" value={mtd} onChange={(e) => setMtd(e.target.value as ChunkMethod)}>
                    <option value="naive">General</option>
                    <option value="qa">Q&A</option>
                    <option value="resume">Resume</option>
                    <option value="manual">Manual</option>
                    <option value="paper">Paper</option>
                    <option value="book">Book</option>
                    <option value="laws">Laws</option>
                    <option value="presentation">Presentation</option>
                  </select>
                </label>

                <div className="row-end" style={{ gridColumn: "1 / -1", marginTop: 6 }}>
                  <button className="btn" onClick={() => setCfgOpen(false)} disabled={saving}>取消</button>
                  <button className="btn btn-primary" onClick={saveChunkingAndReparse} disabled={saving}>
                    {saving ? "保存中…" : "保存為預設並重新解析"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </td>

      <td className="px-3 py-2">
        <div className="flex gap-2 justify-end">
          {latest && (
            <button onClick={onToggle} className="btn btn-xs">
              切換狀態
            </button>
          )}
          <button onClick={onDelete} className="btn btn-xs btn-danger">
            刪除
          </button>
        </div>
      </td>
    </tr>
  );
}
