# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制與 AI 法規諮詢。

---

## 為什麼要做這個專案

工業環境測試涉及眾多國際標準，測試人員需手動查閱法規、重複進行參數計算、耗費新人培訓成本。本專案透過數位化解決這些問題：

1. **內建 78 項精確測試條件** — 消除手動查閱的誤差
2. **設備狀態機 + 物理模擬引擎** — 支援離線驗證，無需實體硬體
3. **AI 法規助手** — 用自然語言快速檢索與比較標準
4. **完整追溯記錄** — ISO 17025 格式報告，保證可追溯性

---

## 核心功能

### 📊 實時監控儀表板
多台溫箱設備即時監控，顯示溫濕度、運行狀態、倒數計時。支援雙 Y 軸趨勢圖、六種狀態指示、設備熱切換。

### 🔧 SOP 執行引擎
三步驟選擇法規 → 版本 → 測試條件，自動載入參數。支援進度持久化、步驟鎖定、SP+PV 波形疊加、ISO 17025 報告下載。

### 🤖 AI 法規諮詢
自然語言查詢「EN 50155 和 IEC 60068 的濕熱循環有什麼差異？」，系統透過 RAG 檢索法規內容、對比參數、推論說明。對話歷史本機儲存，支援多輪上下文。

### 🚨 異常與通知
緊急停止和測試完成時自動推播 LINE，含設備名稱、進度、完成時間。詳細異常紀錄支援事後原因分析。

### 🔐 多層存取控制
前端密碼保護 + 8 小時 Session、後端 IP Rate Limiting（5 次失敗後 10 分鐘封鎖）、X-Demo-Password header 驗證、CORS 環境變數控制。

---

## 支援的國際測試標準

內建 **78 項精確測試條件**：

| 標準 | 版本 | 涵蓋項目 | 條件數 |
|------|------|---------|--------|
| **IEC 60068** | 2-1、2-2、2-14、2-30、2-78 | 冷測、乾熱、溫度循環、濕熱循環 | 24 |
| **EN 50155** | 2017、2007 | 高低溫、隧道溫變、濕熱循環、高溫通電 | 18 |
| **IEC 61850-3** | Ed.2:2013、Ed.1:2002 | 乾熱、冷測、濕熱、高溫高濕穩態 | 15 |
| **IEC 60945** | 2002 | 乾熱儲存/工作、濕熱、低溫儲存/工作 | 12 |
| **DNV** | CG-0339:2015、Std.Cert.2.4 | 穩態/循環濕熱、乾熱 | 9 |

> ⚠️ 系統參數僅供開發驗證，實際測試應以原始法規文件為準。

---

## 技術設計亮點

### 分層狀態機
設備狀態層（IDLE ↔ RUNNING ↔ PAUSED → FINISHING）與模擬相位層（idle → ramp → dwell → ramp → ambient）分離，嚴格控制狀態轉移，防止無效操作。EMERGENCY 觸發時自動記錄進度快照。

### 物理模擬引擎
自主實現的溫度模擬器，採用真實時間戳計時（避免累積誤差）、支援多週期循環、伺服器重啟自動恢復、動態計算 SP 波形支援時間壓縮展示。

### RAG 檢索策略
啟動時批次向量化測試條件（20 條/批），快取至本地 pickle 檔案。根據查詢類型採用不同策略：明確指定標準直接檢索、跨標準比較並行檢索、測試類型查詢用向量相似度 + 篩選。未指定標準時自動從對話歷史推斷，無法推斷則預設 IEC 60068。

### 前端性能優化
輪詢分級：Dashboard 狀態 10s、Dashboard 執行紀錄 60s、SOPPage 3s、ErrorLog 60s，隱藏時暫停避免背景耗電。

### 多層安全設計
前端 localStorage session + 8 小時自動踢出，後端 IP Rate Limiting + header 驗證，CORS 環境變數控制，401 錯誤時 axios interceptor 自動登出跳轉。

---

## 快速啟動

### 前置需求
- Python 3.9+
- Node.js 18+
- macOS / Linux / WSL2

### 安裝與啟動

```bash
# 1. 安裝所有依賴
make install

# 2. 初始化資料庫（首次執行）
python backend/init_db.py

# 3. 啟動全部服務
make dev
```

### 本地服務

| 服務 | 網址 | 說明 |
|------|------|------|
| 前端 | http://localhost:5173 | React UI |
| 後端 API | http://localhost:8000 | FastAPI 伺服器 |
| API 文件 | http://localhost:8000/docs | Swagger 互動式文件 |
| ngrok 面板 | http://localhost:4040 | LINE Webhook 除錯 |

### 環境變數設定

複製 `backend/.env.example`，填入必要的變數：

