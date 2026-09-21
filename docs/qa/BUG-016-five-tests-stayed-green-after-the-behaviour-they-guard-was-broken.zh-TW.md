# BUG-016 — 把測試守護的行為改壞之後，五條測試依然是綠的

[English](BUG-016-five-tests-stayed-green-after-the-behaviour-they-guard-was-broken.md) · 繁體中文

| 欄位 | 內容 |
|---|---|
| **Bug ID** | BUG-016 |
| **狀態** | 已修正 |
| **Severity** | Medium |
| **Priority** | High |
| **元件** | 測試套件本身——`backend/tests/` 與 `tests/e2e/specs/` 裡的五條測試，以及三條完全沒有測試的正式路徑 |
| **環境** | 本機套件，版本 `e63e1e6`：pytest 466 條、Vitest 152 條、Playwright 91 條 |
| **發現方式** | 2026-09-21 以變異測試對整套測試做稽核 |
| **回報者** | 蔡昇昇 |
| **修正 commit** | `cf7e744`（後端：校驗分類、時間正規化的更新路徑、LINE 推播內容與 webhook 簽章、自動排機的排除）與 `2f1d9db`（E2E：鍵盤可達性、頂部計數、三組列動作） |
| **記錄時序** | 修正前記錄。下面每一次變異都是在乾淨的工作區植入、跑完整套測試、留下輸出、再還原——全部在動手修之前完成。那些輸出就是證據。修正在那之後才做，每一項都用這裡記下的變異重放驗證過 |

## 摘要

產品今天的行為是對的。這份報告記的是：它的五道防線不是。

綠燈是一個聲明：*如果這個行為壞掉，這裡會有東西紅。* 這次稽核用唯一能驗證這個聲明的
方式去驗——把行為改壞，再跑一次測試。五條測試照樣通過。另外有三條路徑，根本沒有測試
可以改壞。

這些失效不是隨機分布的。每一條都是在斷言結果的**形狀**而不是**內容**：斷言某個鍵存在，
而不是它裝了什麼；斷言呼叫發生過，而不是它帶了什麼；斷言加總沒有超過上限，而不是它加
出什麼；斷言某個元素接得到焦點，而不是鍵盤走得到它。每一條在測試報告上都算涵蓋，實際
上什麼也沒買到。

## 影響範圍

把守護對象改壞之後仍然通過的測試：

- `backend/tests/test_maintenance.py:240` — `test_calibration_status_api`
- `backend/tests/test_datetime_normalization.py` — 這個模組宣稱涵蓋每一個收外部時間的
  端點，但兩條更新路徑不在裡面
- `backend/tests/test_line_resilience.py:29` — 替身只記 `called = True`，把參數丟掉
- `tests/e2e/specs/top-bar-counts.spec.js:23`
- `tests/e2e/specs/keyboard-navigation.spec.js:145`

沒有任何測試的正式路徑：

- `backend/app/line.py:65` — `_verify_signature`，位在全專案唯一不經認證、外部直接呼叫
  得到的端點上
- `backend/app/schedule_service.py:446` — `_auto_assign` 裡排除卡機與緊急停止設備的判斷
- `client/src/UsersPage.jsx:439`、`client/src/FixturePage.jsx:1430`、
  `client/src/components/schedule/ManageBlockedPeriodsModal.jsx:154` —— 三組含刪除鈕的
  列動作，不在幾何測試的涵蓋範圍內

## 方法

每一條可疑的測試都這樣驗：從乾淨的工作區開始，對測試指名守護的那段正式程式碼植入一個
變異，跑完整套測試，記下結果，還原。變異之後套件仍然全綠，代表那條測試偵測不到那個退步。

變異刻意挑「人真的會寫出來」的那種退步——比較反向、漏掉一次轉換、欄位改名、多一個
`tabIndex`——而不是任何審查者都會攔下來的荒謬寫法。

## 證據——仍然是綠的測試

### E1. 校驗狀態的分類沒有任何測試守著

`backend/tests/test_maintenance.py:240` 是 `GET /api/maintenance/calibration-status`
的唯一測試。它跑在空資料庫上，那時每台設備本來就是 `unknown`，然後斷言：

```python
for device_id in ["CH-01", ..., "CH-05"]:
    assert device_id in data
    assert "status" in data[device_id]
```

`assert "status" in data[device_id]` 在鍵存在之後就不可能失敗。逾期、即將到期、正常這
三分類完全沒被執行過，因為測試從頭到尾沒有建立任何一筆校驗紀錄。

對 `backend/app/devices_maintenance.py` 植入的變異：

