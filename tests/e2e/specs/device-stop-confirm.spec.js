import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// demo 重灌後 CH-01 固定是 RUNNING（init_db 種 dwell_high、5 循環的 -40/+85 曲線，
// 跑好幾個小時），所以直接指名，不用掃描。
const DEVICE = "CH-01";

// 「⏹ 正常停止」按一下就會跳過剩餘步驟、讓設備開始降溫，而且沒有復原鍵——
// 誤點一次，一支跑了幾小時的測試就沒了。這支盯的是那道確認關卡還在。
// 關卡被拿掉的話，後端測試不會有任何一支變紅，只會有人某天誤停一支測試。
test.describe("正常停止的防誤觸確認", () => {
  test("先跳確認視窗；取消之後設備維持執行中", async ({ page }) => {
    await loginAsAdmin(page);

    // 畫面上同一個編號有兩個元素，MonitorSide 那顆在這個版面是隱藏的，
    // 少了 visible 過濾會選到看不見的那顆、卡到逾時。
    await page.getByText(DEVICE, { exact: true }).filter({ visible: true }).first().click();
    const panel = page.locator("section.operation-box").first();
    await expect(panel).toContainText(`${DEVICE} — RUNNING`);

    await page.getByRole("button", { name: "⏹ 正常停止" }).click();

    // 確認視窗要說清楚停的是哪一台、會發生什麼事，不能只有一句「確定嗎」——
    // 使用者要有東西可以核對，才擋得住誤點。
    // 斷言要抓視窗自己的句子：設備編號在畫面上到處都有，只比對編號等於沒驗。
    const dialogTitle = page.getByText("停止測試", { exact: true });
    await expect(dialogTitle).toBeVisible();
    await expect(page.getByText(new RegExp(`要停止 ${DEVICE} 上的`))).toBeVisible();
    await expect(page.getByText("剩餘步驟會被跳過", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "取消" }).click();
    await expect(dialogTitle).toBeHidden();

    // 取消就是什麼都沒發生：設備還在跑，沒有偷偷把停止送出去。
    await expect(panel).toContainText(`${DEVICE} — RUNNING`);
  });
});
