# DQA Lab Digital Twin

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

基於 FastAPI + React 的實驗室數位孿生平台，整合物理模擬引擎與國際環境測試標準，實現溫箱設備的遠端自動化控制。

## 專案背景

工業環境測試涉及眾多國際標準（IEC、EN、DNV、NMEA 等），即使有 SOP 可循，測試人員仍需大量人工比對法規參數，細微的判讀差異就可能導致測試條件設定錯誤。加上各標準版本更迭頻繁、新人培訓成本高，整個流程對人力依賴程度極高，人為疏失風險難以有效控制。

本專案將測試流程數位化，把 6 大國際標準的 62 個測試條件直接內建進系統，操作人員透過三步驟選擇法規、版本、測試條件後，參數自動帶入，無需手動比對文件。搭配物理模擬引擎，在硬體不在場時也能完整執行開發與驗證流程，降低人力成本與培訓門檻。

---

## 規劃中：AI 輔助模組

以下模組對應開案前的討論與評估流程，由 LLM 輔助處理非結構化輸入，將人工協調工作轉為系統引導流程。

**治具管理助手**
使用者描述待測產品與需求，LLM 推理對應所需治具組合，自動產出借用申請送管理者確認。

**設備排程預估**
使用者提交測試需求，LLM 結合現有排程資料計算最快可用時間窗口，管理者只需最終確認。

**法規諮詢助手**
使用者以自然語言描述產品與目標，LLM 對應建議法規版本與測試條件，適用於開案前初步評估。

---

## 核心功能

- **多設備同步監控** — 5 台溫箱（KSON_CH01～CH05）各自獨立模擬運作，SELECT DEVICE 按鈕即時反映各設備狀態顏色
- **儀表板** — 即時溫濕度監控、60 秒趨勢圖、六種狀態顏色區分、歷史執行紀錄列表與一鍵下載報告
- **三步驟法規選擇** — 法規 → 版本/Class → 測試條件，6 大法規、62 個官方測試條件，動態載入
- **物理模擬引擎** — 即時升降溫斜率模擬，遵守各標準速率限制，每 10 秒寫 DB，依 ISO/IEC 17025:2017 §7.5 & §8.4 永久保存量測記錄
- **SOP 動態管理** — 依測試類型自動生成客制化步驟，Step 1、2 啟動自動勾選，含進度條顯示
- **狀態自動切換** — 待機/執行中畫面自動切換，暫停切換、正常停止、緊急停止邏輯完整
- **異常看板** — 緊急停止自動寫入事件紀錄，記錄當下溫濕度與執行中 SOP
- **ISO 17025 測試報告** — 7 節格式，big5 編碼 Excel 相容，PASS/FAIL 由授權工程師人工判定，可從執行紀錄列表補下載
- **上架安全確認** — 啟動前強制確認四項注意事項，全勾才能啟動

## 支持的環境測試標準（62 個測試條件）

| 法規 | 版本 | 測試數 | 主要測試項目 |
|------|------|---------|------------|
| **IEC 60068** | 2-1 / 2-2 / 2-14 / 2-30 | 12 | 冷測 Ab/Ad、乾熱 Ba/Bb、溫度循環/熱衝擊 Na/Nb、濕熱循環 Db |
| **EN 50155** | 2017 / 2007 | 18 | OT1~OT6 高溫/低溫、ST1 開機延伸、隧道快速溫變、濕熱循環 |
| **IEC 61850-3** | Ed.2:2013 / Ed.1:2002 | 9 | Class C1/C2/C3 各自乾熱+冷測+濕熱 |
| **DNV** | CG-0339:2019 / Std.Cert.2.4 | 12 | Class A/B/C/D，C/D 冷測強制，穩態/循環濕熱 |
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

啟動後開啟 `http://localhost:5173`，或前往 `http://localhost:5173/sop` 執行測試。

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET  | `/api/latest` | 即時溫濕度與狀態 |
| GET  | `/api/devices` | 所有設備即時狀態 |
| GET  | `/api/sop/` | SOP 列表 |
| GET  | `/api/sop/standards/tree` | 三層標準樹（法規→版本→測試條件） |
| POST | `/api/sop/start` | 啟動 SOP |
| POST | `/api/sop-executions/` | 儲存執行紀錄 |
| GET  | `/api/sop-executions/{id}` | 讀取執行紀錄 |
| GET  | `/api/reports/csv/{id}` | 下載測試報告 CSV |
| GET  | `/api/reports/list` | 所有執行紀錄列表 |
| GET  | `/api/errors/` | 異常紀錄列表 |
| POST | `/api/stop/{device_id}/emergency` | 緊急停止 |
| POST | `/api/stop/{device_id}/pause` | 暫停切換（RUNNING ↔ PAUSED） |
| POST | `/api/stop/{device_id}/normal` | 正常停止（自動降溫回 IDLE） |

互動式 API 文件：`http://localhost:8000/docs`

## 技術堆棧

後端：FastAPI、Pydantic、SQLAlchemy、asyncio、SQLite
前端：React 18、Vite、Recharts、Axios
環境：Python 3.9+、Node.js 16+、macOS/Linux（需要 socat）

## 延伸文件

- [系統架構與開發進度](./docs/architecture.md)
- [更新紀錄](./CHANGELOG.md)
- [QA 測試報告模板](./docs/templates/QA_Test_Report_Template.docx)

## 授權

MIT License