```python
if days_remaining < 0:      status = CalibrationStatus.OK   # 原本是 OVERDUE
elif days_remaining <= 30:  status = CalibrationStatus.OK   # 原本是 DUE_SOON
else:                       status = CalibrationStatus.OK
```

結果：`466 passed`。

所有逾期的校驗現在都回報正常。設備卡上不會出現徽章，維護頁摘要的逾期數是 0，而測試
全程沉默。這跟 `backend/tests/test_calibration_status_labels.py` 形成一組諷刺的對比：
那支嚴格守著四個狀態值都要有中文名稱，卻沒有任何東西守著後端還會不會送出其中三個。

### E2. 更新路徑的時間正規化沒有測試守著

`backend/tests/test_datetime_normalization.py` 開宗明義寫出自己的範圍：每一個收外部
時間的端點，存進去的都必須是換算後的 UTC。它涵蓋八個端點。校驗與維護的**更新**路徑
不在其中，但它們的**新增**路徑在。

兩條更新路徑都靠一份寫死字串的欄位清單做正規化：

```python
for field, value in body.model_dump(exclude_none=True).items():
    if field in ("calibration_date", "next_calibration_date"):
        value = _to_naive_utc(value)
```

變異：把 `backend/app/devices_maintenance.py:139` 與 `:226` 的
`value = _to_naive_utc(value)` 換成 `pass`。

結果：`466 passed`。

編輯一筆校驗紀錄，現在會把台北的牆上時間當成 UTC 存進去——校驗到期日差八小時，而且
不會有任何錯誤。新增路徑仍然正確，所以同一張表會同時存著換算正確與默默寫錯的資料列。
程式碼的形狀讓這件事比聽起來更容易發生：在 Pydantic 模型裡把欄位改名、忘了同步那串
字串，得到的正好是這個結果，而套件不會發現。

### E3. LINE 推播的內容沒有測試守著

`backend/tests/test_line_resilience.py` 是 `push_message` 的唯一測試。它的替身只記錄
「呼叫發生過」，把內容丟掉：

```python
async def post(self, *_a, **_kw):
    self.called = True
```

測試接著斷言 `fake.called is True` 或 `is False`。這個檔案自述的範圍是韌性——LINE API
失敗時不要拋例外——這件事它測得很好。但這個函式沒有別的測試，所以送出去的內容沒有
任何防線。

變異：`backend/app/line.py:56`，`"text": text` 改成 `"text": "MUTANT"`。

結果：`466 passed`。

所有通知——包含緊急停止——現在都送出一個固定字串。推播是透過 `asyncio.create_task`
發完就不管，而 LINE 對格式正確的訊息一律回 200，所以不會有別的訊號。同樣的變異套在
`"to": target` 上，會把所有通知寄給錯的人，一樣不會被發現。

### E4. 頂部的設備計數只擋過多、不擋過少

`tests/e2e/specs/top-bar-counts.spec.js:23` 的斷言是：

```js
expect(await total()).toBeLessThanOrEqual(DEVICE_COUNT);
```

上限這種斷言，任何少算都滿足。前一行的
`expect.poll(() => statValue("不可用")).toBe(SEEDED_MAINT_COUNT)` 釘住了四個數字裡的
一個，排除了全部是 0 的情況；另外三個下限完全沒有約束。

變異：`client/src/components/control/TopBar.jsx:14` 改成篩選 `"RUNNINGX"`，讓「執行中」
永遠是 0。

結果：`1 passed`。

兩台正在跑的機器從頂部消失。使用者用來看「實驗室現在在做什麼」的那個數字變成 0，而
專門保護這些計數的那條斷言照樣成立，因為 3 ≤ 5。

### E5. 治具匯入的鍵盤測試證明不了鍵盤這件事

`tests/e2e/specs/keyboard-navigation.spec.js:145` 的名字是「治具匯入用鍵盤進得去」。
它的內容是：

```js
const choose = page.getByRole("button", { name: "選擇檔案" });
await choose.focus();
await expect(choose).toBeFocused();
```

`locator.focus()` 是用程式指定焦點，完全跳過 tab 順序；而 `getByRole("button")` 在
`focus()` 之前就已經確認過那是一顆按鈕。這條斷言等於把定位器再講一次。

變異：在 `client/src/components/fixture/ImportModal.jsx` 的那顆按鈕上加 `tabIndex={-1}`。

結果：`1 passed`。

那顆按鈕現在 Tab 停不上去，用鍵盤的人匯不了治具——正是這條測試自己的註解寫著要擋的
退步，註解裡還引用了更早那次「唯一的入口是一塊 div，點下去才去戳一個 `display:none`
的檔案欄位」的缺陷。

