// src/components/BulkFolderUpload.tsx
import React, { useRef, useState } from "react";
import { uploadDoc } from "../api";
import { DEPARTMENTS, Department } from "../constants";

type ManifestRow = {
  filename: string;      // 原始檔名
  displayName: string;   // 法規名稱
  lastUpdate?: string;   // YYYY-MM-DD（若解析不到就原樣）
  department: Department; // 處室名稱，必填
};

// 驗證 CSV 必要欄位
function validateCsvFields(headers: string[]): string[] {
  const requiredFields = ['filename', 'department', 'displayName'];
  return requiredFields.filter(field => 
    !headers.some(h => normalizeHeader(h).includes(normalizeHeader(field)))
  );
}

// 生成新檔名
function generateNewFileName(department: Department, displayName: string, originalExt: string): string {
  const baseName = displayName.trim().replace(/[\\/:*?"<>|]/g, '-');
  return `${department}-${baseName}${originalExt}`;
}

type Props = {
  kb?: string;                  // dataset
  onBusy?: (busy: boolean) => void;
  onDone?: () => void;
};

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "").replace(/[^\w\u4e00-\u9fff]/g, "");
}
function pickHeader(headers: string[], candidates: string[]) {
  const idx = new Map(headers.map((h, i) => [normalizeHeader(h), i]));
  for (const c of candidates) {
    const i = idx.get(normalizeHeader(c));
    if (i !== undefined) return headers[i];
  }
  return null;
}

// 簡易 CSV 解析（UTF-8 BOM/引號/逗號/\r\n）
function parseCSV(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0, inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; }
        else { inQuotes = false; i += 1; }
      } else { cell += ch; i += 1; }
    } else {
      if (ch === '"') { inQuotes = true; i += 1; }
      else if (ch === ",") { row.push(cell); cell = ""; i += 1; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; }
      else if (ch === "\r") { i += 1; if (text[i] === "\n") i += 1; row.push(cell); rows.push(row); row = []; cell = ""; }
      else { cell += ch; i += 1; }
    }
  }
  row.push(cell); rows.push(row);
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === "")) rows.pop();
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => obj[h] = r[j] ?? "");
    return obj;
  });
}

// 2025/2/27、2025-02-27 → YYYY-MM-DD；其它原樣
function normalizeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim(); if (!t) return undefined;
  const m = t.replace(/[.]/g, "/").replace(/-/g, "/").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return t;
  const y = m[1], mm = String(parseInt(m[2], 10)).padStart(2, "0"), dd = String(parseInt(m[3], 10)).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

