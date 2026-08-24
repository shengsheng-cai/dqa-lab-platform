import { expect } from "@playwright/test";

export const BLOCKED_PERIODS_MODAL = "管理設備不可用時段";

/**
 * 在已經打開的「管理設備不可用時段」視窗裡，新增一筆涵蓋現在的不可用時段。
 *
 * 呼叫前要先按「+ 不可用時段」把視窗打開；這支不負責開窗也不負責關窗。
 *
 * 表單的起訖時間預設就是「現在 → 8 小時後」，所以不用動時間，只要挑設備、填原因。
 */
export async function addBlockedPeriod(page, { device, reason }) {
  await page.getByRole("button", { name: "+ 新增" }).click();

  // 挑設備那顆 select 是唯一帶 CH-0x 選項的，日期挑選器那幾顆沒有
  await page.locator("select")
    .filter({ has: page.locator("option", { hasText: device }) })
    .selectOption(device);
  await page.getByPlaceholder("e.g. 年度校正").fill(reason);

  // 送出的「新增」和開表單的「+ 新增」不同字，exact 才不會誤點回上面那顆
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByText("已新增")).toBeVisible();
}
