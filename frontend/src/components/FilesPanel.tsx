// src/components/FilesPanel.tsx
import React, { useEffect, useState } from "react";
import type { FileItem } from "../api/types";
import { fetchFiles } from "../api";
import { DEPARTMENTS } from '../constants';

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function FilesPanel() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<string>(DEPARTMENTS[0]);

  async function reload() {
    try {
      setLoading(true);
      const data = await fetchFiles();
      console.log('Fetched files:', data); // 添加日誌以跟踪響應
      if (!Array.isArray(data)) {
        console.error('Unexpected response format:', data);
        setItems([]);
      } else {
        setItems(data);
      }
    } catch (error) {
      console.error('Error loading files:', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  const filteredItems = items.filter(item => item.department === selectedDepartment);

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 className="section-title">文件管理系統</h3>
          <div className="sub">依處室分類顯示上傳的文件</div>
        </div>
        <button className="btn" onClick={reload} disabled={loading}>
          {loading ? "重新整理中…" : "重新整理"}
        </button>
      </div>

      <div style={{ margin: '1rem', padding: '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <label style={{ marginRight: '0.5rem' }}>選擇處室：</label>
        <select 
          value={selectedDepartment} 
          onChange={(e) => setSelectedDepartment(e.target.value)}
          style={{
            padding: '0.5rem',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
            minWidth: '150px'
          }}
        >
          {DEPARTMENTS.map((dept) => (
            <option key={dept} value={dept}>
              {dept}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{width:40}}>#</th>
              <th>檔名</th>
              <th>處室</th>
              <th style={{width:160}}>大小</th>
              <th style={{width:220}}>最後修改時間</th>
              <th style={{width:140}}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="center" colSpan={6}>載入中…</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td className="center" colSpan={6}>找不到檔案</td></tr>
            ) : (
              filteredItems.map((f, i) => (
                <tr key={f.rel_path}>
                  <td>{i + 1}</td>
                  <td title={f.rel_path}>{f.name}</td>
                  <td>{f.department}</td>
                  <td>{fmtSize(f.size)}</td>
                  <td>{new Date(f.mtime).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <a className="btn btn-xs" href={f.url} target="_blank" rel="noreferrer">預覽/下載</a>
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
