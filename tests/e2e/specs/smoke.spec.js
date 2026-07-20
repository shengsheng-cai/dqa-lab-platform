import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { adminPassword } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 這支不測產品邏輯，只證明測試環境本身是好的：
// 後端有起來、前端是這個後端吐出來的、而且連到的是測試環境不是開發環境。
// 它壞掉代表環境有問題，不是程式有 bug。

test.describe("E2E 環境自我檢查", () => {
  test("後端活著", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("登入畫面正常顯示", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("帳號")).toBeVisible();
    await expect(page.getByPlaceholder("密碼")).toBeVisible();
    await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
  });

  test("用測試專用的假密碼登入得起來", async ({ page }) => {
    // 這條是隔離的證明：假密碼只有測試後端認得，
    // 如果不小心連到開發用的後端，這裡一定會失敗。
    await page.goto("/");
    await page.getByPlaceholder("帳號").fill("admin");
    await page.getByPlaceholder("密碼").fill(adminPassword());
    await page.getByRole("button", { name: "登入", exact: true }).click();

    await expect(page.getByPlaceholder("密碼")).toBeHidden();
    const token = await page.evaluate(() => localStorage.getItem("user_token"));
    expect(token).toBeTruthy();
  });
});
