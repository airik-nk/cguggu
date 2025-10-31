# backend/ragflow_service.py
import os, re, logging
from pathlib import Path
from typing import List, Optional, Dict, Any, IO, Tuple
from ragflow_sdk import RAGFlow
import requests
import traceback

log = logging.getLogger("ragflow")

# ─────────────────────────── 環境變數 ───────────────────────────
RAGFLOW_BASE_URL = os.getenv("RAGFLOW_BASE_URL", "http://120.126.16.233:9222")
RAGFLOW_API_KEY  = os.getenv("RAGFLOW_API_KEY", "")
RAGFLOW_DATASET  = os.getenv("RAGFLOW_DATASET", os.getenv("RAGFLOW_DATASET_ID", "Regulation"))
log.info("RAGFLOW_BASE_URL = %s", RAGFLOW_BASE_URL)

# ─────────────────────────── 工具：檔名清理 / 取值 ───────────────────────────
_ZW_RE = re.compile(r"[\u200B-\u200F\uFEFF]")
def clean_name(s: str) -> str:
    return _ZW_RE.sub("", s.replace("\u3000", " ")).strip()

def resolve_dataset_name(client: RAGFlow, dataset_input: Optional[str]) -> str:
    """
    將輸入的 dataset_input 解析為資料集名稱。
    - 如果是名稱，直接返回
    - 如果是 ID，嘗試查找對應的名稱
    - 如果找不到或出錯，返回預設值
    """
    if not dataset_input:
        return RAGFLOW_DATASET
        
    # 如果不像是 ID，當作名稱使用
    if len(dataset_input) <= 30:
        return dataset_input.strip()
        
    # 嘗試用 ID 查找資料集名稱
    try:
        datasets = client.list_datasets() or []
        for ds in datasets:
            if getattr(ds, "id", None) == dataset_input:
                name = getattr(ds, "name", None)
                if name:
                    log.info(f"Resolved dataset ID {dataset_input} to name: {name}")
                    return name
    except Exception as e:
        log.warning(f"Error resolving dataset ID {dataset_input}: {e}")
    
    # 找不到就用預設值
    log.warning(f"Cannot resolve dataset ID {dataset_input}, using default: {RAGFLOW_DATASET}")
    return RAGFLOW_DATASET

def _pick(obj, *names):
    """在物件屬性與 dict key 之間彈性取第一個非 None 的值。"""
    for n in names:
        v = getattr(obj, n, None)
        if v is not None:
            return v
        if isinstance(obj, dict) and n in obj:
            return obj[n]
    return None

def _map_run_to_status(run_val: Optional[str]) -> str:
    r = (str(run_val) if run_val is not None else "").upper()
    return {
        "UNSTART": "PENDING",
        "RUNNING": "PENDING",
        "DONE": "SUCCESS",
        "FAIL": "ERROR",
        "CANCEL": "ERROR",
    }.get(r, (r or "UNKNOWN"))

# ─────────────────────────── 【新增】Chunk method 對齊官方 ───────────────────────────
def _normalize_chunk_method(label: Optional[str]) -> Optional[str]:
    """標準化 chunk method 名稱"""
    if not label:
        return None
    key = str(label).strip().lower()
    aliases = {
        "general": "naive", "naive": "naive",
        "q&a": "qa", "qa": "qa",
        "resume": "resume",
        "manual": "manual",
        "paper": "paper",
        "book": "book",
        "laws": "laws",
        "presentation": "presentation", "ppt": "presentation",
        "table": "table",
        "one": "one", "single": "one",
        "picture": "picture", "image": "picture", "pic": "picture",
        "email": "email", "mail": "email",
        "tag": "tag",
    }
    return aliases.get(key, key)

# ─────────────────────────── 內部：RAGFlow client / dataset ───────────────────────────
def _client() -> RAGFlow:
    if not RAGFLOW_API_KEY:
        raise RuntimeError("RAGFLOW_API_KEY 未設定")
    return RAGFlow(api_key=RAGFLOW_API_KEY, base_url=RAGFLOW_BASE_URL)

def _get_or_create_dataset(client: RAGFlow, name: str):
    hits = client.list_datasets(name=name)
    if hits:
        return hits[0]
    # 【修改】建立時加入預設 chunk_method
    return client.create_dataset(
        name=name, 
        description="Regulations dataset",
        chunk_method="laws"  # 預設使用法規文件切分方法
    )

