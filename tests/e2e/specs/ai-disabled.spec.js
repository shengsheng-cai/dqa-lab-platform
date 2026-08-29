import { test, expect } from "@playwright/test";
import { resetBackendWithEnv } from "../helpers/backend.js";
import { loginAsAdmin, loginAsGuest } from "../helpers/login.js";

// 這支要的是「後端沒設 GEMINI_API_KEY」那個狀態，所以不能用一般的 resetBackend：
// run-e2e.sh 會塞一把假金鑰讓其他 AI 測試送得出去。這裡把它清成空字串再開後端。
test.beforeAll(() => resetBackendWithEnv({ GEMINI_API_KEY: "" }));

// AI 沒設定的時候，面板以前跟平常一模一樣：能打字、能按送出，按了什麼都沒發生。
// 管理者至少在頁面頂端看得到環境告警，訪客連那個都看不到。
//
// 訪客那條是這支的重點：能力旗標本來只發給管理者，所以訪客的畫面無從判斷該不該停用。
const REASON = "AI 尚未設定，請聯絡管理者";

async function openAiPanel(page) {
  await page.getByTitle("AI 諮詢").click();
}

test.describe("AI 未設定時，面板要說得出原因", () => {
  for (const [who, login] of [["管理者", loginAsAdmin], ["訪客", loginAsGuest]]) {
    test(`${who}：原因寫在面板上，輸入框與送出都停用`, async ({ page }) => {
      await login(page);
      await openAiPanel(page);

      await expect(page.getByText(`${REASON}。`)).toBeVisible();
      await expect(page.getByPlaceholder(REASON)).toBeDisabled();
      await expect(page.getByRole("button", { name: "送出", exact: true })).toBeDisabled();
    });
  }

  test("功能介紹與範例問題留在畫面上，只是按不動", async ({ page }) => {
    await loginAsAdmin(page);
    await openAiPanel(page);

    await expect(page.getByText("DQA Lab 法規諮詢助手")).toBeVisible();

    // 範例問題的句子在上面那排快速問題裡也可能隨機出現同一句，
    // 所以不指定是哪一顆，凡是叫這個名字的都得是停用的。
    const example = page.getByRole("button", {
      name: "IEC 60068-2-14 有哪些溫度循環條件？",
    });
    await expect(example.first()).toBeVisible();
    for (const btn of await example.all()) {
      await expect(btn).toBeDisabled();
    }
  });
});
