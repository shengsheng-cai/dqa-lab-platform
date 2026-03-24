# 🧬 DQA Lab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘部分不動。

---

## 當前狀態快照（2026-03-25，v11）

### 開發環境

```
本地開發：macOS M2
後端：http://localhost:8000
前端：http://localhost:5173
API 文件：http://localhost:8000/docs
```

### 功能完成狀態

| 模組 | 狀態 | 關鍵說明 |
|------|------|----------|
| 物理模擬引擎 | ✅ | sim_phase 狀態機、多 cycle、重啟自動恢復、dwell 真實時間戳、IDLE 跳過迴圈 |
| 環境測試標準 | ✅ | 5 法規 78 條件，三層 STANDARD_TREE |
| SOP 執行 | ✅ | 三步驟選擇、SP+PV 波型、步驟鎖定、ISO 17025 CSV、useMemo 優化 |
| 異常紀錄 | ✅ | EMERGENCY 防重複、記錄步驟進度、limit 500 |
| RAG 知識庫 | ✅ | Gemini Embedding、in-memory、快取自動失效重建、query cache |
| AI 諮詢 | ✅ | 串流、Gemini 2.5 Flash-Lite、多輪對話、debounce 存檔、focus 競爭修正 |
| LINE Bot | ✅ | 推播、Flex Message、Quick Replies、共用 AsyncClient、push_to_user（個人推播）|
| 存取控制 | ✅ | X-Demo-Password、IP Rate Limiting（maxsize 清理）、8h session、CORS |
| 儀表板 | ✅ | 六狀態、趨勢圖、倒數計時、skeleton loading、時間格式化、執行紀錄顯示測試名稱 |
| 登入頁 | ✅ | offline fallback、不顯示密碼明文、role 存 localStorage、三層權限切換 |
| SOP 元件 | ✅ | 拆分 10 個子元件、自製 confirm modal、步驟鎖定、錯誤訊息細節化 |
| 執行紀錄 | ✅ | 顯示 sop_name、CSV 下載帶 auth header |
| AI 對話 | ✅ | 標題截斷、空分組保留、閉包修正、折疊偵測、textarea 高度重置、modelBadge 修正 |
| 治具管理（核心） | ✅ | 治具總表、借出中、逾期未還、借出登記 Modal、歸還 Modal、Summary 卡片、搜尋篩選、role 權限控制 |
| 治具管理（後端） | ✅ | fixtures.keeper_user_id 新欄位、PATCH /{id}/keeper、GET /users、LoanCreate 帶 borrower_user_id |
| Excel 匯入 UI | ✅ | 上傳按鈕、FormData POST、成功/失敗筆數預覽、完成後 fetchAll |
| LINE Bot 治具通知（後端） | ✅ | fixture_notifications.py、APScheduler、POST /loans 即時推播 |
| LINE Bot 治具通知（前端） | ✅ | LoanModal 借用人下拉✅、SetKeeperModal✅、表格觸發按鈕✅、月盤點實際數量欄位✅ |
| 人員管理（UsersPage） | ✅ | admin only、工程師名冊新增/編輯/停用/刪除、LINE User ID 綁定、mock user（無法登入）|
| Auth 升級（/api/auth/me） | ✅ | GET /me 從後端回傳真實 role、App 啟動時刷新、防 localStorage 竄改 |
| 採購清單 | ✅ | 採購清單 tab、新增採購單 Modal、快速採購按鈕（缺貨行）、確認到貨自動累加庫存、admin 刪除 |
| 汰換提醒 | ✅ | estimated_replacement_date 即時計算、治具總表顏色標示、APScheduler 每週一推播保管人 |
| 前端大改版（控制中心） | ✅ | 三欄佈局、TopBar 摘要列、LeftPanel 設備卡片、CenterPanel tab 切換、RightPanel AI 側欄 |
| 控制中心 UI 修正 | ✅ | 設備選擇器去重、LeftPanel 紀錄連結接通、SOPPage 嵌入模式、右欄加寬 300px |
| RightPanel AI 對話管理 | ✅ | 迷你對話切換列（‹/›箭頭 + 計數）、新增對話 + 清除按鈕、ChatArea 滾動修正、串流 rAF 節流 |
| 訪客 Token 管理 | ✅ | DemoToken DB 表格、admin CRUD UI（UsersPage）、POST /api/auth/demo-login 登入端點、use_count 僅登入時遞增、rate limiter 修正 |
| 訪客模式功能開放 | ✅ | AI 諮詢全開放、治具/排程唯讀（canOperate=false）、逾期未還/採購清單 tab 隱藏、設備狀態同步修復 |
| AI 快速按鈕隨機池 | ✅ | 16 題問題池隨機抽 4，每次點擊後刷新；訪客登入時清空 AI 對話紀錄 |

