import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 人員管理頁的寫入操作以前幾乎都是沉默的：撤銷訪客 Token 成功沒訊息、失敗被空 catch
// 吞掉；複製按鈕不等結果也不報結果，而那串完整 Token 關掉提示就再也看不到；人員啟用
// 切換成功沒回饋、失敗只講一句「激活狀態更新失敗」，既不是這個介面的用詞，也看不出是誰。
//
// 這三支盯的都是同一件事：按下去之後，畫面有沒有講清楚發生了什麼。

// 兩張表長得像，一律用表頭認，不然按鈕名稱會互相撞
const tokenTableOf = (page) =>
  page.locator("table").filter({ has: page.locator("th", { hasText: "到期日" }) });
const userTableOf = (page) =>
  page.locator("table").filter({ has: page.locator("th", { hasText: "角色" }) });

async function createToken(page, label) {
  await page.getByRole("button", { name: "+ 生成" }).click();
  await page.getByPlaceholder("例：廠商 Demo、主管審閱").fill(label);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByText("新 Token：")).toBeVisible();
}

test("建立、複製與撤銷訪客 Token 都要有明確回饋", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "人員管理" }).click();

  await test.step("建立一把 Token", async () => {
    await createToken(page, "E2E 撤銷測試");
  });

  await test.step("複製要回報結果，不能按了沒反應", async () => {
    await page.getByRole("button", { name: "複製", exact: true }).click();
    await expect(page.getByRole("button", { name: "✓ 已複製" })).toBeVisible();
    await expect(page.getByText("Token 已複製")).toBeVisible();
  });

  // AI 面板一直掛在 DOM 上（只是被 translateX 移出畫面），它那顆「關閉」照樣抓得到，
  // 所以定位要收進 Token 提示區
  const hint = page.locator("div").filter({ has: page.getByText("新 Token：") }).last();
  await hint.getByRole("button", { name: "關閉", exact: true }).click();

  const row = tokenTableOf(page).getByRole("row").filter({ hasText: "E2E 撤銷測試" });
  const token = (await row.getByRole("cell").first().innerText()).trim();

  await test.step("確認視窗要寫出撤的是哪一把", async () => {
    await row.getByRole("button", { name: "刪除", exact: true }).click();
    await expect(page.getByText(`確定撤銷 Token「${token}」（E2E 撤銷測試）`)).toBeVisible();
  });

  await test.step("取消就真的沒動它", async () => {
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("button", { name: "確認撤銷" })).toBeHidden();
    await expect(row).toBeVisible();
  });

  await test.step("撤銷失敗要留在原地，不能看起來像處理完了", async () => {
    await page.route("**/api/auth/demo-tokens/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":null}' })
        : route.continue(),
    );
    await row.getByRole("button", { name: "刪除", exact: true }).click();
    await page.getByRole("button", { name: "確認撤銷" }).click();

    await expect(page.getByText("撤銷失敗，此 Token 可能仍然有效")).toBeVisible();
    // 視窗和那一列都要還在：這把 Token 可能還能登入，不能讓畫面看起來已經沒事了
    await expect(page.getByRole("button", { name: "確認撤銷" })).toBeVisible();
    await page.unroute("**/api/auth/demo-tokens/*");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
  });

  await test.step("撤銷成功要講出撤掉的是哪一把", async () => {
    await row.getByRole("button", { name: "刪除", exact: true }).click();
    await page.getByRole("button", { name: "確認撤銷" }).click();
    await expect(page.getByText(`Token「${token}」已撤銷`)).toBeVisible();
    await expect(row).toBeHidden();
  });
});

