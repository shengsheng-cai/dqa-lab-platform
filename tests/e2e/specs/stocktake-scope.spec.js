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
