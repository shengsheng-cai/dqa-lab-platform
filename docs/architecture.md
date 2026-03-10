# 🏗️ DQA LAB 數位雙生平台 - 系統完整架構圖

本文件詳列所有已完成與規劃中之模組，作為後續開發追蹤使用。更新紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📁 客戶端 (Browser) - React 前端模塊

* **✅ 全域路由控制 (App Router)**: 由 `App.jsx` 統一管理頂部導航列，active 頁面高亮顯示。
* **✅ 儀表板 (Dashboard)**:
    * 即時溫濕度大字顯示（每秒更新），TEMP/HUMI 各自 accent 色邊框。
    * 趨勢折線圖（溫度 + 濕度**雙 Y 軸**，溫度左軸/濕度右軸獨立刻度），每 60 秒存一個資料點，顯示完整測試時長（從 started_at 至今）；Brush 縮放條可拖拉查看任意時段；切換設備時從 history API 補撈歷史；in-memory buffer 上限 5760 點（覆蓋 96h 測試）。
    * DeviceCard 顯示步驟進度條（completed_steps / total_steps），`total_steps` 由後端從 `active_sop_json` 解析回傳。
    * 六種狀態 badge 顏色區分（RUNNING / PAUSED / FINISHING / EMERGENCY / IDLE / OFFLINE）。
    * 歷史執行紀錄列表（每 30 秒自動刷新），每筆可直接下載 CSV 報告。
    * 統一 GitHub dark 主題，與 SOPPage 風格一致。
* **✅ SOP 執行頁 (SOPPage)**:
    * 採用 **40/60 雙欄佈局**：左側數據監控、右側操作面板。
    * **三步驟法規選擇 UI**：法規 → 版本/Class → 測試條件，從 `/api/sop/standards/tree` 動態載入；**各設備選擇獨立（per-device state）**，切換設備不互相干擾。
    * **SELECT DEVICE 即時狀態**：每顆設備按鈕即時反映各自狀態顏色，RUNNING 時加發光效果。
    * **狀態自動切換**: 待機顯示注意事項 + SOP 列表；執行中顯示步驟清單。
    * **SOP 步驟依序追蹤**: 前一步完成才解鎖下一步；取消步驟時連鎖清除後續所有步驟；Optional 步驟不影響解鎖；每次勾選即時同步後端 `completed_steps`。
    * **上架安全確認**: 四項注意事項全勾才能啟動測試。
    * **重啟後步驟恢復**: `active_sop_json` 存 DB，前端輪詢自動恢復步驟清單。
    * **儲存 + 下載**: 全步驟完成後可儲存執行紀錄（帶 device_id、test_started_at），儲存後顯示「下載 CSV 測試報告」按鈕。
    * **完整波型曲線**: SP 目標曲線（灰虛線）+ PV 實際曲線（紅實線）疊加，X 軸為完整測試時長；循環測試幾次畫幾個波；Brush 縮放；雙 Y 軸（溫度左、濕度右）。
    * **執行資訊面板**: Pgm / Step / Free Time / Cycle / Now Time / End Time，對應 KSON 溫箱面板格式，測試進行中才顯示。
    * **EMERGENCY 閃爍**: 緊急停止時控制面板紅色閃爍提示。
* **✅ 異常看板 (ErrorLog)**:
    * 統計卡片：緊急停止總次數、最近異常時間、涉及設備。
    * 完整紀錄列表：ID、設備、類型 badge、執行中 SOP、當下溫濕度、備註、時間（正確解析 ISO 8601）。
    * 每 10 秒自動刷新。
* **規劃中 — AI 輔助模組**（對應開案前流程）:
    * **治具管理助手**: 自然語言描述需求 → LLM 推理治具組合 → 自動產出借用申請
    * **設備排程預估**: 使用者輸入測試需求 → LLM 結合排程資料計算最快時間窗口
    * **法規諮詢助手**: 使用者描述產品與目標 → LLM 建議法規版本與測試條件
* **規劃中**:
    * **治具管理 (Fixtures)**、**設備管理 (Devices)**、**使用者中心 (User)**

---

## 📁 後端 API 路由層 (FastAPI)

