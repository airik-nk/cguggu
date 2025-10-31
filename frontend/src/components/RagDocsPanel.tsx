import React, { useEffect, useState, useCallback } from "react";
import { fetchRagDocs, deleteRagDocByDisplayName, type RagDocItem } from "../api";

const RagDocsPanel: React.FC<{ kb: string }> = ({ kb }) => {
  const [items, setItems] = useState<RagDocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRagDocs(q, { kb });
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [kb, q]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-pad" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h3 className="section-title">RAGFlow 資料庫檔案（{kb}）</h3>
          <div className="sub">直接列出 RAGFlow dataset 中的所有文件</div>
        </div>
        <input
          className="input"
          placeholder="關鍵字過濾（display_name）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 240 }}
        />
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? "查詢中…" : "重新整理"}
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th>display_name</th>
              <th style={{ width: 140 }}>狀態</th>
              <th style={{ width: 120 }}>chunks</th>
              <th style={{ width: 120 }}>enabled</th>
              <th style={{ width: 220 }}>最後更新</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="center" colSpan={7}>載入中…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="center" colSpan={7}>無資料</td></tr>
            ) : (
              items.map((d, i) => (
                <tr key={`${d.id}-${i}`}>
                  <td>{i + 1}</td>
                  <td title={d.display_name || ""}>{d.display_name || "—"}</td>
                  <td>
                    <span className={
                      "badge " + (
                        d.status === "SUCCESS" ? "ok" :
                        d.status === "PENDING" ? "muted" :
                        ""
                      )
                    }>
                      {d.status}
                    </span>
                  </td>
                  <td>{d.chunks ?? "—"}</td>
                  <td>{String(d.enabled ?? "—")}</td>
                  <td>{fmtTime(d.updated_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {d.url ? (
                      <a className="btn btn-xs" href={d.url} target="_blank" rel="noreferrer">
                        在 RAGFlow 開啟
                      </a>
                    ) : null}
                    <button
                      className="btn btn-xs danger"
                      style={{ marginLeft: 8 }}
                      onClick={async () => {
                        const name = d.display_name || "";
                        if (!name) return;
                        if (!confirm(`確定刪除 RAGFlow 上的檔案：${name}？`)) return;
                        try {
                          setBusyId(String(d.id));
                          await deleteRagDocByDisplayName(name, { kb });   // ★ 帶 kb
                          await reload();
                        } catch (e: any) {
                          alert(e?.message || String(e));
                          console.error(e);
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      disabled={busyId === String(d.id)}
                    >
                      {busyId === String(d.id) ? "刪除中…" : "刪除"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default RagDocsPanel;
