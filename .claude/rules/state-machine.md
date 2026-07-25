# 狀態機規則

## 設備狀態

```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
  │       └───────────────→ IDLE  （自然完成且已回常溫）
  └──────────────→ EMERGENCY → FINISHING → IDLE
```

- 只有 IDLE 狀態的設備才能啟動新的 SOP
- FINISHING 完成後自動回到 IDLE
- 緊急停止（emergency_stop）可從任何非 EMERGENCY 狀態進入 EMERGENCY，觸發 LINE 推播
- EMERGENCY 需經正常停止進入 FINISHING，降回常溫後才回 IDLE
- RUNNING 的測試自然完成時，simulator 已在 `ramp_to_ambient` 回到常溫，可由 `advance(complete=True)` 原子清回 IDLE
- 所有狀態轉換只走 `DeviceStateManager` 的五個動詞：`start`、`finish`、`pause`、`emergency`、`advance`

## 模擬相位（sim_phase）

```
idle → ramp_to_low → ramp_to_high → dwell_high → ramp_to_low2 → dwell_low → ramp_to_ambient
```

- RUNNING 內自然完成的 `ramp_to_ambient` 結束後直接回 IDLE
- FINISHING 內手動停止的 `ramp_to_ambient` 結束後回 IDLE
- 重啟後自動從 device_states 恢復 sim_phase，不從頭開始
