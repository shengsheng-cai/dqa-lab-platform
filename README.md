# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的環境測試實驗室數位孿生平台，整合設備模擬引擎、SOP 執行管理、治具借還追蹤與 AI 法規諮詢，目標取代實驗室紙本作業流程。

---

## 為什麼要做這個專案

工業環境測試涉及眾多國際標準，測試人員需手動查閱法規、重複進行參數計算、耗費新人培訓成本。本專案透過數位化解決這些問題：

1. **內建 78 項精確測試條件** — 消除手動查閱的誤差
2. **設備狀態機 + 物理模擬引擎** — 支援離線驗證，無需實體硬體
3. **AI 法規助手** — 用自然語言快速檢索與比較標準
4. **完整追溯記錄** — ISO 17025 格式報告，保證可追溯性
5. **治具借還管理** — 取代紙本紀錄，LINE Bot 即時通知
6. **三層權限控管** — 管理者 / 保管人 / 工程師，後端 token 驗證

---

## 核心功能

### 📊 實時監控儀表板
多台溫箱設備即時監控，顯示溫濕度、運行狀態、倒數計時。支援雙 Y 軸趨勢圖、六種狀態指示、設備熱切換。

### 🔧 SOP 執行引擎
三步驟選擇法規 → 版本 → 測試條件，自動載入參數。支援進度持久化、步驟鎖定、SP+PV 波形疊加、ISO 17025 報告下載。

### 🗄️ 治具借還管理
治具總表、借出登記、歸還確認（支援補填歸還日期）、逾期追蹤、月盤點回填、Excel 批次匯入。保管人中心制，LINE Bot 推播借用人確認。

### 🤖 AI 法規諮詢
自然語言查詢「EN 50155 和 IEC 60068 的濕熱循環有什麼差異？」，系統透過 RAG 檢索法規內容、對比參數、推論說明。對話歷史本機儲存，支援多輪上下文。控制中心右欄常駐顯示迷你版，含快速問題按鈕與對話切換（‹/›箭頭 + 新增 / 清除），無需離開設備監控畫面。

### 🚨 異常與通知
緊急停止事件自動記錄、步驟進度快照。LINE Bot 推播逾期提醒、借出通知、月盤點提醒。

### 👥 人員管理
工程師名冊維護（新增 / 編輯 / 停用 / 刪除），綁定 LINE User ID 供推播使用。Admin only，工程師帳號無法登入系統，僅作為借用人選單來源。同頁管理訪客 Token（可設期限與使用次數上限，停用 / 刪除）。

### 🔐 三層存取控制
帳號登入（token 存 DB，重啟不失效）+ 訪客 Token（管理者在 UI 生成，可設期限與使用次數上限，取代固定密碼）。App 啟動時從後端 `/api/auth/me` 驗證真實 role，防止 localStorage 竄改。IP Rate Limiting：5 次錯誤封鎖 10 分鐘。

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
輪詢分級：Dashboard 狀態 10s、Dashboard 執行紀錄 60s、SOPPage 3s、ErrorLog 60s，隱藏時暫停避免背景耗電。治具頁手動觸發，避免不必要輪詢。

### 多層安全設計
Token 存 DB（重啟不失效、8 小時 TTL）、App 啟動時打 `/api/auth/me` 從後端刷新 role、IP Rate Limiting、401 時 axios interceptor 自動登出跳轉、CORS 環境變數控制。

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
# 後備 Master Key（正常情況改用 UI 管理訪客 Token；本機開發可留空）
DEMO_PASSWORD=your_master_key

# AI 諮詢（可選）
GEMINI_API_KEY=your_key

