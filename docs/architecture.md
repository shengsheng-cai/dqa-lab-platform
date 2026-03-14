# 🏗️ DQA LAB 數位雙生平台 - 系統完整架構圖

本文件詳列所有已完成與規劃中之模組，作為後續開發追蹤使用。更新紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📁 客戶端 (Browser) - React 前端模塊

- **✅ 全域路由控制 (App Router)**: `App.jsx` 改用 CSS `display` 切換取代 React Router unmount/remount，四個頁面常駐 DOM，切換不重打 API、不重建 state，頁面切換近乎瞬間。頁面：`/`（儀表板）、`/sop`（SOP 執行）、`/errors`（異常看板）、`/ai`（AI 諮詢）。
- **✅ 儀表板 (Dashboard)**: 即時溫濕度大字顯示（每秒更新）、趨勢折線圖（雙 Y 軸，每 60 秒存一點，完整測試時長 + Brush 縮放，buffer 5760 點）、DeviceCard 步驟進度條（依賴後端 `total_steps`，由 `start_sop` 存入 cache）與倒數計時器、六種狀態 badge、執行紀錄列表（60s 刷新）、GitHub dark 主題。低溫（< 0°C）時自動隱藏濕度顯示。
- **✅ SOP 執行頁 (SOPPage)**: 40/60 雙欄佈局；三步驟法規選擇（per-device 獨立 state）；步驟依序追蹤（步驟數由前端 `ds.activeSop.steps.length` 自行計算，不依賴後端 `total_steps`）；SP+PV 波型曲線（雙 Y 軸、Brush 縮放）；執行資訊面板（Pgm/Step/Free Time/Cycle/Now Time/End Time）；上架安全確認；重啟後步驟恢復。
- **✅ 異常看板 (ErrorLog)**: 統計卡片 + 完整紀錄列表，每 60 秒自動刷新。
- **✅ AI 諮詢頁 (AIPage)**: 法規諮詢對話介面，串流逐字輸出、Markdown 渲染、左側欄快速提問（可收合）、中途停止並保留內容、複製回覆、回覆計時、localStorage 對話持久化、智慧捲動、追問建議動態產生、雙層免責聲明。
- **規劃中**: 治具管理、設備管理、使用者中心。

---

## 📁 後端 API 路由層 (FastAPI)

### 已完成 ✅

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（KSON_CH01，向後相容） |
| GET  | `/api/devices` | 所有設備即時狀態（含 total_steps、completed_steps、started_at、estimated_end_at）|
| GET  | `/api/devices/{id}/history` | 設備歷史溫濕度，從 started_at 至今每分鐘聚合 |
| GET  | `/api/sop/` | SOP 列表（從 STANDARD_TREE 自動展開） |
| GET  | `/api/sop/standards/tree` | 三層標準樹（法規→版本→測試條件），**不含 steps 欄位**，回應約 12kB |
| POST | `/api/sop/start` | 啟動 SOP，記錄 started_at，清零 completed_steps，**存入 total_steps** |
| POST | `/api/devices/{id}/progress` | 更新完成步驟數並持久化 |
| POST | `/api/sop-executions/` | 儲存 SOP 執行紀錄 |
| GET  | `/api/sop-executions/{id}` | 讀取指定執行紀錄 |
| GET  | `/api/reports/csv/{execution_id}` | 下載 CSV 測試報告（big5 編碼，RFC 5987 檔名） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表（最新在前，ISO 8601 時間格式） |
| POST | `/api/stop/{device_id}/pause` | `RUNNING ↔ PAUSED` 切換 |
| POST | `/api/stop/{device_id}/normal` | 進入 `FINISHING`，降溫完成後自動回 `IDLE` |
| POST | `/api/stop/{device_id}/emergency` | 強制進入 `EMERGENCY`，自動寫入異常紀錄 |
| POST | `/api/ai/standards-query` | AI 法規諮詢（非串流） |
| POST | `/api/ai/standards-query-stream` | AI 法規諮詢（串流） |

### 規劃中 ⏳

- **`/api/auth`** — JWT 登入驗證
- **`/api/ai/fixture-recommend`** — 治具推薦
- **`/api/ai/schedule-estimate`** — 排程預估

---

## 📁 環境測試標準模組 (standards/)

三層巢狀 `STANDARD_TREE`，4 法規 **68 個**測試條件。

| 法規 | 測試數 |
|------|--------|
| IEC 60068 | 17 |
| EN 50155 | 19 |
| IEC 61850-3 | 16 |
| DNV | 14 |

> KEMA / NMEA 暫時移除（無原始法規文件可供對照）。

**法規正確性審查計畫（進行中）**

審查順序：IEC 60068 → EN 50155 → IEC 61850-3 → DNV。
審查項目：溫度、停留時間、濕度、循環數、升降溫速率。

---

## 📁 業務服務層 & 資料模型

