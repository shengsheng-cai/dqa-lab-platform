import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 月盤點只列得出「現場數得到完整數量」的治具：只要某種治具有一件借出或預約在外，
// 整個品項都不能盤。以前這些項目是被靜默拿掉的，清單看起來就是全部，
// 盤完得到「差異 0」，使用者會以為整批庫存都對得上。
//
// 這支盯的是「不會靜默漏掉」：畫面要把未納入的列出來，而且
// 涵蓋幾種 + 未納入幾種要剛好等於治具總數——少一種就代表又有東西被吃掉了。

test("月盤點會列出未納入的治具，數量加起來等於全部", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^治具/ }).click();

  // 治具總數印在頁面標題下方，開視窗前先讀起來當對照基準。
  // 資料還沒載完時那裡是「共 0 種治具」，所以要等到非 0 才讀，否則基準會是 0。
  const totalLabel = page.getByText(/共 [1-9]\d* 種治具/);
  await expect(totalLabel).toBeVisible();
  const total = Number((await totalLabel.innerText()).match(/共 (\d+) 種治具/)[1]);

  await page.getByRole("button", { name: /開始月盤點/ }).click();

  // demo 重灌後有借出中的治具，所以一定有品項會被排除
  await expect(page.getByText(/未納入本次盤點（\d+ 種）/)).toBeVisible();

  const summary = await page.getByText(/本次盤點涵蓋 \d+ 種，未納入 \d+ 種/).innerText();
  const [, counted, excluded] = summary.match(/涵蓋 (\d+) 種，未納入 (\d+) 種/);
  expect(Number(excluded)).toBeGreaterThan(0);
  expect(Number(counted) + Number(excluded)).toBe(total);
});

// 上面那條只驗加總，分錯邊照樣綠。這條盯的是分邊本身：
// USB-C / Gen2 在種子裡「即將不足」又有 1 件借出。以前盤點拿徽章那個字判斷能不能盤，
// 即將不足排在借出中前面，它就被列成可盤，照架上數到的 2 送出，總數會被改成 2。
// HDMI / 2.1 是種子裡唯一沒有東西在外的治具，當作「真的可以盤」的正向對照。
test("有借出的治具不列為可盤，即使徽章寫的是即將不足", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^治具/ }).click();
  await page.getByRole("button", { name: /開始月盤點/ }).click();
  const dialog = page.getByRole("dialog", { name: "月盤點" });

  // 可盤的每一列有一格輸入實際數量，所以格數就是可盤的種數
  await expect(dialog.getByRole("spinbutton")).toHaveCount(1);
  await expect(dialog.getByText("HDMI / 2.1")).toBeVisible();
  // 未納入清單的那一列才會寫出借出幾件
  await expect(dialog.getByText("系統庫存 3・借出 1")).toBeVisible();
});

// 治具列上的快速盤點跟月盤點送的是同一種盤點。以前它不看有沒有東西在外：
// M.2 有 4 支、借出 2 支，照架上數到的 2 送出，總數就變成 2，借出的歸還後也回不來。
test("快速盤點也不收有東西在外的治具，並寫出原因", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^治具/ }).click();

  const loanedRow = page.getByRole("row").filter({ hasText: "2280" });
  await expect(loanedRow.getByText("有借出或預約，歸還後再盤")).toBeVisible();
  await expect(loanedRow.getByRole("spinbutton")).toHaveCount(0);

  // 正向對照：沒有東西在外的 HDMI 照常有輸入格
  const clearRow = page.getByRole("row").filter({ hasText: "HDMI" });
  await expect(clearRow.getByRole("spinbutton", { name: /的盤點實際數量/ })).toBeVisible();
});

// 盤點紀錄的批次編輯也能「新增一筆」盤點，後端同樣不收有東西在外的治具。
// 選單裡留著可選的話，要到按儲存才被擋回來，而那時前面的刪改已經先存進去了。
test("盤點批次新增一筆時，有東西在外的治具選不到並寫出原因", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();
  await page.getByRole("button", { name: "記錄", exact: true }).click();
  await page.getByRole("button", { name: "盤點紀錄", exact: true }).click();
  await page.getByRole("button", { name: "編輯", exact: true }).first().click();
  await page.getByRole("button", { name: "＋ 新增一筆" }).click();

  const picker = page.locator("select")
    .filter({ has: page.locator("option", { hasText: "選擇治具..." }) });
  await expect(picker.locator("option", { hasText: "M.2 / 2280" }))
    .toHaveText("M.2 / 2280（有借出或預約，不能盤）");
  await expect(picker.locator("option", { hasText: "M.2 / 2280" })).toBeDisabled();
  await expect(picker.locator("option", { hasText: "HDMI / 2.1" })).toBeEnabled();
});
