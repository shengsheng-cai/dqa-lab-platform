# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘理論部分不動。

---

## 當前狀態快照（2026-03-11）

### 已完成模組

| 模組 | 位置 | 說明 |
|------|------|------|
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率、每 10 秒寫 DB、ISO 17025 永久保存、每台設備獨立 DB session |
| 設備狀態持久化 | `backend/app/main.py` + `models.py` | DeviceState 表、updated_at 自動更新、重啟後自動恢復 RUNNING 狀態與步驟清單 |
| 環境測試標準 | `backend/app/standards.py` | 三層 STANDARD_TREE，6 法規 64 條件 |
| SOP 路由 + 執行紀錄 | `backend/app/sop.py` | 標準樹展開、三步驟選擇 API、執行紀錄儲存讀取 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，PASS/FAIL 工程師人工判定 |
| 異常紀錄 | `backend/app/errors.py` | EMERGENCY 自動寫入 error_logs |
| 歷史資料 API | `backend/app/main.py` | `GET /api/devices/{id}/history`，從 started_at 至今每分鐘聚合 |
| AI 法規諮詢後端 | `backend/app/ai.py` | `POST /api/ai/standards-query`（非串流）、`POST /api/ai/standards-query-stream`（串流），Ollama qwen2.5:7b，多輪對話，強制繁體中文 |
| AI 法規諮詢前端 | `client/src/AIPage.jsx` | 串流逐字輸出、Markdown 渲染、快速提問側欄（可收合）、中途停止保留內容、複製回覆、回覆計時、localStorage 持久化 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態、趨勢圖雙 Y 軸可切換 5 台、步驟進度條、倒數計時器、執行紀錄列表（30s 刷新）|
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟法規選擇（per-device）、步驟依序追蹤、SP+PV 波型曲線、執行資訊面板 |
| 異常看板 | `client/src/Errorlog.jsx` | 統計卡片 + 完整紀錄列表，10s 自動刷新 |
| QA 報告模板 | `docs/templates/` | 對外 Word 模板 |

### 下一步待開發（依優先度）

1. **AI 治具管理助手**（`/api/ai/fixture-recommend`）— 後端 + 前端，構思中

2. **AI 設備排程預估**（`/api/ai/schedule-estimate`）

3. **步驟軟體確認 vs 現場確認**（Phase 3 前再做）

4. **Phase 3**：多台設備架構、治具資料庫、認證系統、RS-485 真實通訊

### AI 模組技術規格
- 模型：`qwen2.5:7b`（本機 Ollama，`http://localhost:11434`）
- 備用：`qwen2.5:14b`（需關閉其他應用釋放記憶體）
- timeout：180 秒
- 端點：`/api/ai/standards-query`（非串流）、`/api/ai/standards-query-stream`（串流，前端主要使用）
- system prompt：4 條語言規則（禁簡體、禁 code block、限定推薦清單、強制繁體中文），內建 STANDARD_TREE 64 個測試條件摘要
- user message 前綴：`[請用繁體中文回覆]`，防止長對話語言飄移
- 多輪對話：history 陣列帶入
- 前端儲存：`localStorage`，key = `dqa_ai_chat_history`

### 狀態機（6 種）
```
IDLE → RUNNING ↔ PAUSED → FINISHING → IDLE
RUNNING → EMERGENCY（任意時刻）
OFFLINE（串口斷線）
```

### 資料庫表格
| 表格 | 說明 |
|------|------|
| `device_data` | 歷史溫濕度，每 10 秒，永久保存 |
| `device_states` | 設備狀態持久化，含 status / temperature / active_sop_json / completed_steps / started_at / updated_at |
| `sop_executions` | 執行歷程主表，含 operator / device_id / test_started_at（DateTime）/ test_ended_at（DateTime）|
| `step_records` | 每步驟完成狀態（execution_id ForeignKey、completed Boolean）|
| `sop_templates` | 自訂 SOP |
| `error_logs` | 緊急停止事件紀錄（created_at DateTime，ISO 8601 序列化）|

### DB 結構變更流程（在 backend/ 目錄下）
```bash
alembic revision --autogenerate -m "描述變更"
alembic upgrade head
```

### 常見欄位命名規範
| 正確 key | 錯誤 key |
|----------|----------|
| `dwell_time_hours` | `dwell_time` |
| `humidity_rh_percent` | `humidity` |

---

## 1. 系統架構理論

- **解耦設計**：前端 React 只負責狀態呈現，不直接控制硬體；後端 FastAPI 透過異步處理確保 I/O 不阻塞；物理模擬器作為獨立 Process 運作。
- **數位雙生**：非單純數據呈現，需透過模擬器模擬設備物理慣性（溫度平衡、熱損失）。
- **設計原則**：軟體應主動監控設備狀態並提示操作員異常，區分「軟體可驗證」步驟與「需現場確認」步驟。

---

## 2. 硬體通訊實作細節

- **通訊協議**：模擬 KSON AICM 工業協議，採 RS-232 串口模式。
- **虛擬橋接 (socat)**：建立 `/dev/ttys000` 與 `/dev/ttys001` 對。
- **數據流**：`Simulator → socat → AICM_CACHE → FastAPI → React Frontend`
- Phase 3 由 `serial_reader.py` 進行異步讀取（目前未啟用）

---

## 3. 物理模擬引擎理論

- **斜率控制**：從 `get_ramp_rate()` 動態讀取各標準速率限制。
- **收斂演算法**：目標值與實測值接近時引入 Jitter 模擬真實物理行為。
- **時間戳**：統一使用 `_now_utc()` 產生 UTC-aware datetime，避免 naive/aware 混用。
- **狀態機行為**：
  - `EMERGENCY`：停止輸出，微幅抖動，自動寫入 error_logs。
  - `PAUSED`：鎖定當前數值，暫停演算法。
  - `FINISHING`：執行降溫收尾，引導至 25°C 後回 `IDLE`，清空 `running_sop_id / standard_id`。

---

## 4. 前端 UI/UX 規範

- **佈局策略**：40/60 雙欄式（SOPPage）。
- **主題**：GitHub dark 統一風格。
- **輪詢策略**：溫濕度數字每 1 秒更新；趨勢圖每 60 秒存一點；執行紀錄每 30 秒刷新；異常看板每 10 秒刷新。
- **捲動架構**：`#root` flex column + `height: 100vh`；各頁面自己管理內部捲動。
- **per-device state**：SOPPage 的法規選擇、步驟勾選、safetyChecked、chartHistory 都儲存在 `deviceStates[deviceId]`，切換設備不互相干擾。
- **AIPage 串流架構**：`fetch` + `ReadableStream`；`streamTextRef`（ref）追蹤即時內容供 `stopStream()` 讀取，避免 closure 問題；`startTimeRef` 計算回覆耗時。

---

## 5. 自動化指令

```bash
make install               # 安裝所有依賴
python backend/init_db.py  # 首次初始化資料庫
make dev                   # 啟動全部服務
make clean                 # 深度清理殘留程序
make logs                  # 查看 socat log
```