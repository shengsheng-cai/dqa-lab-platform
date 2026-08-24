import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";
import { closeModal } from "../helpers/modal.js";
import { addBlockedPeriod, BLOCKED_PERIODS_MODAL } from "../helpers/blocked-periods.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 「▶ 立即開始」以前不看設備在做什麼，永遠可按；設備正在忙或落在維護時段時，
// 使用者要按下去、等後端回一句「非待機狀態」才知道白按了一次。
//
// 這支盯兩件事：不能開始時按鈕真的按不下去，而且畫面上就寫著為什麼、以及那台在幹嘛。
//
// 兩邊一起驗才有意義：只證明「維護時按不下去」不夠——按鈕本身壞掉、或條件寫太寬把每種
// 狀態都擋掉，看起來也會是「按不下去」。所以先證明同一顆按鈕在設備正常時是可按的。

const DEVICE = "CH-04";                    // demo 重灌後為 IDLE，且下面這筆已確認排程就指派給它
const CONFIRMED_PROJECT = "PRJ-2025-095";  // seed 的已確認排程，開始時間在 20 小時後，不會自己跑掉
const MAINT_REASON = "E2E 開始前封鎖";
const RUNNING_PROJECT = "PRJ-2025-087";    // seed 的進行中排程，跑在 CH-01 上
const RUNNING_DEVICE = "CH-01";

const startBtn = (page) => page.getByRole("button", { name: "▶ 立即開始" });

async function openConfirmedSchedule(page) {
  await page.getByRole("row").filter({ hasText: CONFIRMED_PROJECT }).click();
  await expect(page.getByText("排程詳情")).toBeVisible();
}

const closeScheduleModal = (page) => closeModal(page, "排程詳情");

test("WebSocket 尚未就緒時，不能把待機設備誤判成離線", async ({ page }) => {
  await page.route("**/api/auth/ws-ticket", route => route.abort());
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await openConfirmedSchedule(page);
  await expect(page.getByText(`${DEVICE}（待機）`)).toBeVisible();
  await expect(startBtn(page)).toBeEnabled();
});

test("別的瀏覽器新增維護時段後，「立即開始」會即時停用並說明原因", async ({ page, browser }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await test.step("正向對照：設備待機時這顆按鈕是可以按的", async () => {
    await openConfirmedSchedule(page);
    await expect(page.getByText(`${DEVICE}（待機）`)).toBeVisible();
    await expect(startBtn(page)).toBeEnabled();
    await closeScheduleModal(page);
  });

  await test.step("進行中的排程也要看得到那台在幹嘛，而且是中文不是代碼", async () => {
    // 同一份對照表也負責把 RUNNING 之類的內部代碼翻成人話，這裡順便釘住
    await page.getByRole("row").filter({ hasText: RUNNING_PROJECT }).click();
    await expect(page.getByText(`${RUNNING_DEVICE}（執行中）`)).toBeVisible();
    await closeScheduleModal(page);
  });

  await test.step(`從另一個瀏覽器工作階段把 ${DEVICE} 設成維護（涵蓋現在）`, async () => {
    // E2E 種子只有一個管理員帳號；再登入一次會輪替 token、把第一個瀏覽器登出。
    // 複製現有登入狀態，讓兩個獨立 browser context 同時代表同一個已授權工作階段。
    const storageState = await page.context().storageState();
    const otherContext = await browser.newContext({ storageState });
    try {
      const otherPage = await otherContext.newPage();
      await otherPage.goto("/schedule");
      await otherPage.getByRole("button", { name: "+ 不可用時段" }).click();
      await addBlockedPeriod(otherPage, { device: DEVICE, reason: MAINT_REASON });
      await closeModal(otherPage, BLOCKED_PERIODS_MODAL);
    } finally {
      await otherContext.close();
    }
  });

  await test.step("同一筆排程：按鈕停用，並就地寫出是哪一台、為什麼、到什麼時候", async () => {
    await openConfirmedSchedule(page);
    await expect(page.getByText(`${DEVICE}（維護時段）`)).toBeVisible();
    await expect(startBtn(page)).toBeDisabled();
    // 光是變灰不夠——使用者要看得到原因，不然只會以為排程壞了
    await expect(
      page.getByText(new RegExp(`${DEVICE} 在維護時段（${MAINT_REASON}）.*不能開始`))
    ).toBeVisible();
  });
});

test("設備收尾時，條件銜接按鈕保留在原位、停用並說明原因", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByText(RUNNING_DEVICE, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "⏹ 正常停止" }).click();
  await page.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.locator("section.operation-box").first()).toContainText(
    `${RUNNING_DEVICE} — FINISHING`,
  );

  await page.getByRole("button", { name: /^排程/ }).click();
  await page.getByRole("row").filter({ hasText: RUNNING_PROJECT }).click();
  await expect(page.getByText(`${RUNNING_DEVICE}（收尾降溫中）`)).toBeVisible();

  const continueButton = page.getByRole("button", { name: /^▶ 開始第/ });
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeDisabled();
  await expect(page.getByText(new RegExp(`${RUNNING_DEVICE} 收尾降溫中.*才能開始`))).toBeVisible();
});
