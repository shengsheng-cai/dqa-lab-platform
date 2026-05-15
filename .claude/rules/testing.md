# 測試規範

## Shell 測試腳本

- 測試指令一律寫成 `.sh` 腳本，放在專案根目錄的 `tests/` 資料夾
- 不要貼 curl 指令列表，讓使用者自己複製貼上
- 新增腳本後，同步加入 `.claude/settings.json` 的 allow 清單：`"Bash(bash tests/腳本名.sh)"`

## Backend 單元測試（pytest）

- 測試檔放在 `backend/tests/`
- 執行：`cd backend && python -m pytest`
- conftest.py 使用 in-memory SQLite，測試間互相隔離

## 資料庫

- 測試直接對 in-memory SQLite 操作，避免 mock/prod 行為不一致
- 例外：`SessionLocal` 可用 `patch` 注入 in-memory session（`test_linkage.py` 的做法），DB 本身仍用真實資料

## Frontend 單元測試（Vitest）

- 測試檔放在 `client/src/__tests__/`，命名 `*.test.js`
- 執行：`cd client && npm test`（`vitest run`）；監看模式：`npm run test:watch`
- 測試目標：純邏輯的 utility 函式（`errorMessages.js`、`timezone.js`、`download.js`）
- 不測 React 元件渲染（無 jsdom 設定）；元件正確性透過瀏覽器手動驗證
