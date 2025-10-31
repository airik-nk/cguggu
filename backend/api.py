import os
from datetime import date, datetime, timezone
from flask import Blueprint, request, jsonify, current_app, send_from_directory, abort
from werkzeug.utils import secure_filename
from models import db, Document, DocumentVersion, UploadLog
from pathlib import Path
from openai import OpenAI

from io import BytesIO
from PyPDF2 import PdfReader
from ragflow_service import (
    upload_and_parse_file,
    get_doc_status,
    resync_by_display_name,
    list_ragflow_documents,
    delete_by_display_name,
    find_by_display_name_exact,
    delete_document_by_id,
    update_document_chunking_by_display_name,
    update_dataset_chunking,
    upload_file_to_ragflow,
    list_datasets_info,
    get_knowledge_bases
)

api = Blueprint("api", __name__, url_prefix="/api")


# ────────────────────────── 最近上傳:僅保留 10 筆 ──────────────────────────
def _prune_upload_logs(keep: int = 10):
    """只保留最近 keep 筆 UploadLog,其他刪除。"""
    old_ids = [
        r.id
        for r in UploadLog.query.order_by(UploadLog.uploaded_at.desc()).offset(keep).all()
    ]
    if old_ids:
        UploadLog.query.filter(UploadLog.id.in_(old_ids)).delete(synchronize_session=False)
        db.session.commit()


def _append_upload_log(*, kb: str | None, doc_no: str | None, title: str,
                       display_name: str | None, rag_doc_id: str | None,
                       rag_status: str):
    """新增一筆 UploadLog 並自動修剪到 10 筆。"""
    rec = UploadLog(
        kb=kb,
        doc_no=doc_no,
        title=title,
        display_name=display_name,
        rag_doc_id=rag_doc_id,
        rag_status=str(rag_status or "UNKNOWN").upper(),
    )
    db.session.add(rec)
    db.session.commit()
    _prune_upload_logs(keep=10)


@api.get("/knowledge-bases")
def api_knowledge_bases():
    """
    獲取知識庫列表 (knowledge bases / datasets)
    支持 ?q=keyword 與 ?limit=100
    """
    q = (request.args.get("q") or "").strip() or None
    limit_raw = (request.args.get("limit") or "").strip()
    try:
        limit = int(limit_raw) if limit_raw else 200
    except ValueError:
        limit = 200
    
    # 調用 RAGFlow service 獲取知識庫列表
    items = list_datasets_info(keyword=q, limit=limit)
    return jsonify(items), 200


@api.get("/docs")
def api_docs_list():
    """
    目前本地 DB 未分 KB,因此此清單不依 kb 過濾;
    若未來要分 KB,可在 Document 上新增欄位再據以篩選。
    """
    docs = Document.query.order_by(Document.date_issued.desc()).all()
    items = []
    for d in docs:
        v = (
            DocumentVersion.query.filter_by(doc_id=d.id)
            .order_by(DocumentVersion.date_issued.desc())
            .first()
        )
        latest = None
        if v:
            latest = {
                "id": v.id,
                "doc_id": v.doc_id,
                "date_issued": d.date_issued.isoformat() if d.date_issued else None,
                "is_active": v.is_active,
                "file_path": v.file_path,
                "filename": os.path.basename(v.file_path) if v.file_path else None,
            }
        items.append(
            {
                "doc": {
                    "id": d.id,
                    "title": d.title,
                    "department": d.department,
                    "doc_no": d.doc_no,
                    "date_issued": d.date_issued.isoformat() if d.date_issued else None,
                    "review_meeting": d.review_meeting,
                },
                "latest": latest,
            }
        )
    return jsonify(items)


