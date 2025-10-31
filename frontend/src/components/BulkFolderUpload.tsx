// src/components/BulkFolderUpload.tsx
import { useRef, useState } from "react";
import { uploadDoc } from "../api";
import type { Department } from "../constants";
import { DEPARTMENTS } from "../constants";

type ManifestRow = {
  filename: string;
  displayName: string;
  lastUpdate?: string;
  department: Department;
};

type Props = {
  kb?: string;
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
      else if (ch === "\r") { 
        i += 1; 
        if (text[i] === "\n") i += 1; 
        row.push(cell); 
        rows.push(row); 
        row = []; 
        cell = ""; 
      }
      else { cell += ch; i += 1; }
    }
  }
  row.push(cell); 
  rows.push(row);
  
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === "")) rows.pop();
  if (!rows.length) return [];
  
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => obj[h] = r[j] ?? "");
    return obj;
  });
}

function normalizeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
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

  async function handlePickFolder(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;

    setStatus("ready");
    setLog([]);
    setProgress({ done: 0, total: 0 });

    try {
      // 1) 找 CSV（manifest.csv 優先）
      let csv = files.find(f => /(^|\/)manifest\.csv$/i.test((f as any).webkitRelativePath || f.name));
      if (!csv) csv = files.find(f => f.name.toLowerCase().endsWith(".csv"));
      
      if (!csv) {
        setStatus("error");
        addLog("❌ 找不到 CSV（請在資料夾內放 manifest.csv 或任何 .csv）");
        return;
      }

      // 2) 解析 CSV
      const csvText = await csv.text();
      const rows = parseCSV(csvText);
      
      if (!rows.length) {
        setStatus("error");
        addLog("❌ CSV 內容為空");
        return;
      }

      const headers = Object.keys(rows[0]);

      // 3) 對應欄位
      const H_NAME = pickHeader(headers, ["法規名稱","名稱","display_name","displayName","name","title"]);
      const H_FILE = pickHeader(headers, ["檔名","檔案","檔案名稱","filename","file"]);
      const H_DATE = pickHeader(headers, ["最後更新日期","更新日期","last_update","updated_at","date"]);
      const H_DEPT = pickHeader(headers, ["處室","部門","department"]);

      if (!H_NAME || !H_FILE || !H_DEPT) {
        setStatus("error");
        addLog(`❌ CSV 缺少必要欄位（法規名稱、檔名、處室）。目前偵測到欄位：${headers.join(", ")}`);
        return;
      }

      addLog(`✅ 找到 CSV：${csv.name}`);
      addLog(`📋 欄位對應 - 名稱:${H_NAME}, 檔名:${H_FILE}, 處室:${H_DEPT}${H_DATE ? `, 日期:${H_DATE}` : ''}`);

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
        if (!raw) continue;
        
        // 自動補 .pdf
        if (!raw.toLowerCase().endsWith(".pdf")) {
          raw = `${raw}.pdf`;
        }
        
        const display = (r[H_NAME] || "").trim();
        const lastUpdate = normalizeDate((H_DATE ? r[H_DATE] : "")?.trim());
        const department = (r[H_DEPT] || "").trim() as Department;
        
        if (!DEPARTMENTS.includes(department)) {
          setStatus("error");
          addLog(`❌ 無效的處室名稱：${department}，有效的處室名稱為：${DEPARTMENTS.join(', ')}`);
          return;
        }
        
        manifest.push({
          filename: raw,
          displayName: display || raw,
          lastUpdate,
          department
        });
      }

      if (!manifest.length) {
        setStatus("error");
        addLog("❌ CSV 中沒有任何有效列（缺少檔名）");
        return;
      }

      setProgress({ done: 0, total: manifest.length });
      addLog(`📦 準備上傳 ${manifest.length} 個檔案到 RAGFlow...`);

      // 6) 逐筆上傳（走 /api/docs via uploadDoc）
      setStatus("uploading");
      if (onBusy) onBusy(true);

      let successCount = 0;
      let failCount = 0;

      for (const row of manifest) {
        const fileObj = mapByRel.get(row.filename) || mapByBase.get(row.filename.split("/").pop() || "");
        
        if (!fileObj) {
          addLog(`❌ 找不到檔案：${row.filename}（請確認 CSV 的「檔名」相對路徑與實際檔案相符）`);
          failCount++;
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
        
        if (row.lastUpdate) {
          form.append("date_issued", row.lastUpdate);
        }
        
        if (kb) {
          form.append("kb", kb);
        }
        
        // ⚠️ 關鍵：必須加上 sync_to_ragflow=true
        form.append("sync_to_ragflow", "true");

        try {
          await uploadDoc(form);
          addLog(`✅ 已上傳：${row.displayName}`);
          successCount++;
        } catch (e: any) {
          addLog(`❌ 失敗：${row.displayName} → ${e?.message || e}`);
          failCount++;
        } finally {
          setProgress(p => ({ ...p, done: p.done + 1 }));
        }
      }

      setStatus("done");
      if (onBusy) onBusy(false);
      
      addLog(`\n📊 上傳完成：成功 ${successCount} 個，失敗 ${failCount} 個`);
      
      if (successCount > 0) {
        alert(`批量上傳完成！\n成功：${successCount} 個\n失敗：${failCount} 個`);
      }
      
      if (onDone) onDone();
      if (folderInputRef.current) folderInputRef.current.value = "";

    } catch (err) {
      addLog(`❌ 處理失敗：${err}`);
      setStatus("error");
      if (onBusy) onBusy(false);
    }
  }

  const busy = status === "uploading";

  return (
    <div style={{ border: "1px solid #e5e7eb", padding: 16, borderRadius: 8 }}>
      <h3>批量匯入（資料夾 + CSV）</h3>
      <p style={{ marginTop: -8, color: "#666", fontSize: "0.9em" }}>
        CSV 欄位需求：<b>法規名稱</b>、<b>檔名</b>、<b>處室</b>、（可選）<b>最後更新日期</b>。<br/>
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
        style={{ marginBottom: 8 }}
      />
      <div style={{ marginTop: 12, fontWeight: "bold" }}>
        進度：{progress.done} / {progress.total}
        {status === "uploading" && " ⏳ 上傳中..."}
        {status === "done" && " ✅ 完成"}
        {status === "error" && " ❌ 錯誤"}
      </div>
      <pre style={{ 
        maxHeight: 280, 
        overflow: "auto", 
        background: "#1a1a1a", 
        color: "#00ff00",
        padding: 12,
        borderRadius: 4,
        fontSize: "0.85em",
        fontFamily: "monospace"
      }}>
        {log.length > 0 ? log.join("\n") : "等待選擇資料夾..."}
      </pre>
    </div>
  );
};

export default BulkFolderUpload;