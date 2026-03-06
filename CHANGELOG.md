# 📝 Changelog

所有版本修改紀錄集中於此，依日期倒序排列。

---

## 2026-03-06（續）

- **feat**: `models.py` 新增 `DeviceState` 表，儲存設備狀態、溫度、active_sop_json，支援重啟後恢復
- **feat**: `main.py` 啟動時從 `DeviceState` 表讀回上次狀態，RUNNING 直接恢復（不降級為 PAUSED）
- **feat**: `main.py` 模擬器每 10 秒同步寫入 `DeviceState`，確保狀態持久化
- **feat**: `main.py` 緊急停止、正常停止、FINISHING→IDLE 時立即同步 `DeviceState`
- **feat**: `sop.py` 啟動 SOP 時將 `active_sop_json` 寫入 `DeviceState`
- **feat**: `main.py` `/api/devices` 回傳 `active_sop_json`，供前端重啟後恢復步驟清單
- **feat**: `SOPPage.jsx` 輪詢時自動從 `active_sop_json` 恢復 `activeSop` 與步驟清單
- **fix**: `App.jsx` `minHeight: 100vh` 改為 `height: 100vh`，修復 SOPPage layout 溢出蓋到其他頁面
- **fix**: `SOPPage.css` `width: 100vw` 改為 `width: 100%`，修復 layout 滲出問題
- **feat**: `SOPPage.jsx` HUMI PV 整合進 TEMP/HUMI TREND 卡片右上角，避免左側卡片被裁切
- **feat**: `Dashboard.jsx` 趨勢圖改為可切換 5 台設備，各自維護獨立 history buffer
- **fix**: `dev_start.sh` 啟動前強制釋放 port 8000 / 5173，避免 make clean 後殘留程序
- **chore**: 刪除根目錄多餘的 `test.db`
- **chore**: 刪除 `backend/app/database.py`（功能已在 models.py，無任何引用）
- **chore**: 刪除 `backend/templates/`（與 docs/templates/ 重複）
- **docs**: `architecture.md` 資料庫表格新增 `device_states`、完成度統計新增持久化/恢復/趨勢圖切換條目
- **chore**: 刪除根目錄多餘的 `test.db`
- **chore**: 刪除 `backend/app/database.py`（功能已在 `models.py`，無任何引用）
- **chore**: 刪除 `backend/templates/`（與 `docs/templates/` 重複）
- **chore**: 刪除 `docs/screenshots/demo.gif`（README 已移除引用）
- **chore**: 刪除 `client/public/vite.svg`（Vite 預設圖示，與專案無關）
- **chore**: `serial_reader.py` 頂部加上 Phase 3 預留說明，明確標示尚未啟用
- **refactor**: `sop_execution.py` 合併進 `sop.py`，統一管理 SOP 相關邏輯，刪除 `sop_execution.py`
- **docs**: `architecture.md` 通訊層 `serial_reader.py` 標記為 Phase 3 預留
- **docs**: `README.md` 專案背景重寫，補充人為疏失風險、培訓成本與多標準對照負擔

---

## 2026-03-06

- **fix**: 移除 `_cleanup_old_data()`，依 ISO/IEC 17025:2017 §7.5 & §8.4 量測數據永久保存，不自動刪除（`main.py`）
- **feat**: `SopExecution` 新增 `operator`（責任人）、`device_id`、`test_started_at`、`test_ended_at` 欄位，符合 §7.5.1 技術記錄責任人要求（`models.py`）
- **feat**: `sop_execution.py` 新增對應欄位的接收與回傳（`ExecutionCreate`、`ExecutionResponse`）
- **fix**: `reports.py` 移除系統自動 PASS/FAIL 判定，改為工程師人工填寫欄位，符合 §7.8.6 & §7.8.7
- **fix**: `reports.py` 原始數據查詢範圍改為依 `test_started_at` / `test_ended_at` 決定，符合 §7.5.2
- **fix**: `reports.py` 移除「認可標準 Accreditation: ISO/IEC 17025:2017」錯誤宣告
- **fix**: `reports.py` 執行紀錄列表新增 `device_id`、`operator`、`test_started_at`、`test_ended_at`
- **feat**: `SOPPage.jsx` SELECT DEVICE 每顆按鈕即時反映各自設備狀態顏色，RUNNING 時加發光效果
- **feat**: `SOPPage.jsx` `STATUS_CONFIG` 新增 `label` 欄位，與 `Dashboard.jsx` 完全一致
- **fix**: `SOPPage.jsx` 控制面板狀態標籤統一使用 `sc.label` 顯示
- **fix**: `SOPPage.jsx` `saveExecution` 補上 `device_id` 傳給後端
- **feat**: `Dashboard.jsx` 執行紀錄表格新增「設備」、「執行人員」、「測試開始」三欄，與後端同步
- **docs**: `README.md` 移除 demo gif（避免壞圖）、移除實驗室範圍區塊、AI 輔助模組移至最前、核心功能更新 17025 描述
- **docs**: `architecture.md` 移除 7 天自動清理描述、更新報告架構為半自動方向、AI 流程移至數據流程圖最前、移除認證機構描述、新增本次所有功能至完成度統計
- **fix**: `dev_start.sh` 移除 cleanup 時自動刪除日誌（保留供 `make logs` 事後查閱）
- **fix**: `dev_start.sh` socat 串口路徑解析改為最多重試 5 秒，避免系統較慢時抓不到路徑
- **fix**: `dev_start.sh` `wait` 改為指定 PID（`$BACK_PID $SIM_PID $CLIENT_PID`），任一服務 crash 即觸發 cleanup
- **fix**: `Makefile` clean 指令移除 recipe 內 `#` 注釋、移除冗餘 `|| true`
- **docs**: `README.md` 快速啟動改用 `make install`、補上 `python backend/init_db.py` 首次初始化步驟、核心功能新增多設備同步監控描述
- **docs**: `architecture.md` TEMP TREND 描述更新為溫濕度雙線含 X 軸、完成度統計更新折線圖說明並新增 dev_start.sh 條目

