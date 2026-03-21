# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制與 AI 法規諮詢。

---

## 功能展示

本專案涵蓋以下核心功能：
- **Dashboard**：多台設備實時監控、趨勢圖表、狀態指示
- **SOP 執行**：三步驟法規選擇、波形曲線疊加、執行紀錄儲存
- **AI 法規諮詢**：自然語言查詢、RAG 精準檢索、串流回答
- **異常處理**：緊急停止、事件推播、詳細日誌

詳見下方「快速啟動」章節。

---

### Demo
![Demo](./docs/demo.gif)

---

## 快速啟動（本地開發）

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

# 3. 啟動（同時啟動後端、前端、模擬器）
make dev
```

### 本地服務網址

| 服務 | 網址 | 說明 |
|------|------|------|
| 前端 | http://localhost:5173 | React UI |
| 後端 API | http://localhost:8000 | FastAPI 伺服器 |
| API 文件 | http://localhost:8000/docs | Swagger 互動式文件 |
| ngrok 面板 | http://localhost:4040 | LINE Webhook 用 |

### 環境變數設定

在 `backend/.env` 中設定（使用 `.env.example` 作為範本）：

```bash
# 必須設定
DEMO_PASSWORD=your_password_here

# AI 諮詢功能（可選，無此功能時系統仍可運作）
GEMINI_API_KEY=your_gemini_api_key

# LINE Bot 推播（可選）
LINE_CHANNEL_SECRET=your_secret
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_USER_ID=your_user_id

# 資料庫
DATABASE_URL=sqlite:///./dqa_lab.db

# CORS 設定（本地默認為 http://localhost:5173）
ALLOWED_ORIGINS=http://localhost:5173
```

### 常見問題

**Q: 啟動時出現 `alembic` 相關錯誤**  
A: 執行 `python backend/init_db.py` 初始化資料庫

**Q: LINE Bot 推播無效**  
A: 重新開啟終端機，重新執行 `make dev`（ngrok URL 需要更新）

**Q: 前端無法連線後端**  
A: 確認 `backend/.env` 中的 `ALLOWED_ORIGINS` 是否正確

---

## 專案背景

工業環境測試涉及眾多國際標準，測試人員即使按照 SOP，仍需大量人工比對法規參數。細微判讀差異就可能導致條件設定錯誤，加上標準版本更迭頻繁、新人培訓成本高，整個流程對人力依賴程度極高。

本專案將測試流程數位化，內建國際環境測試標準的完整條件庫。操作人員透過三步驟選擇法規、版本、測試條件後，參數自動帶入，無需手動比對文件。搭配物理模擬引擎，在硬體不在場時也能完整執行開發與驗證流程。

---

## 核心功能

### 📊 Dashboard（儀表板）
- 多台溫箱各自獨立模擬，即時顯示溫濕度、設備狀態、倒數計時
- 雙 Y 軸趨勢圖，支援完整多 cycle 低溫循環模擬
- 設備狀態六種顏色指示（Idle / Running / Paused / Finishing / Emergency / Error）

### 🔧 SOP 執行
- 三步驟選擇：法規 → 版本 → 測試條件
- 伺服器重啟後自動還原進度
- 步驟依序勾選、連鎖清除、Optional 跳過
- SP+PV 波型曲線即時疊加展示
- 執行完成後自動儲存紀錄（含操作人員），支援 ISO 17025 CSV 格式下載

### 🤖 AI 法規諮詢
- 自然語言輸入需求，RAG 從條件庫精準檢索
- 串流逐字輸出，支援多輪對話
- 對話管理與持久化（localStorage）

### 🚨 異常與通知
- EMERGENCY 與測試完成自動推播 LINE
- 詳細的異常紀錄（含步驟進度、時間戳）
- IP Rate Limiting 防護

### 🔐 存取控制
- 前端登入頁密碼保護，Session 8 小時自動過期
- 後端 IP Rate Limiting（錯誤 5 次封鎖 10 分鐘）
- CORS 環境變數控制

---

## 支援的環境測試標準

本系統內建以下國際環保測試標準，涵蓋工業、鐵道、海事、變電站等領域：

| 法規 | 版本 | 主要測試項目 |
|------|------|------------|
| **IEC 60068** | 2-1 / 2-2 / 2-14 / 2-30 / 2-78 | 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環 Na/Nb、濕熱循環 Db |
| **EN 50155** | 2017 / 2007 | OT1~OT6 高低溫、隧道溫變、濕熱循環、高溫通電 |
| **IEC 61850-3** | Ed.2:2013 / Ed.1:2002 | Class C1/C2/C3 乾熱、冷測、濕熱、高溫高濕穩態 |
| **IEC 60945** | 2002 | 乾熱儲存/工作、濕熱、低溫儲存/工作 |
| **DNV** | CG-0339:2015 / Std.Cert.2.4 | Class A/B/C/D 穩態/循環濕熱、乾熱 |

> ⚠️ **免責聲明**  
> 系統內建參數僅供初步評估，實際測試條件請以原始法規文件為準，並由授權工程師確認。

---

## 技術堆棧

| 層 | 技術 |
|----|------|
| **後端** | FastAPI、SQLAlchemy 2.0、SQLite、Alembic、asyncio、numpy |
| **前端** | React 18、Vite、Recharts、Axios |
| **AI** | Gemini API (Embedding + Flash-Lite)、RAG in-memory |
| **通知** | LINE Messaging API |
| **環境** | Python 3.9+、Node.js 18+、macOS/Linux |

---

## 專案結構

```
dqa-lab-digital-twin/
├── backend/
│   ├── app/
│   │   ├── standards/        # 78 個測試條件庫
│   │   ├── models.py         # SQLAlchemy ORM
│   │   ├── sop.py            # SOP 邏輯
│   │   ├── ai.py             # RAG + Gemini 整合
│   │   ├── line_bot.py       # LINE 推播
│   │   └── main.py           # FastAPI 路由
│   ├── alembic/              # 資料庫遷移
│   ├── init_db.py            # 初始化腳本
│   └── .env.example
├── client/                   # React 前端
│   ├── src/
│   │   ├── components/       # React 元件
│   │   ├── api.js            # Axios 設定
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── vite.config.js
├── simulator/                # 溫箱物理模擬
├── Makefile                  # 便利指令
├── requirements.txt          # Python 依賴
├── package.json              # Node 依賴
└── README.md
```

---

## API 端點概覽

完整 API 文件請於本地運行後訪問 `http://localhost:8000/docs`

主要端點包括：
- **設備控制**：即時狀態查詢、歷史數據、進度更新
- **SOP 管理**：標準樹查詢、執行啟動、紀錄儲存
- **異常通知**：緊急停止、暫停/恢復、狀態轉移
- **AI 諮詢**：串流查詢、多輪對話
- **報告生成**：ISO 17025 格式 CSV 下載

---

## 開發指南

### 資料庫結構變更

```bash
cd backend

# 修改 models.py 後執行
alembic revision --autogenerate -m "描述你的變更"

# 應用遷移
alembic upgrade head
```

### 前端元件開發

前端元件分為三個主要區域：
- `components/sop/` — SOP 執行相關元件（10 個子元件）
- `components/ai/` — AI 諮詢相關元件
- `其他` — Dashboard、ErrorLog、App 路由

### 常用指令

```bash
make install      # 安裝所有依賴（含 pip 和 npm）
make dev          # 啟動全部服務
make clean        # 清理殘留程序
```

---

## 貢獻指南

本專案為個人學習專案，歡迎參考或建議改進。如有任何建議，請透過 GitHub Issues 聯繫。

---

## 授權

[MIT License](./LICENSE)

---