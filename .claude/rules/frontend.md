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

## 後端代碼不要直接顯示給使用者

畫面上不得出現後端的內部代碼（設備狀態、`sim_phase`、異常類型這一類），一律經對照表翻成中文。
這條擋的是「使用者得先看懂英文 enum 才知道現在怎麼了」。

- **對照表放哪**：設備狀態與相位在 `constants.js`（它已經有 `STATUS_CONFIG`、`SIM_PHASE_LABEL`、
  `deviceStatusZh`、`deviceStatusBadge`）；其他領域的放 `utils/`，`utils/maintenance.js` 與
  `utils/errorTypes.js` 是範本。同一份代碼不要在兩個地方各翻一次
- **沒收錄的值要看得出來**，不能變空白、也不能只把原碼丟出去：寫成「其他異常（原碼）」「未知類型（原碼）」
  這種形式。空白比顯示英文更糟——使用者看到的是「這裡本來就沒東西」，不是「有東西我看不懂」
- **需要原碼除錯就放 `title`**，不要放進可見文字
- **判斷仍然用代碼**，不要拿中文字串當條件。顯示走對照表、邏輯走 enum，兩件事分開
- **排程狀態是例外**：後端 `ScheduleStatus` 的值本來就是中文（待審核／已確認／進行中……），直接渲染即可
- 漏收一個不會有任何錯誤訊息，只會安靜地少一塊。相位那份由
  `backend/tests/test_sim_phase_labels.py` 擋著；新增對照表時想一下同樣的漏法要怎麼擋

## 可點的東西一律用 `<button>`

普通方框綁 `onClick` 不算入口：Tab 停不上去、Enter 按不動，螢幕閱讀器也不會說那是按鈕，
而用滑鼠測完全看不出來。`client/eslint.config.js` 的 `no-restricted-syntax` 會擋
（用 ESLint 內建規則，不裝 a11y 外掛），CI 的 lint 就會紅。

- **按鈕不能包按鈕**（瀏覽器與螢幕閱讀器會分不清按的是哪一顆），所以卡片或列裡已經有別的按鈕時，
  不得把整塊改成 `<button>`。這種情況整塊的 `onClick` 保留當滑鼠便利，列內放一顆真的按鈕當鍵盤入口，
  並在 `onClick` 那行加 `eslint-disable-next-line` 寫出入口在哪，不要只是關掉。
  範例：`SchedulePage.jsx` 的專案號碼、`DeviceCard.jsx` 的設備編號、`FixturePage.jsx` 的批次時間
- **每加一個 `eslint-disable`，就要在 `tests/e2e/specs/keyboard-navigation.spec.js` 補一條走那個入口的
  測試**：disable 註解是宣告，不是保證。lint 只看得到語法，「那一列裡真的有一顆能用的鍵盤入口」只有
  瀏覽器驗得到
- **按鈕的名稱要說得出按下去會發生什麼**。只有欄位值（例如一串專案號碼）聽的人不知道那是入口，
  用 `aria-label` 補成「開啟 X 的排程詳情」。名稱也要含得住畫面上看得到的字
- **焦點外框由 `index.css` 的全域 `:focus-visible` 提供，元件不得自己寫 `outline: "none"`**：
  inline style 蓋得過樣式表，寫了那個欄位就再也沒有焦點指示，而畫面上完全看不出來
- **表達「目前選中哪一個」用 `aria-current`，不要用 `aria-pressed`**：後者是開關按鈕（按第二次會
  彈起來），單選清單用它會被念成「已按下」卻取消不掉，未選中的每一個還會多念一次「未按下」
- **展開／收合要給 `aria-expanded`，排序表頭要給 `aria-sort`**；純裝飾的箭頭與圖示標 `aria-hidden="true"`，
  否則螢幕閱讀器會把方向唸兩次
- **`title` 不能當名稱用**：它只在滑鼠 hover 時出現，鍵盤聚焦不會觸發，輔助技術也常常整段跳過。
  要給名稱就用 `aria-label`，`title` 留給滑鼠（`GanttChart.jsx` 兩個都給）
