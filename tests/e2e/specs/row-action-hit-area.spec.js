import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 表格列上的動作鈕以前每一頁各寫一種尺寸，最小的一種只有 10px 字、上下 1px 內距，
// 用觸控板或小螢幕很容易點成隔壁那顆——而隔壁那顆常常是「刪除」。
//
// 尺寸與排列現在由 styles/common.js 的 btnRowAction／btnRowDanger／rowActions 決定。
// 這支守三件事，全部量算完版面後的實際幾何，不比對 style 字串：
//   1. 每顆按鈕的點擊高度
//   2. 同一組動作排在同一列——換行會把刪除甩到第二行最前面，正好落在第一顆正下方
//   3. 刪除是最後一顆，而且跟前一顆隔得開
// 這三件 lint 都看不出來，畫面上也只是「小一點」「擠一點」，沒有東西會紅。

const MIN_HIT = 32;
const MIN_GAP = 12;

async function hitBox(locator, label) {
  await expect(locator, `${label} 應該要在畫面上`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 量不到位置`).not.toBeNull();
  expect(
    Math.round(box.height),
    `${label} 的點擊高度只有 ${Math.round(box.height)}px，低於 ${MIN_HIT}px`,
  ).toBeGreaterThanOrEqual(MIN_HIT);
  return box;
}

// names 要照畫面上的順序給，最後一個是刪除
async function expectRowActions(row, names, label) {
  const boxes = [];
  for (const name of names) {
    boxes.push(await hitBox(row.getByRole("button", { name, exact: true }), `${label}的「${name}」`));
  }

  for (let i = 1; i < boxes.length; i++) {
    expect(
      Math.abs(boxes[i].y - boxes[0].y),
      `${label}的「${names[i]}」被擠到另一列（跟第一顆差 ${Math.round(Math.abs(boxes[i].y - boxes[0].y))}px）`,
    ).toBeLessThanOrEqual(2);
  }

  const prev = boxes[boxes.length - 2];
  const remove = boxes[boxes.length - 1];
  expect(
    Math.round(remove.x - (prev.x + prev.width)),
    `${label}的「刪除」與前一顆之間只隔 ${Math.round(remove.x - (prev.x + prev.width))}px`,
  ).toBeGreaterThanOrEqual(MIN_GAP);
}

test("治具總表的列動作點得到，四顆也排得成一列", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "治具", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "快速盤點" })).toBeVisible();

  await test.step("一般的三顆", async () => {
    const row = page.getByRole("row").filter({ hasText: "M.2" }).first();
    await expectRowActions(row, ["編輯", "保管人", "刪除"], "治具列");
  });

  // 缺貨的治具會多出「採購」。四顆是最擠的情況，而且只有這一列量得到——
  // 種子資料裡 MXM 借出 1 個、可借 0，所以它就是那一列
  await test.step("缺貨那一列會多一顆採購，四顆仍要在同一列", async () => {
    const row = page.getByRole("row").filter({ hasText: "MXM" }).first();
    await expect(row.getByRole("button", { name: "採購", exact: true })).toBeVisible();
    await expectRowActions(row, ["編輯", "保管人", "採購", "刪除"], "缺貨治具列");
  });
});

test("維護頁校驗與維護兩張表的列動作點得到", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "維護", exact: true }).click();
  // 所有頁面都掛在 DOM 上，切過去要先等這一頁真的顯示出來再開始量
  await expect(page.getByText("校驗紀錄", { exact: true })).toBeVisible();

  // 兩張表左右並排、按鈕同名，一定要各自夾住：只用 .first() 的話量到的永遠是左邊那張
  const tables = [
    ["校驗紀錄", "校驗日期"],
    ["維護紀錄", "維護日期"],
  ];
  for (const [label, header] of tables) {
    const table = page.locator("table").filter({ has: page.locator("th", { hasText: header }) });
    const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: "刪除" }) }).first();
    await expectRowActions(row, ["編輯", "刪除"], label);
  }
});

test("人員管理的列動作點得到", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "人員管理" }).click();

  // 這一頁有兩張長得像的表，用只有人員表才有的表頭把範圍夾住
  const userTable = page.locator("table").filter({ has: page.locator("th", { hasText: "角色" }) });
  const row = userTable.getByRole("row").filter({ has: page.getByRole("button", { name: "刪除" }) }).first();
  await expectRowActions(row, ["編輯", "停用", "刪除"], "人員列");
});