### 已修 Bug（近期架構性）

- 訪客 Token use_count 每次 request 耗盡：middleware 呼叫舊 `_check_demo_token` 遞增；修正：拆成 `_validate_demo_token`（middleware，不遞增）+ `_use_demo_token`（登入一次）
- demo-tokens API 404：`auth.py` router 路徑缺少 `/api/auth/` 前綴；修正：路由改寫完整路徑
- 訪客登出後 IP 被封鎖：過期 token 觸發 rate limiter；修正：token 存在但失效時直接 401 不計入失敗次數
- AI 查庫存回傳「查無此資料」：`_query_fixture_context` 存取非 ORM 欄位 `loaned_quantity`，AttributeError 被 except 靜默；修正：改用 `total_quantity` + `shortage`，並依 (interface_type, form_factor) 去重
- 串流生成時 UI 凍結：每個 chunk 直接 `setStreamText()` 觸發高頻重渲；修正：rAF 節流每 16ms 更新一次

---

## 待開發路線圖

```
[1] LINE Bot 治具通知   ✅ 全部完成
[2] 月盤點 UI          ✅ 完成
[3] Auth 升級（/me）   ✅ 完成（JWT 完整替換尚未實作）
[4] 採購清單           ✅ 完成
[5] 汰換提醒           ✅ 完成
[6] 前端控制中心改版   ✅ 完成
[7] 訪客 Token 管理    ✅ 完成
─────────────────────────────────────────
[下一步] 排程系統（甘特圖 + 自動時長計算）
```

#### APScheduler 推播邏輯（已上線）

```
逾期 >= 1 天  → 推播借用人
逾期 >= 3 天  → 推播保管人
逾期 >= 7 天  → 推播管理者
到期前 2 天   → 推播借用人（提前提醒）
每日彙整      → 推播保管人（今日到期清單）
月盤點提醒    → 每月 1 日推播保管人
汰換提醒      → 每週一 08:00，30 天內到期彙整推播保管人
```

---

## 後續規劃

### 排程系統

**核心邏輯**
- 系統自動計算時長，人工審核確認
- 先到先排，同一樣品所有條件在同一台設備依序跑
- 同台設備同時間只能一個專案（ISO 17025）

**時長計算**

```
總時長 = Σ（測試條件時長 + 條件間回常溫時間）
回常溫時間 = |測試溫度 - 25°C| ÷ 降溫速率（從法規庫取）
```

**設備分配**
- 自動找最早可用設備排入
- 管理人可標記設備不可用時段（維護/校正/假日）
- 跨假日測試自動標記
- 特殊情況標記：pre-test、產品部授權例外

**審核流程**：系統排好 → 甘特圖預覽 → 管理人確認 → 生效 → RS-485 鎖定（Phase 3）

**新增 DB 表格**
- `schedules`：排程紀錄（專案資訊、設備、測試條件清單、開始/結束時間、狀態）

---

## 已知未修問題

| # | 問題 | 優先度 |
|---|------|--------|
| S2 | 步驟進度 race condition（快速勾選兩步驟第二個 POST 覆蓋，實際發生機率極低） | P3 |
| B4 | generateSP 與 _calc_estimated_end_at 時間計算不同步 | P3 |
| D5+D6 | App.jsx 無 URL routing，react-router-dom 已裝未用 | P3 |
| X1 | test.db 為 pytest 自動產生，可直接刪除，不影響開發 | P3 |

---

## 治具管理系統設計原則

- 保管人是唯一操作者（Lab Eng），代理人為 Lab Sup
- 代理授權有期限，不是永久
- LINE Bot 只做通知，不做操作（防止未授權操作）
- 所有確認動作在網頁系統完成（有身份驗證）
- 治具統一放在上鎖治具室，保管人管鑰匙

### 可借數量計算
```
可借數 = 總數 - 借出中 - 損壞
```

### 借出流程（保管人中心）
1. 工程師透過任何方式申請（口頭/mail/預約，系統不管申請管道）
2. 保管人在網頁系統 30 秒內完成借出登記：選借用人、選治具、填樣品/專案名稱、綁定設備（CH-01~CH-05）、設歸還日期
3. LINE Bot 推播借用人確認訊息
4. 設備測試結束時系統提示「有借出治具尚未歸還」

