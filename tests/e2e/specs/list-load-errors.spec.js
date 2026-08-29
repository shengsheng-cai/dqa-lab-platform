import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin, loginAsGuest } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 讀取失敗以前一律顯示成「尚無○○」，使用者分不出是真的沒資料、沒權限，還是後端掛了。
// 訪客 Token 那張最嚴重：讀不到會寫「點擊『+ 生成』建立第一個」，等於在故障時
// 請管理者再發一把憑證。這支盯的是四張表在失敗時說的是實話。
//
// 用 page.route 假造失敗，因為斷線與 500 沒辦法靠操作重現；訪客的 403 則是真的。
test.describe("列表讀取失敗時說得出原因", () => {
  test("執行紀錄：連不到後端時不寫成「尚無執行紀錄」", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/reports/list", (route) => route.abort());

    await page.getByRole("button", { name: "📋 紀錄" }).click();
    await page.getByRole("button", { name: "執行紀錄" }).click();

    await expect(page.getByText("連不到伺服器")).toBeVisible();
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
    await expect(page.getByText("尚無執行紀錄")).toBeHidden();
  });

  test("稽核紀錄：訪客看到的是沒有權限，不是沒有紀錄", async ({ page }) => {
    await loginAsGuest(page);
    await page.getByText("CH-02", { exact: true }).filter({ visible: true }).first().click();

    await page.getByRole("button", { name: "📋 紀錄" }).click();
    await page.getByRole("button", { name: "稽核紀錄" }).click();

    await expect(page.getByText("需要管理者權限")).toBeVisible();
    await expect(page.getByText("尚無稽核紀錄")).toBeHidden();
  });

  test("訪客 Token：讀不到時不會叫人再發一把新的", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/auth/demo-tokens", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    await page.goto("/users");

    await expect(page.getByText("伺服器錯誤（500）")).toBeVisible();
    await expect(page.getByText("尚無訪客 Token")).toBeHidden();
    // 側欄的兩個數字同樣不能停在 0，那看起來像真的沒有管理者、沒有有效 Token
    await expect(page.getByLabel("有效 Token：讀取失敗")).toBeVisible();
  });
});

// AI 不是清單，但病一樣：後端明明回了「AI 服務未設定，請聯絡管理員」，
// 前端收到非 2xx 一律蓋成「連線失敗，請確認後端是否正常運行」，
// 於是沒設金鑰、被限流、權限不足在畫面上長得一模一樣。
//
// AI 串流走的是原生 fetch，繞過 api.js 的攔截器，所以 401 也得自己接——
// 否則 Token 過期只會在對話裡留一句話，人留在已經失效的畫面上。
test.describe("AI 送出失敗的處理", () => {
  test("顯示後端回的那句話，不是籠統的連線失敗", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/ai/standards-query-stream", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "AI 服務未設定，請聯絡管理員" }),
      }));

    await page.getByTitle("AI 諮詢").click();
    await page.getByPlaceholder(/描述你的測試需求/).fill("工業設備要做哪些低溫測試？");
    await page.getByRole("button", { name: "送出", exact: true }).click();

    await expect(page.getByText("AI 服務未設定，請聯絡管理員")).toBeVisible();
    await expect(page.getByText("連線失敗，請確認後端是否正常運行")).toBeHidden();
  });

  test("Token 失效時把人送回登入頁，不是在對話裡留一句話", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/ai/standards-query-stream", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Token 已失效，請重新登入" }),
      }));

    await page.getByTitle("AI 諮詢").click();
    await page.getByPlaceholder(/描述你的測試需求/).fill("隨便問一句");
    await page.getByRole("button", { name: "送出", exact: true }).click();

    await expect(page.getByPlaceholder("密碼")).toBeVisible();
    // 憑證要真的清掉，不然重整又會用失效的 Token 進去
    expect(await page.evaluate(() => localStorage.getItem("user_token"))).toBeNull();
  });
});
