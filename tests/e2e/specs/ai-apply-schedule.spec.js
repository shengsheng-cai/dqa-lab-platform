import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin, loginAsGuest } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// AI 推薦 → 一鍵帶入排程：這是 README 頭條連動（AI→排程→治具）的第一段。
//
// 為什麼測這條、又為什麼是它獨有的價值：
// 後端「從回答抽 [APPLY:] → 白名單擋幻覺 → 吐 [META:]」那段已經有 pytest 蓋了
// （test_ai_observability.py）。這條 E2E 唯一沒人蓋的，是前端這一整串：
// 把 [META:] 從畫面剝掉、sop_ids 一路 prop 傳到排程視窗、預填成已選條件。
//
// 「假 AI」怎麼做：用 route 攔掉 AI 串流端點，直接回一段固定文字（答覆＋結尾的
// [META:{sop_ids}] marker），完全不碰 Gemini，決定論。前端沒有「AI 未設定就鎖住輸入」
// 的閘門，所以測試後端沒金鑰也送得出去。

// 兩條同標準同版本的條件，對應真實 sop_id 與其顯示名稱（backend/app/standards/iec60068.py）
const SOP_ID_1 = "iec60068_ab_-25_16h";
const SOP_ID_2 = "iec60068_ab_-40_16h";
const COND_NAME_1 = /低溫儲存 Test Ab：-25°C/;
const COND_NAME_2 = /低溫儲存 Test Ab：-40°C/;

// 答覆文字刻意不含條件全名——這樣「條件全名出現」只可能來自帶入後的排程視窗，斷言才有意義
const FAKE_AI_REPLY = "根據你的設備，建議做兩條低溫儲存測試（標溫與寬溫）。";
const FAKE_AI_BODY = `${FAKE_AI_REPLY}\n[META:{"sop_ids":["${SOP_ID_1}","${SOP_ID_2}"]}]`;

const PROJECT_NO = "E2E-AI-001";
const SAMPLE_NAME = "E2E AI 帶入樣品";

// 攔掉 AI 串流端點，回我們自己的固定回應（要在送出前掛好）
async function stubAiStream(page) {
  await page.route("**/api/ai/standards-query-stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body: FAKE_AI_BODY,
    });
  });
}

// 開 AI 面板、丟一個問題、送出（回應是上面攔截灌的假的）
async function askAi(page) {
  await page.getByTitle("AI 諮詢").click();
  await page.getByPlaceholder(/描述你的測試需求/).fill("工業設備要做哪些低溫測試？");
  await page.getByRole("button", { name: "送出", exact: true }).click();
  await expect(page.getByText(/建議做兩條低溫儲存測試/)).toBeVisible();
}

test("AI 推薦的條件，一鍵能帶進排程申請並送出", async ({ page }) => {
  await loginAsAdmin(page);
  await stubAiStream(page);

  await test.step("送出問題，收到（假的）推薦回覆", async () => {
    await askAi(page);
    // 「申請此測試」鈕出現（代表 sop_ids 有解析到）
    await expect(page.getByRole("button", { name: /申請此測試/ })).toBeVisible();
    // [META:...] 那段是給機器看的，不該露在畫面上——前端要剝乾淨
    await expect(page.getByText(/\[META:/)).toHaveCount(0);
  });

  await test.step("點『申請此測試』→ 兩條條件都帶進排程申請視窗", async () => {
    await page.getByRole("button", { name: /申請此測試/ }).click();

    // 帶入的 toast 明講帶了幾條——順帶確認是「兩條」
    await expect(page.getByText(/已帶入 2 個條件/)).toBeVisible();

    // 排程申請視窗開起來，已選條件列出兩條（可能同時出現在條件挑選器，用 first 避開 strict mode）
    await expect(page.getByText(COND_NAME_1).first()).toBeVisible();
    await expect(page.getByText(COND_NAME_2).first()).toBeVisible();
  });

  await test.step("補完必填欄位送出 → 排程列表冒出這筆待審核（端到端）", async () => {
    await page.getByPlaceholder("e.g. P-2026-001").fill(PROJECT_NO);
    await page.getByPlaceholder("e.g. Router A").fill(SAMPLE_NAME);
    await page.getByRole("button", { name: "送出申請" }).click();

    const row = page.getByRole("row").filter({ hasText: PROJECT_NO });
    await expect(row).toBeVisible();
    await expect(row).toContainText("待審核");
  });
});

test("訪客拿得到 AI 推薦，但不能一鍵申請（鈕是 disabled）", async ({ page }) => {
  // 前端這道閘門只是 UX 第二層；真正的防線是後端對訪客寫入回 403（guest-readonly 測）。
  // 這條顧的是：訪客看得到推薦、但那顆申請鈕點不下去，不會走進「填一填才被 403 打回」的死路。
  await loginAsGuest(page);
  await stubAiStream(page);

  await askAi(page);

  const applyBtn = page.getByRole("button", { name: /申請此測試/ });
  await expect(applyBtn).toBeVisible();
  await expect(applyBtn).toBeDisabled();
  await expect(page.getByText(/請管理員登入後申請/)).toBeVisible();
});