`.claude/rules/testing.md` 早就寫過這件事：「`focus()` 只證明「這是按鈕、Enter 有反應」，
不證明「Tab 走得到」」。同一個檔案的最後一條測試（`keyboard-navigation.spec.js:195`）
就寫對了：真的連按 Tab，記錄焦點依序停在哪。匯入這條照著錯的範本寫。

## 證據——沒有測試的路徑

這三項是「缺席」而不是「失效」，所以證據是一次搜尋不到東西，而不是一個活下來的變異。
分開列，是因為這種證據的強度不同。

### G1. LINE webhook 的簽章驗證

`backend/app/line.py:65`，在 `:299` 被使用。這是全專案唯一不經認證、外部直接呼叫得到
的端點（`.claude/rules/api-conventions.md` 明文寫著）。

在 `backend/tests/` 與 `tests/` 搜尋 `webhook`、`_verify_signature`、`X-Line-Signature`
只得到兩個命中，都在 `backend/tests/test_guest_authorization.py`：一句註解，以及一筆把
這條路由排除在管理者寫入檢查之外的白名單。兩者都沒有對簽章斷言任何事。

兩個分支都沒測到：簽章正確要放行、簽章錯誤要回 400。更糟的是，沒設 secret 時這個函式
會直接短路：

```python
if not secret:
    return True
```

而 `tests/e2e/run-e2e.sh:38` 設的正是 `LINE_CHANNEL_SECRET=""`。所以 E2E 跑的是放行
分支。這正是規則檔指名警告過的失效方式：「本機測起來過」不代表驗證有效。

### G2. 自動排機對卡機與緊急停止設備的排除

`backend/app/schedule_service.py:446` 會排除已經超過估算結束時間仍未回到待機的設備，
以及處在緊急停止的設備。`backend/tests/test_linkage.py:48` 把 `_get_stuck_devices` 與
`_get_emergency_devices` 單獨測得很完整，但沒有任何東西把它們接到 `_auto_assign` 上：
呼叫它的兩條測試（`backend/tests/test_schedules_slot.py:122` 與 `:131`）都沒有傳入
cache，所以那個排除分支從來沒被執行過。`:122` 只斷言 `device_id in DEVICE_IDS`，而那
是函式的結構本身就保證的事。

排到壞掉設備上的排程，啟動時會被擋下來（那段由
`test_schedule_start_consistency.py` 守著，而且守得很好），所以看得見的症狀是：那筆
排程停在「已確認」，每五分鐘重試一次，永遠不會開始。

### G3. 三組含刪除鈕的列動作

`.claude/rules/frontend.md` 要求列動作裡的刪除鈕排在最後、並額外拉開距離，也寫明
`tests/e2e/specs/row-action-hit-area.spec.js` 會量實際幾何來守這件事，並補了一句：
「新增用到列動作的頁面時，一併把它加進那支測試，不然那一頁沒有任何東西擋著」。

程式裡有八組 `rowActions` 容器，那支測試涵蓋三組。沒涵蓋的五組裡有三組含刪除鈕：

- `client/src/UsersPage.jsx:439` — 訪客 Token（停用、刪除）
- `client/src/FixturePage.jsx:1430` — 採購單（確認到貨、刪除）
- `client/src/components/schedule/ManageBlockedPeriodsModal.jsx:154` — 維護時段
  （編輯、刪除）

三組目前都有設定該有的間距，所以今天沒有缺陷。缺口在於：間距被拿掉的話沒有東西會發現，
而那正是規則說 lint 看不出來的事。第三組後果最重：刪掉一段維護時段，等於把同時擋住
排程排入與現場啟動的那把鎖拿掉。

## 根因

那五條綠燈測試共用同一個形狀：每一條斷言的，都是程式結構本身就會滿足的性質。

| 測試 | 它斷言什麼 | 為什麼那件事必然成立 |
|---|---|---|
| E1 | `status` 這個鍵存在 | handler 一定會把鍵建出來 |
| E2 | — | 這條路徑根本沒被涵蓋 |
| E3 | 呼叫發生過 | 那個 client 一定會被呼叫 |
| E4 | 加總 ≤ 上限 | 任何少算都滿足 |
| E5 | 元素接得到焦點 | `getByRole("button")` 已經先證明過了 |

這不是整套測試都對斷言草率——同一套裡有 `test_deploy_config.py`，它解析 IP 範圍再驗
成員資格，而不是比對字串；也有 `users-page-feedback.spec.js`，它會把剪貼簿貼回欄位驗
內容，而不是相信一個「已複製」的提示。寫弱的那幾條，都是**為了確認某次修好而寫的**，
不是為了描述一條不變式：作者當下知道行為是對的，於是寫了一條觀察它的斷言，而不是一條
約束它的斷言。

