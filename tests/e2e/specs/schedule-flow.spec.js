import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";
import { closeModal } from "../helpers/modal.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 排程主流程：申請 → 待審核 → 確認 → 系統自動選機並把設備開起來。
//
// 為什麼測這條：這是整個系統風險最高的一段，橫跨排程、設備狀態機、治具三個模組，
// 也是「後端各自的測試都過、串起來卻壞掉」最容易發生的地方。
// 後端測試驗得了 API 回什麼，驗不到使用者按下去畫面有沒有真的動。

const PROJECT_NO = "E2E-SCHED-001";
const SAMPLE_NAME = "E2E 測試樣品";

async function pendingBadgeCount(page) {
  const badge = page.getByRole("button", { name: /^排程/ }).locator("span");
  return await badge.count() ? Number((await badge.innerText()).trim()) : 0;
}

test("申請排程並確認後，系統會自動選機並把設備開起來", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();
  // seed 固定有待審核排程；先等初始摘要載完，避免首次載入被誤當成寫入後失效。
  await expect.poll(() => pendingBadgeCount(page)).toBeGreaterThan(0);
  const pendingBefore = await pendingBadgeCount(page);

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

  await test.step("排程 badge 立即加 1，不等 60 秒輪詢", async () => {
    await expect.poll(() => pendingBadgeCount(page)).toBe(pendingBefore + 1);
  });

  await test.step("確認排程，系統要自動分配到一台設備", async () => {
    await row.click();
    await page.getByRole("button", { name: "確認排程" }).click();

    await expect(page.getByText("排程確認成功，以下為最終分配結果：")).toBeVisible();
    // 畫面上有兩個「關閉」：這個結果視窗的，和 AI 面板那顆（帶 title 屬性）
    await page.locator("button:not([title])", { hasText: "關閉" }).click();

    // 設備欄不該還是「—」，代表自動選機真的有選到
    await expect(row).toContainText(/CH-0\d/);
    await expect.poll(() => pendingBadgeCount(page)).toBe(pendingBefore);
  });

  await test.step("確認的當下，被指派的那台設備就要真的開始跑", async () => {
    // 這是這條測試的重點：不是看 API 回什麼，是看那台機器真的動起來。
    //
    // 只盯被指派的那一台，不用「RUNNING 總數 +1」：demo 資料本來就有機器在跑，
    // 而後端模擬器每秒推進狀態機，別台剛好跑完就會讓總數對不上，變成假紅燈。
    const deviceId = (await row.textContent()).match(/CH-0\d/)[0];
    const card = page
      .locator("div")
      .filter({ hasText: new RegExp(`^${deviceId}[\\s\\S]*執行中`) })
      .last();
    await expect(card).toBeVisible();
  });

  await test.step("確認後這一列會自動變「進行中」，不用手動重新整理", async () => {
    // BUG-001 修好後的回歸保護：確認成功會自動重抓一次，這一列不用手動刷新就轉「進行中」。
    // 若有人退回「確認後不重抓」的舊行為，這一步會失敗。
    await expect(row).toContainText("進行中");
  });
});

// 儲存備註的成功回饋。這條同時擋兩件事：成功時要說出來（以前只有失敗會講話，成功是沉默的），
// 而且那句話要在 live region 裡，螢幕閱讀器才聽得到——toast 是全站唯一的操作結果回饋。
// 用 getByRole("status") 定位就是在驗第二件事：定得到，代表它真的在 live region 裡。
test("儲存備註成功會說出來，沒有變更時按鈕不給按", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  // 挑已完成那筆：狀態不會被模擬器推著走，測起來不會偶爾紅一次
  await page.getByRole("row").filter({ hasText: "PRJ-2025-072" }).click();
  const save = page.getByRole("button", { name: "儲存備註" });
  const note = page.getByPlaceholder("可選");

  await test.step("剛打開沒有未存的變更，按鈕停用", async () => {
    await expect(save).toBeDisabled();
  });

  await test.step("改了備註才給按，存完要說出「備註已儲存」", async () => {
    await note.fill("E2E 備註");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole("status")).toContainText("備註已儲存");
  });

  await test.step("存完又回到沒有未存的變更", async () => {
    await expect(save).toBeDisabled();
  });

  // 清空是最容易假成功的一條：前端若把空備註送成 null，後端會當成「這欄不要動」而保留舊值，
  // 畫面卻照樣說已儲存。所以這裡重開視窗，看 DB 裡真的變空了沒有。
  await test.step("清空備註要真的存得掉，重開視窗不會又長回來", async () => {
    await note.fill("");
    await save.click();
    // 不看 toast：上一步那則同樣寫著「備註已儲存」，3 秒內還在畫面上，會分不出是哪一次。
    // 按鈕重新變回停用是這次存完才會發生的事，拿它當完成訊號。
    await expect(save).toBeDisabled();

    await closeModal(page, "排程詳情");
    await page.getByRole("row").filter({ hasText: "PRJ-2025-072" }).click();
    await expect(note).toHaveValue("");
  });
});
