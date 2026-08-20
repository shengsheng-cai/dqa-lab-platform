# DQA Lab Platform — 最小追溯表

[English](traceability.md) · 繁體中文

這張矩陣把關鍵行為連到風險、自動化證據與已知缺陷。它刻意只涵蓋高風險的 Demo
基準，而不是每一條路由或每一個 UI 元素。

| 需求 | 預期行為 | 風險 | 自動化證據 | 缺陷證據 | 狀態 |
|---|---|---|---|---|---|
| **REQ-AUTH-01** | 訪客不能變更受保護的業務狀態；每一條僅限管理者的路由都強制授權檢查 | R-01 | `backend/tests/test_guest_authorization.py`；`backend/tests/test_blocked_period_audit.py::test_blocked_period_write_rejects_non_admin_without_audit`；`tests/e2e/specs/guest-readonly.spec.js` | — | 已涵蓋 |
| **REQ-AUTH-02** | 憑證不會出現在網址上：設備即時資料的握手改用 30 秒過期、只能用一次的入場券，所以 access log 記得到的東西都沒有重放價值 | R-09 | `backend/tests/test_ws_auth.py`；`tests/e2e/specs/ws-auth.spec.js` | [BUG-011](BUG-011-websocket-handshake-carried-a-long-lived-admin-token.zh-TW.md) | 涵蓋到反向代理之前；部署環境會不會轉送握手用的 subprotocol，要靠打開部署好的 Space 確認 |
| **REQ-AUD-01** | 設備不可用時段的變更會記錄下經過驗證的操作者；稽核寫入失敗時，業務變更要一併回滾 | R-03 | `backend/tests/test_blocked_period_audit.py` | — | 已涵蓋 |
| **REQ-MNT-01** | 維護中的設備不能被選取或啟動；排程維持「已確認」，維護結束後可以重試 | R-02 | `backend/tests/test_schedule_start_consistency.py::test_start_skipped_when_device_in_maintenance`；`::test_maintenance_keeps_confirmed_then_resumes`；`tests/e2e/specs/maintenance-block.spec.js` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-STATE-01** | 啟動成功時，設備、執行、排程、治具、稽核與 cache 的狀態要保持一致，即使呼叫端被取消 | R-03 | `backend/tests/test_schedule_start_consistency.py`；`backend/tests/test_device_state.py::test_start_repeated_cancellation_waits_for_commit_and_publishes_cache`；`backend/tests/test_linkage.py`；`tests/e2e/specs/schedule-flow.spec.js` | — | 已涵蓋 |
| **REQ-STATE-02** | 執行紀錄建立失敗時，設備回到 IDLE、排程維持「已確認」、治具維持預約狀態 | R-03 | `backend/tests/test_device_state.py::test_start_execution_failure_leaves_db_and_cache_unchanged`；`backend/tests/test_schedule_start_consistency.py::test_start_schedule_keeps_confirmed_when_execution_insert_fails`；`::test_manual_start_sop_reverts_when_execution_insert_fails` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md) | 已涵蓋 |
| **REQ-UI-01** | 確認之後，排程列不需人工重新整理就會與後端狀態一致 | R-04 | `tests/e2e/specs/schedule-flow.spec.js` | [BUG-001](BUG-001-schedule-status-not-refreshed-after-confirm.zh-TW.md) | 已涵蓋 |
| **REQ-UI-02** | 治具或排程寫入之後，頁面資料與全域摘要立即一致，不必等 30／60 秒的輪詢兜底 | R-04 | `tests/e2e/specs/fixture-loan.spec.js`；`tests/e2e/specs/schedule-flow.spec.js` | — | 已涵蓋 |
| **REQ-SCH-01** | 同一台設備上的有效排程不重疊；修改已確認的時段會取代精確啟動的 job；暫時性阻擋會重試；壞掉的排程收斂到終止錯誤 | R-05 | `backend/tests/test_schedule_conflict.py`；`test_schedules_slot.py`；`test_schedule_start_consistency.py::test_confirmed_slot_edit_replaces_scheduled_start_job`；`test_simulator_schedule.py` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-SCH-02** | 正在回常溫的設備，在抵達常溫之前都算被占用；設備卡與排程器由同一份共用估算得出那個時間點 | R-05 | `backend/tests/test_utils.py`；`backend/tests/test_schedules_complete.py::test_est_end_finishing_counts_remaining_ramp_not_whole_curve`；`::test_est_end_finishing_after_emergency_is_not_treated_as_free`；`::test_build_running_until_includes_finishing_device` | [BUG-006](BUG-006-cooling-device-treated-as-available.zh-TW.md) | 已涵蓋 |
| **REQ-TIME-01** | 客戶端送出的每個時間，不論從哪個端點進來，寫進資料庫前都要換算成 UTC，避免送非 UTC 時區時無聲地把排程時段、到期日或報告區間位移 | R-05 | `backend/tests/test_datetime_normalization.py`；`backend/tests/test_reports_degradation.py::test_non_utc_timestamps_are_converted_before_saving` | — | 排程時段、封鎖時段、治具借出與延期、校驗與維護、執行紀錄皆已涵蓋 |
| **REQ-FIX-01** | 治具數量在 API 與 Excel 寫入下都不得為負；「預約 → 借出 → 歸還」與採購到貨的轉換不得灌大庫存或影響到別的排程；排程確認不得預約超過剩餘庫存；兩筆時間重疊的配置不得同時搶到同一件剩餘庫存 | R-06 | `backend/tests/test_fixture_lifecycle.py`（含 `::test_manual_loan_and_schedule_cannot_both_claim_last_fixture`）；`test_fixtures_api.py`；`test_fixture_excel.py`；`test_purchase_orders.py`；`test_linkage.py`；`tests/e2e/specs/fixture-loan.spec.js` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md)；[BUG-010](BUG-010-concurrent-loan-and-schedule-both-claimed-the-last-fixture.zh-TW.md) | 已涵蓋；併發情境釘在 in-memory 測試資料庫上，部署實際使用的檔案型路徑則在修正當下另外驗過 |
| **REQ-FIX-02** | 人員送出的日期以他所在的當地日計算，不是 UTC 的那天：歸還日是當地的日曆日、到期日在當地日結束時才過期、今日到期也以當地日計算 | R-06 | `client/src/__tests__/timezone.test.js`（整個套件釘在 `Asia/Taipei`）；`backend/tests/test_fixtures_api.py::test_summary_due_today_uses_caller_day_window`；`::test_summary_without_window_falls_back_to_utc_day` | [BUG-004](BUG-004-fixture-dates-stored-one-day-early.zh-TW.md)；[BUG-005](BUG-005-fixture-day-deadlines-evaluated-in-utc.zh-TW.md) | 已涵蓋 |
| **REQ-FIX-03** | 歸還治具要走歸還對話框，讓人員記錄狀態、備註與實際歸還日；損壞或遺失需要二次確認 | R-06 | `tests/e2e/specs/fixture-loan.spec.js` | — | 已涵蓋 |
| **REQ-EXT-01** | LINE、報告與 AI 供應商的失敗會被收斂，並回傳可據以行動的結果 | R-07 | `backend/tests/test_line_resilience.py`；`test_reports_degradation.py`；`test_ai_observability.py` | — | 以模擬故障涵蓋 |
| **REQ-RPT-01** | 存下來的執行紀錄要帶著報告需要的時間，讓量測摘要反映測試區間，不論是哪條路徑存的 | R-07 | `backend/tests/test_reports_degradation.py::test_frontend_iso_timestamps_still_match_sensor_data`；`client/src/__tests__/executionPayload.test.js` | [BUG-007](BUG-007-fallback-execution-save-diverged-from-main-path.zh-TW.md) | 後端契約已涵蓋；兩條前端存檔路徑現在都用同一支共用函式組出送出的內容，少送欄位會讓測試變紅（剩餘缺口見 GAP-04） |
| **REQ-RPT-02** | 報告的數據統計（最高/最低/平均）跟自己的不確定度分析一致，同一筆執行紀錄的 PDF 與 CSV 報告也彼此一致 | R-07 | `backend/tests/test_reports_degradation.py::test_summary_stats_matches_uncertainty_mean_not_full_window_average`；`::test_csv_report_avg_temp_matches_uncertainty_stable_segment`；`backend/tests/test_uncertainty.py::test_stable_segment_filter` | [BUG-008](BUG-008-report-summary-disagreed-with-uncertainty-analysis.zh-TW.md) | 已涵蓋 |
| **REQ-RPT-03** | 報告要識別被測的東西，不是跑測試的試驗箱；執行紀錄背後沒有案件時，報告要明講，而不是拿設備識別頂替 | R-07 | `backend/tests/test_reports_degradation.py::test_report_identifies_the_sample_not_the_chamber`；`::test_report_states_no_case_when_execution_has_no_schedule`；`::test_saved_execution_inherits_the_case_from_the_row_created_at_test_start`；`::test_saved_execution_does_not_borrow_the_case_of_a_later_schedule`；`::test_start_row_timestamp_matches_the_one_the_browser_gets_back`；`::test_device_api_does_not_truncate_the_timestamp_the_browser_sends_back` | [BUG-009](BUG-009-report-test-item-section-identified-the-chamber-not-the-sample.zh-TW.md) | CSV 直接對產出的報告文字驗證；PDF 共用同一支解析案件的函式，但沒有斷言它算繪出來的內容（本基準沒有 PDF 解析套件） |
| **REQ-AI-01** | AI 建議的條件可以進入排程，同時訪客仍然無法送出寫入 | R-08 | `backend/tests/test_rag.py`；`tests/e2e/specs/ai-apply-schedule.spec.js`；`guest-readonly.spec.js` | — | 以模擬 AI 邊界涵蓋 |
| **REQ-OPS-01** | 核心背景工作（模擬器、排程器）停掉時，健康探測要跟著失敗並指出是哪一項；背景工作的例外一定要被讀取並記錄，不依賴垃圾回收時才補印 | R-10 | `backend/tests/test_health.py` | [BUG-012](BUG-012-dead-simulator-task-still-reported-a-healthy-service.zh-TW.md) | 涵蓋到探測本身說不說實話；部署端目前沒有消費者，回 503 之後會不會有人被通知到不在測試範圍 |

