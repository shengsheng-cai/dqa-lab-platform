# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。

---

## 2026-03-11

**AI 輔助模組 — 法規諮詢助手（後端）**

- **feat**: 新增 `backend/app/ai.py`，實作 `POST /api/ai/standards-query` 端點
- **feat**: `_build_system_prompt()` 將 STANDARD_TREE 64 個測試條件摘要嵌入 system prompt
- **feat**: 串接本機 Ollama `qwen2.5:7b`，支援多輪對話（history 帶入）
- **feat**: `main.py` 註冊 `ai_router`
- **fix**: `dev_start.sh` 後端改用 `../venv/bin/uvicorn`，確保 httpx 等套件正確載入
- **chore**: `backend/requirements.txt` 補上 `httpx`

---

## 2026-03-10

**後端**

- **feat**: 導入 Alembic 資料庫遷移管理，取代手動刪除重建 DB 的流程；建立 initial schema 基準版本（`a517a1796fda`），涵蓋全部 6 張資料表
- **feat**: `main.py` 新增 `_calc_estimated_end_at()`，依 SOP 總時長（ramp + dwell × cycles）計算預估結束時間；`/api/devices` 回傳新增 `estimated_end_at`（ISO 8601），RUNNING/PAUSED 時計算，其他狀態回傳 null
- **feat**: `main.py` 新增 `POST /api/devices/{device_id}/progress` API，更新完成步驟數並持久化
- **feat**: `main.py` `/api/devices` 回傳新增 `total_steps`（從 `active_sop_json` 解析）、`completed_steps`、`started_at`
- **feat**: `main.py` 停止（normal / emergency）時清零 `completed_steps`、清空 `started_at`
- **feat**: `main.py` 重啟恢復時帶入 `completed_steps`、`started_at`
- **feat**: `sop.py` 啟動 SOP 時寫入 `started_at` 至 DB 與 AICM_CACHE，並清零 `completed_steps`
- **feat**: `models.py` `DeviceState` 新增 `completed_steps`（Integer，預設 0）與 `started_at`（DateTime，nullable）欄位，符合 ISO 17025 §7.5.1
- **fix**: `@app.on_event("startup")` 改為 `@asynccontextmanager lifespan`，移除 FastAPI 棄用警告
- **fix**: 新增 `_now_utc()` 統一所有時間戳，解決 naive/aware datetime 混用問題
- **fix**: `update_progress` payload 改為 `ProgressPayload(BaseModel)`，修正 422 錯誤
- **fix**: 模擬器改為每台設備獨立 `with SessionLocal() as db`，修正一台出錯導致全部 rollback 的問題
- **fix**: `FINISHING→IDLE` 補上清空 `running_sop_id / standard_id`
- **fix**: `SopExecution.test_started_at / test_ended_at` 型別由 `String` 改為 `DateTime`，修正報告時間永遠顯示 N/A
- **fix**: `StepRecord.execution_id` 補上 `ForeignKey("sop_executions.id")`；`completed` 型別由 `String` 改為 `Boolean`
- **fix**: `DeviceState.updated_at` 補上 `onupdate` 自動更新時間戳
- **fix**: `sop.py` `create_execution` 改為 `db.flush()` + 單次 `db.commit()`，新增 `device_id`、`operator`、`test_started_at`、`test_ended_at` 欄位
- **fix**: `reports.py` 欄位鍵名 `dwell_time` → `dwell_time_hours`、`humidity` → `humidity_rh_percent`；新增 `_fmt_dt()` helper；檔名改為 RFC 5987 編碼
- **feat**: `reports.py` 新增 `GET /api/reports/list`
- **fix**: `errors.py` `created_at` 改為 `datetime.datetime` 型別，由 FastAPI 自動序列化為 ISO 8601
- **fix**: `standards.py` `_build_flat_standards()` 新增重複 `sop_id` 警告
- **feat**: `standards.py` EN 50155:2017 新增 OT5 低溫冷測（-40°C，16h）；DNV Std.Cert.2.4 新增 Class C/D 乾熱；測試條件總數 62 → 64
- **chore**: `backend/requirements.txt` 補上 alembic；`backend/init_db.py` 加上 Alembic 使用提示註解

