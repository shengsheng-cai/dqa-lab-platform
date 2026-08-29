import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";
import { closeModal } from "../helpers/modal.js";

test.beforeAll(resetBackend);

// 主要入口不能只認滑鼠。
//
// 真正擋住「又被改回普通方框」的是 getByRole("button")：方框上的 focus() 什麼也不做，
// 後面那個 Enter 會打在空處，測試自然紅。所以斷言以「按下去畫面變成什麼」為主。
//
// 注意這裡的分工：用 focus() 的那幾條只證明「這顆是按鈕、Enter 有反應」，不證明 Tab
// 走得到（focus() 是程式指定的）。「Tab 走得到」由最後一條連按 Tab 的測試單獨釘住。

const RUNNING_PROJECT = "PRJ-2025-087";
const RUNNING_SAMPLE = "IEC60068 熱循環模組測試"; // 同一筆的樣品名，甘特圖的名稱要含得住

test("設備卡用鍵盤就能換要看哪一台", async ({ page }) => {
  await loginAsAdmin(page);

  const panel = page.locator("section.operation-box").first();
  await expect(panel).toContainText("CH-01");

  const ch02 = page.getByRole("button", { name: "CH-02", exact: true });
  await expect(ch02).not.toHaveAttribute("aria-current", "true");

  await ch02.focus();
  await page.keyboard.press("Enter");

  await expect(panel).toContainText("CH-02");
  // 選中狀態以前只有顏色，螢幕閱讀器讀不到顏色
  await expect(ch02).toHaveAttribute("aria-current", "true");
});

// 以下三條補的是同一件事：畫面上「現在選中哪一個」只用背景色和字重表達，
// 顏色對螢幕閱讀器不存在。設備卡、排程篩選、分頁列在前一批已經處理，這三處是同類的漏網。

test("維護頁的設備切換說得出目前選的是哪一台", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "維護", exact: true }).click();
  await expect(page.getByText("校驗紀錄", { exact: true })).toBeVisible();

  const ch01 = page.getByRole("button", { name: "CH-01", exact: true });
  const ch03 = page.getByRole("button", { name: "CH-03", exact: true });
  await expect(ch01).toHaveAttribute("aria-current", "true");
  await expect(ch03).not.toHaveAttribute("aria-current", "true");

  await ch03.focus();
  await page.keyboard.press("Enter");

  await expect(ch03).toHaveAttribute("aria-current", "true");
  await expect(ch01).not.toHaveAttribute("aria-current", "true");
});

test("SOP 選法規說得出目前選的是哪一條", async ({ page }) => {
  await loginAsAdmin(page);
  // 選法規只在待機的設備上出現，跑測試中的那台顯示的是進行中的畫面。seed 固定讓 CH-05 待機。
  await page.getByRole("button", { name: "CH-05", exact: true }).click();
  await expect(page.getByText("選擇法規", { exact: true })).toBeVisible();

  const iec = page.getByRole("button", { name: "IEC 60068 基礎環境測試", exact: true });
  const dnv = page.getByRole("button", { name: "DNV 船舶設備環境認證", exact: true });
  // 先選 IEC，後面換 DNV 才有「上一顆要放掉」可以驗
  await iec.focus();
  await page.keyboard.press("Enter");
  await expect(iec).toHaveAttribute("aria-current", "true");

  await dnv.focus();
  await page.keyboard.press("Enter");

  await expect(dnv).toHaveAttribute("aria-current", "true");
  await expect(iec).not.toHaveAttribute("aria-current", "true");
});

test("登入頁的帳號與訪客分頁說得出目前在哪一個", async ({ page }) => {
  // 這條刻意不登入：登入頁是第一個畫面，選錯分頁的人會一直找不到要填的欄位
  await page.goto("/");

  const user = page.getByRole("button", { name: "帳號登入", exact: true });
  const guest = page.getByRole("button", { name: "訪客模式", exact: true });
  await expect(user).toHaveAttribute("aria-current", "true");

  await guest.focus();
  await page.keyboard.press("Enter");

  await expect(guest).toHaveAttribute("aria-current", "true");
  await expect(user).not.toHaveAttribute("aria-current", "true");
});

