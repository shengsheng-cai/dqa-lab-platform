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
- 「⏹ 正常停止」一律先開確認視窗（`SOPPage.jsx` 的 `handleAction`）：它會跳過剩餘步驟、立刻降溫，沒有復原鍵。**緊急停止、以及緊急後的「確認安全，開始降溫」維持單擊立即生效**——後者送出的動作也叫 `normal`，所以判斷要看 `isEmergency`，不能看動作名稱
- 治具歸還一律開 `ReturnModal`（選正常／損壞／遺失、填備註、改實際歸還日，損壞與遺失要二次確認），不在列上直接送出
- SchedulePage 的甘特圖是 `flexShrink:0` 固定區塊（308px），永遠可見，**不可改為可捲動**
- 「紀錄」與「感測器 QC 控制圖」是 Modal，不是 tab；state 放在 ControlCenter 主元件
- 刪除設備不可用時段一律開 `ConfirmModal`（`ManageBlockedPeriodsModal.jsx`），訊息要列出設備、起訖與原因：那一列同時擋著排程排入與現場啟動測試，刪掉等於把鎖拿掉，而畫面上只會看到一句「已刪除」
- 採購「確認到貨」一律開 `ConfirmModal`（`FixturePage.jsx` 的 `PurchaseTab`），列出治具、到貨數量與「庫存 X → Y」：一按同時改採購狀態與治具庫存，而 `arrived` 是終態，畫面上沒有回到待採購的路
- 月盤點**不得靜默排除品項**（`StocktakeModal.jsx`）：有借出或預約在外的品項現場數不到完整數量、不能盤，但要列成「未納入」並寫明原因，且「涵蓋數 + 未納入數 = 治具總數」；完全沒有可盤項目時停用「完成盤點」，不能讓人按下去得到「正常 0、差異 0」的假成功
- SchedulePage **不另設狀態圖例列，也不另設待審核隊列區塊**：狀態顏色由篩選鈕在選中時呈現（與甘特圖共用 `STATUS_COLOR`），待審核那筆在下方表格本來就有，上面再列一次是同一份資料出現兩次

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
