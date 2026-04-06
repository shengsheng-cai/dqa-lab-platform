# 前端慣例

## 元件結構

```
App.jsx → ControlCenter.jsx → [SOPPage, FixturePage, SchedulePage, UsersPage, ErrorLog, ExecutionList]
└─ components/ [sop/, ai/, fixture/, control/RightPanel]
```

## ControlCenter 佈局

- LeftPanel（155px）：依 activeTab 動態切換內容
  - device → DeviceCards（設備狀態，可點擊選擇設備）
  - schedule → ScheduleSummaryPanel（待審核/進行中/已確認/已完成計數）+ DeviceAvailRow × 5
  - fixture → FixtureSummaryPanel（借出中 / 今日到期 / 逾期未還 / 庫存不足）
  - users → UsersSummaryPanel（角色人數 + 有效 Token 計數）
  - 其他 → DeviceCards（預設）
- CenterPanel（flex:1）：Tab bar（設備 / 治具 / 排程 / 紀錄 / 人員管理）+ 各頁面
  - 「紀錄」tab 內嵌子 tab bar（異常紀錄 / 執行紀錄），`recordsSubTab` state 在 CenterPanel 內部
- AI FAB：右下角浮動按鈕，點擊從右側 translateX 滑入 RightPanel（500px）

## SchedulePage 佈局

- Header：無（badge 已移至 LeftPanel ScheduleSummaryPanel）
- 過濾列：全部/待審核/已確認/進行中/已取消/已完成 tab + 右側 ↺/🔒/+申請排程 按鈕
- 甘特圖：`flexShrink:0` 固定區塊（308px），永遠可見，不可改為可捲動
- 捲動區：待審核警示條 + 待審核隊列 + 圖例 + 排程表格

## DateTimePicker / DatePicker

- 不使用 `type="datetime-local"` 或 `type="date"`，跨瀏覽器/裝置行為不一致
- `DateTimePicker`（SchedulePage）：兩行，上行年月日，下行時分；value 格式 `YYYY-MM-DDThh:mm`
- `DatePicker`（FixturePage）：單行年月日；value 格式 `YYYY-MM-DD`
- 月份變更時兩者皆自動 clamp 日期不超過當月最大值

## 注意事項

- 不在 ControlCenter 以外新增全局狀態
- 新增頁面要加入 Tab bar，並在 LeftPanel 加對應的側欄內容
