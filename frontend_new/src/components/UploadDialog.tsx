import { useRef, useState } from "react";
import { uploadDoc } from "../api/index";
import type { ChunkingOptions, UploadResponse } from "../api/types";
import { DEPARTMENTS } from "../constants";

interface DocumentSuggestion {
  metadata?: {
    title?: string;
    department?: string;
    doc_no?: string;
    date_issued?: string;
    review_meeting?: string;
  };
  contains_table?: boolean;
  chunking?: ChunkingOptions;
}

export default function UploadDialog({ kb, onDone }: { kb: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // 表單欄位 state
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0]);
  const [docNo, setDocNo] = useState("");
  const [dateIssued, setDateIssued] = useState("");
  const [reviewMeeting, setReviewMeeting] = useState("");
  const [containsTable, setContainsTable] = useState<boolean | null>(null);

  const [method, setMethod] = useState<
    "general" | "fixed" | "by_page" | "regex" | "by_heading"
  >("general");
  const [chunkSize, setChunkSize] = useState<number | undefined>();
  const [chunkOverlap, setChunkOverlap] = useState<number | undefined>();
  const [chunkRegex, setChunkRegex] = useState("");
  const [chunkHeadingRegex, setChunkHeadingRegex] = useState("");

  const fileRef = useRef<HTMLInputElement | null>(null);

  async function analyzeFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);

    try {
      setAnalyzing(true);
      const res = await fetch("/api/llm/analyze-doc", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!data.success) {
        alert("LLM 分析失敗：" + (data.error || ""));
        return;
      }

      let suggestion: DocumentSuggestion = {};
      try {
        suggestion =
          typeof data.suggestion === "string"
            ? JSON.parse(data.suggestion)
            : data.suggestion;
      } catch (e) {
        console.error("LLM 回傳非 JSON", data.suggestion);
        return;
      }

      const meta = suggestion.metadata || {};
      setTitle(meta.title || "");
      setDepartment(meta.department || "");
      setDocNo(meta.doc_no || "");
      setDateIssued(meta.date_issued || "");
      setReviewMeeting(meta.review_meeting || "");
      setContainsTable(suggestion.contains_table ?? null);

      if (suggestion.chunking) {
        const chunkMethod = suggestion.chunking.method || "general";
        setMethod(chunkMethod as "general" | "fixed" | "by_page" | "regex" | "by_heading");
        setChunkSize(suggestion.chunking.size || undefined);
        setChunkOverlap(suggestion.chunking.overlap || undefined);
      }
    } catch (e: any) {
      alert("LLM 分析失敗：" + e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert("請選擇要上傳的 PDF 檔");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.append("file", file);
    fd.append("kb", kb);

    try {
      setBusy(true);
      const res: UploadResponse = await uploadDoc(fd, { kb });
      const synced = !!res?.ragflow?.success;
      if (synced) alert("檔案已上傳並同步到 RAGFlow！");
      else if (fd.get("sync_to_ragflow"))
        alert("已上傳（本系統）。同步 RAGFlow 失敗，可稍後『重觸發』再試。");
      else alert("檔案已上傳（本系統）。");
      setOpen(false);
      onDone();
    } catch (err: any) {
      alert(err?.message || "上傳失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        上傳新文件
      </button>
      {open && (
        <div className="modal" onClick={() => !busy && setOpen(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginBottom: 8 }}>
              上傳文件
            </h3>
            <form onSubmit={submit} className="grid" style={{ marginTop: 6 }}>
              <label className="row">
                <span>標題</span>
                <input
                  className="input"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </label>
              <label className="row">
                <span>部門</span>
                <input
                  className="input"
                  name="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                />
              </label>
              <label className="row">
                <span>規章編號</span>
                <input
                  className="input"
                  name="doc_no"
                  value={docNo}
                  onChange={(e) => setDocNo(e.target.value)}
                />
              </label>
              <label className="row">
                <span>公布日期</span>
                <input
                  className="input"
                  name="date_issued"
                  type="date"
                  value={dateIssued}
                  onChange={(e) => setDateIssued(e.target.value)}
                />
              </label>
              <label className="row">
                <span>審議會議</span>
                <input
                  className="input"
                  name="review_meeting"
                  value={reviewMeeting}
                  onChange={(e) => setReviewMeeting(e.target.value)}
                />
              </label>
              <label className="row">
                <span>PDF 檔案</span>
                <input
                  className="input"
                  type="file"
                  accept="application/pdf"
                  ref={fileRef}
                  required
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) analyzeFile(file);
                  }}
                />
              </label>

              {containsTable !== null && (
                <div className="row">
                  <span>含表格</span>
                  <span>{containsTable ? "✅ 是" : "❌ 否"}</span>
                </div>
              )}

              {/* ── Chunking 方式 ─────────────────────────────── */}
              <fieldset
                style={{
                  gridColumn: "1 / -1",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <legend className="sub" style={{ padding: "0 6px" }}>
                  分段（Chunking）
                </legend>
                <div className="row">
                  <span>方法</span>
                  <select
                    className="input"
                    name="chunk_method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as any)}
                  >
                    <option value="general">一般（預設）</option>
                    <option value="fixed">固定長度（size/overlap）</option>
                    <option value="by_page">依頁切分</option>
                    <option value="regex">正則（pattern）</option>
                    <option value="by_heading">依標題（heading_regex）</option>
                  </select>
                </div>

                {method === "fixed" && (
                  <>
                    <label className="row">
                      <span>size</span>
                      <input
                        className="input"
                        name="chunk_size"
                        type="number"
                        min={1}
                        value={chunkSize ?? ""}
                        onChange={(e) => setChunkSize(Number(e.target.value))}
                      />
                    </label>
                    <label className="row">
                      <span>overlap</span>
                      <input
                        className="input"
                        name="chunk_overlap"
                        type="number"
                        min={0}
                        value={chunkOverlap ?? ""}
                        onChange={(e) => setChunkOverlap(Number(e.target.value))}
                      />
                    </label>
                  </>
                )}
                {method === "regex" && (
                  <label className="row">
                    <span>pattern</span>
                    <input
                      className="input"
                      name="chunk_regex"
                      value={chunkRegex}
                      onChange={(e) => setChunkRegex(e.target.value)}
                    />
                  </label>
                )}
                {method === "by_heading" && (
                  <label className="row">
                    <span>heading_regex</span>
                    <input
                      className="input"
                      name="chunk_heading_regex"
                      value={chunkHeadingRegex}
                      onChange={(e) => setChunkHeadingRegex(e.target.value)}
                    />
                  </label>
                )}
              </fieldset>

              <label className="row">
                <span>同步到 RAGFlow</span>
                <input type="checkbox" name="sync_to_ragflow" defaultChecked />
              </label>

              <input type="hidden" name="kb" value={kb} />
              <div
                className="row-end"
                style={{ gridColumn: "1 / -1", marginTop: 6 }}
              >
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "上傳中…" : analyzing ? "正在分析…" : "送出"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
