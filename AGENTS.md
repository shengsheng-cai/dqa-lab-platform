# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘理論部分不動。版本紀錄以 git log 為準，不另維護 CHANGELOG。

---

## 當前狀態快照（2026-03-15）

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
│       ├── errors.py
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
│       ├── App.jsx
│       ├── Dashboard.jsx
│       ├── SOPPage.jsx
│       ├── SOPPage.css
│       ├── Errorlog.jsx
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
| 共用工具函式 | `backend/app/utils.py` | `_now_utc()`、`_save_device_state()`，供 `main.py` 與 `sop.py` 共用，避免 circular import |
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率（含低溫先降後升）、每 10 秒寫 DB、ISO 17025 永久保存、PAUSED 不寫 DB |
| 設備狀態持久化 | `backend/app/main.py` + `models.py` | DeviceState 表、重啟後自動恢復 RUNNING 狀態與步驟清單 |
| 環境測試標準 | `backend/app/standards/` | 三層 STANDARD_TREE，5 法規 78 條件 |
| SOP 路由 + 執行紀錄 | `backend/app/sop.py` | 標準樹展開、三步驟選擇 API、執行紀錄儲存讀取；`standards/tree` 含 steps 欄位，前端不需二次請求 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，PASS/FAIL 工程師人工判定，查詢上限 10000 筆 |
| LINE Bot | `backend/app/line.py` | 設備狀態查詢、單一設備查詢、EMERGENCY/測試完成主動推播；LINE 簽名驗證、User ID 白名單；金鑰從 `.env` 載入 |
| 異常紀錄 | `backend/app/errors.py` | EMERGENCY 自動寫入 error_logs |
| AI 法規諮詢後端 | `backend/app/ai.py` | 串流 + 非串流，Ollama gemma3:4b，英文指令強制繁體；system prompt 快取，warm-up 預載 |
| AI 法規諮詢前端 | `client/src/AIPage.jsx` + `client/src/ai/` | 多對話管理、專案分組、串流輸出、追問建議、localStorage 持久化、雙層免責聲明 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態、趨勢圖雙 Y 軸可切換 5 台、步驟進度條、倒數計時器、active prop 控制輪詢 |
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟法規選擇、SP+PV 波型曲線、執行資訊面板、防重複提交、active prop 控制輪詢 |
| 異常看板 | `client/src/Errorlog.jsx` | 統計卡片 + 完整紀錄列表，60s 自動刷新 |
| 全域路由 | `client/src/App.jsx` | CSS display 切換，四頁面常駐 DOM，active prop 傳遞 |

### 下一步待開發（依優先度）

1. **法規正確性審查**（✅ 完成）
2. **AI 諮詢 UI 改版**（✅ 完成）
3. **AI 諮詢模組 bug 修正**（✅ 完成）
4. **後端與前端系統性優化**（✅ 完成）
5. **後端架構優化**（✅ 完成）— utils.py、circular import、低溫模擬、gemma3:4b
6. **LINE Bot 整合**（✅ 完成）— 設備狀態查詢、單一設備查詢、EMERGENCY 與測試完成主動推播；簽名驗證、User ID 白名單；ngrok 建立公開 Webhook
7. **AI 治具管理助手**（`/api/ai/fixture-recommend`）
8. **AI 設備排程預估**（`/api/ai/schedule-estimate`）
9. **Phase 3**：多台設備架構、治具資料庫、認證系統、RS-485 真實通訊（屆時評估以 MQTT 取代現有輪詢架構）

### 環境測試標準模組（standards/）

| 法規 | 條數 |
|------|------|
| IEC 60068 | 17 |
| EN 50155 | 21 |
| IEC 61850-3 | 19 |
| IEC 60945 | 7 |
| DNV | 14 |
| **合計** | **78** |

### AI 模組技術規格

