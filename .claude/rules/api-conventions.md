# API 慣例

## 存取控制（4 層）

| 功能 | admin | keeper | engineer | guest |
|------|-------|--------|----------|-------|
| 治具借出/盤點 | ✅ | ✅ | ❌ | ❌ |
| 排程確認（審核） | ✅ | ❌ | ❌ | ❌ |
| 申請排程 | ✅ | ✅ | ✅ | ❌ |
| 取消自己待審核排程 | ✅ | ✅ | ✅ | ❌ |
| 治具總表/甘特圖 | ✅ | ✅ | ✅ | ✅ 唯讀 |
| AI 諮詢/設備查看 | ✅ | ✅ | ✅ | ✅ |

新增 API 端點時，依照以上表格在 `auth.py` 加上對應的 role 檢查。

## LINE（Query + Emergency Push）

- Webhook 採 **query 模式**：使用者在群組或私訊傳 `狀態`、`CH01~CH05`、`幫助`，Bot 即時 reply。
- 主動 push 目前只保留 **緊急停止**（`devices.py` 呼叫 `push_message`）。
- `push_message` 同時推播給 `LINE_USER_ID`（管理者個人）+ `LINE_GROUP_ID`（指定通知群組，選填）。
- 其他 SOP/phase 自動推播已停用（v40 簡化），若未來重啟，需同步更新此文件與 `CLAUDE.local.md`。

## 自動排程邏輯

- 總時長 = 條件時長 + 0.5h 常溫穩定 + 0.5h 條件間緩衝
- 設備選擇：遍歷 CH-01~CH-05，取最早可用
- 排除超時卡機設備：`est_end` 超過 1h 仍未回 IDLE
- Fallback：若所有設備都超時，改取全部中最早可用（避免無法申請）
- APScheduler 每 5 分鐘自動推進排程狀態（已確認→進行中→已完成）
