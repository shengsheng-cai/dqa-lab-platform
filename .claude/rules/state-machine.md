# 狀態機規則

## 設備狀態

```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
  │       └───────────────→ IDLE  （自然完成：回常溫後再穩定 30 分鐘）
  └──────────────→ EMERGENCY → FINISHING → IDLE
```

- 只有 IDLE 狀態的設備才能啟動新的 SOP
- FINISHING 完成後自動回到 IDLE
- 緊急停止（emergency_stop）可從任何非 EMERGENCY 狀態進入 EMERGENCY，觸發 LINE 推播
- EMERGENCY 需經正常停止進入 FINISHING，降回常溫後才回 IDLE
- RUNNING 的測試自然完成時，simulator 走完 `ramp_to_ambient` 回常溫、再經 `stabilize` 穩定 30 分鐘到 `done`，此時已在常溫，由 `advance(complete=True)` 原子清回 IDLE（期間全程維持 RUNNING、設備仍占用）
- 所有狀態轉換只走 `DeviceStateManager` 的五個動詞：`start`、`finish`、`pause`、`emergency`、`advance`
- 排程啟動一律走 `schedule_service.start_schedule`；不得由 route 先改排程狀態再另外啟動設備

## 模擬相位（sim_phase）

主線（雙溫度、多循環的完整路徑）：

```
idle → ramp_to_low → ramp_to_high → dwell_high → ramp_to_low2 → dwell_low → ramp_to_ambient → stabilize → done
                          ↑                                         │
                          └────────── 還有 cycle 就繞回 ─────────────┘
```

**這不是一條直線，有三個分岔和一個迴圈**（`simulator.py`）：

- 起點看低溫設定：`low_temp` 有設且低於常溫才進 `ramp_to_low`，否則直接 `ramp_to_high`
- `ramp_to_low` 有可能直接跳到 `dwell_high`，不一定經過 `ramp_to_high`
- `dwell_high` 之後只有雙溫度才進 `ramp_to_low2`；單溫度直接進 `ramp_to_ambient` 收尾
- **迴圈**：`dwell_low` 結束時若 `sim_cycle < cycles`，回到 `ramp_to_high` 重跑下一個循環，跑完才進 `ramp_to_ambient`

其餘規則：

- RUNNING 內自然完成：`ramp_to_ambient` 回到常溫後，再經 `stabilize`（常溫穩定 30 分鐘，`STABILIZATION_MINUTES`，期間設備仍占用）才回 IDLE，不在回常溫瞬間就 IDLE
- 常溫穩定時間三處共用：設備卡 estimated_end、排程器占用表、模擬器 `stabilize` 相位一律以「曲線 + 30 分鐘」為真正可再用時間
- 「設備何時空出來」只有 `device_free_at`（`utils.py`）這一份對應表：RUNNING/PAUSED 走 `occupied_end`（曲線 + 常溫穩定 + 暫停），FINISHING 走 `finishing_end`（從當前溫度降回常溫，不是整條曲線重跑）。設備卡與排程器共用它，不得各自再依 status 分支
- 降溫速率只有 `ramp_rate_from_sop`（`utils.py`）一份：模擬器實際降溫與「還要降多久」的估算讀同一個來源
- FINISHING 內手動停止（取消／緊急收尾）的 `ramp_to_ambient` 結束後直接回 IDLE，不走 `stabilize`（中止非完成，不需穩定）
- 同理，**中止不動排程**：手動停止或緊急收尾降完溫後，排程維持「進行中」、治具不歸還，由人員在排程頁面接續條件或取消排程來結案（中止後 `current_condition_index` 沒動，畫面給的是「開始第 N 條件」，不會出現「確認完成」）。模擬器只發一則「測試已中止」通知，不得自己標完成——那會留下跑到一半卻記成完成的排程，還會把還在人手上的治具提前記成已還
- 重啟後自動從 device_states 恢復 sim_phase（含 `stab_start`），不從頭開始

## 採購單狀態

```
pending ──→ arrived
   │
   └────→ cancelled
```

- `arrived` 與 `cancelled` 都是終態，不可重新切回 `pending` 或改成另一個終態。
- 只有 `pending` 採購單可以刪除；取消單保留作結案與稽核紀錄。
- 第一次轉為 `arrived` 時才把到貨數量加入治具庫存；重複送出 `arrived` 不得再次入庫。
- 指定 `arrived_quantity` 時必須大於 0；未指定時使用採購單原始數量。
