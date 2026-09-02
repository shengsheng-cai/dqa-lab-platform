# 測試規範

## 要重複跑的驗證寫成 pytest，不要另外養 shell 腳本

- 不要貼一串 curl 指令讓使用者自己複製貼上——要重複跑的東西就寫成測試。
- **預設寫成 `backend/tests/` 的 pytest**，跟著既有套件一起跑、CI 自動涵蓋，不必再維護
  allow 清單與另一條 CI 指令。驗的不是後端邏輯也沒關係：`test_schema_migrations.py`
  驗的是 migration 檔、`test_doc_translations.py` 驗的是文件翻譯有沒有漂，都放這裡。
- 只有**真的無法用 pytest 表達**時才寫 `.sh`（例如要編排多個服務進程）。`tests/e2e/`
  是這種例外——它要自己開後端、開瀏覽器。新增這類腳本要同步加入
  `.claude/settings.json` 的 allow 清單：`"Bash(bash tests/腳本名.sh)"`。
- 一次性的探索腳本兩者都不是，寫在暫存目錄跑完就丟，不要留在 `tests/`。

## E2E 瀏覽器測試（Playwright）

執行：`make test-e2e`（**不需要先 `make dev`**，它自己會開測試後端）。
加參數用 `ARGS=`，例如 `make test-e2e ARGS="--headed"` 開視窗看它在點什麼。

- 測試檔放 `tests/e2e/specs/*.spec.js`，共用程式放 `tests/e2e/helpers/`
- Playwright 鎖在 `tests/e2e/package.json`（目前 1.62.1），用它自帶的 Chromium，不是系統上的瀏覽器
- 臨時探索腳本**寫在暫存目錄、跑完就丟**，用 `make test-e2e-script SCRIPT=/tmp/xxx.mjs` 跑，
  不要留在 `tests/` 底下（同上一節那條）。想留下來重複跑的畫面檢查不叫探索腳本，直接寫成
  `specs/*.spec.js` 讓 CI 跑。那個指令跑的是**開發環境的真實資料**，別跟正式套件搞混

### 寫新測試檔一定要做的事

```js
import { resetBackend } from "../helpers/backend.js";
test.beforeAll(resetBackend);   // 少了這行，這個檔案會跑在上一個檔案的殘留狀態上
```

後端不是靜態的：模擬器每秒寫感測資料、推設備狀態機，排程也會自己往前跑。
所以每個測試檔都要自己重灌資料庫、重開後端。忘了寫不會報錯，只會變成偶爾紅一次的鬼故事。

要驗「某個環境變數沒設」的畫面，用 `resetBackendWithEnv({ 變數: "" })` 開後端，
不要去改 `run-e2e.sh`——那份是所有測試檔共用的。`ai-disabled.spec.js` 就是這樣把
`GEMINI_API_KEY` 清掉，驗 AI 未設定時面板有沒有說出原因。`resetBackend` 刻意不收參數：
`test.beforeAll(resetBackend)` 會把 Playwright 的 fixtures 當第一個參數傳進來。

登入用 `helpers/login.js`：管理員 `loginAsAdmin(page)`、訪客 `loginAsGuest(page)`，不要每個檔案自己填帳密。

### 已經踩過的坑，不要再踩

- **不平行跑、失敗不 retry**（`playwright.config.js` 已設定）。後端有共用狀態，平行會互相踩；用 retry 蓋過去只會養出爛測試。
  CI 把測試檔分成兩片、跑在兩個 runner 上不算違反這條：每一片是各自的後端與資料庫，看不到對方。
  要重現某一片用 `make test-e2e ARGS="--shard=1/2"`
