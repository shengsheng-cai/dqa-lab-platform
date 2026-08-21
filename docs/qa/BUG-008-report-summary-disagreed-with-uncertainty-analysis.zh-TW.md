# BUG-008 — 報告的數據統計跟自己的不確定度分析取了不同的資料窗，PDF 與 CSV 的平均溫因此對不上

[English](BUG-008-report-summary-disagreed-with-uncertainty-analysis.md) · 繁體中文

| 項目 | 內容 |
|---|---|
| **缺陷編號** | BUG-008 |
| **狀態** | 已修正 |
| **嚴重度** | Medium |
| **優先度** | Medium |
| **元件** | SOP 執行紀錄報告產生 — 數據統計計算（`reports.py`、`uncertainty.py`） |
| **環境** | FastAPI 後端，任何部署環境；只要執行紀錄有溫度目標、走一般「升溫再停留」的感測曲線就會發生——不是邊角案例 |
| **發現方式** | ISO/IEC 17025 §7.8.3.1 合規性審查，2026-08-08。2026-08-09 修法時的四關審查再延伸發現同一個矛盾也出現在 CSV 報告 |
| **回報者** | 蔡聖生 |
| **修正 commit** | `59188105590575114d666c315857f2fe9f8fff35` |

## 摘要

一份 PDF 報告自己的章節互相矛盾，CSV 報告則跟兩邊都對不上。

第 5 節（量測不確定度分析）用**穩定段**——落在 SOP 溫度容差範圍內的樣本——算平均值，因為 GUM 不確定度計算本來就該用這段資料。第 6 節（數據統計）的最高／最低／平均值卻是拿**整個資料窗**算的，連升溫階段都算進去。CSV 報告自己的數據統計那節做的是一樣的全窗口運算，而且完全沒有用到不確定度模組。

同一筆執行紀錄，三個數字，三個不同的資料窗。

## 受影響的路徑

| 路徑 | 錯誤行為 |
|---|---|
| `reports.py` — `_build_pdf`，第 6 節「數據統計」 | `temp_max`/`temp_min`/`temp_avg`/`humi_avg` 用 `sum(temps)/len(temps)` 等公式對整個 `device_records` 資料窗計算，無視前面幾行才為第 5 節算出來的 `u_temp`/`u_humi` |
| `reports.py` — `download_csv_report`，第 5 節「測試數據統計」 | 同樣是全窗口運算；完全沒有呼叫 `unc.calc_temp`/`calc_humi`，所以它自己的「量測不確定度」那一列是寫死的佔位文字，不是算出來的數值 |

## 前置條件

- 執行紀錄的感測資料同時涵蓋升溫階段（在溫度容差範圍外）與停留／穩定階段（在範圍內）——這幾乎是每一次真實溫度測試的常態，畢竟升溫時間本來就是曲線的一部分。
- SOP 有設定 `high_temperature`／`target_temperature`，所以會嘗試進行不確定度分析（`target_high is not None`）。

## 在修正前的版本上重現

1. 執行任一有溫度目標的 SOP 到完成（例如 `iec60068_ab_-40_16h`），或為既有執行紀錄灌入涵蓋升溫段加停留段的感測資料。
2. 下載該筆執行紀錄的 PDF 報告，比對第 5.1 節（量測結果：溫度 = ... ± U）印出的平均溫，跟第 6 節（數據統計）的平均溫度。
3. 下載同一筆執行紀錄的 CSV 報告，把它的平均溫度拿去跟上面兩個 PDF 數字比對。

## 預期結果

PDF 第 5.1 節、PDF 第 6 節、CSV 三個數字，對同一筆執行紀錄應該回報同一個平均溫度，而且反映的是不確定度分析原本就在用的那個穩定段定義。

## 實際結果

三個不同的數字。第 6 節與 CSV 的全窗口平均會被資料窗裡佔多數的那段拉走——以低溫試驗來說，就是被升溫階段的常溫資料拉高；而第 5.1 節的穩定段平均則落在實際的目標條件附近。CSV 另外還在不確定度那一列印出寫死的佔位文字（「待儀器校正證書確認」），而不是任何算出來的數值，儘管它顯示的平均值看起來像是有算過。