```bash
DEMO_PASSWORD=your_password

# AI 諮詢（可選）
GEMINI_API_KEY=your_key

# LINE 推播（可選）
LINE_CHANNEL_SECRET=your_secret
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_USER_ID=your_id

# 資料庫 & CORS
DATABASE_URL=sqlite:///./dqa_lab.db
ALLOWED_ORIGINS=http://localhost:5173
```

### 常見問題

**Q: Alembic 相關錯誤**  
A: 執行 `python backend/init_db.py` 初始化資料庫

**Q: LINE Bot 推播無反應**  
A: 重新開啟終端，重新執行 `make dev`（ngrok URL 會重新生成）

**Q: 前端無法連線後端**  
A: 確認 `backend/.env` 的 `ALLOWED_ORIGINS` 設定是否正確

---

## 專案結構

```
dqa-lab-digital-twin/
├── backend/
│   ├── app/
│   │   ├── standards/        # 國際標準測試條件庫（模組化）
│   │   ├── models.py         # SQLAlchemy ORM 定義
│   │   ├── main.py           # FastAPI 路由 & 應用進入點
│   │   ├── sop.py            # SOP 執行邏輯
│   │   ├── ai.py             # Gemini 推理整合
│   │   ├── rag.py            # RAG 向量檢索 & 智能標準推薦
│   │   ├── auth.py           # 存取控制（密碼驗證、Rate Limiting、Session）
│   │   ├── line.py           # LINE Messaging API 推播
│   │   ├── reports.py        # ISO 17025 相容報告生成
│   │   ├── serial_reader.py  # RS-485 串列通訊（Phase 3 準備）
│   │   ├── errors.py         # 自訂例外類別
│   │   └── utils.py          # 工具函式
│   ├── alembic/              # 資料庫遷移管理
│   ├── init_db.py
│   ├── rag_cache.pkl         # RAG 向量快取
│   └── requirements.txt
├── client/
│   ├── src/
│   │   ├── ai/               # AI 諮詢元件（獨立資料夾）
│   │   ├── components/sop/   # SOP 執行元件（10 個子元件）
│   │   ├── api.js            # Axios 實例 + 認證攔截器
│   │   ├── App.jsx           # 路由 & Session 管理
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── simulator/                # 溫箱物理模擬引擎
├── docs/                     # 演示檔案與報告範本
├── Makefile
├── AGENTS.md                 # 開發規範 & 技術規格（內部參考）
└── README.md
```

---

## 技術堆棧

| 層級 | 技術 | 選擇理由 |
|------|------|---------|
| **後端** | FastAPI、SQLAlchemy 2.0、SQLite、Alembic、asyncio | 非同步性能、自動 API 文件、ORM 遷移管理 |
| **前端** | React 18、Vite、Recharts、Axios | 元件化、快速開發、高效渲染、實時圖表 |
| **AI** | Gemini API（Embedding + Flash-Lite）、in-memory RAG | 低成本向量化、高質量推理、免費額度足夠 |
| **通知** | LINE Messaging API | 即時通知、易於自動化 |

---

## 功能演示

**儀表板 — 多設備即時監控**
![Dashboard](./docs/dashboard.gif)

**SOP 執行 — 法規與條件選擇**
![SOP](./docs/sop.gif)

**AI 法規諮詢 — 自然語言查詢**
![AI](./docs/ai.gif)

**異常紀錄 — 事件追蹤**
![ErrorLog](./docs/errorlog.gif)

---

## API 端點概覽

完整 API 文件：`http://localhost:8000/docs`

主要端點：
- **設備控制**：`GET /api/devices`、`GET /api/device/{id}/data`
- **SOP 管理**：`POST /api/sop/execute`、`GET /api/sop/{id}/report`
- **AI 諮詢**：`POST /api/ai/query`（串流）
- **異常通知**：`POST /api/emergency-stop`、`GET /api/error-logs`
- **報告生成**：`GET /api/sop/{id}/report?format=csv`

---

## 開發指南

### 資料庫遷移

```bash
cd backend

# 自動生成遷移指令碼
alembic revision --autogenerate -m "描述你的變更"

# 應用遷移至資料庫
alembic upgrade head
```

### 常用指令

```bash
make install      # 安裝所有依賴（含 pip 和 npm）
make dev          # 啟動全部服務
make clean        # 清理殘留程序
```

---

## 後續規劃

- **AI 治具管理助手**：根據測試條件自動推薦合適治具
- **AI 設備排程預估**：基於待測項目估算完整測試時間
- **Phase 3**：RS-485 真實設備通訊、治具資料庫、JWT 認證、步驟自動確認

---

## 貢獻指南

本專案為個人學習專案，歡迎提供建議或參考。如有任何想法或改進建議，請透過 GitHub Issues 聯繫。

---

## 授權

[MIT License](./LICENSE)