test("排程表格與甘特圖用鍵盤就能打開詳情", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();

  await test.step("表格列：專案號碼是入口，名稱要說得出按下去會開什麼", async () => {
    await page.getByRole("button", { name: `開啟 ${RUNNING_PROJECT} 的排程詳情` }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("排程詳情", { exact: true })).toBeVisible();
    await closeModal(page, "排程詳情");
  });

  await test.step("甘特圖區塊：滑鼠靠 hover 的小黃框，鍵盤要有讀得到的名稱", async () => {
    // 名稱要含專案、樣品與狀態；只有專案號碼的話，聽的人不知道那是哪一筆
    await page.getByRole("button", { name: new RegExp(`^${RUNNING_PROJECT} ${RUNNING_SAMPLE}.*進行中`) }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("排程詳情", { exact: true })).toBeVisible();
  });
});

test("新排程的法規與版本用鍵盤選得到", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: /^排程/ }).click();
  await page.getByRole("button", { name: "+ 申請排程" }).click();

  const standard = page.getByRole("button", { name: "EN 50155", exact: true });
  await standard.focus();
  await page.keyboard.press("Enter");
  await expect(standard).toHaveAttribute("aria-current", "true");

  await page.getByRole("button", { name: "EN 50155:2017", exact: true }).focus();
  await page.keyboard.press("Enter");

  // 走完兩步，第三欄才列得出那個版本的測試條件——這是申請排程的第一關
  await expect(page.getByText("OT3 高溫乾熱：+70°C，16h（非通電）【預設等級】")).toBeVisible();
});

test("治具總表用鍵盤排得了序，也說得出目前排哪一欄", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  const header = page.getByRole("columnheader", { name: "介面" });
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  const firstBefore = await page.getByRole("row").nth(1).innerText();

  await page.getByRole("button", { name: "介面", exact: true }).focus();
  await page.keyboard.press("Enter");

  // 排序方向要讀得出來，不能只有表頭那個箭頭
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("row").nth(1)).not.toHaveText(firstBefore);
});

test("治具匯入用鍵盤進得去", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();
  await page.locator("select")
    .filter({ has: page.locator("option", { hasText: "Excel 操作" }) })
    .selectOption("import");

  // 以前唯一的入口是一塊 div，點下去才去戳一個 display:none 的檔案欄位——
  // display:none 的東西 Tab 停不上去，用鍵盤的人完全匯不了檔
  const choose = page.getByRole("button", { name: "選擇檔案" });
  await choose.focus();
  await expect(choose).toBeFocused();
});

test("盤點批次用鍵盤展得開", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();
  await page.getByRole("button", { name: "記錄", exact: true }).click();
  await page.getByRole("button", { name: "盤點紀錄", exact: true }).click();

  // 那一列裡已經有「刪除此批次」按鈕，按鈕不能包按鈕，所以入口是批次時間那顆
  const batch = page.getByRole("button", { name: /^最新/ });
  await expect(batch).toHaveAttribute("aria-expanded", "true");

  await batch.focus();
  await page.keyboard.press("Enter");
  await expect(batch).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  await expect(batch).toHaveAttribute("aria-expanded", "true");
});

test("AI 對話用鍵盤改得了名字", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByTitle("AI 諮詢").click();

  // 名稱那段掛著 onDoubleClick 當滑鼠捷徑，帶著 eslint-disable；
  // 這條盯的是它旁邊那顆按鈕，也就是鍵盤真正走得到的入口。
  const rename = page.getByRole("button", { name: /^改名：/ });
  await rename.focus();
  await page.keyboard.press("Enter");

  const field = page.getByPlaceholder("對話名稱");
  await expect(field).toBeFocused();
  await field.fill("低溫測試討論");
  await page.keyboard.press("Enter");

  await expect(page.getByText("低溫測試討論")).toBeVisible();
});

test("設備卡真的排在 Tab 順序裡，不是只有程式指定焦點才進得去", async ({ page }) => {
  await loginAsAdmin(page);

  // 上面那幾條用 focus() 直接指定焦點，證明不了「使用者按 Tab 走得到」——
  // 被設成跳過、被蓋住、藏在沒顯示的分支裡，那幾條照樣會綠。這條連按 Tab 補上那一段。
  const reached = new Set();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const text = await page.evaluate(() => (document.activeElement.textContent || "").trim());
    if (/^CH-0\d$/.test(text)) reached.add(text);
  }

  expect([...reached].sort()).toEqual(["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"]);
});
