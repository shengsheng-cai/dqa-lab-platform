# API 慣例

## 存取控制（2 層）

| 功能 | admin | guest |
|------|-------|-------|
| 所有寫入操作（治具/排程/SOP/採購/維護校驗） | ✅ | ❌ |
| 治具總表/甘特圖 | ✅ | ✅ 唯讀 |
| AI 諮詢/設備查看 | ✅ | ✅ |

新增 API 端點時，寫入操作一律使用 `Depends(require_admin)`；不要在路由內手動比較角色。
唯讀感測器端點（如 `GET /api/devices/{id}/sensor-stats`、`GET /api/devices/{id}/history`）不需 role 檢查，guest 可存取。

### WebSocket 憑證不放網址

網址會被 Uvicorn 的 access log 原樣記下來，長效 token 進了日誌就能被撿去重放（BUG-011）。
瀏覽器又沒辦法在 WebSocket 握手時自訂 header，所以走這條路：

- 前端先打 `POST /api/auth/ws-ticket`（要通過一般認證），換一張 30 秒、用過即廢的 ticket
- 再把 ticket 放進握手的 `Sec-WebSocket-Protocol`，後端收下後原樣回送
- `consume_ws_ticket` 是先拿掉再檢查有效期，所以過期、重放、同時搶同一張都只會有一個贏家

新增 WebSocket 端點沿用這套，不要為了方便把憑證接回 query string。

### 使用者身份取用

**新增**的管理者寫入端點從 `require_admin` dependency 取得已驗證的 actor；同一個
dependency 同時回答「可不可以寫」與「是誰在寫」，供業務資料與 audit 共用：

```python
from .auth import require_admin

def admin_write(body, actor=Depends(require_admin)):
    user_id, role = actor.user_id, actor.role
```

既有端點多數寫成 `_: None = Depends(require_admin)` 再 `current_user(request)` 取身分。
兩者結果相同（`require_admin` 內部就是呼叫 `current_user`），沒有使用者可見差異，
因此**不做機械式全面遷移**；改到哪個檔案就順著那個檔案原本的寫法，不要為了統一而動別的端點。

非管理者端點若只需要讀取目前身分，使用 `current_user(request)` helper（定義於
`auth.py`）：

```python
from .auth import current_user

u = current_user(request)
user_id, role = u.user_id, u.role
```

禁止在路由 handler 直接使用 `getattr(request.state, "user_id", None)` 等原始存取。

### 稽核寫入

稽核日誌一律走 `audit_log.py` 的共用 helper，不要各模組自己組 `AuditLog`；關鍵業務寫入都要埋點。

## LINE

LINE 有兩條方向相反的路，不要混用：主動推播用 `push_message`（PUSH_URL），
回覆使用者訊息用 `_send_to_line`（REPLY_URL，需要 `reply_token`）。

### Push（主動推播）

- 主動 push 時機（三個）：條件完成（等待人員確認）、測試完成、緊急停止。
  - 條件完成推播：`simulator.py`（sim_phase → done 時）
  - 測試完成推播有**兩個**發送點，依測試是否掛排程分流，不會同時發：
    - 有排程：`schedules.py` `confirm_condition`（人員確認條件完成後）
    - 無排程的臨時測試：`sop.py` `create_execution`（存執行紀錄時）
  - 緊急停止推播：`devices.py`
- `sop.py` 那個發送點被 `manual_mode` 擋掉：手動模式是除錯用，完全不推播，避免消耗
  免費額度（200 則／月）。前端建立執行紀錄時**一定要送 `manual_mode`**，漏送會被
  當成一般測試而推播出去（BUG-007 就是漏送造成的）。前端存執行紀錄的兩條路徑
  （SOP 面板按儲存、設備回到待機時補存）一律用 `client/src/utils/executionPayload.js`
  的 `buildExecutionPayload` 組出要送的內容，不要在呼叫點自己組——這個欄位的保證只有
  那一份，`client/src/__tests__/executionPayload.test.js` 逐欄位釘著它。
- `push_message` 推播給 `LINE_USER_ID`（管理者個人）。

### Webhook（使用者查詢設備）

`POST /webhook`（`line.py`）是**全專案唯一不經 `require_admin`、由外部直接呼叫**的端點，
不出現在 `/docs`（`include_in_schema=False`）。改這段要注意四件事：

- **簽章驗證不能拿掉**：`_verify_signature` 用 `LINE_CHANNEL_SECRET` 做 HMAC-SHA256，
  比對 `X-Line-Signature` header，不符就 400。
- **沒設 `LINE_CHANNEL_SECRET` 時會直接放行**（`return True`）。本機與 Demo 環境多半沒設，
  所以「本機測起來過」不代表驗證有效；要驗這段一定要先設 secret，否則測到的是放行分支。
- **回覆一律丟 `background_tasks`**，webhook 本身立刻回 200——LINE 要求快速回應，
  在 handler 裡等 API 回來會逾時。