def _get_dataset_for(client: RAGFlow, dataset_name: Optional[str]) -> Tuple[Any, str]:
    """依參數或預設名稱取得/建立 dataset。注意：使用資料集名稱而非 ID"""
    ds_name = resolve_dataset_name(client, dataset_name)
    return _get_or_create_dataset(client, ds_name), ds_name

# ─────────────────────────── 【新增】上傳(不解析)for 批量匯入 ───────────────────────────
def upload_file_to_ragflow(
    file_stream: IO[bytes],
    filename: str,
    display_name: Optional[str] = None,
    department: Optional[str] = None,
    dataset: Optional[str] = None,
    extra_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    上傳檔案但不立即解析(用於批量匯入)
    
    Args:
        file_stream: 檔案串流
        filename: 原始檔名
        display_name: 顯示名稱
        department: 部門資訊
        dataset: 資料集名稱
        extra_metadata: 額外的 metadata
    
    Returns:
        {"success": bool, "dataset": str, "display_name": str, "doc_ids": List[str]}
    """
    try:
        client = _client()
        ds, ds_name = _get_dataset_for(client, dataset)
    except Exception as e:
        return {"success": False, "error": f"無法訪問資料集: {str(e)}"}

    try:
        blob = file_stream.read()
    except Exception as e:
        return {"success": False, "error": f"read_stream_failed: {e}"}

    safe_filename = clean_name(filename) or "upload.bin"
    base = clean_name(display_name or safe_filename)
    ext  = Path(safe_filename).suffix
    name = f"{base}{ext}" if ext and not base.lower().endswith(ext.lower()) else base

    log.info("[RAGFlow] direct-upload -> %s (%d bytes) [dataset=%s]", name, len(blob), ds_name)

    try:
        ds.upload_documents([{"display_name": name, "name": name, "blob": blob}])
    except Exception as e:
        return {
            "success": False,
            "error": f"upload_failed: {e}",
            "display_name": name,
            "dataset": ds_name,
        }

    # 準備 metadata
    meta = {"display_name": name}
    if department: 
        meta["department"] = department
    if extra_metadata: 
        meta.update(extra_metadata)

    # 取得 doc_id 並更新 metadata
    doc_ids: List[str] = []
    try:
        docs = ds.list_documents(keywords=name) or []
        for d in docs:
            _id = getattr(d, "id", None)
            if _id:
                doc_ids.append(_id)
            # 嘗試更新 metadata
            if hasattr(d, "update") and meta:
                try:
                    d.update([{"metadata": meta}])
                except Exception:
                    pass
    except Exception:
        pass

    return {
        "success": True, 
        "dataset": ds_name, 
        "display_name": name, 
        "doc_ids": doc_ids
    }

# ─────────────────────────── 上傳 + 解析 ───────────────────────────
def upload_and_parse_file(
    file_path: str,
    display_name: Optional[str] = None,
    title: Optional[str] = None,
    dataset_name: Optional[str] = None,
    parse_options: Optional[Dict[str, Any]] = None,  # 【新增】解析選項
) -> Dict[str, Any]:
    """
    上傳單檔到指定(或預設) RAGFlow dataset，並啟動解析(async)。
    - 顯示名稱優先取「title」，再來 display_name，最後才是原檔名
    - 若顯示名稱沒帶副檔名，會補上原檔副檔名，避免無法辨識檔型
    """
    p = Path(file_path)
    if not p.exists():
        return {"success": False, "error": f"file not found: {file_path}"}

    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)

    base = clean_name(title or display_name or p.name)
    ext  = p.suffix  # 含 ".pdf"
    name = f"{base}{ext}" if ext and not base.lower().endswith(ext.lower()) else base

    blob = p.read_bytes()
    log.info("[RAGFlow] upload -> %s (%d bytes) [dataset=%s]", name, len(blob), ds_name)

    # 上傳(避免 500：包 try/except)
    try:
        # 以 SDK 目前行為，display_name/name 皆能接受；雙寫提高相容性
        dataset.upload_documents([{"display_name": name, "name": name, "blob": blob}])
    except Exception as e:
        return {
            "success": False,
            "error": f"upload_failed: {e}",
            "display_name": name,
            "dataset": ds_name,
            "hint": "Keep a valid extension in display_name (e.g. .pdf/.docx/.pptx/.xlsx/.txt)",
        }

    # 列出並啟動解析
    try:
        docs = dataset.list_documents(keywords=name) or dataset.list_documents()
        ids  = [getattr(d, "id", None) for d in docs if hasattr(d, "id")]
        ids  = [i for i in ids if i]
        if not ids:
            return {
                "success": True,
                "display_name": name,
                "dataset": ds_name,
                "parsed_ids": [],
                "note": "uploaded, listing not ready yet",
            }
        
        # 【新增】若有 parse_options，先更新 chunk_method
        if parse_options:
            cm = _normalize_chunk_method(parse_options.get("method"))
            if cm:
                for d in docs:
                    try:
                        d.update([{"chunk_method": cm}])
                    except Exception:
                        pass
        
        dataset.async_parse_documents(ids)
        return {"success": True, "display_name": name, "dataset": ds_name, "parsed_ids": ids}
    except Exception as e:
        return {
            "success": True,
            "display_name": name,
            "dataset": ds_name,
            "parsed_ids": [],
            "warn": f"parse_trigger_failed: {e}",
        }

# ─────────────────────────── 查詢狀態 ───────────────────────────
def get_doc_status(display_name: str, dataset_name: Optional[str] = None) -> Dict[str, Any]:
    """
    以 display_name 查詢 RAGFlow 當前狀態。
    回傳：{ found, status, chunks, enabled, updated_at, doc_id, url, dataset, chunk_method }
    """
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)

    docs = dataset.list_documents(keywords=display_name) or []
    if not docs:
        return {"found": False, "status": "NOT_FOUND", "dataset": ds_name}

    d = docs[0]
    status = _map_run_to_status(_pick(d, "run", "status", "parsing_status"))
    chunks = _pick(d, "chunk_count", "chunk_num", "chunkNumber", "chunk_number", "chunks") or 0
    enabled = _pick(d, "enable", "enabled", "is_enable", "isEnabled")
    doc_id = _pick(d, "id", "_id", "doc_id")
    updated_at = _pick(d, "update_time", "updated_at", "create_time", "created_at", "process_begin_at")
    chunk_method = _pick(d, "chunk_method")  # 【新增】回傳 chunk_method

    base = os.getenv("RAGFLOW_UI_BASE", RAGFLOW_BASE_URL)
    url  = f"{base.rstrip('/')}/#/datasets/{dataset.id}/documents/{doc_id}" if doc_id else None

    # 盡量回整數
    try:
        chunks = int(chunks)
    except Exception:
        pass

    return {
        "found": True,
        "status": status,
        "chunks": chunks,
        "enabled": enabled,
        "updated_at": updated_at,
        "doc_id": doc_id,
        "url": url,
        "dataset": ds_name,
        "chunk_method": chunk_method,  # 【新增】
    }

# ─────────────────────────── 重新觸發解析 ───────────────────────────
def resync_by_display_name(
    display_name: str, 
    dataset_name: Optional[str] = None,
    parse_options: Optional[Dict[str, Any]] = None  # 【新增】但目前未使用
) -> Dict[str, Any]:
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)

    docs = dataset.list_documents(keywords=display_name) or []
    if not docs:
        return {"success": False, "error": "document_not_found", "dataset": ds_name}
    ids = [getattr(d, "id", None) for d in docs if hasattr(d, "id")]
    ids = [i for i in ids if i]
    if not ids:
        return {"success": False, "error": "no_valid_ids", "dataset": ds_name}

    dataset.async_parse_documents(ids)
    return {"success": True, "parsed_ids": ids, "dataset": ds_name}

# ─────────────────────────── 【新增】單檔永久更新 chunking ───────────────────────────
def update_document_chunking_by_display_name(
    display_name: str, 
    chunking_method: str, 
    parser_config: Optional[Dict[str, Any]] = None, 
    dataset_name: Optional[str] = None, 
    reparse: bool = True,
    parse_options: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    更新單一文件的 chunking 方法
    
    Args:
        display_name: 文件顯示名稱
        chunking_method: 切分方法 (laws, naive, qa, etc.)
        parser_config: 解析器配置
        dataset_name: 資料集名稱
        reparse: 是否重新解析
        parse_options: 額外解析選項
    
    Returns:
        {"success": bool, "doc_id": str, "dataset": str, "chunk_method": str}
    """
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)
    
    docs = dataset.list_documents(keywords=display_name) or []
    if not docs:
        return {"success": False, "error": "document_not_found", "dataset": ds_name}

    doc = docs[0]
    try:
        cm = _normalize_chunk_method(chunking_method)
        payloads = [{"chunk_method": cm}]
        if parser_config is not None:
            payloads.append({"parser_config": parser_config})
        
        if hasattr(doc, "update"):
            doc.update(payloads)
        
        doc_id = getattr(doc, "id", None)
        if reparse and doc_id:
            dataset.async_parse_documents([doc_id])
        
        return {
            "success": True, 
            "doc_id": doc_id, 
            "dataset": ds_name, 
            "chunk_method": cm
        }
    except Exception as e:
        return {"success": False, "error": str(e), "dataset": ds_name}

