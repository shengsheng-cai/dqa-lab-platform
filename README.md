# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制與 AI 法規諮詢。

---

## 線上 Demo

| 服務 | 網址 |
|------|------|
| 前端（Vercel） | https://dqa-lab-digital-twin-icvw-9m0ygc6ob.vercel.app |
| 後端 API（Railway） | https://dqa-lab-digital-twin-production.up.railway.app |

> ⚠️ Railway 後端為 Trial 方案，展示前請先至 Railway Dashboard Redeploy。
> 前端 Vercel 為 24 小時常駐，無需重啟。

---

## 快速啟動（本地開發）

```bash
# 1. 安裝所有依賴
make install

# 2. 初始化資料庫（首次執行）
python backend/init_db.py

# 3. 啟動
make dev
```

`make dev` 會同時啟動後端、前端、模擬器，並自動啟動 ngrok 更新 LINE Webhook。

| 服務 | 網址 |
|------|------|
| 前端 | http://localhost:5173 |
| 後端 API | http://localhost:8000 |
| API 文件 | http://localhost:8000/docs |
| ngrok 面板 | http://localhost:4040 |

> ⚠️ AI 諮詢功能需在 `backend/.env` 設定 `GEMINI_API_KEY`（[Google AI Studio](https://aistudio.google.com) 免費申請）

> ⚠️ LINE Bot 功能需在 `backend/.env` 設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`

> ⚠️ Demo 存取密碼需在 `backend/.env` 設定 `DEMO_PASSWORD`，前端登入頁會要求輸入，Session 有效期限 8 小時

> ⚠️ DB 結構有變更時，在 `backend/` 目錄下執行：`alembic revision --autogenerate -m "描述"` → `alembic upgrade head`

---

## 重新部署（Railway 後端）

Railway Trial 方案不支援自動休眠，不使用時建議 Remove deployment。需要展示時：

```bash
# 方法一：推空 commit 觸發 Railway 自動重新部署
git commit --allow-empty -m "chore: redeploy to Railway"
git push

# 方法二：至 Railway Dashboard → ⋮ → Redeploy
```

---

## 專案背景

工業環境測試涉及眾多國際標準，即使有 SOP 可循，測試人員仍需大量人工比對法規參數，細微判讀差異就可能導致條件設定錯誤。加上標準版本更迭頻繁、新人培訓成本高，整個流程對人力依賴程度極高。

本專案將測試流程數位化，把 5 大國際標準的 78 個測試條件直接內建進系統。操作人員透過三步驟選擇法規、版本、測試條件後，參數自動帶入，無需手動比對文件。搭配物理模擬引擎，在硬體不在場時也能完整執行開發與驗證流程。

---

## 核心功能

**監控**
- 5 台溫箱各自獨立模擬，即時溫濕度、六種狀態顏色、雙 Y 軸趨勢圖、倒數計時器
- 低溫（< 0°C）自動隱藏濕度；物理模擬支援完整多 cycle 低溫循環

**SOP 執行**
- 三步驟法規選擇（法規 → 版本 → 測試條件），伺服器重啟後自動還原
- 步驟依序勾選、連鎖清除、Optional 跳過，SP+PV 波型曲線即時疊加
- 執行完成後儲存紀錄（含操作人員），下載 ISO 17025 格式 CSV 報告

**通知**
- EMERGENCY 與測試完成自動推播 LINE
- LINE Bot 支援 Flex Message 卡片、Quick Replies 一鍵查詢，無需打字

**AI 法規諮詢**
- 自然語言描述需求，RAG 從 78 個測試條件精準檢索
- 串流逐字輸出、多對話管理、專案分組、對話持久化

**存取控制**
- 前端登入頁密碼保護，Session 8 小時自動過期
- 後端 IP Rate Limiting，錯誤 5 次封鎖 10 分鐘
- CORS preflight 與 LINE Webhook 路徑自動豁免

---

## 支援的環境測試標準（78 個測試條件）

| 法規 | 版本 | 測試數 | 主要測試項目 |
|------|------|--------|------------|
| **IEC 60068** | 2-1 / 2-2 / 2-14 / 2-30 / 2-78 | 17 | 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環 Na/Nb、濕熱循環 Db、高溫高濕穩態 Cab |
| **EN 50155** | 2017 / 2007 | 21 | OT1~OT6 高低溫、ST1 開機延伸、隧道溫變、濕熱循環、OT4 高溫通電 |
| **IEC 61850-3** | Ed.2:2013 / Ed.1:2002 | 19 | Class C1/C2/C3 各自乾熱、冷測、濕熱、高溫高濕穩態 |
| **IEC 60945** | 2002 | 7 | 乾熱儲存/工作、濕熱 Db、低溫儲存/工作 |
| **DNV** | CG-0339:2015 / Std.Cert.2.4 | 14 | Class A/B/C/D 穩態/循環濕熱、乾熱 |

> ⚠️ 系統內建參數僅供初步評估，實際條件請以原始法規文件為準，並由授權工程師確認。

---

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/devices` | 所有設備即時狀態 |
| GET | `/api/devices/{id}/history` | 設備歷史溫濕度 |
| GET | `/api/sop/standards/tree` | 三層標準樹（含 steps） |
| POST | `/api/sop/start` | 啟動 SOP |
| POST | `/api/devices/{id}/progress` | 更新步驟完成數 |
| POST | `/api/sop-executions/` | 儲存執行紀錄 |
| GET | `/api/reports/csv/{id}` | 下載 ISO 17025 CSV 報告 |
| GET | `/api/reports/list` | 執行紀錄列表 |
| GET | `/api/errors/` | 異常紀錄列表（最多 500 筆） |
| POST | `/api/stop/{device_id}/emergency` | 緊急停止（防重複觸發） |
| POST | `/api/stop/{device_id}/pause` | 暫停切換 |
| POST | `/api/stop/{device_id}/normal` | 正常停止（自動降溫） |
| POST | `/api/ai/standards-query-stream` | AI 法規諮詢（串流） |

> 所有 API 需在 Header 帶 `X-Demo-Password`，否則回傳 401。

---

## 技術堆棧

| 層 | 技術 |
|----|------|
| 後端 | FastAPI、SQLAlchemy 2.0、SQLite、Alembic、asyncio、numpy |
| 前端 | React 18、Vite、Recharts、Axios |
| AI | Gemini Embedding API、Gemini 2.5 Flash-Lite、RAG in-memory |
| 通知 | LINE Messaging API、ngrok |
| 部署 | Railway（後端）、Vercel（前端） |
| 環境 | Python 3.9+、Node.js 18+、macOS/Linux |

---

## 延伸文件

- [AI Agent 開發規範與專案背景](./AGENTS.md)
- [QA 測試報告模板](./docs/templates/QA_Test_Report_Template.docx)

## 授權

MIT License