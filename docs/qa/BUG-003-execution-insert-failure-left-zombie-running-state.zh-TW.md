# BUG-003 — 執行紀錄建立失敗，留下一台殭屍般的 RUNNING 設備

[English](BUG-003-execution-insert-failure-left-zombie-running-state.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-003 |
| **狀態** | 已修正（有故障注入測試驗證） |
| **嚴重度** | High |
| **優先度** | High |
| **元件** | SOP 啟動 — 設備／執行／排程／治具的一致性 |
| **環境** | DQA Lab Platform 後端，手動與自動兩條啟動路徑 |
| **發現方式** | 跨模組狀態一致性審查，2026-07-18 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `fa709947d3fb6a39b36234398401b5cd907830c3` |

## 摘要

啟動流程會先把設備改成 **RUNNING**，然後才寫入它的 `SopExecution` 紀錄。如果那筆
資料庫寫入失敗、沒有回傳 execution ID，手動與自動兩條路徑都會當作啟動成功繼續走
下去。

結果留下一台殭屍設備：看起來在跑，卻沒有執行紀錄可以接收結束時間，也連不到任何
報告。與之連動的排程和治具預約，也可能在執行紀錄根本不存在的情況下往前推進。

## 前置條件

- 目標設備處於 **IDLE**。
- 已選好一個有效的 SOP。
- 走排程路徑時，可能已有一筆已確認排程與預約中的治具。
- 執行紀錄的建立，在設備 cache 已經被改成 RUNNING 之後才失敗。

## 在修正前的版本上重現

1. 準備一台 IDLE 設備與一個有效的 SOP。
2. 強制 `_create_execution_id_db()` 回傳 `None`，模擬資料庫寫入失敗。
3. 用手動方式、或透過修正前的 `try_start_schedule()` 啟動該 SOP。
4. 檢查 API 回應、設備 cache、排程狀態、治具借出紀錄與執行紀錄表。

## 預期結果

- 啟動被回報為失敗。
- 設備回到 **IDLE**。
- 不會存下任何 active execution ID。
- 連動的排程維持**已確認**以便重試。
- 預約中的治具維持預約狀態，不會被轉成借出。

## 實際結果

- 設備維持 **RUNNING**，卻沒有執行紀錄。
- 手動啟動照樣回傳成功。
- 自動啟動照樣回傳 `True`，讓排程繼續往前推進。
- 流程上會出現一個「正在跑、但無法正確完成也無法正確產報告」的測試。

## 證據

- 歷史修正：commit `fa709947d3fb6a39b36234398401b5cd907830c3`。
- 目前的原子狀態擁有者：
  [`device_state.py`](../../backend/app/device_state.py)。
- 目前排定啟動的交易：
  [`schedule_service.py`](../../backend/app/schedule_service.py)。
- 故障注入回歸測試：
  [`test_device_state.py`](../../backend/tests/test_device_state.py) 與
  [`test_schedule_start_consistency.py`](../../backend/tests/test_schedule_start_consistency.py)。

## 根因

這個流程先把 RUNNING 狀態落盤，才去建立相依的執行紀錄，但沒有任何補償性的回滾。
程式把「有沒有 execution ID」當成可有可無：寫入失敗時就跳過指派
`active_execution_id`，然後繼續走成功路徑。

因此從業務角度來看，啟動這個動作並不是原子的。

## 影響

- UI 與 WebSocket 用戶端會顯示一個「正在執行」的測試，但執行紀錄根本不存在。
- 完成時無法可靠地寫入 `test_ended_at`。
- 報告的關聯與執行歷史都缺失。
- 一個從未成功啟動的測試，卻可能讓排程變成 RUNNING、治具變成借出。
- 需要人工介入才能把設備清乾淨。

## 最初的解法

- 為手動與自動兩條啟動路徑加上 `_revert_device_to_idle()`。
- 回滾只在設備仍是 RUNNING 時才清除狀態，避免蓋掉資料庫操作期間發生的緊急停止。
- 執行紀錄無法建立時，手動啟動現在回傳 HTTP 500。
- 自動啟動回傳 `False`；排程維持已確認、治具維持預約，等待稍後重試。
- 排程與治具的啟用，只在執行紀錄建立成功之後才進行。

## 後續強化（2026-07-25）

- commit `401de42` 引入 `DeviceStateManager`，成為設備狀態落盤、cache 發布、
  per-device 鎖，以及在啟動交易內建立 `SopExecution` 的唯一擁有者。
- commit `659396a` 讓排定啟動在同一個交易內寫入 `DeviceState`、`SopExecution`、
  `Schedule`、`FixtureLoan` 與 `AuditLog`。cache 只在 commit 成功之後才發布。
- 取消操作現在會等待進行中的交易完成（即使工作被反覆取消），在 commit 成功後才
  發布 cache，然後再重新拋出 `CancelledError`。

## 驗證

故障注入測試涵蓋：

1. 執行紀錄寫入失敗與交易 commit 失敗時，資料庫與 cache 都維持不變。
2. 呼叫端反覆取消，也不會留下「資料庫已 commit 但 cache 過期」的狀態。
3. 排定啟動回傳可重試的結果，同時排程維持已確認、治具維持預約。
4. 稽核寫入失敗會回滾排定啟動交易中的每一個實體。
5. 手動臨時啟動在執行紀錄寫入失敗時回傳 HTTP 500，並把設備還原成 IDLE。

指定指令：

```bash
cd backend && ../venv/bin/python -m pytest tests/test_device_state.py tests/test_schedule_start_consistency.py -v
```