### 月盤點流程
保管人清點實際數量 → 系統回填 → 差異自動標記 → 顯示「最後借出者」供追查

### 採購閉環
缺貨警示 → 採購清單自動產生 → 到貨入庫更新數量

---

## 系統整合觸發點

- SOP 正常停止 → 檢查此設備有無未歸還治具 → 提示歸還
- EMERGENCY → 同上
- 排程確認 → 自動預約對應治具
- 排程確認 → RS-485 鎖定溫箱（Phase 3）

---

## 技術規格

### 狀態機

```
設備狀態：
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
RUNNING/PAUSED → EMERGENCY（防重複觸發）

模擬相位：
idle → ramp_to_low / ramp_to_high → dwell_high → ramp_to_low2 → dwell_low → ramp_to_ambient
```

### 存取控制（現行）

**雙軌認證：**
- `X-User-Token`：帳號登入後取得，存 DB（8h TTL，重啟不失效）
- `X-Demo-Password`：訪客 Token（8 碼），管理者在 UI 生成，支援期限 / 最大使用次數

**訪客 Token 流程：**
1. 管理者在「人員管理」頁面 → 訪客 Token 管理 生成 Token
2. 訪客填入 Token → 前端呼叫 `POST /api/auth/demo-login`（use_count +1，僅此一次）
3. 後續所有 request 帶 `X-Demo-Password` header → middleware 呼叫 `_validate_demo_token`（不遞增 use_count）
4. Token 失效（過期/耗盡/停用）→ 401，前端自動登出，不計入 rate limiter

**後備 Master Key：** `DEMO_PASSWORD` 環境變數，不設則本機開發跳過驗證

**豁免路徑：** `/api/line/webhook`、`/docs`、`/openapi.json`、`/api/latest`、`/health`、`/api/auth/login`、`/api/auth/demo-login`

**Rate limiting：** 完全未提供憑證的請求 5 次封鎖 IP 10 分鐘（重啟清除）；token 存在但失效不計入

**Session：** `demo_password` + `demo_login_at` + `user_role` 存 localStorage，8 小時後踢出；401 時 axios interceptor 自動清除並跳回登入頁

**role 值：** `guest` / `engineer` / `keeper` / `admin`，`canOperate = role === "admin" || role === "keeper"`

**訪客（guest）可存取：** 設備狀態（唯讀）、AI 諮詢、治具總表（唯讀）、排程（唯讀）；不可操作 SOP 以外的寫入功能

### CORS

- 本地開發：`http://localhost:5173`（預設值，取自 `backend/.env` 的 `ALLOWED_ORIGINS`）

### 前端元件結構（現有）

```
src/
  components/
    sop/
      generateSP.js          # SP 波形計算（純函式）
      TempChart.jsx          # SP+PV 趨勢圖
      ConditionCard.jsx      # 測試條件摘要卡片
      SelectGroup.jsx        # 步驟選擇器（法規/版本/條件 共用）
      StepList.jsx           # 步驟勾選清單 + 進度條
      ExecutionPanel.jsx     # 儲存執行紀錄 + blob 報告下載
      ExecutionInfoPanel.jsx # 執行中資訊面板（Pgm/Step/Free Time/Cycle）
      SafetyChecklist.jsx    # 注意事項 + 啟動前 modal + 啟動按鈕
      MonitorSide.jsx        # 左側監控欄；embedded prop：隱藏標題與設備選擇器（嵌入控制中心用）
      ControlPanel.jsx       # 暫停/正常停止/緊急停止按鈕組
    ai/
      aiStorage.jsx          # localStorage 操作（純函式）
      ChatArea.jsx           # compact prop 支援窄欄模式
      ChatSidebar.jsx        # 對話列表，標題超 20 字截斷
      MessageBubble.jsx
      useAIChat.jsx          # AI 對話 custom hook
    control/
      RightPanel.jsx         # AI 側欄；迷你對話切換列（‹/› + 新增 + 清除）+ 快速按鈕 + ChatArea compact；寬度 300px
  App.jsx                    # 登入、session 管理、role 控制 → 載入 ControlCenter
  ControlCenter.jsx          # 三欄主框架；含 ExecutionList inline 元件；errors/executions 隱藏 tab
  Dashboard.jsx              # 保留，已不在主 nav 顯示
  SOPPage.jsx                # 主頁面；externalDevice prop 接受外部設備選擇（去重）
  ErrorLog.jsx               # 嵌入 CenterPanel errors tab（由左欄「異常紀錄」連結切換）
  AIPage.jsx                 # 保留，已不在主 nav 顯示
  FixturePage.jsx            # 治具管理，嵌入 CenterPanel 治具 tab
  UsersPage.jsx              # 人員管理，嵌入 CenterPanel 人員管理 tab
  api.js                     # axios instance，含 401 interceptor
```

