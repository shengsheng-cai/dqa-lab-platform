import { test, expect } from "@playwright/test";
import { resetBackend } from "../helpers/backend.js";
import { loginAsAdmin } from "../helpers/login.js";
import { closeModal } from "../helpers/modal.js";
import { addBlockedPeriod, BLOCKED_PERIODS_MODAL } from "../helpers/blocked-periods.js";

// 這支要從乾淨的種子資料開始數，所以自己一個檔案：同一個檔案裡的測試共用一個後端，
// 前一個測試多標一台維護就會把「不可用」的基準墊高。
test.beforeAll(resetBackend);

// 頂部那排數字以前算的是「維護中或身上有排程」的混合旗標，而且連設備狀態都不看，於是一台
// 正在跑排程的機器會同時被算進「執行中」和「不可用」——四個數字加起來比設備總數還多，
// 而畫面上只看得到幾個各自合理的數字，看不出是同一台被數了兩次。
//
// 加總這條是主要保證：它不必知道哪台在跑什麼，只要有任何一台被重複計算就會超過總數。
// 用「不超過」不是「等於」：收尾降溫中與暫停的機器本來就不在這四個數字裡，拿等號會讓
// 測試在設備剛好轉去收尾時無故變紅。

const DEVICE_COUNT = 5;        // CH-01~CH-05，與 constants.js 的 DEVICE_IDS 一致
const SEEDED_MAINT_COUNT = 1;  // demo 資料只有 CH-03 排了維護（壓縮機例行保養）
const EXTRA_MAINT_DEVICE = "CH-05"; // 重灌後為 IDLE 且未封鎖，拿它來加第二筆維護

test("頂部計數：「不可用」只算維護中的機器，各狀態加起來不超過設備總數", async ({ page }) => {
  await loginAsAdmin(page);

  const statValue = async (label) => {
    const text = await page.getByText(new RegExp(`^${label}：\\d+$`)).first().innerText();
    return Number(text.split("：")[1]);
  };
  const total = async () => {
    const parts = [];
    for (const label of ["執行中", "緊急", "待機", "不可用"]) parts.push(await statValue(label));
    return parts.reduce((a, b) => a + b, 0);
  };

  await test.step("種子資料：不可用只有排了維護的那一台，加總不超過設備總數", async () => {
    // 設備清單載完以前四個數字都是 0。先等「不可用」對上，代表資料到了才開始數。
    // demo 資料有兩台正在跑排程，以前它們會被算進「不可用」，這裡就會是 3。
    await expect.poll(() => statValue("不可用")).toBe(SEEDED_MAINT_COUNT);
    expect(await total()).toBeLessThanOrEqual(DEVICE_COUNT);
  });

  await test.step("多標一台維護 → 不可用 +1，加總仍不超過設備總數", async () => {
    await page.getByRole("button", { name: /^排程/ }).click();
    await page.getByRole("button", { name: "+ 不可用時段" }).click();
    await addBlockedPeriod(page, { device: EXTRA_MAINT_DEVICE, reason: "E2E 計數用封鎖" });
    await closeModal(page, BLOCKED_PERIODS_MODAL);

    await expect.poll(() => statValue("不可用")).toBe(SEEDED_MAINT_COUNT + 1);
    expect(await total()).toBeLessThanOrEqual(DEVICE_COUNT);
  });
});
