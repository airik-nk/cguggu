project-root/
├── backend/
│   ├── app.py                # Flask 主程式，註冊 API Blueprint:contentReference[oaicite:0]{index=0}
│   ├── api.py                # 文件 CRUD、版本管理、RAGFlow 同步 API:contentReference[oaicite:1]{index=1}
│   ├── models.py             # SQLAlchemy 資料表定義:contentReference[oaicite:2]{index=2}
│   ├── ragflow_service.py    # RAGFlow SDK 包裝：上傳、查詢狀態、重觸發等:contentReference[oaicite:3]{index=3}
│   └── .env          	  # 後端環境變數
│
├── frontend/
│   ├── App.tsx               # 前端主頁「法規文件中心」:contentReference[oaicite:4]{index=4}
│   ├── main.tsx              # React 入口，需掛載到 /reg
│   ├── index.css             # 全域樣式:contentReference[oaicite:5]{index=5}
│   ├── App.css               # Vite 預設樣式（非必要）:contentReference[oaicite:6]{index=6}
│   ├── api.ts                # 前端呼叫後端 API 方法
│   ├── types.ts              # TS 型別定義
│   └── components/
│       ├── UploadDialog.tsx  # 上傳文件對話框:contentReference[oaicite:7]{index=7}
│       ├── DocRow.tsx        # 文件列（版本狀態、刪除、RAGFlow 工具）:contentReference[oaicite:8]{index=8}
│       ├── RagDocsPanel.tsx  # RAGFlow dataset 文件列表:contentReference[oaicite:9]{index=9}
│       └── FilesPanel.tsx    # 伺服器檔案掃描列表:contentReference[oaicite:10]{index=10}
│
└── README.md                 # 本文件
