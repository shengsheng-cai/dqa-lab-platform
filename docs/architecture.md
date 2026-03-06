# 🏗️ DQA LAB 數位雙生平台 - 系統完整架構圖

本文件詳列所有已完成與規劃中之模組，作為後續開發追蹤使用。更新紀錄請見 [CHANGELOG.md](../CHANGELOG.md)。

---

## 📁 客戶端 (Browser) - React 前端模塊

* **✅ 全域路由控制 (App Router)**: 由 `App.jsx` 統一管理頂部導航列，active 頁面高亮顯示。
* **✅ 儀表板 (Dashboard)**:
    * 即時溫濕度大字顯示，TEMP/HUMI 各自 accent 色邊框。
    * 60 秒趨勢折線圖（溫度 + 濕度雙線）。
    * 六種狀態 badge 顏色區分（RUNNING / PAUSED / FINISHING / EMERGENCY / IDLE / OFFLINE）。
    * 歷史執行紀錄列表，每筆可直接下載 CSV 報告，顯示設備、執行人員、測試開始時間。
    * 統一 GitHub dark 主題，與 SOPPage 風格一致。
* **✅ SOP 執行頁 (SOPPage)**:
    * 採用 **40/60 雙欄佈局**：左側數據監控、右側操作面板。
    * **三步驟法規選擇 UI**：法規 → 版本/Class → 測試條件，從 `/api/sop/standards/tree` 動態載入，選定後顯示完整測試條件說明。
    * **SELECT DEVICE 即時狀態**：每顆設備按鈕即時反映各自狀態顏色（綠色 RUNNING / 紅色 EMERGENCY / 灰色 IDLE），RUNNING 時加發光效果。
    * **狀態自動切換**: 待機顯示注意事項 + SOP 列表；執行中顯示步驟清單，兩種畫面自動切換。
    * **暫停切換邏輯**: `RUNNING ↔ PAUSED` 真正來回切換。
    * **停止後回待機**: 正常停止 / 緊急停止後前端正確切回待機畫面。
    * **緊急停止修復**: `EMERGENCY` 狀態下正常停止按鈕可用（`canStop = isActive || isEmergency`）。
    * **SOP 步驟追蹤**: 依各標準客制化步驟數，Step 1、2 自動勾選，其餘人工確認，含進度條顯示。
    * **儲存 + 下載**: 全步驟完成後可儲存執行紀錄（含 device_id），儲存後顯示「下載 CSV 測試報告」按鈕。
    * **上架安全確認**: 四項注意事項全勾才能啟動測試。
    * **即時溫濕度折線圖**: 左側面板顯示 60 秒 TEMP TREND，溫度（紅）+ 濕度（藍）雙線，含目標溫度虛線參考，X 軸顯示秒數刻度。
    * **EMERGENCY 閃爍**: 緊急停止時控制面板紅色閃爍提示。
    * **STATUS_CONFIG 統一**: SOPPage 與 Dashboard 共用同一份狀態色彩設定（含 label 欄位）。
* **✅ 異常看板 (ErrorLog)**:
    * 統計卡片：緊急停止總次數、最近異常時間、涉及設備。
    * 完整紀錄列表：ID、設備、類型 badge、執行中 SOP、當下溫濕度、備註、時間。
* **規劃中 — AI 輔助模組**（對應開案前流程）:
    * **治具管理助手**: 使用者自然語言描述需求 → LLM 推理治具組合 → 自動產出借用申請
    * **設備排程預估**: 使用者輸入測試需求 → LLM 結合排程資料計算最快時間窗口 → 管理者確認
    * **法規諮詢助手**: 使用者描述產品與目標 → LLM 建議法規版本與測試條件（開案前評估用）
* **規劃中**:
    * **治具管理 (Fixtures)**: 治具清單、借用狀態追蹤。
    * **設備管理 (Devices)**: 多台設備狀態總覽。
    * **使用者中心 (User)**: 權限控管、個人執行紀錄。

---

## 📁 後端 API 路由層 (FastAPI)

### 已完成 ✅

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（每秒輪詢） |
| GET  | `/api/devices` | 所有設備即時狀態 |
| GET  | `/api/sop/` | SOP 列表（從 STANDARD_TREE 自動展開） |
| GET  | `/api/sop/standards/tree` | 完整三層標準樹（法規→版本→測試條件） |
| POST | `/api/sop/start` | 啟動 SOP，更新 AICM_CACHE 狀態 |
| POST | `/api/sop-executions/` | 儲存 SOP 執行紀錄（含 operator、device_id、測試時間） |
| GET  | `/api/sop-executions/{id}` | 讀取指定執行紀錄 |
| GET  | `/api/reports/csv/{execution_id}` | 下載 CSV 測試報告（big5 編碼，Excel 相容） |
| GET  | `/api/reports/list` | 所有執行紀錄列表（含 device_id、operator、測試時間） |
| GET  | `/api/errors/` | 異常紀錄列表（最新在前） |
| POST | `/api/stop/{device_id}/pause` | `RUNNING ↔ PAUSED` 切換 |
| POST | `/api/stop/{device_id}/normal` | 進入 `FINISHING`，降溫完成後自動回 `IDLE` |
| POST | `/api/stop/{device_id}/emergency` | 強制進入 `EMERGENCY`，自動寫入異常紀錄 |