## 證據

- 矛盾本身：[`reports.py`](../../backend/app/reports.py)——修正前 `_build_pdf` 的第 6 節區塊直接拿 `temps`/`humis` 計算；`download_csv_report` 做法相同，而且完全沒有建立 `u_temp`/`u_humi`。
- 穩定段的定義：[`uncertainty.py`](../../backend/app/uncertainty.py) 的 `calc()`——`stable = [v for v in values if abs(v - target) <= tolerance]` 這段過濾邏輯，修正前第 5 節就已經在用。
- 回歸測試：
  [`test_reports_degradation.py`](../../backend/tests/test_reports_degradation.py)
  （`test_summary_stats_matches_uncertainty_mean_not_full_window_average`、
  `test_csv_report_avg_temp_matches_uncertainty_stable_segment`）、
  [`test_uncertainty.py`](../../backend/tests/test_uncertainty.py)
  （`test_stable_segment_filter`）。

## 根因

同一個統計量被算了三次，而沒有任何東西讓三者保持一致。第 5 節是為了做真正的 GUM 不確定度分析而寫的，必須用穩定段才誠實——拿升溫階段的資料算平均，沒辦法描述測試條件下的量測重複性。第 6 節比這個功能還早存在，從來沒有跟著改成讀同一段資料；CSV 報告則從頭到尾沒有不確定度分析這個概念，所以它的平均值一直用最簡單的方式寫，也就一直沒變過。

沒有任何機制把這三處計算綁到同一個「數據統計該描述哪一段資料窗」的答案上——三處各自獨立回答這個問題，而在一份自稱呈現一致結果的文件裡，三個答案有兩個是錯的。

## 影響

- ISO/IEC 17025 §7.8.3.1 要求報告的量測結果要伴隨它的不確定度。這裡報告卻同時講了兩個不同的量測結果，而只有其中一個帶不確定度——讀者沒有辦法判斷哪一個才是「正式」的結果。
- 每一份有溫度目標、走一般「升溫再停留」曲線的 PDF 報告都受影響，不是邊角案例。
- 沒有任何存下來的資料是錯的；缺陷出在「已經正確的感測讀數要怎麼彙整顯示」，所以不需要更正任何歷史紀錄——只需要重新產生修正前發出的報告。

## 解法

- `uncertainty.py` 的 `UncertaintyResult` 現在會暴露 `data`——它自己的 `mean` 實際用來計算的那段樣本清單（穩定段，或穩定段不足 5 筆時退回的全段）。
- `reports.py` 新增 `_compute_uncertainties`（PDF 與 CSV 共用，兩者結構上就不可能各自漂到不同的不確定度結果），以及 `_summary_stats`／`_summary_avg`。PDF 第 6 節與 CSV 的數據統計現在都從第 5 節數字所在的同一個 `u.data` 取值，只有在無法進行不確定度分析（沒設定目標）時才退回全資料窗。
- CSV 報告現在第一次會計算 `u_temp`/`u_humi`，所以同一筆執行紀錄的平均溫度跟 PDF 一致。後續產品邊界調整為不接外部校正文件，不確定度列會明示本 Demo 僅估算感測器解析度。
- 濕度的平均值在同一次改動中一併修正，因為它跟溫度走的是完全同一段程式碼。

## 驗證

```bash
cd backend && ../venv/bin/python -m pytest tests/test_reports_degradation.py tests/test_uncertainty.py -v
```

`test_summary_stats_matches_uncertainty_mean_not_full_window_average` 建構一組升溫加停留的資料，讓兩種平均值在數學上保證不同，再斷言數據統計的 helper 回傳的是穩定段的值而非全窗口的值——它鑑別的是修正前的公式，不是僥倖通過。`test_csv_report_avg_temp_matches_uncertainty_stable_segment` 透過真正的 HTTP route 函式（不只是測 helper）驗證同一件事：解碼實際的 CSV 位元組內容，檢查印出來的那一行。
