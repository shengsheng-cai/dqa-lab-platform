# DQA Lab Platform — 最小追溯表

[English](traceability.md) · 繁體中文

這張矩陣把關鍵行為連到風險與自動化證據；缺陷證據是選填，只連到精選案例。它刻意
只涵蓋高風險的 Demo 基準，而不是每一條路由、每一次修正或每一個 UI 元素。

| 需求 | 預期行為 | 風險 | 自動化證據 | 缺陷證據 | 狀態 |
|---|---|---|---|---|---|
| **REQ-AUTH-01** | 訪客不能停留在僅限管理者的頁面，也不能變更受保護的業務狀態；前端路由與頁面掛載會遵守角色，每一條管理 API 也強制授權檢查 | R-01 | `backend/tests/test_guest_authorization.py`；`backend/tests/test_blocked_period_audit.py::test_blocked_period_write_rejects_non_admin_without_audit`；`tests/e2e/specs/guest-readonly.spec.js` | — | 已涵蓋 |
| **REQ-AUTH-02** | 憑證不會出現在網址上：設備即時資料的握手改用 30 秒過期、只能用一次的入場券，所以 access log 記得到的東西都沒有重放價值 | R-09 | `backend/tests/test_ws_auth.py`；`tests/e2e/specs/ws-auth.spec.js` | [BUG-011](BUG-011-websocket-handshake-carried-a-long-lived-admin-token.zh-TW.md) | 涵蓋到反向代理之前；部署環境會不會轉送握手用的 subprotocol，要靠打開部署好的 Space 確認 |
| **REQ-AUD-01** | 設備不可用時段的變更會記錄下經過驗證的操作者；稽核寫入失敗時，業務變更要一併回滾 | R-03 | `backend/tests/test_blocked_period_audit.py` | — | 已涵蓋 |
| **REQ-MNT-01** | 維護中的設備不能被選取或啟動；排程維持「已確認」，維護結束後可以重試 | R-02 | `backend/tests/test_schedule_start_consistency.py::test_start_skipped_when_device_in_maintenance`；`::test_maintenance_keeps_confirmed_then_resumes`；`tests/e2e/specs/maintenance-block.spec.js` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-STATE-01** | 啟動成功時，設備、執行、排程、治具、稽核與 cache 的狀態要保持一致，即使呼叫端被取消 | R-03 | `backend/tests/test_schedule_start_consistency.py`；`backend/tests/test_device_state.py::test_start_repeated_cancellation_waits_for_commit_and_publishes_cache`；`backend/tests/test_linkage.py`；`tests/e2e/specs/schedule-flow.spec.js` | — | 已涵蓋 |
| **REQ-STATE-02** | 執行紀錄建立失敗時，設備回到 IDLE、排程維持「已確認」、治具維持預約狀態 | R-03 | `backend/tests/test_device_state.py::test_start_execution_failure_leaves_db_and_cache_unchanged`；`backend/tests/test_schedule_start_consistency.py::test_start_schedule_keeps_confirmed_when_execution_insert_fails`；`::test_manual_start_sop_reverts_when_execution_insert_fails` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md) | 已涵蓋 |
| **REQ-STATE-03** | 停止進行中的測試不會把排程標成完成：排程維持「進行中」、治具維持借出，因為中止不等於完成，結案只能由人來做 | R-03 | `backend/tests/test_simulator_schedule.py::test_manual_stop_keeps_schedule_running_and_fixture_untouched`；`::test_ad_hoc_manual_stop_ignores_future_schedule` | — | 已涵蓋模擬器呼叫的那層 service；通知文字本身沒有斷言，因為沒有測試在驅動模擬器迴圈 |
| **REQ-UI-01** | 確認之後，排程列不需人工重新整理就會與後端狀態一致 | R-04 | `tests/e2e/specs/schedule-flow.spec.js` | [BUG-001](BUG-001-schedule-status-not-refreshed-after-confirm.zh-TW.md) | 已涵蓋 |
| **REQ-UI-02** | 治具、排程或維護寫入後，持久資料與畫面都要符合操作人員送出的內容，不必等待 30／60 秒輪詢兜底 | R-04 | `tests/e2e/specs/fixture-loan.spec.js`；`tests/e2e/specs/schedule-flow.spec.js`；`backend/tests/test_maintenance.py::test_update_maintenance_can_clear_next_date` | — | 已涵蓋 |
| **REQ-UI-03** | 停止進行中的測試會先問過，並寫出是哪一台、哪一支測試，讓誤點一下不會毀掉跑了幾小時的工作；緊急停止與它後續的降溫維持單擊，因為事故現場不該再多一道手續；設備在緊急狀態時，畫面只給降溫那條路，不出現啟動下一次測試的流程 | R-12 | `tests/e2e/specs/device-stop-confirm.spec.js`；`tests/e2e/specs/emergency-screen.spec.js` | — | 確認視窗、取消，以及緊急畫面上有什麼都已涵蓋 |
| **REQ-UI-04** | 刪除設備不可用時段會先問過，並寫出是哪一台、哪一段時間、什麼原因，因為那一列同時擋著排程與現場啟動 | R-12 | `tests/e2e/specs/maintenance-block.spec.js` | — | 已涵蓋確認視窗與取消 |
| **REQ-UI-05** | 確認採購到貨會先問過，並寫出治具、到貨數量與入庫前後的庫存，因為那一按同時會改庫存 | R-12 | `tests/e2e/specs/purchase-arrival-confirm.spec.js` | — | 已涵蓋確認視窗與取消 |
| **REQ-UI-06** | 月盤點不會靜默漏掉治具：現場數不到完整數量的品項（有借出或預約在外）會列成未納入並寫明原因，涵蓋數加未納入數等於治具總數；完全沒有可盤項目時，視窗要說明原因，而不是讓人按下去得到「盤點完成」 | R-04 | `tests/e2e/specs/stocktake-scope.spec.js` | [BUG-014](BUG-014-monthly-stocktake-silently-omitted-fixtures.zh-TW.md) | 已涵蓋未納入清單與總數；全部被排除那種情況是靠程式判斷式守住，沒有測試在盯 |
| **REQ-UI-07** | 已確認的排程只有在設備真的接得下時才給「立即開始」：設備正在忙或落在維護時段時，按鈕停用並寫出是哪一台、為什麼、什麼時候空出來，而不是讓人白按一次注定被後端拒絕的操作 | R-04 | `tests/e2e/specs/schedule-start-readiness.spec.js` | — | 涵蓋 WebSocket 尚未就緒時的正常 fallback、另一個瀏覽器新增的維護封鎖，以及設備收尾時保留但停用的條件銜接按鈕 |
| **REQ-UI-08** | 治具的保管人只有一個可編輯的來源——在保管人視窗選的那個人。編輯治具的欄位是唯讀，API 也拒收從那裡送來的保管人，所以編輯不可能「回你成功、畫面卻沒變」；清除保管人會先問過並寫出清掉的是誰；只有名字、背後沒有人的保管人會標成未連結，不會混充成刻意設定過的保管人 | R-04 | `tests/e2e/specs/fixture-keeper.spec.js`；`backend/tests/test_fixtures_api.py::test_create_fixture_rejects_keeper_name`；`::test_update_fixture_rejects_keeper_name`；`::test_update_fixture_leaves_keeper_untouched`；`backend/tests/test_fixture_excel.py::test_import_links_keeper_to_user_when_name_matches`；`::test_export_uses_the_keepers_current_name`；`::test_import_leaves_columns_the_sheet_does_not_have_alone` | — | 已涵蓋 |
| **REQ-UI-09** | 人員管理頁的每個寫入都要講出發生了什麼：撤銷訪客 Token 會在確認視窗與成功訊息裡寫出是哪一把，撤銷失敗則把視窗與那一列都留在原地——一把可能還進得了系統的 Token，不該消失在一個看起來已經處理完的畫面後面；剛建立的 Token 按複製會回報有沒有真的進剪貼簿，因為顯示它的提示關掉就不再出現；啟用或停用人員則會寫出動的是誰；刪除人員成功會寫出刪掉的是誰，失敗同樣把視窗與那一列都留在原地 | R-12 | `tests/e2e/specs/users-page-feedback.spec.js` | — | 已涵蓋確認文案、取消、撤銷失敗、沒有剪貼簿 API 時的退路、切換的成功與失敗，以及刪除人員的成功與失敗 |
| **REQ-UI-10** | 刪除採購單、排程或維護紀錄會先問過，而且確認視窗會寫出刪的是哪一筆——視窗蓋住的正是操作人員要核對的那一列，只寫一句「確定刪除？」的話，點錯列時最後一關也救不回來 | R-12 | `tests/e2e/specs/delete-confirm-identity.spec.js` | — | 已涵蓋三個確認視窗的識別內容與取消；維護紀錄那個另外確認了不再使用瀏覽器原生對話框 |
| **REQ-UI-11** | 每個主要入口用鍵盤都走得了，不是只認滑鼠：設備卡、排程表格列、甘特圖區塊、法規與版本選擇、可排序表頭、治具匯入的檔案選擇、盤點批次都是真的按鈕，名稱說得出按下去會開什麼；目前選中哪一個、有沒有展開、排序方向都傳達得到輔助技術，不再只靠顏色；焦點外框在深色底上看得見 | R-13 | `tests/e2e/specs/keyboard-navigation.spec.js`；`client/eslint.config.js` | — | 涵蓋 spec 實際操作的七個入口，其中一條是真的連按 Tab 走順序而不是直接指定焦點；螢幕閱讀器實際唸出什麼沒有斷言，Modal 的焦點管理與 Esc 仍未處理 |
| **REQ-UI-12** | 讀不到的清單要說自己讀不到，不能講成「本來就沒有」：載入中、讀取失敗、真的沒資料是三種不同的訊息，失敗要寫出原因——連不到後端、沒有權限，或是幾號錯誤。重新整理失敗時，畫面上原本那幾列要留著並標明是上一次讀到的；下載失敗也要講出原因，不是讓按鈕安靜地彈回來。訪客 Token 那張尤其不得因為讀取失敗，就請管理者再發一把新憑證 | R-04 | `tests/e2e/specs/list-load-errors.spec.js`；`client/src/__tests__/loadError.test.js` | — | 四張紀錄清單與側欄計數已涵蓋，失敗是在網路層注入的；其他清單（異常紀錄、排程、法規選單）目前仍把讀取失敗說成沒有資料 |
| **REQ-SCH-01** | 同一台設備上的有效排程不重疊；修改已確認的時段會取代精確啟動的 job；暫時性阻擋會重試；壞掉的排程收斂到終止錯誤 | R-05 | `backend/tests/test_schedule_conflict.py`；`test_schedules_slot.py`；`test_schedule_start_consistency.py::test_confirmed_slot_edit_replaces_scheduled_start_job`；`test_simulator_schedule.py` | [BUG-002](BUG-002-maintenance-device-auto-started.zh-TW.md) | 已涵蓋 |
| **REQ-SCH-02** | 正在回常溫的設備，在抵達常溫之前都算被占用；設備卡與排程器由同一份共用估算得出那個時間點 | R-05 | `backend/tests/test_utils.py`；`backend/tests/test_schedules_complete.py::test_est_end_finishing_counts_remaining_ramp_not_whole_curve`；`::test_est_end_finishing_after_emergency_is_not_treated_as_free`；`::test_build_running_until_includes_finishing_device` | [BUG-006](BUG-006-cooling-device-treated-as-available.zh-TW.md) | 已涵蓋 |
| **REQ-TIME-01** | 客戶端送出的每個時間，不論從哪個端點進來，寫進資料庫前都要換算成 UTC，避免送非 UTC 時區時無聲地把排程時段、到期日或報告區間位移 | R-05 | `backend/tests/test_datetime_normalization.py`；`backend/tests/test_reports_degradation.py::test_non_utc_timestamps_are_converted_before_saving` | — | 排程時段、封鎖時段、治具借出與延期、校驗與維護、執行紀錄皆已涵蓋 |
| **REQ-FIX-01** | 治具數量在 API 與 Excel 寫入下都不得為負；「預約 → 借出 → 歸還」與採購到貨的轉換不得灌大庫存或影響到別的排程；排程確認不得預約超過剩餘庫存；兩筆時間重疊的配置不得同時搶到同一件剩餘庫存 | R-06 | `backend/tests/test_fixture_lifecycle.py`（含 `::test_manual_loan_and_schedule_cannot_both_claim_last_fixture`）；`test_fixtures_api.py`；`test_fixture_excel.py`；`test_purchase_orders.py`；`test_linkage.py`；`tests/e2e/specs/fixture-loan.spec.js` | [BUG-003](BUG-003-execution-insert-failure-left-zombie-running-state.zh-TW.md)；[BUG-010](BUG-010-concurrent-loan-and-schedule-both-claimed-the-last-fixture.zh-TW.md) | 已涵蓋；併發情境釘在 in-memory 測試資料庫上，部署實際使用的檔案型路徑則在修正當下另外驗過 |
| **REQ-FIX-02** | 人員送出的日期以他所在的當地日計算，不是 UTC 的那天：歸還日是當地的日曆日、到期日在當地日結束時才過期、今日到期也以當地日計算 | R-06 | `client/src/__tests__/timezone.test.js`（整個套件釘在 `Asia/Taipei`）；`backend/tests/test_fixtures_api.py::test_summary_due_today_uses_caller_day_window`；`::test_summary_without_window_falls_back_to_utc_day` | [BUG-004](BUG-004-fixture-dates-stored-one-day-early.zh-TW.md)；[BUG-005](BUG-005-fixture-day-deadlines-evaluated-in-utc.zh-TW.md) | 已涵蓋 |
| **REQ-FIX-03** | 歸還治具要走歸還對話框，讓人員記錄狀態、備註與實際歸還日；損壞或遺失需要二次確認 | R-12 | `tests/e2e/specs/fixture-loan.spec.js` | — | 已涵蓋 |
| **REQ-EXT-01** | LINE、報告與 AI 供應商的失敗會被收斂，並回傳可據以行動的結果 | R-07 | `backend/tests/test_line_resilience.py`；`test_reports_degradation.py`；`test_ai_observability.py` | — | 以模擬故障涵蓋 |
| **REQ-RPT-01** | 存下來的執行紀錄要帶著報告需要的時間，讓量測摘要反映測試區間，不論是哪條路徑存的 | R-07 | `backend/tests/test_reports_degradation.py::test_frontend_iso_timestamps_still_match_sensor_data`；`client/src/__tests__/executionPayload.test.js` | [BUG-007](BUG-007-fallback-execution-save-diverged-from-main-path.zh-TW.md) | 後端契約已涵蓋；兩條前端存檔路徑現在都用同一支共用函式組出送出的內容，少送欄位會讓測試變紅（剩餘缺口見 GAP-04） |
| **REQ-RPT-02** | 報告的數據統計（最高/最低/平均）跟自己的不確定度分析一致，同一筆執行紀錄的 PDF 與 CSV 報告也彼此一致 | R-07 | `backend/tests/test_reports_degradation.py::test_summary_stats_matches_uncertainty_mean_not_full_window_average`；`::test_csv_report_avg_temp_matches_uncertainty_stable_segment`；`backend/tests/test_uncertainty.py::test_stable_segment_filter` | [BUG-008](BUG-008-report-summary-disagreed-with-uncertainty-analysis.zh-TW.md) | 已涵蓋 |
| **REQ-RPT-03** | 報告要識別被測的東西，不是跑測試的試驗箱；執行紀錄背後沒有案件時，報告要明講，而不是拿設備識別頂替 | R-07 | `backend/tests/test_reports_degradation.py::test_report_identifies_the_sample_not_the_chamber`；`::test_report_states_no_case_when_execution_has_no_schedule`；`::test_saved_execution_inherits_the_case_from_the_row_created_at_test_start`；`::test_saved_execution_does_not_borrow_the_case_of_a_later_schedule`；`::test_start_row_timestamp_matches_the_one_the_browser_gets_back`；`::test_device_api_does_not_truncate_the_timestamp_the_browser_sends_back` | [BUG-009](BUG-009-report-test-item-section-identified-the-chamber-not-the-sample.zh-TW.md) | CSV 直接對產出的報告文字驗證；PDF 共用同一支解析案件的函式，但沒有斷言它算繪出來的內容（本基準沒有 PDF 解析套件） |
| **REQ-AI-01** | AI 建議的條件可以進入排程，同時訪客仍然無法送出寫入 | R-08 | `backend/tests/test_rag.py`；`tests/e2e/specs/ai-apply-schedule.spec.js`；`guest-readonly.spec.js` | — | 以模擬 AI 邊界涵蓋 |
| **REQ-AI-02** | AI 沒設定時，面板就地說出原因並停用輸入與範例問題，不讓人對著一個送不出去的介面打字；送出失敗顯示後端給的那句話，而不是籠統的連線失敗；Token 失效直接回登入頁 | R-04 | `backend/tests/test_runtime_info.py`；`tests/e2e/specs/ai-disabled.spec.js`；`tests/e2e/specs/list-load-errors.spec.js`；`client/src/__tests__/loadError.test.js` | — | 已涵蓋；管理者與訪客各驗一次 |
| **REQ-OPS-01** | 核心背景工作（模擬器、排程器）停掉時，健康探測要跟著失敗並指出是哪一項；背景工作的例外一定要被讀取並記錄，不依賴垃圾回收時才補印 | R-10 | `backend/tests/test_health.py` | [BUG-012](BUG-012-dead-simulator-task-still-reported-a-healthy-service.zh-TW.md) | 涵蓋到探測本身說不說實話；部署端目前沒有消費者，回 503 之後會不會有人被通知到不在測試範圍 |
| **REQ-DATA-01** | 宣告的關聯由資料庫來執行：刪掉一筆資料不會留下還指著它的資料，而且每條外鍵都要說明引用是被清空、被一起帶走，還是直接拒絕 | R-11 | `backend/tests/test_foreign_key_enforcement.py`、`backend/tests/test_schema_migrations.py` | [BUG-013](BUG-013-declared-foreign-keys-were-never-enforced.zh-TW.md) | 涵蓋的是 schema 宣告的範圍；已經含有孤兒的資料庫由 migration 擋下，不做自動修補 |