- **測試環境和開發環境完全分開**：port 8100、資料庫 `/tmp/dqa-e2e.db`、假帳密。前端 build 到 `client/dist-e2e`，**不要改用 `client/dist`**——那個會被 `make dev` 蓋成 HF 預覽版，測試會安靜地連到別的後端
- **殺程序一定要加 `lsof -sTCP:LISTEN`**。不加會連「連到這個 port 的客戶端」一起列出來，包括 Playwright 自己，結果測試把自己殺掉
- **登入連錯 5 次會鎖 IP 10 分鐘**（記憶體計數）。寫負向測試時小心，每個測試檔重開後端剛好會清掉
- **訪客相關測試**要設 `DEMO_PASSWORD`，沒設後端會直接放行、測起來是假的。`loginAsGuest` 拿這個 master key 直接進，不用先開訪客 token
- **Toast 和 Modal 都有 ✕ 關閉鈕**，用 `getByRole('button',{name:'✕'})` 會 strict-mode 撞名（畫面上同時有兩顆）。要關某個 modal，就把定位 scope 在那個 modal 裡（toast 不在 modal 的 DOM 子樹），別在整頁找 ✕。
- **彈出視窗一律用 `getByRole('dialog', { name: '標題' })` 定位**：視窗都經過 `components/ModalFrame.jsx`，標題就是它的 accessible name。唯一的例外是 SOP 的「🚀 確認啟動」（`SafetyChecklist.jsx`）——它的遮罩長在面板裡不是蓋滿整頁，沒有 dialog 角色，只接了共用的 Esc。**不要再用「把定位 scope 在含某個獨有文字的容器裡」那種綁 DOM 巢狀的寫法**——前端多包一層 div 就會定到別的節點
- **`focus()` 只證明「這是按鈕、Enter 有反應」，不證明「Tab 走得到」**。用程式指定焦點會跳過
  tab 順序，所以被設成跳過（`tabIndex={-1}`）、被別的東西蓋住、或藏在沒顯示的分支裡，測試照樣
  會綠。要驗 Tab 順序就得真的連按 Tab、記錄焦點依序停在哪（`keyboard-navigation.spec.js` 最後
  一條是這樣寫的）。兩種都需要，但不要拿前者當後者用
- **切分頁之後，要先等新頁面出現再動手**。所有頁面一直掛在 DOM 上，只靠 `display:none` 切換，
  所以點完分頁鈕的那一瞬間舊頁面還在：斷言會先打在舊頁面的同名按鈕上，等畫面真的換過去，
  `focus()` 拿到的那顆已經被藏起來，後面的 Enter 打在空處。先 `await expect(新頁面獨有的文字).toBeVisible()`
  再開始操作（維護頁那條測試踩過，單獨跑會過、整支跑就紅）
- **點東西用 `getByRole`，不要用 `getByText`**：`getByText` 連 `display:none` 裡的元素都撈得到
  （所有分頁都掛著），所以得再接 `.filter({ visible: true }).first()` 才對得起來；`getByRole`
  本來就不看隱藏的元素。而且這個專案要擋的正是「按鈕被改回普通方框」，用文字點的話那種退步照樣會綠。
  另外 `name` 預設是**子字串**比對，同一個視窗裡同時有「損壞」和「確定標記為損壞？」這種情形要加 `exact: true`
- **帶徽章的入口不要用 `exact: true` 釘完整名稱**：排程分頁鈕上有待審核數量的徽章（`ControlCenter.jsx` 的 `TabBadge`），
  而那個數字是後來才載進來的，所以按得早它的名稱是「排程」、按得晚會變成「排程 1」。寫死 `{ name: "排程", exact: true }`
  會變成偶爾定位不到的鬼故事——實際踩過：單獨跑和整支跑都過，完整套件跑才紅一次。這種入口用前綴比對
  `{ name: /^排程/ }`（`schedule-flow.spec.js` 一直是這樣寫的）
- 定位優先用畫面上看得到的文字當名稱（`getByRole` 的 `name`），前端目前沒有 test id

## Backend 單元測試（pytest）

- 測試檔放在 `backend/tests/`
- 執行：`cd backend && ../venv/bin/python -m pytest`
- conftest.py 使用具名 shared-cache 的 in-memory SQLite；QueuePool 讓並行操作各自使用不同連線，
  同一 fixture 共享 DB、不同 fixture 互相隔離
