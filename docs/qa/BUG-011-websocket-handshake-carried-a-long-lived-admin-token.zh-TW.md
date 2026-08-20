# BUG-011 — 設備 WebSocket 的握手網址帶著長效管理員 token

[English](BUG-011-websocket-handshake-carried-a-long-lived-admin-token.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-011 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | WebSocket 認證 — 設備即時資料的握手（`ws.py`、`auth.py`、`client/src/useDeviceWebSocket.js`） |
| **環境** | 任何開著 Uvicorn access log 的部署，包含 `Dockerfile` 裡的容器啟動指令 |
| **發現方式** | Codex 全專案 review，2026-08-19 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `03291360f88ffd82f96a13cbc4ff8f8aba8717b5`。與 BUG-010 一樣，這份報告是**先修再寫**——寫在這裡而不是含糊帶過 |

## 摘要

瀏覽器是用 `/ws/devices?token=<token>` 開設備即時資料的，而那個 token 就是 REST API
在用的同一張憑證：管理員 8 小時的登入 token，或訪客 token，或 Demo 的 master key。

query string 是請求行的一部分，Uvicorn 的 access log 會把請求行原樣記下來。於是這套
系統裡「能授權所有管理寫入」的那張憑證，每握一次手就被抄進一般的應用日誌一次，而且在
日誌裡繼續有效到它自己過期為止。

過程中沒有任何東西壞掉。連線接得起來、設備卡有在更新、也不會報錯。問題不在程式做錯了
什麼，而在憑證跑到了不該去的地方。

## 受影響的路徑

| 路徑 | 錯在哪 |
|---|---|
| `client/src/useDeviceWebSocket.js` — `getToken`、`connect` | 從 `localStorage` 讀出登入 token，接成 `?token=` 掛在 WebSocket 網址後面；第一次連線與之後每一次重連都會 |
| `backend/app/ws.py` — `_authenticate` | 從 `ws.query_params` 收這張憑證，等於讓網址成為瀏覽器唯一放得了憑證的地方 |
| `Dockerfile` — 容器啟動指令 | 用 `uvicorn app.main:app` 起服務，沒有加 `--no-access-log`，所以部署環境每次握手都會寫一行日誌 |

## 前置條件

- 部署環境的 Uvicorn access log 是開著的。這是預設值，容器啟動指令也沒關掉它。
- 有任何一個已登入的 session 打開設備即時資料。管理員是真正要緊的那種：他那張 token
  同時授權所有寫入端點。
- 有人讀得到日誌——平台的日誌主控台、容器的 stdout，或任何接在後面的日誌收集工具。

## 在修正前的版本如何重現

1. 切到修正 commit 之前的版本。
2. 照容器的方式把後端起起來，access log 保持開著：
   `uvicorn app.main:app --host 0.0.0.0 --port 7860`。
3. 用瀏覽器以管理員登入；控制中心一掛載就會開設備即時資料。
4. 讀後端寫到 stdout 的那行握手日誌。

## 預期結果

那行日誌只寫出端點，別的什麼都沒有：

```
127.0.0.1:54321 - "WebSocket /ws/devices" [accepted]
```

憑證走的是日誌不會記錄的路徑，日誌裡撿不到任何能拿去重放的東西。

## 實際結果

那行日誌把憑證一起帶了出來：

```
127.0.0.1:54321 - "WebSocket /ws/devices?token=<64 個十六進位字元>" [accepted]
```

把這個 token 從日誌抄走、當成 `X-User-Token` 送出，就能一路冒充該管理員直到 token
過期——最長八小時（`auth.py` 的 `TOKEN_TTL`）——而且涵蓋所有寫入端點，不只是當初借用
它的那條唯讀即時資料。

上面那行是 Uvicorn 實際會吐的格式，來自它的日誌程式碼，不是從執行中的部署擷取下來的；
見「證據」。

## 證據

- 修正前的前端：`git show 63e84b7:client/src/useDeviceWebSocket.js` —
  `` const url = `${WS_BASE}/ws/devices${token ? `?token=${encodeURIComponent(token)}` : ""}` ``，
  其中 `getToken` 會從 `localStorage` 回傳 `user_token` 或 `demo_password`。
- 修正前的後端：[`ws.py`](../../backend/app/ws.py) 的 `_authenticate`，入口是
  `ws.query_params.get("token", "")`。
- Uvicorn 到底記什麼：專案鎖的這個版本裡兩種 WebSocket 實作——
  `protocols/websockets/websockets_impl.py` 與 `websockets_sansio_impl.py`——
  記的都是 `'%s - "WebSocket %s" [accepted]'`，參數是
  `get_path_with_query_string(scope)`，那支 helper 只要有 query string 就會接上去。
  請求 header 不會出現在任何一行 access log 裡。
- 憑證的權限範圍：[`auth.py`](../../backend/app/auth.py) 的
  `TOKEN_TTL = 8 * 60 * 60`；`auth_middleware` 認的就是同一張 token。
- 沒有取得的證據：執行中部署環境的實際日誌行。這份判斷是靠上面兩段程式碼成立的——
  一段把 token 寫進網址，另一段把網址寫進日誌。

## 根本原因

瀏覽器的 WebSocket API 沒辦法在握手時自訂 header。客戶端能控制的只有網址和
`Sec-WebSocket-Protocol` 這份清單，沒有第三個地方。剩下最順手的位置就是網址，程式也就
那樣寫了——這跟「把 API key 放在 query string」是同一個捷徑，那個捷徑常見到自己有一整批
安全建議在講。

再往下一層：登入用的憑證被直接借去跑第二種傳輸，而不是換成一張適合那種傳輸的憑證。一張
本來設計成走 header、因此不會被記錄的 token，被搬到了會被記錄的請求行上，卻沒有換上
「會被記錄的憑證」該有的短效期與一次性。

代價在本機完全看不出來。E2E 的後端是用 `--no-access-log` 跑的，本機開發的日誌又隨著程序
結束就沒了，所以這個外洩只有在「日誌會被保存」的地方才成立——也就是部署環境。

## 影響

- 每握一次手，就有一張 8 小時的管理員憑證被寫進應用日誌；而客戶端斷線後會自動重連，
  所以網路不穩不會讓副本變少，只會讓副本變多。
- 讀得到日誌的人，在 token 過期前都能以該管理員的身分行動：確認排程、開始測試、改治具
  庫存、管理人員。
- 使用者端沒有任何徵兆。沒有東西壞掉，也就沒有東西會提醒任何人去看。
- 外洩範圍是有界的：token 最多八小時就過期，登出則會立刻讓它失效。
- 這裡把嚴重度評為 Medium，是因為這個基線是模擬資料的作品集 Demo，日誌也不是公開的。
  同樣的缺陷發生在真實實驗室，評級要看的是那張憑證的權限而不是 Demo 資料的敏感度，
  應該算 High。

## 解決方式

瀏覽器不再把登入 token 送給 WebSocket。它改成透過本來就已經通過認證的 REST API，把
token 換成一張只夠用一次握手的入場券：

- `POST /api/auth/ws-ticket` 簽發一張 256 位元亂數、有效 30 秒的 ticket。要換這張券
  一樣得通過認證——這個路徑刻意沒有放進 `SKIP_PATHS`。
- 客戶端把 ticket 放進 `Sec-WebSocket-Protocol` 清單，Uvicorn 會把它交給應用程式，但
  不會寫進 access log。伺服器再照 RFC 6455 的要求把接受的 subprotocol 原樣回送一次。
- `consume_ws_ticket` 是**先**在鎖裡把 ticket 拿掉、**再**檢查有沒有過期，所以過期的、
  重放的、兩條連線同時搶同一張的，全部都會把它燒掉。永遠只有一條連得上。

有兩個決定是刻意的：

- **走 subprotocol，不走同源 cookie。** cookie 一樣能讓憑證離開網址，但它會一併帶來
  CSRF 處理與跨站 cookie 設定，換到的保護跟一張 30 秒、用過即廢的 ticket 差不多。
- **ticket 不帶身分。** 舊的握手本來也不帶——它只回傳一個布林值，而這條即時資料對管理員
  和訪客推的是同一份設備清單。把使用者綁進 ticket 等於替這個端點發明一個它從來沒有過的
  權限區分，還會改變誰連得上。訪客現在照樣連得上，本機沒設 `DEMO_PASSWORD` 的情況也是。

這個改法帶來一個附帶的相依：部署環境的反向代理必須把 `Sec-WebSocket-Protocol` 轉過去。
萬一被拿掉，握手會以 4001 直接失敗，所有設備卡會停在 OFFLINE——因為設備即時資料後面沒有
輪詢當後備，所以那是第一次開頁就看得到的明顯失敗，不是安靜壞掉。真的遇到的話，把 ticket
改放回 query string 也是可以接受的：一張 30 秒、用過即廢的 ticket 就算進了日誌也沒有重放
價值，而那正是原本那張 token 危險的地方。

## 驗證方式

```bash
cd backend && ../venv/bin/python -m pytest tests/test_ws_auth.py
make test-e2e ARGS="specs/ws-auth.spec.js"
```

`tests/test_ws_auth.py` 釘住認證邊界：沒有憑證時換券端點回 401、有效的 ticket 會被接受
且 subprotocol 會被回傳、同一張 ticket 第二次就被拒、過期的被拒、`?token=` 的網址直接
被拒，以及八條執行緒同時消耗同一張券時只有一個贏家。

`tests/e2e/specs/ws-auth.spec.js` 補的是後端測不到的部分：它開一個真的 Chromium，斷言
設備連線的網址既沒有登入 token 也沒有任何 query string，而且**真的收得到資料**——所以
瀏覽器如果不接受這種握手，測試會紅，而不是安靜地變成一片空畫面。這條斷言做過反向驗證：
故意把後端的 ticket 前綴改掉，測試就紅；改回來就綠。

沒有涵蓋的部分：Hugging Face 的反向代理會不會轉送 subprotocol。E2E 是直接連 Uvicorn、
中間沒有任何一層，所以這件事要靠部署後打開 Space、看設備卡是不是活的來確認。
