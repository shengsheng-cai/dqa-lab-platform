import { expect } from "@playwright/test";

/**
 * 關掉標題為 title 的 modal。
 *
 * 每個視窗都有 role="dialog"（components/ModalFrame.jsx 給的），標題就是它的名稱，
 * 所以把範圍限在那個 dialog 裡再找關閉鈕。畫面上常常同時有兩個 ✕——視窗自己的，
 * 還有 toast 的——在整頁找會 strict mode 撞名，而 toast 不在 dialog 的 DOM 子樹裡。
 */
export async function closeModal(page, title) {
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByRole("button", { name: "✕" }).click();
  await expect(dialog).toBeHidden();
}
