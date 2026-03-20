# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘部分不動。版本紀錄以 git log 為準，不另維護 CHANGELOG。

---

## 當前狀態快照（2026-03-20）

### 雲端部署

| 服務 | 平台 | 網址 |
|------|------|------|
| 前端 | Vercel | https://dqa-lab-digital-twin-icvw-9m0ygc6ob.vercel.app |
| 後端 | Railway | https://dqa-lab-digital-twin-production.up.railway.app |

**部署說明：**
- Vercel：24 小時常駐，`VITE_API_URL` 已設定於 Vercel Dashboard
- Railway：Trial 方案，GitHub Auto Deploy 已斷開。平常 offline，展示前至 Dashboard → `⋮` → **Redeploy**，用完後 → `⋮` → **Remove**
- 後端環境變數：`GEMINI_API_KEY`、`DEMO_PASSWORD` 等已設定於 Railway Dashboard → Variables
- 本地與雲端可同時運行，但 LINE Webhook URL 同時只能指向一個端點

**已知注意事項：**
- Gemini Embedding API 免費方案上限 1000 次/天，每次 Railway Redeploy 都是全新 container，快取不保留，會消耗約 78 次配額。本地開發的 `rag_cache.pkl` 會保留，重啟直接讀取不消耗配額
- `rag_cache.pkl` 已加入 `.gitignore`，不會上傳 GitHub
- `dev_start.sh` 讀取 `.env` 時使用 `cut -d'=' -f2-`，正確處理含 `=` 號的 base64 token，且不污染 shell 環境變數。若推播出現 401，請重開終端機再執行 `make dev`，避免舊 session 殘留的環境變數干擾

### 專案目錄結構

```
.
├── AGENTS.md
├── README.md
├── LICENSE
├── Makefile
├── dev_start.sh
├── backend
│   ├── alembic/
│   ├── alembic.ini
│   ├── init_db.py
│   ├── requirements.txt
│   └── app/
│       ├── ai.py
│       ├── auth.py
│       ├── rag.py
│       ├── errors.py
│       ├── line.py
│       ├── main.py
│       ├── models.py
│       ├── reports.py
│       ├── serial_reader.py
│       ├── sop.py
│       ├── utils.py
│       └── standards/
│           ├── __init__.py
│           ├── _base.py
│           ├── iec60068.py
│           ├── en50155.py
│           ├── iec61850.py
│           ├── iec60945.py
│           └── dnv.py
├── client
│   └── src/
│       ├── api.js
│       ├── App.jsx
│       ├── Dashboard.jsx
│       ├── SOPPage.jsx
│       ├── SOPPage.css
│       ├── ErrorLog.jsx
│       ├── AIPage.jsx
│       ├── main.jsx
│       └── ai/
│           ├── aiStorage.jsx
│           ├── useAIChat.jsx
│           ├── MessageBubble.jsx
│           ├── ChatArea.jsx
│           └── ChatSidebar.jsx
├── docs
│   └── templates/
│       └── QA_Test_Report_Template.docx
└── simulator
    └── main.py
```

### 已完成模組

