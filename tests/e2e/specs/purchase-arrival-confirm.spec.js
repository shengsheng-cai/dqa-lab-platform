import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 「確認到貨」一按會同時做兩件事：採購單變成「已到貨」，治具庫存直接加上採購數量。
// 前者是終態，畫面上沒有回到「待採購」的路；後者只能事後人工調庫存補回來。
// 以前這兩件事按一下就發生，什麼都不問。
//
// 這支盯兩件事：確認關卡還在，而且視窗有寫出庫存會從幾變成幾——
// 只寫「確定嗎」的話，使用者看不出這一按會動到庫存，關卡等於白加。

test("確認到貨要先跳確認，取消就不會入庫", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^治具/ }).click();
  await page.getByRole("button", { name: "記錄" }).click();

  // demo 重灌後採購清單固定有待採購的單，直接用現成那筆，不另外開單
  const row = page.getByRole("row")
    .filter({ has: page.getByRole("button", { name: "確認到貨" }) })
    .first();
  await expect(row).toBeVisible();

  // 數量是表格第二欄；後面要拿它跟視窗上的數字對照
  const qty = Number((await row.getByRole("cell").nth(1).innerText()).trim());
  expect(qty).toBeGreaterThan(0);

  await test.step("確認視窗要寫出到貨數量與庫存的變化", async () => {
    await row.getByRole("button", { name: "確認到貨" }).click();

    await expect(page.getByText("確認後這張採購單固定為")).toBeVisible();
    await expect(page.getByText(`到貨數量：${qty}`)).toBeVisible();

    // 不只確認那行字在，還要確認它算對了：入庫後應該剛好多出採購數量
    const stockText = await page.getByText(/庫存：\d+ → \d+/).innerText();
    const [, before, after] = stockText.match(/庫存：(\d+) → (\d+)/);
    expect(Number(after) - Number(before)).toBe(qty);
  });

  await test.step("取消 = 採購單還是待採購，沒有偷偷入庫", async () => {
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toContainText("待採購");
    await expect(row.getByRole("button", { name: "確認到貨" })).toBeVisible();
  });
});
