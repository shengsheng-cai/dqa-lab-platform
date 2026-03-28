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

## LINE 推播（5 時機）

| 時機 | 觸發位置 | 收件人 |
|------|---------|--------|
| 啟動測試 | sop.py → push_sop_notification | operator（個人優先，fallback 群組） |
| 進入 dwell_high | data_simulator() phase 轉換 | operator |
| 進入 ramp_to_ambient | data_simulator() phase 轉換 | operator |
| 緊急停止 | main.py emergency_stop | operator |
| 降溫完成（回 IDLE） | data_simulator() FINISHING→IDLE | operator |

新增通知邏輯時，推播失敗要寫入 notification_failures 表，不可直接 raise。

## 自動排程邏輯

- 總時長 = 條件時長 + 0.5h 常溫穩定 + 0.5h 條件間緩衝
- 設備選擇：遍歷 CH-01~CH-05，取最早可用
- 排除超時卡機設備：`est_end` 超過 1h 仍未回 IDLE
- Fallback：若所有設備都超時，改取全部中最早可用（避免無法申請）
- APScheduler 每 5 分鐘自動推進排程狀態（已確認→進行中→已完成）