| 模組 | 位置 | 說明 |
|------|------|------|
| 共用工具 | `backend/app/utils.py` | `_now_utc()`、`_save_device_state()`，避免 circular import |
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率、完整多 cycle 狀態機（sim_phase）、濕度追蹤+噪音抖動、每 10 秒寫 DB、PAUSED 不寫 DB |
| 設備狀態持久化 | `backend/app/main.py` + `models.py` | DeviceState 表，重啟後自動恢復狀態 |
| 環境測試標準 | `backend/app/standards/` | 三層 STANDARD_TREE，5 法規 78 條件 |
| SOP 路由 + 執行紀錄 | `backend/app/sop.py` | 標準樹展開、三步驟選擇、執行紀錄；`standards/tree` 含 steps 欄位 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，含操作人員，查詢上限 10000 筆 |
| LINE Bot | `backend/app/line.py` | 狀態查詢、推播、簽名驗證、白名單、Flex Message、Quick Replies；環境變數動態讀取（`os.getenv`）避免 import 順序問題 |
| 異常紀錄 | `backend/app/errors.py` | EMERGENCY 自動寫入；防重複觸發；記錄已完成步驟數；查詢上限 500 筆 |
| RAG 知識庫 | `backend/app/rag.py` | Gemini Embedding API 向量化 78 條件、分批處理（20 條/批）、in-memory 搜尋、簡寫比對、top_k=20；本地快取（`rag_cache.pkl`，已加入 `.gitignore`）避免重複消耗配額 |
| AI 諮詢後端 | `backend/app/ai.py` | 串流 + 非串流，Gemini 2.5 Flash-Lite，RAG 動態注入 |
| 存取控制 | `backend/app/auth.py` | `X-Demo-Password` header 驗證、IP rate limiting（5次錯誤封鎖10分鐘）、OPTIONS/webhook 豁免；SKIP_PATHS 使用 `startswith` 比對 |
| AI 諮詢前端 | `client/src/ai/` | 多對話管理、專案分組、串流計時器、localStorage 持久化 |
| API 客戶端 | `client/src/api.js` | 統一 axios 實例，自動帶 `X-Demo-Password` header，baseURL 讀環境變數 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態、趨勢圖、進度條、倒數計時器、active prop 控制輪詢；historyMap 改為 state，切換設備立即更新 |
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟選擇（重啟自動還原）、SP+PV 波型、operator 欄位、EMERGENCY 引導、loading 狀態、樂觀暫停、步驟連鎖清除確認、checklist 進度條 |
| 異常看板 | `client/src/ErrorLog.jsx` | 統計卡片 + 紀錄列表，60s 刷新 |
| 全域路由 | `client/src/App.jsx` | CSS display 切換，四頁面常駐 DOM，登入頁 + 8小時 session 過期 + 登出按鈕 + offline fallback + Demo 密碼提示 |
| 雲端部署 | Railway + Vercel | 前後端分離部署，`VITE_API_URL` 環境變數串接，Railway Auto Deploy 已斷開 |
| 啟動腳本 | `dev_start.sh` | LINE token 用 `cut -d'=' -f2-` 讀取，不污染 shell 環境；`warmup_rag` 改為背景執行，不阻塞 FastAPI 啟動 |

### 待開發（依優先度）

1. **AI 治具管理助手**（`/api/ai/fixture-recommend`）
2. **AI 設備排程預估**（`/api/ai/schedule-estimate`）
3. **Phase 3**：RS-485 真實通訊、治具資料庫、JWT 認證系統

---

## 已知問題與修復進度（2026-03-20 全面健診）

> 所有問題已於 2026-03-20 健診後完成修復。
> 狀態：✅ 已修

### 後端 Bug

| # | 嚴重度 | 位置 | 問題描述 | 狀態 |
|---|--------|------|----------|------|
| B1 | 🔴 致命 | `main.py` lifespan | 重啟恢復時 `sim_phase` 寫死為 `"running"`，導致設備溫度永遠不動 | ✅ Session 2 |
| B2 | 🔴 致命 | `utils.py` | `_save_device_state` 沒有存 `started_at`，重啟後圖表與倒數計時全部失效 | ✅ Session 1 |
| B3 | 🟠 嚴重 | `main.py` data_simulator | `cycles=1` 且有 `low_temp` 時完全跳過低溫段 | ✅ Session 2 |
| B4 | 🟠 嚴重 | `main.py` / `SOPPage.jsx` | `dwell_counters` 秒單位 vs 前端 `generateSP` 分鐘單位，SP/PV 波形對不上 | 🔴 未修（架構層問題，留待 Phase 3） |
| B5 | 🟡 中等 | `main.py` `_calc_estimated_end_at` | 雙溫循環結尾計算有誤 | ✅ Session 6 |
| B6 | 🟡 中等 | `main.py` FINISHING | 降溫速率寫死 `0.4°C/s` | ✅ Session 2（改用 `ramp_rate`，fallback `1°C/min`） |
| B7 | 🟡 中等 | `sop.py` `start_sop` | 啟動新 SOP 時沒有重置 `sim_phase` 與 `sim_cycle` | ✅ Session 3 |

