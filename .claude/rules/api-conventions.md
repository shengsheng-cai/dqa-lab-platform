# API 慣例

## 存取控制（2 層）

| 功能 | admin | guest |
|------|-------|-------|
| 所有寫入操作（治具/排程/SOP/採購） | ✅ | ❌ |
| 治具總表/甘特圖 | ✅ | ✅ 唯讀 |
| AI 諮詢/設備查看 | ✅ | ✅ |

新增 API 端點時，寫入操作一律加 `role != "admin"` 檢查。  
唯讀感測器端點（如 `GET /api/devices/{id}/sensor-stats`、`GET /api/devices/{id}/history`）不需 role 檢查，guest 可存取。

### 使用者身份取用

路由 handler 內需要 user_id / username / role 時，統一使用 `current_user(request)` helper（定義於 `auth.py`）：

```python
from .auth import require_admin, current_user

# 單欄位
user_id = current_user(request).user_id

# 多欄位
u = current_user(request)
user_id, role = u.user_id, u.role
```

禁止在路由 handler 直接使用 `getattr(request.state, "user_id", None)` 等原始存取。

## LINE（Push）

- 主動 push 時機（三個）：條件完成（等待人員確認）、測試完成、緊急停止。
  - 條件完成推播：`simulator.py`（sim_phase → done 時）
  - 測試完成推播：`schedules.py` `confirm_condition`
  - 緊急停止推播：`devices.py`
- `push_message` 推播給 `LINE_USER_ID`（管理者個人）。

## Async/Sync 慣例

- 路由 handler 若只做 sync DB 查詢，宣告為 `def`（非 `async def`），FastAPI 自動丟進 threadpool
- 路由 handler 若需要 `asyncio.create_task` / `async with lock` 等 async 原語，才宣告 `async def`
- `async def` 路由內部禁止直接呼叫 sync blocking I/O（SQLAlchemy session 等），需用 `asyncio.to_thread` 包裝

### 正確 pattern（`async def` + DB 寫入）

```python
# 1. 將 DB 邏輯提取到 sync helper，命名慣例 _<動詞>_db(...)
def _do_something_db(param1, param2):
    with SessionLocal() as db:
        ...
        db.commit()
        return result  # 可 raise HTTPException，會被 to_thread 正確傳播

# 2. async 路由用 asyncio.to_thread 呼叫
async def my_route(...):
    result = await asyncio.to_thread(_do_something_db, param1, param2)
    asyncio.create_task(push_message(...))  # async 原語留在路由
    return result
```

實作參考：`sop.py`、`schedules.py`（`_patch_schedule_db` 等）、`devices.py`（`_emergency_stop_db`）、`fixtures.py`（`_run_import_db`）

## Datetime 慣例

- DB 寫入一律用 `_now_utc_naive()`（`utils.py`），保持與 SQLite naive datetime 欄位一致
- `_now_utc()` 只用於 HTTP response、推播文字等不寫入 DB 的場景
- `datetime.datetime.now(datetime.timezone.utc)` 禁止出現在 DB 寫入路徑

## 自動排程邏輯

所有計算邏輯集中在 `schedule_service.py`（service layer），routes 只負責 HTTP 入出。

- 總時長 = 條件時長 + 0.5h 常溫穩定 + 0.5h 條件間緩衝（`_calc_total_hours`）
- 設備選擇：遍歷 CH-01~CH-05，取最早可用（`_auto_assign`）
- 排除超時卡機設備：`est_end` 超過 1h 仍未回 IDLE（`_get_stuck_devices`）
- Fallback：若所有設備都超時，改取全部中最早可用（避免無法申請）
- APScheduler 每 5 分鐘：已確認 → 進行中（自動啟動第一條件）；進行中不再自動完成
- 壞排程收斂：已確認排程若缺設備/條件（永遠無法啟動），`try_start_schedule` 轉「異常」並寫 audit、停止重試（`_mark_schedule_error_db`）；設備忙碌屬暫時性，仍維持已確認重試
- 條件銜接由人員在排程頁面手動確認（`POST /api/schedules/{id}/confirm-condition`）
