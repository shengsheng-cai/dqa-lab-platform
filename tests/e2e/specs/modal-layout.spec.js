import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 視窗的版面：標題不動、內容捲、底部操作區不動。
//
// 以前 modal 是整塊一起捲，長表單的「送出」會落在畫面外，要先捲到底才找得到。
// 底部固定之後又多一個陷阱：送出失敗的訊息如果還留在捲動區，使用者按得到按鈕、
// 卻看不到為什麼沒成功，畫面看起來就像按了沒反應。兩件事都要釘住。

// 一般筆電的可視高度，modal 的內容一定比它高
const SHORT = { width: 1280, height: 620 };

test("新排程的送出鈕不會被內容擠出畫面", async ({ page }) => {
  await page.setViewportSize(SHORT);
  await loginAsAdmin(page);

  // 排程分頁鈕帶著待審核數量的徽章，名稱不是剛好「排程」兩個字
  await page.getByRole("button", { name: /^排程/ }).click();
  await page.getByRole("button", { name: "+ 申請排程" }).click();
  await expect(page.getByRole("dialog", { name: "申請排程" })).toBeVisible();

  await expect(page.getByRole("button", { name: "送出申請" })).toBeInViewport();
});

test("治具視窗的操作區也固定在底部", async ({ page }) => {
  await page.setViewportSize(SHORT);
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  // 編輯模式的進階選項預設展開，內容比視窗高
  await page.getByRole("row").filter({ hasText: "M.2" }).first()
    .getByRole("button", { name: "編輯" }).click();
  await expect(page.getByRole("dialog", { name: "編輯治具" })).toBeVisible();

  await expect(page.getByRole("button", { name: "儲存", exact: true })).toBeInViewport();
});

test("送出失敗時，錯誤訊息跟按鈕一起留在畫面上", async ({ page }) => {
  await page.setViewportSize(SHORT);
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  await page.route("**/api/fixtures/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "資料庫忙碌中" }) })
      : route.continue(),
  );

  await page.getByRole("row").filter({ hasText: "M.2" }).first()
    .getByRole("button", { name: "編輯" }).click();
  await expect(page.getByRole("dialog", { name: "編輯治具" })).toBeVisible();

  await page.getByRole("button", { name: "儲存", exact: true }).click();

  // 同一句話 toast 也會唸一次，這裡要驗的是視窗裡那一份
  await expect(
    page.getByRole("dialog", { name: "編輯治具" }).getByText("資料庫忙碌中"),
  ).toBeInViewport();
});