### 治具管理後端 API（已完成）

| 端點 | 說明 |
|------|------|
| `GET /api/fixtures/` | 治具列表（含 loaned_quantity / available_quantity）|
| `GET /api/fixtures/summary` | 摘要（total_loaned / due_today / overdue / shortage_count）|
| `GET /api/fixtures/interface-types` | 介面類型清單（篩選用）|
| `GET /api/fixtures/{id}` | 單一治具詳情 |
| `GET /api/fixtures/loans/active` | 借出中清單 |
| `GET /api/fixtures/loans/overdue` | 逾期清單（含 overdue_days）|
| `POST /api/fixtures/loans` | 新增借出登記 |
| `POST /api/fixtures/loans/{id}/return` | 歸還確認 |
| `POST /api/fixtures/loans/{id}/extend` | 申請延期 |
| `POST /api/fixtures/import` | Excel 批次匯入 |
| `POST /api/fixtures/{id}/inventory` | 月盤點回填實際數量 |

### 資料庫（現有）

| 表格 | 說明 | 索引 |
|------|------|------|
| `device_data` | 歷史溫濕度，每 10 秒 | (device_id, timestamp) |
| `device_states` | 狀態持久化，含 sim_phase、sim_cycle、started_at | device_id |
| `sop_executions` | 執行主表，含 operator | id, created_at |
| `step_records` | 步驟完成狀態 | execution_id, step_index |
| `error_logs` | 緊急停止事件，含 completed_steps、total_steps | device_id, created_at |
| `fixtures` | 治具基本資料 | id, interface_type |
| `fixture_loans` | 借出紀錄（fixture_id, borrower, device, project, 狀態）| id, fixture_id |
| `users` | 工程師名單（帳號/密碼/LINE ID/權限/token）| id |
| `demo_tokens` | 訪客 Token（label / expires_at / max_uses / use_count / is_active）| id, token |
| `sop_templates` | 自訂 SOP 模板（自訂測試流程） | sop_id |
| `purchase_orders` | 採購紀錄（治具採購流程） | id, fixture_id |

### 前端輪詢頻率（現有）

| 元件 | 頻率 | 備註 |
|------|------|------|
| Dashboard 設備狀態 | 10s | 隱藏時暫停 |
| Dashboard 執行紀錄 | 60s | 隱藏時暫停 |
| SOPPage 設備狀態 | 3s | 隱藏時暫停 |
| ErrorLog | 60s | 隱藏時暫停 |
| FixturePage | 手動觸發 | fetchAll 於 active 變化時執行 |

### AI 模組

- **推理**：`gemini-2.5-flash-lite`，1000 次/天免費，temperature=0.3
- **向量化**：`gemini-embedding-001`，啟動時批次向量化（20 條/批，批次間等 5 秒），快取至 `rag_cache.pkl`
- **RAG 檢索**：法規條件靜態檢索，治具說明靜態檢索，治具即時庫存查詢走 DB 不走 RAG
- **歷史繼承**：未指定標準時自動從 history 抓之前提過的標準
- **預設推薦**：預設推 IEC 60068，明確說鐵道/船舶/海事/變電站才推對應標準
- **多輪對話**：MAX_HISTORY = 4；localStorage key：`dqa_ai_chats_v2`
- **輸入**：Enter 送出，Shift+Enter 換行

### Auth 現行規格

