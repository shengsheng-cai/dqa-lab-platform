# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘理論部分不動。

---

## 當前狀態快照（2026-03-10 續2）

### 已完成模組

| 模組 | 位置 | 說明 |
|------|------|------|
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率、每 10 秒寫 DB、ISO 17025 永久保存 |
| 設備狀態持久化 | `backend/app/main.py` + `models.py` | DeviceState 表、重啟後自動恢復 RUNNING 狀態與步驟清單 |
| 環境測試標準 | `backend/app/standards.py` | 三層 STANDARD_TREE，6 法規 62 條件 |
| SOP 路由 + 執行紀錄 | `backend/app/sop.py` | 標準樹展開、三步驟選擇 API、執行紀錄儲存讀取 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，PASS/FAIL 工程師人工判定 |
| 異常紀錄 | `backend/app/errors.py` | EMERGENCY 自動寫入 error_logs |
| 歷史資料 API | `backend/app/main.py` | `GET /api/devices/{id}/history`，從 started_at 至今每分鐘聚合 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態顏色、趨勢圖可切換 5 台設備（每分鐘一點）、步驟進度條、執行紀錄列表 |
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟法規選擇、步驟依序追蹤、SP+PV 波型曲線、執行資訊面板、安全確認、重啟後恢復 |
| 異常看板 | `client/src/Errorlog.jsx` | 統計卡片 + 完整紀錄列表 |
| QA 報告模板 | `docs/templates/` | 對外 Word 模板 |

### 下一步待開發（依優先度）

1. **Dashboard 設備切換按鈕恢復**
   - 趨勢圖右上角加回 CH01~CH05 切換按鈕（DeviceCard 點擊已可切換，但右上角快捷按鈕遺失）

2. **Reports 頁面前端元件**
   - 後端 API 已完成（`/api/reports/list`、`/api/reports/csv/{id}`）
   - 只需要前端獨立頁面

3. **步驟軟體確認 vs 現場確認（規劃中）**
   - 軟體確認型：系統根據即時數據判斷是否正常，異常時顯示警告
   - 現場確認型：操作員親自到場後勾選
   - 需在 `standards.py` 每個步驟加上類型標記與檢查條件

### 已刪除 / 整理的檔案
- `backend/app/database.py` — 已刪，功能在 models.py
- `backend/app/sop_execution.py` — 已合併進 sop.py
- `backend/templates/` — 已刪，與 docs/templates/ 重複
- `docs/screenshots/demo.gif` — 已刪
- `client/public/vite.svg` — 已刪
- `backend/app/serial_reader.py` — Phase 3 預留，已加註解，尚未啟用

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
| `device_states` | 設備狀態持久化，含 status / temperature / active_sop_json / completed_steps / started_at |
| `sop_executions` | 執行歷程主表，含 operator / device_id / test_started_at / test_ended_at |
| `step_records` | 每步驟完成狀態 |
| `sop_templates` | 自訂 SOP |
| `error_logs` | 緊急停止事件紀錄 |

### DB 結構變更注意事項
```bash
make clean && rm backend/test.db && python backend/init_db.py && make dev
```
> ⚠️ 真實硬體在跑時不可刪 DB，需改用 Alembic 遷移（Phase 3 前完成）

### 報告架構
- 內部：CSV（系統自動，ISO 17025，工程師自存）
- 對外：`QA_Test_Report_Template.docx`（工程師填入 + 主管簽名）

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
- **狀態機行為**：
  - `EMERGENCY`：停止輸出，微幅抖動，自動寫入 error_logs。
  - `PAUSED`：鎖定當前數值，暫停演算法。
  - `FINISHING`：執行降溫收尾，引導至 25°C 後回 `IDLE`。

---

## 4. 前端 UI/UX 規範

- **佈局策略**：40/60 雙欄式（SOPPage）。
- **主題**：GitHub dark 統一風格。
- **響應式**：確保 15 吋 MacBook 不產生捲軸。
- **輪詢策略**：溫濕度數字每 1 秒更新；趨勢圖每 60 秒存一點。
- **捲動架構**：`#root` flex column + `height: 100vh`；`<main>` overflow hidden；各頁面自己管理內部捲動（Dashboard: `overflowY: auto`；SOPPage: monitor-side `overflow-y: auto` + scroll-wrapper `overflow-y: auto`）

---

## 5. 自動化指令

```bash
make install               # 安裝所有依賴
python backend/init_db.py  # 首次初始化資料庫（或 DB 結構變更後重建）
make dev                   # 啟動全部服務
make clean                 # 深度清理殘留程序
make logs                  # 查看 socat log
```