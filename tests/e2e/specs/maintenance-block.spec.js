import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

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

const MAINT_DEVICE = "CH-05"; // demo 重灌後穩定為 IDLE、沒有排程掛著，封鎖後會顯示成 BLOCKED
const HEALTHY_DEVICE = "CH-04"; // demo 重灌後為 IDLE 且未封鎖 → 下拉裡照樣選得到
const PROJECT_NO = "E2E-MAINT-001";
const SAMPLE_NAME = "E2E 維護測試樣品";

test("設備標成維護後，確認排程時就選不到它", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await test.step("把 CH-05 設成維護（不可用時段，涵蓋現在）", async () => {
    await page.getByRole("button", { name: "+ 不可用時段" }).click();
    await page.getByRole("button", { name: "+ 新增" }).click();

    // 表單開始/結束時間預設就是「現在 → 8 小時後」，不用動；只要把設備改成 CH-05。
    // 選設備的那顆 select 是唯一帶 CH-0x 選項的（日期挑選器那幾顆 select 沒有）。
    await page.locator("select")
      .filter({ has: page.locator("option", { hasText: MAINT_DEVICE }) })
      .selectOption(MAINT_DEVICE);
    await page.getByPlaceholder("e.g. 年度校正").fill("E2E 維護封鎖");

    // 表單送出的「新增」和上面開表單的「+ 新增」不同字，exact 才不會誤點到上面那顆
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect(page.getByText("已新增")).toBeVisible();

    // 頁面上會有兩個 ✕：modal 的關閉鈕，和「已新增」toast 自己的關閉鈕。
    // 把範圍限在這個 modal（toast 不在 modal 的 DOM 子樹裡），才不會 strict mode 撞名。
    await page.locator("div").filter({ has: page.getByText("管理設備不可用時段") })
      .getByRole("button", { name: "✕" }).first().click();
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

    // 負向：維護那台標成 (BLOCKED) 且不能選——把「選不到」綁死在「因為維護」
    const maintOption = deviceSelect.locator("option", { hasText: MAINT_DEVICE });
    await expect(maintOption).toHaveText(new RegExp(`${MAINT_DEVICE} \\(BLOCKED\\)`));
    await expect(maintOption).toBeDisabled();

    // 正向對照：健康那台照樣選得到，證明不是整排 disable、下拉本身是好的
    const healthyOption = deviceSelect.locator("option", { hasText: HEALTHY_DEVICE });
    await expect(healthyOption).toBeEnabled();
  });
});
