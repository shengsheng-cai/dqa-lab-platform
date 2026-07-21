import { expect } from "@playwright/test";

// 讀測試專用的假密碼，由 run-e2e.sh 設定，不是 backend/.env 裡的真密碼。
// 直接跑 playwright（沒經過 run-e2e.sh）時會沒有這個變數，
// 這裡明講原因，不然只會看到 locator.fill 收到 undefined 的型別錯誤。
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `沒有 ${name}。請用 \`make test-e2e\` 執行；` +
      "要直接跑 playwright 的話，先自己 export 這個環境變數。",
    );
  }
  return v;
}

export const adminPassword = () => requireEnv("E2E_ADMIN_PASSWORD");

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

// 用訪客身分登入。用 DEMO_PASSWORD master key 進，不用先開 token。
export async function loginAsGuest(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "訪客模式" }).click();
  await page.getByPlaceholder(/訪客 Token/).fill(requireEnv("E2E_DEMO_PASSWORD"));
  await page.getByRole("button", { name: "進入系統" }).click();
  await expect(page.getByPlaceholder(/訪客 Token/)).toBeHidden();
}