const BulkFolderUpload: React.FC<Props> = ({ kb, onBusy, onDone }) => {
  const [status, setStatus] = useState<"idle"|"ready"|"uploading"|"done"|"error">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addLog = (s: string) => setLog(prev => [...prev, s]);

  // 處理上傳的文件
  async function processUpload(files: File[], manifest: ManifestRow[]) {
    setStatus("uploading");
    if (onBusy) onBusy(true);

    try {
      let uploadedCount = 0;
      setProgress({ done: uploadedCount, total: manifest.length });

      for (const row of manifest) {
        try {
          // 找到對應的文件
          const file = files.find(f => f.name === row.filename);
          if (!file) {
            addLog(`❌ 找不到檔案：${row.filename}`);
            continue;
          }

          // 建立新的檔案名稱
          const ext = row.filename.split('.').pop() || '';
          const newFileName = `${row.department}-${row.displayName}.${ext}`;

          // 建立 FormData
          const formData = new FormData();
          const newFile = new File([file], newFileName, { type: file.type });
          formData.append('file', newFile);
          formData.append('department', row.department);
          formData.append('title', row.displayName);
          if (kb) formData.append('kb', kb);

          // 上傳檔案
          await uploadDoc(formData);
          addLog(`✅ 已上傳：${newFileName}`);
          uploadedCount++;
          setProgress({ done: uploadedCount, total: manifest.length });
        } catch (err) {
          addLog(`❌ 上傳失敗 ${row.filename}：${err}`);
        }
      }

      setStatus("done");
      if (onDone) onDone();
    } catch (err) {
      setStatus("error");
      addLog(`❌ 處理失敗：${err}`);
    } finally {
      if (onBusy) onBusy(false);
    }
  }

  async function handlePickFolder(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;

    setStatus("ready");
    setLog([]);
    setProgress({ done: 0, total: 0 });

    try {
      // 1) 找 CSV（manifest.csv 優先）
      let csvFile = files.find(f => /(^|\/)manifest\.csv$/i.test(f.name));
      if (!csvFile) csvFile = files.find(f => f.name.toLowerCase().endsWith('.csv'));
      if (!csvFile) {
        addLog("❌ 找不到 CSV 檔案");
        setStatus("error");
        return;
      }

      // 2) 解析 CSV
      const csvText = await csvFile.text();
      const rows = parseCSV(csvText);
      if (!rows.length) {
        addLog("❌ CSV 檔案是空的");
        setStatus("error");
        return;
      }

      // 3) 驗證 CSV 欄位
      const headers = Object.keys(rows[0]);
      const missingFields = validateCsvFields(headers);
      if (missingFields.length > 0) {
        addLog(`❌ CSV 缺少必要欄位：${missingFields.join(", ")}`);
        setStatus("error");
        return;
      }

      // 4) 處理每一行資料
      const manifest: ManifestRow[] = [];
      for (const row of rows) {
        try {
          const department = row.department?.trim();
          if (!department || !DEPARTMENTS.includes(department as Department)) {
            throw new Error(`無效的處室名稱：${department}`);
          }

          manifest.push({
            filename: row.filename,
            displayName: row.displayName,
            department: department as Department,
            lastUpdate: normalizeDate(row.lastUpdate)
          });
        } catch (err) {
          addLog(`❌ 資料格式錯誤：${err}`);
          return;
        }
      }

      // 5) 開始上傳
      await processUpload(files, manifest);

    } catch (err) {
      addLog(`❌ 處理失敗：${err}`);
      setStatus("error");
    }
    let csv = files.find(f => /(^|\/)manifest\.csv$/i.test((f as any).webkitRelativePath || f.name));
    if (!csv) csv = files.find(f => f.name.toLowerCase().endsWith(".csv"));
    if (!csv) { setStatus("error"); addLog("找不到 CSV（請在資料夾內放 manifest.csv 或任何 .csv）"); return; }

    // 2) 解析 CSV
    const rows = parseCSV(await csv.text());
    if (!rows.length) { setStatus("error"); addLog("CSV 內容為空"); return; }
    const headers = Object.keys(rows[0]);

    // 3) 對應欄位
    const H_NAME = pickHeader(headers, ["法規名稱","名稱","display_name","name"]);
    const H_FILE = pickHeader(headers, ["檔名","檔案","檔案名稱","filename","file"]);
    const H_DATE = pickHeader(headers, ["最後更新日期","更新日期","last_update","updated_at","date"]);
    const H_DEPT = pickHeader(headers, ["處室","部門","department"]);

    if (!H_NAME || !H_FILE || !H_DEPT) {
      setStatus("error");
      addLog(`CSV 缺少必要欄位（法規名稱／檔名／處室）。目前偵測到欄位：${headers.join(", ")}`);
      return;
    }

    // 4) 檔案 map（相對路徑、檔名）
    const mapByRel = new Map<string, File>();
    const mapByBase = new Map<string, File>();
    for (const f of files) {
      const rel = (f as any).webkitRelativePath || f.name;
      const relNoTop = rel.replace(/^[^/\\]+[\/\\]/, "");
      mapByRel.set(relNoTop, f);
      mapByBase.set(f.name, f);
    }

    // 5) 轉 Manifest
    const manifest: ManifestRow[] = [];
    for (const r of rows) {
      let raw = (r[H_FILE] || "").trim().replace(/\\/g, "/");
      if (!raw.toLowerCase().endsWith(".pdf")) raw = `${raw}.pdf`;
      const display = (r[H_NAME] || "").trim();
      const lastUpdate = normalizeDate((H_DATE ? r[H_DATE] : "")?.trim());
      const department = (r[H_DEPT] || "").trim() as Department;
      
      if (!raw) continue;
      
      if (!DEPARTMENTS.includes(department)) {
        setStatus("error");
        addLog(`無效的處室名稱：${department}，有效的處室名稱為：${DEPARTMENTS.join(', ')}`);
        return;
      }
      
      manifest.push({
        filename: raw,
        displayName: display || raw,
        lastUpdate,
        department
      });
    }

    if (!manifest.length) { setStatus("error"); addLog("CSV 中沒有任何有效列（缺少檔名）"); return; }

    setStatus("ready");
    setLog([]);
    setProgress({ done: 0, total: manifest.length });
    addLog(`找到 CSV：${csv.name}，共 ${manifest.length} 筆。開始上傳…`);

    // 6) 逐筆上傳（走 /api/docs via uploadDoc）
    setStatus("uploading"); onBusy?.(true);
    for (const row of manifest) {
      const fileObj = mapByRel.get(row.filename) || mapByBase.get(row.filename.split("/").pop() || "");
      if (!fileObj) {
        addLog(`❌ 找不到檔案：${row.filename}（請確認 CSV 的「檔名」相對路徑與實際檔案相符）`);
        setProgress(p => ({ ...p, done: p.done + 1 }));
        continue;
      }

      // 準備 FormData（與 UploadDialog 相同鍵名）
      const form = new FormData();
      form.append("file", fileObj, fileObj.name);
      form.append("title", row.displayName);
      form.append("department", row.department || "");
      // 取不含路徑與副檔名作為 doc_no
      const base = (row.filename.split("/").pop() || "").replace(/\.pdf$/i, "");
      form.append("doc_no", base);
      if (row.lastUpdate) form.append("date_issued", row.lastUpdate);
      if (kb) form.append("kb", kb);
      form.append("sync_to_ragflow", "true"); // 與單檔上傳一致（後端會上傳 RAG Flow）

      try {
        // 直接呼叫共用 API
        await uploadDoc(form);
        addLog(`✅ 已上傳：${row.displayName}`);
      } catch (e: any) {
        addLog(`❌ 失敗：${row.displayName} → ${e?.message || e}`);
      } finally {
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    }

    setStatus("done"); onBusy?.(false);
    addLog("全部處理完成。");
    alert("全部上傳完成");
    onDone?.();
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  const busy = status === "uploading";

  return (
    <div style={{ border: "1px solid #e5e7eb", padding: 16, borderRadius: 8 }}>
      <h3>批量匯入（資料夾 + CSV）</h3>
      <p style={{ marginTop: -8, color: "#666" }}>
        CSV 欄位需求：<b>法規名稱</b>、<b>檔名</b>、（可選）<b>最後更新日期</b>。<br/>
        檔名未填副檔名會自動補 <code>.pdf</code>；檔案請與 CSV 置於同資料夾或其子資料夾。
      </p>
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory="true"
        // @ts-ignore
        directory="true"
        multiple
        disabled={busy}
        onChange={handlePickFolder}
      />
      <div style={{ marginTop: 12 }}>進度：{progress.done} / {progress.total}</div>
      <pre style={{ maxHeight: 220, overflow: "auto", background: "#015728ff", padding: 8 }}>
        {log.join("\n")}
      </pre>
    </div>
  );
};

export default BulkFolderUpload;
