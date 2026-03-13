# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。


## 2026-03-13

**法規正確性審查：新增高溫高濕測試條件**

後端

- **feat**: `iec60068.py` 新增 `IEC 60068-2-78:2012 (Test Cab: Damp Heat Steady State)` 共 4 條：
  - `Cab_65_16h_95RH`：標溫 Method I，65°C / 95%RH / 16h，通電
  - `Cab_65_24h_95RH`：標溫 Method II，65°C / 95%RH / 24h，通電
  - `Cab_90_16h_95RH`：寬溫 Method I，90°C / 95%RH / 16h，通電
  - `Cab_90_24h_95RH`：寬溫 Method II，90°C / 95%RH / 24h，通電
- **feat**: `iec61850.py` C1 / C2 / C3 各新增 Cab 高溫高濕測試條件共 3 條：
  - `C1_Cab_40_240h_93RH` / `C2_Cab_40_240h_93RH` / `C3_Cab_40_240h_93RH`
  - 全部固定：40°C / 93%RH / 240h（IEC 61850-3 Ed.2 Method III 法規明文，非產品規格決定）
- sop_id 總數：56 → 63

---

**Bug 修復與架構優化**

後端

- **fix**: `main.py` `emergency_stop` 移除未定義變數 `std_data`，`total_steps` 改為固定回傳 `0`，修正緊急停止會直接 crash 的問題
- **fix**: `main.py` `get_all_devices` 與 `get_latest` timestamp 統一改用 `_now_utc()`，解決 naive datetime 問題
- **fix**: `main.py` `data_simulator` 寫入 `DeviceData.timestamp` 統一改用 `_now_utc()`
- **refactor**: `main.py` `data_simulator` DB 寫入改呼叫 `_save_device_state()`，移除重複手寫 SQL
- **fix**: `sop.py` `start_sop` 新增 `total_steps` 存入 AICM_CACHE，修正 Dashboard 步驟進度條永遠不顯示的 bug
- **perf**: `ai.py` `_build_system_prompt()` 新增模組層級快取 `_SYSTEM_PROMPT_CACHE`，system prompt 只在第一次呼叫時建立，後續直接回傳快取，避免每次 API 呼叫都重跑 `get_standard_tree()`

---

**法規正確性審查：EN 50155 高溫通電測試新增**

後端

- **feat**: `en50155.py` 新增 `OT4_High_Operating`（sop_id: `en50155_2017_ot4_high_operating`）：70°C / 通電 / 三段電壓（×0.7 / 額定 / ×1.25）/ 2h/段 / ramp 1°C/min / 6 步驟
- **feat**: `en50155.py` 新增 `OT4_High_Operating_ST1`（sop_id: `en50155_2017_ot4_high_operating_st1`）：85°C（OT4+15°C）/ 通電 / 三段電壓 / 2h/段 / ramp 1°C/min / 6 步驟
- sop_id 總數：63 → 65；en50155.py 條數：19 → 21

---

**Standards 模組重構：standards.py → standards/ 套件**

後端

- **refactor**: `backend/app/standards.py` 拆分為 `standards/` 套件，共 6 個檔案：
  - `__init__.py`：組裝 STANDARD_TREE + 工具函數，向後相容 STANDARDS_AND_SOPS 平坦結構
  - `_base.py`：steps_single_temp / steps_cycle 步驟工廠函數
  - `iec60068.py`：IEC 60068-2-1/2/14/30（13 條）
  - `en50155.py`：EN 50155:2017 + 2007（19 條）
  - `iec61850.py`：IEC 61850-3 Ed.2:2013 + Ed.1:2002（10 條）
  - `dnv.py`：DNV CG-0339:2015 + Std.Cert.2.4（14 條）
- **chore**: KEMA / NMEA 暫時移除（無原始法規文件可供對照）
- **fix**: DNV 條數修正 15 → 14
- sop_id 總數：67 → 56（移除 KEMA 4 條、NMEA 7 條）
- import 路徑不變，sop.py / main.py / reports.py 無需修改

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

---

## 2026-03-11

**AI 輔助模組 — 法規諮詢助手（後端 + 前端完整交付）**

後端