- **表格列裡的動作鈕吃 `common.js` 的 `btnRowAction`（刪除用 `btnRowDanger`），最小點擊高度 32px**，
  呼叫點只覆蓋顏色，不要自己寫 `padding` 與 `fontSize`。以前每一頁各寫一種尺寸，最小的一種只有
  10px 字、上下 1px 內距。`btnRowDanger` 的外框刻意是中性色、只有文字是紅的——紅框配紅字在一排
  小按鈕裡會變成最顯眼的一顆，等於把視線引去點最不該點的。名字帶 `Row` 是因為這兩件事都只在
  「一排小按鈕之中」才成立，頁面層級的危險按鈕不要拿它去用。
- **那一組按鈕要包在 `rowActions` 容器裡，刪除排最後並多給 `marginLeft: 8`**：誤觸最常落在相鄰的
  那一顆，而刪除不能是那一顆。間距是容器的 `gap` 加上這個 `marginLeft`，只釘按鈕那一半的話，
  同一條規則在不同頁會算出不同距離（改成共用容器之前是 16／14／8px 三種）。整格只有刪除一顆時
  沒有前一顆可以拉開，就不加 `marginLeft`，也不需要容器。
- **列動作放不下要改的是欄寬，不是讓它換行**：`rowActions` 是 `flexWrap: "nowrap"`，因為換行會把
  刪除甩到第二行的最前面、正好落在第一顆正下方，拉開的距離等於沒有。`tableLayout: "fixed"` 的表格
  （治具總表）用 `ResizableTh` 的 `defaultWidth` 給足寬度，**加一個新動作就要一起把那個數字加大**；
  auto layout 的表格（維護頁）靠內容自己撐開，不需要也不能用 `defaultWidth`。
- 治具、維護、人員三頁由 `tests/e2e/specs/row-action-hit-area.spec.js` 量實際幾何守著：點擊高度、
  有沒有被擠到第二列、刪除跟前一顆隔多遠。lint 看不出「按鈕被改小」，畫面上也只是小一點、擠一點，
  沒有東西會紅。**新增用到列動作的頁面時，順手把它加進那支測試**，不然那一頁沒有任何東西擋著。

- **div 改成 button 版面會變**：按鈕預設置中、寬度縮到內容大小。滿版的清單項要自己補
  `display: "block"`、`width: "100%"`、`textAlign: "left"`，不然文字會忽然跑到中間

## 佈局上不可改的決定

畫面現在長什麼樣，打開 `ControlCenter.jsx` 就看得到；這裡只列改動前要先知道的決定。
新增決定時放進下面對應的小節，不要接在整段最後——同一類的規則散開之後就沒人找得到。

### 版面本身

- FixturePage 固定**只有 2 個 tab**（治具總表／記錄）。**不**另設借出中、逾期、採購、損壞等獨立 tab——借出資訊整合在總表展開列，採購整合在記錄 tab
- SchedulePage 的甘特圖是 `flexShrink:0` 固定區塊（308px），永遠可見，**不可改為可捲動**
- 「紀錄」與「感測器 QC 控制圖」是 Modal，不是 tab；state 放在 ControlCenter 主元件
- SchedulePage **不另設狀態圖例列，也不另設待審核隊列區塊**：狀態顏色由篩選鈕在選中時呈現（與甘特圖共用 `STATUS_COLOR`），待審核那筆在下方表格本來就有，上面再列一次是同一份資料出現兩次

### 彈出視窗