@api.post("/docs")
def api_docs_upload():
    """
    上傳單一 PDF 到本系統並（可選）同步至 RAGFlow。
    RAGFlow 端顯示名稱固定為：<department>-<title>.pdf（有部門才加部門）。
    """
    # 1) 取檔案
    f = request.files.get("file")
    if not f:
        return ("請選擇要上傳的 PDF 檔", 400)

    filename = secure_filename(f.filename or "unnamed.pdf")
    save_dir = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, filename)
    f.save(save_path)

    # 2) 表單欄位
    title           = (request.form.get("title") or Path(filename).stem).strip()
    department      = (request.form.get("department") or "").strip()
    doc_no          = (request.form.get("doc_no") or "").strip()
    date_issued_raw = request.form.get("date_issued") or None
    review_meeting  = request.form.get("review_meeting") or None
    version_code    = request.form.get("version_code") or "v1"
    kb              = request.form.get("kb") or request.args.get("kb")  # dataset 名稱/ID

    # 3) chunking 參數（可選）
    chunk_method        = request.form.get("chunk_method") or request.form.get("chunking_method")
    chunk_size          = request.form.get("chunk_size")
    chunk_overlap       = request.form.get("chunk_overlap")
    chunk_regex         = request.form.get("chunk_regex")
    chunk_heading_regex = request.form.get("chunk_heading_regex")
    parse_options = {}
    if chunk_method:        parse_options["method"] = chunk_method
    if chunk_size:          parse_options["size"] = int(chunk_size)
    if chunk_overlap:       parse_options["overlap"] = int(chunk_overlap)
    if chunk_regex:         parse_options["pattern"] = chunk_regex
    if chunk_heading_regex: parse_options["heading_regex"] = chunk_heading_regex
    if not parse_options:   parse_options = None

    # 4) 是否同步至 RAGFlow
    sync_to_ragflow = (request.form.get("sync_to_ragflow") or "").lower() in ("1", "true", "on", "yes")

    # 5) 寫入本地 DB
    doc = Document(
        title=title,
        department=department,
        doc_no=doc_no,
        date_issued=(date.fromisoformat(date_issued_raw) if date_issued_raw else None),
        review_meeting=review_meeting,
    )
    db.session.add(doc)
    db.session.commit()

    ver = DocumentVersion(
        doc_id=doc.id,
        date_issued=(date.fromisoformat(date_issued_raw) if date_issued_raw else None),
        is_active=True,
        file_path=save_path,
    )
    db.session.add(ver)
    db.session.commit()

    # 6) 組 RAGFlow 顯示名稱：<dept>-<title>.pdf（有部門才加；副檔名避免重覆）
    ext = Path(save_path).suffix or ""
    dep = department.strip()
    use_dep = bool(dep and dep.lower() != "unknown")
    rag_base = f"{dep}-{title}" if use_dep else title
    rag_display_name = rag_base if (ext and rag_base.lower().endswith(ext.lower())) else f"{rag_base}{ext}"

    # 7) 同步到 RAGFlow（依 kb 切換 dataset）
    rag_result = {"success": False, "error": "not synced"}
    if sync_to_ragflow:
        rag_result = upload_and_parse_file(
            save_path,
            title=rag_display_name,        # ← 關鍵：用我們組好的 <部門>-<標題>.pdf
            dataset_name=kb,
            parse_options=parse_options,
        )

    return (
        jsonify(
            {
                "message": f"已上傳：{title}（版本 {version_code}）",
                "doc": {
                    "id": doc.id,
                    "title": doc.title,
                    "department": doc.department,
                    "doc_no": doc.doc_no,
                    "date_issued": doc.date_issued.isoformat() if doc.date_issued else None,
                    "review_meeting": doc.review_meeting,
                },
                "version": {
                    "id": ver.id,
                    "file_path": ver.file_path,
                    "date_issued": ver.date_issued.isoformat() if ver.date_issued else None,
                    "is_active": ver.is_active,
                },
                "ragflow": rag_result,
            }
        ),
        (200 if rag_result.get("success") else 207),
    )


