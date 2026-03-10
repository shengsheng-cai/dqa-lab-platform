# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。

---
## 2026-03-10（續4）

**後端基礎建設**
- **feat**: 導入 Alembic 資料庫遷移管理，取代手動刪除重建 DB 的流程
- **feat**: 建立 initial schema 基準版本（`a517a1796fda`），涵蓋全部 6 張資料表
- **docs**: DB 結構變更流程：改 `models.py` → `alembic revision --autogenerate` → `alembic upgrade head`
- 
## 2026-03-10（續3）

**Dashboard.jsx**
- **feat**: 趨勢圖新增 Brush 縮放條，可拖拉查看完整測試波形
- **feat**: 趨勢圖改為顯示完整測試時長（從 started_at 至今），取代固定 60 分鐘
- **feat**: 圖表高度從 220 → 280，為 Brush 預留空間
- **feat**: Brush 預設視窗顯示最近 60 筆，保持最新資料在畫面右側
- **feat**: in-memory buffer 上限從 60 → 5760，覆蓋最長 96 小時測試（KEMA/DNV 濕熱穩態）
- **fix**: 溫度 Y 軸 domain 改為動態計算（含 10% padding + 對齊 10 的倍數），修正跨零點資料刻度顯示錯誤

## 2026-03-10（Code Review 全面修正）

### 後端

**models.py**
- **fix**: `SopExecution.test_started_at / test_ended_at` 型別由 `String` 改為 `DateTime`，修正報告中時間永遠顯示 N/A 的問題
- **fix**: `StepRecord.execution_id` 補上 `ForeignKey("sop_executions.id")`
- **fix**: `StepRecord.completed` 型別由 `String` 改為 `Boolean`
- **fix**: `DeviceState.updated_at` 補上 `onupdate` 自動更新時間戳

**main.py**
- **fix**: `@app.on_event("startup")` 改為 `@asynccontextmanager lifespan`，移除 FastAPI 棄用警告
- **fix**: 新增 `_now_utc()` 統一所有時間戳，解決 naive/aware datetime 混用問題
- **fix**: `update_progress` payload 改為 `ProgressPayload(BaseModel)`，修正原本用 `dict` 接收導致的 422 錯誤
- **fix**: `/api/devices` 回傳新增 `total_steps`（從 `active_sop_json` 解析），修正前端 DeviceCard 進度條永遠不顯示的問題
- **fix**: 模擬器改為每台設備獨立 `with SessionLocal() as db`，修正一台出錯導致全部 rollback 的問題
- **fix**: `FINISHING→IDLE` 補上清空 `running_sop_id / standard_id`

**sop.py**
- **fix**: `import datetime` 從函式內部移至頂層
- **fix**: `create_execution` 新增 `device_id`、`operator`、`test_started_at`、`test_ended_at` 欄位
- **fix**: `create_execution` 改為 `db.flush()` + 單次 `db.commit()`，修正各步驟各自 commit 不安全的問題

**reports.py**
- **fix**: 報告欄位鍵名 `dwell_time` → `dwell_time_hours`、`humidity` → `humidity_rh_percent`，修正報告停留時間與濕度永遠顯示 N/A 的問題
- **fix**: 新增 `_fmt_dt()` helper，安全格式化 `DateTime` 欄位，修正 `strftime()` 在 String 型別下的 AttributeError
- **fix**: `sop_data` 查詢改為直接用 `sop_id` 查，移除多餘迴圈
- **fix**: 移除模糊備用時間區間邏輯，測試時間未記錄時明確標示
- **fix**: 檔名改為 RFC 5987 編碼（`filename*=UTF-8''...`），修正非 ASCII 檔名下載問題
- **feat**: 新增 `GET /api/reports/list` 回傳所有執行紀錄

**errors.py**
- **fix**: `created_at` 改為 `datetime.datetime` 型別，由 FastAPI 自動序列化為 ISO 8601，移除手動 `strftime` 迴圈

**standards.py**
- **fix**: `_build_flat_standards()` 新增重複 `sop_id` 警告，避免靜默覆蓋
- **feat**: EN 50155:2017 新增 OT5 低溫冷測（-40°C，16h）
- **feat**: DNV Std.Cert.2.4 新增 Class C 乾熱（+55°C）與 Class D 乾熱（+70°C）
- 測試條件總數：62 → 64

### 前端

**index.css**
- **fix**: 統一背景色為 `#0d1117`，`#root` 設定 `height: 100vh + flex`，修正高度鏈中斷

