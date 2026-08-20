import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 管理員的登入 token 有效 8 小時。以前它被放在 WebSocket 的網址上，
// 而網址會被寫進伺服器的 access log——看得到 log 的人就能直接拿去重放。
// 現在改成先換一張 30 秒、用過就作廢的 ticket，用握手的 subprotocol 帶進去。
//
// 兩件事都要驗：網址上不能有憑證，而且握手要真的成功。
// 只驗網址的話，ticket 被瀏覽器擋掉時畫面會安靜地退回輪詢，測試還是綠的。

test.describe("WebSocket 握手不帶憑證", () => {
  test("設備 WebSocket 網址沒有 token，且照樣收得到資料", async ({ page }) => {
    const websocketUrls = [];
    let deviceFrames = 0;
    page.on("websocket", (ws) => {
      websocketUrls.push(ws.url());
      if (/\/ws\/devices$/.test(ws.url())) {
        ws.on("framereceived", () => { deviceFrames += 1; });
      }
    });

    await loginAsAdmin(page);
    const token = await page.evaluate(() => localStorage.getItem("user_token"));
    expect(token).toBeTruthy();

    // 收到幀 = 握手過了、ticket 被接受，資料真的在流
    await expect.poll(() => deviceFrames).toBeGreaterThan(0);
    expect(websocketUrls.every((url) => !url.includes(token) && !url.includes("?"))).toBeTruthy();
  });
});
