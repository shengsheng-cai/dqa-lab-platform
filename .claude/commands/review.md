請審查目前的修改，然後再 commit。

步驟：
1. 執行 `git diff` 查看所有未暫存的修改
2. 執行 `git diff --staged` 查看已暫存的修改
3. 逐一檢查：
   - 是否有遺漏的 TODO 或 debug print
   - 新的 API 端點是否有加 role 檢查
   - 狀態機轉換是否符合 @.claude/rules/state-machine.md
   - 前端佈局是否符合 @.claude/rules/frontend.md 的限制
4. 列出發現的問題（若無則說「看起來沒問題」）
5. 詢問是否要繼續 commit