**App.css**
- **chore**: 清空 Vite 殘留樣式

**SOPPage.css**
- **fix**: `.control-side` 新增 `height: 100%`、`overflow: hidden`，修正右側面板高度與捲動問題

**Dashboard.jsx**
- **fix**: 切換設備時從 history API 補撈歷史資料，修正切換後圖表清空的問題
- **fix**: 趨勢圖改為雙 Y 軸（溫度左軸/濕度右軸），避免刻度混用
- **feat**: 執行紀錄列表每 30 秒自動刷新

**SOPPage.jsx**
- **fix**: 步驟勾選改為依序鎖定，前一步未完成不可勾選後一步
- **fix**: 取消步驟時連鎖清除後續所有步驟
- **fix**: 每次勾選/取消即時呼叫後端 `progress` API 同步
- **fix**: 法規選擇（selectedStd/Ver/Test）改為 per-device state，切換設備不互相干擾
- **fix**: `generateSP()` 單次測試 `startTemp` 計算邏輯修正
- **fix**: `useEffect` dependency 改為 `startedAt` 字串，避免無限迴圈
- **fix**: `create_execution` 呼叫補上 `device_id`、`test_started_at`

**Errorlog.jsx**
- **fix**: `minHeight: 100vh` 改為 `height: 100% + overflowY: auto`，修正版面溢出
- **fix**: 新增 `fmtDatetime()` 統一處理 ISO 8601 時間字串（配合 errors.py 修正）
- **feat**: 每 10 秒自動刷新異常紀錄

---

## 2026-03-10（續2）

- **fix**: `Dashboard.jsx` `minHeight: 100vh` 改為 `height: 100% + overflowY: auto`，修復儀表板無法向下捲動
- **fix**: `SOPPage.css` `monitor-side` 新增 `height: 100%`、`overflow-y: auto`、`box-sizing: border-box`，修復左側面板無法向下捲動
- **fix**: `index.css` `#root` 新增 `height: 100vh`、`display: flex`、`flex-direction: column`，修復高度鏈中斷
- **feat**: `SOPPage.jsx` `TempChart` 全面重寫，改為 SP 目標曲線（灰虛線）+ PV 實際曲線（紅實線）疊加顯示，X 軸為完整測試時長
- **feat**: `SOPPage.jsx` 新增 `generateSP()` 函式，依 `ramp_rate` / `high_temperature` / `low_temperature` / `dwell_time_hours` / `cycles` 計算完整目標曲線；循環測試幾次畫幾個波
- **feat**: `SOPPage.jsx` `TempChart` 支援雙 Y 軸（溫度左、濕度右）、Brush 縮放，預設顯示最近 120 分鐘
- **feat**: `SOPPage.jsx` 左側新增執行資訊面板（Pgm / Step / Free Time / Cycle / Now Time / End Time），對應 KSON 溫箱面板格式，測試進行中才顯示
- **feat**: `SOPPage.jsx` 圖表資料來源改為 history API（每分鐘一點），切換設備時重撈，每分鐘整點自動 append

---

## 2026-03-10

- **feat**: `models.py` `DeviceState` 新增 `completed_steps`（Integer，預設 0）欄位
- **feat**: `models.py` `DeviceState` 新增 `started_at`（DateTime，nullable）欄位，啟動 SOP 時立即記錄，符合 ISO 17025 §7.5.1
- **feat**: `main.py` 新增 `POST /api/devices/{device_id}/progress` API，更新完成步驟數並持久化
- **feat**: `main.py` `/api/devices` 回傳 `completed_steps`、`started_at`
- **feat**: `main.py` 停止（normal / emergency）時清零 `completed_steps`、清空 `started_at`
- **feat**: `main.py` 重啟恢復時帶入 `completed_steps`、`started_at`
- **feat**: `sop.py` 啟動 SOP 時寫入 `started_at` 至 DB 與 AICM_CACHE，並清零 `completed_steps`
- **feat**: `SOPPage.jsx` 步驟改為依序勾選：前一個非 optional 步驟完成才解鎖下一步
- **feat**: `SOPPage.jsx` 取消步驟時連鎖清除後續所有步驟，鎖住的步驟顯示 opacity 0.4 與 not-allowed cursor
- **feat**: `SOPPage.jsx` 勾選/取消步驟時呼叫 `POST /api/devices/{id}/progress` 同步後端
- **feat**: `Dashboard.jsx` DeviceCard 顯示步驟進度條（completed_steps / total_steps）與 X/X 數字
- **feat**: `Dashboard.jsx` 趨勢圖拆為兩個 timer：每 1 秒更新溫濕度數字、每 60 秒存一個趨勢圖資料點
- **feat**: `Dashboard.jsx` X 軸 tickFormatter 顯示 HH:mm，與真實設備記錄頻率一致

