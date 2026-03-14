# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。

---

## 2026-03-14

**法規正確性審查：文件整合**

- **docs**: 合併 `architecture.md` 進 `AGENTS.md`，刪除 `architecture.md`
- **chore**: 移除 `iec60068.py` / `iec61850.py` 中所有內部參考字串

---

## 2026-03-14（續）

**法規正確性審查：IEC 61850-3 溫度循環與濕熱循環**

- **feat**: `iec61850.py` 新增 C1/C2/C3 各一條 Test Nb 溫度循環（sop_id 68→71）：
  - C1：-10°C ↔ +55°C / 3h/step / 5 cycles / 1°C/min
  - C2/C3：-40°C ↔ +70°C / 3h/step / 5 cycles / 1°C/min
- **fix**: `iec61850.py` C1 Damp Heat 濕度 95%RH → 93%RH（IEC 60068-2-30 高溫段法規明文）
- IEC 61850-3 條數：16 → 19

---

## 2026-03-13

**法規正確性審查：standards/ 套件修正與新增**

- **feat**: `iec60068.py` 新增 IEC 60068-2-78 Test Cab 共 4 條（65°C / 90°C × 16h / 24h，95%RH，通電）
- **feat**: `iec61850.py` C1/C2/C3 各新增 Cab 高溫高濕（Method III）共 3 條：40°C / 93%RH / 240h
- **feat**: `iec61850.py` C1/C2/C3 各新增 Cab Non-Operating 16h（Method V）共 3 條
- **fix**: `iec61850.py` C1/C2/C3 乾熱 reference Bb → Be（Method IV）
- **feat**: `en50155.py` 新增 OT4_High_Operating / OT4_High_Operating_ST1 兩條通電測試
- **fix**: `iec60068.py` Test Nb dwell_time_hours 1h → 2h
- sop_id 總數：56 → 68；各法規條數：IEC 60068 17 條、EN 50155 21 條、IEC 61850-3 16 條、DNV 14 條

**Bug 修復與架構優化**

- **fix**: `main.py` `emergency_stop` crash 修正；timestamp 統一 `_now_utc()`；DB 寫入改呼叫 `_save_device_state()`
- **fix**: `sop.py` `start_sop` 新增 `total_steps` 存入 AICM_CACHE，修正 Dashboard 進度條不顯示的 bug
- **perf**: `ai.py` 新增 `_SYSTEM_PROMPT_CACHE`，system prompt 只建立一次
- **refactor**: `standards.py` 拆分為 `standards/` 套件（`__init__.py` / `_base.py` / 4 個法規模組）

---

## 2026-03-12

**AI 諮詢免責聲明 & 前端效能優化**

- **feat**: `AIPage.jsx` 雙層免責聲明（每則回覆固定顯示 + 空白頁面顯示）
- **feat**: `ai.py` system prompt 新增免責規則與法規版本號標注要求
- **perf**: `App.jsx` CSS display 切換取代 React Router unmount，四頁面常駐 DOM，切換無延遲
- **fix**: `SOPPage.jsx` treeLoaded skeleton；generateSP 低溫濕度為 null；ConditionCard 低溫補註
- **fix**: `Dashboard.jsx` 低溫濕度隱藏；趨勢圖低溫段 humidity 存 null（`connectNulls={false}`）
- **perf**: `sop.py` `/api/sop/standards/tree` 移除 steps 欄位（108kB → ~12kB）

---

## 2026-03-11

**AI 輔助模組 — 法規諮詢助手**

- **feat**: 新增 `backend/app/ai.py`，實作串流 + 非串流法規諮詢端點，串接本機 Ollama `qwen2.5:7b`
- **feat**: 新增 `client/src/AIPage.jsx`，串流輸出、Markdown 渲染、快速提問、中途停止、localStorage 持久化、智慧捲動、追問建議、雙層免責聲明

---

## 2026-03-10

**儀表板進度條 & 資料庫遷移**

- **feat**: 導入 Alembic 資料庫遷移管理
- **feat**: `main.py` 新增 `_calc_estimated_end_at()`、`/api/devices/{id}/progress` API
- **feat**: `models.py` `DeviceState` 新增 `completed_steps`、`started_at` 欄位
- **feat**: `Dashboard.jsx` 新增倒數計時器、趨勢圖 Brush 縮放、步驟進度條
- **feat**: `SOPPage.jsx` 新增執行資訊面板、SP+PV 波型曲線、步驟依序鎖定
- **fix**: startup 改為 asynccontextmanager lifespan；新增 `_now_utc()`；多項 models 型別修正

---

## 2026-03-06

- **feat**: `models.py` 新增 `DeviceState` 表，支援重啟後恢復狀態
- **feat**: `Dashboard.jsx` 趨勢圖改為可切換 5 台設備
- **fix**: 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 永久保存量測數據
- **chore**: `sop_execution.py` 合併進 `sop.py`

---

## 2026-03-04

- **feat**: 新增 `ErrorLog` 表與 `errors.py` router，新增異常看板頁面（`ErrorLog.jsx`）
- **feat**: `standards.py` 重構為三層巢狀 `STANDARD_TREE`
- **perf**: `device_data` 寫入頻率從每秒改為每 10 秒

---

## 2026-03-03

- **fix**: `FINISHING` 降溫完成後自動回 `IDLE`；暫停切換改為 `RUNNING ↔ PAUSED`
- **feat**: ISO 17025 格式測試報告（`reports.py`）

---

## 2026-03-02

- 整合 EN50155、IEC60068 環境測試標準，動態 SOP 管理系統，前端 SOP 列表動態載入