- 模型：`gemma3:4b`（本機 Ollama，`http://localhost:11434`）；備用：`gemma3:12b`
- timeout：180 秒
- 端點：`/api/ai/standards-query`（非串流）、`/api/ai/standards-query-stream`（串流，前端主要使用）
- system prompt：英文指令，內建 78 個測試條件名稱（約 800 tokens）；模組載入時快取；lifespan warm-up 預載
- TC_PREFIX：`"[MUST reply in Traditional Chinese zh-TW ONLY, NO Simplified Chinese] "`，前端附加，不存入 messages state
- 多輪對話：MAX_HISTORY = 4；追問建議 3s 延遲，切換對話自動 abort
- 前端儲存：`localStorage`，key = `dqa_ai_chats_v2`

### 關鍵設計規範

**狀態機（6 種）**
```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
RUNNING → EMERGENCY（任意時刻）
OFFLINE（串口斷線）
```

**資料庫表格**
| 表格 | 說明 |
|------|------|
| `device_data` | 歷史溫濕度，每 10 秒，永久保存，composite index (device_id, timestamp) |
| `device_states` | 設備狀態持久化 |
| `sop_executions` | 執行歷程主表 |
| `step_records` | 每步驟完成狀態 |
| `sop_templates` | 自訂 SOP |
| `error_logs` | 緊急停止事件紀錄 |

**前端輪詢策略**
| 元件 | 輪詢內容 | 頻率 |
|------|---------|------|
| `Dashboard.jsx` | 設備狀態 | 每 10 秒（頁面隱藏時暫停） |
| `Dashboard.jsx` | 執行紀錄列表 | 每 60 秒（頁面隱藏時暫停） |
| `SOPPage.jsx` | 設備狀態 | 每 3 秒（頁面隱藏時暫停） |
| `Errorlog.jsx` | 異常紀錄 | 每 60 秒 |
| `AIPage.jsx` | 無輪詢，事件驅動 | — |

**欄位命名規範**
| 正確 | 錯誤 |
|------|------|
| `dwell_time_hours` | `dwell_time` |
| `humidity_rh_percent` | `humidity` |

**Git 提交路徑**
| 檔案 | 路徑 |
|------|------|
| 前端元件 | `client/src/ComponentName.jsx` |
| 前端 AI 子模組 | `client/src/ai/FileName.jsx` |
| 後端模組 | `backend/app/module.py` |
| 模擬器 | `simulator/main.py` |

**LINE Bot 技術規格**
- 套件：`line-bot-sdk==3.11.0`
- Webhook：`POST /api/line/webhook`，LINE 簽名強制驗證
- 白名單：只有 `LINE_USER_ID` 對應的帳號可操作
- 推播觸發：EMERGENCY 觸發、FINISHING → IDLE
- 指令：`狀態`/`status`、`CH01`~`CH05`、`help`
- 金鑰：`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID` 存於 `backend/.env`
- ngrok：本機測試用，每次重啟 URL 會變，需重新設定 Webhook URL

**常用指令**
```bash
make install               # 安裝所有依賴
python backend/init_db.py  # 首次初始化資料庫
make dev                   # 啟動全部服務
make clean                 # 深度清理殘留程序
make ngrok                 # 啟動 ngrok（另開 terminal，LINE Bot Webhook 用）
# DB 結構變更（在 backend/ 目錄下）
alembic revision --autogenerate -m "描述"
alembic upgrade head
```

---

## 系統架構理論

### 物理模擬引擎

- 斜率控制：從 `get_ramp_rate()` 動態讀取各標準速率限制
- 低溫測試：先降至 `low_temperature`，再升至 `high_temperature`
- 收斂演算法：目標值與實測值接近時引入 Jitter 模擬真實物理行為
- 狀態機：`EMERGENCY` 微幅抖動；`PAUSED` 鎖定數值不寫 DB；`FINISHING` 降溫至 25°C 後回 `IDLE`

### 硬體通訊（Phase 3）

- 通訊協議：KSON AICM 工業協議，RS-232 串口
- 虛擬橋接（socat）：`/dev/ttys000` ↔ `/dev/ttys001`
- 數據流：`Simulator → socat → AICM_CACHE → FastAPI → React`
- Phase 3 考慮以 MQTT 取代現有輪詢架構，`serial_reader.py` 屆時啟用