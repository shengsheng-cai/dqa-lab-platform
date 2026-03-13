# 🏗️ DQA LAB 數位雙生平台 - 系統完整架構圖

本文件詳列所有已完成與規劃中之模組，作為後續開發追蹤使用。更新紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📁 客戶端 (Browser) - React 前端模塊

- **✅ 全域路由控制 (App Router)**: `App.jsx` 改用 CSS `display` 切換取代 React Router unmount/remount，四個頁面常駐 DOM，切換不重打 API、不重建 state，頁面切換近乎瞬間。導覽列 active 頁面高亮顯示。頁面：`/`（儀表板）、`/sop`（SOP 執行）、`/errors`（異常看板）、`/ai`（AI 諮詢）。
- **✅ 儀表板 (Dashboard)**: 即時溫濕度大字顯示（每秒更新）、趨勢折線圖（雙 Y 軸，每 60 秒存一點，完整測試時長 + Brush 縮放，buffer 5760 點）、DeviceCard 步驟進度條與倒數計時器、六種狀態 badge、執行紀錄列表（60s 刷新）、GitHub dark 主題。低溫（< 0°C）時自動隱藏濕度顯示並將趨勢圖該段 humidity 存為 null（`connectNulls={false}` 自動斷線）。
- **✅ SOP 執行頁 (SOPPage)**: 40/60 雙欄佈局；三步驟法規選擇（per-device 獨立 state）；步驟依序追蹤（勾選同步後端）；SP+PV 波型曲線（雙 Y 軸、Brush 縮放）；執行資訊面板（Pgm/Step/Free Time/Cycle/Now Time/End Time）；上架安全確認；重啟後步驟恢復。`treeLoaded` state 管理標準樹載入，未就緒前顯示 skeleton。`generateSP()` 溫度 < 0°C 時 `sp_humi = null`，低溫段圖表濕度線自動斷開。
- **✅ 異常看板 (ErrorLog)**: 統計卡片 + 完整紀錄列表，每 60 秒自動刷新。
- **✅ AI 諮詢頁 (AIPage)**: 法規諮詢對話介面，串流逐字輸出、Markdown 渲染、左側欄快速提問（可收合）、中途停止並保留內容、複製回覆、回覆計時、localStorage 對話持久化、智慧捲動（使用者往上捲時不強制跟隨）、追問建議動態產生（繁體強制）、簡體精確偵測（SIMPLIFIED_ONLY Set）。**雙層免責聲明**：前端每則回覆固定顯示警語（`DISCLAIMER` 常數）；空白頁面亦顯示；ai.py system prompt 強制 AI 在回覆內標注法規版本號並附上免責聲明。
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
| POST | `/api/sop/start` | 啟動 SOP，記錄 started_at，清零 completed_steps |
| POST | `/api/devices/{id}/progress` | 更新完成步驟數並持久化（ProgressPayload 型別安全） |
| POST | `/api/sop-executions/` | 儲存 SOP 執行紀錄（含 device_id、operator、test_started_at） |
| GET  | `/api/sop-executions/{id}` | 讀取指定執行紀錄 |
| GET  | `/api/reports/csv/{execution_id}` | 下載 CSV 測試報告（big5 編碼，RFC 5987 檔名） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表（最新在前，ISO 8601 時間格式） |
| POST | `/api/stop/{device_id}/pause` | `RUNNING ↔ PAUSED` 切換 |
| POST | `/api/stop/{device_id}/normal` | 進入 `FINISHING`，降溫完成後自動回 `IDLE` |
| POST | `/api/stop/{device_id}/emergency` | 強制進入 `EMERGENCY`，自動寫入異常紀錄 |
| POST | `/api/ai/standards-query` | AI 法規諮詢（非串流），串接本機 Ollama qwen2.5:7b |
| POST | `/api/ai/standards-query-stream` | AI 法規諮詢（串流），StreamingResponse 逐字回傳 |

### 規劃中 ⏳

- **`/api/auth`** — JWT 登入驗證
- **`/api/ai/fixture-recommend`** — 治具推薦
- **`/api/ai/schedule-estimate`** — 排程預估

---

## 📁 環境測試標準模組 (standards.py)

三層巢狀 `STANDARD_TREE`，6 法規 **64 個**測試條件。

| 法規 | 測試數 |
|------|--------|
| IEC 60068 | 13 |
| EN 50155 | 19（含 OT5 低溫冷測 -40°C） |
| IEC 61850-3 | 10 |
| DNV | 14（含 Std.Cert.2.4 Class C/D 乾熱） |

> KEMA / NMEA 暫時移除（無原始法規文件可供對照）。
> `GET /api/sop/standards/tree` 回傳時已移除 `steps` 欄位（108kB → ~12kB），前端選取法規時不再傳輸步驟資料，啟動 SOP 時才取完整定義。

**法規正確性審查計畫（進行中）**

STANDARD_TREE 內建參數均為人工整理，需逐條對照原始法規文件驗證。審查順序與範圍：