## 作品範圍外

| 不包含項目 | 原因 |
|---|---|
| 真實試驗箱整合 | 公開作品的基準固定為純模擬，用來展示流程與 QA 自動化，不宣稱已驗證廠商協定或實體控制。未來若取得授權，真機工作只會放在獨立分支，不算本基準的待補缺口。 |
| 負載、跨瀏覽器與無障礙測試矩陣 | 公開作品的基準以 Playwright 管理的 Chromium 與挑選過的高風險流程為主，不宣稱已驗證正式環境容量、跨瀏覽器相容性或無障礙規範。只有部署需求改變時才另立計畫。 |

## 未涵蓋的缺口

| 缺口 | 影響 | 規劃處理方式 |
|---|---|---|
| **GAP-04** — 只在設備狀態更新掉包時才觸發的前端備援路徑 | 備援何時觸發、以及它怎麼把結果合併回狀態，仍然靠程式碼審查驗證，不是靠測試 | 已收窄：兩條存檔路徑送出的內容現在由同一支共用函式（`client/src/utils/executionPayload.js`）產生，並由 `client/src/__tests__/executionPayload.test.js` 逐欄位釘住，所以造成 BUG-007 的欄位漂移現在會讓測試變紅。觸發條件與狀態合併仍需要元件測試，而本基準不做元件測試 |
