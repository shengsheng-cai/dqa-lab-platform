# CLAUDE.md — DQA Lab Platform

規則都在 `.claude/rules/`。**動到對應範圍前先讀該檔**，不要憑印象改。

| 檔案 | 什麼時候讀 |
|---|---|
| `.claude/rules/state-machine.md` | 動設備狀態、sim_phase、模擬器、採購單狀態 |
| `.claude/rules/api-conventions.md` | 新增／修改 API、權限、async/sync、datetime 寫入、排程邏輯、治具借還、稽核埋點、LINE 推播 |
| `.claude/rules/frontend.md` | 動 `client/` 任何檔案 |
| `.claude/rules/testing.md` | 寫或改測試、動 `models.py` 或資料庫 schema |
| `.claude/rules/qa-documentation.md` | 動 QA 策略、風險計畫、追溯表、缺陷案例或 README 的 QA 證據 |

個人覆蓋設定與待補清單在 `CLAUDE.local.md`（gitignored）。
