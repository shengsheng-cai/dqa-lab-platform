# BUG-004 — 當地時間早上 8 點前送出的治具日期，會被存成前一天

[English](BUG-004-fixture-dates-stored-one-day-early.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-004 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | 治具借出／歸還 — 前端送出的日期 |
| **環境** | React 前端，任何時區早於 UTC 的地區；Demo 與開發基準跑在 `Asia/Taipei`（UTC+8） |
| **發現方式** | 四關審查的待補清單（`CLAUDE.local.md`），2026-07-27 |
| **回報者** | 蔡聖生 |

## 摘要

有三個治具畫面用 `new Date().toISOString().slice(0, 10)` 組出 `YYYY-MM-DD` 字串。
這個寫法回傳的是 **UTC** 的日曆日期，不是操作人員當地的日期。台北時間凌晨 00:00
到 08:00 之間，UTC 日期還停在前一天，所以前端送出、後端也就存下了比操作人員實際
工作那天早一天的日期。

跟 `b1dca47` 修掉的「報告檔名」那個變體不同，這三個值是**會被送出的資料**：其中
兩個直接進資料庫，另一個決定了到期日，而操作人員通常不會回頭再核對。

## 受影響的路徑

| 路徑 | 值 | 後果 |
|---|---|---|
| `FixturePage.jsx` — 列上的「正常／損壞／遺失」歸還按鈕 | 送往 `POST /api/fixtures/loans/{id}/return` 的 `returned_at` | 存下的歸還日早一天；而且操作人員從頭到尾看不到這個值，也無從更正 |
| `ReturnModal.jsx` | 預設的實際歸還日期 | 存下的值同樣錯，但它出現在一個看得見、可修改的欄位裡。撰寫本報告時該 modal 在 UI 上還連不到（見備註） |
| `LoanModal.jsx` | 預設到期日（今天 + 7 天） | 借出變成 6 天後到期而不是 7 天，導致治具提早一天被標為逾期 |

## 前置條件

- 前端機器的時區早於 UTC（`Asia/Taipei`，UTC+8）。
- 當地牆上時間介於 00:00 到 08:00。
- 在治具管理頁面上有管理者的登入工作階段。

## 在修正前的版本上重現

1. 把前端機器時鐘設成 `Asia/Taipei` 的 00:00～08:00 之間，例如 2026-07-28 01:00，
   那時是 UTC 的 2026-07-27 17:00。
2. 開啟治具總表，展開一筆有借出中的治具，按「正常」歸還。
3. 讀取該筆借出的 `fixture_loans.return_date`；若歸還時標記為損壞或遺失，也可以
   在損壞／遺失清單裡重新打開該紀錄查看。
4. 另外打開借出登記，看預先填好的到期日。

## 預期結果

- 存下的歸還日是 2026-07-28，也就是操作人員執行歸還的那一天。
- 預設到期日是 2026-08-04，當地日期往後七天。

## 實際結果

- 存下的歸還日是 2026-07-27，早了一天。
- 預設到期日是 2026-08-03，只有六天。

## 證據

- 前端送出的位置：
  [`FixturePage.jsx`](../../client/src/FixturePage.jsx)、
  [`ReturnModal.jsx`](../../client/src/components/fixture/ReturnModal.jsx)、
  [`LoanModal.jsx`](../../client/src/components/fixture/LoanModal.jsx)。
- 後端持久化：[`fixtures.py`](../../backend/app/fixtures.py) 的 `return_loan()`
  用 `datetime.date.fromisoformat()` 解析 `returned_at`，並存下該日期的午夜，
  所以前端送錯的日期會被原封不動寫進去。
- 底層的日期運算式由
  [`timezone.test.js`](../../client/src/__tests__/timezone.test.js) 涵蓋，它把整個
  套件釘在 `Asia/Taipei`，並斷言台北 00:30 時 `localDateStamp()` 回傳當地日期、
  而 `toISOString()` 回傳前一天。

## 根因

`Date.prototype.toISOString()` 一律以 UTC 序列化。取它前十個字元，得到的自然是
UTC 的日曆日期。對任何時區早於 UTC 的地區來說，當地午夜之後都有一段時間該日期
還沒往前推進，而這段時間的長度等於 UTC 位移量——在台北就是八小時。

正確的當地日期工具 `localDateStamp()` 早就存在於 `utils/timezone.js`（在
`b1dca47` 修正報告檔名的同類缺陷時加入），但這三個呼叫點當時沒有一併遷移。

## 影響

- 任何在早班或跨夜作業中執行的歸還，其治具歸還歷史都會差一天。稽核人員看到的
  歸還日或損壞／遺失清單，與操作人員實際的工作日對不上。
- 走列上按鈕時，錯誤的歸還日期從未顯示出來就被寫入，所以在存下之前沒有任何更正
  的機會。
- 在該時段建立的借出會提早一天變成逾期，讓該列變紅，並灌大治具摘要面板上的
  「逾期未還」數字。

## 解法

- 三個呼叫點現在都改用 `utils/timezone.js` 的 `localDateStamp("-")`。
- `LoanModal` 改為以當地 `Date` 計算 +7 天的預設值，再用同一個 helper 搭配明確的
  日期參數格式化，不再使用 `toISOString()`。

## 驗證

- 前端單元測試（已釘在 `Asia/Taipei`）：

  ```bash
  cd client && npm test
  ```

- 治具生命週期回歸，涵蓋透過 API 的借出 → 歸還：

  ```bash
  make test-e2e ARGS="specs/fixture-loan.spec.js"
  ```

差一天這個現象本身取決於時區與時鐘，所以沒有在自動化瀏覽器測試中重現。回歸保護
設在 helper 這一層：只要 `localDateStamp()` 退回 UTC 語意，`timezone.test.js`
就會失敗；而且沒有任何治具畫面再以其他方式組出日期字串。

## 備註

撰寫本報告時，`ReturnModal` 在 UI 上是連不到的：`setReturnTarget` 只曾被以 `null`
呼叫，治具總表的展開列改用行內的 `ReturnButtonGroup`。它的日期預設值在這裡一併
修掉是為了保持檔案一致；該 modal 後續才被重新接到「歸還」按鈕上，那次變更同時
補上了原本可以抓到這個死入口的瀏覽器測試。