### 已完成 ✅

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（每秒輪詢） |
| GET  | `/api/devices` | 所有設備即時狀態（含 total_steps、completed_steps、started_at）|
| GET  | `/api/devices/{id}/history` | 設備歷史溫濕度，從 started_at 至今每分鐘聚合 |
| GET  | `/api/sop/` | SOP 列表（從 STANDARD_TREE 自動展開） |
| GET  | `/api/sop/standards/tree` | 完整三層標準樹（法規→版本→測試條件） |
| POST | `/api/sop/start` | 啟動 SOP，記錄 started_at，清零 completed_steps |
| POST | `/api/devices/{id}/progress` | 更新完成步驟數並持久化（ProgressPayload 型別安全） |
| POST | `/api/sop-executions/` | 儲存 SOP 執行紀錄（含 device_id、operator、test_started_at） |
| GET  | `/api/sop-executions/{id}` | 讀取指定執行紀錄 |
| GET  | `/api/reports/csv/{execution_id}` | 下載 CSV 測試報告（big5 編碼，RFC 5987 檔名） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表（最新在前，ISO 8601 時間格式） |
| POST | `/api/stop/{device_id}/pause` | `RUNNING ↔ PAUSED` 切換 |
| POST | `/api/stop/{device_id}/normal` | 進入 `FINISHING`，降溫完成後自動回 `IDLE`，清空 running_sop_id |
| POST | `/api/stop/{device_id}/emergency` | 強制進入 `EMERGENCY`，自動寫入異常紀錄 |

### 規劃中 ⏳
* **`/api/auth`** — JWT 登入驗證
* **`/api/ai/fixture-recommend`**、**`/api/ai/schedule-estimate`**、**`/api/ai/standards-query`**

---

## 📁 環境測試標準模組 (standards.py)

三層巢狀 `STANDARD_TREE`，6 法規 **64 個**測試條件。

| 法規 | 測試數 | 異動 |
|------|--------|------|
| IEC 60068 | 12 | — |
| EN 50155 | 19 | 新增 OT5 低溫冷測（-40°C，16h） |
| IEC 61850-3 | 9 | — |
| DNV | 14 | 新增 Std.Cert.2.4 Class C/D 乾熱（+55°C / +70°C） |
| KEMA | 4 | — |
| NMEA | 7 | — |

`_build_flat_standards()` 新增重複 `sop_id` 警告，避免靜默覆蓋。

---

## 📁 業務服務層 & 資料模型

### 物理模擬引擎 (main.py) ✅
* 升降溫斜率模擬，遵守各標準速率限制（從 `get_ramp_rate()` 動態讀取）
* 每 10 秒寫一次資料庫（依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存，不自動刪除）
* `FINISHING` 狀態自動降溫至 25°C 後回 `IDLE`，並清空 `running_sop_id / standard_id`
* `EMERGENCY` 狀態微幅抖動，觸發時自動寫入 `error_logs`
* 使用 `@asynccontextmanager lifespan` 取代棄用的 `@app.on_event("startup")`
* 所有時間戳統一使用 `_now_utc()` 產生 UTC-aware datetime
* 模擬器每台設備獨立 DB session，一台出錯不影響其他設備

### 資料庫表格 (SQLite)

| 表格 | 狀態 | 說明 |
|------|------|------|
| `device_data` | ✅ | 歷史溫濕度（每 10 秒，永久保存）|
| `device_states` | ✅ | 設備狀態持久化（status、temperature、active_sop_json、completed_steps、started_at、updated_at 自動更新）|
| `sop_executions` | ✅ | 執行歷程主表（test_started_at/ended_at 為 DateTime，含 operator、device_id）|
| `step_records` | ✅ | 每步驟完成狀態（execution_id 有 ForeignKey、completed 為 Boolean）|
| `sop_templates` | ✅ | 自訂 SOP（DB 版，補充 standards.py） |
| `error_logs` | ✅ | 緊急停止事件紀錄（created_at 為 DateTime，ISO 8601 序列化）|
| `fixtures` | ⏳ | 治具清單、借用狀態 |
| `devices` | ⏳ | 多台設備身分與狀態 |
| `users` | ⏳ | 使用者權限管理 |

---

## 📁 通訊與設備模擬層

* **✅ 虛擬串口橋接器 (socat)**: 提供虛擬連線環境（macOS/Linux）
* **✅ 慶聲溫箱模擬器 (KsonChamber)**: 模擬 KSON AICM 真實設備回傳字串
* **⏳ Phase 3 — RS-485/RJ45 真實串口通訊**: `serial_reader.py` 已預留，尚未啟用

