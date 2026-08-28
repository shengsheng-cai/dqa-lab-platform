import { test, expect } from "@playwright/test";

import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

function selectedDate(page, label) {
  return Promise.all([
    page.getByRole("combobox", { name: `${label}：年`, exact: true }).inputValue(),
    page.getByRole("combobox", { name: `${label}：月`, exact: true }).inputValue(),
    page.getByRole("combobox", { name: `${label}：日`, exact: true }).inputValue(),
  ]).then(([year, month, day]) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
}

test("校驗使用日期選擇器且不顯示午夜，維護事件保留時分", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "維護", exact: true }).click();

  await test.step("校驗欄位只選年月日，不再要求手打格式", async () => {
    await page.getByText("校驗紀錄", { exact: true }).locator("..").getByRole("button", { name: "+ 新增" }).click();
    await expect(page.getByText("新增校驗紀錄 — CH-01", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder(/YYYY-MM-DD/)).toHaveCount(0);

    for (const field of ["校驗日期", "下次校驗日期"]) {
      await expect(page.getByRole("combobox", { name: `${field}：年`, exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: `${field}：月`, exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: `${field}：日`, exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: `${field}：時`, exact: true })).toHaveCount(0);
    }

    const calibrationDate = await selectedDate(page, "校驗日期");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    const calibrationToast = page.getByText("新增成功", { exact: true });
    await expect(calibrationToast).toBeVisible();
    // toast 會堆疊、每顆活 3 秒，這個 test 連存兩次。留著的話下一步會同時看到兩顆同樣的字，
    // 而改用 .last() 會在新 toast 還沒出現時 match 到這顆舊的，變成假綠——所以直接關掉。
    // 這個時間點 modal 已經關掉，畫面上只有 toast 這一顆 ✕
    await page.getByRole("button", { name: "✕" }).click();
    await expect(calibrationToast).toBeHidden();
    await expect(page.getByRole("cell", { name: calibrationDate, exact: true }).first()).toBeVisible();
    await expect(page.getByText(`${calibrationDate} 00:00`, { exact: true })).toHaveCount(0);
  });

  await test.step("維護事件選到時分，選填的下次日期可以設定也可以清除", async () => {
    await page.getByText("維護紀錄", { exact: true }).locator("..").getByRole("button", { name: "+ 新增" }).click();
    await expect(page.getByText("新增維護紀錄 — CH-01", { exact: true })).toBeVisible();

    for (const part of ["年", "月", "日", "時", "分"]) {
      await expect(page.getByRole("combobox", { name: `維護日期：${part}`, exact: true })).toBeVisible();
    }

    await expect(page.getByRole("button", { name: "＋ 設定日期" })).toBeVisible();
    await page.getByRole("button", { name: "＋ 設定日期" }).click();
    const nextMaintenanceYear = page.getByRole("combobox", { name: "下次維護日期：年", exact: true });
    await expect(nextMaintenanceYear).toBeVisible();
    await nextMaintenanceYear.locator("xpath=../..").getByRole("button", { name: "清除", exact: true }).click();
    await expect(page.getByRole("button", { name: "＋ 設定日期" })).toBeVisible();

    const maintenanceDate = await selectedDate(page, "維護日期");
    const hour = await page.getByRole("combobox", { name: "維護日期：時", exact: true }).inputValue();
    const minute = await page.getByRole("combobox", { name: "維護日期：分", exact: true }).inputValue();
    await page.getByPlaceholder("維護內容說明").fill("E2E 日期欄位驗證");
    await page.getByPlaceholder("王工程師").fill("E2E 測試員");
    await page.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(page.getByText("新增成功", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: `${maintenanceDate} ${hour}:${minute}`, exact: true })).toBeVisible();
  });
});
