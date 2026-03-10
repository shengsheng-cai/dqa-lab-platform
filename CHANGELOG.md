# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。

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