那三條沒測到的路徑成因不同——它們各自卡在一道套件沒有跨過的邊界：webhook 需要一個
簽過名的請求，自動排機的排除需要一份設備快取，列的幾何需要一個會排版的瀏覽器。三條都
到得了，只是都不順手。

## 影響

今天沒有任何使用者受影響。每一次變異都已還原，產品是正確的。

受影響的是這套測試能承諾什麼。現在有五個行為掛著一個沒有意義的綠勾，而其中最重要的
兩個——校驗到期的分類，以及時間正規化——落在跟法規符合性有關的路徑上。逾期的校驗被
報成正常，是 ISO 17025 的問題，不是畫面好不好看的問題。到期日差八小時，會默默把下一次
校驗排到錯的時間。

沒有認證的 webhook 是暴露面最大的一項：它是外部唯一進得來的入口，它的簽章檢查兩個方向
都沒被測過，而本來該發現這件事的測試環境，跑的正是那個檢查被關掉的分支。

## 修正

八項全部修好。正式程式碼沒有改——它從頭到尾都是對的。改的是測試斷言什麼。

| | 修法 | 位置 |
|---|---|---|
| E1 | 建立不同到期日的校驗紀錄，三種分類都斷言，另加「同一台有多筆時要看最新那筆」 | `backend/tests/test_maintenance.py` |
| E2 | 時間往返測試擴到兩條更新路徑，而且先種一個不同的值，沒改到就會紅 | `backend/tests/test_datetime_normalization.py` |
| E3 | 替身記下參數，斷言收件人、內容與授權標頭 | `backend/tests/test_line_resilience.py` |
| E4 | 釘住種子資料的執行中台數，少算就會紅；上限仍保留，收尾與暫停的機器照樣不會誤紅 | `tests/e2e/specs/top-bar-counts.spec.js` |
| E5 | `focus()` 換成連按 Tab，再按 Enter 確認檔案選擇器打得開 | `tests/e2e/specs/keyboard-navigation.spec.js` |
| G1 | 新檔：簽章正確、錯誤、缺少、內容被竄改四種情況，每一種都先設好 secret；另把「沒設 secret 就放行」刻意釘住 | `backend/tests/test_line_webhook_signature.py` |
| G2 | 傳 cache 給 `_auto_assign`，緊急停止與卡機的設備必須跳過，全部被排除時仍要選得出設備 | `backend/tests/test_schedules_slot.py` |
| G3 | 把沒涵蓋的三組列動作加進幾何測試 | `tests/e2e/specs/row-action-hit-area.spec.js` |

修的過程帶出兩件事值得記下來。

E1 第一版斷言 `days_remaining` 等於我種進去的天數，結果紅了：那個數字是拿「現在這一刻」
去減到期日的午夜，不是拿今天的午夜減，所以「明天到期」算出來是 −2 而不是 −1。那是這支
端點真正的行為、不是缺陷，但它代表剛好落在 0 天與 30 天門檻上的輸入，會隨執行時間落到
不同那一邊。測試改成避開這兩個門檻，並寫明原因。

E4 沒有改成等號。上限存在是有理由的：收尾降溫與暫停中的機器本來就不在這四個數字裡，用
等號會讓測試在設備剛好轉去收尾時無故變紅。另外釘住種子資料的執行中台數，就能補上少算
那個漏洞，又不會把那個不穩定帶回來。

套件規模：後端 466 → 487，E2E 91 → 94，前端 152 不變。

## 驗證

每一項修好之後，都把上面記下的那個變異原樣重放一次，確認套件這次會紅——同一套程序，
反方向跑一遍。

| 重放的變異 | 結果 |
|---|---|
| E1——三種分類全部回傳 `ok` | 4 條紅 |
| E2——兩條更新路徑拿掉 `_to_naive_utc` | 2 條紅 |
| E3——換掉訊息內容；換掉收件人 | 各 1 條紅 |
| E4——執行中的篩選條件永遠不成立 | 1 條紅 |
| E5——檔案選擇按鈕加上 `tabIndex={-1}` | 1 條紅 |
| G1——拿掉簽章檢查 | 3 條紅 |
| G2——繞過卡機與緊急停止的排除 | 1 條紅 |
| G3——拿掉刪除鈕的間距 | 1 條紅 |

這份報告當初記下「活得下來」的每一個變異，現在都會讓套件變紅。一項修正如果做不到這件事，
就代表它什麼也沒修好。