# === 新增:批量匯入用「單筆直傳 RAG Flow」端點(不寫本地 DB) ===
@api.post("/ragflow/upload")
def api_ragflow_direct_upload():
    """
    把單一檔案直接上傳到 RAGFlow（不上本地 DB、不觸發解析）。
    RAGFlow 顯示名稱固定為：<department>-<title>.pdf（有部門才加）。
    multipart/form-data:
      - file: 檔案 (必填)
      - display_name/title: 顯示名稱（擇一；CSV 的「法規名稱」）
      - department: 部門（可空）
      - last_update: 最後更新日期（字串，原樣入 metadata）
      - file_type: 檔案型態（預設 "pdf"）
      - kb: dataset 名稱或 ID（可空＝用預設）
    """
    if "file" not in request.files:
        return ("missing file", 400)

    up = request.files["file"]
    filename = secure_filename(up.filename or "unnamed.pdf")
    ext = Path(filename).suffix

    # 取欄位
    display_raw = (request.form.get("display_name")
                   or request.form.get("title")
                   or Path(filename).stem).strip()
    department  = (request.form.get("department") or "").strip()
    last_update = (request.form.get("last_update") or "").strip()
    file_type   = (request.form.get("file_type") or "pdf").strip()
    kb          = request.form.get("kb") or request.args.get("kb")

    # 組顯示名稱：<dept>-<display_raw>.ext（有部門才加；避免重覆副檔名）
    base = f"{department}-{display_raw}" if department else display_raw
    display_name = base if (ext and base.lower().endswith(ext.lower())) else f"{base}{ext}"

    try:
        raw = up.read()
        result = upload_file_to_ragflow(
            file_stream=BytesIO(raw),
            filename=filename,
            display_name=display_name,            # ← 關鍵
            department=department or None,
            dataset=kb,
            extra_metadata={"last_update": last_update, "file_type": file_type},
        )
        return jsonify({"ok": True, "result": result or {}}), 200
    except Exception as e:
        current_app.logger.exception("RAGFlow direct upload error")
        return (f"upload error: {e}", 500)



@api.post("/versions/<int:version_id>/toggle")
def api_toggle_version(version_id):
    ver = DocumentVersion.query.get_or_404(version_id)
    ver.is_active = not ver.is_active
    db.session.commit()
    return jsonify(
        {"message": f"版本 {ver.id} 狀態已切換為:{'生效' if ver.is_active else '失效'}"}
    )


@api.delete("/docs/<int:doc_id>")
def api_delete_doc(doc_id):
    """
    刪除此 doc 以及其所有版本檔案;同時嘗試刪除 RAG Flow 端對應文件。
    - 以「每個版本的副檔名 + 後端 doc.title」拼出 display_name,逐一嘗試刪除
    - RAG 刪除失敗不會阻斷本地刪除,但會在回應中帶回 ragflow_warnings
    """
    kb = request.args.get("kb")
    doc = Document.query.get_or_404(doc_id)
    versions = DocumentVersion.query.filter_by(doc_id=doc.id).all()

    # 1) 準備要刪除的 display_name(以每個版本的副檔名為準)
    display_names = set()
    for v in versions:
        ext = Path(v.file_path).suffix if v.file_path else ""
        if ext and not doc.title.endswith(ext):
            display_name = f"{doc.title}{ext}"
        else:
            display_name = doc.title
        if display_name:
            display_names.add(display_name)

    # 2) 先嘗試刪除 RAG Flow(失敗不阻斷)
    ragflow_warnings = []
    for name in display_names:
        try:
            res = delete_by_display_name(name, dataset_name=kb)
            if not (isinstance(res, dict) and res.get("success")):
                ragflow_warnings.append(
                    {"display_name": name, "error": res.get("error", "unknown")}
                )
        except Exception as e:
            ragflow_warnings.append({"display_name": name, "error": str(e)})

    # 3) 刪除本地檔案(逐版本)
    for v in versions:
        try:
            if v.file_path and os.path.exists(v.file_path):
                os.remove(v.file_path)
        except Exception:
            pass

    # 4) 刪除 DB 紀錄
    db.session.delete(doc)
    db.session.commit()

    # 5) 回覆
    return (
        jsonify(
            {
                "message": "文件已刪除(含其所有版本)",
                "ragflow_warnings": ragflow_warnings or None,
            }
        ),
        200,
    )


