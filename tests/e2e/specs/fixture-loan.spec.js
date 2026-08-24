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
// 總表欄序：0介面 / 1型態 / 2尺寸 / 3現有 / 4借出 / 5預約 / 6可借 / 7缺貨 ...
async function availableQty(page, iface) {
  const row = page.getByRole("row").filter({ hasText: iface }).first();
  return Number((await row.locator("td").nth(6).innerText()).trim());
}

// 借一件給 Admin。借的必須是傳進來的那個 IFACE，不能用固定 index——不然
// 「借哪台」跟「量哪台」只是剛好對上，demo 資料一改順序就會借了別台。
async function borrowOneToAdmin(page, iface) {
  await page.getByRole("button", { name: "+ 借出登記" }).click();

  const fixtureSelect = page.locator("select")
    .filter({ has: page.locator("option", { hasText: "選擇治具" }) });
  const ifaceValue = await fixtureSelect.locator("option", { hasText: iface })
    .first().getAttribute("value");
  await fixtureSelect.selectOption(ifaceValue);
  await page.locator("select").filter({ has: page.locator("option", { hasText: "選擇借用人" }) })
    .selectOption({ label: "Admin（admin）" });
  await page.getByLabel("借出數量").fill("1");
  // 改年份就會讓 DatePicker 送出日期，due_date 才有值（未來日）
  await page.locator("select").filter({ has: page.locator("option", { hasText: "2027" }) })
    .selectOption("2027");

  await page.getByRole("button", { name: "確認借出" }).click();
  await expect(page.getByText("治具借出成功")).toBeVisible();
}

// 展開借出子列。展開綁在「借出」那格裡的按鈕上，點整列不會展開。
// 用按鈕的名稱定位，不要數第幾格——欄序一改那種寫法就會安靜地點到別的東西。
const loansToggle = (page, iface) =>
  page.getByRole("row").filter({ hasText: iface }).first()
    .getByRole("button", { name: /借用明細/ });

// 展開後的借出子列。用 accessible name「以 Admin 開頭」定位，避開兩個坑：
// 巢狀表格會讓 hasText:"Admin" 同時命中外層 row；借出日/到期日又會隨當天變動。
const adminLoanRow = (page) => page.getByRole("row", { name: /^Admin/ });

async function topBarLoanedCount(page) {
  const stat = page.locator("span").filter({ hasText: /^治具借出：/ }).first();
  await expect(stat).not.toContainText("—");
  return Number((await stat.locator("span").innerText()).trim());
}

test("治具借出後庫存扣減，歸還後恢復", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  const IFACE = "M.2";
  const before = await availableQty(page, IFACE);
  const beforeLoaned = await topBarLoanedCount(page);
  expect(before).toBeGreaterThan(0); // 沒得借就測不下去

  await test.step("借出一件給 Admin", () => borrowOneToAdmin(page, IFACE));

  await test.step("可借數少 1", async () => {
    await expect.poll(() => availableQty(page, IFACE)).toBe(before - 1);
  });

  await test.step("TopBar 借出數立即加 1，不等 30 秒輪詢", async () => {
    await expect.poll(() => topBarLoanedCount(page)).toBe(beforeLoaned + 1);
  });

  await test.step("展開該治具，借出列表看得到 Admin", async () => {
    await loansToggle(page, IFACE).click();
    await expect(adminLoanRow(page)).toBeVisible();
  });

  await test.step("歸還後可借數恢復", async () => {
    // 歸還開 Modal：狀態預設「正常」、歸還日預設今天，直接按確認就好
    await adminLoanRow(page).getByRole("button", { name: "歸還" }).click();
    await page.getByRole("button", { name: "確認歸還" }).click();
    await expect(page.getByText("治具歸還成功")).toBeVisible();

    await expect.poll(() => availableQty(page, IFACE)).toBe(before);
    await expect.poll(() => topBarLoanedCount(page)).toBe(beforeLoaned);
  });
});

// 歸還 Modal 才有的兩件事：標記損壞要二次確認、備註要留得下來。
// 這個 Modal 曾經因為沒有任何入口而變成死碼（總表只有三顆直接送出的按鈕），
// 沒被發現的原因就是沒人測它。這條就是那個入口的守門。
test("歸還標記損壞需二次確認，備註會留進損壞／遺失紀錄", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  const IFACE = "M.2";
  const NOTE = "外殼裂痕，待評估是否可續用";
  const before = await availableQty(page, IFACE);

  await test.step("借出一件給 Admin", () => borrowOneToAdmin(page, IFACE));

  await test.step("開歸還 Modal，選損壞並填備註", async () => {
    await loansToggle(page, IFACE).click();
    await adminLoanRow(page).getByRole("button", { name: "歸還" }).click();
    await page.getByRole("button", { name: "損壞" }).click();
    await page.getByPlaceholder("備註（選填）").fill(NOTE);

    // 第一次按只會把按鈕變成警告字樣，要再按一次才真的送出
    await page.getByRole("button", { name: "確認歸還" }).click();
    await page.getByRole("button", { name: /確定標記為損壞/ }).click();
    await expect(page.getByText("治具歸還成功")).toBeVisible();
  });

  await test.step("損壞品仍占用庫存，可借數不恢復", async () => {
    await expect.poll(() => availableQty(page, IFACE)).toBe(before - 1);
  });

  await test.step("記錄頁的損壞／遺失清單看得到備註", async () => {
    await page.getByRole("button", { name: "記錄", exact: true }).click();
    await expect(page.getByText(NOTE)).toBeVisible();
  });
});

// 借出明細與「歸還」只有這一個入口。以前它是一個可點的數字加 9px 三角形，得先猜到數字
// 能點才找得到歸還；找不到的人會以為系統沒有歸還流程。這支盯它是不是一顆找得到、
// 也按得到的按鈕——只驗「點了會展開」不夠，滑鼠點得到不代表鍵盤走得到。
test("借出明細的入口是找得到、鍵盤也按得動的按鈕", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  // demo 重灌後 M.2 有借出，所以那一列一定有這顆按鈕
  const toggle = loansToggle(page, "M.2");
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText("明細");     // 看得懂的字，不是只有三角形
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await test.step("用鍵盤聚焦後按 Enter 就能展開", async () => {
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toContainText("收合");
    await expect(page.getByRole("columnheader", { name: "借用人" })).toBeVisible();
  });

  await test.step("再按一次收合", async () => {
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("columnheader", { name: "借用人" })).toBeHidden();
  });
});
