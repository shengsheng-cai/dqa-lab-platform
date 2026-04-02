# 狀態機規則

## 設備狀態

```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
```

- 只有 IDLE 狀態的設備才能啟動新的 SOP
- FINISHING 完成後自動回到 IDLE
- 緊急停止（emergency_stop）可從任何狀態強制回 IDLE，觸發 LINE 推播（唯一的主動推播時機）

## 模擬相位（sim_phase）

```
idle → ramp_to_low → ramp_to_high → dwell_high → ramp_to_low2 → dwell_low → ramp_to_ambient
```

- `ramp_to_ambient` 結束後設備狀態轉為 FINISHING → IDLE
- 重啟後自動從 device_states 恢復 sim_phase，不從頭開始
