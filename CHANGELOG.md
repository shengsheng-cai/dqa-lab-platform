# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。
每個版本只呈現最終結果，不保留中間修改過程。

---

## 2026-03-15

**feat**

- AI 法規諮詢重構為多對話管理架構，`AIPage.jsx` 拆分為 `client/src/ai/` 子模組（`aiStorage.jsx` / `useAIChat.jsx` / `MessageBubble.jsx` / `ChatArea.jsx` / `ChatSidebar.jsx`）
- AI 法規諮詢支援專案分組、對話跨分組移動（📁）、重新命名、匯出、刪除確認
- AI 法規諮詢模型從 `qwen2.5:7b` 換為 `gemma3:4b`，繁體輸出穩定性提升、推理速度加快
- `sop.py` `standards/tree` 補回 `steps` 欄位，前端選好測試條件後直接啟動，不需二次請求
- `models.py` `DeviceData` 加入 composite index `(device_id, timestamp)`，大量資料時避免全表掃描
- DNV DNVGL-CG-0339:2015 法規審查完成，條數維持 14 條

**fix — 後端**

- `ai.py` system prompt 改為英文指令，加入簡繁體對照範例，有效抑制 gemma 輸出簡體；移除後端重複 TC_PREFIX（前端已附加）
- `main.py` `get_device_history` 時區修正：`started_at` 統一轉為 UTC naive datetime 再與 DB 比對
- `main.py` `lifespan` 恢復設備狀態時 `started_at` 統一轉為 UTC aware datetime，確保型別一致
- `main.py` `_calc_estimated_end_at` 修正低溫測試預估時間計算錯誤（原本固定從 25°C 出發，未考慮低溫段先降溫）
- `main.py` `data_simulator` `PAUSED` 狀態不再寫 DB，避免無效 IO
- `sop.py` `start_sop` 統一使用 `_save_device_state` 寫 DB，移除重複手動寫入
- `models.py` `DeviceState.updated_at` 移除無效的 `onupdate` lambda（SQLite 不觸發）
- `reports.py` `DeviceData` 查詢加入 `limit(10000)` 防止記憶體溢出，截斷時報告標注警告
- `dnv.py` ClassA Damp Heat `power_on` False → True；`humi_tolerance` 10.0 → 3.0；ClassB Dry Heat name/description 修正

**fix — 前端**

- `App.jsx` + `Dashboard.jsx` + `SOPPage.jsx` 加入 `active` prop，頁面隱藏時暫停輪詢，切回時重新啟動
- `Dashboard.jsx` 歷史資料陣列改用展開運算子建立可變副本，修正 React StrictMode 凍結導致 `push` 失敗
- `SOPPage.jsx` `saveExecution` 加入 `saving` state 防重複提交；`isStepUnlocked` 改為迭代，修正 O(n²) 遞迴
- `aiStorage.jsx` `loadChats` 自動補齊孤立分組、清除空分組、去除重複分組；`activeConversationId` 指向不存在對話時自動修正；`deleteConversation` 刪除後自動清除空分組
- `useAIChat.jsx` 修正 `addConversation` 解構錯誤、`stopStream` abort 時序、`retryInTraditional` 重複回覆、`clearConversation` 狀態不完整、`generateSuggestions` 切換對話寫入錯誤對話；`MAX_HISTORY` 從 2 提升至 4
- `ChatSidebar.jsx` `convItemActive` 修正 padding shorthand 警告；model badge 更新為 `gemma3:4b`
- `ChatArea.jsx` 修正 messages key 使用 index 導致 diff 錯誤；建議列閃爍問題
- `MessageBubble.jsx` 降低 `SIMPLIFIED_ONLY` 繁體誤判率；`handleCopy` 加入 HTTP fallback；`CollapsibleBubble` 改用 `contentKey` 避免重複測量高度

**perf**

- `ai.py` system prompt token 從約 2500 降至約 800；模組載入時快取，只建立一次；`TC_PREFIX` 改為中英混合
- `main.py` lifespan 加入 Ollama warm-up，解決冷啟動不串流問題

**refactor**

- `standards.py` 拆分為 `standards/` 套件（`__init__.py` / `_base.py` / `iec60068.py` / `en50155.py` / `iec61850.py` / `iec60945.py` / `dnv.py`）
- `AIPage.jsx` 重構為純組裝層，邏輯全部下沉至 `ai/` 子模組

**docs**

- 合併 `architecture.md` 進 `AGENTS.md`，刪除 `architecture.md`
- 移除 `AGENTS.md` 與 README 重複的 API 端點表格

---

## 2026-03-14

**feat**

