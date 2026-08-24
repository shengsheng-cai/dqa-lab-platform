import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

// 每個測試檔跑之前把後端重來一次，跟其他檔案的狀態完全切開
test.beforeAll(resetBackend);

// 保管人以前有兩個地方可以編輯：「編輯治具」裡的一格自由文字，和這個選人員的視窗。
// 畫面顯示優先用選到的人員，所以在編輯治具改保管人會變成「按了儲存、畫面沒變」。
// 現在只剩這個視窗能改，編輯治具那格是唯讀的。
//
// 另一半是清除：選單留在「無保管人」按確認，以前會直接把名字刪掉並回一句「已設定」。
// 現在要先問過。
//
// 第三件是舊資料：只有名字、沒連到人員的保管人要看得出來，不能跟正常設定過的長得一樣。

const FIXTURE = "M.2";      // demo 重灌後保管人是陳工，且已連到人員
const KEEPER = "陳工";
const LEGACY_FIXTURE = "MXM";  // demo 重灌後保管人是「張工」這串文字，沒有對應帳號
const LEGACY_KEEPER = "張工";

const rowOf = (page, fixture) => page.getByRole("row").filter({ hasText: fixture }).first();
const fixtureRow = (page) => rowOf(page, FIXTURE);

test("保管人只能從這個視窗改，清除前要先問過", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();
  await expect(fixtureRow(page)).toContainText(KEEPER);

  await test.step("編輯治具裡的保管人是唯讀的，不能打字改", async () => {
    await fixtureRow(page).getByRole("button", { name: "編輯" }).click();
    // 進階選項在編輯模式預設展開，保管人在裡面。它要顯示目前的人，而且不能打字——
    // 這一格可以編輯的話，第二個寫入口就回來了。
    const keeperField = page.getByTitle("在治具列上的「保管人」修改");
    await expect(keeperField).toHaveValue(KEEPER);
    await expect(keeperField).toBeDisabled();
    await page.getByRole("button", { name: "取消" }).click();
  });

  await test.step("選單停在「無保管人」按確認，要先跳確認視窗", async () => {
    await fixtureRow(page).getByRole("button", { name: "保管人" }).click();
    await expect(page.getByText("設定保管人")).toBeVisible();

    // 治具頁上不只這一顆 select（還有篩選），用只有這顆才有的選項把範圍縮住
    const select = page.locator("select")
      .filter({ has: page.locator("option", { hasText: "無保管人" }) });
    // 現在的保管人已經連到人員，所以選單本來就選著他，不會出現「上面寫有、下面寫沒有」
    await expect(select).toHaveValue(/\d+/);

    await select.selectOption("");
    await page.getByRole("button", { name: "確認" }).click();

    // 光是變更不夠——要寫出清掉的是誰，不然使用者沒有東西可以核對
    await expect(page.getByText("清除保管人", { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`「${KEEPER}」會被清除`))).toBeVisible();
  });

  await test.step("取消就是什麼都沒發生，保管人還在", async () => {
    // 確認視窗是疊在設定視窗上的，畫面上因此有兩顆「取消」。用「標題 + 有取消鈕」兩個
    // 條件把範圍夾在確認視窗上——只靠「清除」不行，AI 面板也有一顆同名的按鈕。
    await page.locator("div")
      .filter({ has: page.getByText("清除保管人", { exact: true }) })
      .filter({ has: page.getByRole("button", { name: "取消" }) })
      .last()
      .getByRole("button", { name: "取消" })
      .click();

    await expect(page.getByText("清除保管人", { exact: true })).toBeHidden();
    await expect(fixtureRow(page)).toContainText(KEEPER);
  });
});

test("只有名字、沒連到人員的保管人要標示出來", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();

  // 光是顯示名字不夠——那樣跟正常設定過的保管人長得一模一樣，沒人知道它其實沒指向任何人
  const legacyRow = rowOf(page, LEGACY_FIXTURE);
  await expect(legacyRow).toContainText(LEGACY_KEEPER);
  await expect(legacyRow).toContainText("未連結人員");

  await test.step("設定視窗要說明這是什麼、以及按確認會怎樣", async () => {
    await legacyRow.getByRole("button", { name: "保管人" }).click();
    await expect(page.getByText(`「${LEGACY_KEEPER}」是舊資料留下的文字`, { exact: false })).toBeVisible();

    // 沒連到人員，所以選單是空的；這正是以前「上面寫有、下面寫沒有」那個矛盾畫面，
    // 差別在現在有一段話講清楚為什麼
    const select = page.locator("select")
      .filter({ has: page.locator("option", { hasText: "無保管人" }) });
    await expect(select).toHaveValue("");
  });
});
