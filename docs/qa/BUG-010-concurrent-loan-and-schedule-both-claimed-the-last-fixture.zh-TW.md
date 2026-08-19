# BUG-010 — 手動借出與排程確認可能同時借走最後一件治具

[English](BUG-010-concurrent-loan-and-schedule-both-claimed-the-last-fixture.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-010 |
| **狀態** | 已修正 |
| **嚴重度** | High |
| **優先度** | Medium |
| **元件** | 治具庫存配置 — 手動借出與排程預約（`fixture_lifecycle.py`、`fixtures.py`、`schedules.py`） |
| **環境** | FastAPI 後端搭配 SQLite，任何部署環境；已在部署實際使用的檔案型資料庫上重現 |
| **發現方式** | Codex 全專案 review，2026-08-19 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `008927780e7f791f2197d7ef3147ac31964692ee`。與 BUG-009 不同，這份報告是**先修再寫**——寫在這裡而不是含糊帶過 |

## 摘要

有兩種操作會配置治具庫存：手動借出（`POST /api/fixtures/loans`）與排程確認
（`PATCH /api/schedules/{id}` 轉為「已確認」）。兩者的形狀相同——先讀還剩幾件可借、
判斷、再寫入一筆借出資料——而且各自在自己的交易裡做，中間沒有任何東西把它們排隊。

在一個 request 讀完、還沒寫入之前，另一個 request 可以把自己的讀取做完。於是兩邊看到
同一個可借量、兩邊都通過守衛、兩邊都提交。庫存只有 1 件的治具，最後掛著兩筆有效借出。

原本該擋住這件事的守衛 `assert_stock_available` 算出來的數字從來沒錯過。它讀的是一份
快照，而那份快照在資料被寫進去的時候已經不成立了。

## 受影響的路徑

| 路徑 | 錯誤行為 |
|---|---|
| `fixtures.py` — `create_loan` | 開一個 session，讀治具與目前的借用總量，接著寫入一筆 `reserved`／`loaned` 資料並提交。讀取到提交之間，沒有任何機制阻止另一個 session 做一樣的事 |
| `schedules.py` — `_patch_schedule_db` 的「已確認」分支 → `_reserve_schedule_fixtures` | 形狀相同：加總這張排程要的治具數量、呼叫 `assert_stock_available`，然後逐筆寫入預約 |
| `fixture_lifecycle.py` — `assert_stock_available`、`stock_counts` | 以目前交易看得到的資料計算 `available = total_quantity − loaned − reserved − damaged`。當成算式沒有問題，當成決策依據就不安全，因為算出來的值並沒有被保留到寫入為止 |

## 前置條件

- 一支治具的剩餘可借量小於兩個 request 加起來要的量——最簡單的情況是只剩 1 件、兩邊各要 1 件。
- 兩筆配置寫入在時間上重疊：手動借出撞上排程確認，或同類型的兩筆。

## 在修正前的版本上重現

1. 建一支 `total_quantity = 1` 且沒有既有借出的治具。
2. 建一張待確認排程，要求該治具 1 件。
3. 同時送出「借出該治具 1 件」與「確認該張排程」。
4. 加總這支治具所有狀態為 `loaned` 或 `reserved` 的借出數量。

第 3 步必須真的重疊。要讓兩個 HTTP request 穩定撞在同幾毫秒內並不可靠，所以重現的做法是
用共用 barrier 放行兩個執行緒，直接呼叫那兩支 route handler。伺服器本來就是這樣跑的：
`create_loan` 是同步 route，跑在 Starlette 的 threadpool 裡；`_patch_schedule_db` 則是
透過 `asyncio.to_thread` 呼叫。

## 預期結果

一筆成功、另一筆被以 400「治具庫存不足」擋掉。該治具的有效借出量等於 1，不會超過庫存。

## 實際結果

兩筆都回成功。庫存 1 件，有效借出量是 2。在檔案型資料庫上重複五次，次次如此：

```
結果: [200, 200]
有效借出總量: 2 (庫存 1，超過 1 就是超借)
```

而且畫面上看不出來。`stock_counts` 用 `max(0, …)` 夾住結果，所以被重複承諾的治具顯示的是
可借 0，不是負數。畫面上「剛好用完」和「同時答應了兩個人」長得一模一樣；短缺要等到有人
走到架子前才會浮現。

## 證據

- 先讀後寫的形狀：[`fixtures.py`](../../backend/app/fixtures.py) 的 `create_loan`，
  以及 [`schedules.py`](../../backend/app/schedules.py) 的 `_reserve_schedule_fixtures`，
  兩者都呼叫 `assert_stock_available` 之後在同一個 session 寫入，中間沒有握住寫入鎖。
- 把問題蓋住的夾擠：[`fixture_lifecycle.py`](../../backend/app/fixture_lifecycle.py) 的
  `stock_counts`，`available=max(0, fixture.total_quantity - loaned - reserved - damaged)`。
- 重現：一支暫時性腳本依上述條件在檔案型 SQLite 上建好資料，用兩個執行緒跑那兩支 handler，
  印出結果狀態與有效借出總量。修正前跑五次、修正後跑五次。腳本寫在暫存目錄、刻意不保留；
  長期防護是「驗證」一節列出的回歸測試。

## 根因

檢查與動作被拆在兩個交易裡。

SQLite 沒有 row-level 的 `SELECT … FOR UPDATE`，而且用預設方式開的交易是 *deferred*：
第一次讀取才拿讀取鎖，要到第一次寫入才升級成寫入鎖。因此兩個交易可以都先把讀取階段做完，
才輪到任何一邊寫入。這個競態需要的每一項條件都是預設值給的；不需要任何東西出錯就會發生。

庫存守衛被寫成「目前 session 看得到什麼就算什麼」的純函式——當守衛是對的形狀，但它沒有
交代那個答案能撐多久。而兩條配置路徑本來就共用這支守衛，於是兩邊的正確性同時押在一個
誰都沒有寫下來的假設上。

## 影響

- 一支治具可能被承諾給比實際存在更多的測試。系統顯示可借 0，所以在治具真的要被拿去用、
  而架上沒有之前，這個重複承諾是無聲的。
- 這個模組存在的意義就是守住
  `available = total − loaned − reserved − damaged` 且不為負，而它是被資料破壞的，不是被
  算式破壞的，所以不會有顯示錯誤、也不會有驗證錯誤指向它。
- 需要兩筆配置寫入重疊才會發生。在這個只有單一管理者的 Demo 上並不常見，這也是它一直沒被
  發現的原因；但在多位排程協調人一邊確認排程、一邊有人手動借治具的實驗室裡，這只是普通的
  星期一。
- 沒有資料變成讀不出來。既有的借出資料每一筆單獨看都是合法的，是它們的**總和**超過了實際
  存在的數量。

## 解法

兩個配置入口現在都會在讀任何庫存之前，先在自己的 session 上取得原子配置鎖：
`acquire_fixture_allocation_lock` 送出 SQLite 的 `BEGIN IMMEDIATE`，先把寫入保留鎖拿到手，
一直握到呼叫端 commit 或 rollback 才放。因此第二個 request 必須等第一個做完才讀得到可借量，
而且是對已提交的結果重算——它會被**既有的**守衛擋下，不是被新的分支擋下。

鎖放在 `fixture_lifecycle.py`，也就是本來就擁有庫存規則的那個模組，並且只加在真正「讀庫存
之後配置庫存」的那兩個地方。釋放不需要特別處理：提交就放，任何錯誤退出都會離開
`with SessionLocal()` 區塊而 rollback。

其中兩個決定是刻意的：

- **用 `BEGIN IMMEDIATE` 而不是應用層的鎖。** 在單程序部署下，一支模組級的
  `threading.Lock` 同樣能把這兩個呼叫端排隊，而且專案裡已經有這個寫法。這裡保留資料庫層的
  保留鎖，是因為它不管牽涉到幾個 session 或幾個執行緒都成立，也不必仰賴每一條配置路徑都
  記得去拿那支 Python 鎖。另一個做法沒有被丟掉，而是留成一個待決選項。
- **`BEGIN` 外面包一小段重試。** 測試套件跑在 shared-cache 的 in-memory SQLite 上，它在鎖
  衝突時會立刻回 `SQLITE_LOCKED`，不像檔案型資料庫會等 busy timeout。少了這段重試，這個
  修正會在正式環境有效、卻在自己的測試裡失敗。

## 驗證

```bash
cd backend && ../venv/bin/python -m pytest tests/test_fixture_lifecycle.py
```

`test_manual_loan_and_schedule_cannot_both_claim_last_fixture` 對只有 1 件庫存的治具同時跑
那兩支 handler，並且把不變式的兩半都釘住：結果狀態必須剛好是一個 200 加一個 400——兩邊都
成功會紅，兩邊都失敗**也**會紅——而且有效借出量是 1。

這支測試有對照修正前的行為驗過，不是假設它會動：把鎖停用時 10 次跑 10 次紅，把鎖裝回去時
15 次跑 15 次綠。

由於測試資料庫是 in-memory、部署用的是檔案，檔案型那條路另外用「證據」一節說的暫時性腳本
驗過：修正前五次都超借，修正後五次都是一筆成功、一筆 400、有效總量 1。後端全套測試通過。

多人同時借用的**負載**行為不在涵蓋範圍，也沒有宣稱涵蓋；
[風險導向測試計畫](risk-based-test-plan.zh-TW.md)裡 R-06 的殘餘風險註記仍然成立。
