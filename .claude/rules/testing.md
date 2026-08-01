# 測試規範

## Shell 測試腳本

- 不要貼一串 curl 指令讓使用者自己複製貼上；要重複跑的驗證一律寫成 `.sh` 腳本放 `tests/`
- 新增腳本後，同步加入 `.claude/settings.json` 的 allow 清單：`"Bash(bash tests/腳本名.sh)"`
- `tests/e2e/` 就是照這條規則長出來的，可當範本
- 一次性的探索腳本不算「要重複跑的驗證」，寫在暫存目錄跑完就丟，不要留在 `tests/`

## E2E 瀏覽器測試（Playwright）

執行：`make test-e2e`（**不需要先 `make dev`**，它自己會開測試後端）。
加參數用 `ARGS=`，例如 `make test-e2e ARGS="--headed"` 開視窗看它在點什麼。

- 測試檔放 `tests/e2e/specs/*.spec.js`，共用程式放 `tests/e2e/helpers/`
- Playwright 鎖在 `tests/e2e/package.json`（目前 1.61.1），用它自帶的 Chromium，不是系統上的瀏覽器
- 臨時探索腳本走另一個指令 `make test-e2e-script SCRIPT=...`，那個跑的是**開發環境的真實資料**，別跟正式套件搞混

### 寫新測試檔一定要做的事

```js
import { resetBackend } from "../helpers/backend.js";
test.beforeAll(resetBackend);   // 少了這行，這個檔案會跑在上一個檔案的殘留狀態上
```

後端不是靜態的：模擬器每秒寫感測資料、推設備狀態機，排程也會自己往前跑。
所以每個測試檔都要自己重灌資料庫、重開後端。忘了寫不會報錯，只會變成偶爾紅一次的鬼故事。

登入用 `helpers/login.js`：管理員 `loginAsAdmin(page)`、訪客 `loginAsGuest(page)`，不要每個檔案自己填帳密。

### 已經踩過的坑，不要再踩

- **不平行跑、失敗不 retry**（`playwright.config.js` 已設定）。後端有共用狀態，平行會互相踩；用 retry 蓋過去只會養出爛測試
- **測試環境和開發環境完全分開**：port 8100、資料庫 `/tmp/dqa-e2e.db`、假帳密。前端 build 到 `client/dist-e2e`，**不要改用 `client/dist`**——那個會被 `make dev` 蓋成 HF 預覽版，測試會安靜地連到別的後端
- **殺程序一定要加 `lsof -sTCP:LISTEN`**。不加會連「連到這個 port 的客戶端」一起列出來，包括 Playwright 自己，結果測試把自己殺掉
- **登入連錯 5 次會鎖 IP 10 分鐘**（記憶體計數）。寫負向測試時小心，每個測試檔重開後端剛好會清掉
- **訪客相關測試**要設 `DEMO_PASSWORD`，沒設後端會直接放行、測起來是假的。`loginAsGuest` 拿這個 master key 直接進，不用先開訪客 token
- **Toast 和 Modal 都有 ✕ 關閉鈕**，用 `getByRole('button',{name:'✕'})` 會 strict-mode 撞名（畫面上同時有兩顆）。要關某個 modal，就把定位 scope 在那個 modal 裡（toast 不在 modal 的 DOM 子樹），別在整頁找 ✕。
- 定位優先用畫面文字，前端目前沒有 test id

## Backend 單元測試（pytest）

- 測試檔放在 `backend/tests/`
- 執行：`cd backend && python -m pytest`
- conftest.py 使用 in-memory SQLite（StaticPool，跨執行緒共用同一個 DB），測試間互相隔離
- 共用 fixture：`db`（單一 session）、`api_client`（掛 router 的 TestClient + 角色注入）、`patched_session`（一次 patch 多個模組的 SessionLocal）
- 跨模組寫 DB 的流程（如啟動排程會動到 schedule_service / sop / device_state / utils / schedules）一律用 `patched_session` 把相關模組一次 patch 完——漏一個那模組就會寫進真實的 aicm.db
- **唯一的例外是 `test_schema_migrations.py`**：它要驗 Alembic 真的跑得動，得對檔案型 SQLite 下 DDL，in-memory 那顆引擎進不去；而且指定 DB 位置不能用 `patched_session`——`alembic/env.py` 是自己 `from app.models import SQLALCHEMY_DATABASE_URL` 再塞進 `sqlalchemy.url`，所以要蓋的是那個常數（另加 `DATABASE_URL` 當第二道保險）。新增測試不要照抄這個寫法，除非同樣是在驗 migration 本身

## 資料庫

- 測試直接對 in-memory SQLite 操作，避免 mock/prod 行為不一致
- 跨模組流程用共用 `patched_session` 注入 in-memory session（參考 `test_schedule_start_consistency.py`），DB 本身仍走真實 SQLAlchemy 行為
- schema 的權威只有 Alembic（見 `CLAUDE.md`）：`test_schema_migrations.py` 在暫存 DB 實跑整條 migration chain，再比對 model 的每張表與每個欄位。加欄位只改 model、忘了寫 migration 會直接紅

## Frontend 單元測試（Vitest）

- 測試檔放在 `client/src/__tests__/`，命名 `*.test.js`
- 執行：`cd client && npm test`；監看模式：`npm run test:watch`。**一律走 npm script**，不要直接跑 `npx vitest run`——時區是釘在 script 上的（見下）
- 測試目標：**純邏輯**的 utility 函式 —— `errorMessages.js`、`timezone.js`、`validation.js`、`download.js` 的 `buildReportFilename`
- 碰 DOM 或網路的不測（如 `download.js` 的 `downloadBlob`，它建 `<a>` 點下去）；React 元件渲染也不測（無 jsdom 設定），元件正確性透過瀏覽器手動驗證
- 時區固定在 `Asia/Taipei`，釘在 `package.json` 的 test script（`TZ=...` 前綴）。`formatLocal` / `parseDateOnlyLocal` 的正確性就是「UTC 轉本地」，不釘的話本機（+08）跟 CI（UTC）會得到不同字串。`vite.config.js` 的 `test.env.TZ` 是給繞過 npm script 的跑法補的，但它只在 vitest 預設的 forks 模式有效，別把它當唯一保險。`timezone.test.js` 第一條就在確認時區，它紅了代表釘子鬆了，去修釘子、不要改後面的期望值
- `Intl` 輸出的日期時間分隔符不是一般空格（目前 ICU 是 U+2009），且會隨 Node 版本變。斷言前先用 `s.replace(/\s/g, " ")` 正規化，不然會出現「看起來一模一樣卻不相等」的紅字
- **不要順手升 CI workflow 裡的 `node-version`**。時區測試斷言了 `Intl` 的輸出字串，而那字串綁在 Node 內建的 ICU 版本上（目前 CI 的 Node 24 是 ICU 78.3、開發機的 Node 25 是 78.2，兩邊輸出相同才對得上）。真要升，先在暫存目錄下載目標版本跑一次 `npm test`，綠了才改 workflow；紅了代表期望字串要重新確認，不是改斷言了事。這跟「升 GitHub Action 版本」是兩回事，別混在一起改
- 判斷一支 utility 有沒有人用，不能只 grep 原名：`constants.js` 會把 `parseUTC` 改名成 `parseUtcDate` 再轉出去。要連別名一起找，確認真的零引用才動它