- 共用 fixture：`db`（單一 session）、`api_client`（掛 router 的 TestClient + 角色注入）、`patched_session`（一次 patch 多個模組的 SessionLocal）
- 跨模組寫 DB 的流程（如啟動排程會動到 schedule_service / sop / device_state / utils / schedules）一律用 `patched_session` 把相關模組一次 patch 完——漏一個那模組就會寫進真實的 aicm.db
- **唯一的例外是 `test_schema_migrations.py`**：它要驗 Alembic 真的跑得動，得對檔案型 SQLite 下 DDL，in-memory 那顆引擎進不去；而且指定 DB 位置不能用 `patched_session`——`alembic/env.py` 是自己 `from app.models import SQLALCHEMY_DATABASE_URL` 再塞進 `sqlalchemy.url`，所以要蓋的是那個常數（另加 `DATABASE_URL` 當第二道保險）。新增測試不要照抄這個寫法，除非同樣是在驗 migration 本身

## 資料庫

- 測試直接對 in-memory SQLite 操作，避免 mock/prod 行為不一致
- 跨模組流程用共用 `patched_session` 注入 in-memory session（參考 `test_schedule_start_consistency.py`），DB 本身仍走真實 SQLAlchemy 行為
- **schema 的權威只有 Alembic**：`init_db()` 只服務全新資料庫（`create_all` + 建 admin），不補既有資料表的欄位，也不得再加「啟動時自己 ALTER TABLE」的補丁；既有資料庫一律 `alembic upgrade head`。改 `models.py` 一定要跟著寫 migration
- 遷移指令在 `backend/` 底下跑：`../venv/bin/alembic revision --autogenerate -m "描述"`、`../venv/bin/alembic upgrade head`
- `test_schema_migrations.py` 在暫存 DB 實跑整條 migration chain，再比對 model 的每張表、每個欄位，以及每條外鍵指向哪張表、父列被刪時怎麼辦。加欄位或改外鍵行為時只改 model、忘了寫 migration 會直接紅（型別／nullable 漂移仍要自己顧）

## Frontend 單元測試（Vitest）

- 測試檔放在 `client/src/__tests__/`，命名 `*.test.js`
- 執行：`cd client && npm test`；監看模式：`npm run test:watch`。**一律走 npm script**，不要直接跑 `npx vitest run`——時區是釘在 script 上的（見下）
- 測試目標：**純邏輯**的函式——`client/src/utils/` 與 `constants.js` 裡不碰 DOM、不打網路的那些（對照表、格式化、驗證、組 payload）。現在有哪幾支看 `client/src/__tests__/`，這裡不列，列了就會漂
- 碰 DOM 或網路的不放進 Vitest（如 `download.js` 的 `downloadBlob`，它建 `<a>` 點下去）；不做 Vitest 元件渲染測試，重要流程由 Playwright E2E 驗證，其餘畫面再人工檢查
- 時區固定在 `Asia/Taipei`，釘在 `package.json` 的 test script（`TZ=...` 前綴）。`formatLocal` / `parseDateOnlyLocal` 的正確性就是「UTC 轉本地」，不釘的話本機（+08）跟 CI（UTC）會得到不同字串。`vite.config.js` 的 `test.env.TZ` 是給繞過 npm script 的跑法補的，但它只在 vitest 預設的 forks 模式有效，別把它當唯一保險。`timezone.test.js` 第一條就在確認時區，它紅了代表釘子鬆了，去修釘子、不要改後面的期望值
- `Intl` 輸出的日期時間分隔符不是一般空格（目前 ICU 是 U+2009），且會隨 Node 版本變。斷言前先用 `s.replace(/\s/g, " ")` 正規化，不然會出現「看起來一模一樣卻不相等」的紅字
- **不要順手升 CI workflow 裡的 `node-version`**。時區測試斷言了 `Intl` 的輸出字串，而那字串會隨 Node 內建的 ICU 版本改變。真要升，先用目標 Node 版本跑一次 `npm test`，綠了才改 workflow；紅了代表期望字串要重新確認，不是改斷言了事。這跟「升 GitHub Action 版本」是兩回事，別混在一起改
