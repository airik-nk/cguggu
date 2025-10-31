// src/components/BulkImportDialog.tsx
import { useEffect, useState } from "react";
import BulkFolderUpload from "./BulkFolderUpload";

type Props = {
  /** 與 UploadDialog 一樣，指定要同步的 dataset / KB（例：Regulation） */
  kb: string;
  /** 匯入完成後呼叫（可用來重整清單） */
  onDone: () => void;
}

const BulkImportDialog: React.FC<Props> = ({ kb, onDone }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function onClose() {
    if (!busy) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  return (
    <>
      {/* 和 UploadDialog 相同宣告/樣式的觸發按鈕；擺在它左邊 */}
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        批量匯入
      </button>

      {open && (
        <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 980, width: "92vw", maxHeight: "86vh", overflow: "auto" }}
          >
            <h3 className="section-title" style={{ marginBottom: 8 }}>
              批量匯入
            </h3>

            {/* 批量匯入表單；完成後關閉並回呼 onDone */}
            {
              // @ts-ignore：相容舊版 BulkFolderUpload 沒宣告 props 的情況
              <BulkFolderUpload
                kb={kb}
                onBusy={(v: boolean) => setBusy(v)}
                onDone={() => { onDone(); setOpen(false); }}
              />
            }

            <div className="row-end" style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={busy} onClick={onClose}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkImportDialog;
