# BUG-002 — 自動排程器在維護時段內啟動了設備

[English](BUG-002-maintenance-device-auto-started.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-002 |
| **狀態** | 已修正（有回歸測試驗證） |
| **嚴重度** | High |
| **優先度** | High |
| **元件** | 排程 — 自動啟動／維護排除 |
| **環境** | DQA Lab Platform 後端、模擬設備、SQLite |
| **發現方式** | 排程狀態風險審查，2026-07-18 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `9a7116bd045ec4438c335ddf9f80795e1ae1b675` |

## 摘要

一筆已確認、且開始時間已到的排程，即使指派的設備正處於不可用／維護時段內，
只要它是 IDLE，就會被自動啟動。手動啟動 SOP 那條路徑本來就會檢查維護狀態，
但自動排程器走的是另一條路徑，沒有同一道守衛。

結果是系統狀態自相矛盾：操作人員明明已經把設備標為不可用，排程器卻把它當成
可用並開始了測試。

## 前置條件

- 有一台設備處於 **IDLE**。
- 該設備有一段涵蓋當下時間的不可用時段。
- 有一筆指派給該設備、已確認且即將開始的排程。
- 排程器的日期 job 或兜底掃描被觸發。

這個缺陷在不可用時段**沒有填原因**時同樣會發生。

## 在修正前的版本上重現

1. 為 `CH-01` 建立一段從一小時前到一小時後的不可用時段。
2. 原因欄填 `校驗中` 或留白皆可。
3. 建立並確認一筆指派給 `CH-01` 的排程，開始時間設為現在或更早。
4. 觸發排定的啟動或兜底掃描。
5. 檢查排程與設備狀態。

## 預期結果

- 設備維持 **IDLE**。
- 排程維持**已確認**，因為維護是暫時性的。
- 不可用時段結束後，兜底掃描可以重試並啟動該排程。

## 實際結果

- 自動路徑因為只檢查了「設備是不是 IDLE」，就直接進入 SOP 啟動。
- 設備與排程可能在維護期間變成 **RUNNING**。
- 原因欄留白的維護紀錄，也可能被當成「根本沒有阻擋」。

## 證據

- 歷史修正：commit `9a7116bd045ec4438c335ddf9f80795e1ae1b675`。
- 目前的自動啟動守衛：
  [`start_schedule()` 與 `_apply_schedule_start()`](../../backend/app/schedule_service.py)。
- 回歸測試：
  [`test_schedule_start_consistency.py`](../../backend/tests/test_schedule_start_consistency.py)
  涵蓋 `test_start_skipped_when_device_in_maintenance`、
  `test_start_skipped_when_maintenance_has_no_reason`、
  `test_maintenance_keeps_confirmed_then_resumes`，以及
  `test_confirm_condition_blocks_next_sop_during_maintenance`。
- 瀏覽器涵蓋：
  [`maintenance-block.spec.js`](../../tests/e2e/specs/maintenance-block.spec.js)
  驗證被阻擋的設備會呈現停用狀態，而正常設備仍可選取。

## 根因

在修正前的實作裡，手動與自動兩條啟動路徑執行的規則不同。手動的 SOP 路由會查
維護表，而 `try_start_schedule()` 從基本的排程驗證直接跳到 `auto_start_sop()`。

阻擋原因這個欄位又是可為空的。把「原因的值」當成「阻擋是否存在」的判斷依據，
就導致沒填文字的不可用時段被誤判成沒有阻擋。

## 影響

- 違反了明確的設備可用性限制。
- 可能對一台操作人員已經停用的設備跑模擬測試。
- 在未來的真機整合中，同樣的業務規則失效可能與校驗或維護作業相衝突。
- 本身不會弄壞歷史資料，但會讓排程與維護的控制變得不可信。

## 解法

- 在自動排程路徑加上共用的 `device_blocked_reason_now()` 檢查。
- 生效中的不可用時段，即使原因留白，現在也一律算作被阻擋。
- 被阻擋的排程維持「已確認」，而不是變成錯誤。
- 一般的兜底機制會在不可用時段結束後重試。

## 後續強化（2026-07-25）

commit `659396a` 把全部六條排定啟動的路徑都收斂到 `start_schedule(...)`。維護狀態
現在會產生一個具型別的提早回傳結果，並且在原子啟動交易**內部**再驗證一次，
補掉「初次檢查」到「commit」之間的空窗。條件銜接也走同一道守衛。

## 驗證

回歸套件斷言了三個必要行為：

1. 維護會阻擋自動啟動。
2. 維護原因留白時仍然會阻擋啟動。
3. 移除維護時段後，已確認的排程可以重試並進入 RUNNING。

指定指令：

```bash
cd backend && ../venv/bin/python -m pytest tests/test_schedule_start_consistency.py -k maintenance -v
```
