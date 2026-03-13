# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。


## 2026-03-13


- 新增 standards/ 套件（8 個檔案）
- _base.py：步驟工廠函數
- 六個法規子模組：iec60068 / en50155 / iec61850 / dnv / kema / nmea
- __init__.py：組裝 STANDARD_TREE，完全向後相容
- 同步套用法規修正：
  - IEC 60068-2-1 Ab_-25 新增（HQ-PD.486）
  - Ad_-25 dwell 2h→48h，ramp 3→1，補 Power ON/OFF steps
  - IEC 61850-3 全部 ramp 2→1（公司 SOP 確認）
  - C2 冷測拆 Operational/Storage，C3 冷測改名+ramp 3
  - DNV CG0339 ClassD duplicate sop_id 修正
- sop_id 總數：64→67（新增 3 條）
- sop.py / main.py import 路徑不變"
---

## 2026-03-12

**AI 諮詢免責聲明雙層保護**

前端

- **feat**: `AIPage.jsx` 新增 `DISCLAIMER` 常數，每則 AI 回覆泡泡下方固定顯示免責聲明，左側灰色細邊線區隔，字色偏暗不搶眼但清楚可見
- **feat**: `AIPage.jsx` 空白頁面（尚無對話時）同樣顯示免責聲明，進入頁面即可看見
- **fix**: `AIPage.jsx` 修正 `disclaimer` 樣式重複 `paddingLeft` key 導致的 Vite 警告

後端

- **feat**: `ai.py` system prompt 新增兩條免責規則：每次回覆結尾強制附上固定免責聲明；推薦法規時必須標注正式版本號（如 `IEC 60068-2-1:2007`），提醒使用者回查原文

**前端效能優化 & 濕度顯示邏輯修正**

前端

- **perf**: `App.jsx` 改用 CSS `display` 切換取代 React Router `unmount/remount`，四個頁面永遠存在 DOM，切換頁面不重打 API、不重建 state，消除約 3 秒延遲
- **fix**: `SOPPage.jsx` 頁面初始載入加入 `treeLoaded` state，標準樹 API 回傳前顯示「⏳ 載入標準資料中...」skeleton，不阻塞主畫面渲染
- **fix**: `SOPPage.jsx` `generateSP()` 濕度邏輯修正：溫度 < 0°C 時 `sp_humi = null`，圖表低溫段濕度線自動斷開
- **fix**: `SOPPage.jsx` `ConditionCard` 低溫段（下限 < 0°C）濕度欄自動補註「低溫段 <0°C 無濕度」
- **fix**: `Dashboard.jsx` DeviceCard 濕度顯示：溫度 < 0°C 時顯示「— 低溫無濕度」而非錯誤數值
- **fix**: `Dashboard.jsx` 趨勢圖存點時溫度 < 0°C 的 `humidity` 存 `null`，圖表低溫段濕度線自動斷開（`connectNulls={false}`）
- **fix**: `Dashboard.jsx` 補撈歷史資料時同樣將低溫段 `humidity` 轉為 `null`

後端

- **perf**: `sop.py` `get_standards_tree()` 移除 `steps` 欄位，`/api/sop/standards/tree` 回應從 108kB 縮減至約 12kB（縮小 9 倍），前端法規選擇載入速度大幅提升
- **perf**: `main.py` `start_sop` 啟動時將 `total_steps` 存入 AICM_CACHE，`get_all_devices()` 改從 cache 直接讀取，不再每次 `json.loads(active_sop_json)` 重複解析

---

## 2026-03-11

**AI 輔助模組 — 法規諮詢助手（後端 + 前端完整交付）**

後端

- **feat**: 新增 `backend/app/ai.py`，實作 `POST /api/ai/standards-query` 端點（非串流）
- **feat**: 新增 `POST /api/ai/standards-query-stream` 串流端點，使用 FastAPI `StreamingResponse` + Ollama `stream: true`
- **feat**: `_build_system_prompt()` 將 STANDARD_TREE 64 個測試條件摘要嵌入 system prompt
- **feat**: 串接本機 Ollama `qwen2.5:7b`，支援多輪對話（history 陣列帶入）
- **feat**: `main.py` 註冊 `ai_router`
- **fix**: system prompt 強化繁體中文指令（4 條明確規則：禁簡體、禁 code block、限定推薦清單、強制語言）
- **fix**: user message 前加入 `[請用繁體中文回覆]` 前綴，解決長對話後語言飄移問題
- **fix**: `dev_start.sh` 後端改用 `../venv/bin/uvicorn`，確保 httpx 等套件正確載入
- **chore**: `backend/requirements.txt` 補上 `httpx`

前端

- **feat**: 新增 `client/src/AIPage.jsx`，完整法規諮詢對話介面
- **feat**: 串流輸出 — 使用 `fetch` + `ReadableStream` 逐字顯示，等待時跳動點點，回覆中閃爍游標 `▍`
- **feat**: Markdown 渲染 — 支援標題、條列、數字清單、`**bold**`、`` `code` ``
- **feat**: code block 過濾 — `cleanText()` 自動移除 ` ```plaintext ` 等模型輸出標籤
- **feat**: 快速提問按鈕 — 6 個預設問題，點擊直接送出
- **feat**: 中途停止 — 送出後按鈕切換為「⏹ 停止」，使用 `AbortController` 中斷串流，已輸出內容透過 `streamTextRef` 保留並存入對話紀錄
- **feat**: 複製回覆按鈕 — 每則 AI 回覆底部顯示「複製」，點擊後顯示「✓ 已複製」2 秒
- **feat**: 回覆計時 — 每則 AI 回覆底部顯示 `⏱ Xs` 花費秒數
- **feat**: 對話紀錄 localStorage 儲存 — 重開瀏覽器對話還在，清除對話同時清 storage
- **feat**: 左側欄收合 — 側欄頂部右上角 `◀ ▶` 按鈕，動畫滑入滑出（width 240 ↔ 36）
- **feat**: 對話區獨立捲動 — `chatArea` 獨立 overflow，可自由往上捲動歷史，輸入框固定底部
- **feat**: `App.jsx` 新增 `/ai` 路由與導覽列「AI 諮詢」連結；修正 `marginRight:a 16` typo
- **fix**: 繁體前綴累積與重試無限迴圈 — 新增 `TC_PREFIX` 常數；`sendMessage` 拆分 `rawMsg`（存入 state）與 `apiMsg`（送 API），避免 history 疊加前綴；`retryInTraditional` 傳乾淨 `userMsg`，由 `sendMessage` 統一加前綴
- **fix**: 串流輸出時強制捲動導致無法往上閱讀 — 新增 `chatAreaRef` + `userScrolledUpRef`，距底部 > 80px 時停止自動跟隨；使用者主動送出時呼叫 `scrollToBottomForce()` 重置
- **fix**: 簡體偵測誤判 — 將 `SIMPLIFIED_CHARS` 字串比對改為 `SIMPLIFIED_ONLY Set`，只收錄繁體絕對不會出現的簡體專屬字，排除繁簡共用字（如温、湿）
- **fix**: 追問建議欄出現簡體 — `generateSuggestions` 的 prompt 補上 `TC_PREFIX` 及「所有問題必須使用繁體中文」強制指令
- **perf**: `Dashboard.jsx` 執行紀錄列表刷新頻率 30s → 60s；`Errorlog.jsx` 異常看板刷新頻率 10s → 60s

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