import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";

test.beforeAll(resetBackend);

// 設備卡上的校驗徽章字數會變（「校驗即將到期」比「校驗逾期」多兩個字），而且它不能斷字。
// 以前它跟設備編號擠在頭部同一列，字一長就出事，而且是兩種壞法：
//   1. 那一格不肯縮，於是把右邊的「QC 圖」與狀態整個推出卡片外框
//   2. 補上可縮之後換成徽章自己溢出，壓在「QC 圖」按鈕底下
// 兩種 lint 都看不出來，畫面上也只是「有點擠」，沒有東西會紅。demo 資料以前從來沒有
// 「即將到期」的設備，所以這個狀態根本沒人看過。
//
// 這支量算完版面後的實際幾何，不比對 style 字串：
//   • 拿兩張同樣顯示「待機」的卡比 QC 圖的位置，一張有徽章、一張沒有，位置必須一樣
//   • 徽章不得與同一張卡的「QC 圖」按鈕重疊
//
// 為什麼要挑狀態相同的兩張：右邊那格是靠右對齊的，狀態字數不同（「執行中」對「待機」）
// 本來就會讓 QC 圖差幾個 px。拿狀態不同的卡互比會抓到那個正常差異，不是版面壞掉。

const BADGED_DEVICE = "CH-04";   // demo 資料：待機 + 校驗即將到期
const PLAIN_DEVICE = "CH-05";    // demo 資料：待機，沒有徽章 → 對照組
const ALIGN_TOLERANCE = 1;

const qcButton = (page, id) =>
  page.getByRole("button", { name: `開啟 ${id} 的感測器 QC 圖` });

async function boxOf(locator, label) {
  await expect(locator, `${label} 應該要在畫面上`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} 量不到位置`).not.toBeNull();
  return box;
}

test("設備卡的校驗徽章不會把 QC 圖與狀態擠出卡片，也不會壓在按鈕上", async ({ page }) => {
  await loginAsAdmin(page);

  // demo 資料固定有這兩張帶徽章的卡：CH-03 逾期（維修中）、CH-04 即將到期。
  // 沒有它們的話這支測試會在一組沒有徽章的卡上跑，永遠是綠的。
  await expect(page.getByText("校驗逾期", { exact: true })).toBeVisible();
  await expect(page.getByText("校驗即將到期", { exact: true })).toBeVisible();

  await test.step("有徽章的卡，QC 圖位置要跟沒徽章但狀態相同的卡一樣", async () => {
    // 兩張卡的狀態字要一樣長，位置才比得起來。demo 裡只有 CH-04、CH-05 是待機，
    // 這行同時把那個前提釘住：種子哪天變了，這裡會先紅，而不是在下面報出誤導的偏移量。
    // getByText 連隱藏分頁裡的元素都撈得到（所有頁面一直掛在 DOM 上），所以要過濾看得到的
    await expect(
      page.getByText("待機", { exact: true }).filter({ visible: true }),
      "demo 資料應該剛好有兩台待機（CH-04 有校驗徽章、CH-05 沒有）",
    ).toHaveCount(2);

    const badged = await boxOf(qcButton(page, BADGED_DEVICE), `${BADGED_DEVICE} 的 QC 圖`);
    const plain = await boxOf(qcButton(page, PLAIN_DEVICE), `${PLAIN_DEVICE} 的 QC 圖`);
    expect(
      Math.abs(badged.x - plain.x),
      `${BADGED_DEVICE}（有校驗徽章）的 QC 圖比 ${PLAIN_DEVICE}（沒徽章）偏了 `
        + `${Math.round(Math.abs(badged.x - plain.x))}px，代表徽章把同一列的東西推走了`,
    ).toBeLessThanOrEqual(ALIGN_TOLERANCE);
  });

  await test.step("徽章不與同一張卡的 QC 圖按鈕重疊", async () => {
    for (const [label, id] of [["校驗逾期", "CH-03"], ["校驗即將到期", "CH-04"]]) {
      const badge = await boxOf(page.getByText(label, { exact: true }), `${id} 的「${label}」徽章`);
      const qc = await boxOf(qcButton(page, id), `${id} 的 QC 圖`);
      const overlapX = Math.min(badge.x + badge.width, qc.x + qc.width) - Math.max(badge.x, qc.x);
      const overlapY = Math.min(badge.y + badge.height, qc.y + qc.height) - Math.max(badge.y, qc.y);
      expect(
        overlapX > 0 && overlapY > 0,
        `${id} 的「${label}」徽章與 QC 圖重疊了 ${Math.round(overlapX)}×${Math.round(overlapY)}px`,
      ).toBe(false);
    }
  });
});
