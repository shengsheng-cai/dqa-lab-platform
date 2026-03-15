# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘理論部分不動。版本紀錄以 git log 為準，不另維護 CHANGELOG。

---

## 當前狀態快照（2026-03-15）

### 專案目錄結構

```
.
├── AGENTS.md
├── CHANGELOG.md
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
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率、每 10 秒寫 DB、ISO 17025 永久保存、每台設備獨立 DB session、所有時間戳統一 `_now_utc()` |
| 設備狀態持久化 | `backend/app/main.py` + `models.py` | DeviceState 表、`_save_device_state()` 統一封裝寫入邏輯、重啟後自動恢復 RUNNING 狀態與步驟清單 |
| 環境測試標準 | `backend/app/standards/` | 三層 STANDARD_TREE，5 法規 **78 條件**，套件含 `__init__.py` / `_base.py` / `iec60068.py` / `en50155.py`（21 條）/ `iec61850.py`（19 條）/ `dnv.py` / `iec60945.py`（7 條）|
| SOP 路由 + 執行紀錄 | `backend/app/sop.py` | 標準樹展開、三步驟選擇 API、執行紀錄儲存讀取；`start_sop` 啟動時將 `total_steps` 存入 AICM_CACHE；`/api/sop/standards/tree` 含 steps 欄位，前端啟動 SOP 不需二次請求 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，PASS/FAIL 工程師人工判定 |
| 異常紀錄 | `backend/app/errors.py` | EMERGENCY 自動寫入 error_logs |
| 歷史資料 API | `backend/app/main.py` | `GET /api/devices/{id}/history`，從 started_at 至今每分鐘聚合 |
| AI 法規諮詢後端 | `backend/app/ai.py` | 串流 + 非串流，Ollama gemma3:4b，多輪對話，強制繁體中文（英文指令）；system prompt 模組載入時快取（`_SYSTEM_PROMPT_CACHE`），只建立一次；含免責規則與法規版本號標注要求 |
| AI 法規諮詢前端 | `client/src/AIPage.jsx` + `client/src/ai/` | 多對話管理、專案分組（含移動對話至分組）、串流逐字輸出、Markdown 渲染、快速提問側欄（可收合）、中途停止保留內容、複製回覆（含 HTTP fallback）、回覆計時、localStorage 持久化、智慧捲動、追問建議動態產生（切換對話時自動取消）、雙層免責聲明 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態、趨勢圖雙 Y 軸可切換 5 台、步驟進度條（依賴後端 `total_steps`）、倒數計時器、執行紀錄列表（60s 刷新）、低溫 < 0°C 隱藏濕度；歷史陣列改用展開運算子避免 React StrictMode 凍結問題 |
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟法規選擇（per-device）、treeLoaded skeleton、步驟依序追蹤（`ds.activeSop.steps.length` 自行計算）、generateSP 低溫濕度為 null、SP+PV 波型曲線、執行資訊面板 |
| 異常看板 | `client/src/Errorlog.jsx` | 統計卡片 + 完整紀錄列表，60s 自動刷新 |
| 全域路由 | `client/src/App.jsx` | CSS display 切換（非 Router unmount），四頁面常駐 DOM，切換無延遲；AI 頁容器 display: flex |
| QA 報告模板 | `docs/templates/` | 對外 Word 模板 |

### 下一步待開發（依優先度）

1. **法規正確性審查**（✅ 完成）— IEC 60068、EN 50155、IEC 61850-3、IEC 60945、DNV 全部審查完畢
2. **AI 諮詢 UI 改版**（✅ 完成）— 多對話管理、專案分組，詳見下方規劃段落
3. **AI 諮詢模組 bug 修正**（✅ 完成）— 分組管理、串流狀態、簡體偵測、Dashboard 歷史陣列凍結問題全部修正
4. **後端與前端系統性優化**（✅ 完成）— ai.py 雙重前綴、sop.py 重複 DB 寫入、main.py 時區偏移與低溫預估計算、SOPPage 防重複提交與輪詢優化、App.jsx 隱藏頁面暫停輪詢、models.py composite index、reports.py 記憶體上限
5. **後端架構優化**（✅ 完成）— utils.py 抽離共用函式解決 circular import、低溫模擬邏輯補完、gemma3:4b 模型切換與繁體強化
6. **AI 治具管理助手**（`/api/ai/fixture-recommend`）
7. **AI 設備排程預估**（`/api/ai/schedule-estimate`）
8. **Phase 3**：多台設備架構、治具資料庫、認證系統、RS-485 真實通訊

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
- system prompt：6 條規則，內建 STANDARD_TREE 78 個測試條件名稱（不含詳細參數，約 800 tokens）；模組載入時快取，只建立一次；lifespan 啟動時執行 warm-up 預載模型
- user message 前綴：`TC_PREFIX = "[MUST reply in Traditional Chinese zh-TW ONLY, NO Simplified Chinese] "`，只在送出 API 時附加，不存入 messages state
- 多輪對話：history 陣列帶入（MAX_HISTORY = 4），content 均為不含前綴的乾淨字串
- 前端儲存：`localStorage`，key = `dqa_ai_chats_v2`（多對話格式）
- 追問建議：3s 延遲後產生，切換對話時自動 abort 上一輪請求，結果只寫入發送當下的對話

### 關鍵設計規範

**total_steps**
| 元件 | 來源 |
|------|------|
| `Dashboard.jsx` DeviceCard 進度條 | 後端 `device.total_steps`，`start_sop` 時存入 AICM_CACHE |
| `SOPPage.jsx` 步驟追蹤進度條 | 前端 `ds.activeSop.steps.length`，自行計算 |

**狀態機（6 種）**
```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
RUNNING → EMERGENCY（任意時刻）
OFFLINE（串口斷線）
```

**前端輪詢策略**
| 元件 | 輪詢內容 | 頻率 |
|------|---------|------|
| `Dashboard.jsx` | 設備狀態 | 每 10 秒 |
| `Dashboard.jsx` | 趨勢圖資料點 | 每分鐘存一點 |
| `Dashboard.jsx` | 執行紀錄列表 | 每 60 秒 |
| `SOPPage.jsx` | 設備狀態 | 每 3 秒 |
| `SOPPage.jsx` | 設備歷史資料 | 切換設備或 started_at 變化時 |
| `Errorlog.jsx` | 異常紀錄 | 每 60 秒 |
| `AIPage.jsx` | 無輪詢，事件驅動 | — |

**資料庫表格**
| 表格 | 說明 |
|------|------|
| `device_data` | 歷史溫濕度，每 10 秒，永久保存 |
| `device_states` | 設備狀態持久化，含 status / temperature / active_sop_json / completed_steps / started_at / updated_at |
| `sop_executions` | 執行歷程主表 |
| `step_records` | 每步驟完成狀態 |
| `sop_templates` | 自訂 SOP |
| `error_logs` | 緊急停止事件紀錄 |

### 開發規範

**常見欄位命名**
| 正確 key | 錯誤 key |
|----------|----------|
| `dwell_time_hours` | `dwell_time` |
| `humidity_rh_percent` | `humidity` |

**Git 提交路徑**
| 檔案 | 正確路徑 |
|------|---------|
| 前端元件 | `client/src/ComponentName.jsx` |
| 前端 AI 子模組 | `client/src/ai/FileName.jsx` |
| 後端模組 | `backend/app/module.py` |
| 模擬器 | `simulator/main.py` |

**DB 結構變更流程（在 backend/ 目錄下）**
```bash
alembic revision --autogenerate -m "描述變更"
alembic upgrade head
```

**自動化指令**
```bash
make install               # 安裝所有依賴
python backend/init_db.py  # 首次初始化資料庫
make dev                   # 啟動全部服務
make clean                 # 深度清理殘留程序
make logs                  # 查看 socat log
```

---

## AI 諮詢 UI 改版規劃（多對話管理）

> 狀態：✅ 完成（2026-03-15）
> 範圍：僅 `client/src/`，後端不需修改

### 檔案結構

```
client/src/
├── AIPage.jsx              ← 主元件（只負責組裝）
└── ai/
    ├── ChatSidebar.jsx     ← 左側欄（對話列表、專案分組、新增/刪除/移動分組）
    ├── ChatArea.jsx        ← 右側對話區（串流輸出、Markdown 渲染、追問建議列）
    ├── MessageBubble.jsx   ← 單則訊息（免責聲明標籤、複製按鈕、計時）
    ├── useAIChat.jsx       ← 所有狀態邏輯 hook（多對話切換、串流控制）
    └── aiStorage.jsx       ← localStorage 讀寫（含舊資料自動遷移、空分組自動清理）
