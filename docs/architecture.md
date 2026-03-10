# 🏗️ DQA LAB 數位雙生平台 - 系統完整架構圖

本文件詳列所有已完成與規劃中之模組，作為後續開發追蹤使用。更新紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📁 客戶端 (Browser) - React 前端模塊

* **✅ 全域路由控制 (App Router)**: 由 `App.jsx` 統一管理頂部導航列，active 頁面高亮顯示。
* **✅ 儀表板 (Dashboard)**:
    * 即時溫濕度大字顯示（每秒更新），TEMP/HUMI 各自 accent 色邊框。
    * 趨勢折線圖（溫度 + 濕度雙線），每 60 秒存一個資料點，顯示最近 60 分鐘，X 軸 HH:mm 格式。
    * DeviceCard 顯示步驟進度條（completed_steps / total_steps）。
    * 六種狀態 badge 顏色區分（RUNNING / PAUSED / FINISHING / EMERGENCY / IDLE / OFFLINE）。
    * 歷史執行紀錄列表，每筆可直接下載 CSV 報告，顯示設備、執行人員、測試開始時間。
    * 統一 GitHub dark 主題，與 SOPPage 風格一致。
* **✅ SOP 執行頁 (SOPPage)**:
    * 採用 **40/60 雙欄佈局**：左側數據監控、右側操作面板。
    * **三步驟法規選擇 UI**：法規 → 版本/Class → 測試條件，從 `/api/sop/standards/tree` 動態載入。
    * **SELECT DEVICE 即時狀態**：每顆設備按鈕即時反映各自狀態顏色，RUNNING 時加發光效果。
    * **狀態自動切換**: 待機顯示注意事項 + SOP 列表；執行中顯示步驟清單。
    * **SOP 步驟依序追蹤**: 前一步完成才解鎖下一步；取消步驟時連鎖清除後續；Optional 步驟不影響解鎖；勾選同步後端 `completed_steps`。
    * **上架安全確認**: 四項注意事項全勾才能啟動測試。
    * **重啟後步驟恢復**: `active_sop_json` 存 DB，前端輪詢自動恢復步驟清單。
    * **儲存 + 下載**: 全步驟完成後可儲存執行紀錄，儲存後顯示「下載 CSV 測試報告」按鈕。
    * **即時溫濕度折線圖**: 左側面板顯示 TEMP/HUMI TREND，溫度（紅）+ 濕度（藍）雙線，含目標溫度虛線。
    * **EMERGENCY 閃爍**: 緊急停止時控制面板紅色閃爍提示。
* **✅ 異常看板 (ErrorLog)**:
    * 統計卡片：緊急停止總次數、最近異常時間、涉及設備。
    * 完整紀錄列表：ID、設備、類型 badge、執行中 SOP、當下溫濕度、備註、時間。
* **規劃中 — AI 輔助模組**（對應開案前流程）:
    * **治具管理助手**: 自然語言描述需求 → LLM 推理治具組合 → 自動產出借用申請
    * **設備排程預估**: 使用者輸入測試需求 → LLM 結合排程資料計算最快時間窗口
    * **法規諮詢助手**: 使用者描述產品與目標 → LLM 建議法規版本與測試條件
* **規劃中**:
    * **治具管理 (Fixtures)**、**設備管理 (Devices)**、**使用者中心 (User)**、**Reports 頁面前端元件**

---

## 📁 後端 API 路由層 (FastAPI)

### 已完成 ✅

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（每秒輪詢） |
| GET  | `/api/devices` | 所有設備即時狀態（含 completed_steps、started_at）|
| GET  | `/api/sop/` | SOP 列表（從 STANDARD_TREE 自動展開） |
| GET  | `/api/sop/standards/tree` | 完整三層標準樹（法規→版本→測試條件） |
| POST | `/api/sop/start` | 啟動 SOP，記錄 started_at，清零 completed_steps |
| POST | `/api/devices/{id}/progress` | 更新完成步驟數並持久化 |
| POST | `/api/sop-executions/` | 儲存 SOP 執行紀錄 |
| GET  | `/api/sop-executions/{id}` | 讀取指定執行紀錄 |
| GET  | `/api/reports/csv/{execution_id}` | 下載 CSV 測試報告（big5 編碼，Excel 相容） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表（最新在前） |
| POST | `/api/stop/{device_id}/pause` | `RUNNING ↔ PAUSED` 切換 |
| POST | `/api/stop/{device_id}/normal` | 進入 `FINISHING`，降溫完成後自動回 `IDLE` |
| POST | `/api/stop/{device_id}/emergency` | 強制進入 `EMERGENCY`，自動寫入異常紀錄 |