---

## 2026-03-04（續）

- **feat**: 新增 `ErrorLog` 表（`models.py`），記錄緊急停止事件
- **feat**: 新增 `errors.py` router，`GET /api/errors/` 回傳所有異常紀錄
- **feat**: `emergency_stop()` 觸發時自動寫入 device_id、error_type、當下溫濕度、執行中 SOP（`main.py`）
- **feat**: 新增「異常看板」頁面（`ErrorLog.jsx`），顯示統計卡片與完整紀錄列表
- **feat**: `App.jsx` 導航列新增「異常看板」入口，active 頁面高亮
- **feat**: `Dashboard.jsx` 統一 GitHub dark 主題，新增執行紀錄列表與一鍵下載 CSV
- **feat**: `SOPPage.jsx` 新增即時 TEMP TREND 折線圖（含目標溫度虛線）、EMERGENCY 閃爍、狀態 badge、步驟進度條
- **fix**: 緊急停止後正常停止按鈕可用（`canStop = isActive || isEmergency`）
- **fix**: TEMP/HUMI 卡片加左側 accent 色邊框

---

## 2026-03-04

- **feat**: 新增 `docs/templates/QA_Test_Report_Template.docx` — 對外 QA 測試報告空白模板（8 章節，含封面/目錄/簽名欄，已移除商標）
- **feat**: 新增 `backend/templates/QA_Test_Report_Template.docx` — 供未來後端半自動填入使用
- **feat**: `standards.py` 重構為三層巢狀 `STANDARD_TREE`，新增 IEC 60068 完整系列（Test Ab/Ad/Ba/Bb/Na/Nb/Db）
- **feat**: EN 50155:2017 新增 OT1~OT6 各高溫/低溫分開、ST1 開機延伸溫度、快速溫度變化測試
- **feat**: IEC 61850-3 Ed.2 新增 Class C1/C2/C3 分別測試條件；保留 Ed.1 向後相容
- **feat**: DNV 新增 DNVGL-CG-0339:2019 Class A/B/C/D（含穩態/循環濕熱區分）；保留舊版 Std.Cert.2.4
- **feat**: KEMA 新增乾熱/冷測/濕熱穩態/溫度循環四項測試
- **feat**: NMEA 細分受保護/暴露裝置，NMEA 0183/2000 獨立版本
- **feat**: `STANDARDS_AND_SOPS` 改由 `_build_flat_standards()` 自動展開（向後相容）
- **feat**: `GET /api/sop/standards/tree` 新端點，回傳完整三層結構供前端使用
- **feat**: `sop.py` 更新配合新 `STANDARDS_AND_SOPS` 展開方式
- **perf**: `device_data` 寫入頻率從每秒改為每 10 秒，減少 90% 寫入量
- **feat**: CSV 報告下載按鈕（儲存紀錄後顯示）
- **fix**: CSV 報告編碼改為 big5，解決 macOS Excel 中文亂碼
- **fix**: CSV 報告溫度數值 `round(value, 2)` 防止浮點精度問題
- **feat**: 報告容差從各標準 `temp_tolerance`/`humi_tolerance` 讀取（非寫死 ±2°C）
- **docs**: 新增 `CHANGELOG.md`，集中所有版本 log
- **docs**: 新增 `AGENTS.md`（從 `docs/notes/ai_context.md` 改名並更新）
- **docs**: `README.md` 移除更新紀錄，改連結至 CHANGELOG
- **docs**: `architecture.md` 移除修改紀錄，改連結至 CHANGELOG

---

## 2026-03-03

- **fix**: `include_router` 移至應用層級，修復重複 import（`main.py`）
- **fix**: 物理模擬目標溫度改從 `get_standard()` 讀取（`main.py`）
- **fix**: Dashboard 六種狀態正確顯示任務名稱（`Dashboard.jsx`）
- **fix**: `FINISHING` 降溫完成後自動回 `IDLE`（`main.py`）
- **fix**: 暫停切換改為 `RUNNING ↔ PAUSED` 真正切換（`main.py`）
- **feat**: `SopResponse` 新增 `standard_id` 欄位（`sop.py`）
- **feat**: Pydantic `StartSopRequest` 輸入驗證（`sop.py`）
- **feat**: 上架驗證注意事項確認框（`SOPPage.jsx`）
- **feat**: 待機/執行中畫面自動切換邏輯（`SOPPage.jsx`）
- **feat**: SOP 步驟清單，啟動後自動勾選 Step 1、2（`SOPPage.jsx`）
- **feat**: 註冊 `sop_execution` router，支援執行紀錄 API（`main.py`）
- **feat**: ISO 17025 格式測試報告（`reports.py`）
- **refactor**: `standards.py` 統一步驟為 4 步，移除「啟動測試」步驟
- **refactor**: `init_db()` 合併進 `models.py`，`database.py` 改為轉發層
- **fix**: `datetime.utcnow` 改為 `datetime.now(timezone.utc)`（Python 3.12 相容）

---

## 2026-03-02

- 整合 EN50155、IEC60068 環境測試標準
- 動態 SOP 管理系統
- 前端 SOP 列表動態載入