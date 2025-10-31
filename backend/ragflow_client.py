import os, requests
from typing import Iterable, Tuple, Dict, Any

BASE = os.getenv("RAGFLOW_BASE_URL", "")
API_KEY = os.getenv("RAGFLOW_API_KEY", "")
DATASET_ID = os.getenv("RAGFLOW_DATASET_ID", "")

def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}

def healthcheck() -> Tuple[bool, str]:
    if not (BASE and API_KEY):
        return False, "RAGFLOW_BASE_URL / RAGFLOW_API_KEY 未設定"
    try:
        # 有些部署會有 /api/v1/ping 或 /api/v1/version；若無，改打個輕量端點
        r = requests.get(f"{BASE}/api/v1/version", headers=_headers(), timeout=8)
        if r.ok:
            return True, r.text
        return False, f"{r.status_code} {r.text}"
    except Exception as e:
        return False, str(e)

def upload_files(file_tuples: Iterable[Tuple[str, bytes, str]]) -> Tuple[bool, Any]:
    """
    :param file_tuples: [(filename, content_bytes, mime), ...]
    :return: (ok, resp_json_or_text)
    """
    if not (BASE and API_KEY and DATASET_ID):
        return False, "RAGFlow 環境變數未完整設定"

    files = [("files", (fn, content, mime or "application/octet-stream"))
             for (fn, content, mime) in file_tuples]

    url = f"{BASE}/api/v1/datasets/{DATASET_ID}/documents"
    try:
        r = requests.post(url, headers=_headers(), files=files, timeout=180)
        if not r.ok:
            return False, f"{r.status_code} {r.text}"
        data = r.json() if "application/json" in r.headers.get("content-type","") else r.text
        ok = (isinstance(data, dict) and data.get("code") == 0) or r.ok
        return ok, data
    except Exception as e:
        return False, str(e)
