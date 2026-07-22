# 前端慣例

## 元件結構

```
App.jsx → ControlCenter.jsx → [SOPPage, FixturePage, SchedulePage, MaintenancePage, UsersPage, ErrorLog, ExecutionList]
├─ ai/         [ChatArea, MarkdownRenderer, MessageBubble, useAIChat, aiStorage, markdownUtils, messageBubbleConstants]   ← src/ai/（非 components/）
├─ constants.js   ← src/ 根目錄，全域共用常數（DEVICE_IDS、SESSION_DURATION）
└─ components/
   ├─ [ConfirmModal, Toast, ToastContext, useToast]   ← components/ 根目錄，全站共用
   ├─ sop/     [ConditionCard, ControlPanel, ExecutionInfoPanel, ExecutionPanel, MonitorSide, SafetyChecklist, SelectGroup, StepList, TempChart, generateSP]
   ├─ schedule/ [ConditionPicker, DateTimePicker, GanttChart, ManageBlockedPeriodsModal, NewScheduleModal, ScheduleDetailModal, ScheduleModalShell, scheduleUtils]
   ├─ fixture/  [AddEditModal, CreatePurchaseModal, DatePicker, ImportModal, LoanModal, ModalShell, ReturnModal, SetKeeperModal, StocktakeModal, modalStyles]
   └─ control/  [RightPanel, SensorQcModal, SensorQcChart, AuditLog,
                 TopBar, DeviceCard, deviceCardUtils, TabBadge, LeftPanel,
                 FixtureSummaryPanel, ScheduleSummaryPanel, UsersSummaryPanel, CalibrationSummaryPanel]
```

`MaintenancePage` 和 `ExecutionList` 定義在 `src/` 根目錄，由 `ControlCenter.jsx` import。  
`ControlCenter.jsx` 本身只負責全局 state 管理 + `CenterPanel` + `BannerConfirmBtn` + Modal 組裝，不再包含頁面/面板元件定義。

## ControlCenter 佈局

- LeftPanel（155px）：依 activeTab 動態切換內容
  - device → DeviceCards（設備狀態，可點擊選擇設備）
  - schedule → ScheduleSummaryPanel（待審核/進行中/已確認/已完成計數，另有壞排程時顯示「異常」計數）+ DeviceCard × 5（顯示設備即時狀態，含不可用鎖定）
  - fixture → FixtureSummaryPanel（借出中 / 今日到期 / 逾期未還 / 庫存不足）
  - users → UsersSummaryPanel（角色人數 + 有效 Token 計數）
  - maintenance → CalibrationSummaryPanel（正常 / 即將到期 / 逾期 / 未知 計數，60s 輪詢）
  - 其他 → DeviceCards（預設）
- CenterPanel（flex:1）：Tab bar（設備 / 治具 / 排程 / 維護 / 人員管理）+ 各頁面
  - 維護 tab（adminOnly）→ MaintenancePage（設備校驗 & 維護紀錄 CRUD）；`calibrationStatusMap` state + `fetchCalStatus` useCallback 在 ControlCenter；透過 `onCalibrationChange` prop 傳至 MaintenancePage，儲存/刪除後即時更新 LeftPanel
  - 「紀錄」是 LeftPanel `📋 紀錄` 按鈕觸發的 Modal（非 tab），內嵌子 tab bar（異常紀錄 / 執行紀錄 / 稽核紀錄）；`recordsOpen` / `recordsSubTab` state 在 ControlCenter 主元件（非 CenterPanel）
  - 「感測器 QC 控制圖」是 DeviceCard `📊` 按鈕觸發的 Modal；`sensorModalDevice` state（string | null）在 ControlCenter 主元件；`onShowQc` prop 沿 LeftPanel → ScheduleSummaryPanel / DeviceCard 傳遞
- AI FAB：右下角浮動按鈕，點擊從右側 translateX 滑入 RightPanel（500px）

## FixturePage 佈局

- **2 個 tab**：治具總表 / 記錄（admin only）
- **治具總表**：庫存列表；「借出」欄數字 > 0 時可點擊展開子列，顯示借用人 / 到期日 / 逾期標示 / 歸還操作（`expandedFixtureId` state）
- **記錄 tab**：
  - 上方 sub-tab 切換：損壞／遺失（`DamagedList`）/ 盤點紀錄（`InventoryLogTab`）
  - 下方固定區塊：採購清單（`PurchaseTab`），帶分隔線與「採購清單」標題
- **不**另設借出中、逾期、採購、損壞等獨立 tab；借出資訊整合在總表展開列，採購整合在記錄 tab

## SchedulePage 佈局

- Header：無（badge 已移至 LeftPanel ScheduleSummaryPanel）
- 過濾列：全部/待審核/已確認/進行中/已取消/已完成/異常 tab + 右側 ↺/+ 不可用時段/+ 申請排程 按鈕
- 甘特圖：`flexShrink:0` 固定區塊（308px），永遠可見，不可改為可捲動
- 捲動區：待審核警示條 + 待審核隊列 + 圖例 + 排程表格

## DateTimePicker / DatePicker

- 不使用 `type="datetime-local"` 或 `type="date"`，跨瀏覽器/裝置行為不一致
- `DateTimePicker`（SchedulePage）：兩行，上行年月日，下行時分；value 格式 `YYYY-MM-DDThh:mm`
- `DatePicker`（FixturePage）：單行年月日；value 格式 `YYYY-MM-DD`
- 月份變更時兩者皆自動 clamp 日期不超過當月最大值

## 色彩 Token 與共用 Style

- 色彩 token 集中在 `client/src/styles/theme.js`，export `C` 物件
- 共用 style 物件在 `client/src/styles/common.js`：`thStyle`、`tdStyle`、`btnPrimary`、`btnOutline`、`btnDanger`、`inputBase`
- schedule/ 元件的 modal 共用 style（`inputStyle`、`labelStyle`、`primaryBtn`、`cancelBtn`、`STATUS_COLOR` 等）在 `scheduleUtils.js`，已引用 `C`
- 新增元件：用 `C.token` 取代 hex literal；用 `common.js` export 取代重複的 button/input style 定義

## 注意事項

- 不在 ControlCenter 以外新增全局狀態
- 新增頁面要加入 Tab bar，並在 LeftPanel 加對應的側欄內容