# ─────────────────────────── 【新增】Dataset 預設 chunking ───────────────────────────
def update_dataset_chunking(
    dataset_name: Optional[str], 
    chunking_method: str
) -> Dict[str, Any]:
    """
    更新整個 dataset 的預設 chunking 方法
    
    Args:
        dataset_name: 資料集名稱
        chunking_method: 切分方法
    
    Returns:
        {"success": bool, "dataset": str, "chunk_method": str}
    """
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)
    
    try:
        cm = _normalize_chunk_method(chunking_method)
        dataset.update({"chunk_method": cm})
        return {"success": True, "dataset": ds_name, "chunk_method": cm}
    except Exception as e:
        return {"success": False, "error": str(e), "dataset": ds_name}

# ─────────────────────────── 列表 ───────────────────────────
def list_ragflow_documents(
    keywords: Optional[str] = None,
    limit: int = 500,
    dataset_name: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    回傳欄位：id, display_name, status, chunks, enabled, updated_at, url, dataset, chunk_method
    
    注意：dataset_name 應使用資料集名稱（例如 "Regulation"）而非 ID
    """
    client = _client()
    
    # 檢查是否誤用 ID 而非名稱
    if dataset_name and len(dataset_name) > 30:  # 簡單檢查是否可能是 UUID/ID
        log.warning(f"Dataset name looks like an ID: {dataset_name}, using default dataset instead")
        dataset_name = RAGFLOW_DATASET
    
    dataset, ds_name = _get_dataset_for(client, dataset_name)

    docs = dataset.list_documents(keywords=keywords) or []
    base = os.getenv("RAGFLOW_UI_BASE", RAGFLOW_BASE_URL)

    items: List[Dict[str, Any]] = []
    for d in docs[:limit]:
        doc_id = _pick(d, "id", "_id", "doc_id")
        name   = _pick(d, "name", "display_name", "filename", "file_name")
        status = _map_run_to_status(_pick(d, "run", "status", "parsing_status"))
        chunks = _pick(d, "chunk_count", "chunk_num", "chunkNumber", "chunk_number", "chunks") or 0
        enabled = _pick(d, "enable", "enabled", "is_enable", "isEnabled")
        updated_at = _pick(d, "update_time", "updated_at", "create_time", "created_at", "process_begin_at")
        chunk_method = _pick(d, "chunk_method")  # 【新增】

        try:
            chunks = int(chunks)
        except Exception:
            pass

        url = f"{base.rstrip('/')}/#/datasets/{dataset.id}/documents/{doc_id}" if doc_id else None

        items.append({
            "id": doc_id,
            "display_name": name,
            "status": status,
            "chunks": chunks,
            "enabled": enabled,
            "updated_at": updated_at,
            "url": url,
            "dataset": ds_name,
            "chunk_method": chunk_method,  # 【新增】
        })
    return items

# ─────────────────────────── REST 刪除(by doc_id) ───────────────────────────
def _auth_headers():
    headers = {"accept": "application/json"}
    if RAGFLOW_API_KEY:
        headers["Authorization"] = f"Bearer {RAGFLOW_API_KEY}"
    return headers

def delete_document(doc_id: str) -> None:
    """
    直接呼叫 RAGFlow 後端 API 以 doc_id 刪除；與 dataset 無關。
    2xx 視為成功；404 視為已不存在；其他狀態 raise 讓上層決定。
    """
    if not doc_id:
        return
    url = f"{RAGFLOW_BASE_URL}/api/documents/{doc_id}"
    resp = requests.delete(url, headers=_auth_headers(), timeout=30)
    if resp.status_code not in (200, 204, 404):
        raise RuntimeError(f"RAG delete failed: {resp.status_code} {resp.text}")

def delete_document_by_id(doc_id: str) -> Dict[str, Any]:
    """
    友善回傳版(供 API 層直接 jsonify)：成功/失敗皆回 dict。
    """
    if not doc_id:
        return {"success": False, "error_type": "ValueError", "error_message": "missing doc_id"}
    try:
        delete_document(doc_id)
        return {"success": True, "deleted_id": doc_id}
    except Exception as e:
        err = _format_exception(e)
        err.update({"success": False})
        return err

# ─────────────────────────── 例外格式化 ───────────────────────────
def _format_exception(e: Exception) -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "error_type": type(e).__name__,
        "error_message": str(e),
        "traceback": traceback.format_exc(),
    }
    resp = getattr(e, "response", None)
    if resp is not None:
        try:
            info["http_status"] = getattr(resp, "status_code", None)
            body = getattr(resp, "text", None) or getattr(resp, "content", None)
            if isinstance(body, (bytes, bytearray)):
                body = body.decode("utf-8", "ignore")
            info["http_body"] = body
        except Exception:
            pass
    return info

# ─────────────────────────── 共同：刪除工具 ───────────────────────────
def _delete_ids_with_dataset(dataset, ids: List[str]) -> None:
    if hasattr(dataset, "delete_documents"):
        dataset.delete_documents(ids=ids)
    elif hasattr(dataset, "delete_document"):
        for i in ids:
            dataset.delete_document(i)
    else:
        raise AttributeError("RAGFlow dataset has no delete_document(s) method")

# ─────────────────────────── 以 display_name 查找 / 刪除 ───────────────────────────
def find_by_display_name_exact(target_name: str, dataset_name: Optional[str] = None) -> Dict[str, Any]:
    """
    只查不刪：以"完全相等"的 name 或 display_name 找出文件。
    回傳：{ success, matches: [{id, name, display_name}], dataset }
    """
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)
    try:
        docs = dataset.list_documents(keywords=target_name) or []
        matches: List[Dict[str, Any]] = []
        for doc in docs:
            _id = getattr(doc, "id", None)
            name = getattr(doc, "name", None)
            display_name = getattr(doc, "display_name", None)
            if _id and (name == target_name or display_name == target_name):
                matches.append({"id": _id, "name": name, "display_name": display_name})
        return {"success": True, "matches": matches, "dataset": ds_name}
    except Exception as e:
        err = _format_exception(e)
        err.update({"success": False, "dataset": ds_name})
        return err

def delete_by_display_name(target_name: str, dataset_name: Optional[str] = None) -> Dict[str, Any]:
    """
    用 display_name(或 name)"完全相等"匹配 → 找到 id → 刪除。
    回傳：
      成功: {"success": True, "matches":[...], "deleted_ids":[...], "dataset": "..."}
      失敗: {"success": False, "error_type":..., "error_message":..., "http_status":..., "http_body":..., "traceback":..., "dataset":"..."}
    """
    client = _client()
    dataset, ds_name = _get_dataset_for(client, dataset_name)
    try:
        lookup = find_by_display_name_exact(target_name, dataset_name=ds_name)
        if not lookup.get("success"):
            return lookup  # 直接把錯誤回去
        matches = lookup.get("matches", [])
        ids = [m["id"] for m in matches if m.get("id")]

        if not ids:
            # 找不到就當作沒東西可刪，不視為錯誤
            return {"success": True, "matches": matches, "deleted_ids": [], "dataset": ds_name}

        _delete_ids_with_dataset(dataset, ids)
        return {"success": True, "matches": matches, "deleted_ids": ids, "dataset": ds_name}
    except Exception as e:
        err = _format_exception(e)
        err.update({"success": False, "dataset": ds_name})
        return err

# ─────────────────────────── 【新增】知識庫(Datasets)列表 ───────────────────────────
def list_datasets_info(keyword: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    """
    列出所有 Dataset (Knowledge Base)
    
    Args:
        keyword: 過濾關鍵字
        limit: 最大回傳數量
    
    Returns:
        List[{"id": str, "name": str, "description": str}]
    """
    try:
        client = _client()
        datasets = client.list_datasets() or []
        results = []
        for ds in datasets[:limit]:
            ds_name = getattr(ds, "name", "")
            # 如果有 keyword，進行過濾
            if keyword and keyword.lower() not in ds_name.lower():
                continue
            results.append({
                "id": getattr(ds, "id", None),
                "name": ds_name,
                "description": getattr(ds, "description", ""),
            })
        return results
    except Exception as e:
        log.error(f"list_datasets_info error: {e}")
        return []

def get_knowledge_bases() -> List[Dict[str, Any]]:
    """
    相容舊端點：/api/knowledge-bases
    直接呼叫 list_datasets_info()
    """
    return list_datasets_info()