### 規劃中 ⏳
* **`/api/auth`** — JWT 登入驗證
* **`/api/ai/fixture-recommend`** — LLM 治具推薦
* **`/api/ai/schedule-estimate`** — LLM 排程預估
* **`/api/ai/standards-query`** — LLM 法規諮詢

---

## 📁 環境測試標準模組 (standards.py)

### 架構：三層巢狀 `STANDARD_TREE`

```
STANDARD_TREE
├── 法規（IEC 60068 / EN 50155 / IEC 61850-3 / DNV / KEMA / NMEA）
│   ├── 版本（Ed.1 / Ed.2 / 2007 / 2017 / CG-0339 / Std.Cert.2.4 …）
│   │   └── 測試條件（乾熱 / 冷測 / 濕熱 / 溫度循環 / 熱衝擊 …）
│   │       ├── 溫度範圍、速率、停留時間、循環次數
│   │       ├── 濕度設定、通電/非通電
│   │       ├── 溫度容差、濕度容差（各標準不同）
│   │       ├── 法規條文參考（IEC/EN 條款編號）
│   │       └── 客制化 SOP 步驟（依測試類型自動生成）
```

`STANDARDS_AND_SOPS` 由 `_build_flat_standards()` 從 `STANDARD_TREE` 自動展開，供 `sop.py`、`main.py`、`reports.py` 向後相容使用。

### 已整合標準（共 62 個測試條件）✅

| 法規 | 版本數 | 測試條件數 | 主要測試項目 |
|------|--------|-----------|------------|
| **IEC 60068** | 4 | 12 | Test Ab/Ad（冷）、Ba/Bb（乾熱）、Na/Nb（溫度循環/熱衝擊）、Db（濕熱循環） |
| **EN 50155** | 2 | 18 | OT1~OT6 各高溫/低溫分開、ST1 開機延伸、快速溫度變化（隧道模擬）、濕熱循環 |
| **IEC 61850-3** | 2 | 9 | Class C1/C2/C3 各自乾熱 + 冷測 + 濕熱、Ed.1 向後相容 |
| **DNV** | 2 | 12 | CG-0339 Class A/B/C/D、Std.Cert.2.4 舊版、C/D 冷測強制標註 |
| **KEMA** | 1 | 4 | 乾熱（Test Bb）、冷測（Test Ab）、濕熱穩態（Test Cab）、溫度循環（Test Nb） |
| **NMEA** | 2 | 7 | IEC 60945 受保護/暴露裝置分開、NMEA 0183/2000 各自乾熱+冷測+濕熱 |

### 容差規格（依法規不同）

| 法規 | 溫度容差 | 濕度容差 | 依據 |
|------|--------|---------|------|
| IEC 60068 / EN 50155 / IEC 61850-3 / KEMA / NMEA | ±2°C | ±5%RH | IEC 60068 一般量測 |
| DNV CG-0339 / DNV Std.Cert.2.4 | ±2°C | **±10%RH** | DNVGL-CG-0339 規定 |

---

## 📁 業務服務層 & 資料模型

### 物理模擬引擎 (main.py) ✅
* 升降溫斜率模擬，遵守各標準速率限制（從 `get_ramp_rate()` 動態讀取）
* 每 10 秒寫一次資料庫（優化後減少 90% 寫入量）
* **依 ISO/IEC 17025:2017 §7.5 & §8.4，量測數據永久保存，不自動刪除**
* `FINISHING` 狀態自動降溫至 25°C 後回 `IDLE`
* `EMERGENCY` 狀態微幅抖動，觸發時自動寫入 `error_logs`
* ±0.1°C 隨機抖動增加真實感

### 異常紀錄引擎 (errors.py) ✅
* `ErrorLog` 表記錄：device_id、error_type、sop_id、sop_name、temperature、humidity、note、created_at
* `GET /api/errors/` 回傳所有紀錄，最新在前
* 目前 error_type：`EMERGENCY`（未來可擴充 `SENSOR_ERROR`、`OVERTEMP` 等）

### 測試報告引擎 (reports.py) ✅
* 依照 **ISO/IEC 17025:2017 §7.8** 格式，共 7 節
* 報告節次：識別資訊 → 樣品資訊 → 測試條件 → 步驟記錄（含執行人員）→ 統計摘要 → 測試結論 → 原始數據
* **依 §7.8.6 & §7.8.7：符合性宣告（PASS/FAIL）由授權工程師人工填寫，系統不自動判定**
* 原始數據查詢範圍依實際 `test_started_at` / `test_ended_at` 決定（§7.5.2）
* **big5 編碼**，macOS / Windows Excel 中文正確顯示

### 報告架構

```
測試完成
    │
    ├─ 系統自動產生
    │       GET /api/reports/csv/{id}
    │       ISO 17025 格式 CSV，含原始溫濕度數據
    │       PASS/FAIL 欄位留空，由工程師人工填寫
    │
    └─ 規劃中：半自動整合
            載入測試照片 + 從系統 CSV 自動抓取數據
            填入 QA_Test_Report_Template.docx
```