### 物理模擬引擎 (main.py) ✅
- 升降溫斜率模擬，遵守各標準速率限制
- 每 10 秒寫一次資料庫（ISO/IEC 17025:2017 §7.5 & §8.4 永久保存）
- `FINISHING` 自動降溫至 25°C 後回 `IDLE`
- 每台設備獨立 DB session，一台出錯不影響其他設備
- 所有時間戳統一使用 `_now_utc()` 產生 UTC-aware datetime
- DB 寫入邏輯統一封裝於 `_save_device_state()`，模擬器與控制 API 共用
- `total_steps` 於 `start_sop` 時存入 AICM_CACHE，`get_all_devices()` 直接讀取（Dashboard 進度條使用）

### 資料庫表格 (SQLite)

| 表格 | 狀態 | 說明 |
|------|------|------|
| `device_data` | ✅ | 歷史溫濕度（每 10 秒，永久保存）|
| `device_states` | ✅ | 設備狀態持久化（status、temperature、active_sop_json、completed_steps、started_at、updated_at）|
| `sop_executions` | ✅ | 執行歷程主表 |
| `step_records` | ✅ | 每步驟完成狀態 |
| `sop_templates` | ✅ | 自訂 SOP |
| `error_logs` | ✅ | 緊急停止事件紀錄 |
| `fixtures` | ⏳ | 治具清單、借用狀態 |
| `devices` | ⏳ | 多台設備身分與狀態 |
| `users` | ⏳ | 使用者權限管理 |

---

## 📁 AI 輔助模組 (ai.py)

| 功能 | 狀態 | 說明 |
|------|------|------|
| 法規諮詢助手後端 | ✅ | 串流 + 非串流，Ollama qwen2.5:7b，多輪對話，繁體中文強制；**system prompt 模組載入時快取，只建立一次** |
| 法規諮詢助手前端 | ✅ | `AIPage.jsx`，串流輸出、Markdown 渲染、快速提問、中途停止、複製、計時、localStorage 持久化、側欄收合、智慧捲動、簡體精確偵測、追問建議繁體強制、雙層免責聲明 |
| 治具管理助手 | ⏳ | `/api/ai/fixture-recommend` |
| 設備排程預估 | ⏳ | `/api/ai/schedule-estimate` |

---

## 📁 通訊與設備模擬層

- **✅ 虛擬串口橋接器 (socat)**: 提供虛擬連線環境（macOS/Linux）
- **✅ 慶聲溫箱模擬器 (KsonChamber)**: 模擬 KSON AICM 真實設備回傳字串
- **⏳ Phase 3 — RS-485/RJ45 真實串口通訊**: `serial_reader.py` 已預留，尚未啟用

---

## 📊 完成度統計

| 模組 | 狀態 | 說明 |
|------|------|------|
| 前端路由 | ✅ | App.jsx CSS display 切換，四頁面常駐 DOM |
| 儀表板 | ✅ | 即時監控、趨勢圖、進度條（後端 total_steps）、倒數計時器、低溫濕度隱藏 |
| SOP 三步驟法規選擇 | ✅ | 法規→版本→測試條件，動態載入，per-device 獨立 state |
| SOP 步驟依序追蹤 | ✅ | 依序解鎖、取消連鎖清除、Optional 可跳過、勾選即時同步後端 |
| 完整波型曲線 | ✅ | SP 虛線 + PV 實線疊加，雙 Y 軸，低溫段濕度線斷開 |
| 執行資訊面板 | ✅ | Pgm / Step / Free Time / Cycle / Now Time / End Time |
| 異常看板 | ✅ | 緊急停止自動記錄，統計卡片 + 列表，60s 自動刷新 |
| 環境測試標準 | ✅ | 4 法規，68 個測試條件，standards/ 套件 |
| 物理模擬引擎 | ✅ | 標準化升降溫，每 10 秒寫 DB，每台獨立 session，DB 寫入統一封裝 |
| ISO 17025 記錄保存 | ✅ | 永久保存，依 §7.5 & §8.4 |
| CSV 測試報告 | ✅ | ISO 17025 格式，big5，PASS/FAIL 人工填寫 |
| 設備狀態持久化 | ✅ | DeviceState 表，重啟後自動恢復 |
| 資料庫遷移 (Alembic) | ✅ | initial schema 基準版本已建立 |
| AI 法規諮詢後端 | ✅ | Ollama qwen2.5:7b，串流 + 非串流，system prompt 快取 |
| AI 法規諮詢前端 | ✅ | AIPage.jsx，完整功能 + 雙層免責聲明 |
| 法規正確性審查 | ⏳ | 進行中 |
| AI 治具助手 | ⏳ | 規劃中 |
| AI 排程預估 | ⏳ | 規劃中 |
| 多台設備架構 | ⏳ | 動態 device_id |
| 治具資料庫 | ⏳ | fixtures 表 |
| 認證系統 | ⏳ | JWT |
| RS-485 真實通訊 | ⏳ | 對接真實 KSON 溫箱 |