- **一律用 `components/ModalFrame.jsx` 當外框，不要自己寫「背景 div + 擋冒泡」**。以前九個視窗各寫一份，於是三件事沒人做：Esc 關不掉、開啟時焦點還留在已經被蓋住的那顆按鈕上、關掉之後焦點也回不去。外框負責遮罩、`role="dialog"`、Esc、焦點進出，以及「標題不動、內容捲、底部操作區不動」三段結構。治具頁與排程頁各有一支外殼（`fixture/ModalShell.jsx`、`schedule/ScheduleModalShell.jsx`）包在上面給外觀，同頁新增視窗沿用那兩支。唯一不套外框的是 SOP 的「🚀 確認啟動」（`SafetyChecklist.jsx`）：它的遮罩只蓋住 SOP 操作區、不是整頁，所以只接 `useEscapeToClose`，其餘三件事沒有——要動它的話是把遮罩定位開成 prop，不是再手寫一份
- **`title` 是必填的**：它同時是螢幕閱讀器唸出來的視窗名稱與 E2E 的定位依據。標題寫在內容第一行的普通文字不算，輔助技術認不出那是一個視窗
- **取消／送出那一排放 `footer`，不要留在內容裡**：留在內容裡表單一長就跟著捲出畫面，使用者得先捲到底才找得到主要動作。內嵌在內容中的表單按鈕不算（`ManageBlockedPeriodsModal` 的新增時段就留在原位）
- **高度上限交給外框，不要不設**：沒有上限的話內容一高就往視窗上下溢出，而且不會有捲軸，等於按鈕根本到不了——比捲走更糟
- **不做完整的焦點鎖**（Tab 到最後一顆繞回第一顆）。焦點移進去、Esc、關掉還回去已經解掉絕大部分，焦點鎖要處理的邊界情況多、收益低
- **原本不能點背景關閉的視窗，換外框時要傳 `closeOnBackdrop={false}`**（目前只有 `UsersPage` 的人員視窗）：不要因為換外框就多一條「按到空白處把填到一半的東西丟掉」的路

### 確認視窗

- **站內只有一支確認視窗**：`components/ConfirmModal.jsx`。**不要在頁面檔案裡自己再寫一支**，也不要用瀏覽器原生的 `window.confirm`。以前 UsersPage 自己有一支同名的，結果人員管理頁的兩個確認視窗跟站內其他九個長得不一樣、能力還互補（一邊有標題與危險分級，一邊有送出中停用），而同名也會讓人誤以為在讀共用元件。呼叫時**一定要給 `title`**，那個字同時是視窗標題與 `aria-label`；送出中要擋重複送出就給 `confirmDisabled`，但**取消鈕不跟著停用**——送出沒有逾時可靠，卡住時至少還有路可以離開
- **刪除的確認訊息要寫出刪的是哪一筆**：確認視窗蓋住的正是操作人員要核對的那一列，只寫「確定刪除？」的話，點錯列時最後一關也救不回來。採購單寫治具與數量、排程寫專案與樣品、維護紀錄寫設備與類型與日期（`FixturePage.jsx` 的 `PurchaseTab`、`ScheduleDetailModal.jsx`、`MaintenancePage.jsx`）
- **失敗不要把確認視窗關掉**：只有成功才收掉視窗並講出動到的是誰，失敗留在原地並寫出具體錯誤（`UsersPage.jsx` 的刪除人員與撤銷 Token 是範本）。失敗還收掉視窗的話，畫面會回到一個看起來已經處理完的列表，但那筆其實還在
- 「⏹ 正常停止」一律先開確認視窗（`SOPPage.jsx` 的 `handleAction`）：它會跳過剩餘步驟、立刻降溫，沒有復原鍵。**緊急停止、以及緊急後的「確認安全，開始降溫」維持單擊立即生效**——後者送出的動作也叫 `normal`，所以判斷要看 `isEmergency`，不能看動作名稱
- 治具歸還一律開 `ReturnModal`（選正常／損壞／遺失、填備註、改實際歸還日，損壞與遺失要二次確認），不在列上直接送出
- 刪除設備不可用時段一律開 `ConfirmModal`（`ManageBlockedPeriodsModal.jsx`），訊息要列出設備、起訖與原因：那一列同時擋著排程排入與現場啟動測試，刪掉等於把鎖拿掉，而畫面上只會看到一句「已刪除」
- 採購「確認到貨」一律開 `ConfirmModal`（`FixturePage.jsx` 的 `PurchaseTab`），列出治具、到貨數量與「庫存 X → Y」：一按同時改採購狀態與治具庫存，而 `arrived` 是終態，畫面上沒有回到待採購的路

### 畫面要說出實話

