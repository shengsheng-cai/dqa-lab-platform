---
title: DQA Lab Platform
emoji: 🌡️
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
license: mit
short_description: Environmental lab workflow and QA automation portfolio
---

# DQA Lab Platform

**環境試驗室流程平台，也是風險導向測試與 QA Automation 作品。**

[![Tests](https://github.com/shengsheng-cai/dqa-lab-platform/actions/workflows/test.yml/badge.svg)](https://github.com/shengsheng-cai/dqa-lab-platform/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

[🚀 開啟 Live Demo](https://huggingface.co/spaces/sshengsheng/dqa-lab-platform) ·
[🧪 查看 QA 證據](#qa-與自動化測試) ·
[⚙️ 本機執行](#本機執行)

<img
  src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/control-center.png"
  alt="DQA Lab 控制中心：設備狀態、溫度趨勢與低溫冷測 SOP 執行畫面"
  width="100%"
/>

_控制中心整合設備監控、即時趨勢與可追蹤的 SOP 執行步驟。_

DQA Lab 把溫濕度試驗室的設備監控、SOP、排程、治具與報告串成一條可追蹤的流程，
並以它作為受測系統，示範如何從風險分析一路做到自動化測試、缺陷報告與 CI 擋關。

## 這個專案在解決什麼

環境試驗流程常散落在紙本 SOP、Excel、設備面板與人工通知中。DQA Lab 將它們收斂到同一個平台：

- **實驗室流程**：從測試申請、設備排程、SOP 執行到報告輸出。
- **資產連動**：治具隨排程自動預約、借出與歸還，保留完整異動紀錄。
- **品質證據**：以風險導向測試、分層自動化與真實缺陷報告驗證核心流程。

## 作者角色

我以約 9 年硬體 DQA／可靠度驗證經驗定義這個系統的領域需求、風險與驗收標準：
測什麼、如何斷言、缺陷如何判讀、修正是否符合實驗室流程，都由我決定。
實作與程式碼審查借助 Claude Code、Codex 等 AI coding agent。

## QA 與自動化測試

這不只是功能展示，而是一個刻意建立的受測系統。測試重點放在狀態一致性、跨模組交易、權限邊界、日期時區與失敗回滾，而不是單純追求測試數量。

| 測試層級 | 工具 | 驗證重點 |
|---|---|---|
| 後端單元／整合 | pytest + in-memory SQLite | API、設備狀態機、排程、治具生命週期、交易回滾、時間正規化 |
| 前端邏輯 | Vitest | 日期時區、驗證、錯誤訊息、下載檔名與執行紀錄存檔欄位 |
| 瀏覽器流程 | Playwright | 排程、權限、治具、維護、人員管理與 AI 帶入排程 |
| 持續整合 | GitHub Actions | lint、後端、前端與 E2E 全數通過後才部署 Demo |

### 精選缺陷案例與回歸證據

以下案例都有可核對的影響、修正與回歸證據；部分在修正當下記錄，部分由後續審查
依 Git 與測試證據整理，個別報告會明示時序。這是作品集精選，不是完整缺陷資料庫：

| 缺陷 | 使用者影響 | 回歸重點 |
|---|---|---|
| [BUG-003](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md) | 啟動失敗後設備留下殭屍狀態 | 原子交易與失敗回滾 |
| [BUG-009](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-009-report-test-item-section-identified-the-chamber-not-the-sample.zh-TW.md) | 報告的「受測樣品」欄位印的是試驗箱編號 | 執行紀錄連回案件，連不到時明講 |
| [BUG-010](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-010-concurrent-loan-and-schedule-both-claimed-the-last-fixture.zh-TW.md) | 庫存只剩一件，手動借出與排程確認卻同時借走 | 配置前先取得寫入鎖，可借量從讀到寫都算數 |
| [BUG-011](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-011-websocket-handshake-carried-a-long-lived-admin-token.zh-TW.md) | 畫面沒有異常，但管理員憑證被寫進伺服器日誌 | 憑證不進網址，握手改用 30 秒一次性入場券 |
| [BUG-012](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-012-dead-simulator-task-still-reported-a-healthy-service.zh-TW.md) | 模擬器停掉後溫度與排程全部停住，服務卻仍回報自己正常 | 探測跟著核心背景工作的存活走，工作的例外一定被讀取 |
| [BUG-013](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/BUG-013-declared-foreign-keys-were-never-enforced.zh-TW.md) | 刪掉使用者或排程後，指向它的資料仍留著已不存在的 ID | 外鍵真的生效，並由 schema 說明父列被刪時子列怎麼辦 |

QA 文件皆為中英雙語，每份開頭可切換語言：

[測試策略](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/test-strategy.zh-TW.md) ·
[風險導向測試計畫](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/risk-based-test-plan.zh-TW.md) ·
[需求與測試追溯表](https://github.com/shengsheng-cai/dqa-lab-platform/blob/main/docs/qa/traceability.zh-TW.md) ·
[全部 QA 文件](https://github.com/shengsheng-cai/dqa-lab-platform/tree/main/docs/qa)

## 核心流程

```text
AI 推薦測試條件
        ↓
申請與確認排程 ──→ 治具預約
        ↓
設備啟動 + SOP 執行 ──→ 治具借出
        ↓
條件完成，等待人員確認
        ↓
下一條件／測試完成 ──→ 治具歸還 + PDF／CSV 報告
```

## 核心能力

| 能力 | 說明 |
|---|---|
| 即時設備監控 | WebSocket 推播溫濕度、設備狀態、倒數與感測器 QC 控制圖 |
| SOP 與報告 | 依標準與條件執行 SOP，輸出 CSV、PDF 與 GUM 量測不確定度 |
| 排程與治具 | 自動選機、衝突檢查、不可用時段，以及治具預約／借出／歸還連動 |
| AI 法規諮詢 | Gemini + RAG 查詢測試條件，推薦結果可帶入排程申請 |
| 稽核與維護 | 管理員／訪客權限、稽核日誌、設備校驗與維護紀錄 |
| LINE Bot | 主動推播條件完成、測試完成、測試中止與緊急停止；支援設備總覽與單機狀態查詢 |

### LINE Bot 通知範例

<p align="center">
  <img
    src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-1.png"
    width="30%"
    alt="LINE Bot 緊急停止推播與設備狀態查詢"
  />
  <img
    src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-2.png"
    width="30%"
    alt="LINE Bot 設備總覽與單機狀態查詢"
  />
  <img
    src="https://raw.githubusercontent.com/shengsheng-cai/dqa-lab-platform/main/docs/line-3.png"
    width="30%"
    alt="LINE Bot 排程取消與自動降溫收尾通知"
  />
</p>

<p align="center"><sub>左：緊急停止推播與狀態查詢｜中：設備總覽與單機狀態｜右：排程取消與自動降溫收尾通知</sub></p>

## 支援的測試標準

內建 5 套國際標準、共 78 項測試條件：

| 標準 | 版本／範圍 | 條件數 |
|---|---|---:|
| IEC 60068 | 2-1、2-2、2-14、2-30、2-78 | 17 |
| EN 50155 | 2017、2007 | 21 |
| IEC 61850-3 | Ed.2:2013、Ed.1:2002 | 19 |
| IEC 60945 | 2002 | 7 |
| DNV | CG-0339:2015、Std.Cert.2.4 | 14 |

> 系統參數僅供開發與流程驗證；正式測試應以合法取得的原始標準文件為準。

## 5 分鐘 Demo 導覽

1. 開啟 [Live Demo](https://huggingface.co/spaces/sshengsheng/dqa-lab-platform)，選擇「一鍵訪客體驗」。
2. 在控制中心查看 CH-01／CH-02 的即時狀態與溫濕度曲線。
3. 切到排程頁，查看甘特圖、進行中排程與設備占用。
4. 切到治具頁，查看排程連動產生的預約與借出紀錄。
5. 打開右下角 AI 助理，詢問：「工業乙太網設備要選哪個測試標準？」

訪客模式可瀏覽完整 Demo 資料；新增、修改與送出排程需要管理員權限。

## 系統架構

```text
React 19
  ├─ HTTP / Axios ───────────────┐
  └─ WebSocket /ws/devices ─────┤
                                 ↓
FastAPI
  ├─ schedule_service：排程與跨模組交易
  ├─ DeviceStateManager：設備狀態唯一 owner
  ├─ simulator：溫濕度與測試相位模擬
  ├─ Gemini + RAG：法規諮詢
  └─ LINE Messaging API：主動推播與設備查詢
                                 ↓
                   SQLite + SQLAlchemy + Alembic
```

| 層級 | 技術 |
|---|---|
| Backend | Python 3.13、FastAPI、SQLAlchemy 2.0、APScheduler |
| Frontend | React 19、Vite、Recharts、Axios |
| AI | Gemini Flash-Lite、自建 RAG retrieval |
| Reports | ReportLab、pandas、openpyxl |
| Quality | pytest、Vitest、Playwright、Ruff、ESLint、GitHub Actions |

## 本機執行

需求：Python 3.13、Node.js 24，以及 macOS／Linux／WSL2。

```bash
python3.13 -m venv venv
make install
cp .env.example backend/.env
venv/bin/python backend/init_db.py  # 會重建本機 demo 資料
make dev
```

若 `backend/.env` 設有 `LINE_CHANNEL_ACCESS_TOKEN`，`make dev` 取得 ngrok HTTPS URL 後會
自動把 LINE Webhook 更新為本機的 `/api/line/webhook`。

啟動後可使用：

| 服務 | 網址 |
|---|---|
| 前端 | http://localhost:5173 |
| 後端 API | http://localhost:8000 |
| API 文件 | http://localhost:8000/docs |
| HF 本地預覽 | http://localhost:7861 |

```bash
make test       # pytest + Vitest
make test-e2e   # Playwright，會自行啟動隔離的測試後端
make lint       # Ruff + ESLint
```

首次執行 E2E 前，另安裝測試套件與 Chromium（`make install` 只安裝應用程式本身的
後端與前端依賴）：

```bash
npm ci --prefix tests/e2e
npx --prefix tests/e2e playwright install chromium
```

### 可選整合

| 功能 | 環境變數 |
|---|---|
| Gemini 諮詢與 embedding | `GEMINI_API_KEY` |
| LINE 主動推播 | `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID` |
| LINE 設備查詢（Webhook） | `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` |

外部 AI 服務的免費額度與速率限制以供應商當下政策為準；未設定可選整合時，核心 Demo 仍可執行。

## Demo 限制

- `main` 是純模擬 Demo，不控制真實環境試驗設備。
- Hugging Face Spaces 使用 `/tmp` SQLite，容器重啟後會重新建立示範資料。
- 未設定 LINE secrets 時不會真的發送 LINE 通知；是否啟用由部署環境變數決定。

## 關於這個專案

這是個人作品集專案，不以持續擴增功能為目標，也不接受外部貢獻。
對其中的測試策略、架構取捨或缺陷分析有興趣，歡迎透過 GitHub 個人檔案聯絡討論。

## License

[MIT License](./LICENSE)
