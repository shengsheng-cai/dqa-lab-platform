# 測試規範

## Shell 測試腳本

- 測試指令一律寫成 `.sh` 腳本，放在專案根目錄的 `tests/` 資料夾
- 不要貼 curl 指令列表，讓使用者自己複製貼上
- 新增腳本後，同步加入 `.claude/settings.json` 的 allow 清單：`"Bash(bash tests/腳本名.sh)"`

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

登入用 `helpers/login.js` 的 `loginAsAdmin(page)`，不要每個檔案自己填帳密。

### 已經踩過的坑，不要再踩

- **不平行跑、失敗不 retry**（`playwright.config.js` 已設定）。後端有共用狀態，平行會互相踩；用 retry 蓋過去只會養出爛測試
- **測試環境和開發環境完全分開**：port 8100、資料庫 `/tmp/dqa-e2e.db`、假帳密。前端 build 到 `client/dist-e2e`，**不要改用 `client/dist`**——那個會被 `make dev` 蓋成 HF 預覽版，測試會安靜地連到別的後端
- **殺程序一定要加 `lsof -sTCP:LISTEN`**。不加會連「連到這個 port 的客戶端」一起列出來，包括 Playwright 自己，結果測試把自己殺掉
- **登入連錯 5 次會鎖 IP 10 分鐘**（記憶體計數）。寫負向測試時小心，每個測試檔重開後端剛好會清掉
- **訪客相關測試**要設 `DEMO_PASSWORD`，沒設後端會直接放行、測起來是假的；另需先開一張訪客 token
- 定位優先用畫面文字，前端目前沒有 test id

## Backend 單元測試（pytest）

- 測試檔放在 `backend/tests/`
- 執行：`cd backend && python -m pytest`
- conftest.py 使用 in-memory SQLite（StaticPool，跨執行緒共用同一個 DB），測試間互相隔離
- 共用 fixture：`db`（單一 session）、`api_client`（掛 router 的 TestClient + 角色注入）、`patched_session`（一次 patch 多個模組的 SessionLocal）
- 跨模組寫 DB 的流程（如啟動排程會動到 schedule_service / sop / utils / schedules）一律用 `patched_session` 把相關模組一次 patch 完——漏一個那模組就會寫進真實的 aicm.db

## 資料庫

- 測試直接對 in-memory SQLite 操作，避免 mock/prod 行為不一致
- 例外：`SessionLocal` 可用 `patch` 注入 in-memory session（`test_linkage.py` 的做法），DB 本身仍用真實資料

## Frontend 單元測試（Vitest）

- 測試檔放在 `client/src/__tests__/`，命名 `*.test.js`
- 執行：`cd client && npm test`（`vitest run`）；監看模式：`npm run test:watch`
- 測試目標：純邏輯的 utility 函式（`errorMessages.js`、`timezone.js`、`download.js`）
- 不測 React 元件渲染（無 jsdom 設定）；元件正確性透過瀏覽器手動驗證
