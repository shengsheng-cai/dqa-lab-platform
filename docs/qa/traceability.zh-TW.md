# DQA Lab Platform — 最小追溯表

[English](traceability.md) · 繁體中文

這張矩陣把關鍵行為連到風險、自動化證據與已知缺陷。它刻意只涵蓋高風險的 Demo
基準，而不是每一條路由或每一個 UI 元素。

| 需求 | 預期行為 | 風險 | 自動化證據 | 缺陷證據 | 狀態 |
|---|---|---|---|---|---|
| **REQ-AUTH-01** | 訪客不能變更受保護的業務狀態；每一條僅限管理者的路由都強制授權檢查 | R-01 | `backend/tests/test_guest_authorization.py`；`backend/tests/test_blocked_period_audit.py::test_blocked_period_write_rejects_non_admin_without_audit`；`tests/e2e/specs/guest-readonly.spec.js` | — | 已涵蓋 |
| **REQ-AUD-01** | 設備不可用時段的變更會記錄下經過驗證的操作者；稽核寫入失敗時，業務變更要一併回滾 | R-03 | `backend/tests/test_blocked_period_audit.py` | — | 已涵蓋 |
| **REQ-MNT-01** | 維護中的設備不能被選取或啟動；排程維持「已確認」，維護結束後可以重試 | R-02 | `backend/tests/test_schedule_start_consistency.py::test_start_skipped_when_device_in_maintenance`；`::test_maintenance_keeps_confirmed_then_resumes`；`tests/e2e/specs/maintenance-block.spec.js` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-STATE-01** | 啟動成功時，設備、執行、排程、治具、稽核與 cache 的狀態要保持一致，即使呼叫端被取消 | R-03 | `backend/tests/test_schedule_start_consistency.py`；`backend/tests/test_device_state.py::test_start_repeated_cancellation_waits_for_commit_and_publishes_cache`；`backend/tests/test_linkage.py`；`tests/e2e/specs/schedule-flow.spec.js` | — | 已涵蓋 |
| **REQ-STATE-02** | 執行紀錄建立失敗時，設備回到 IDLE、排程維持「已確認」、治具維持預約狀態 | R-03 | `backend/tests/test_device_state.py::test_start_execution_failure_leaves_db_and_cache_unchanged`；`backend/tests/test_schedule_start_consistency.py::test_start_schedule_keeps_confirmed_when_execution_insert_fails`；`::test_manual_start_sop_reverts_when_execution_insert_fails` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md) | 已涵蓋 |
| **REQ-UI-01** | 確認之後，排程列不需人工重新整理就會與後端狀態一致 | R-04 | `tests/e2e/specs/schedule-flow.spec.js` | [BUG-001](BUG-001-schedule-status-not-refreshed-after-confirm.zh-TW.md) | 已涵蓋 |
| **REQ-UI-02** | 治具或排程寫入之後，頁面資料與全域摘要立即一致，不必等 30／60 秒的輪詢兜底 | R-04 | `tests/e2e/specs/fixture-loan.spec.js`；`tests/e2e/specs/schedule-flow.spec.js` | — | 已涵蓋 |
| **REQ-SCH-01** | 同一台設備上的有效排程不重疊；修改已確認的時段會取代精確啟動的 job；暫時性阻擋會重試；壞掉的排程收斂到終止錯誤 | R-05 | `backend/tests/test_schedule_conflict.py`；`test_schedules_slot.py`；`test_schedule_start_consistency.py::test_confirmed_slot_edit_replaces_scheduled_start_job`；`test_simulator_schedule.py` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-SCH-02** | 正在回常溫的設備，在抵達常溫之前都算被占用；設備卡與排程器由同一份共用估算得出那個時間點 | R-05 | `backend/tests/test_utils.py`；`backend/tests/test_schedules_complete.py::test_est_end_finishing_counts_remaining_ramp_not_whole_curve`；`::test_est_end_finishing_after_emergency_is_not_treated_as_free`；`::test_build_running_until_includes_finishing_device` | [BUG-006](BUG-006-cooling-device-treated-as-available.zh-TW.md) | 已涵蓋 |
| **REQ-FIX-01** | 治具數量在 API 與 Excel 寫入下都不得為負；「預約 → 借出 → 歸還」與採購到貨的轉換不得灌大庫存或影響到別的排程；排程確認不得預約超過剩餘庫存 | R-06 | `backend/tests/test_fixture_lifecycle.py`；`test_fixtures_api.py`；`test_fixture_excel.py`；`test_purchase_orders.py`；`test_linkage.py`；`tests/e2e/specs/fixture-loan.spec.js` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md) | 已涵蓋 |
| **REQ-FIX-02** | 人員送出的日期以他所在的當地日計算，不是 UTC 的那天：歸還日是當地的日曆日、到期日在當地日結束時才過期、今日到期也以當地日計算 | R-06 | `client/src/__tests__/timezone.test.js`（整個套件釘在 `Asia/Taipei`）；`backend/tests/test_fixtures_api.py::test_summary_due_today_uses_caller_day_window`；`::test_summary_without_window_falls_back_to_utc_day` | [BUG-004](BUG-004-fixture-dates-stored-one-day-early.zh-TW.md)；[BUG-005](BUG-005-fixture-day-deadlines-evaluated-in-utc.zh-TW.md) | 已涵蓋 |
| **REQ-FIX-03** | 歸還治具要走歸還對話框，讓人員記錄狀態、備註與實際歸還日；損壞或遺失需要二次確認 | R-06 | `tests/e2e/specs/fixture-loan.spec.js` | — | 已涵蓋 |
| **REQ-EXT-01** | LINE、報告與 AI 供應商的失敗會被收斂，並回傳可據以行動的結果 | R-07 | `backend/tests/test_line_resilience.py`；`test_reports_degradation.py`；`test_ai_observability.py` | — | 以模擬故障涵蓋 |
| **REQ-RPT-01** | 存下來的執行紀錄要帶著報告需要的時間，讓量測摘要反映測試區間，不論是哪條路徑存的 | R-07 | `backend/tests/test_reports_degradation.py::test_frontend_iso_timestamps_still_match_sensor_data` | [BUG-007](BUG-007-fallback-execution-save-diverged-from-main-path.zh-TW.md) | 後端契約已涵蓋；引發它的前端備援路徑在此基準下無法自動化（見 GAP-04） |
| **REQ-AI-01** | AI 建議的條件可以進入排程，同時訪客仍然無法送出寫入 | R-08 | `backend/tests/test_rag.py`；`tests/e2e/specs/ai-apply-schedule.spec.js`；`guest-readonly.spec.js` | — | 以模擬 AI 邊界涵蓋 |

## 未涵蓋的缺口

| 缺口 | 影響 | 規劃處理方式 |
|---|---|---|
| **GAP-02** — 沒有真實試驗箱整合 | 模擬器的證據無法證明廠商協定或實體控制 | 取得授權硬體後，在獨立的真機分支上驗證 |
| **GAP-03** — 沒有負載／瀏覽器／無障礙矩陣 | 可能漏掉非功能性的回歸 | 只有在這些成為發布需求時才另立計畫 |
| **GAP-04** — 只在設備狀態更新掉包時才觸發的前端備援路徑 | 主路徑與備援路徑的分歧是靠程式碼審查抓到的，不是靠測試，BUG-007 就是如此 | 以間接方式涵蓋：每條備援所依賴的後端契約都有測試釘住，兩個呼叫點也互相交叉引用。要直接涵蓋需要元件測試，而本基準不做元件測試 |
