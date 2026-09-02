import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin, loginAsGuest } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 讀取失敗以前一律顯示成「尚無○○」，使用者分不出是真的沒資料、沒權限，還是後端掛了。
// 訪客 Token 那張最嚴重：讀不到會寫「點擊『+ 生成』建立第一個」，等於在故障時
// 請管理者再發一把憑證。這支盯的是這幾張表與選單在失敗時說的是實話。
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

  test("異常紀錄：後端掛掉時不打勾說「目前無異常紀錄」", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/errors/**", (route) => route.abort());

    await page.getByRole("button", { name: "📋 紀錄" }).click();
    await page.getByRole("button", { name: "異常紀錄" }).click();

    await expect(page.getByText("連不到伺服器")).toBeVisible();
    await expect(page.getByText("目前無異常紀錄")).toBeHidden();
    // 上方三張統計卡也不能停在 0：故障當下那組數字讀起來就是「系統沒有異常」
    await expect(page.getByLabel("緊急停止次數：讀取失敗")).toBeVisible();
  });

  test("SOP 選法規：讀不到法規時說得出原因，不是一個空選單", async ({ page }) => {
    // 標準樹只在進畫面時抓一次，所以要先攔再登入
    await page.route("**/api/sop/standards/tree**", (route) => route.abort());
    await loginAsAdmin(page);

    // 選法規只在待機的設備上出現，seed 固定讓 CH-05 待機
    await page.getByRole("button", { name: "CH-05", exact: true }).click();

    await expect(page.getByText("連不到伺服器")).toBeVisible();
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
    await expect(page.getByText("選擇法規", { exact: true })).toBeHidden();
  });

  test("排程列表：讀不到時不寫成「尚無排程紀錄」", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/schedules/gantt**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    // 分頁鈕上有待審核數量的徽章，而那個數字是後來才載進來的：
    // 按得早名稱是「排程」，按得晚會變成「排程 1」。用前綴比對，不要釘完整名稱
    await page.getByRole("button", { name: /^排程/ }).click();
    // 換頁之後先等排程頁真的出現，不然斷言會打在還沒被藏起來的設備頁上
    await expect(page.getByRole("button", { name: "+ 申請排程" })).toBeVisible();

    // 甘特圖與下方表格都會說同一句，取第一個就好
    await expect(page.getByText("伺服器錯誤（500）").first()).toBeVisible();
    await expect(page.getByText("尚無排程紀錄")).toBeHidden();
  });

  test("損壞／遺失紀錄：讀不到時不會用綠字說沒有損壞", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/fixtures/loans/damaged**", (route) => route.abort());

    await page.getByRole("button", { name: "治具", exact: true }).click();
    await page.getByRole("button", { name: "記錄", exact: true }).click();

    await expect(page.getByText("連不到伺服器").first()).toBeVisible();
    await expect(page.getByText("目前無損壞或遺失紀錄")).toBeHidden();
  });

  test("保管人選單：人員讀不到時說出原因，不是一個空選單", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/auth/users**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));

    await page.getByRole("button", { name: "治具", exact: true }).click();
    await page.getByRole("row").filter({ hasText: "M.2" }).first()
      .getByRole("button", { name: "保管人" }).click();

    // 這個視窗是設定保管人的唯一入口，選單空掉又不說話的話，看起來像系統裡沒有人員
    await expect(page.getByRole("dialog", { name: "設定保管人" })
      .getByText("伺服器錯誤（500）")).toBeVisible();
  });

  test("新排程的治具清單：讀不到時說出原因並給重試", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/fixtures/", (route) => route.abort());

    await page.getByRole("button", { name: /^排程/ }).click();
    await page.getByRole("button", { name: "+ 申請排程" }).click();

    const dialog = page.getByRole("dialog", { name: "申請排程" });
    await expect(dialog.getByText("連不到伺服器")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "重試" })).toBeVisible();
    await expect(dialog.getByText("無治具資料")).toBeHidden();
  });

  test("借出視窗的借用人：必填欄位讀不到時要有重試，不能變成死路", async ({ page }) => {
    await loginAsAdmin(page);
    await page.route("**/api/auth/users**", (route) => route.abort());

    await page.getByRole("button", { name: "治具", exact: true }).click();
    await page.getByRole("button", { name: "+ 借出登記" }).click();

    const dialog = page.getByRole("dialog", { name: "借出登記" });
    await expect(dialog.getByText("連不到伺服器")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "重試" })).toBeVisible();
  });

  test("更新失敗時原本那幾列要留著，並標明是上一次讀到的", async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole("button", { name: /^排程/ }).click();
    await expect(page.getByRole("button", { name: "+ 申請排程" })).toBeVisible();

    // 先讓它正常載入一次：手上要有資料，才有「舊資料」這回事
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    const rowsBefore = await page.getByRole("row").count();

    await page.route("**/api/schedules/gantt**", (route) => route.abort());
    await page.getByRole("button", { name: "重新整理" }).click();

    await expect(page.getByText("以下為上次讀到的資料")).toBeVisible();
    // 失敗不清空既有資料，清掉會像資料被刪光了
    expect(await page.getByRole("row").count()).toBe(rowsBefore);
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