## 作品範圍外

| 不包含項目 | 原因 |
|---|---|
| 真實試驗箱整合 | 公開作品的基準固定為純模擬，用來展示流程與 QA 自動化，不宣稱已驗證廠商協定或實體控制。未來若取得授權，真機工作只會放在獨立分支，不算本基準的待補缺口。 |
| 負載、跨瀏覽器與無障礙測試矩陣 | 公開作品的基準以 Playwright 管理的 Chromium 與挑選過的高風險流程為主，不宣稱已驗證正式環境容量、跨瀏覽器相容性或無障礙規範。只有部署需求改變時才另立計畫。 |

## 未涵蓋的缺口

| 缺口 | 影響 | 規劃處理方式 |
|---|---|---|
| **GAP-04** — 只在設備狀態更新掉包時才觸發的前端備援路徑 | 備援何時觸發、以及它怎麼把結果合併回狀態，仍然靠程式碼審查驗證，不是靠測試 | 已收窄：兩條存檔路徑送出的內容現在由同一支共用函式（`client/src/utils/executionPayload.js`）產生，並由 `client/src/__tests__/executionPayload.test.js` 逐欄位釘住，所以造成 BUG-007 的欄位漂移現在會讓測試變紅。觸發條件與狀態合併仍需要元件測試，而本基準不做元件測試 |