### 前端 Bug

| # | 嚴重度 | 位置 | 問題描述 | 狀態 |
|---|--------|------|----------|------|
| F1 | 🟡 中等 | `SOPPage.jsx` 執行資訊面板 | Cycle 欄位分子永遠顯示 `0001` | ✅ Session 6（`/api/devices` 加回傳 `sim_cycle`） |
| F2 | 🟡 中等 | `Dashboard.jsx` | 趨勢圖切換設備時有延遲 | ✅ Session 5（`historyRef` 改為 `useState`） |
| F3 | 🟢 輕微 | `Dashboard.jsx` | 趨勢圖資料點「每分鐘前 10 秒」窗口機制脆弱 | ✅ Session 5（改為直接從 `/history` API 取） |
| F4 | 🟢 輕微 | `SOPPage.jsx` `isStepUnlocked` | 步驟鎖定邏輯邊界案例有誤 | ✅ Session 4（改為從頭掃描所有前置必填步驟） |

### UX 問題

| # | 影響 | 位置 | 問題描述 | 狀態 |
|---|------|------|----------|------|
| U1 | 高 | `SOPPage.jsx` | 啟動按鈕無 loading 狀態 | ✅ Session 4 |
| U2 | 高 | `SOPPage.jsx` | 安全檢查 checklist 與啟動按鈕無視覺連動 | ✅ Session 4 |
| U3 | 高 | `SOPPage.jsx` | EMERGENCY 後引導文字太小 | ✅ Session 4（改為藍色引導按鈕） |
| U4 | 高 | `SOPPage.jsx` | 取消步驟連鎖清除無確認提示 | ✅ Session 4（加 `window.confirm()`） |
| U5 | 中 | `SOPPage.jsx` | 暫停切換無即時回饋 | ✅ Session 4（樂觀更新） |
| U6 | 中 | `SOPPage.jsx` | 儲存成功後無下一步引導 | ✅ Session 4 |
| U7 | 中 | 全站 | Dashboard 與 SOPPage 設備切換互動不一致 | 🔴 未修（可接受差異，留待未來統一） |
| U8 | 中 | `App.jsx` | 後端 offline 時前端空白；無 Demo 密碼提示 | ✅ Session 7 |

### 修復路線圖

```
Session 1 — utils.py          ✅ 補上 started_at 儲存（B2）
Session 2 — main.py           ✅ sim_phase 恢復（B1）、低溫 cycle（B3）、FINISHING 降溫（B6）
Session 3 — sop.py            ✅ start_sop 重置 sim_phase（B7）
Session 4 — SOPPage.jsx       ✅ U1 U2 U3 U4 U5 U6 F4
Session 5 — Dashboard.jsx     ✅ F2 F3
Session 6 — main.py + SOPPage ✅ sim_cycle 回傳（F1）、estimated_end_at（B5）
Session 7 — App.jsx           ✅ offline fallback、Demo 密碼顯示（U8）
```

---

## 技術規格

### 存取控制

- 後端 middleware：`backend/app/auth.py`，以 `BaseHTTPMiddleware` 掛載於 CORSMiddleware 之後
- Header：`X-Demo-Password`，值從 `backend/.env` 的 `DEMO_PASSWORD` 讀取
- 豁免路徑：`/api/line/webhook`、`/docs`、`/openapi.json`、`/api/latest`，使用 `startswith` 比對
- Rate limiting：in-memory，錯誤 5 次封鎖 IP 10 分鐘，重啟清除
- 前端：`client/src/api.js` 統一 axios，攔截器自動帶 header；`useAIChat.jsx` 的 fetch 手動帶 `getAuthHeaders()`
- Session：登入成功寫 `demo_password` + `demo_login_at` 到 localStorage，8 小時後自動踢出

