import { useEffect, useState } from "react";
import { fetchRagDocs } from "../api/index";
import type { RagDocItem } from "../api/types";
import { fmtTime } from "../utils";

export default function RecentUploadsPanel({ kb }: { kb: string }) {
  const [items, setItems] = useState<RagDocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      setErr(null);
      setLoading(true);
      // 直接抓 RAGFlow：當前 KB 的最新 10 筆
      const data = await fetchRagDocs(undefined, { kb, limit: 10 });
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [kb]);

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-pad" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <h3 className="section-title">最近上傳（{kb}，RAGFlow 最新 10 筆）</h3>
          <div className="sub">資料直接來自 RAGFlow，無需本地資料庫</div>
        </div>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? "重新整理中…" : "重新整理"}
        </button>
      </div>

      {err ? (
        <div className="card-pad" style={{ color: "#b91c1c", whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th>名稱（display_name）</th>
              <th style={{ width: 140 }}>解析狀態</th>
              <th style={{ width: 180 }}>時間</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="center" colSpan={5}>載入中…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="center" colSpan={5}>此 KB 目前沒有最近上傳</td></tr>
            ) : (
              items.map((d, i) => (
                <tr key={`${d.id ?? d.display_name}-${i}`}>
                  <td>{i + 1}</td>
                  <td title={d.display_name || ""}>{d.display_name || "—"}</td>
                  <td>
                    <span className={
                      "badge " + (d.status === "SUCCESS" ? "ok" : d.status === "PENDING" ? "muted" : "")
                    }>
                      {d.status || "UNKNOWN"}
                    </span>
                  </td>
                  <td>{fmtTime(d.updated_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {d.url ? (
                      <a className="btn btn-xs" href={d.url} target="_blank" rel="noreferrer">
                        在 RAGFlow 開啟
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
    