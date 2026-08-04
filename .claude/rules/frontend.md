# 前端慣例

## 檔案放哪

目錄結構自己 `ls`，這裡只列看不出來的規矩。

- 頁面元件（`SOPPage`、`FixturePage`、`SchedulePage`、`MaintenancePage`、`UsersPage`、`ErrorLog`、`ExecutionList`）放 `src/` 根目錄，**不放 `components/`**；`api.js`、`useDeviceWebSocket.js`、`constants.js`、`errorMessages.js` 也在根目錄
- `ControlCenter.jsx` 只負責全局 state + `CenterPanel` + `BannerConfirmBtn` + Modal 組裝，不放頁面／面板元件定義
- AI 相關元件在 `src/ai/`，不在 `components/ai/`
- 純邏輯共用函式放 `src/utils/`，新增前先看有沒有現成的

## 時區陷阱（踩過，不要再踩）

- 送「到期日」這種以天為單位的期限用 `endOfLocalDay`，它給的是本地當天 23:59。送午夜會讓台北早上 8 點就判逾期
- 要後端照「本地的今天」查（如今日到期）就用 `localDayWindow` 把日界算好再傳，後端只認 UTC
- 取日期用 `localDateStamp`，**不要寫 `toISOString().slice(0,10)`**——那是 UTC，台北凌晨會少一天
- 判斷一支 utility 有沒有人用，不能只 grep 原名：`constants.js` 會把 `parseUTC` 改名成 `parseUtcDate` 再轉出去，要連別名一起找

## 佈局上不可改的決定

畫面現在長什麼樣，打開 `ControlCenter.jsx` 就看得到；這裡只列改動前要先知道的決定。

- 寫入成功後**必須呼叫對應的資源 callback 立即失效**（`fixtureSummary`、`scheduleCounts`、`calibrationStatusMap` 都由 ControlCenter 持有）。30／60 秒 polling 只是背景與跨瀏覽器變更的 fallback，不能拿它當主要更新手段
- FixturePage 固定**只有 2 個 tab**（治具總表／記錄）。**不**另設借出中、逾期、採購、損壞等獨立 tab——借出資訊整合在總表展開列，採購整合在記錄 tab
- 治具歸還一律開 `ReturnModal`（選正常／損壞／遺失、填備註、改實際歸還日，損壞與遺失要二次確認），不在列上直接送出
- SchedulePage 的甘特圖是 `flexShrink:0` 固定區塊（308px），永遠可見，**不可改為可捲動**
- 「紀錄」與「感測器 QC 控制圖」是 Modal，不是 tab；state 放在 ControlCenter 主元件

## DateTimePicker / DatePicker

- 不使用 `type="datetime-local"` 或 `type="date"`，跨瀏覽器/裝置行為不一致
- `DateTimePicker`（SchedulePage）：兩行，上行年月日，下行時分；value 格式 `YYYY-MM-DDThh:mm`
- `DatePicker`（FixturePage）：單行年月日；value 格式 `YYYY-MM-DD`
- 月份變更時兩者皆自動 clamp 日期不超過當月最大值

## 色彩 Token 與共用 Style

- 色彩 token 集中在 `client/src/styles/theme.js`，export `C` 物件
- 共用 style 物件在 `client/src/styles/common.js`：`thStyle`、`tdStyle`、`btnPrimary`、`btnDanger`
- schedule/ 元件的 modal 共用 style（`inputStyle`、`labelStyle`、`primaryBtn`、`cancelBtn`、`STATUS_COLOR` 等）在 `scheduleUtils.js`，已引用 `C`
- 新增元件：用 `C.token` 取代 hex literal；用 `common.js` export 取代重複的 button/input style 定義

## 注意事項

- 不在 ControlCenter 以外新增全局狀態
- 新增頁面要加入 Tab bar，並在 LeftPanel 加對應的側欄內容