### 資料庫表格 (SQLite)

| 表格 | 狀態 | 說明 |
|------|------|------|
| `device_data` | ✅ | 歷史溫濕度（每 10 秒，永久保存）|
| `device_states` | ✅ | 設備狀態持久化（status、temperature、active_sop_json，重啟後恢復用）|
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
* **⏳ Phase 3 — RS-485/RJ45 真實串口通訊**: 對接真實 KSON 溫箱，`serial_reader.py` 已預留，尚未啟用

---

## 🔄 數據流程圖

```
【開案前 — AI 輔助流程】

使用者自然語言輸入（治具 / 排程 / 法規諮詢）
        │
LLM 推理（Claude API）
        │
輸出建議 → 管理者確認 → 寫入系統

─────────────────────────────────────────

【執行階段 — 測試流程】

STANDARD_TREE (standards.py)
        │
        ├─ GET /api/sop/standards/tree
        │       └─ 前端三步驟選擇 UI
        │              法規 → 版本/Class → 測試條件
        │
        └─ STANDARDS_AND_SOPS（自動展開）
                ├─ sop.py       ← GET /api/sop/
                ├─ main.py      ← get_ramp_rate() 限制速率
                └─ reports.py   ← 讀取容差，工程師人工判定

使用者確認注意事項 → POST /api/sop/start
        │
物理模擬引擎（每 10 秒寫 device_data，永久保存）
        │
前端輪詢 /api/latest（每秒）
        │
步驟逐一人工勾選完成
        │
POST /api/sop-executions/（儲存紀錄，含 device_id）
        │
GET /api/reports/csv/{id}（下載 CSV，PASS/FAIL 工程師填寫）
        │
正常停止 → FINISHING → 自動降溫 → IDLE → 回待機畫面
緊急停止 → EMERGENCY → 自動寫入 error_logs → 等待正常停止
```

---

## 📊 完成度統計

| 模組 | 狀態 | 說明 |
|------|------|------|
| 前端路由 | ✅ | App.jsx 統一管理，active 頁面高亮 |
| 儀表板 | ✅ | 即時監控、趨勢圖、六種狀態、執行紀錄列表（含 device_id、operator）|
| SOP 三步驟法規選擇 | ✅ | 法規→版本→測試條件，動態載入 |
| SELECT DEVICE 即時狀態 | ✅ | 每顆按鈕反映各設備即時狀態顏色 |
| STATUS_CONFIG 統一 | ✅ | SOPPage 與 Dashboard 共用，含 label 欄位 |
| SOP 執行畫面切換 | ✅ | 待機/執行中自動切換 |
| SOP 步驟追蹤 | ✅ | 客制化步驟，啟動自動勾選前兩步，進度條 |
| 上架安全確認 | ✅ | 四項全勾才能啟動 |
| 暫停/停止邏輯 | ✅ | RUNNING↔PAUSED，FINISHING→IDLE，EMERGENCY 修復 |
| EMERGENCY 閃爍 | ✅ | 控制面板紅色閃爍提示 |
| 即時折線圖 | ✅ | TEMP TREND 溫度+濕度雙線，X 軸秒數刻度，含目標溫度虛線 |
| 異常看板 | ✅ | 緊急停止自動記錄，統計卡片 + 列表 |
| 環境測試標準 | ✅ | 6 法規，62 個測試條件，官方參數 |
| 物理模擬引擎 | ✅ | 標準化升降溫，每 10 秒寫 DB |
| 17025 記錄保存 | ✅ | 移除自動刪除，依 §7.5 & §8.4 永久保存 |
| 執行人員記錄 | ✅ | SopExecution 新增 operator、device_id、test_started_at、test_ended_at |
| 執行紀錄 API | ✅ | 合併進 `sop.py`（原 `sop_execution.py`）|
| CSV 測試報告 | ✅ | ISO 17025 格式，big5 Excel 相容，PASS/FAIL 人工填寫 |
| 設備狀態持久化 | ✅ | DeviceState 表，每 10 秒同步，重啟後自動恢復 RUNNING/PAUSED/EMERGENCY |
| SOP 重啟恢復 | ✅ | active_sop_json 存 DB，前端輪詢自動恢復步驟清單 |
| 趨勢圖多設備切換 | ✅ | Dashboard 趨勢圖可切換 5 台設備，各自獨立 history buffer |
| dev_start.sh | ✅ | socat 串口重試偵測、crash 自動 cleanup、保留日誌供查閱 |
| AI 輔助模組 | ⏳ | 治具助手、排程預估、法規諮詢 |
| 報告半自動整合 | ⏳ | 載入照片 + 從 CSV 自動抓取數據填入模板 |
| 多台設備架構 | ⏳ | 動態 device_id |
| 治具資料庫 | ⏳ | fixtures 表 |
| 故障通報 | ⏳ | Email（error_logs 已就緒）|
| 認證系統 | ⏳ | JWT |
| RS-485 真實通訊 | ⏳ | 對接真實 KSON 溫箱 |