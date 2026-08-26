import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 每頁都有好幾張表（含還掛在 DOM 上的其他頁），一律用只有那張表才有的表頭認
const tableWithHeader = (page, header) =>
  page.locator("table").filter({ has: page.locator("th", { hasText: header }) });

// 三個刪除確認以前只寫「確認刪除此採購單？」「確定刪除此排程？」「確定刪除？」，
// 而確認視窗正好蓋住要核對的那一列。真的點錯列的時候，最後這一關救不回來——
// 多按一次不等於看得懂自己在刪什麼。維護那個更是瀏覽器原生 confirm，
// 樣式和站內其他確認視窗完全不同。
//
// 這三支盯的是同一件事：確認視窗有沒有寫出刪的是哪一筆。
// 值是從那一列讀出來再拿去比對的，寫死字串的話改了種子資料就會假綠。

test("刪除採購單的確認視窗要寫出治具與數量", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^治具/ }).click();
  await page.getByRole("button", { name: "記錄" }).click();

  const row = tableWithHeader(page, "廠商")
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "刪除" }) })
    .first();
  const fixture = (await row.getByRole("cell").nth(0).innerText()).trim();
  const quantity = (await row.getByRole("cell").nth(1).innerText()).trim();

  await row.getByRole("button", { name: "刪除" }).click();

  const dialog = page.getByRole("dialog", { name: "刪除採購單" });
  await expect(dialog).toContainText(`治具：${fixture}`);
  await expect(dialog).toContainText(`數量：${quantity}`);

  await test.step("取消就真的沒動它", async () => {
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
  });
});

test("刪除排程的確認視窗要寫出專案與樣品", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  const row = tableWithHeader(page, "專案號碼")
    .getByRole("row")
    .filter({ hasText: "已取消" })
    .first();
  const project = (await row.getByRole("cell").nth(1).innerText()).trim();
  const sample = (await row.getByRole("cell").nth(2).innerText()).trim();

  await row.click();

  // 排程詳情和 AI 面板各有一顆「刪除」，定位收進詳情視窗
  const detail = page.locator("div")
    .filter({ has: page.getByRole("button", { name: "儲存備註" }) })
    .last();
  await detail.getByRole("button", { name: "刪除", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "刪除排程" });
  await expect(dialog).toContainText(`專案：${project} / ${sample}`);

  await test.step("取消就真的沒動它", async () => {
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
  });
});

test("刪除維護紀錄要用站內確認視窗，並寫出設備、類型與日期", async ({ page }) => {
  // 換回 window.confirm 的話，這裡會收到訊息，而下面的 dialog 角色也找不到
  const nativeDialogs = [];
  page.on("dialog", async (d) => {
    nativeDialogs.push(d.message());
    await d.dismiss();
  });

  await loginAsAdmin(page);
  await page.getByRole("button", { name: "維護", exact: true }).click();

  const row = tableWithHeader(page, "執行人員")
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "刪除" }) })
    .first();
  const date = (await row.getByRole("cell").nth(0).innerText()).trim();
  const type = (await row.getByRole("cell").nth(1).innerText()).trim();

  await row.getByRole("button", { name: "刪除" }).click();

  const dialog = page.getByRole("dialog", { name: "刪除維護紀錄" });
  await expect(dialog).toContainText("設備：CH-01");
  await expect(dialog).toContainText(`類型：${type}`);
  await expect(dialog).toContainText(`維護日期：${date}`);
  expect(nativeDialogs).toEqual([]);

  await test.step("取消就真的沒動它", async () => {
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
  });
});
