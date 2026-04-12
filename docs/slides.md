---
marp: true
theme: default
paginate: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700;900&display=swap');

  :root {
    --primary: #1a5fb4;
    --accent: #3584e4;
    --light: #ddeeff;
    --dark: #0d2e5c;
    --text: #1a1a2e;
    --muted: #5a6a7e;
  }

  section {
    font-family: 'Noto Sans TC', 'PingFang TC', sans-serif;
    font-size: 24px;
    color: var(--text);
    background: #f8faff;
    padding: 40px 60px;
  }

  h1 { color: var(--primary); font-size: 1.8em; margin-bottom: 0.3em; }
  h2 {
    color: var(--primary);
    font-size: 1.3em;
    border-left: 5px solid var(--accent);
    padding-left: 14px;
    margin-bottom: 0.8em;
  }

  table {
    width: 100%;
    font-size: 0.82em;
    border-collapse: collapse;
  }
  th {
    background: var(--primary);
    color: white;
    padding: 8px 12px;
  }
  td { padding: 7px 12px; border-bottom: 1px solid #d0dce8; }
  tr:nth-child(even) td { background: #eef4fc; }

  code {
    background: #e8f0fe;
    color: var(--dark);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.88em;
  }
  pre {
    background: #1e2a3a;
    color: #cdd9e5;
    border-radius: 10px;
    padding: 20px 24px;
    font-size: 0.78em;
    line-height: 1.7;
  }
  pre code { background: none; color: inherit; padding: 0; }

  blockquote {
    background: var(--light);
    border-left: 4px solid var(--accent);
    border-radius: 0 8px 8px 0;
    padding: 12px 20px;
    margin: 16px 0;
    color: var(--dark);
    font-size: 0.9em;
  }

  ul { padding-left: 1.4em; }
  li { margin-bottom: 0.4em; line-height: 1.6; }

  /* 頁碼 */
  section::after {
    color: var(--muted);
    font-size: 0.75em;
  }

  /* 封面 */
  section.cover {
    background: linear-gradient(145deg, #0d2e5c 0%, #1a5fb4 60%, #3584e4 100%);
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 60px 80px;
  }
  section.cover h1 {
    color: white;
    font-size: 2.6em;
    font-weight: 900;
    line-height: 1.2;
    margin-bottom: 0.2em;
    border: none;
  }
  section.cover h2 {
    color: #a8c8ff;
    font-size: 1.2em;
    font-weight: 400;
    border: none;
    padding: 0;
    margin-bottom: 2em;
  }
  section.cover p {
    color: #c8ddff;
    font-size: 0.9em;
    border-top: 1px solid rgba(255,255,255,0.2);
    padding-top: 1em;
    margin-top: 1em;
  }
  section.cover::after { color: rgba(255,255,255,0.3); }

  /* 封底 */
  section.back {
    background: linear-gradient(145deg, #0d2e5c 0%, #1a5fb4 100%);
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  section.back h1 { color: white; font-size: 2.2em; border: none; }
  section.back p { color: #a8c8ff; font-size: 0.9em; }
  section.back a { color: #7dc8ff; }
  section.back::after { color: rgba(255,255,255,0.3); }

  /* 章節標題頁 */
  section.section {
    background: var(--primary);
    color: white;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 60px 80px;
  }
  section.section h1 { color: white; font-size: 2em; border: none; }
  section.section p { color: #a8c8ff; font-size: 1em; }
  section.section::after { color: rgba(255,255,255,0.3); }

  /* 卡片 */
  .card {
    background: white;
    border-radius: 10px;
    padding: 16px 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    margin-bottom: 12px;
    border-left: 4px solid var(--accent);
  }

  /* 雙欄 */
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 12px;
  }

  /* 流程步驟 */
  .flow {
    background: white;
    border-radius: 10px;
    padding: 20px 24px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.07);
    font-size: 0.88em;
    line-height: 2;
  }

  /* 數字亮點 */
  .stat {
    display: inline-block;
    font-size: 2em;
    font-weight: 900;
    color: var(--accent);
  }
---

<!-- _class: cover -->

# DQA Lab Digital Twin
## 環境測試實驗室數位孿生平台

蔡昇昇 · 職訓培訓成果展示 · 2026

---

## 為什麼做這個？

傳統實驗室的日常：

<div class="cols">
<div class="card">

**📋 紙本 SOP**
步驟靠手抄、確認靠簽名，出錯難追溯

</div>
<div class="card">

**🔧 治具靠口頭**
「我先借一下」，借還記錄常有衝突

</div>
<div class="card">

**📊 報告手動算**
ISO 17025 量測不確定度，每次都要重算

</div>
<div class="card">

**🗓️ 排程用 Excel**
無法反映設備即時狀態，常有重疊衝突

</div>
</div>

> **目標：** 用 Web 平台串連設備、治具、排程、報告，全面取代紙本作業。

---

## 系統架構

<div class="cols">
<div>

**技術堆棧**

| 層級 | 技術 |
|------|------|
| 前端 | React 19 + Vite |
| 後端 | FastAPI + SQLAlchemy 2.0 |
| 資料庫 | SQLite + Alembic |
| 排程 | APScheduler |
| AI | Gemini Flash-Lite + RAG |
| 通知 | LINE Messaging API |

</div>
<div>

**資料流**

```
瀏覽器（React 19）
    │ HTTP / Axios
    ▼
FastAPI 後端
    ├── SQLite（13 張資料表）
    ├── 物理模擬引擎
    │   （狀態機 + APScheduler）
    ├── Gemini + RAG
    └── LINE Bot
```

</div>
</div>

---

## 八大功能模組

| 模組 | 功能摘要 |
|------|---------|
| 🖥️ **控制中心** | 多台溫箱即時監控（溫濕度、狀態、倒數計時） |
| 🔧 **SOP 執行引擎** | 法規→版本→條件三步驟，步驟自動確認 |
| 📊 **ISO 17025 報告** | GUM 量測不確定度自動計算，輸出 PDF + CSV |
| 🗄️ **治具管理** | 借出/歸還/逾期/盤點/採購全流程 |
| 🤖 **AI 法規諮詢** | Gemini + RAG，推薦條件→一鍵申請排程 |
| 🗓️ **排程系統** | 甘特圖、自動排程、條件銜接人員確認制 |
| 🚨 **LINE 推播** | 條件完成、測試完成、緊急停止主動通知 |
| 🔐 **存取控制** | 管理員 + 訪客唯讀，IP Rate Limiting |

---

<!-- _class: section -->

# 亮點一
## 三模組全自動連動

---

## AI → 排程 → 治具 → SOP 全串接

<div class="flow">

① **AI 推薦測試條件** — 自然語言查詢，RAG 檢索法規

&nbsp;&nbsp;&nbsp;↓ 點擊「📅 申請此測試」

② **申請排程** — 條件自動預填，選設備 + 選治具

&nbsp;&nbsp;&nbsp;↓ 管理員確認

③ **治具自動預約** + **SOP 自動啟動**

&nbsp;&nbsp;&nbsp;↓ 設備進入 RUNNING

④ **治具自動借出** — 無需手動記錄

&nbsp;&nbsp;&nbsp;↓ 條件完成

⑤ **LINE 推播「請確認」** → 人員下載報告確認結果

&nbsp;&nbsp;&nbsp;↓ 全部條件確認

⑥ **治具自動歸還** + **排程標為已完成**

</div>

> 從 AI 建議到報告產出，治具借還記錄全程自動，**零人工登打**。

---

<!-- _class: section -->

# 亮點二
## ISO 17025 報告自動生成

---

## GUM 量測不確定度（符合國際標準）

<div class="cols">
<div>

**計算流程**

<div class="card">

**Type A** — 穩定段重複測量的統計標準差

</div>
<div class="card">

**Type B** — 感測器解析度導入的系統不確定度

</div>
<div class="card">

**組合 uc** = √(uA² + uB²)

</div>
<div class="card">

**擴充 U** = k · uc（k=2, 95% 信賴區間）

</div>

</div>
<div>

**輸出格式**

- 📄 **PDF 正式報告**
  - Section 5 完整不確定度分析
  - 自動帶入測試條件、設備編號
  - 符合 ISO 17025 格式要求

- 📊 **CSV 原始資料**
  - 完整時序感測器數據
  - 可匯入 Excel 進一步分析

</div>
</div>

---

<!-- _class: section -->

# 亮點三
## AI 法規諮詢 + 直接申請排程

---

## 五大國際標準，78 項測試條件

| 標準 | 涵蓋領域 | 條件數 |
|------|---------|--------|
| **IEC 60068** | 冷測、乾熱、溫度循環、濕熱循環 | 24 |
| **EN 50155** | 軌道車輛環境測試 | 18 |
| **IEC 61850-3** | 電力系統設備 | 15 |
| **IEC 60945** | 船用設備 | 12 |
| **DNV** | 海事認證 | 9 |

<div class="cols">
<div class="card">

**使用流程**
自然語言查詢 → RAG 法規檢索 → 多輪對話累積推薦 → 直接預填排程申請單

</div>
<div class="card">

**技術實作**
Gemini Flash-Lite（免費額度）+ 向量相似度檢索，支援繁中法規語義查詢

</div>
</div>

---

<!-- _class: section -->

# 亮點四
## LINE Bot 即時推播

---

## 不在現場也不會漏掉

![w:340](line-1.png) ![w:340](line-2.png)

<div class="cols">
<div class="card">

**✅ 條件完成**
提醒人員確認測試結果，不確認無法進入下一條件

</div>
<div class="card">

**✅ 測試完成**
通知可以下載 PDF 報告

</div>
<div class="card">

**✅ 緊急停止**
設備異常立即警報

</div>
</div>

---

## 開發歷程與後續規劃

<div class="cols">
<div>

**Phase 1 ✅**
- 設備物理模擬引擎
- SOP 執行 + 步驟確認
- 基礎前端控制中心

**Phase 2 ✅**
- 治具管理全流程
- 排程系統 + 甘特圖
- AI 諮詢 + 三模組連動
- ISO 17025 PDF 報告
- LINE Bot 推播

</div>
<div>

**Phase 3（待接入硬體）**
- RS-485 真實設備通訊
- 接入實體溫箱取代模擬引擎

**目前狀態**

> Phase 2 完整可用，已具備取代紙本作業的能力。等待客戶端提供硬體接口進入 Phase 3。

</div>
</div>

---

## 成果數字

<br>

<div class="cols">
<div style="text-align:center">
<div class="stat">8</div><br>大功能模組
</div>
<div style="text-align:center">
<div class="stat">13</div><br>張資料表
</div>
<div style="text-align:center">
<div class="stat">78</div><br>項測試條件
</div>
</div>

<br>

> 從 9 年可靠度工程師的視角，用軟體重新定義實驗室管理流程。  
> **選擇做這個專案，是因為我知道實驗室的人真正需要什麼。**

---

<!-- _class: back -->

# 謝謝聆聽

GitHub：[github.com/tsaishengsheng-sketch/dqa-lab-digital-twin](https://github.com/tsaishengsheng-sketch/dqa-lab-digital-twin)

歡迎掃碼查看完整原始碼與 Demo 影片
