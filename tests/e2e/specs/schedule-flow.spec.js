import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 排程主流程：申請 → 待審核 → 確認 → 系統自動選機並把設備開起來。
//
// 為什麼測這條：這是整個系統風險最高的一段，橫跨排程、設備狀態機、治具三個模組，
// 也是「後端各自的測試都過、串起來卻壞掉」最容易發生的地方。
// 後端測試驗得了 API 回什麼，驗不到使用者按下去畫面有沒有真的動。

const PROJECT_NO = "E2E-SCHED-001";
const SAMPLE_NAME = "E2E 測試樣品";

test("申請排程並確認後，系統會自動選機並把設備開起來", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await test.step("送出申請", async () => {
    await page.getByRole("button", { name: "+ 申請排程" }).click();
    await page.getByPlaceholder("e.g. P-2026-001").fill(PROJECT_NO);
    await page.getByPlaceholder("e.g. Router A").fill(SAMPLE_NAME);
    // 挑一條時間短的條件，測試才跑得快
    await page.getByText(/低溫儲存 Test Ab：-25°C/).first().click();
    await page.getByRole("button", { name: "送出申請" }).click();
  });

  const row = page.getByRole("row").filter({ hasText: PROJECT_NO });

  await test.step("新排程出現在列表，狀態是待審核", async () => {
    await expect(row).toBeVisible();
    await expect(row).toContainText("待審核");
  });

  await test.step("確認排程，系統要自動分配到一台設備", async () => {
    await row.click();
    await page.getByRole("button", { name: "確認排程" }).click();

    await expect(page.getByText("排程確認成功，以下為最終分配結果：")).toBeVisible();
    // 畫面上有兩個「關閉」：這個結果視窗的，和 AI 面板那顆（帶 title 屬性）
    await page.locator("button:not([title])", { hasText: "關閉" }).click();

    // 設備欄不該還是「—」，代表自動選機真的有選到
    await expect(row).toContainText(/CH-0\d/);
  });

  await test.step("確認的當下，被指派的那台設備就要真的開始跑", async () => {
    // 這是這條測試的重點：不是看 API 回什麼，是看那台機器真的動起來。
    //
    // 只盯被指派的那一台，不用「RUNNING 總數 +1」：demo 資料本來就有機器在跑，
    // 而後端模擬器每秒推進狀態機，別台剛好跑完就會讓總數對不上，變成假紅燈。
    const deviceId = (await row.textContent()).match(/CH-0\d/)[0];
    const card = page
      .locator("div")
      .filter({ hasText: new RegExp(`^${deviceId}[\\s\\S]*RUNNING`) })
      .last();
    await expect(card).toBeVisible();
  });

  await test.step("重新整理後排程狀態為進行中", async () => {
    // 註：這裡必須手動按重新整理，排程列才會更新成「進行中」。
    // 確認後後端 100ms 內就轉成進行中並啟動設備了，但畫面不會自己跟上——
    // 已知問題，記錄在 CLAUDE.local.md 待補。
    await page.getByRole("button", { name: "重新整理" }).click();
    await expect(row).toContainText("進行中");
  });
});