# LINE 推播（可選）
LINE_CHANNEL_SECRET=your_secret
LINE_CHANNEL_ACCESS_TOKEN=your_token

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
│   │   ├── standards/              # 國際標準測試條件庫（模組化）
│   │   ├── models.py               # SQLAlchemy ORM 定義
│   │   ├── main.py                 # FastAPI 路由 & 應用進入點
│   │   ├── sop.py                  # SOP 執行邏輯
│   │   ├── ai.py                   # Gemini 推理整合
│   │   ├── rag.py                  # RAG 向量檢索 & 智能標準推薦
│   │   ├── auth.py                 # 帳號驗證、token 管理、使用者 CRUD
│   │   ├── fixtures.py             # 治具管理 API（含汰換日期即時計算）
│   │   ├── purchase_orders.py      # 採購清單 CRUD
│   │   ├── fixture_notifications.py # LINE Bot 推播排程（含汰換提醒）
│   │   ├── line.py                 # LINE Messaging API 推播
│   │   ├── reports.py              # ISO 17025 相容報告生成
│   │   └── serial_reader.py        # RS-485 串列通訊（Phase 3 準備）
│   ├── alembic/                    # 資料庫遷移管理
│   ├── init_db.py
│   └── requirements.txt
├── client/
│   ├── src/
│   │   ├── ai/                     # AI 諮詢元件（獨立資料夾）
│   │   ├── components/sop/         # SOP 執行元件（10 個子元件）
│   │   ├── components/control/     # 控制中心元件（RightPanel AI 側欄）
│   │   ├── api.js                  # Axios 實例 + 認證攔截器
│   │   ├── App.jsx                 # Session 管理 → 載入 ControlCenter
│   │   ├── ControlCenter.jsx       # 三欄主框架（TopBar + LeftPanel + CenterPanel）
│   │   ├── FixturePage.jsx         # 治具管理頁
│   │   ├── UsersPage.jsx           # 人員管理頁（admin only）
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── Makefile
├── CLAUDE.md                       # 開發規範 & 技術規格（AI 協作參考）
└── README.md
```

---

## 技術堆棧

| 層級 | 技術 | 選擇理由 |
|------|------|---------|
| **後端** | FastAPI、SQLAlchemy 2.0、SQLite、Alembic、APScheduler | 非同步性能、自動 API 文件、ORM 遷移、排程推播 |
| **前端** | React 18、Vite、Recharts、Axios | 元件化、快速開發、高效渲染、實時圖表 |
| **AI** | Gemini API（Embedding + Flash-Lite）、in-memory RAG | 低成本向量化、高質量推理、免費額度足夠 |
| **通知** | LINE Messaging API + APScheduler | 即時推播、排程掃描、易於自動化 |

---

## API 端點概覽

完整 API 文件：`http://localhost:8000/docs`

主要端點：
- **設備控制**：`GET /api/devices`、`GET /api/device/{id}/data`
- **SOP 管理**：`POST /api/sop/execute`、`GET /api/sop/{id}/report`
- **治具管理**：`GET /api/fixtures/`、`POST /api/fixtures/loans`、`POST /api/fixtures/loans/{id}/return`
- **AI 諮詢**：`POST /api/ai/query`（串流）
- **Auth**：`POST /api/auth/login`、`GET /api/auth/me`、`GET /api/auth/users`、`GET /api/auth/demo-tokens`（訪客 Token 管理）
- **異常紀錄**：`GET /api/error-logs`

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

- [x] 採購清單閉環（缺貨警示 → 採購單 → 到貨入庫）
- [x] 汰換提醒（APScheduler 每週掃描 + LINE Bot 推播）
- [x] 前端控制中心大改版（三欄固定佈局，TopBar + LeftPanel + CenterPanel + AI 側欄，設備選擇器整合、紀錄連結接通）
- [x] AI 右欄對話管理（迷你切換列、新增 / 清除對話、串流效能修復）
- [ ] 排程系統（甘特圖 + 自動時長計算 + 設備衝突檢查）
- [ ] RS-485 真實設備通訊（Phase 3）

---

## 授權

[MIT License](./LICENSE)
