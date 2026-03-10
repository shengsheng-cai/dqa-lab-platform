# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制。

## 專案背景

工業環境測試涉及眾多國際標準（IEC、EN、DNV、NMEA 等），即使有 SOP 可循，測試人員仍需大量人工比對法規參數，細微的判讀差異就可能導致測試條件設定錯誤。加上各標準版本更迭頻繁、新人培訓成本高，整個流程對人力依賴程度極高，人為疏失風險難以有效控制。

本專案將測試流程數位化，把 6 大國際標準的 64 個測試條件直接內建進系統，操作人員透過三步驟選擇法規、版本、測試條件後，參數自動帶入，無需手動比對文件。搭配物理模擬引擎，在硬體不在場時也能完整執行開發與驗證流程，降低人力成本與培訓門檻。

---

## 規劃中：AI 輔助模組

**治具管理助手** — 使用者描述待測產品與需求，LLM 推理對應所需治具組合，自動產出借用申請送管理者確認。

**設備排程預估** — 使用者提交測試需求，LLM 結合現有排程資料計算最快可用時間窗口，管理者只需最終確認。

**法規諮詢助手** — 使用者以自然語言描述產品與目標，LLM 對應建議法規版本與測試條件，適用於開案前初步評估。

---

## 核心功能

- **多設備同步監控** — 5 台溫箱（KSON_CH01～CH05）各自獨立模擬運作，SELECT DEVICE 按鈕即時反映各設備狀態顏色
- **儀表板** — 即時溫濕度監控（每秒更新）、趨勢圖雙 Y 軸（溫度/濕度獨立刻度，每分鐘一點，完整測試時長 + Brush 縮放）、步驟進度條、六種狀態顏色區分
- **三步驟法規選擇** — 法規 → 版本/Class → 測試條件，6 大法規、64 個官方測試條件，各設備法規選擇獨立儲存、切換設備不互相干擾
- **SOP 步驟依序確認** — 步驟必須依序勾選，取消時連鎖清除後續，Optional 步驟可跳過，每次勾選即時同步後端 `completed_steps`
- **完整波型曲線** — SP 目標曲線（虛線）與 PV 實際曲線（實線）疊加顯示，X 軸為完整測試時長，循環測試幾次畫幾個波
- **執行資訊面板** — Pgm / Step / Free Time / Cycle / Now Time / End Time，對應 KSON 溫箱面板格式
- **物理模擬引擎** — 即時升降溫斜率模擬，遵守各標準速率限制，每 10 秒寫 DB，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存
- **started_at 即時記錄** — SOP 啟動時立即寫入開始時間，符合 ISO 17025 §7.5.1 技術記錄要求
- **狀態自動切換** — 待機/執行中畫面自動切換，暫停切換、正常停止、緊急停止邏輯完整；FINISHING→IDLE 正確清空 running_sop_id
- **異常看板** — 緊急停止自動寫入事件紀錄，記錄當下溫濕度與執行中 SOP，每 10 秒自動刷新
- **ISO 17025 測試報告** — 7 節格式，big5 編碼 Excel 相容，PASS/FAIL 由授權工程師人工判定，RFC 5987 編碼檔名
- **上架安全確認** — 啟動前強制確認四項注意事項，全勾才能啟動
- **重啟恢復** — 伺服器重啟後自動恢復 RUNNING 狀態、步驟進度與 SOP 資料

## 支持的環境測試標準（64 個測試條件）

| 法規 | 版本 | 測試數 | 主要測試項目 |
|------|------|---------|------------|
| **IEC 60068** | 2-1 / 2-2 / 2-14 / 2-30 | 12 | 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環/熱衝擊 Na/Nb、濕熱循環 Db |
| **EN 50155** | 2017 / 2007 | 19 | OT1~OT6 高溫/低溫（含新增 OT5 低溫 -40°C）、ST1 開機延伸、隧道快速溫變、濕熱循環 |
| **IEC 61850-3** | Ed.2:2013 / Ed.1:2002 | 9 | Class C1/C2/C3 各自乾熱+冷測+濕熱 |
| **DNV** | CG-0339:2019 / Std.Cert.2.4 | 14 | Class A/B/C/D，C/D 冷測強制，穩態/循環濕熱，新增 Std.Cert.2.4 Class C/D 乾熱 |
| **KEMA** | KEMA KEUR | 4 | 乾熱、冷測、濕熱穩態、溫度循環 |
| **NMEA** | IEC 61162-1 / 61162-3 | 7 | 受保護/暴露裝置，NMEA 0183/2000 |

## 快速啟動

```bash
# 1. 安裝所有依賴（後端 + 模擬器 + 前端）
make install

# 2. 初始化資料庫（首次執行必須）
python backend/init_db.py

# 3. 一鍵啟動
make dev
```

> ⚠️ DB 結構有變更時：改 `models.py` → `alembic revision --autogenerate -m "描述"` → `alembic upgrade head`（需在 `backend/` 目錄下執行）

啟動後開啟 `http://localhost:5173`，或前往 `http://localhost:5173/sop` 執行測試。

互動式 API 文件：`http://localhost:8000/docs`

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態（KSON_CH01，向後相容） |
| GET  | `/api/devices` | 所有設備即時狀態（含 total_steps、completed_steps、started_at） |
| GET  | `/api/devices/{id}/history` | 設備歷史溫濕度（每分鐘聚合，從 started_at 至今） |
| GET  | `/api/sop/` | SOP 列表 |
| GET  | `/api/sop/standards/tree` | 三層標準樹（法規→版本→測試條件） |
| POST | `/api/sop/start` | 啟動 SOP |
| POST | `/api/devices/{id}/progress` | 更新步驟完成數 |
| POST | `/api/sop-executions/` | 儲存執行紀錄（含 device_id、operator、test_started_at） |
| GET  | `/api/sop-executions/{id}` | 讀取執行紀錄 |
| GET  | `/api/reports/csv/{id}` | 下載測試報告 CSV（ISO 17025 七節格式，RFC 5987 檔名） |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表 |
| POST | `/api/stop/{device_id}/emergency` | 緊急停止 |
| POST | `/api/stop/{device_id}/pause` | 暫停切換（RUNNING ↔ PAUSED） |
| POST | `/api/stop/{device_id}/normal` | 正常停止（自動降溫回 IDLE） |

## 技術堆棧

後端：FastAPI、Pydantic v2、SQLAlchemy 2.0、asyncio、SQLite
前端：React 18、Vite、Recharts、Axios
環境：Python 3.9+、Node.js 16+、macOS/Linux（需要 socat）

## 延伸文件

- [系統架構與開發進度](./docs/architecture.md)
- [更新紀錄](./CHANGELOG.md)
- [QA 測試報告模板](./docs/templates/QA_Test_Report_Template.docx)

## 授權

MIT License