# --- 0909 ---
# 取得單一文件(以後端 DB 的 doc_id)在 RAGFlow 的狀態
@api.get("/docs/<int:doc_id>/ragflow")
def api_doc_ragflow_status(doc_id):
    kb = request.args.get("kb")
    doc = Document.query.get_or_404(doc_id)
    ver = (
        DocumentVersion.query.filter_by(doc_id=doc.id)
        .order_by(DocumentVersion.date_issued.desc())
        .first()
    )
    if not ver or not ver.file_path:
        return jsonify({"found": False, "status": "NO_FILE"}), 200

    ext = Path(ver.file_path).suffix
    display_name = f"{doc.title}{ext}" if ext and not doc.title.endswith(ext) else doc.title

    status = get_doc_status(display_name, dataset_name=kb)
    return jsonify(status), 200


# 重新觸發解析(Resync 按鈕用)
@api.post("/docs/<int:doc_id>/ragflow/resync")
def api_doc_ragflow_resync(doc_id):
    kb = request.args.get("kb")
    doc = Document.query.get_or_404(doc_id)
    ver = (
        DocumentVersion.query.filter_by(doc_id=doc.id)
        .order_by(DocumentVersion.date_issued.desc())
        .first()
    )
    if not ver or not ver.file_path:
        return jsonify({"success": False, "error": "NO_FILE"}), 400

    ext = Path(ver.file_path).suffix
    display_name = f"{doc.title}{ext}" if ext and not doc.title.endswith(ext) else doc.title

    # 接受 JSON 參數:{ chunking: { method,size,overlap,pattern,heading_regex } }
    payload = request.get_json(silent=True) or {}
    parse_options = payload.get("chunking") or payload.get("parse_options") or {}

    # 也相容扁平鍵(method/size/overlap/pattern/heading_regex 或 chunk_*)
    if not parse_options:
        flat = {}
        m = payload.get("method") or payload.get("chunk_method") or payload.get("chunking_method")
        if m: flat["method"] = m
        if "size" in payload: flat["size"] = payload.get("size")
        if "overlap" in payload: flat["overlap"] = payload.get("overlap")
        if "pattern" in payload: flat["pattern"] = payload.get("pattern")
        if "heading_regex" in payload: flat["heading_regex"] = payload.get("heading_regex")
        # chunk_* 別名
        if "chunk_size" in payload: flat["size"] = payload.get("chunk_size")
        if "chunk_overlap" in payload: flat["overlap"] = payload.get("chunk_overlap")
        if "chunk_regex" in payload: flat["pattern"] = payload.get("chunk_regex")
        if "chunk_heading_regex" in payload: flat["heading_regex"] = payload.get("chunk_heading_regex")
        parse_options = flat or None

    res = resync_by_display_name(display_name, dataset_name=kb, parse_options=parse_options)
    return jsonify(res), (200 if res.get("success") else 400)


# === 單檔永久更新 chunking 設定 ===
@api.post("/docs/<int:doc_id>/ragflow/chunking")
def api_update_doc_chunking(doc_id):
    kb = (request.args.get("kb") or "").strip() or None
    doc = Document.query.get_or_404(doc_id)
    ver = (
        DocumentVersion.query.filter_by(doc_id=doc.id)
        .order_by(DocumentVersion.date_issued.desc())
        .first()
    )
    if not ver or not ver.file_path:
        return jsonify({"success": False, "error": "NO_FILE"}), 400

    ext = Path(ver.file_path).suffix
    display_name = f"{doc.title}{ext}" if ext and not doc.title.endswith(ext) else doc.title

    payload = request.get_json(silent=True) or {}
    chunking_method = (payload.get("chunking_method") or payload.get("chunk_method") or "").strip()
    parser_config = payload.get("parser_config") or None
    reparse = bool(payload.get("reparse", True))
    parse_options = payload.get("parse_options") or payload.get("chunking")

    if not chunking_method:
        return jsonify({"success": False, "error": "missing chunking_method"}), 400

    res = update_document_chunking_by_display_name(
        display_name=display_name,
        chunking_method=chunking_method,
        parser_config=parser_config,
        dataset_name=kb,
        reparse=reparse,
        parse_options=parse_options,
    )
    return jsonify(res), (200 if res.get("success") else 400)