test("沒有 clipboard API 時，複製失敗要說出來並把 Token 選起來", async ({ page }) => {
  // navigator.clipboard 掛在 Navigator.prototype 上，delete 動不到，
  // 要在實例上蓋一個同名屬性把它擋掉
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "人員管理" }).click();
  await createToken(page, "複製失敗測試");

  const hint = page.locator("div").filter({ has: page.getByText("新 Token：") }).last();
  const shown = (await hint.locator("span").nth(1).innerText()).trim();

  await page.getByRole("button", { name: "複製", exact: true }).click();

  await expect(page.getByText("複製失敗，Token 已選取，請直接按 Ctrl/Cmd + C")).toBeVisible();
  await expect(page.getByRole("button", { name: "✓ 已複製" })).toBeHidden();
  // 這個提示一關就再也看不到完整 Token，所以失敗時至少要讓人選得起來自己複製
  const selected = await page.evaluate(() => window.getSelection().toString().trim());
  expect(selected).toBe(shown);
});

test("人員啟用切換的成功與失敗都要說出是誰", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "人員管理" }).click();
  const userTable = userTableOf(page);

  // 不拿 admin 自己做實驗：停用唯一的管理者等於把自己鎖在外面
  await test.step("先建一位測試人員", async () => {
    await page.getByRole("button", { name: "+ 新增" }).click();
    await page.getByPlaceholder("例：王小明").fill("回饋測試員");
    // 角色的標籤沒有 *，但送出時會被擋，不填這裡會停在表單上
    await page.getByPlaceholder("例：管理者、工程師、保管人").fill("工程師");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect(userTable.getByRole("row").filter({ hasText: "回饋測試員" })).toBeVisible();
  });

  const row = userTable.getByRole("row").filter({ hasText: "回饋測試員" });

  await test.step("停用成功要講出停的是誰", async () => {
    await row.getByRole("button", { name: "停用", exact: true }).click();
    await expect(page.getByText("已停用「回饋測試員」")).toBeVisible();
    await expect(row.getByRole("button", { name: "啟用", exact: true })).toBeVisible();
  });

  await test.step("失敗要帶人名與剛才想做的動作，不能只說一句更新失敗", async () => {
    await page.route("**/api/auth/users/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":null}' })
        : route.continue(),
    );
    await row.getByRole("button", { name: "啟用", exact: true }).click();
    await expect(page.getByText("「回饋測試員」啟用失敗")).toBeVisible();
    // 失敗了就該維持原狀，不能讓畫面顯示成已經啟用
    await expect(row.getByRole("button", { name: "啟用", exact: true })).toBeVisible();
  });
});

// 刪除人員以前是：成功沒有任何訊息，失敗照樣把確認視窗關掉。
// 後者比較糟——畫面回到一個看起來已經處理完的列表，但那個人其實還在、還能登入。
// 同一頁的撤銷 Token 早就是「失敗留在原地」，兩種相反的做法並存。
test("刪除人員的成功與失敗都要說出是誰，失敗還要留在原地", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "人員管理" }).click();
  const userTable = userTableOf(page);

  await test.step("先建一位測試人員", async () => {
    await page.getByRole("button", { name: "+ 新增" }).click();
    await page.getByPlaceholder("例：王小明").fill("刪除測試員");
    await page.getByPlaceholder("例：管理者、工程師、保管人").fill("工程師");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect(userTable.getByRole("row").filter({ hasText: "刪除測試員" })).toBeVisible();
  });

  const row = userTable.getByRole("row").filter({ hasText: "刪除測試員" });
  const dialog = page.getByRole("dialog", { name: "刪除人員" });

  await test.step("失敗要留在原地：人還在，視窗就不能收掉", async () => {
    await page.route("**/api/auth/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":null}' })
        : route.continue(),
    );
    await row.getByRole("button", { name: "刪除", exact: true }).click();
    await dialog.getByRole("button", { name: "確認刪除" }).click();

    await expect(page.getByText("「刪除測試員」刪除失敗")).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(row).toBeVisible();
  });

  await test.step("成功才收掉視窗，並講出刪掉的是誰", async () => {
    await page.unroute("**/api/auth/users/*");
    await dialog.getByRole("button", { name: "確認刪除" }).click();

    await expect(page.getByText("已刪除「刪除測試員」")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
  });
});
