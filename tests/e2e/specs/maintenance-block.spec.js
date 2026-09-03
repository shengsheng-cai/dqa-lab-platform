import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";
import { closeModal } from "../helpers/modal.js";
import { addBlockedPeriod, BLOCKED_PERIODS_MODAL } from "../helpers/blocked-periods.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 設備維護時段：一台機器被標成維護（不可用時段）後，確認排程時就不該能把它指派上去。
//
// 為什麼測這條：這是「人工協調＋到點兜底」那個決策裡，使用者實際碰得到的一層——
// 管理員把某台機器標維護，確認排程的設備下拉裡那台就要變成選不到（disabled）。
//
// 範圍講清楚：這裡只驗「手動指派選不到」這個下拉層的保證。
// 「到點真的不啟動」那個 runtime 兜底（含自動排程路徑）是後端測試在顧的
// （test_schedule_start_consistency.py）。要分清楚一件事：自動分配並「不會排除」
// 維護中的設備，它只是把該台的最早可用時間往後推到維護結束、仍可能選它並排在之後，
// 所以這裡不去驗「自動分配避開它」——那不是它的行為。
//
// 兩邊一起驗才有意義：只證明「維護那台選不到」不夠，整個下拉載不出來、或一個 bug 把
// 每台都 disable 了，也會「看起來選不到」。所以同一個下拉裡再證明「健康的機器照樣選得到」——
// 這樣綠燈才代表 disable 是針對維護、不是整排壞掉。

const MAINT_DEVICE = "CH-05"; // demo 重灌後穩定為 IDLE、沒有排程掛著，封鎖後會顯示成「不可用」
const HEALTHY_DEVICE = "CH-04"; // demo 重灌後為 IDLE 且未封鎖 → 下拉裡照樣選得到
const SCHEDULED_DEVICE = "CH-01"; // demo 重灌後身上掛著一筆進行中排程，但那不是維護 → 不得被擋
const PROJECT_NO = "E2E-MAINT-001";
const SAMPLE_NAME = "E2E 維護測試樣品";

test("設備標成維護後，確認排程時就選不到它", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await test.step("把 CH-05 設成維護（不可用時段，涵蓋現在）", async () => {
    await page.getByRole("button", { name: "+ 不可用時段" }).click();
    await addBlockedPeriod(page, { device: MAINT_DEVICE, reason: "E2E 維護封鎖" });
    await closeModal(page, BLOCKED_PERIODS_MODAL);
  });

  await test.step("送出一筆新排程", async () => {
    await page.getByRole("button", { name: "+ 申請排程" }).click();
    await page.getByPlaceholder("e.g. P-2026-001").fill(PROJECT_NO);
    await page.getByPlaceholder("e.g. Router A").fill(SAMPLE_NAME);
    // 挑一條時間短的條件，跟 schedule-flow 一致，測起來快
    await page.getByText(/低溫儲存 Test Ab：-25°C/).first().click();
    await page.getByRole("button", { name: "送出申請" }).click();
  });

  const row = page.getByRole("row").filter({ hasText: PROJECT_NO });
  await expect(row).toContainText("待審核");

  await test.step("確認視窗的設備下拉：維護那台選不到、健康那台選得到", async () => {
    await row.click();

    // 確認排程的「指定設備」下拉，就是那顆帶「自動選擇最早可用設備」選項的
    const deviceSelect = page.locator("select")
      .filter({ has: page.locator("option", { hasText: "自動選擇最早可用設備" }) });

    // 負向：維護那台標成「不可用」且不能選——把「選不到」綁死在「因為維護」
    const maintOption = deviceSelect.locator("option", { hasText: MAINT_DEVICE });
    await expect(maintOption).toHaveText(`${MAINT_DEVICE}（不可用）`);
    await expect(maintOption).toBeDisabled();

    // 正向對照：健康那台照樣選得到，證明不是整排 disable、下拉本身是好的
    const healthyOption = deviceSelect.locator("option", { hasText: HEALTHY_DEVICE });
    await expect(healthyOption).toBeEnabled();

    // 「身上有排程」不是維護，不得被擋掉：指派的是未來的時段，後端啟動時也不看這件事。
    // 以前這兩件事合成同一個旗標，機器空著卻選不到，理由看起來還像它壞了。
    const scheduledOption = deviceSelect.locator("option", { hasText: SCHEDULED_DEVICE });
    await expect(scheduledOption).toBeEnabled();
    await expect(scheduledOption).not.toHaveText(`${SCHEDULED_DEVICE}（不可用）`);
  });
});

// 刪除不可用時段以前沒有任何確認，按下去就直接生效。那一筆同時在擋「排程排得進來」和
// 「現場啟動測試」，刪錯列不會有任何提示，只會看到一句綠色的「已刪除」。
// 這支盯的是那道確認關卡還在，而且視窗上真的寫著刪的是哪一台、哪一段、什麼原因——
// 只有「確定嗎」的話，使用者沒有東西可以核對，關卡等於白加。
const DELETE_DEVICE = "CH-03";
const DELETE_REASON = "E2E 刪除確認";

test("刪除不可用時段要先跳確認，取消就什麼都沒發生", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();
  await page.getByRole("button", { name: "+ 不可用時段" }).click();

  await test.step("自己建一筆，不吃上一個測試留下的狀態", async () => {
    await addBlockedPeriod(page, { device: DELETE_DEVICE, reason: DELETE_REASON });
  });

  const row = page.getByRole("row").filter({ hasText: DELETE_REASON });
  await expect(row).toBeVisible();

  await test.step("確認視窗要列出刪的是哪一筆", async () => {
    await row.getByRole("button", { name: "刪除" }).click();
    await expect(page.getByText("刪除不可用時段", { exact: true })).toBeVisible();
    await expect(page.getByText(`設備：${DELETE_DEVICE}`)).toBeVisible();
    await expect(page.getByText(`原因：${DELETE_REASON}`)).toBeVisible();
  });

  await test.step("取消 = 那一列還在，沒有偷偷送出刪除", async () => {
    // 不加 exact 會連排程篩選鈕「已取消」一起選到（子字串比對）
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
  });

  await test.step("確定才真的刪掉", async () => {
    await row.getByRole("button", { name: "刪除" }).click();
    // 列上和對話框裡各有一顆「刪除」，範圍要限在對話框內，
    // 錨點用它自己那句話（往上一層就是放標題、內文、按鈕的那個容器）
    const dialog = page.getByText("刪除後這台設備在這段時間會重新開放").locator("xpath=..");
    await dialog.getByRole("button", { name: "刪除", exact: true }).click();
    await expect(page.getByText("已刪除")).toBeVisible();
    await expect(row).toHaveCount(0);
  });
});
