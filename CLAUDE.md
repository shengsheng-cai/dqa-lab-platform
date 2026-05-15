# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 🧬 DQA Lab Platform — AI Agent Context

給 AI 協作工具閱讀的專案背景與開發規範。

---

## 技術棧

| 層 | 技術 |
|----|------|
| 後端 | FastAPI + SQLAlchemy 2.0 + SQLite + APScheduler |
| 前端 | React 19 + Vite 7 + Recharts（目錄：`client/`） |
| AI | Google Gemini 2.5 Flash-Lite（`google-genai`） |
| 報告 | ReportLab（PDF）+ pandas + openpyxl（Excel） |

### 後端模組分工（`backend/app/`）

| 檔案 | 職責 |
|------|------|
| `main.py` | FastAPI 入口、device state cache、simulator 啟動 |
| `models.py` | SQLAlchemy models + SessionLocal |
| `simulator.py` | 溫濕度模擬（**真機版替換點**：換成 `kson_driver.py`） |
| `schedules.py` | 排程 API routes（CRUD、確認、取消） |
| `schedule_service.py` | 排程業務邏輯層（service layer）：時長計算、自動選機、排程推進；供 schedules.py / main.py / simulator.py 共用，可獨立 pytest |
| `devices.py` | 設備狀態查詢、緊急停止、感測器歷史/統計 API |
| `devices_maintenance.py` | 設備校驗 & 維護排程 CRUD API |
| `fixtures.py` | 治具借還、盤點、採購、Excel 匯入 CRUD API |
| `purchase_orders.py` | 採購單 CRUD API |
| `ai.py` + `rag.py` | Gemini 整合 + RAG 向量檢索 |
| `reports.py` | PDF / CSV 報告生成 |
| `sop.py` | SOP 執行流程、步驟確認、照片上傳 |
| `auth.py` | 登入、token 驗證、middleware、rate limiting |
| `audit.py` | 稽核日誌寫入與查詢 API |
| `ws.py` | WebSocket `/ws/devices` + ConnectionManager + broadcast_loop |
| `line.py` | LINE push_message 推播 |
| `utils.py` | 共用工具函式（時間、條件解析、device state 存寫） |
| `constants.py` | 全域常數（AMBIENT_TEMP/HUMIDITY 等） |
| `uncertainty.py` | GUM 量測不確定度計算（Type A/B/uc/U） |
| `errors.py` | 異常紀錄 API |

---

## 技術規格

### 資料庫（18 張）

| 表名 | 說明 |
|------|------|
| `device_data` | 設備感測器時序資料（溫度、濕度） |
| `device_states` | 設備狀態機（IDLE/RUNNING/PAUSED/FINISHING）+ sim_phase |
| `sop_executions` | SOP 執行記錄（設備、條件、開始/結束時間） |
| `step_records` | SOP 執行步驟確認紀錄 |
| `error_logs` | 設備異常/錯誤日誌 |
| `fixtures` | 治具主檔（庫存、狀態） |
| `fixture_loans` | 治具借還記錄（含排程外鍵 `schedule_id`） |
| `fixture_inventory_logs` | 治具盤點/異動紀錄 |
| `schedule_fixtures` | 排程↔治具預約中間表 |
| `users` | 管理員帳號（角色 admin） |
| `demo_tokens` | 訪客唯讀 Token |
| `sop_templates` | SOP 步驟模板 |
| `purchase_orders` | 治具採購單 |
| `schedules` | 測試排程（甘特圖資料來源） |
| `device_blocked_periods` | 設備不可用時段 |
| `audit_logs` | 稽核日誌（who/what/when，所有寫入操作埋點，支援 CSV 匯出） |
| `device_calibrations` | 設備校驗紀錄（校驗日期、下次校驗日期、證書號、結果） |
| `device_maintenances` | 設備維護紀錄（維護日期、類型、說明、執行人員） |

### 狀態機與模擬

@.claude/rules/state-machine.md

### API 慣例、存取控制、LINE 推播

@.claude/rules/api-conventions.md

### 前端元件結構與佈局

@.claude/rules/frontend.md

### 測試規範

@.claude/rules/testing.md

---

## AI 協作方式

- 一個一個來，沒有著急的，改好一起測試
- 不說「哪個優先？」「著急/緊急」等詞；說「下一個要改 X」「X 改好了」「還剩 N 個」
- 執行 bash 前先用中文解釋，等使用者確認再執行
- 不自動 push 到 GitHub，除非明確要求

### Demo 版 / 真機版分兩條線（不得混用）

- `main` 分支 = Demo 版（純模擬，永遠不動）
- 真機版另開分支 `feature/kson-real-device`
- 不做 feature flag 切換：多一層抽象就多一份 bug 面
- 遇到「加切換開關」「加 mock 模式」等需求，一律拒絕，改在真機版分支實作