# === Dataset 預設 chunking ===
@api.post("/ragflow/dataset/chunking")
def api_update_dataset_chunking():
    payload = request.get_json(silent=True) or {}
    kb = (request.args.get("kb") or payload.get("kb") or "").strip() or None
    chunking_method = (payload.get("chunking_method") or payload.get("chunk_method") or "").strip()
    if not chunking_method:
        return jsonify({"success": False, "error": "missing chunking_method"}), 400
    res = update_dataset_chunking(kb, chunking_method)
    return jsonify(res), (200 if res.get("success") else 400)


# --- 0910 ---
@api.get("/files")
def api_list_files():
    """
    掃描 UPLOAD_FOLDER 底下所有檔案(預設只列 PDF,可自行放寬),
    依最後修改時間(新→舊)排序,回傳:name, rel_path, size, mtime, url
    """
    root = current_app.config["UPLOAD_FOLDER"]
    exts = {".pdf"}
    results = []

    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            if exts and p.suffix.lower() not in exts:
                continue
            st = p.stat()
            rel = os.path.relpath(p.as_posix(), root)
            mtime_iso = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()

            file_url = f"/api/files/download/{rel}"

            results.append(
                {
                    "name": p.name,
                    "rel_path": rel.replace("\\", "/"),
                    "size": st.st_size,
                    "mtime": mtime_iso,
                    "url": file_url,
                }
            )

    results.sort(key=lambda x: x["mtime"], reverse=True)
    return jsonify(results)


@api.get("/files/download/<path:rel_path>")
def api_download_file(rel_path: str):
    root = current_app.config["UPLOAD_FOLDER"]
    safe_path = os.path.normpath(os.path.join(root, rel_path))
    if not safe_path.startswith(os.path.abspath(root)):
        abort(403)
    if not os.path.exists(safe_path):
        abort(404)
    directory, filename = os.path.split(safe_path)
    return send_from_directory(directory, filename, as_attachment=False)


@api.get("/ragflow/docs")
def api_ragflow_docs():
    """
    回傳 RAGFlow dataset 裡的全部文件(可用 ?q=keyword 過濾;用 ?kb= 指定 dataset)
    """
    kb = (request.args.get("kb") or "").strip() or None
    q = (request.args.get("q") or "").strip() or None
    limit_raw = (request.args.get("limit") or "").strip()
    try:
        limit = int(limit_raw) if limit_raw else 500
    except ValueError:
        limit = 500

    try:
        # 如果 kb 參數看起來像是 UUID/ID 格式，嘗試轉換為對應的 dataset 名稱
        if kb and len(kb) > 30:  # 簡單檢查是否可能是 UUID/ID
            current_app.logger.warning(f"Received KB ID instead of name: {kb}, please use dataset name (e.g., 'Regulation') instead")
            # 這裡可以選擇：1. 直接返回錯誤，或 2. 嘗試查詢正確的 dataset 名稱
            return jsonify({
                "error": "Invalid KB parameter",
                "detail": "Please use dataset name (e.g., 'Regulation') instead of ID",
                "code": "INVALID_KB_FORMAT"
            }), 400

        items = list_ragflow_documents(
            keywords=q,
            limit=limit,
            dataset_name=kb
        )
        if not items:
            return jsonify([]), 200
        return jsonify(items), 200
    except Exception as e:
        current_app.logger.error(f"Error in api_ragflow_docs: {str(e)}")
        error_msg = str(e)
        if "lacks permission" in error_msg:
            return jsonify({
                "error": "Permission denied",
                "detail": "Please check if the dataset name is correct (e.g., use 'Regulation' instead of dataset ID)",
                "code": "PERMISSION_ERROR"
            }), 403
        return jsonify({
            "error": "Internal server error",
            "detail": error_msg
        }), 500