- `iec61850.py` 新增 C1/C2/C3 各一條 Test Nb 溫度循環（sop_id 68→71）
  - C1：-10°C ↔ +55°C / 3h/step / 5 cycles / 1°C/min
  - C2/C3：-40°C ↔ +70°C / 3h/step / 5 cycles / 1°C/min
- 新建 `iec60945.py`，IEC 60945:2002 共 7 條（乾熱儲存/工作、濕熱 Db variant 1、低溫儲存/工作）
- `standards/__init__.py` 加入 `iec60945` 註冊，法規模組從 4 個擴充至 5 個
- sop_id 總數：68 → 78；IEC 61850-3 條數：16 → 19

**fix**

- `iec61850.py` C1 Damp Heat 濕度 95%RH → 93%RH

---

## 2026-03-13

**feat**

- `iec60068.py` 新增 IEC 60068-2-78 Test Cab 共 4 條（65°C / 90°C × 16h / 24h，95%RH，通電）
- `iec61850.py` C1/C2/C3 各新增 Cab 高溫高濕 Method III（40°C / 93%RH / 240h）共 3 條
- `iec61850.py` C1/C2/C3 各新增 Cab Non-Operating 16h Method V 共 3 條
- `en50155.py` 新增 OT4_High_Operating / OT4_High_Operating_ST1 兩條通電測試
- sop_id 總數：56 → 68

**fix**

- `iec61850.py` C1/C2/C3 乾熱 reference Bb → Be（Method IV）
- `iec60068.py` Test Nb `dwell_time_hours` 1h → 2h
- `main.py` `emergency_stop` crash 修正；timestamp 統一使用 `_now_utc()`
- `sop.py` `start_sop` 補入 `total_steps` 存入 AICM_CACHE，修正 Dashboard 進度條不顯示

**perf**

- `ai.py` 新增 `_SYSTEM_PROMPT_CACHE`，system prompt 模組載入時建立一次

---

## 2026-03-12

**feat**

- AI 法規諮詢雙層免責聲明（每則回覆固定顯示 + 空白頁面提示）
- `ai.py` system prompt 加入免責規則與法規版本號標注要求

**fix**

- `SOPPage.jsx` treeLoaded skeleton、generateSP 低溫濕度為 null、ConditionCard 低溫補註
- `Dashboard.jsx` 低溫（< 0°C）隱藏濕度；趨勢圖低溫段 humidity 存 null（`connectNulls={false}`）

**perf**

- `App.jsx` CSS display 切換取代 React Router unmount，四頁面常駐 DOM，切換無延遲
- `sop.py` `/api/sop/standards/tree` 移除 steps 欄位，回應從 108kB 降至 ~12kB

---

## 2026-03-11

**feat**

- 新增 `backend/app/ai.py`，實作串流與非串流法規諮詢端點，串接本機 Ollama
- 新增 `client/src/AIPage.jsx`，串流輸出、Markdown 渲染、快速提問、中途停止、localStorage 持久化、智慧捲動、追問建議、雙層免責聲明

---

## 2026-03-10

**feat**

- 導入 Alembic 資料庫遷移管理
- `main.py` 新增 `_calc_estimated_end_at()`、`/api/devices/{id}/progress` API
- `models.py` `DeviceState` 新增 `completed_steps`、`started_at` 欄位
- `Dashboard.jsx` 新增倒數計時器、趨勢圖 Brush 縮放、步驟進度條
- `SOPPage.jsx` 新增執行資訊面板、SP+PV 波型曲線、步驟依序鎖定

**fix**

- startup 改為 asynccontextmanager lifespan；新增 `_now_utc()`；多項 models 型別修正

---

## 2026-03-06

**feat**

- `models.py` 新增 `DeviceState` 表，支援伺服器重啟後恢復設備狀態
- `Dashboard.jsx` 趨勢圖支援切換 5 台設備

**fix**

- 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存量測數據

**refactor**

- `sop_execution.py` 合併進 `sop.py`

---

## 2026-03-04

**feat**

- 新增 `ErrorLog` 表與 `errors.py` router
- 新增異常看板頁面（`ErrorLog.jsx`），統計卡片 + 完整紀錄列表，60s 自動刷新
- `standards.py` 重構為三層巢狀 `STANDARD_TREE`

**perf**

- `device_data` 寫入頻率從每秒降為每 10 秒

---

## 2026-03-03

**feat**

- ISO 17025 格式測試報告（`reports.py`），7 節格式，big5 編碼，PASS/FAIL 工程師人工判定

**fix**

- `FINISHING` 降溫完成後自動回 `IDLE`；暫停切換改為 `RUNNING ↔ PAUSED`

---

## 2026-03-02

**feat**

- 整合 EN 50155、IEC 60068 環境測試標準
- 動態 SOP 管理系統，前端 SOP 列表動態載入