**前端**

- **feat**: `Dashboard.jsx` DeviceCard 新增倒數計時器（`useCountdown` hook），每秒更新，歸零後顯示紅色 00:00:00
- **feat**: `Dashboard.jsx` 趨勢圖新增 Brush 縮放條；改為顯示完整測試時長（從 started_at 至今）；in-memory buffer 上限 5760 點（覆蓋 96h）
- **feat**: `Dashboard.jsx` DeviceCard 顯示步驟進度條（completed_steps / total_steps）
- **feat**: `Dashboard.jsx` 執行紀錄列表每 30 秒自動刷新；趨勢圖改為雙 Y 軸
- **feat**: `SOPPage.jsx` 左側新增執行資訊面板（Pgm / Step / Free Time / Cycle / Now Time / End Time）
- **feat**: `SOPPage.jsx` `TempChart` 改為 SP 目標曲線（灰虛線）+ PV 實際曲線（紅實線）疊加，支援雙 Y 軸、Brush 縮放
- **fix**: `SOPPage.jsx` 步驟依序鎖定，取消時連鎖清除後續；每次勾選即時同步後端
- **fix**: `SOPPage.jsx` 法規選擇改為 per-device state；`generateSP()` 單次測試邏輯修正
- **fix**: `index.css` / `App.css` / `SOPPage.css` / `Dashboard.jsx` / `Errorlog.jsx` 捲動架構全面修正
- **feat**: `Errorlog.jsx` 每 10 秒自動刷新；新增 `fmtDatetime()` 統一處理 ISO 8601 時間字串

---

## 2026-03-06

- **feat**: `models.py` 新增 `DeviceState` 表，支援重啟後恢復狀態、步驟進度與 SOP 資料
- **feat**: `main.py` 啟動時從 `DeviceState` 讀回上次狀態，RUNNING 直接恢復
- **feat**: `main.py` 模擬器每 10 秒同步寫入 `DeviceState`
- **feat**: `sop.py` 啟動 SOP 時將 `active_sop_json` 寫入 `DeviceState`
- **feat**: `SOPPage.jsx` 輪詢時自動從 `active_sop_json` 恢復步驟清單
- **feat**: `SOPPage.jsx` SELECT DEVICE 每顆按鈕即時反映各設備狀態顏色，RUNNING 時加發光效果
- **feat**: `Dashboard.jsx` 趨勢圖改為可切換 5 台設備，各自維護獨立 history buffer；執行紀錄表格新增「設備」、「執行人員」、「測試開始」三欄
- **fix**: `App.jsx` / `SOPPage.css` layout 溢出修正
- **fix**: `dev_start.sh` 啟動前強制釋放 port 8000 / 5173
- **fix**: 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存量測數據
- **fix**: `reports.py` 移除系統自動 PASS/FAIL 判定，改為工程師人工填寫
- **chore**: 刪除根目錄多餘檔案；`serial_reader.py` 加上 Phase 3 預留說明；`sop_execution.py` 合併進 `sop.py`

---

## 2026-03-04

- **feat**: 新增 `ErrorLog` 表與 `errors.py` router，`GET /api/errors/` 回傳所有異常紀錄
- **feat**: `emergency_stop()` 觸發時自動寫入 error_logs
- **feat**: 新增「異常看板」頁面（`ErrorLog.jsx`）
- **feat**: `Dashboard.jsx` 統一 GitHub dark 主題，新增執行紀錄列表與一鍵下載 CSV
- **feat**: `SOPPage.jsx` 新增即時 TEMP TREND 折線圖、EMERGENCY 閃爍、步驟進度條
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