@api.delete("/ragflow/docs/<doc_id>")
def api_delete_ragflow_doc(doc_id):
    """
    直接以 RAGFlow doc_id 刪除(與 dataset 無關)
    """
    res = delete_document_by_id(doc_id)
    status = 200 if res.get("success") else (400 if res.get("error_type") == "ValueError" else 502)
    return jsonify(res), status


@api.delete("/ragflow/docs/by-display-name")
def api_delete_ragflow_doc_by_display_name():
    kb = (request.args.get("kb") or "").strip() or None
    target = (request.args.get("name") or "").strip()
    if not target and request.is_json:
        payload = request.get_json(silent=True) or {}
        target = (payload.get("display_name") or "").strip()
        if not kb:
            kb = (payload.get("kb") or "").strip() or None

    if not target:
        return jsonify({"success": False, "error": "missing display_name"}), 400

    res = delete_by_display_name(target, dataset_name=kb)
    status = 200 if res.get("success") else 502
    return jsonify(res), status


@api.get("/ragflow/docs/matches")
def api_ragflow_doc_matches():
    kb = (request.args.get("kb") or "").strip() or None
    target = (request.args.get("name") or "").strip()
    if not target and request.is_json:
        payload = request.get_json(silent=True) or {}
        target = (payload.get("display_name") or "").strip()
        if not kb:
            kb = (payload.get("kb") or "").strip() or None

    if not target:
        return jsonify({"success": False, "error": "missing display_name"}), 400

    res = find_by_display_name_exact(target, dataset_name=kb)
    status = 200 if res.get("success") else 502
    return jsonify(res), status


# === 新增:最近 10 筆上傳查詢(含即時 RAGFlow 狀態) ===
@api.get("/uploads/recent")
def api_recent_uploads():
    """
    從既有本地資料庫(raglaw.db)抓最近 10 筆版本記錄,並以 ?kb= 指定的 KB 即時查 RAGFlow 狀態。
    傳入參數:
      - ?kb=Regulation(可選,用於即時查 RAGFlow 狀態)
    回傳欄位:
      id, uploaded_at, kb, doc_no, title, display_name, rag_status, rag_url
    """
    kb = (request.args.get("kb") or "").strip() or None

    pairs = (
        db.session.query(Document, DocumentVersion)
        .join(DocumentVersion, Document.id == DocumentVersion.doc_id)
        .order_by(DocumentVersion.id.desc())
        .limit(10)
        .all()
    )

    results = []
    for (d, v) in pairs:
        try:
            mtime = None
            if v.file_path and os.path.exists(v.file_path):
                mtime = datetime.fromtimestamp(os.path.getmtime(v.file_path), tz=timezone.utc)
        except Exception:
            mtime = None
        uploaded_at = (
            mtime
            or (v.date_issued and datetime.combine(v.date_issued, datetime.min.time(), tzinfo=timezone.utc))
            or datetime.now(timezone.utc)
        ).isoformat()

        ext = Path(v.file_path).suffix if v.file_path else ""
        display_name = f"{d.title}{ext}" if ext and not str(d.title).endswith(ext) else d.title

        status, url = "UNKNOWN", None
        if display_name:
            try:
                live = get_doc_status(display_name, dataset_name=kb)
                if isinstance(live, dict):
                    status = (live.get("status") or live.get("parsing_status") or "UNKNOWN").upper()
                    url = live.get("url")
            except Exception:
                pass

        results.append({
            "id": v.id,
            "uploaded_at": uploaded_at,
            "kb": kb,
            "doc_no": d.doc_no,
            "title": d.title,
            "display_name": display_name,
            "rag_status": status,
            "rag_url": url,
        })

    return jsonify(results), 200


