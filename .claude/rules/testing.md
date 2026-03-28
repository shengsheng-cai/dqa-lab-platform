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

- 不使用 mock，測試直接對 in-memory DB 操作
- 避免 mock/prod 行為不一致的問題