---

## 📊 完成度統計

| 模組 | 狀態 | 說明 |
|------|------|------|
| 前端路由 | ✅ | App.jsx 統一管理 |
| 儀表板 | ✅ | 即時監控、趨勢圖雙 Y 軸（完整測試時長 + Brush 縮放，buffer 5760 點）、六種狀態、執行紀錄列表（30s 刷新）|
| DeviceCard 步驟進度 | ✅ | completed_steps / total_steps 進度條，total_steps 由後端解析回傳 |
| SOP 三步驟法規選擇 | ✅ | 法規→版本→測試條件，動態載入，per-device 獨立 state |
| SELECT DEVICE 即時狀態 | ✅ | 每顆按鈕反映各設備即時狀態顏色 |
| SOP 步驟依序追蹤 | ✅ | 依序解鎖、取消連鎖清除、Optional 可跳過、勾選即時同步後端 |
| 上架安全確認 | ✅ | 四項全勾才能啟動 |
| 暫停/停止邏輯 | ✅ | RUNNING↔PAUSED，FINISHING→IDLE 清空 running_sop_id，EMERGENCY 修復 |
| EMERGENCY 閃爍 | ✅ | 控制面板紅色閃爍提示 |
| 完整波型曲線 | ✅ | SP 虛線 + PV 實線疊加，X 軸完整測試時長，循環幾次畫幾波，雙 Y 軸 |
| 執行資訊面板 | ✅ | Pgm / Step / Free Time / Cycle / Now Time / End Time |
| 異常看板 | ✅ | 緊急停止自動記錄，統計卡片 + 列表，10s 自動刷新，ISO 8601 時間 |
| 環境測試標準 | ✅ | 6 法規，64 個測試條件，官方參數 |
| 物理模擬引擎 | ✅ | 標準化升降溫，每 10 秒寫 DB，每台獨立 session |
| 17025 記錄保存 | ✅ | 永久保存，依 §7.5 & §8.4 |
| started_at 記錄 | ✅ | SOP 啟動時立即寫入，符合 §7.5.1 |
| 執行人員記錄 | ✅ | operator、device_id、test_started_at（DateTime）、test_ended_at（DateTime）|
| 執行紀錄 API | ✅ | 合併進 `sop.py`，flush + 單次 commit 安全寫入 |
| CSV 測試報告 | ✅ | ISO 17025 格式，big5，PASS/FAIL 人工填寫，RFC 5987 檔名 |
| 設備狀態持久化 | ✅ | DeviceState 表，updated_at 自動更新，重啟後自動恢復 |
| SOP 重啟恢復 | ✅ | active_sop_json 存 DB，前端輪詢自動恢復 |
| 趨勢圖多設備切換 | ✅ | 可切換 5 台設備，各自獨立 history buffer，切換時補撈 API |
| 趨勢圖每分鐘一點 | ✅ | 每 60 秒存一點，數字每秒更新 |
| 歷史資料 API | ✅ | GET /api/devices/{id}/history，每分鐘聚合 |
| 捲動架構修復 | ✅ | index.css / Dashboard.jsx / SOPPage.css / Errorlog.jsx 四層修正 |
| lifespan 啟動 | ✅ | 取代棄用 on_event，asynccontextmanager |
| 時間戳統一 | ✅ | _now_utc() 全域統一，解決 naive/aware 混用 |
| ProgressPayload | ✅ | update_progress 型別安全，修正 422 錯誤 |
| dev_start.sh | ✅ | socat 串口重試偵測、crash 自動 cleanup |
| AI 輔助模組 | ⏳ | 治具助手、排程預估、法規諮詢 |
| 報告半自動整合 | ⏳ | 載入照片 + 從 CSV 自動抓取數據填入模板 |
| Reports 頁面前端元件 | ✅ | Dashboard 已整合執行紀錄列表與下載，無需獨立頁面 |
| 資料庫遷移 (Alembic) | ✅ | initial schema 基準版本已建立，DB 結構變更無需刪除重建 |
| 多台設備架構 | ⏳ | 動態 device_id |
| 治具資料庫 | ⏳ | fixtures 表 |
| 認證系統 | ⏳ | JWT |
| RS-485 真實通訊 | ⏳ | 對接真實 KSON 溫箱 |
