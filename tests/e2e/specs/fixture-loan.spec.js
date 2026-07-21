import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 治具借還生命週期：借出 → 庫存扣減 → 歸還 → 庫存恢復。
//
// 為什麼測這條：治具管理的核心就是「庫存數字要準」。借出沒扣、歸還沒還，
// 現場就會發生「系統說有、櫃子裡沒有」。這條走完一個來回，確認兩個方向都對。
//
// 用「Admin」當錨點：demo 資料借出的都是 X 工（字串名，非帳號），
// 借用人下拉只有 Admin 一個，所以借出列表裡出現 Admin 一定是這個測試剛借的。

// 抓某介面治具主列的「可借」數字。
// 總表欄序：0介面 / 1尺寸 / 2規格 / 3總數 / 4借出 / 5預約 / 6可借 / 7缺口 ...
async function availableQty(page, iface) {
  const row = page.getByRole("row").filter({ hasText: iface }).first();
  return Number((await row.locator("td").nth(6).innerText()).trim());
}

test("治具借出後庫存扣減，歸還後恢復", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  const IFACE = "M.2";
  const before = await availableQty(page, IFACE);
  expect(before).toBeGreaterThan(0); // 沒得借就測不下去

  await test.step("借出一件給 Admin", async () => {
    await page.getByRole("button", { name: "+ 借出登記" }).click();

    // 借的必須是同一個 IFACE，不能用固定 index——不然「借哪台」跟上面「量哪台」
    // 只是剛好對上，demo 資料一改順序就會借了別台、卻檢查 M.2 的數字。
    const fixtureSelect = page.locator("select")
      .filter({ has: page.locator("option", { hasText: "選擇治具" }) });
    const ifaceValue = await fixtureSelect.locator("option", { hasText: IFACE })
      .first().getAttribute("value");
    await fixtureSelect.selectOption(ifaceValue);
    await page.locator("select").filter({ has: page.locator("option", { hasText: "選擇借用人" }) })
      .selectOption({ label: "Admin（admin）" });
    await page.getByPlaceholder("數量").fill("1");
    // 改年份就會讓 DatePicker 送出日期，due_date 才有值（未來日）
    await page.locator("select").filter({ has: page.locator("option", { hasText: "2027" }) })
      .selectOption("2027");

    await page.getByRole("button", { name: "確認借出" }).click();
    await expect(page.getByText("治具借出成功")).toBeVisible();
  });

  await test.step("可借數少 1", async () => {
    await expect.poll(() => availableQty(page, IFACE)).toBe(before - 1);
  });

  // 展開的借出子列。用 accessible name「以 Admin 開頭」定位，避開兩個坑：
  // 巢狀表格會讓 hasText:"Admin" 同時命中外層 row；借出日/到期日又會隨當天變動。
  const adminLoan = page.getByRole("row", { name: /^Admin/ });

  await test.step("展開該治具，借出列表看得到 Admin", async () => {
    // 展開只綁在「借出」那格（td 第 4 欄，就是有 ▼ 的數字），點整列不會展開
    await page.getByRole("row").filter({ hasText: IFACE }).first()
      .locator("td").nth(4).click();
    await expect(adminLoan).toBeVisible();
  });

  await test.step("歸還後可借數恢復", async () => {
    // 歸還走原生 window.confirm，先掛好自動點確定
    page.on("dialog", (d) => d.accept());
    await adminLoan.getByRole("button", { name: "正常" }).click();

    await expect.poll(() => availableQty(page, IFACE)).toBe(before);
  });
});
