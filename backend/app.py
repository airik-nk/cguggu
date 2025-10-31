import os
import sys
import logging
import traceback
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from models import db
from api import api as api_blueprint

# Logging
logging.basicConfig(
    level=logging.DEBUG if os.getenv("DEBUG", "1") == "1" else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logging.getLogger("ragflow").setLevel(logging.DEBUG)  # 讓 ragflow_service 的 log 也輸出

load_dotenv()
BASE_DIR = Path(__file__).parent


def create_app() -> Flask:
    app = Flask(__name__)

    # ── 基本設定 ─────────────────────────────────────────────────────────────
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-only-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///reglaw.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    upload_dir = os.getenv("UPLOAD_DIR") or str(BASE_DIR / "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    app.config["UPLOAD_FOLDER"] = upload_dir
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

    # DB
    db.init_app(app)
    with app.app_context():
        db.create_all()

    # CORS
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # 藍圖
    app.register_blueprint(api_blueprint)

    # ── 統一錯誤處理：回傳 JSON（含 traceback / 上游 HTTP 細節） ─────────────
    @app.errorhandler(HTTPException)
    def handle_http_error(e: HTTPException):
        payload = {
            "success": False,
            "error_type": type(e).__name__,
            "error_message": e.description,
            "status": e.code,
        }
        return jsonify(payload), e.code

    @app.errorhandler(Exception)
    def handle_exception(e: Exception):
        """
        捕捉未處理例外，將錯誤資訊以 JSON 形式回傳，包含：
        - error_type / error_message / traceback
        - 若例外來源於 requests/SDK，盡可能附上 http_status / http_body
        """
        payload = {
            "success": False,
            "error_type": type(e).__name__,
            "error_message": str(e),
            "traceback": traceback.format_exc(),
        }
        # 嘗試附帶上游 HTTP 回應資訊（若存在）
        resp = getattr(e, "response", None)
        if resp is not None:
            try:
                payload["http_status"] = getattr(resp, "status_code", None)
                body = getattr(resp, "text", None) or getattr(resp, "content", None)
                if isinstance(body, (bytes, bytearray)):
                    body = body.decode("utf-8", "ignore")
                payload["http_body"] = body
            except Exception:
                pass
        return jsonify(payload), 500

    return app


# 供 WSGI / 直接執行兩用
app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
