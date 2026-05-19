請幫我執行 Alembic 資料庫遷移。

步驟：
1. 詢問我遷移描述（中文即可，例如「新增 xxx 欄位」）
2. 用中文說明即將執行的指令，等我確認
3. 執行：`cd backend && ../venv/bin/alembic revision --autogenerate -m "描述"`
4. 執行：`cd backend && ../venv/bin/alembic upgrade head`
5. 確認遷移成功，列出生成的 migration 檔案名稱