- **只讀 `app.state.AICM_CACHE`，不查 DB**。指令由 `_dispatch_command` 解析：
  「狀態／status／s」回設備概覽，輸入設備 ID 回該機的 flex 詳情卡。

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

實作參考：`sop.py`、`schedules.py`（`_patch_schedule_db` 等）、`fixture_excel.py`（`_run_import_db`）。設備狀態寫入則一律呼叫 `DeviceStateManager` 的五個 async 動詞，由 manager 在內部持 lock 並用 `asyncio.to_thread` 落盤。

## Datetime 慣例

- DB 寫入一律用 `_now_utc_naive()`（`utils.py`），保持與 SQLite naive datetime 欄位一致
- `_now_utc()` 只用於 HTTP response、推播文字等不寫入 DB 的場景
- `datetime.datetime.now(datetime.timezone.utc)` 禁止出現在 DB 寫入路徑
- **外部送進來的時間**（request body、query 參數）寫進 DB 前一律過 `_to_naive_utc()`
  （`utils.py`），不要直接寫。它把帶時區的換算成 UTC 再去掉時區，已經是 naive 的原樣
  放行。直接寫的話 SQLAlchemy 會無聲丟掉時區：目前前端送的都是 UTC，丟掉剛好等於正確
  答案，但哪天改送本地時間就會差幾小時，而且完全不會報錯。收外部時間的端點有 SOP
  執行紀錄、封鎖時段、排程時段、治具借出與延期、設備校驗與維護，整類由
  `backend/tests/test_datetime_normalization.py` 釘住
- `_to_naive_utc()` 只救得了「有帶時區但不是 UTC」。**不帶時區的本地時間救不了**——
  伺服器無從得知客戶端在哪一時區，所以前端送時間一定要帶 `Z` 或 offset
- 唯一例外是 device state cache 的 `started_at`：cache 保留 aware UTC 供 API／排程計算，所有狀態動作都經 `DeviceStateManager._persist`，再由模組內的 `_save` 正規化成 naive UTC 後落盤。同 transaction 的 `SopExecution.test_started_at` 由**同一個瞬間**去掉時區得到（`started_at.replace(tzinfo=None)`），不另外呼叫 `_now_utc_naive()`——測試結束後 SOP 頁面存的那列要靠這個時間戳認回開始那列來繼承案件（`sop.py` 的 `_find_origin_schedule_id_db`），各自取 now() 會差幾微秒而認不回來

## 自動排程邏輯

所有計算邏輯集中在 `schedule_service.py`（service layer），routes 只負責 HTTP 入出。

- 總時長 = 條件時長 + 0.5h 常溫穩定 + 0.5h 條件間緩衝（`_calc_total_hours`）
- 設備選擇：遍歷 CH-01~CH-05，取最早可用（`_auto_assign`）
- 排除超時卡機設備：`est_end` 超過 1h 仍未回 IDLE（`_get_stuck_devices`）；降溫收尾中的設備估算永遠落在未來，不會被判成卡機
- Fallback：若所有設備都超時，改取全部中最早可用（避免無法申請）
- 未來的已確認排程以 `sched_{id}` APScheduler date job 精確啟動；確認或修改設備／時段時都用 `replace_existing=True` 更新同一 job
- 每 5 分鐘 fallback 只補抓漏觸發或當時被暫時阻擋的排程；進行中不再自動完成
- 單一啟動入口：APScheduler、fallback、立即開始、PATCH→RUNNING、吻合的手動 SOP、條件銜接一律呼叫 `start_schedule(schedule_id, actor, states)`，caller 不得自行傳入設備或條件快照
- 啟動結果使用 `ScheduleStartResult`，由 `STARTED`、`DEVICE_BUSY`、`UNDER_MAINTENANCE`、`BROKEN` 等 code 表達原因；route 不得重新查 DB/cache 猜原因
- 原子啟動：DeviceState、SopExecution、Schedule、FixtureLoan、AuditLog 在同一 transaction 寫入，commit 成功後才發布 cache
- 壞排程收斂：排程若缺設備、條件或法規資料，`start_schedule` 轉「異常」、釋放治具並寫 audit、停止重試；設備忙碌與維護屬暫時性，維持原狀
- 手動 ad-hoc SOP 只可認領「已到開始時間且目前條件相同」的已確認排程；未來或條件不同的排程不得異動
- 條件銜接由人員在排程頁面確認後，再由同一個 `start_schedule(..., continuation=True)` 啟動下一條件

## 治具生命週期

- 治具庫存唯一 owner 是 `fixture_lifecycle.py`：可借量公式與借還狀態轉換只有這一份
- 排程與治具靠 `schedule_fixtures` 中間表 + `fixture_loans.schedule_id` 外鍵串起來
- 狀態流：排程確認 → 預約（reserved）→ 測試開始 → 借出（loaned）→ 測試完成 → 歸還
- 排程走到終止狀態（取消／異常／刪除）一律走 `_release_schedule_fixtures`：預約的丟掉、借出中的歸還並記時間；測試完成時同樣自動歸還