- **feat**: 新增 `backend/app/ai.py`，實作 `POST /api/ai/standards-query` 端點（非串流）
- **feat**: 新增 `POST /api/ai/standards-query-stream` 串流端點，使用 FastAPI `StreamingResponse` + Ollama `stream: true`
- **feat**: `_build_system_prompt()` 將 STANDARD_TREE 56 個測試條件摘要嵌入 system prompt
- **feat**: 串接本機 Ollama `qwen2.5:7b`，支援多輪對話（history 陣列帶入）
- **feat**: `main.py` 註冊 `ai_router`
- **fix**: system prompt 強化繁體中文指令（4 條明確規則：禁簡體、禁 code block、限定推薦清單、強制語言）
- **fix**: user message 前加入 `[請用繁體中文回覆]` 前綴，解決長對話後語言飄移問題
- **fix**: `dev_start.sh` 後端改用 `../venv/bin/uvicorn`，確保 httpx 等套件正確載入
- **chore**: `backend/requirements.txt` 補上 `httpx`

前端

- **feat**: 新增 `client/src/AIPage.jsx`，完整法規諮詢對話介面
- **feat**: 串流輸出、Markdown 渲染、快速提問、中途停止、複製回覆、回覆計時、localStorage 持久化、左側欄收合、智慧捲動、簡體精確偵測、追問建議繁體強制、雙層免責聲明
- **perf**: `Dashboard.jsx` 執行紀錄列表刷新頻率 30s → 60s；`Errorlog.jsx` 異常看板刷新頻率 10s → 60s

---

## 2026-03-10

**後端**

- **feat**: 導入 Alembic 資料庫遷移管理，建立 initial schema 基準版本（`a517a1796fda`）
- **feat**: `main.py` 新增 `_calc_estimated_end_at()`，計算預估結束時間
- **feat**: `main.py` 新增 `POST /api/devices/{device_id}/progress` API
- **feat**: `main.py` `/api/devices` 回傳新增 `total_steps`、`completed_steps`、`started_at`
- **feat**: `models.py` `DeviceState` 新增 `completed_steps`、`started_at` 欄位
- **fix**: `@app.on_event("startup")` 改為 `@asynccontextmanager lifespan`
- **fix**: 新增 `_now_utc()` 統一所有時間戳
- **fix**: `update_progress` payload 改為 `ProgressPayload(BaseModel)`
- **fix**: 模擬器改為每台設備獨立 `with SessionLocal() as db`
- **fix**: `SopExecution.test_started_at / test_ended_at` 型別由 `String` 改為 `DateTime`
- **fix**: `StepRecord.execution_id` 補上 `ForeignKey`；`completed` 型別改為 `Boolean`
- **fix**: `DeviceState.updated_at` 補上 `onupdate` 自動更新
- **feat**: `reports.py` 新增 `GET /api/reports/list`
- **feat**: `standards.py` EN 50155:2017 新增 OT5；DNV 新增 Class C/D 乾熱

**前端**

- **feat**: `Dashboard.jsx` DeviceCard 新增倒數計時器、趨勢圖 Brush 縮放、步驟進度條
- **feat**: `SOPPage.jsx` 新增執行資訊面板、SP+PV 波型曲線、步驟依序鎖定

---

## 2026-03-06

- **feat**: `models.py` 新增 `DeviceState` 表，支援重啟後恢復狀態
- **feat**: `Dashboard.jsx` 趨勢圖改為可切換 5 台設備
- **fix**: `dev_start.sh` 啟動前強制釋放 port 8000 / 5173
- **fix**: 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 永久保存量測數據
- **chore**: `sop_execution.py` 合併進 `sop.py`

---

## 2026-03-04

- **feat**: 新增 `ErrorLog` 表與 `errors.py` router
- **feat**: 新增「異常看板」頁面（`ErrorLog.jsx`）
- **feat**: `standards.py` 重構為三層巢狀 `STANDARD_TREE`
- **perf**: `device_data` 寫入頻率從每秒改為每 10 秒
- **docs**: 新增 `CHANGELOG.md`、`AGENTS.md`

---

## 2026-03-03

- **fix**: `FINISHING` 降溫完成後自動回 `IDLE`
- **fix**: 暫停切換改為 `RUNNING ↔ PAUSED` 真正切換
- **feat**: ISO 17025 格式測試報告（`reports.py`）

---

## 2026-03-02

- 整合 EN50155、IEC60068 環境測試標準
- 動態 SOP 管理系統
- 前端 SOP 列表動態載入