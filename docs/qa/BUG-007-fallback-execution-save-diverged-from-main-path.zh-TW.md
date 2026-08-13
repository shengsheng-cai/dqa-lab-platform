# BUG-007 — 備援的存檔路徑漏送主路徑會送的欄位，導致報告沒有量測數據

[English](BUG-007-fallback-execution-save-diverged-from-main-path.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-007 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | SOP 執行紀錄的建立 — 前端備援存檔路徑 |
| **環境** | React 前端 + FastAPI 後端、模擬器 Demo 基準；任何瀏覽器會漏掉 `ramp_to_ambient` 相位轉換的部署 |
| **發現方式** | 2026-08-01 清理無呼叫者端點時的程式碼閱讀，起因是調查 `GET /api/sop-executions/{id}` 為何回傳空的 `steps`。後續由該修正的四關審查延伸擴大 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `6e90524d476e92361ac439b59386844c79984ef1` |

## 摘要

前端在兩個彼此獨立的地方建立 SOP 執行紀錄，而這兩份 payload 已經漂開了。

`ExecutionPanel.saveExecution` 是主路徑。`SOPPage` 另外帶著第二份備援，用在「瀏覽器
從未看到 `ramp_to_ambient` 轉換、主路徑因此沒有被啟用」的情況。備援那份少送了三個
主路徑會送的欄位：兩個測試時間，以及 `manual_mode`。

每一個漏送都有各自的使用者可見後果，而且兩者都不會產生任何錯誤訊息。

## 受影響的路徑

| 路徑 | 錯誤行為 |
|---|---|
| `client/src/SOPPage.jsx` — `data.status === IDLE_STATUS` 的 effect | 送出 `test_started_at: null`，並且完全沒送 `test_ended_at`。`reports.py` 只有在兩個時間都存在時才會查感測資料，所以報告產出來就沒有量測數據 |
| `client/src/SOPPage.jsx` — 同一個請求 | 漏送 `manual_mode`。`ExecutionCreate` 預設它為 `False`，於是 `sop.py` 把一次手動除錯當成一般測試，發出了 LINE 推播 |

## 前置條件

- 一個測試在 SOP 頁面上自然完成。
- 瀏覽器沒有觀察到 `sim_phase` 進入 `ramp_to_ambient` 的那次轉換。`SOPPage` 只在那
  一次特定轉換上啟用主路徑
  （`prevPhase !== "ramp_to_ambient" && simPhase === "ramp_to_ambient"`），
  所以設備狀態推送在那一刻中斷，就會讓 `autoSave` 維持 false。
- 設備接著回到 `IDLE`，於是改由備援路徑存下紀錄。

第二個症狀還需要額外條件：該次執行是在手動模式下臨時啟動的，而且設備上沒有已確認
的排程。

## 在修正前的版本上重現

1. 在 SOP 頁面上於 CH-01 啟動一個低溫 SOP（例如 `iec60068_ab_-40_16h`），讓它自然
   跑完。
2. 在模擬器進入 `ramp_to_ambient` 的那個時間點前後中斷設備狀態推送，讓頁面看不到
   那個相位。
3. 等設備回到 `IDLE`，備援存檔就會觸發。
4. 打開執行紀錄，下載那筆新建紀錄的 CSV 或 PDF 報告。

## 預期結果

報告包含該測試區間的量測摘要——最高溫度、最低溫度、平均溫度、平均濕度、數據筆數
——與主路徑存下的報告完全一樣。

## 實際結果

第 1 到 4 節都有內容，步驟表也在，但數據筆數是 0，測試數據統計裡每個值都是 `N/A`。
報告看起來就像這台試驗箱什麼都沒記錄到。UI 與 log 都沒有出現任何警告。

另外，一次沒有排程的手動模式執行，發出了一則 `✅ 測試完成` 的 LINE 推播——同一次
執行若由主路徑存下，這則推播本來會被抑制。

## 證據

- 備援存檔：[`SOPPage.jsx`](../../client/src/SOPPage.jsx)
  （`data.status === IDLE_STATUS` 的 effect）。
- 對照用的主路徑存檔：
  [`ExecutionPanel.jsx`](../../client/src/components/sop/ExecutionPanel.jsx)
  （`saveExecution`）。
- 量測區間的查詢：[`reports.py`](../../backend/app/reports.py)
  （`_fetch_execution_data` 裡的 `if execution.test_started_at and
  execution.test_ended_at` 守衛）。
- 推播的抑制：[`sop.py`](../../backend/app/sop.py)（`create_execution` 的
  `if not has_schedule and not data.manual_mode`）。
- 回歸測試：
  [`test_reports_degradation.py`](../../backend/tests/test_reports_degradation.py)
  （`test_frontend_iso_timestamps_still_match_sensor_data`）。

## 觀察到的事實 vs 推論

直接觀察到的：

- 除非兩個時間都設定，否則 `reports.py` 不會回傳任何感測資料列。這點以回歸測試
  驗證過：把 `test_ended_at` 從該測試的 payload 拿掉，報告查詢就從 10 列變成 0 列。
- 兩個時間都帶著的紀錄，會產出完整的量測區段。這點在開發用資料庫上以執行 5 確認
  過——2401 筆資料點、最高 25.0 °C、最低 −40.0 °C、平均 −31.99 °C。
- `manual_mode` 是推播的閘門，而備援路徑沒有送它。

推論而未重現的：啟用備援路徑的那個推送中斷，在正常操作中確實會發生。備援本身與
它上面那段註解都早於這次調查，所以那個情況當初被認為是可達的，但沒有留下任何實際
捕捉到的案例。這裡的一切都是對著模擬器驗證的，沒有動用任何實體試驗箱。

## 根因

同一個請求被寫了兩份，而且靠人工保持同步。沒有任何東西把兩份 payload 綁在一起，
所以在主路徑上加的欄位不會傳到備援，也沒有任何測試或型別會因此失敗。

漏送時間並不是單純的疏忽。備援是在設備已經回到 `IDLE` 之後才執行，而後端在那個
時間點就清掉了 `started_at`，所以主路徑從即時設備狀態讀到的那個值，在備援需要它的
時候早就不見了。送 `null` 是阻力最小的做法。

## 影響

- 經由備援存下的報告不帶任何量測數據。對一份 ISO/IEC 17025 報告來說那正是文件的
  實質內容，而且這個失敗是無聲的——讀者無法分辨它與「試驗箱真的什麼都沒記錄」的
  差別。
- 手動除錯的執行消耗了 LINE 推播額度（免費方案 200 則／月），而手動模式的存在正是
  為了保護這個額度。
- 沒有任何已存資料被弄壞。受影響的紀錄是缺時間，不是帶著錯的時間，所以任何歷史
  紀錄仍然可以被辨識出來。

## 解法

- 備援現在會送出兩個時間與 `manual_mode`，與 `ExecutionPanel.saveExecution` 一致。
- `lastStartedAtRef` 在測試進行中保留開始時間，讓它在設備回到 `IDLE` 之後仍然存在。
  它刻意不重用既有的 `chartStartedAt`：那個值屬於圖表的生命週期，而且在緊急停止
  那條路徑上會被清掉——那時 `started_at` 消失，狀態卻還沒進到 `FINISHING`。
- 兩個呼叫點都帶著指向對方的註解，讓下一個加到任一邊的欄位在兩邊都看得見。

這次修復沒有把兩份 payload 合併成共用的建構函式。它們在這些欄位之外本來就有正當
的差異——備援把每個步驟都標成完成，主路徑送的是操作人員實際的逐步狀態——所以把
它們收斂被留成另一次重構。

那次重構後來完成了（2026-08-08）。兩個呼叫點現在都透過
`client/src/utils/executionPayload.js` 的 `buildExecutionPayload` 組出要送的內容，
並由 `client/src/__tests__/executionPayload.test.js` 逐欄位釘住，所以少送一個欄位
會讓測試變紅，不再依賴讀者注意到那兩行互相指向的註解——那兩行已經拿掉了，因為
共用函式取代了它們原本在提醒的事。正當的逐步差異仍然保留：兩個呼叫點各自把自己
的完成狀態傳進建構函式。

## 驗證

```bash
cd backend && ../venv/bin/python -m pytest tests/test_reports_degradation.py -v
```

`test_frontend_iso_timestamps_still_match_sensor_data` 透過真實路由送出，讓瀏覽器
會送的那些 ISO 字串真的經過 `ExecutionCreate`，然後斷言報告查詢找得到預先塞入的
感測資料列。把 `test_ended_at` 從它的 payload 拿掉，它會以 `0 == 10` 變紅，所以它
對修正前的行為具有鑑別力，不是僥倖通過。

它刻意塞入帶時區的 UTC 時間，因為那正是瀏覽器實際會送的東西：開始時間帶
`+00:00`，結束時間是帶 `Z` 的 `new Date().toISOString()`。而感測資料的時間戳是
naive UTC。這條測試釘住的就是「兩者仍然要對得上」這個要求。

前端這一側，送出去的內容也有涵蓋：

```bash
cd client && npm test -- executionPayload
```

`executionPayload.test.js` 斷言的是 `buildExecutionPayload` 回傳的整個物件，所以
這個缺陷牽涉的三個欄位——兩個時間與 `manual_mode`——不論從哪條存檔路徑漏送，都會
讓它變紅。

仍然沒有涵蓋的是觸發條件：備援在什麼情況下會被觸發、以及它怎麼把結果合併回狀態。
React 元件在本基準下不做單元測試（沒有 jsdom 設定），而備援只在推送中斷時才觸發，
那是瀏覽器測試無法穩定製造出來的情況。追溯表把這個剩餘部分記為 GAP-04。
