import { expect } from "@playwright/test";

// 測試專用的假密碼，由 run-e2e.sh 設定，不是 backend/.env 裡的真密碼。
// 直接跑 playwright（沒經過 run-e2e.sh）時會沒有這個變數，
// 這裡明講原因，不然只會看到 locator.fill 收到 undefined 的型別錯誤。
export function adminPassword() {
  const pw = process.env.E2E_ADMIN_PASSWORD;
  if (!pw) {
    throw new Error(
      "沒有 E2E_ADMIN_PASSWORD。請用 `make test-e2e` 執行；" +
      "要直接跑 playwright 的話，先自己 export 這個環境變數。",
    );
  }
  return pw;
}

// 用管理員身分登入。
//
// 註：smoke.spec.js 沒有用這個 helper，那支是在「測登入本身」，
// 步驟要攤開來看得到，不能藏在函式裡。
export async function loginAsAdmin(page) {
  await page.goto("/");
  await page.getByPlaceholder("帳號").fill("admin");
  await page.getByPlaceholder("密碼").fill(adminPassword());
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByPlaceholder("密碼")).toBeHidden();
}