1. IEC 60068（13 條）— 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環/熱衝擊 Na/Nb、濕熱循環 Db
2. EN 50155（19 條）— OT1~OT6、ST1、隧道溫變、濕熱循環
3. IEC 61850-3（10 條）— Class C1/C2/C3
4. DNV（14 條）— CG-0339:2019 / Std.Cert.2.4 Class A/B/C/D

審查項目：溫度、停留時間、濕度、循環數、升降溫速率是否符合原文。發現差異時直接標出並說明，最終整理修正清單更新 `standards.py`。

---

## 📁 業務服務層 & 資料模型

### 物理模擬引擎 (main.py) ✅
- 升降溫斜率模擬，遵守各標準速率限制
- 每 10 秒寫一次資料庫（ISO/IEC 17025:2017 §7.5 & §8.4 永久保存）
- `FINISHING` 自動降溫至 25°C 後回 `IDLE`
- 每台設備獨立 DB session，一台出錯不影響其他設備
- 所有時間戳統一使用 `_now_utc()` 產生 UTC-aware datetime
- `total_steps` 於 `start_sop` 時存入 AICM_CACHE，`get_all_devices()` 直接讀取，不重複解析 JSON

### 資料庫表格 (SQLite)

| 表格 | 狀態 | 說明 |
|------|------|------|
| `device_data` | ✅ | 歷史溫濕度（每 10 秒，永久保存）|
| `device_states` | ✅ | 設備狀態持久化（status、temperature、active_sop_json、completed_steps、started_at、updated_at）|
| `sop_executions` | ✅ | 執行歷程主表（test_started_at/ended_at 為 DateTime，含 operator、device_id）|
| `step_records` | ✅ | 每步驟完成狀態（execution_id ForeignKey、completed Boolean）|
| `sop_templates` | ✅ | 自訂 SOP |
| `error_logs` | ✅ | 緊急停止事件紀錄（created_at 為 DateTime，ISO 8601 序列化）|
| `fixtures` | ⏳ | 治具清單、借用狀態 |
| `devices` | ⏳ | 多台設備身分與狀態 |
| `users` | ⏳ | 使用者權限管理 |

---

## 📁 AI 輔助模組 (ai.py)

| 功能 | 狀態 | 說明 |
|------|------|------|
| 法規諮詢助手後端 | ✅ | `POST /api/ai/standards-query`（非串流）+ `standards-query-stream`（串流），Ollama qwen2.5:7b，多輪對話，繁體中文強制，免責規則（版本號標注 + 回覆結尾聲明） |
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
| 前端路由 | ✅ | App.jsx CSS display 切換，四頁面常駐 DOM，切換無延遲 |
| 儀表板 | ✅ | 即時監控、趨勢圖雙 Y 軸、buffer 5760 點、步驟進度條、倒數計時器、執行紀錄列表（60s 刷新）、低溫濕度隱藏 |
| SOP 三步驟法規選擇 | ✅ | 法規→版本→測試條件，動態載入（skeleton），per-device 獨立 state |
| SOP 步驟依序追蹤 | ✅ | 依序解鎖、取消連鎖清除、Optional 可跳過、勾選即時同步後端 |
| 完整波型曲線 | ✅ | SP 虛線 + PV 實線疊加，X 軸完整測試時長，雙 Y 軸，低溫段濕度線斷開 |
| 執行資訊面板 | ✅ | Pgm / Step / Free Time / Cycle / Now Time / End Time |
| 異常看板 | ✅ | 緊急停止自動記錄，統計卡片 + 列表，60s 自動刷新 |
| 環境測試標準 | ✅ | 4 法規，56 個測試條件，standards/ 套件（iec60068 / en50155 / iec61850 / dnv） |
| 物理模擬引擎 | ✅ | 標準化升降溫，每 10 秒寫 DB，每台獨立 session |
| ISO 17025 記錄保存 | ✅ | 永久保存，依 §7.5 & §8.4 |
| CSV 測試報告 | ✅ | ISO 17025 格式，big5，PASS/FAIL 人工填寫，RFC 5987 檔名 |
| 設備狀態持久化 | ✅ | DeviceState 表，重啟後自動恢復 |
| 資料庫遷移 (Alembic) | ✅ | initial schema 基準版本已建立 |
| Standards Tree 效能 | ✅ | 移除 steps 欄位，108kB → ~12kB；total_steps 存 cache 避免重複 parse |
| AI 法規諮詢後端 | ✅ | Ollama qwen2.5:7b，串流 + 非串流，多輪對話，繁體中文強制，免責規則 |
| AI 法規諮詢前端 | ✅ | AIPage.jsx，串流、Markdown、快速提問、停止、複製、計時、localStorage、智慧捲動、簡體精確偵測、追問建議繁體強制、雙層免責聲明 |
| 法規正確性審查 | ⏳ | 進行中，4 法規 56 條逐條對照原始文件 |
| AI 治具助手 | ⏳ | 規劃中 |
| AI 排程預估 | ⏳ | 規劃中 |
| 步驟軟體/現場確認 | ⏳ | Phase 3 前再做 |
| 多台設備架構 | ⏳ | 動態 device_id |
| 治具資料庫 | ⏳ | fixtures 表 |
| 認證系統 | ⏳ | JWT |
| RS-485 真實通訊 | ⏳ | 對接真實 KSON 溫箱 |