| 端點 | 狀態 | 說明 |
|------|------|------|
| `POST /api/auth/login` | ✅ | 帳號 + 密碼 → X-User-Token（存 DB）|
| `POST /api/auth/demo-login` | ✅ | 訪客 Token 驗證（use_count +1）|
| `GET /api/auth/me` | ✅ | 當前使用者 role / display_name / line_user_id |
| `GET /api/auth/users` | ✅ | admin only，使用者名冊 |
| `POST /api/auth/users` | ✅ | admin only，新增帳號（auto-gen username）|
| `PATCH /api/auth/users/{id}` | ✅ | admin only，修改 role / 停用帳號 |
| `DELETE /api/auth/users/{id}` | ✅ | admin only，不可刪自己 |
| `GET /api/auth/demo-tokens` | ✅ | admin only，訪客 Token 列表 |
| `POST /api/auth/demo-tokens` | ✅ | admin only，生成訪客 Token |
| `DELETE /api/auth/demo-tokens/{id}` | ✅ | admin only |
| `PATCH /api/auth/demo-tokens/{id}/toggle` | ✅ | admin only，啟用 / 停用 |

尚未實作（後續規劃）：
- JWT 完整替換 `X-User-Token` + `X-Demo-Password` 雙 header → 單一 `Authorization: Bearer`
- `passlib[bcrypt]` 取代 SHA-256 密碼雜湊

### 三層權限

| 功能 | 管理者 | 保管人 | 工程師 |
|------|--------|--------|--------|
| 全部功能 + 報表 | ✅ | ❌ | ❌ |
| 治具借出/歸還登記 | ✅ | ✅ | ❌ |
| 月盤點回填 | ✅ | ✅ | ❌ |
| 報廢執行 | ✅ | ❌ | ❌ |
| 排程確認 | ✅ | ❌ | ❌ |
| 看治具總表 | ✅ | ✅ | ✅ |
| 看自己借出紀錄 | ✅ | ✅ | ✅ |
| 申請延期 | ✅ | ✅ | ✅ |
| 查看排程甘特圖 | ✅ | ✅ | ✅ |

### 欄位命名規範

- `dwell_time_hours`（非 `dwell_time`）
- `humidity_rh_percent`（非 `humidity`）
- 避免縮寫，保持一致性

### Alembic 注意事項

**現行實務**：新表格由 `init_db()` → `Base.metadata.create_all()` 在啟動時自動建立，不需要 alembic migration。Alembic 僅用於**既有表格的欄位異動**（ALTER TABLE）。

目前 `dqa_lab.db` 的所有表格（10 張）均已存在，無 pending migration。

SQLite autogenerate 有時產生空的 `upgrade()`，需手動填入。若 `alembic upgrade head` 無動作：

```bash
# 直接在資料庫執行 SQL（替換表名稱與欄位）
sqlite3 backend/dqa_lab.db "ALTER TABLE table_name ADD COLUMN col_name TYPE;"
```

---

## 常用指令

```bash
# 安裝與初始化
make install                   # 安裝所有依賴
python backend/init_db.py      # 首次初始化資料庫

# 開發
make dev                       # 啟動全部服務（含 ngrok）
make clean                     # 清理殘留程序

# 資料庫遷移（在 backend/ 目錄下）
alembic revision --autogenerate -m "描述"
alembic upgrade head
alembic downgrade -1           # 回退上一個遷移

# 測試
python -m pytest backend/tests/
pytest client/src/components/__tests__/

# 清理測試 DB
rm backend/test.db
```

---

## 開發檢查清單

### 新增功能前
- [ ] 確認功能優先度（P1 / P2 / P3）
- [ ] 檢查是否涉及 DB 結構變更
- [ ] 檢查是否需要新增 API 端點

### 提交前
- [ ] 運行 `make dev`，檢查無明顯錯誤
- [ ] 確認 `backend/.env` 已填入必要變數
- [ ] 檢查 `requirements.txt` 與 `package.json` 是否需要更新
- [ ] 更新本文件的「當前狀態快照」

### 雲端部署前（如適用）
- [ ] 本地 `make dev` 測試無誤
- [ ] 確認敏感資訊未洩露（檢查 README、代碼註解）
- [ ] 清除本地密碼與 `.env` 相關資訊

---

## 參考資源

- [FastAPI 官方文件](https://fastapi.tiangolo.com/)
- [React 官方文件](https://react.dev/)
- [SQLAlchemy 官方文件](https://docs.sqlalchemy.org/)
- [Gemini API 文件](https://ai.google.dev/)
- [LINE Messaging API](https://developers.line.biz/en/services/messaging-api/)
- [APScheduler 官方文件](https://apscheduler.readthedocs.io/)
- [python-jose](https://python-jose.readthedocs.io/)

---

## 備註

本文件為本地開發參考，不推送至 GitHub。敏感資訊（API 密鑰、部署 URL）請保存在 `.env` 檔案中。