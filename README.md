---
title: DQA Lab Platform
emoji: 🌡️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
datasets: []
short_description: Environmental test lab management (FastAPI + React + AI)
---

# DQA Lab Platform

[![Tests](https://github.com/shengsheng-cai/dqa-lab-platform/actions/workflows/test.yml/badge.svg)](https://github.com/shengsheng-cai/dqa-lab-platform/actions/workflows/test.yml)
![Playwright](https://img.shields.io/badge/E2E-Playwright-2EAD33?logo=playwright&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Gemini%20%2B%20RAG-4285F4?logo=google&logoColor=white)
![APScheduler](https://img.shields.io/badge/APScheduler-Precision%20Scheduling-FF6B35)
![LINE](https://img.shields.io/badge/LINE-Bot%20Alerts-00C300?logo=line&logoColor=white)
![ISO 17025](https://img.shields.io/badge/ISO%2017025-GUM%20Uncertainty-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)

**Environmental test lab management platform** built with FastAPI + React.  
Automates SOP execution, ISO 17025 report generation, fixture tracking, and AI-assisted scheduling for temperature/humidity chambers.

| | |
|---|---|
| **Automated test suite** | Device state machine · Schedule calculation · Fixture lifecycle · Three-module integration · SOP validation · Measurement uncertainty · Calibration & maintenance CRUD · Frontend utility (Vitest) · Browser E2E (Playwright) |
| **GitHub Actions CI/CD** | Push-triggered gate — backend + frontend + browser E2E; deploy to HF Spaces is blocked if any layer fails |
| **RAG + backend validation** | Gemini Flash-Lite with retrieval-augmented generation — AI output validated server-side before DB write |
| **Three-module integration** | AI → Schedule → Fixture fully automated (reserve → loan → return) |

- 78 built-in test conditions across 5 international standards (IEC 60068 / EN 50155 / IEC 61850-3 / IEC 60945 / DNV)
- GUM-compliant measurement uncertainty analysis (Type A/B → U, k=2)
- AI advisor (Gemini + RAG) — recommend conditions → one-click scheduling
- LINE Bot integration for emergency alerts

**[🚀 Live Demo](https://huggingface.co/spaces/sshengsheng/dqa-lab-platform)** · [中文說明如下](#核心功能)

基於 FastAPI + React 的環境測試實驗室管理平台，整合設備模擬引擎、SOP 執行管理、治具借還追蹤與 AI 法規諮詢，目標取代實驗室紙本作業流程。

---

## 核心功能

| 模組 | 功能摘要 |
|------|---------|
| 🖥️ **控制中心** | 多台溫箱即時監控（溫濕度、狀態、倒數計時）；WebSocket server push 1s 推播取代輪詢；左側欄依分頁顯示排程概況 / 治具摘要 / 人員摘要 / 校驗狀態摘要；📊 感測器 QC 控制圖（24h 歷史 + UCL/LCL mean ± 3σ + 異常點標記）|
| 🔧 **SOP 執行引擎** | 三步驟選法規 → 版本 → 條件，步驟自動確認、admin 手動接管、ISO 17025 報告下載（CSV + PDF） |
| 📊 **量測不確定度** | GUM 合規自動計算：Type A（穩定段重複測量）＋ Type B（感測器解析度）→ 組合 uc → 擴充 U（k=2, 95%），輸出於 PDF 報告 Section 5 |
| 🗄️ **治具借還管理** | 借出 / 歸還 / 逾期追蹤、損壞遺失清單、月盤點、採購閉環、Excel 批次匯入；盤點紀錄批次摺疊 / 整批刪除 / 逐條編輯；排程聯動（預約→自動借出→自動歸還） |
| 🤖 **AI 法規諮詢** | 自然語言查詢、RAG 法規檢索、多輪對話；推薦測試後可直接「📅 申請此測試」預填排程；即時 DB context 注入（設備狀態 / 進行中排程 / 治具借出逾期），不切頁面直接查詢 |
| 🗓️ **排程系統** | 甘特圖永遠可見（固定區塊）、自動排程（排除超時卡機 / EMERGENCY 設備）、審核前即時預覽時段、不可用時段管理；排程確認後 APScheduler date job 精確觸發啟動（每 5 分鐘 fallback）；條件銜接改為人員確認制；確認後治具自動預約 |
| 🚨 **LINE Bot 通知** | 條件完成（等待人員確認）、全部完成、緊急停止 — 主動推播給管理者個人 |
| 👥 **人員管理** | 人員名冊（左）+ 訪客 Token 管理（右）；Token 表支援「隱藏已失效」一鍵過濾 |
| 🔐 **存取控制** | 管理員登入 + 訪客唯讀模式，bcrypt 密碼雜湊，IP Rate Limiting |
| 📋 **稽核日誌** | 所有寫入操作（排程 / 治具 / 設備）記錄 who/what/when；紀錄 Modal 內嵌稽核紀錄 tab，支援 entity 過濾與 CSV 匯出（ISO 17025 外部稽核用） |
| 🔧 **維護** | 設備校驗紀錄（日期、證書號、結果）& 維護紀錄（預防性 / 矯正性 / 例行點檢）；左側欄即時顯示各台設備校驗狀態（正常 / 即將到期 / 逾期 / 未知）；DeviceCard badge 警示 |

<img src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-1.png" width="260"> <img src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-2.png" width="260"> <img src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-3.png" width="260">

---

## 🧪 測試與品質保證（Testing & QA）

這個平台也是我的**軟體測試作品**：把它當成「受測系統」，示範一套完整的 QA 流程，重點是測試深度而不是功能數量。

**分層自動化測試** — 每次 push 由 GitHub Actions 擋關，任一層沒過就不會部署到 Demo：

| 層級 | 工具 | 顧什麼 |
|------|------|--------|
| 後端單元／整合 | pytest（真 in-memory SQLite） | API、狀態機、跨模組一致性、失敗注入與回滾 |
| 前端單元 | Vitest | 純邏輯工具函式 |
| 瀏覽器 E2E | Playwright | 高風險使用者流程（排程、權限、治具、維護、AI 帶入排程）；失敗自動保留截圖與 trace |

**QA 文件（[`docs/qa/`](docs/qa/)）：**

- **[測試策略](docs/qa/test-strategy.md)** — 範圍、風險分層、進出場條件、缺陷生命週期
- **[風險導向測試計畫](docs/qa/risk-based-test-plan.md)** — 風險登記表 × 對應的自動化證據
- **[追溯表](docs/qa/traceability.md)** — 需求 ↔ 風險 ↔ 測試 ↔ 缺陷
- **真實 bug 報告**：[BUG-001](docs/qa/BUG-001-schedule-status-not-refreshed-after-confirm.md)（確認後畫面沒更新）、[BUG-002](docs/qa/BUG-002-maintenance-device-auto-started.md)（維護中設備被自動啟動）、[BUG-003](docs/qa/BUG-003-execution-insert-failure-left-zombie-running-state.md)（啟動失敗留下殭屍狀態）——測試時真的抓到的，都走完「發現 → 記錄 → 修 → 回歸驗證」

> **誠實揭露**：本專案大量使用 AI coding agent（Claude Code／Codex）協作。我負責定義需求、判斷風險、決定測什麼與如何斷言、判讀 bug 與驗收；不宣稱已獨立精通每個框架，也不掛 SDET 頭銜。定位是約 9 年硬體 DQA／可靠度驗證背景，延伸到實驗室流程軟體化與測試自動化，不是純軟體或純 AI。

---

## 支援的國際測試標準

內建 **78 項精確測試條件**：

| 標準 | 版本 | 涵蓋項目 | 條件數 |
|------|------|---------|--------|
| **IEC 60068** | 2-1、2-2、2-14、2-30、2-78 | 冷測、乾熱、溫度循環、濕熱循環 | 17 |
| **EN 50155** | 2017、2007 | 高低溫、隧道溫變、濕熱循環、高溫通電 | 21 |
| **IEC 61850-3** | Ed.2:2013、Ed.1:2002 | 乾熱、冷測、濕熱、高溫高濕穩態 | 19 |
| **IEC 60945** | 2002 | 乾熱儲存/工作、濕熱、低溫儲存/工作 | 7 |
| **DNV** | CG-0339:2015、Std.Cert.2.4 | 穩態/循環濕熱、乾熱 | 14 |

> ⚠️ 系統參數僅供開發驗證，實際測試應以原始法規文件為準。

---

## 5 分鐘體驗完整流程

1. 點 Live Demo → 訪客模式 → 🚀 一鍵訪客體驗
2. 左側看 CH-01/CH-02 正在跑（溫度曲線即時更新）
3. 切換「排程」tab → 看甘特圖與進行中排程
4. 右下角 🤖 → 問「工業乙太網設備要選哪個測試標準？」
5. AI 推薦後按「📅 申請此測試」（需管理員登入才能提交）
6. 切換「治具」tab → 看借出中治具與排程聯動

---

## 快速啟動

**前置需求：** Python 3.13+、Node.js 20+、macOS / Linux / WSL2

```bash
make install                  # 安裝所有依賴
venv/bin/python backend/init_db.py  # 重建並重灌 demo 資料（會清空既有資料）
make dev                      # 啟動全部服務（含 HF 本地預覽）
make test                     # 執行後端 + 前端測試
make test-e2e                 # E2E 瀏覽器測試（自己開測試後端）
```

| 服務 | 網址 |
|------|------|
| 前端 | http://localhost:5173 |
| 後端 API | http://localhost:8000 |
| HF 本地預覽 | http://localhost:7861 |
| API 文件 | http://localhost:8000/docs |

`make dev` 會同時啟動：
- 一般開發模式（`5173` 前端 + `8000` 後端）
- HF 類環境本地預覽（`7861`，使用 `/tmp/dqa-hf-preview.db`，由 `backend/init_db.py` 重新 seed）

HF 本地預覽登入帳密預設跟 `backend/.env` 相同（`ADMIN_PASSWORD` / `DEMO_PASSWORD`），若未設定則 fallback 為 `hf_preview_admin` / `hf_preview_guest`。

複製專案根目錄的 `.env.example` 為 `backend/.env`（後端啟動時讀取）：

```bash
cp .env.example backend/.env
```

Docker / Hugging Face Spaces 部署時不依賴 `backend/.env`，改由平台 Secrets 或環境變數提供相同設定。

**必須設置（可選功能會自動跳過）：**
- `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com) 免費申請（Embedding + Flash-Lite）；免費方案每日限制 20 次 AI 諮詢請求
- `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` — LINE Developers 後台取得（推播功能）

> ⚠️ **AI 諮詢功能限制**：線上版使用 Gemini 免費方案，每日限制 20 次請求，額度用完後顯示提示並隔日自動恢復。完整 demo 建議以本地端執行。
> ⚠️ **Live Demo（HF Spaces）限制**：資料庫使用 `/tmp/demo.db`（重啟會清空）；若未設定 LINE secrets，推播通知功能不啟用。

**可選（RAG 對比測試）：**
- `RAG_EMBED_PROVIDER=gemini`（預設）或 `sentence_transformers`
- `RAG_ST_MODEL=intfloat/multilingual-e5-small`（僅 sentence-transformers 模式）

---

## 技術堆棧

| 層級 | 技術 |
|------|------|
| **後端** | FastAPI、SQLAlchemy 2.0、SQLite、Alembic、APScheduler |
| **前端** | React 19、Vite、Recharts、Axios、react-router-dom |
| **AI** | Gemini API（Flash-Lite）；RAG 檢索自建（Gemini embedding + numpy 餘弦相似度，無向量資料庫框架；embedding 可切換 Gemini / sentence-transformers） |
| **通知** | LINE Messaging API（條件完成 / 測試完成 / 緊急停止推播）|
| **品質** | pytest（後端）· Vitest（前端）· Playwright（E2E）· GitHub Actions CI/CD · Alembic 版本控制遷移 |

---

## 系統架構

```
瀏覽器（React 19）
    │  HTTP / Axios（資料寫入 / 報告下載）
    │  WebSocket /ws/devices（設備狀態 1s server push）
    ▼
FastAPI（後端）
    ├── SQLite（SQLAlchemy 2.0 + Alembic）
    ├── 物理模擬引擎（sim_phase 狀態機，APScheduler 精確排程觸發）
    ├── schedule_service（業務邏輯層：時長計算、自動選機、排程推進）
    ├── AI 諮詢（Gemini Flash-Lite + RAG Embedding）
    └── LINE Messaging API（Webhook 接收 + push_message 推播）
```

資料流向：
```
AI 推薦條件 → [申請此測試] → 排程確認 → 治具預約
                                    ↓
                              SOP 自動啟動
                                    ↓
                     治具借出 → 測試完成 → 治具歸還 + PDF 報告
```

---

## 後續規劃

- [x] WebSocket 即時監控（取代前端 polling）
- [ ] 真實設備通訊 / 設備驅動整合（Phase 3）

---

## Contributing

本專案目前為個人作品集專案，暫不接受外部 PR。

若有問題或功能建議，歡迎開 Issue 討論。商業合作請透過 GitHub 聯絡作者。

---

## 授權

[MIT License](./LICENSE)

本專案採用 MIT 授權。
