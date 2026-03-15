# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制。

## 專案背景

工業環境測試涉及眾多國際標準（IEC、EN、DNV、NMEA 等），即使有 SOP 可循，測試人員仍需大量人工比對法規參數，細微的判讀差異就可能導致測試條件設定錯誤。加上各標準版本更迭頻繁、新人培訓成本高，整個流程對人力依賴程度極高，人為疏失風險難以有效控制。

本專案將測試流程數位化，把 5 大國際標準的 78 個測試條件直接內建進系統，操作人員透過三步驟選擇法規、版本、測試條件後，參數自動帶入，無需手動比對文件。搭配物理模擬引擎，在硬體不在場時也能完整執行開發與驗證流程，降低人力成本與培訓門檻。

---

## AI 輔助模組

**法規諮詢助手**（✅ 已完成）— 使用者以自然語言描述產品與目標，LLM 對應建議法規版本與測試條件，適用於開案前初步評估。串接本機 Ollama `gemma3:4b`，不依賴雲端，資料不出內網。支援多對話管理、專案分組（含移動對話至分組）、串流逐字輸出、多輪對話、對話記錄持久化、智慧捲動、動態追問建議（切換對話自動取消）。每則回覆強制附上免責聲明，並標注法規正式版本號。

**治具管理助手**（規劃中）— 使用者描述待測產品與需求，LLM 推理對應所需治具組合，自動產出借用申請送管理者確認。

**設備排程預估**（規劃中）— 使用者提交測試需求，LLM 結合現有排程資料計算最快可用時間窗口。

---

## 核心功能

- **多設備同步監控** — 5 台溫箱（KSON_CH01～CH05）各自獨立模擬運作，SELECT DEVICE 按鈕即時反映各設備狀態顏色
- **儀表板** — 即時溫濕度監控（每秒更新）、趨勢圖雙 Y 軸、步驟進度條、倒數計時器、六種狀態顏色區分；低溫（< 0°C）自動隱藏濕度顯示
- **三步驟法規選擇** — 法規 → 版本/Class → 測試條件，5 大法規、78 個官方測試條件，各設備選擇獨立儲存
- **SOP 步驟依序確認** — 步驟必須依序勾選，取消時連鎖清除後續，Optional 步驟可跳過，每次勾選即時同步後端
- **完整波型曲線** — SP 目標曲線（虛線）與 PV 實際曲線（實線）疊加顯示，X 軸為完整測試時長；低溫段（< 0°C）濕度線自動斷開
- **執行資訊面板** — Pgm / Step / Free Time / Cycle / Now Time / End Time，對應 KSON 溫箱面板格式
- **AI 法規諮詢** — 多對話管理、專案分組、自然語言描述需求、串流逐字回覆，支援中途停止、複製（含 HTTP fallback）、計時、對話持久化、智慧捲動、動態追問建議；雙層免責聲明（前端固定標籤 + AI 回覆內標注版本號）
- **物理模擬引擎** — 即時升降溫斜率模擬，遵守各標準速率限制，每 10 秒寫 DB，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存
- **異常看板** — 緊急停止自動寫入事件紀錄，記錄當下溫濕度與執行中 SOP，每 60 秒自動刷新
- **ISO 17025 測試報告** — 7 節格式，big5 編碼，PASS/FAIL 由授權工程師人工判定
- **重啟恢復** — 伺服器重啟後自動恢復 RUNNING 狀態、步驟進度與 SOP 資料
- **瞬間頁面切換** — App.jsx 採 CSS display 切換取代路由 unmount，四頁面狀態常駐記憶體，切換無延遲

## 支持的環境測試標準（78 個測試條件）

| 法規 | 版本 | 測試數 | 主要測試項目 |
|------|------|---------|------------|
| **IEC 60068** | 2-1 / 2-2 / 2-14 / 2-30 / 2-78 | 17 | 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環/熱衝擊 Na/Nb、濕熱循環 Db、高溫高濕穩態 Cab |
| **EN 50155** | 2017 / 2007 | 21 | OT1~OT6 高溫/低溫（含 OT5 低溫 -40°C）、ST1 開機延伸、隧道快速溫變、濕熱循環、OT4 高溫通電（三段電壓） |
| **IEC 61850-3** | Ed.2:2013 / Ed.1:2002 | 19 | Class C1/C2/C3 各自乾熱+冷測+濕熱+高溫高濕穩態 Cab |
| **IEC 60945** | 2002 | 7 | 乾熱儲存/工作、濕熱 Db variant 1、低溫儲存/工作（Portable/Protected/Exposed）|
| **DNV** | CG-0339:2015 / Std.Cert.2.4 | 14 | Class A/B/C/D，穩態/循環濕熱，Std.Cert.2.4 Class C/D 乾熱 |

> ⚠️ 系統內建參數僅供初步評估參考，實際測試條件請以原始法規文件為準，並由授權工程師確認。
> KEMA / NMEA 暫時移除（無原始法規文件可供對照）。

## 快速啟動

```bash
# 1. 安裝所有依賴（後端 + 模擬器 + 前端）
make install

# 2. 初始化資料庫（首次執行必須）
python backend/init_db.py

# 3. 一鍵啟動
make dev
```

> ⚠️ DB 結構有變更時：改 `models.py` → `alembic revision --autogenerate -m "描述"` → `alembic upgrade head`（需在 `backend/` 目錄下執行）

啟動後開啟 `http://localhost:5173`，或前往 `http://localhost:5173/sop` 執行測試，`http://localhost:5173/ai` 使用 AI 法規諮詢。

互動式 API 文件：`http://localhost:8000/docs`

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（KSON_CH01，向後相容） |
| GET  | `/api/devices` | 所有設備即時狀態（含 total_steps、completed_steps、started_at） |
| GET  | `/api/devices/{id}/history` | 設備歷史溫濕度（每分鐘聚合，從 started_at 至今） |
| GET  | `/api/sop/` | SOP 列表 |
| GET  | `/api/sop/standards/tree` | 三層標準樹（法規→版本→測試條件，不含 steps 欄位） |
| POST | `/api/sop/start` | 啟動 SOP |
| POST | `/api/devices/{id}/progress` | 更新步驟完成數 |
| POST | `/api/sop-executions/` | 儲存執行紀錄（含 device_id、operator、test_started_at） |
| GET  | `/api/sop-executions/{id}` | 讀取執行紀錄 |
| GET  | `/api/reports/csv/{id}` | 下載測試報告 CSV（ISO 17025 七節格式，RFC 5987 檔名） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表 |
| POST | `/api/stop/{device_id}/emergency` | 緊急停止 |
| POST | `/api/stop/{device_id}/pause` | 暫停切換（RUNNING ↔ PAUSED） |
| POST | `/api/stop/{device_id}/normal` | 正常停止（自動降溫回 IDLE） |
| POST | `/api/ai/standards-query` | AI 法規諮詢（非串流） |
| POST | `/api/ai/standards-query-stream` | AI 法規諮詢（串流，前端主要使用） |

## 技術堆棧

後端：FastAPI、Pydantic v2、SQLAlchemy 2.0、asyncio、SQLite、httpx、Alembic
前端：React 18、Vite、Recharts、Axios
AI：Ollama（本機）、gemma3:4b
環境：Python 3.9+、Node.js 18+、macOS/Linux（需要 socat）

## 延伸文件

- [AI Agent 開發規範與專案背景](./AGENTS.md)
- [更新紀錄](./CHANGELOG.md)
- [QA 測試報告模板](./docs/templates/QA_Test_Report_Template.docx)


## 授權

MIT License