import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// demo 重灌後 CH-01 固定是 RUNNING，直接指名（同 device-stop-confirm.spec.js）
const DEVICE = "CH-01";

// 緊急停止之後，畫面要講的是現場安全與怎麼降溫。以前這時候下方還照常展開
// 「選法規 → 選條件 → 安全確認 → 確認啟動」整段新測試流程，事故處理跟開新測試混在同一頁。
// 這支盯的是那段在緊急狀態下不會出現；沒有它的話，前端改個顯示條件就會安靜地跑回來。
test.describe("緊急停止的畫面", () => {
  test("只留降溫入口，不出現啟動新測試的流程", async ({ page }) => {
    await loginAsAdmin(page);

    // 同一個編號畫面上有兩個元素，MonitorSide 那顆在這個版面是隱藏的
    await page.getByText(DEVICE, { exact: true }).filter({ visible: true }).first().click();
    const panel = page.locator("section.operation-box").first();
    await expect(panel).toContainText(`${DEVICE} — 執行中`);

    // 緊急停止是單擊立即生效，沒有確認視窗（見 .claude/rules/frontend.md）
    await page.getByRole("button", { name: "🚨 緊急停止" }).click();
    await expect(panel).toContainText(`${DEVICE} — 緊急停止中`);

    // 該留的：現場安全確認完之後回常溫的那一條路
    await expect(page.getByRole("button", { name: /確認安全，開始降溫/ })).toBeVisible();

    // 不該有的：任何開始下一次測試的入口
    await expect(page.getByText("選擇測試標準")).toBeHidden();
    await expect(page.getByText("選擇法規")).toBeHidden();
    await expect(page.getByRole("button", { name: /確認選擇，進入安全確認/ })).toBeHidden();
    await expect(page.getByRole("button", { name: /確認啟動/ })).toBeHidden();
  });
});
