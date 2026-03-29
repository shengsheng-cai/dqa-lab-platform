# 🧬 DQA Lab Digital Twin — AI Agent Context

給 AI 協作工具閱讀的專案背景與開發規範。

---

## 技術規格

### 資料庫（15 張）

device_data | device_states | sop_executions | step_records | error_logs | fixtures | fixture_loans | users | demo_tokens | sop_templates | purchase_orders | schedules | device_blocked_periods | line_bind_requests | notification_failures

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
```

---

## 已完成功能模組

| 模組 | 說明 |
|------|------|
| 物理模擬引擎 | sim_phase 狀態機、多 cycle、重啟自動恢復 |
| 環境測試標準 | 5 法規 78 條件，三層 STANDARD_TREE |
| SOP 執行 | 自動確認步驟、自動存報告、LINE 五時機推播 |
| ISO 17025 報告 | PDF 報告生成（含 GUM 量測不確定度 Type A/B/uc/U）、CSV 報告 |
| 治具管理 | 借出/歸還/逾期/盤點/採購/汰換，Excel upsert |
| 排程系統 | 甘特圖、自動排程、即時預覽、不可用時段、自動推進 |
| AI 諮詢 | Gemini 2.5 Flash-Lite、RAG 檢索、多輪對話 |
| 存取控制 | 4 層（admin/keeper/engineer/guest）、IP Rate Limiting |
| LINE Bot | 推播、綁定申請審核、取消申請、失敗記錄 |

---

## 本地開發環境

```
macOS M2
後端：http://localhost:8000
前端：http://localhost:5173
API 文件：http://localhost:8000/docs
```
