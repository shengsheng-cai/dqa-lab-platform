# API 慣例

## 存取控制（2 層）

| 功能 | admin | guest |
|------|-------|-------|
| 所有寫入操作（治具/排程/SOP/採購） | ✅ | ❌ |
| 治具總表/甘特圖 | ✅ | ✅ 唯讀 |
| AI 諮詢/設備查看 | ✅ | ✅ |

新增 API 端點時，寫入操作一律加 `role != "admin"` 檢查。  
唯讀感測器端點（如 `GET /api/devices/{id}/sensor-stats`、`GET /api/devices/{id}/history`）不需 role 檢查，guest 可存取。

## LINE（Push）

- 主動 push 時機（三個）：條件完成（等待人員確認）、測試完成、緊急停止。
  - 條件完成推播：`simulator.py`（sim_phase → done 時）
  - 測試完成推播：`schedules.py` `confirm_condition`
  - 緊急停止推播：`devices.py`
- `push_message` 推播給 `LINE_USER_ID`（管理者個人）。

## 自動排程邏輯

所有計算邏輯集中在 `schedule_service.py`（service layer），routes 只負責 HTTP 入出。

- 總時長 = 條件時長 + 0.5h 常溫穩定 + 0.5h 條件間緩衝（`_calc_total_hours`）
- 設備選擇：遍歷 CH-01~CH-05，取最早可用（`_auto_assign`）
- 排除超時卡機設備：`est_end` 超過 1h 仍未回 IDLE（`_get_stuck_devices`）
- Fallback：若所有設備都超時，改取全部中最早可用（避免無法申請）
- APScheduler 每 5 分鐘：已確認 → 進行中（自動啟動第一條件）；進行中不再自動完成
- 條件銜接由人員在排程頁面手動確認（`POST /api/schedules/{id}/confirm-condition`）
