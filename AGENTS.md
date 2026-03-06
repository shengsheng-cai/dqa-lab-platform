# 🧬 DQALab Digital Twin — AI Agent Context

給 AI 協作工具（Claude、Cursor、Copilot）閱讀的專案背景與開發規範。每個開發階段結束後更新「當前狀態快照」區塊即可，其餘理論部分不動。

---

## 當前狀態快照（2026-03-04）

### 已完成模組
| 模組 | 位置 | 說明 |
|------|------|------|
| 物理模擬引擎 | `backend/app/main.py` | 升降溫斜率、每 10 秒寫 DB、7 天自動清理 |
| 環境測試標準 | `backend/app/standards.py` | 三層 STANDARD_TREE，6 法規 62 條件 |
| SOP 路由 | `backend/app/sop.py` | 標準樹展開、三步驟選擇 API |
| 執行紀錄 | `backend/app/sop_execution.py` | 儲存/讀取 SOP 執行歷程 |
| CSV 報告 | `backend/app/reports.py` | ISO 17025 格式，big5，PASS/FAIL 判定 |
| 儀表板 | `client/src/Dashboard.jsx` | 六狀態顏色，axios，Recharts 趨勢圖 |
| SOP 執行頁 | `client/src/SOPPage.jsx` | 三步驟法規選擇、步驟追蹤、安全確認 |
| QA 報告模板 | `docs/templates/` `backend/templates/` | 對外 Word 模板（兩層報告架構） |

### 規劃中（尚未開始）
- `client/src/FixturesPage.jsx` — 治具管理
- `client/src/IssuesPage.jsx` — 異常看板
- `client/src/DevicesPage.jsx` — 15 台溫箱總覽
- `backend/app/auth.py` — JWT 認證
- RS-485 真實串口通訊（Phase 3）

### 狀態機（6 種）
`IDLE` → `RUNNING` ↔ `PAUSED` → `FINISHING` → `IDLE`
`RUNNING` → `EMERGENCY`（任意時刻）
`OFFLINE`（串口斷線）

### 報告兩層架構
- 內部：CSV（系統自動，ISO 17025，工程師自存）
- 對外：`QA_Test_Report_Template.docx`（工程師填入 + 主管簽名）

---

## 1. 系統架構理論

- **解耦設計**：前端 React 只負責狀態呈現，不直接控制硬體；後端 FastAPI 透過異步處理確保 I/O 不阻塞；物理模擬器作為獨立 Process 運作。
- **數位雙生**：非單純數據呈現，需透過 `simulator/main.py` 模擬設備物理慣性（溫度平衡、熱損失）。

---

## 2. 硬體通訊實作細節

- **通訊協議**：模擬 KSON AICM 工業協議，採 RS-232 串口模式。
- **虛擬橋接 (socat)**：建立 `/dev/ttys000` 與 `/dev/ttys001` 對。
  - PTY_A（模擬器端）：接收寫入並回傳模擬數據。
  - PTY_B（API 監聽端）：由 `serial_reader.py` 進行異步讀取。
- **數據流**：`Simulator → socat → serial_reader.py → AICM_CACHE → FastAPI → React Frontend`

---

## 3. 物理模擬引擎理論

- **斜率控制**：模擬溫箱升降溫速度（例如 3.0°C/min），邏輯位於 `main.py` 的 `update_physics()`。
- **收斂演算法**：目標值與實測值接近時引入 Jitter 模擬真實物理行為。
- **狀態機行為**：
  - `EMERGENCY`：立即停止所有輸出，數值歸零。
  - `PAUSED`：鎖定當前數值，暫停演算法，保留環境上下文。
  - `FINISHING`：執行降溫收尾，引導至安全室溫後回 `IDLE`。

---

## 4. 前端 UI/UX 規範

- **佈局策略**：40/60 雙欄式。
  - 40% 左側：即時趨勢圖（Recharts）與數值監控，Pulse 動畫提示通訊狀態。
  - 60% 右側：SOP 流程控制與參數設定區。
- **響應式**：使用 `vh/vw` 或彈性佈局，確保 15 吋 MacBook 不產生捲軸。

---

## 5. 模型分工指引

- **🚀 Code_Master (Llama 3.3)**：React Component 渲染效能、CSS 佈局、FastAPI RESTful 規範。
- **🧠 Logic_Engine (GPT-OSS)**：物理演算法數學正確性、狀態機邊界條件、多執行緒資源衝突。
- **📚 Doc_Analyzer (Kimi K2)**：ISO 17025 數據完整性、技術文件與 API 文件一致性。

---

## 6. 自動化指令

```bash
make dev      # 啟動並隱藏輪詢日誌
make clean    # 深度清理殘留的 socat 與 python pid
```