@api.post("/llm/analyze-doc")
def api_llm_analyze_doc():
    """
    呼叫 LLM 分析完整文件 → 產生建議 metadata + chunking + 是否有表格
    輸入:
      multipart/form-data:
        - file: 檔案 (必填,PDF)
    回傳:
      {
        "metadata": {
          "title": "xxx",
          "department": "勞動部",
          "doc_no": "勞動字第...",
          "date_issued": "2025-09-10",
          "review_meeting": "第xx次會議"
        },
        "contains_table": true,
        "chunking": { "method": "laws", "size": 500, "overlap": 50 }
      }
    """
    if "file" not in request.files:
        return jsonify({"success": False, "error": "missing file"}), 400

    up = request.files["file"]
    reader = PdfReader(BytesIO(up.read()))
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() or ""

    if not full_text.strip():
        return jsonify({"success": False, "error": "empty document"}), 400

    client = OpenAI(
        api_key="EMPTY",
        base_url="http://120.126.16.229:3579/v1",
        default_headers={"X-API-Key":"qE8ByfT1eX4IxJcewLwEpKPWdZsuFPyevWvYznDdAVTrsO0dH2KC1GPrL7bt4HKnoltMeNLprDrr2BpjEZgUHwkGTD5mCSvYcilevrBaS7dYqTBwYDPNOLq18FAvLhes"}
    )

    prompt = f"""請閱讀以下完整文件,並輸出 JSON 格式:
    1. 推測文件標題 (title)
    2. 推測制定單位 (department)
    3. 推測規章編號 (doc_no)
    4. 推測公布日期 (date_issued,格式 YYYY-MM-DD,如無則給 null)
    5. 是否提及審議會議 (review_meeting)
    6. 是否含有表格 (contains_table: true/false)
    7. 建議 chunking (method/size/overlap)

    文件全文:
    {full_text[:5000]}
    """

    try:
        resp = client.chat.completions.create(
            model="meta-llama/Llama-3.3-70B-Instruct",
            messages=[
                {"role": "system", "content": "你是文件上傳分析助手,輸出嚴格 JSON"},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"}
        )
        
        # [修改] 增加安全檢查，防止 resp.choices[0] 崩潰
        if not resp.choices or not resp.choices[0].message.content:
            print("⚠️ Chat API returned empty choices, falling back.")
            raise RuntimeError("Empty choices from Chat API") # 強制觸發 fallback
            
        suggestion = resp.choices[0].message.content

    except Exception as e:
        print("⚠️ Chat API 不存在,改用 completions API:", e)
        
        # [修改] 增加巢狀 try...except 來捕捉 fallback 失敗
        try:
            resp = client.completions.create(
                model="meta-llama/Llama-3.3-70B-Instruct",
                prompt=f"你是文件上傳分析助手,輸出嚴格 JSON。\n\n使用者需求:\n{prompt}",
                max_tokens=1024
            )
            
            # [修改] 增加安全檢查
            if not resp.choices or not resp.choices[0].text:
                print("⚠️ Completions API also returned empty choices.")
                raise RuntimeError("Empty choices from Completions API")

            suggestion = resp.choices[0].text
            
        except Exception as e2:
            # [修改] 如果 fallback 也失敗，安全地回傳 JSON 錯誤
            current_app.logger.error(f"LLM analysis failed on fallback: {e2}", exc_info=True)
            return jsonify({"success": False, "error": f"LLM analysis failed (Chat: {e}; Fallback: {e2})"}), 500

    return jsonify({"success": True, "suggestion": suggestion})

@api.get("/ragflow/kb")
def api_ragflow_kb_list():
    """
    從 RAGFlow 同步 datasets(KB)清單。
    支持 ?q=keyword 與 ?limit=100
    這是 /api/knowledge-bases 的別名
    """
    q = (request.args.get("q") or "").strip() or None
    limit_raw = (request.args.get("limit") or "").strip()
    try:
        limit = int(limit_raw) if limit_raw else 200
    except ValueError:
        limit = 200
    items = list_datasets_info(keyword=q, limit=limit)
    return jsonify(items), 200