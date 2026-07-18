# 測試規範

## Shell 測試腳本

- 測試指令一律寫成 `.sh` 腳本，放在專案根目錄的 `tests/` 資料夾
- 不要貼 curl 指令列表，讓使用者自己複製貼上
- 新增腳本後，同步加入 `.claude/settings.json` 的 allow 清單：`"Bash(bash tests/腳本名.sh)"`

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
