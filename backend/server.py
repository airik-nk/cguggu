from waitress import serve
from app import app   # 匯入 app.py 裡的 app 物件

if __name__ == "__main__":
    serve(app, host="127.0.0.1", port=5000, threads=8)