### 規劃中 ⏳
* **`/api/auth`** — JWT 登入驗證
* **`/api/ai/fixture-recommend`**、**`/api/ai/schedule-estimate`**、**`/api/ai/standards-query`**

---

## 📁 環境測試標準模組 (standards.py)

三層巢狀 `STANDARD_TREE`，6 法規 62 個測試條件。詳見原始 architecture.md 標準表格（內容不變）。

---

## 📁 業務服務層 & 資料模型

### 物理模擬引擎 (main.py) ✅
* 升降溫斜率模擬，遵守各標準速率限制（從 `get_ramp_rate()` 動態讀取）
* 每 10 秒寫一次資料庫（依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存，不自動刪除）
* `FINISHING` 狀態自動降溫至 25°C 後回 `IDLE`
* `EMERGENCY` 狀態微幅抖動，觸發時自動寫入 `error_logs`

### 資料庫表格 (SQLite)

| 表格 | 狀態 | 說明 |
|------|------|------|
| `device_data` | ✅ | 歷史溫濕度（每 10 秒，永久保存）|
| `device_states` | ✅ | 設備狀態持久化（status、temperature、active_sop_json、completed_steps、started_at）|
| `sop_executions` | ✅ | 執行歷程主表（含 operator、device_id、test_started_at、test_ended_at）|
| `step_records` | ✅ | 每步驟完成狀態 |
| `sop_templates` | ✅ | 自訂 SOP（DB 版，補充 standards.py） |
| `error_logs` | ✅ | 緊急停止事件紀錄 |
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
| 儀表板 | ✅ | 即時監控、趨勢圖（每分鐘一點）、六種狀態、執行紀錄列表 |
| DeviceCard 步驟進度 | ✅ | completed_steps / total_steps 進度條 |
| SOP 三步驟法規選擇 | ✅ | 法規→版本→測試條件，動態載入 |
| SELECT DEVICE 即時狀態 | ✅ | 每顆按鈕反映各設備即時狀態顏色 |
| SOP 步驟依序追蹤 | ✅ | 依序解鎖、取消連鎖清除、Optional 可跳過 |
| 上架安全確認 | ✅ | 四項全勾才能啟動 |
| 暫停/停止邏輯 | ✅ | RUNNING↔PAUSED，FINISHING→IDLE，EMERGENCY 修復 |
| EMERGENCY 閃爍 | ✅ | 控制面板紅色閃爍提示 |
| 即時折線圖 | ✅ | TEMP/HUMI 雙線，含目標溫度虛線 |
| 異常看板 | ✅ | 緊急停止自動記錄，統計卡片 + 列表 |
| 環境測試標準 | ✅ | 6 法規，62 個測試條件，官方參數 |
| 物理模擬引擎 | ✅ | 標準化升降溫，每 10 秒寫 DB |
| 17025 記錄保存 | ✅ | 永久保存，依 §7.5 & §8.4 |
| started_at 記錄 | ✅ | SOP 啟動時立即寫入，符合 §7.5.1 |
| 執行人員記錄 | ✅ | operator、device_id、test_started_at、test_ended_at |
| 執行紀錄 API | ✅ | 合併進 `sop.py` |
| CSV 測試報告 | ✅ | ISO 17025 格式，big5，PASS/FAIL 人工填寫 |
| 設備狀態持久化 | ✅ | DeviceState 表，每 10 秒同步，重啟後自動恢復 |
| SOP 重啟恢復 | ✅ | active_sop_json 存 DB，前端輪詢自動恢復 |
| 趨勢圖多設備切換 | ✅ | 可切換 5 台設備，各自獨立 history buffer |
| 趨勢圖每分鐘一點 | ✅ | 每 60 秒存一點，數字每秒更新，X 軸 HH:mm |
| dev_start.sh | ✅ | socat 串口重試偵測、crash 自動 cleanup |
| AI 輔助模組 | ⏳ | 治具助手、排程預估、法規諮詢 |
| 報告半自動整合 | ⏳ | 載入照片 + 從 CSV 自動抓取數據填入模板 |
| DeviceCard 倒數計時器 | ⏳ | started_at 已就緒，待前端實作 |
| SOPPage 左側執行細節面板 | ⏳ | Pgm / Step / Free Time / Cycle / End Time |
| Reports 頁面前端元件 | ⏳ | 後端 API 已完成 |
| 多台設備架構 | ⏳ | 動態 device_id |
| 治具資料庫 | ⏳ | fixtures 表 |
| 認證系統 | ⏳ | JWT |
| RS-485 真實通訊 | ⏳ | 對接真實 KSON 溫箱 |
| 資料庫遷移 (Alembic) | ⏳ | Phase 3 前需完成，目前 DB 結構變更需重建 |