# 🧬 DQA Lab Digital Twin — AI Agent Context

給 AI 協作工具閱讀的專案背景與開發規範。

---

## 技術規格

### 資料庫（13 張）

| 表名 | 說明 |
|------|------|
| `device_data` | 設備感測器時序資料（溫度、濕度） |
| `device_states` | 設備狀態機（IDLE/RUNNING/PAUSED/FINISHING）+ sim_phase |
| `sop_executions` | SOP 執行記錄（設備、條件、開始/結束時間） |
| `step_records` | SOP 執行步驟確認紀錄 |
| `error_logs` | 設備異常/錯誤日誌 |
| `fixtures` | 治具主檔（庫存、狀態） |
| `fixture_loans` | 治具借還記錄（含排程外鍵 `schedule_id`） |
| `users` | 工程師帳號（含角色 admin/keeper/engineer） |
| `demo_tokens` | 訪客唯讀 Token |
| `sop_templates` | SOP 步驟模板 |
| `purchase_orders` | 治具採購單 |
| `schedules` | 測試排程（甘特圖資料來源） |
| `device_blocked_periods` | 設備不可用時段 |

### 狀態機與模擬

@.claude/rules/state-machine.md

### API 慣例、存取控制、LINE 推播

@.claude/rules/api-conventions.md

### 前端元件結構與佈局

@.claude/rules/frontend.md

### 測試規範

@.claude/rules/testing.md

---

## AI 協作方式

@.claude/rules/workflow.md

---

## 常用指令

```bash
make install                   # 安裝所有依賴
python backend/init_db.py      # 初始化資料庫（首次）
make dev                       # 啟動全部服務
make clean                     # 清理殘留程序

# 資料庫遷移（backend/ 目錄下）
alembic revision --autogenerate -m "描述"
alembic upgrade head

# 後端單元測試
cd backend && python -m pytest  # 執行全套測試（45 tests）
```

---

## 已完成功能模組

| 模組 | 說明 |
|------|------|
| 物理模擬引擎 | sim_phase 狀態機、多 cycle、重啟自動恢復 |
| 環境測試標準 | 5 法規 78 條件，三層 STANDARD_TREE |
| SOP 執行 | 自動確認步驟、自動存報告 |
| ISO 17025 報告 | PDF 報告生成（含 GUM 量測不確定度 Type A/B/uc/U）、CSV 報告 |
| 治具管理 | 借出/歸還/逾期/盤點/採購/汰換，Excel upsert；與排程聯動（預約→借出→歸還） |
| 排程系統 | 甘特圖、自動排程、即時預覽、不可用時段、自動推進；與 AI 聯動（申請此測試預填） |
| AI 諮詢 | Gemini 2.5 Flash-Lite、RAG 檢索、多輪對話；推薦條件→直接申請排程 |
| 三模組連動 | ✅ AI→排程、排程→治具預約、SOP→治具借出、完成→治具歸還 |
| 存取控制 | 4 層（admin/keeper/engineer/guest）、IP Rate Limiting |
| LINE Bot | 緊急停止推播給管理者個人 + 指定群組（LINE_GROUP_ID）；群組 query 模式（Bot 加入工作群組，OP 問 → Bot reply，不耗額度） |

### 三模組連動流程

```
① AI 推薦測試條件
    ↓ [📅 申請此測試] 按鈕（streaming 末尾 META [APPLY:id1,id2] marker）
② 申請排程（條件預填 + 選設備 + 選治具）
    ↓
③ 排程確認 → 治具自動預約（reserved）+ 設備立即啟動 SOP
    ↓
④ 測試開始 → 設備 RUNNING + 治具自動借出（loaned）
    ↓
⑤ 測試完成 → 治具自動歸還 + 產生 ISO 17025 報告
```

連動實作關鍵：
- `schedule_fixtures` 中間表 + `fixture_loans.schedule_id` 外鍵
- 排程確認時呼叫 `_transfer_reserved_fixtures`
- 設備 RUNNING 時預約治具自動轉借出；測試完成時自動歸還

---

## 本地開發環境

```
macOS M2
後端：http://localhost:8000
前端：http://localhost:5173
API 文件：http://localhost:8000/docs
```
