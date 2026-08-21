# DQA Lab Platform — 風險導向測試計畫

[English](risk-based-test-plan.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **計畫類型** | 發布基準的回歸測試計畫 |
| **對象** | `main` 上的模擬設備 Demo |
| **對應策略** | [測試策略](test-strategy.zh-TW.md) |

## 1. 目標

依照業務與工程上的風險分配測試資源。這份計畫把優先權給三類失敗：造成未授權的
變更、在不可用的設備上啟動測試，或是把同一條流程拆成互相矛盾的排程、設備、
執行與治具狀態。

## 2. 評分方式

- **影響 Impact：** High＝存取控制、安全規則或持久資料的完整性；Medium＝流程失敗
  或狀態誤導但有替代做法；Low＝侷限於呈現層的問題。
- **可能性 Likelihood：** 依可達到的分支、非同步行為、共用狀態與過往缺陷判斷。
- **優先度 Priority：** P0 必須先通過，接著是 P1，P2 補足發布信心。

## 3. 風險清單與規劃涵蓋

| ID | 失效模式 | 影響 | 可能性 | 優先度 | 自動化證據 | 殘餘風險 |
|---|---|---:|---:|---:|---|---|
| **R-01** | 訪客執行了管理者才能做的寫入 | High | Medium | P0 | `test_guest_authorization.py`、`test_blocked_period_audit.py`、`guest-readonly.spec.js` | 新路由可能漏掉共用的守衛；路由列舉是回歸防護網 |
| **R-02** | 設備忙碌中或維護中卻啟動了測試 | High | Medium | P0 | `test_schedule_start_consistency.py`、`maintenance-block.spec.js` | 真實硬體的連鎖保護不在範圍內 |
| **R-03** | 設備、排程、SOP 執行、治具、稽核或 cache 的狀態彼此分歧 | High | High | P0 | `test_device_state.py`、`test_schedule_start_consistency.py`、`test_blocked_period_audit.py`、`test_linkage.py`、`test_schedules_complete.py`、`schedule-flow.spec.js` | 在已測試的交易邊界之外，程序被中斷 |
| **R-04** | UI 顯示過期狀態，並提供了無效的操作 | Medium | High | P1 | `schedule-flow.spec.js`、`fixture-loan.spec.js` | 短暫的重新整理或網路失敗仍可能需要人工重試 |
| **R-05** | 重疊、延遲啟動、修改已確認時段、重啟或錯誤輸入，導致排程卡住或啟動了錯的工作 | High | Medium | P1 | `test_schedule_conflict.py`、`test_schedules_slot.py`、`test_simulator_schedule.py`、`test_schedule_start_consistency.py`（含精確日期 job 的取代）、`test_schedules_complete.py`（回常溫期間的設備可用性） | 長時間的時鐘漂移與生產環境的排程器負載未涵蓋 |
| **R-06** | 治具庫存變成負數、被排程預約超額、重複歸還、到貨重複入庫、永久卡在預約，或連到錯誤的排程 | High | Medium | P1 | `test_fixture_lifecycle.py`、`test_fixtures_api.py`、`test_fixture_excel.py`、`test_purchase_orders.py`、`test_linkage.py`、`fixture-loan.spec.js` | 多人同時借用未做負載測試 |
| **R-07** | 外部服務或報告讓核心操作失敗，或報告產出了但內容悄悄不完整、前後矛盾，或識別錯對象 | Medium | Medium | P2 | `test_line_resilience.py`、`test_reports_degradation.py`（降級、量測摘要所依賴的時間契約、數據統計與不確定度分析的一致性契約，以及受測樣品識別契約）、`test_uncertainty.py`、`test_ai_observability.py`、`client/src/__tests__/executionPayload.test.js` | 供應商的實際行為與額度變動不涵蓋；前端存檔路徑漏送欄位現在會讓測試變紅，但備援路徑何時觸發仍然只能靠審查抓（GAP-04） |
| **R-08** | AI 的建議無法安全套用，或訪客走進無法完成的寫入流程 | Medium | Medium | P2 | `test_rag.py`、`ai-apply-schedule.spec.js`、`guest-readonly.spec.js` | 回答的語意品質未做完整評分 |
| **R-09** | 登入憑證跑到可以被撿去重放的地方——網址、access log，或任何在請求結束後還留著的紀錄 | High | Medium | P1 | `test_ws_auth.py`、`ws-auth.spec.js` | 涵蓋的是這個應用自己控制得到的憑證；部署平台的代理或日誌管線自己會記下什麼，不是測試套件觀察得到的範圍 |
| **R-10** | 核心背景工作停掉，服務對外卻仍宣稱自己正常 | Medium | Low | P2 | `test_health.py` | 涵蓋的是探測說不說實話；模擬器主迴圈本身仍然沒有外層防護，部署端要不要接監控也不在這裡 |
| **R-11** | 刪掉一筆資料後，其他資料仍指向已經不存在的東西，因為宣告的關聯根本沒有生效 | Medium | Medium | P2 | `test_foreign_key_enforcement.py`、`test_schema_migrations.py` | 涵蓋的是 schema 宣告了什麼、資料庫又照做了什麼；已經含有孤兒的資料庫會被 migration 擋下而不是自動修補，那仍然是人要決定的事 |

## 4. 執行順序

### P0 — 發布阻斷項

1. 訪客授權的路由防護網與 API 拒絕。
2. 維護中／忙碌設備的啟動守衛。
3. 啟動成功，以及啟動失敗時設備、執行、排程、治具與稽核狀態的回滾。

### P1 — 核心流程完整性

1. 排程重疊、自動選機、延遲啟動、重試、改期後的日期 job 取代，以及完成。
2. 治具「預約 → 借出 → 歸還」生命週期，含無效數量與重複操作。
3. 瀏覽器上的排程確認與可見狀態的一致。

### P2 — 韌性與周邊流程

1. LINE、報告、AI 逾時與供應商降級時的行為。
2. AI 建議 → 套用成排程。
3. 冒煙測試與測試環境自我檢查。

## 5. 測試設計

- 對時間窗邊界、數量 `0`／負值與狀態轉換使用邊界值。
- 在「部分寫入會造成狀態不一致」的那個點注入資料庫／外部服務故障。
- 在 worker thread 的交易還在進行時取消非同步呼叫端，然後驗證資料庫與 cache
  最終收斂。
- 同時驗證 HTTP 結果與權威的資料庫／設備狀態。
- 跨模組流程要驗證每一個受影響的實體，而不是只看發起的那支 API 回應。
- E2E 的定位優先用使用者看得到的文字，並且每個 spec 檔都重置後端。
- 不得用重試去掩蓋不穩定的測試。

## 6. 進入條件

- 已辨識出對應的風險 ID 與預期的不變量。
- 需要的種子資料與故障控制是確定性的。
- 單元／整合測試不會碰到開發用資料庫。
- LINE 與 Gemini 的實際呼叫已停用或被攔截。

## 7. 結束條件

- 全部 P0 測試通過。
- 與本次變更相關的 P1 測試通過。
- P2 的失敗已修正，或明確接受且確認不影響 P0／P1 的不變量。
- Demo 路徑上沒有未解決的 Critical／High 缺陷。
- 已修正的缺陷都能從[追溯表](traceability.zh-TW.md)連過去。

## 8. 已知缺口

- 不宣稱做過真實試驗箱或協定測試。
- 效能、瀏覽器矩陣、無障礙與資安滲透測試，若成為發布目標，需要另立計畫。
