// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchDocs, fetchRagDocs, deleteRagDocByDisplayName } from "./api";
import type { DocsListItem, RagDocItem } from "./api/types";
import { DEPARTMENTS } from './constants';
import UploadDialog from "./components/UploadDialog";
import BulkImportDialog from "./components/BulkImportDialog";
import { DocRow } from "./components/DocRow";
import RecentUploadsPanel from "./components/RecentUploadsPanel"; // ★ 新增：最近上傳面板

// Using type from ./api/types

function fmtTime(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleString();
}

export default function App() {
  const { name } = useParams();
  const kb = (name || "Regulation").trim(); // default for compatibility

  /** ──────────── Documents（DocRow） ──────────── */
  const [items, setItems] = useState<DocsListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");

  // 處室過濾
  const filteredDocs = useMemo(() => 
    items.filter(item => 
      selectedDepartment === "all" || 
      item.doc.department === selectedDepartment
    ),
    [items, selectedDepartment]
  );

  // 分頁：文件
  const [docPage, setDocPage] = useState(1);
  const docPageSize = 10;
  const docPageCount = Math.ceil(items.length / docPageSize) || 1;
  const docPageItems = useMemo(
    () => items.slice((docPage - 1) * docPageSize, docPage * docPageSize),
    [items, docPage]
  );

  async function reloadDocs() {
    try {
      setErr(null);
      setLoading(true);
      const data = await fetchDocs({ kb });
      setItems(data || []);
      setDocPage(1); // 回到第一頁
    } catch (e: any) {
      setErr(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  /** ──────────── RAGFlow docs（ragdoc） ──────────── */
  const [ragItems, setRagItems] = useState<RagDocItem[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragQ, setRagQ] = useState("");
  const [ragBusyId, setRagBusyId] = useState<string | null>(null);

  // 分頁：RAG
  const [ragPage, setRagPage] = useState(1);
  const ragPageSize = 10;
  const ragPageCount = Math.ceil(ragItems.length / ragPageSize) || 1;
  const ragPageItems = useMemo(
    () => ragItems.slice((ragPage - 1) * ragPageSize, ragPage * ragPageSize),
    [ragItems, ragPage]
  );

  // 後端「完全相符 display_name」查詢
  async function findExactMatches(displayName: string): Promise<any[]> {
    try {
      const url =
        `/api/ragflow/docs/matches?name=${encodeURIComponent(displayName)}` +
        `&kb=${encodeURIComponent(kb)}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      return Array.isArray(json?.matches) ? json.matches : [];
    } catch {
      return [];
    }
  }

  async function reloadRag() {
    setRagLoading(true);
    try {
      const q = (ragQ || "").trim();
      let data: RagDocItem[] = [];

      if (!q) {
        // 無關鍵字：直接列全清單
        data = await fetchRagDocs(undefined, { kb });
      } else {
        // 先走「完全相符」
        const exact = await findExactMatches(q);
        if (exact.length > 0) {
          // 為了拿到完整欄位（狀態 / chunks / url …），仍用原本列表 API 取回後過濾
          const all = await fetchRagDocs(q, { kb });
          const idset = new Set(exact.map((m: any) => String(m.id)));
          data = (all || []).filter(
            (d: any) => idset.has(String(d.id)) || d.display_name === q
          );
        } else {
          // 找不到精準命中：退回模糊搜尋（關鍵字包含）
          data = await fetchRagDocs(q, { kb });
        }
      }

      setRagItems(data || []);
      setRagPage(1);
    } catch (e) {
      // 任意錯誤：退回模糊搜尋，避免中斷流程
      try {
        const data = await fetchRagDocs(ragQ, { kb });
        setRagItems(data || []);
        setRagPage(1);
      } catch (err) {
        console.error(err);
        setRagItems([]);
      }
    } finally {
      setRagLoading(false);
    }
  }

  // ★ 最近上傳面板的刷新觸發（用 key 重新掛載）
  const [recentTick, setRecentTick] = useState(0);
  const bumpRecent = () => setRecentTick((t) => t + 1);

  useEffect(() => {
    // kb 變更時重載兩個清單
    reloadDocs();
    reloadRag();
    bumpRecent(); // 切換 KB 時也刷新「最近上傳」面板（一般是全域 10 筆，不過讓它重撈較保險）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kb]);

  return (
    <div className="container" key={kb /* 切 KB 強制 remount，避免殘留狀態 */}>
      <header className="header">
        <div>
          <h1 className="h1">{kb} — 文件中心</h1>
          <div className="sub">Upload · Versioning · Toggle · Delete</div>
        </div>
        <BulkImportDialog
          kb={kb}
          onDone={() => {
            reloadDocs();
            reloadRag();
            bumpRecent(); // ★ 批次匯入完成後刷新最近上傳
          }}
        />
        <UploadDialog
          kb={kb}
          onDone={() => {
            reloadDocs();
            reloadRag();
            bumpRecent(); // ★ 單檔上傳完成後刷新最近上傳
          }}
        />
      </header>

      {/* ───────────────── 文件清單（DocRow，分頁 10 筆） ───────────────── */}
      <section className="card">
        <div className="card-pad">
          <h3 className="section-title">上傳文件</h3>
          <div className="sub">支援 PDF，上傳後會自動建立版本紀錄</div>
        </div>

        {err ? (
          <div className="card-pad" style={{ color: "#b91c1c" }}>
            <div className="sub" style={{ whiteSpace: "pre-wrap" }}>
              發生錯誤：{err}
            </div>
          </div>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  公布/公告日期
                  <br />
                  Date issued
                </th>
                <th>
                  規章編號
                  <br />
                  No.
                </th>
                <th>
                  規章名稱
                  <br />
                  Title
                </th>
                <th>
                  制定單位
                  <br />
                  Department
                </th>
                <th>狀態</th>
                <th>解析狀態</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="center" colSpan={7}>
                    載入中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="center" colSpan={7}>
                    尚無文件
                  </td>
                </tr>
              ) : (
                docPageItems.map(({ doc, latest }) => (
                  <DocRow
                    key={doc.id}
                    kb={kb}
                    doc={doc}
                    latest={latest}
                    onChanged={() => {
                      reloadDocs();
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {items.length > 0 && (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            <button
              className="btn btn-xs"
              disabled={docPage <= 1}
              onClick={() => setDocPage((p) => Math.max(1, p - 1))}
            >
              上一頁
            </button>
            <span className="sub">
              第 {docPage} / {docPageCount} 頁（共 {items.length} 筆）
            </span>
            <button
              className="btn btn-xs"
              disabled={docPage >= docPageCount}
              onClick={() => setDocPage((p) => Math.min(docPageCount, p + 1))}
            >
              下一頁
            </button>
          </div>
        )}
      </section>

      {/* ───────────────── RAGFlow 檔案（分頁 10 筆） ───────────────── */}
      <section className="card" style={{ marginTop: 18 }}>
        <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="section-title">文件清單</h3>
            <div className="sub">所有已上傳的文件</div>
          </div>
          <div style={{display: "flex", gap: "1rem", alignItems: "center"}}>
            <select
              className="input"
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              style={{minWidth: "120px"}}
            >
              <option value="all">所有處室</option>
              {DEPARTMENTS.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </div>
          <input
            className="input"
            placeholder="輸入 display_name（完整檔名可精準比對）"
            value={ragQ}
            onChange={(e) => setRagQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") reloadRag();
            }}
            style={{ width: 240 }}
          />
          <button className="btn" onClick={reloadRag} disabled={ragLoading}>
            {ragLoading ? "查詢中…" : "重新整理"}
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
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {ragLoading ? (
                <tr>
                  <td className="center" colSpan={7}>
                    載入中…
                  </td>
                </tr>
              ) : ragItems.length === 0 ? (
                <tr>
                  <td className="center" colSpan={7}>
                    無資料
                  </td>
                </tr>
              ) : (
                ragPageItems.map((d, i) => (
                  <tr key={`${d.id}-${i}`}>
                    <td>{(ragPage - 1) * ragPageSize + i + 1}</td>
                    <td title={d.display_name || ""}>{d.display_name || "—"}</td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (d.status === "SUCCESS"
                            ? "ok"
                            : d.status === "PENDING"
                            ? "muted"
                            : "")
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                    <td>{d.Chunk_Number ?? "—"}</td>
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
                            setRagBusyId(String(d.id || name));
                            await deleteRagDocByDisplayName(name, { kb });
                            await reloadRag();
                          } catch (e: any) {
                            alert(e?.message || String(e));
                            console.error(e);
                          } finally {
                            setRagBusyId(null);
                          }
                        }}
                        disabled={ragBusyId === String(d.id || d.display_name)}
                      >
                        {ragBusyId === String(d.id || d.display_name) ? "刪除中…" : "刪除"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {ragItems.length > 0 && (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            <button
              className="btn btn-xs"
              disabled={ragPage <= 1}
              onClick={() => setRagPage((p) => Math.max(1, p - 1))}
            >
              上一頁
            </button>
            <span className="sub">
              第 {ragPage} / {ragPageCount} 頁（共 {ragItems.length} 筆）
            </span>
            <button
              className="btn btn-xs"
              disabled={ragPage >= ragPageCount}
              onClick={() => setRagPage((p) => Math.min(ragPageCount, p + 1))}
            >
              下一頁
            </button>
          </div>
        )}
      </section>

      {/* ───────────────── 最近上傳（本地僅保留 10 筆） ───────────────── */}
        <RecentUploadsPanel key={recentTick} kb={kb} /> {/* ★ 掛上面板；用 key 觸發重新載入 */}
    </div>
  );
}