### Push 前建議（依改動規模判斷）

| 情境 | 要跑的 |
|------|--------|
| 功能完成、跨多檔改動 | `/simplify` → `/review` → push |
| 單檔邏輯改動 | `/review` → push |
| 小改動（typo、config、純顯示） | 直接 push |

---

## 常用指令

```bash
cp .env.example .env           # 首次：填入 ADMIN_PASSWORD、GEMINI_API_KEY 等
make install                   # 安裝所有依賴（pip + npm）
python backend/init_db.py      # 初始化資料庫（首次）
make dev                       # 啟動全部服務（uvicorn:8000 + vite:5173 + ngrok）
make test                      # 執行後端測試
make lint                      # ruff 檢查（line-length 120）
make clean                     # 清理殘留程序

# 資料庫遷移（backend/ 目錄下）
alembic revision --autogenerate -m "描述"
alembic upgrade head

# 後端單元測試
cd backend && python -m pytest                        # 全套（124 tests）
cd backend && python -m pytest tests/test_auth.py -v  # 單一測試檔
```

---

## 已完成功能模組

| 模組 | 說明 |
|------|------|
| 物理模擬引擎 | sim_phase 狀態機、多 cycle、重啟自動恢復 |
| 環境測試標準 | 5 法規 78 條件，三層 STANDARD_TREE |
| SOP 執行 | 自動確認步驟、自動存報告 |
| ISO 17025 報告 | PDF 報告生成（含 GUM 量測不確定度 Type A/B/uc/U）、CSV 報告 |
| 治具管理 | 借出/歸還/逾期/盤點/採購/汰換，Excel upsert；盤點紀錄批次摺疊、整批刪除、逐條編輯；與排程聯動（預約→借出→歸還） |
| 排程系統 | 甘特圖、自動排程、即時預覽、不可用時段；條件完成後人員確認才推進下一條；與 AI 聯動（申請此測試預填）；▶ 立即開始（手動補救 APScheduler 漏觸發） |
| AI 諮詢 | Gemini 2.5 Flash-Lite、RAG 檢索、多輪對話；推薦條件→直接申請排程；即時 DB context 注入（設備狀態、進行中排程、治具借出/逾期） |
| 三模組連動 | ✅ AI→排程、排程→治具預約、SOP→治具借出、完成→治具歸還 |
| 存取控制 | 2 層（admin/guest）、IP Rate Limiting |
| LINE Bot | 推播時機：條件完成（等待人員確認）、測試完成、緊急停止（推播給管理者個人） |
| 感測器 QC 控制圖 | DeviceCard 📊 按鈕開啟 Modal；24h 歷史 + UCL/LCL（mean ± 3σ）+ 異常點標記；溫度/濕度雙圖 |
| 稽核日誌 | audit_logs 表記錄 who/what/when；排程/治具/設備所有寫入皆埋點；紀錄 Modal 第三 tab 顯示，支援 entity 過濾 + CSV 匯出 |
| 維護 | device_calibrations + device_maintenances 兩表；CRUD API（admin 寫入）；維護 tab + LeftPanel 校驗狀態摘要（正常/即將到期/逾期/未知）；DeviceCard badge；Alembic migration |
| WebSocket 即時監控 | `/ws/devices` endpoint + `ConnectionManager` + 1s `broadcast_loop`；前端 `useDeviceWebSocket` hook（指數退避重連）；取代原本 3s HTTP polling；`WS_BASE` 統一由 `api.js` export |

### 三模組連動流程

```
① AI 推薦測試條件
    ↓ [📅 申請此測試] 按鈕（streaming 末尾 META [APPLY:id1,id2] marker）
② 申請排程（條件預填 + 選設備 + 選治具）
    ↓
③ 排程確認 → 治具自動預約（reserved）+ 設備立即啟動 SOP
    ↓
④ 測試開始 → 設備 RUNNING + 治具自動借出（loaned）
    ↓
⑤ 條件完成 → LINE 推播「請確認」→ 人員下載報告確認結果
    ↓ [排程頁面：確認完成 / 開始下一條件]
⑥ 全部條件確認 → 治具自動歸還 + 排程標為已完成
```

連動實作關鍵：
- `schedule_fixtures` 中間表 + `fixture_loans.schedule_id` 外鍵
- 排程確認時呼叫 `_transfer_reserved_fixtures`
- 設備 RUNNING 時預約治具自動轉借出；測試完成時自動歸還

---

## 本地開發環境

```
macOS M2
後端：http://localhost:8000
前端：http://localhost:5173
API 文件：http://localhost:8000/docs
```