- 寫入成功後**必須呼叫對應的資源 callback 立即失效**（`fixtureSummary`、`scheduleCounts`、`calibrationStatusMap` 都由 ControlCenter 持有）。30／60 秒 polling 只是背景與跨瀏覽器變更的 fallback，不能拿它當主要更新手段
- **列表讀不到資料時不得顯示成「尚無○○」**：載入中、讀取失敗、真的沒有資料是三種情況，共用同一句話會讓後端斷線看起來像資料本來就是空的。訪客 Token 那張最嚴重——讀取失敗會顯示「點擊「+ 生成」建立第一個」，等於在系統故障時請管理者再發一把憑證。三態一律用 `components/ListState.jsx`：`ListState` 放一般容器、`ListStateRow` 放表格（欄數要跟表頭一致）、`StaleBanner` 用在「手上有舊資料但這次更新失敗」。**失敗不要清空既有資料**，留著並在上方標明那是上一次讀到的，清掉會像資料被刪光了。錯誤區塊的按鈕叫「重試」不叫「重新整理」：稽核面板工具列本來就有一顆「重新整理」，讀取失敗時兩顆會同時出現在畫面上
- **失敗原因要講得出來，一律用 `utils/loadError.js` 的 `describeLoadError`**：它會避開 `api.js` 攔截器在翻不出來時塞回去的籠統句子（「操作失敗，請稍後重試」），改用狀態碼講具體，所以真的 500 會顯示「伺服器錯誤（500）」而不是那句廢話。下載也走同一支：呼叫 `utils/download.js` 的 `downloadOrFail`，訊息要送 toast 還是寫在畫面上由呼叫點決定。`downloadBlob` 刻意不對外公開，就是為了不要再長出一個失敗時什麼都不說的下載。走原生 fetch 的呼叫（AI 串流要邊收邊顯示，用不了 axios）沒有攔截器幫忙翻 detail，改用同一支檔案的 `describeResponseError`：它把 `Response` 的 body 取出來之後接回同一套狀態碼對照，不要再抄一份。那條路的 401 也得自己接——呼叫 `api.js` 的 `handleUnauthorized`（清掉登入痕跡並回登入頁，要清哪幾個鍵列在 `utils/session.js`），否則 Token 過期只會在畫面上留一句話，人還留在已經失效的畫面上
- **複製到剪貼簿一律走 `utils/clipboard.js` 的 `copyText`**：它先試 clipboard API、失敗再退回 `execCommand`，回傳有沒有成功。以前訪客 Token 與 AI 訊息各寫一份，AI 那份有退路、Token 那份沒有——偏偏 Token 才是提示一關就再也看不到的那一份，而 clipboard API 在非安全來源（拿區網 IP 開前端）根本不存在。**失敗一定要說出來**：兩條路都不通時按鈕完全沒反應，跟按到壞掉的鈕分不出來。要不要再把文字選起來讓人自己按 Ctrl/Cmd + C，由呼叫點決定（訪客 Token 有，因為那一串關掉就沒了）。
- **寫入成功一定要說出來**：操作結果一律走 `useToast` 的 `showToast`。同一個畫面有的成功分支有、有的沒有，等於在告訴人「這次沒成功」——排程的「儲存備註」就漏過，只有失敗會講話，成功是沉默的，使用者只能再按一次。`ToastContainer` 是站內唯一的 live region（`role="status"`），走 toast 才唸得出來；**不要另外做通知元件**，那會繞過這件事
- **成功之後要讓按鈕反映新的狀態**：例如「儲存備註」在內容跟存進去的那份一樣時就停用，否則同一份內容按第二次，畫面給的回饋跟第一次一模一樣，人分不出到底存到沒有
- **必填欄位要在填之前就看得出來，缺欄位時要說出缺的是哪一欄**：標籤補 `*`（`UsersPage.jsx` 的「姓名 *」「角色 *」、`NewScheduleModal.jsx`、`MaintenancePage.jsx`、`CreatePurchaseModal.jsx` 都有）。送出時缺欄位就寫出訊息，**不得靜靜地 `return`**——按了完全沒反應的畫面，使用者分不出是按鈕壞了、系統卡住還是自己少填，登入頁（`App.jsx`）以前正是這樣。**也不要改用停用主要按鈕代替**：那顆通常已經用 `disabled` 表示「送出中」，兩種意思疊在同一個灰色外觀上，而且灰掉的按鈕仍然沒說出缺哪一欄。**把焦點移回缺的那一欄目前只有登入頁在做**，因為它的欄位沒有標籤、訊息又在卡片最底下，不移焦點使用者得自己找回去；其他表單只有 `setError`（`MaintenancePage.jsx` 走 toast），不要為了這條回頭去改它們。登入頁不加星號——那裡只有 placeholder，沒有標籤可標——訊息掛在共用的 `role="alert"` 區塊上，因為登入前沒有 toast 可用。
- 月盤點**不得靜默排除品項**（`StocktakeModal.jsx`）：有借出或預約在外的品項現場數不到完整數量、不能盤，但要列成「未納入」並寫明原因，且「涵蓋數 + 未納入數 = 治具總數」；完全沒有可盤項目時停用「完成盤點」，不能讓人按下去得到「正常 0、差異 0」的假成功
- 排程詳情的「▶ 立即開始」與「開始第 N 條件」，在設備非待機或正落在維護時段時**一律停用並就地寫出原因**（`ScheduleDetailModal.jsx` 的 `describeDeviceReadiness`）：畫面手上已經有設備現況，還讓人按一次注定被後端拒絕的操作，只會讓人以為是排程壞了。**後端檢查不得因此移除**，那層擋的是競態。判斷只認真正的維護時段，**不能直接用設備的 `is_blocked`**——那個旗標把「維護」和「這台還有沒結案的排程」混在一起，後者後端其實允許啟動，跟著擋會把可以開始的情況也變灰

