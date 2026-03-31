# 前端慣例

## 元件結構

```
App.jsx → ControlCenter.jsx → [SOPPage, FixturePage, SchedulePage, UsersPage, ErrorLog, ExecutionList]
└─ components/ [sop/, ai/, control/RightPanel]
```

## ControlCenter 佈局

- LeftPanel（155px）：依 activeTab 動態切換內容
  - device → DeviceCards（設備狀態，可點擊選擇設備）
  - schedule → DeviceAvailRow × 5（設備可用性 + 剩餘時間）
  - fixture → FixtureSummaryPanel（借出中 / 今日到期 / 逾期未還）
  - 其他 → DeviceCards（預設）
- CenterPanel（flex:1）：Tab bar（設備 / 治具 / 排程 / 紀錄 / 人員管理）+ 各頁面
  - 「紀錄」tab 內嵌子 tab bar（異常紀錄 / 執行紀錄），`recordsSubTab` state 在 CenterPanel 內部
- AI FAB：右下角浮動按鈕，點擊從右側 translateX 滑入 RightPanel（500px）

## SchedulePage 佈局

- Header：單行緊湊（4 個 inline badge + 刷新/標記不可用/申請排程），~44px
- 甘特圖：`flexShrink:0` 固定區塊（308px），永遠可見，不可改為可捲動
- 捲動區：待審核警示條 + 待審核隊列 + 圖例 + 排程表格

## 注意事項

- 不在 ControlCenter 以外新增全局狀態
- 新增頁面要加入 Tab bar，並在 LeftPanel 加對應的側欄內容
