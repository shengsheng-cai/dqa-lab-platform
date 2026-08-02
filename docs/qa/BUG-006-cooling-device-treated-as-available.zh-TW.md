# BUG-006 — 還在回常溫的試驗箱被當成可以立即排程

[English](BUG-006-cooling-device-treated-as-available.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-006 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | 自動排程的設備可用時間估算 — `FINISHING` 設備狀態 |
| **環境** | FastAPI 後端、模擬器 Demo 基準；任何會中途停止測試或解除緊急停止的部署 |
| **發現方式** | 狀態機主幹審查，2026-07-31（讀 `device_state.py`、`schedule_service.py`、`simulator.py`） |
| **回報者** | 蔡聖生 |
| **修正 commit** | `86e7faac29ec7e0fc2ac95c21437b639b797caa2` |

## 摘要

有兩個地方在回答「這台試驗箱什麼時候空出來」，而且只要設備處於 `FINISHING`，
兩者的答案就不一致。

設備卡是從當前溫度推算剩餘的降溫時間，這是對的。排程器卻沿用 `occupied_end`，
它算的是「`started_at` + 完整溫度曲線 + 30 分鐘常溫穩定」——也就是「假設這個測試
有跑完的話」會結束的時間。對一台只是在降溫的設備而言，那是錯的量，而且兩個方向
都會出錯。

## 受影響的路徑

| 路徑 | 錯誤行為 |
|---|---|
| `schedule_service.py` — `_est_end_from_device`，由 `_build_running_until` 與 `_get_stuck_devices` 使用 | `FINISHING` 被導向 `occupied_end`。測試中途取消之後，估算會以為整條曲線還要重跑，把占用時間高估數小時。緊急停止之後它什麼都回不出來，設備就被當成空閒 |
| `devices.py` — `_calc_estimated_end_at` | 它本身是對的，但它的 `FINISHING` 分支是一份私有的複製品。沒有任何機制讓兩個呼叫端保持同步 |

## 前置條件

- 設備處於 `FINISHING`，可能是停止一個進行中的測試、或是以正常停止解除緊急停止
  而進入的。
- 在該設備還在降溫的期間，送出一筆使用自動選機的新排程。

## 在修正前的版本上重現

1. 在 CH-01 上啟動一個高溫測試，讓它達到設定點。
2. 觸發緊急停止，再按正常停止，讓設備進入 `FINISHING`。
3. 在 CH-01 還在降溫時，送出一筆新排程並讓系統自動指派設備。
4. 在甘特圖上讀取被指派的設備與開始時間。

## 預期結果

不論選到哪一台設備，新排程都不應該被排在 CH-01 抵達常溫之前。

## 實際結果

CH-01 被選中，開始時間設成當下。排程停在「已確認」，每五分鐘的兜底掃描都以
`DEVICE_BUSY` 拒絕它，而甘特圖上那根長條顯示的是一個早就過去的開始時間。UI 上
沒有任何東西解釋這個延遲。

## 證據

- 排程器的估算：[`schedule_service.py`](../../backend/app/schedule_service.py)
  （`_build_running_until`、`_get_stuck_devices`、`_auto_assign`）。
- 設備卡的估算：[`devices.py`](../../backend/app/devices.py)
  （`_calc_estimated_end_at`）。
- 緊急停止時的欄位清除：[`device_state.py`](../../backend/app/device_state.py)
  （`emergency`）。
- 共用的估算函式：[`utils.py`](../../backend/app/utils.py)
  （`device_free_at`、`finishing_end`、`ramp_rate_from_sop`）。
- 回歸測試：[`test_utils.py`](../../backend/tests/test_utils.py) 與
  [`test_schedules_complete.py`](../../backend/tests/test_schedules_complete.py)。

## 根因

`emergency()` 在設備進入 `EMERGENCY` 的當下就清掉 `started_at` 與
`active_sop_json`。那正是 `occupied_end` 需要的兩個欄位，所以後續執行正常停止之後，
它沒有東西可以計算，只能回傳 `None`。而 `_est_end_from_device` 把 `None` 讀成
「這台設備沒有被占用」。

附近的守衛也補不了這個洞。`_get_stuck_devices` 同樣要先有估算值才能判斷，所以估算
缺席時它會安靜地跳過。`_get_emergency_devices` 也對不上，因為那時狀態早就從
`EMERGENCY` 走到 `FINISHING` 了。

在這個具體失敗底下，真正的缺陷是：「哪個狀態該用哪種估算」以兩份彼此獨立的複製品
存在。`occupied_end` 自己的 docstring 就記載了 `FINISHING` 這個特例屬於呼叫端負責，
而兩個呼叫端裡只有一個真的實作了它。這與當初導入 `curve_total_minutes` 所要收斂的
「重複的溫度曲線計算」是同一類缺陷。

## 影響

- 自動選機可能把排程放到一台實體上根本無法啟動、還要等上一兩個小時的試驗箱。排程
  不會遺失——兜底機制會在設備回到 IDLE 後啟動它——但它的計畫時間是錯的、甘特圖是
  錯的，而該設備之後算出來的每一個時段都繼承了這個錯誤。
- 反方向也一樣：一個剛啟動不久就被取消的測試，會讓它的設備被標記為占用整個原始
  時長，於是自動選機跳過了一台其實即將空出來的試驗箱。
- 沒有影響到已存下的資料。兩個失敗都發生在估算上，所以沒有任何歷史紀錄需要更正。

## 解法

- `device_free_at()` 現在擁有「設備狀態 → 用哪個估算」這份對應表。設備卡與排程器
  都呼叫它，兩者不可能再各自漂走。
- `finishing_end()` 從當前溫度與降溫速率估算 `FINISHING`。當 SOP 資料已經被清掉時，
  它退回 1 °C/min，讓答案永遠落在未來，而不是塌陷成「現在就空著」。
- `ramp_rate_from_sop()` 是降溫速率的唯一來源，與實際執行降溫的模擬器共用，所以
  模擬的降溫與對該降溫的估算讀的是同一個數字。
- `FINISHING` 現在在結構上就被排除在卡機偵測之外，因為它的估算永遠在未來。那道
  守衛本來就只是為了抓「早該結束卻還沒回到 IDLE」的設備；這個排除同時記錄在
  `_get_stuck_devices` 與 `.claude/rules/api-conventions.md` 裡。

## 驗證

```bash
cd backend && ../venv/bin/python -m pytest tests/test_utils.py tests/test_schedules_complete.py -v
```

`test_est_end_finishing_after_emergency_is_not_treated_as_free` 對修正前的行為具有
鑑別力：在舊程式上估算會是 `None`，所以「等於 now + 60 分鐘」這個斷言會失敗，而不
是僥倖通過。`test_build_running_until_includes_finishing_device` 涵蓋的是上一層的
後果——降溫中的設備必須出現在 `_find_earliest_slot` 讀取的占用表裡。

RUNNING 與 PAUSED 的估算沒有被動到：`occupied_end` 的本體維持不變，既有的暫停測試
仍然斷言相同的值。