### 狀態機

```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
RUNNING/PAUSED → EMERGENCY（防重複觸發）
```

模擬器 cycle 狀態（`sim_phase`）：
```
idle → ramp_to_low（低溫）或 ramp_to_high（其他）
     → dwell_high → ramp_to_low2 → dwell_low → (loop × cycles) → ramp_to_ambient
```

### 資料庫結構

| 表格 | 說明 |
|------|------|
| `device_data` | 歷史溫濕度，每 10 秒，composite index (device_id, timestamp) |
| `device_states` | 設備狀態持久化，含 sim_phase、sim_cycle |
| `sop_executions` | 執行主表，含 operator |
| `step_records` | 步驟完成狀態 |
| `error_logs` | 緊急停止事件，含 completed_steps、total_steps |

### 前端輪詢頻率

| 元件 | 頻率 |
|------|------|
| Dashboard 設備狀態 | 每 10 秒（隱藏時暫停） |
| Dashboard 執行紀錄 | 每 60 秒（隱藏時暫停） |
| SOPPage 設備狀態 | 每 3 秒（隱藏時暫停） |
| Errorlog | 每 60 秒 |

### AI 模組

- 推理：`gemini-2.5-flash-lite`（免費方案 1000 次/天），API Key 存於 `backend/.env` 的 `GEMINI_API_KEY`
- 向量：`gemini-embedding-001`（Gemini Embedding API），啟動時分批向量化 78 條件（20 條/批，批次間等 5 秒），約 20 秒；結果快取至 `backend/rag_cache.pkl`（已加入 `.gitignore`），重啟時直接讀取
- 架構：RAG in-memory，numpy 餘弦相似度，無需 ChromaDB、無需 Ollama
- 查詢路由：點名單一標準 → 全撈；跨標準比較 → `retrieve_multi`；含溫度數字 → 向量 + 溫度過濾；其他 → top_k=20
- 多輪對話：MAX_HISTORY = 4，history 由前端傳入
- localStorage key：`dqa_ai_chats_v2`

### LINE Bot

- Webhook：`POST /api/line/webhook`，SHA256 簽名驗證 + User ID 白名單
- 推播觸發：EMERGENCY、FINISHING → IDLE
- 指令：`狀態`/`status`、`CH01`~`CH05`、`help`
- ngrok：`make dev` 自動背景啟動並更新 Webhook URL（僅本地開發用）
- 金鑰：`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`（存於 `backend/.env`）
- 注意：`line.py` 所有環境變數改為函式內動態讀取（`os.getenv`），避免模組 import 時讀到空值

### 欄位命名規範

| 正確 | 錯誤 |
|------|------|
| `dwell_time_hours` | `dwell_time` |
| `humidity_rh_percent` | `humidity` |

### Alembic 注意事項

SQLite 的 autogenerate 有時產生空的 `upgrade()`，需手動填入：
```python
def upgrade() -> None:
    op.add_column('table_name', sa.Column('col', sa.Integer(), nullable=True))
```
若 `alembic upgrade head` 無動作（認為已執行），改用 SQLite 直接加欄位：
```bash
sqlite3 backend/test.db "ALTER TABLE table_name ADD COLUMN col_name INTEGER;"
```

---

## 常用指令

```bash
make install                   # 安裝所有依賴
python backend/init_db.py      # 首次初始化資料庫
make dev                       # 啟動全部服務（含 ngrok 自動更新 LINE Webhook）
make clean                     # 清理所有殘留程序

# DB 結構變更（在 backend/ 目錄下）
alembic revision --autogenerate -m "描述"
alembic upgrade head
```