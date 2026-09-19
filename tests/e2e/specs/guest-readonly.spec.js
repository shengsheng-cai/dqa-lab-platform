import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin, loginAsGuest } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 訪客唯讀：登入後看得到資料，但不能改任何東西。
//
// 為什麼兩層都測：前端把寫入按鈕藏起來只是「看不到」，真正的權限保證在後端擋 403。
// 前端哪天改版漏藏一顆按鈕，後端那層還會擋——所以 UI 和 API 兩層分開驗。

// 設備已經回到待機、排程卻還沒結案時，設備頁會跳出一張「等待確認」的操作卡。
// 真的跑到這個狀態要等模擬器降溫，這裡直接假造那筆排程——要驗的是「這張卡給誰看」，
// 不是排程怎麼走到這一步。CH-05 在種子資料裡是待機、沒有維護時段，狀態最乾淨。
// 只列畫面真的會讀的欄位，多給的沒有斷言碰得到，只會讓人以為它們有意義
const WAITING_SCHEDULE = {
  id: 9001,
  project_number: "PRJ-E2E-WAIT",
  sample_name: "等待確認樣品",
  device_id: "CH-05",
  status: "進行中",
  conditions: ["iec60068_ab_-25_16h"],
  condition_names: ["低溫儲存 Test Ab"],
  current_condition_index: 0,
};

async function mockWaitingSchedule(page) {
  await page.route(
    (url) => url.pathname === "/api/schedules" && url.searchParams.get("status") === "進行中",
    (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([WAITING_SCHEDULE]),
    }),
  );
}

test.describe("訪客唯讀", () => {
  test("UI：一鍵訪客登入後看得到資料", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "訪客模式" }).click();
    await page.getByRole("button", { name: "🚀 一鍵訪客體驗" }).click();

    await expect(page.getByText(/CH-0\d/).first()).toBeVisible();
  });

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
      for (const name of ["+ 新增治具", "+ 借出登記", "開始月盤點"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
    });
  });

  test("UI：管理員從人員管理登出後，訪客登入會回到設備首頁", async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "人員管理" }).click();
    await expect(page).toHaveURL(/\/users$/);

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/$/);
    await loginAsGuest(page);

    await page.goto("/users");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(/CH-0\d/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ 生成" })).toHaveCount(0);
  });

  test("UI：人員資料被拒絕時顯示權限說明", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/auth/users", route => route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ detail: "需要管理者權限" }),
    }));

    await page.getByRole("button", { name: "人員管理" }).click();

    await expect(page.getByText("此頁僅限管理者")).toBeVisible();
    await expect(page.getByText("尚無人員資料")).toHaveCount(0);
    await expect(page.getByText(/尚無訪客 Token/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ 生成" })).toHaveCount(0);
  });

  // 這兩條驗的是最終畫面：同一筆等待確認的排程，管理員按得到、訪客看不到。
  //
  // 訪客那條目前有兩層一起擋：ControlCenter 不為訪客輪詢進行中排程（所以假資料連送都
  // 沒送到），SOPPage 自己也判了一次管理者。也就是說它分辨不出是哪一層擋的，拿掉
  // SOPPage 那層它照樣綠——實測過。留著是因為它守的是使用者看得到的結果，只要有一天
  // 兩層都破了它就會紅；但別把它當成「SOPPage 那層有測試守著」。
  test("UI：等待確認的排程不給訪客確認鈕", async ({ page }) => {
    await mockWaitingSchedule(page);
    await loginAsGuest(page);
    await page.getByRole("button", { name: "CH-05", exact: true }).click();

    await expect(page.getByText("訪客可查看設備狀態")).toBeVisible();
    await expect(page.getByRole("button", { name: /開始第 1 條件/ })).toHaveCount(0);
  });

  test("UI：同一筆排程，管理員看得到確認鈕", async ({ page }) => {
    // 這條同時證明假資料真的送得到畫面上，否則上一條的「看不到」什麼都不代表
    await mockWaitingSchedule(page);
    await loginAsAdmin(page);
    await page.getByRole("button", { name: "CH-05", exact: true }).click();

    await expect(page.getByRole("button", { name: /開始第 1 條件/ })).toBeVisible();
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
