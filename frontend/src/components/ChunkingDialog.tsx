import React, { useMemo, useState } from "react";
import { updateRagChunking } from "../api";

type Props = {
  kb: string;
  docId: number;
  open: boolean;
  onClose: () => void;
  onDone: () => void; // reload 列表
};

const METHOD_OPTIONS = [
  { value: "naive", label: "General (naive)" },
  { value: "manual", label: "Manual" },
  { value: "qa", label: "Q&A" },
  { value: "table", label: "Table" },
  { value: "paper", label: "Paper" },
  { value: "book", label: "Book" },
  { value: "laws", label: "Laws" },
  { value: "presentation", label: "Presentation" },
  { value: "picture", label: "Picture" },
  { value: "one", label: "One" },
  { value: "email", label: "Email" },
];

export default function ChunkingDialog({ kb, docId, open, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<string>("naive");

  // naive 的 parser_config（官方範例鍵）
  const [tokenNum, setTokenNum] = useState<number>(128);
  const [delimiter, setDelimiter] = useState<string>("\n");
  const [html4excel, setHtml4excel] = useState<boolean>(false);
  const [layoutRecognize, setLayoutRecognize] = useState<boolean>(true);
  const [useRaptor, setUseRaptor] = useState<boolean>(false);

  const parserConfig = useMemo(() => {
    if (method === "naive") {
      return {
        chunk_token_num: tokenNum,
        delimiter,
        html4excel,
        layout_recognize: layoutRecognize,
        raptor: { use_raptor: useRaptor },
      };
    }
    // 其他方法通常不需要 parser_config，或僅有 raptor 可選
    if (["manual", "qa", "paper", "book", "laws", "presentation"].includes(method)) {
      return { raptor: { use_raptor: useRaptor } };
    }
    // table/picture/one/email -> None
    return null;
  }, [method, tokenNum, delimiter, html4excel, layoutRecognize, useRaptor]);

  async function submit() {
    try {
      setBusy(true);
      await updateRagChunking(docId, {
        chunk_method: method,
        parser_config: parserConfig ?? undefined,
        reparse: true,                 // 直接重跑解析
      }, { kb });
      alert("已更新切塊設定並重新解析。");
      onClose();
      onDone();
    } catch (e: any) {
      alert(e?.message || "更新失敗");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="modal" onClick={() => !busy && onClose()}>
      <div className="panel" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h3 className="section-title" style={{ marginBottom: 10 }}>修改切塊設定（Chunking）</h3>

        <div className="grid" style={{ gap: 10 }}>
          <label className="row">
            <span>方法</span>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          {method === "naive" && (
            <>
              <label className="row"><span>chunk_token_num</span>
                <input className="input" type="number" min={16} step={16}
                       value={tokenNum} onChange={(e) => setTokenNum(parseInt(e.target.value || "0", 10))} />
              </label>
              <label className="row"><span>delimiter</span>
                <input className="input" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} />
              </label>
              <label className="row">
                <span>html4excel</span>
                <input type="checkbox" checked={html4excel} onChange={(e) => setHtml4excel(e.target.checked)} />
              </label>
              <label className="row">
                <span>layout_recognize</span>
                <input type="checkbox" checked={layoutRecognize} onChange={(e) => setLayoutRecognize(e.target.checked)} />
              </label>
            </>
          )}

          {/* 進階：RAPTOR（部分方法可用） */}
          {["naive", "manual", "qa", "paper", "book", "laws", "presentation"].includes(method) && (
            <label className="row"><span>raptor.use_raptor</span>
              <input type="checkbox" checked={useRaptor} onChange={(e) => setUseRaptor(e.target.checked)} />
            </label>
          )}
        </div>

        <div className="row-end" style={{ marginTop: 12 }}>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "儲存中…" : "儲存並重解析"}
          </button>
        </div>
      </div>
    </div>
  );
}
