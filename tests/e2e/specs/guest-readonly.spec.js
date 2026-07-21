import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsGuest } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 訪客唯讀：登入後看得到資料，但不能改任何東西。
//
// 為什麼兩層都測：前端把寫入按鈕藏起來只是「看不到」，真正的權限保證在後端擋 403。
// 前端哪天改版漏藏一顆按鈕，後端那層還會擋——所以 UI 和 API 兩層分開驗。

test.describe("訪客唯讀", () => {
  test("UI：看不到寫入按鈕與受限 tab", async ({ page }) => {
    await loginAsGuest(page);

    await test.step("登入後看得到資料（唯讀的重點是能讀）", async () => {
      // 訪客的價值就是唯讀能看；只驗「不能改」不夠，要確認資料真的載得出來
      await expect(page.getByText(/CH-0\d/).first()).toBeVisible();
    });

    await test.step("維護、人員管理 tab 不該出現", async () => {
      await expect(page.getByRole("button", { name: "維護", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "人員管理" })).toHaveCount(0);
    });

    await test.step("排程頁進得去，但沒有申請排程／不可用時段", async () => {
      await page.getByRole("button", { name: /^排程/ }).click();
      // 唯讀的東西還在：狀態過濾、重新整理
      await expect(page.getByRole("button", { name: "重新整理" })).toBeVisible();
      // 寫入的按鈕不該有
      await expect(page.getByRole("button", { name: "+ 申請排程" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "+ 不可用時段" })).toHaveCount(0);
    });

    await test.step("治具頁只有總表，沒有任何寫入按鈕", async () => {
      await page.getByRole("button", { name: "治具", exact: true }).click();
      await expect(page.getByText("治具總表")).toBeVisible();
      for (const name of ["+ 新增治具", "+ 借出登記", "🔍 開始月盤點"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
    });
  });

  test("API：直接打寫入端點會被擋 403", async ({ page }) => {
    // 繞過 UI，拿訪客的 token 直接打後端——這是唯讀的真正防線。
    await loginAsGuest(page);
    const token = await page.evaluate(() => localStorage.getItem("demo_password"));

    const writeCalls = [
      ["POST", "/api/schedules", { project_number: "X", sample_name: "Y", conditions: ["iec60068_ab_-25_16h"] }],
      ["POST", "/api/fixtures/loans", { fixture_id: 1, borrower_name: "X", quantity: 1, due_date: "2026-12-31" }],
      ["DELETE", "/api/fixtures/1", null],
    ];

    for (const [method, url, body] of writeCalls) {
      const status = await page.evaluate(async ([m, u, b, tk]) => {
        const r = await fetch(u, {
          method: m,
          headers: { "Content-Type": "application/json", "X-Demo-Password": tk },
          body: b ? JSON.stringify(b) : undefined,
        });
        return r.status;
      }, [method, url, body, token]);
      expect(status, `${method} ${url} 應該被擋`).toBe(403);
    }
  });
});