### 一件事只有一個入口

- 治具總表「借出」那格是**一顆有文字的按鈕**（`FixturePage.jsx`），不是可點的數字：它是借用明細與「歸還」的唯一入口，只放一個 9px 三角形的話，找不到的人會以為系統沒有歸還流程。數量 0 時不給按鈕
- 治具保管人一律從列上的「保管人」（`SetKeeperModal.jsx`）**選人員**設定；新增／編輯治具（`AddEditModal.jsx`）裡的保管人欄位是**唯讀**，且新增時不顯示（那時還沒有列可以按）。**不要把可輸入的保管人欄位加回去**：以前兩個入口寫到不同地方，在編輯治具改了保管人會存進 DB 卻不改變畫面。清除保管人一律開 `ConfirmModal` 並寫出清掉的是誰。名字存在但沒連到人員時（舊資料或匯入對不到人），列表與設定視窗都要標成「未連結人員」，不能跟正常設定過的長得一樣

## DateTimePicker / DatePicker

- 不使用 `type="datetime-local"` 或 `type="date"`，跨瀏覽器/裝置行為不一致
- `DateTimePicker`（SchedulePage）：兩行，上行年月日，下行時分；value 格式 `YYYY-MM-DDThh:mm`
- `DatePicker`（FixturePage）：單行年月日；value 格式 `YYYY-MM-DD`
- 月份變更時兩者皆自動 clamp 日期不超過當月最大值

## 色彩 Token 與共用 Style

- 色彩 token 集中在 `client/src/styles/theme.js`，export `C` 物件
- 共用 style 物件在 `client/src/styles/common.js`：`thStyle`、`tdStyle`、`btnPrimary`、`btnRowAction`（表格列裡的動作鈕）、`btnRowDanger`（列裡的刪除，由 `btnRowAction` 衍生）、`rowActions`（放那一組按鈕的容器）、`btnBare`（長得像純文字的按鈕用這支；以前各自 inline 寫，同一批改動裡四個呼叫點就出現三種寫法）
- schedule/ 元件的 modal 共用 style（`inputStyle`、`labelStyle`、`primaryBtn`、`cancelBtn`、`STATUS_COLOR` 等）在 `scheduleUtils.js`，已引用 `C`
- 停用外觀（`opacity: 0.5` + `cursor: not-allowed`）在 schedule/ 元件用 `scheduleUtils.js` 的 `disabledStyle`。站內其他地方目前各寫各的（`ConfirmModal` 用 0.6、`FixturePage` 用 0.7），沒有統一，不要以為有一份全站共用的
- 新增元件：用 `C.token` 取代 hex literal；用 `common.js` export 取代重複的 button/input style 定義

## 注意事項

- 不在 ControlCenter 以外新增全局狀態
- 新增頁面要加入 Tab bar，並在 LeftPanel 加對應的側欄內容
