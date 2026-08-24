import { expect } from "@playwright/test";

/**
 * 關掉標題為 title 的 modal。
 *
 * 畫面上常常同時有兩個 ✕：modal 自己的關閉鈕，以及 toast 的關閉鈕。在整頁找 ✕ 會
 * strict mode 撞名，所以要把範圍限在這個 modal 裡——toast 不在 modal 的 DOM 子樹。
 */
export async function closeModal(page, title) {
  await page.locator("div").filter({ has: page.getByText(title) })
    .getByRole("button", { name: "✕" }).first().click();
  await expect(page.getByText(title)).toBeHidden();
}