```

### localStorage 資料結構

```js
key:   "dqa_ai_chats_v2"
value: {
  activeConversationId: string,
  conversations: {
    [id: string]: {
      id: string,
      title: string,          // 自動取第一則 user message 前 20 字；點擊可手動改
      projectGroup: string,   // 預設 "未分組"
      createdAt: string,      // ISO 8601
      updatedAt: string,
      messages: Message[]
    }
  },
  projectGroups: string[]
}
```

---

## 系統架構理論

### 架構設計原則

- **解耦設計**：前端 React 只負責狀態呈現；後端 FastAPI 透過異步處理確保 I/O 不阻塞；物理模擬器作為獨立 Process 運作。
- **數位雙生**：非單純數據呈現，需透過模擬器模擬設備物理慣性（溫度平衡、熱損失）。
- **設計原則**：軟體應主動監控設備狀態並提示操作員異常，區分「軟體可驗證」步驟與「需現場確認」步驟。

### 物理模擬引擎

- 斜率控制：從 `get_ramp_rate()` 動態讀取各標準速率限制。
- 收斂演算法：目標值與實測值接近時引入 Jitter 模擬真實物理行為。
- 時間戳：統一使用 `_now_utc()` 產生 UTC-aware datetime，避免 naive/aware 混用。
- 狀態機行為：`EMERGENCY` 停止輸出微幅抖動；`PAUSED` 鎖定當前數值；`FINISHING` 降溫至 25°C 後回 `IDLE`，清空 `running_sop_id`。

### 硬體通訊

- 通訊協議：模擬 KSON AICM 工業協議，採 RS-232 串口模式。
- 虛擬橋接（socat）：建立 `/dev/ttys000` 與 `/dev/ttys001` 對。
- 數據流：`Simulator → socat → AICM_CACHE → FastAPI → React Frontend`
- Phase 3 由 `serial_reader.py` 進行異步讀取（目前未啟用）

### 前端 UI/UX 規範

- 佈局策略：40/60 雙欄式（SOPPage）；GitHub dark 統一主題。
- 捲動架構：`#root` flex column + `height: 100vh`；各頁面自己管理內部捲動。
- per-device state：SOPPage 的法規選擇、步驟勾選、safetyChecked、chartHistory 都儲存在 `deviceStates[deviceId]`，切換設備不互相干擾。
- 濕度顯示：低溫段（< 0°C）一律隱藏或存 null。
- 免責聲明：AI 諮詢頁面採雙層保護——前端 `DISCLAIMER` 常數固定顯示；後端 system prompt 強制 AI 標注法規版本號。