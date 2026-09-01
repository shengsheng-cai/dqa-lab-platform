import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";

test.beforeAll(resetBackend);

// 登入頁的必填檢查以前是完全沉默的：欄位沒填就按下去，事件處理直接 return——
// 按鈕沒停用、沒有任何訊息、焦點也不動。使用者看到的是「按了沒事」，
// 分不出是按鈕壞了、系統卡住，還是自己少填了什麼。
//
// 這支刻意不用 helpers/login.js：那支的結尾一定是登入成功，跟這裡要驗的正好相反。

// 缺欄位要由前端當場擋下，不該送出請求。這條順帶擋住「拿後端的錯誤訊息交差」那種寫法，
// 也讓測試不會去消耗「登入錯 5 次鎖 IP 10 分鐘」的次數。
function watchAuthPosts(page) {
  const calls = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/auth/")) calls.push(r.url());
  });
  return calls;
}

test("帳號空白時要說出缺的是帳號，並把焦點移過去", async ({ page }) => {
  const calls = watchAuthPosts(page);
  await page.goto("/");

  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText("請輸入帳號");
  await expect(page.getByPlaceholder("帳號")).toBeFocused();
  expect(calls).toEqual([]);
});

test("只填帳號時要說出缺的是密碼，不能沿用上一句訊息", async ({ page }) => {
  const calls = watchAuthPosts(page);
  await page.goto("/");

  await page.getByPlaceholder("帳號").fill("admin");
  await page.getByRole("button", { name: "登入", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText("請輸入密碼");
  await expect(page.getByPlaceholder("密碼")).toBeFocused();
  expect(calls).toEqual([]);
});

// 欄位上的 Enter 跟按鈕呼叫同一支 handler，這條盯著它不要哪天各走各的
test("在欄位上按 Enter 走的是同一套檢查", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder("帳號").fill("admin");
  await page.getByPlaceholder("密碼").press("Enter");

  await expect(page.getByRole("alert")).toHaveText("請輸入密碼");
});

test("訪客 Token 空白時要說出來，並把焦點移到 Token 欄", async ({ page }) => {
  const calls = watchAuthPosts(page);
  await page.goto("/");

  await page.getByRole("button", { name: "訪客模式" }).click();
  await page.getByRole("button", { name: "進入系統" }).click();

  await expect(page.getByRole("alert")).toHaveText("請輸入訪客 Token");
  await expect(page.getByPlaceholder(/訪客 Token/)).toBeFocused();
  expect(calls).toEqual([]);
});
