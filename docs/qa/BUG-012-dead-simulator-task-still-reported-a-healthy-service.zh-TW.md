# BUG-012 — 模擬器背景工作死掉之後，服務仍然回報自己健康

[English](BUG-012-dead-simulator-task-still-reported-a-healthy-service.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-012 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | 背景工作生命週期與健康探測（`main.py` 的 `lifespan` 與 `/health`、`simulator.py` 的 `data_simulator`） |
| **環境** | 任何以 lifespan 啟動的部署，包含 `Dockerfile` 裡的容器啟動指令 |
| **發現方式** | Codex 全專案 review，2026-08-19 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `159f54d24558d9c415212a77a87637bd86c4ff13`。與 BUG-010、BUG-011 一樣，這份報告是**先修再寫**——寫在這裡而不是含糊帶過 |

## 摘要

這套系統會動的部分幾乎都掛在同一條背景工作上：模擬器每秒寫一次感測資料、推設備狀態機、
把測試往下一個相位帶。它的主迴圈是 `simulator.py` 裡的 `while True`，本體沒有外層的例外
防護，所以只要有任何沒被內層 `except` 接住的例外逃出來，那條工作就結束了，而且不會有人
重啟它。

系統其他部分完全不知情。API 照樣回應、頁面照樣開得起來，`/health` 照樣回
`{"status": "ok"}`——因為它本來就是無條件回這一行。溫度停在最後一個值、排程不再往前走，
但探測看到的是一個健康的服務。

更麻煩的是，例外在服務執行期間**完全不會出現在日誌裡**（原因見「證據」），所以連翻日誌
都找不到。這個缺陷不是「做錯了什麼」，而是「壞掉之後沒有任何東西會說」。

## 受影響的路徑

| 路徑 | 錯在哪 |
|---|---|
| `backend/app/main.py` — `health` | 函式本體只有一行 `return {"status": "ok"}`，不看任何背景工作或排程器的狀態 |
| `backend/app/main.py` — `lifespan` | 三條背景工作各自 `create_task` 之後丟進模組級的 `background_tasks` set，done callback 只做 `discard`，沒有任何地方讀取工作的 exception |
| `backend/app/simulator.py` — `data_simulator` | 主迴圈的 `while True` 本體沒有外層 try，逐台設備處理途中的任何未預期例外都會讓整條工作結束 |

## 前置條件

- 服務以正常的 lifespan 啟動，模擬器工作有跑起來。
- `data_simulator` 的主迴圈發生一個沒被內層 `except` 捕捉的例外。DB 寫入與 LINE 推播都有
  局部防護，所以這需要一個沒被預期到的新錯誤——機率低，但只要發生一次就是永久的。
- 有人或有東西以 `/health` 判斷這個服務正不正常。

## 在修正前的版本如何重現

1. 切到修正 commit 之前的版本（`159f54d^`）。
2. 讓 `data_simulator` 在啟動後就拋出例外。實測是把它換成一個立刻 raise 的 coroutine，
   效果等同主迴圈有例外逃出去。
3. 以正常 lifespan 啟動 app（`TestClient` 進 context，或直接跑 uvicorn）。
4. 打 `GET /health`，同時觀察服務執行期間的日誌。

## 預期結果

探測應該反映核心背景工作的存活，模擬器死了就不該回正常：

```
HTTP/1.1 503 Service Unavailable
{"status": "unhealthy", "checks": {"simulator": "stopped", "scheduler": "running"}}
```

而且那條工作的例外，要在它發生的當下就進日誌。

## 實際結果

```
HTTP/1.1 200 OK
{"status": "ok"}
```

感測資料、設備狀態機與排程進度全部停住，`/health` 仍然回正常。

日誌那邊也沒有補救。例外在服務執行期間完全沒有出現，原因是那些工作被存在 `lifespan` 這個
async generator 的區域變數裡（`sim_task`）。generator 掛在 `yield` 上，frame 不會釋放，
工作物件因此不會被回收，asyncio 用來補印 `Task exception was never retrieved` 的
`Future.__del__` 也就不會被呼叫。要等到 lifespan 結束、也就是關機的時候才補印一次——那時
服務已經帶著說謊的探測跑完整段生命週期了。

## 證據

- 修正前的探測：`git show 159f54d^:backend/app/main.py`，第 282–284 行，
  `async def health(): return {"status": "ok"}`，函式本體就這一行。
- 修正前的工作保存方式：同一個檔案第 39 行的 `background_tasks = set()`，以及第 137、141、
  146 行三組 `add(...)` 搭配 `add_done_callback(background_tasks.discard)`。整個檔案沒有
  任何一處呼叫 `task.exception()`。
- 主迴圈沒有外層防護：[`simulator.py`](../../backend/app/simulator.py) 的 `data_simulator`，
  `while True:` 之後直接是逐台設備的處理，內層的 `except Exception` 只包住 DB 寫入與推播。
- 「執行期間不會印」是實測出來的：用 `asynccontextmanager` ＋ `create_task` ＋ `discard`
  callback 重現修正前的形狀，再用 `weakref` 確認工作物件在 context 內仍然活著。期間沒有任何
  asyncio 的錯誤輸出，`Task exception was never retrieved` 只在 context 結束之後才出現。
  這件事要用 unbuffered 的輸出才看得準：日誌走 stderr、印出來的標記走 stdout，緩衝會讓兩者
  的先後看起來相反。
- 修正後的行為同樣是實測的：在暫存資料庫上跑真實 app 的完整 lifespan，正常時 `/health` 回
  200 `{"status": "ok"}`；把 `data_simulator` 換成會拋例外的版本之後回 503 與
  `{"simulator": "stopped", "scheduler": "running"}`，同時應用日誌印出
  `Background task simulator failed: ...` 與完整 traceback。

## 根本原因

兩個各自都合理的決定疊在一起。

第一，背景工作只被「保存」而沒有被「監督」。那個模組級的 set 存在的理由是防止工作被垃圾
回收——這是 asyncio 官方文件建議的作法，它也確實做到了。但沒有人負責在工作結束時去看它
為什麼結束。`discard` 只是把它從 set 拿掉，不會問任何問題。

第二，`/health` 是在還沒有背景工作要顧的時候寫的。它回答的是「HTTP 伺服器收得到請求嗎」，
而這個服務真正的功能有一大半在 HTTP 之外：模擬器每秒推狀態機、APScheduler 到點啟動排程。
探測的範圍跟服務的範圍從一開始就不一樣，只是在沒東西掛掉之前看不出來。

還有第三件事把前兩件放大：正因為 set 之外還有 `lifespan` 的區域變數抓著工作物件，asyncio
那條「至少會在回收時吼一聲」的最後防線也不會觸發。三件事湊在一起，結果就是一個完全靜默的
永久失效。

## 影響

- 模擬器一死，這個系統的核心就停了：感測資料不再寫入、設備狀態機不再推進、排程不再啟動或
  完成。畫面上的設備卡會停在最後一個值。
- `/health` 仍然回 200，所以任何以它為準的探測都會判定服務健康。這正是缺陷本身——失效與
  偵測之間沒有連結。
- 服務執行期間日誌裡沒有任何線索，實際上唯一的發現方式是有人注意到溫度不動了。
- 機率低，正常路徑有不少局部防護；但影響是永久的，沒有東西會重啟那條工作，只能整個服務重開。
- 這裡把嚴重度評為 Medium，是因為這個基線是模擬資料的作品集 Demo，停掉的是模擬而不是真實
  試驗箱。同樣的形狀發生在真實實驗室，停掉的就是設備監看，評級要照那個情境重估。

## 解決方式

分成三件事處理。

- **監督**：背景工作一律經過 `_start_background_task` 註冊進 `app.state.background_tasks`，
  done callback 一定會呼叫 `task.exception()`，有例外就用應用自己的 logger 記下來（含
  traceback）。因為 exception 被讀取了，也就不再依賴 asyncio 那條回收時才觸發的最後防線。
  工作結束就從名冊移除，名冊只留還活著的。
- **探測**：`/health` 改成回報 `simulator` 與 `scheduler` 兩項的存活，任一項不是 running
  就回 503 並指出是哪一項。正常時維持原本的 200 `{"status": "ok"}`，所以既有的等待邏輯
  （`dev_start.sh` 與 E2E 的後端輪詢）不受影響。
- **關機**：`lifespan` 的啟動段包進 `try/finally`，離開時明確 cancel 並 await 所有背景工作，
  再關掉 HTTP client。啟動途中失敗也走同一條清理路徑。

有三件事考慮過但沒有做：

- **自動重啟死掉的工作。** 重啟不知道上一次死在哪，在狀態機中途死掉的情況下只會把壞掉的
  狀態一直重播。讓探測誠實地失敗、把處置交給外面，是比較容易解釋的行為。
- **把 `broadcast_loop` 也納入探測。** 它的 `try/except` 在迴圈內，單次錯誤不會弄死整條
  工作，跟模擬器那個沒有外層防護的迴圈不是同一種風險。納進來只會讓探測的語意變模糊。
- **在 `Dockerfile` 加 `HEALTHCHECK` 或接外部監控。** 這個基線是 HF 免費 Space 上的作品集
  Demo，加一層沒人維護的監控不會讓它更可信。`/health` 現在說的是真話，要不要接、接什麼，
  是部署端的決定。

## 驗證方式

```bash
cd backend && ../venv/bin/python -m pytest tests/test_health.py
```

`tests/test_health.py` 釘住六件事：核心背景工作都在時 `/health` 回 200；模擬器停掉時回 503
並指出是 `simulator`；排程器不在 RUNNING（含 PAUSED 與 STOPPED 兩種）時同樣回 503；背景
工作拋例外時 exception 會被讀取並記錄，而且那條工作會離開名冊、探測隨之改判；關機時工作會
被 cancel 並確實 await 完成；以及跑完一整條真實 lifespan 之後，`_health_checks` 看到的鍵名
確實是 `simulator` 與 `scheduler`——最後這條用的是真的 `AsyncIOScheduler` 與 in-memory
SQLite，不是假物件，所以啟動流程改了名字會讓它變紅。

沒有涵蓋的部分有兩塊。模擬器主迴圈本身仍然沒有外層的例外防護：這份修正處理的是「死了要看
得出來」，不是「不會死」。另外 `/health` 目前在部署上沒有消費者——`Dockerfile` 是純 uvicorn
指令、沒有 `HEALTHCHECK`——所以它回 503 之後會不會有人被通知到，取決於部署端有沒有接監控。