---

## 2026-03-06（續）

- **feat**: `models.py` 新增 `DeviceState` 表，儲存設備狀態、溫度、active_sop_json，支援重啟後恢復
- **feat**: `main.py` 啟動時從 `DeviceState` 表讀回上次狀態，RUNNING 直接恢復（不降級為 PAUSED）
- **feat**: `main.py` 模擬器每 10 秒同步寫入 `DeviceState`，確保狀態持久化
- **feat**: `main.py` 緊急停止、正常停止、FINISHING→IDLE 時立即同步 `DeviceState`
- **feat**: `sop.py` 啟動 SOP 時將 `active_sop_json` 寫入 `DeviceState`
- **feat**: `main.py` `/api/devices` 回傳 `active_sop_json`，供前端重啟後恢復步驟清單
- **feat**: `SOPPage.jsx` 輪詢時自動從 `active_sop_json` 恢復 `activeSop` 與步驟清單
- **fix**: `App.jsx` `minHeight: 100vh` 改為 `height: 100vh`，修復 SOPPage layout 溢出
- **fix**: `SOPPage.css` `width: 100vw` 改為 `width: 100%`，修復 layout 滲出問題
- **feat**: `SOPPage.jsx` HUMI PV 整合進 TEMP/HUMI TREND 卡片右上角
- **feat**: `Dashboard.jsx` 趨勢圖改為可切換 5 台設備，各自維護獨立 history buffer
- **fix**: `dev_start.sh` 啟動前強制釋放 port 8000 / 5173
- **chore**: 刪除根目錄多餘的 `test.db`、`backend/app/database.py`、`backend/templates/`、`docs/screenshots/demo.gif`、`client/public/vite.svg`
- **chore**: `serial_reader.py` 頂部加上 Phase 3 預留說明
- **refactor**: `sop_execution.py` 合併進 `sop.py`

---

## 2026-03-06

- **fix**: 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存量測數據
- **feat**: `SopExecution` 新增 `operator`、`device_id`、`test_started_at`、`test_ended_at` 欄位，符合 §7.5.1
- **fix**: `reports.py` 移除系統自動 PASS/FAIL 判定，改為工程師人工填寫，符合 §7.8.6 & §7.8.7
- **fix**: `reports.py` 原始數據查詢範圍依 `test_started_at` / `test_ended_at` 決定，符合 §7.5.2
- **feat**: `SOPPage.jsx` SELECT DEVICE 每顆按鈕即時反映各自設備狀態顏色，RUNNING 時加發光效果
- **feat**: `Dashboard.jsx` 執行紀錄表格新增「設備」、「執行人員」、「測試開始」三欄

---

## 2026-03-04（續）

- **feat**: 新增 `ErrorLog` 表與 `errors.py` router，`GET /api/errors/` 回傳所有異常紀錄
- **feat**: `emergency_stop()` 觸發時自動寫入 error_logs
- **feat**: 新增「異常看板」頁面（`ErrorLog.jsx`）
- **feat**: `Dashboard.jsx` 統一 GitHub dark 主題，新增執行紀錄列表與一鍵下載 CSV
- **feat**: `SOPPage.jsx` 新增即時 TEMP TREND 折線圖、EMERGENCY 閃爍、步驟進度條

---

## 2026-03-04

- **feat**: `standards.py` 重構為三層巢狀 `STANDARD_TREE`，6 法規 62 個測試條件
- **feat**: `GET /api/sop/standards/tree` 新端點
- **perf**: `device_data` 寫入頻率從每秒改為每 10 秒，減少 90% 寫入量
- **fix**: CSV 報告編碼改為 big5
- **docs**: 新增 `CHANGELOG.md`、`AGENTS.md`

---

## 2026-03-03

- **fix**: `FINISHING` 降溫完成後自動回 `IDLE`
- **fix**: 暫停切換改為 `RUNNING ↔ PAUSED` 真正切換
- **feat**: 上架驗證注意事項確認框、待機/執行中畫面自動切換邏輯
- **feat**: ISO 17025 格式測試報告（`reports.py`）

---

## 2026-03-02

- 整合 EN50155、IEC60068 環境測試標準
- 動態 SOP 管理系統
- 前端 SOP 列表動態載入