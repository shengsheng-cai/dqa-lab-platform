import { describe, it, expect } from "vitest";
import { calibrationStatusLabel, calibrationBadgeLabel } from "../utils/calibration";

describe("calibrationStatusLabel", () => {
  it("後端的四個狀態都翻得出中文", () => {
    expect(calibrationStatusLabel("ok")).toBe("正常");
    expect(calibrationStatusLabel("due_soon")).toBe("即將到期");
    expect(calibrationStatusLabel("overdue")).toBe("逾期");
    expect(calibrationStatusLabel("unknown")).toBe("未校驗");
  });

  it("沒收錄的值寫出原碼，不變空白也不裸露代碼", () => {
    expect(calibrationStatusLabel("retired")).toBe("其他狀態（retired）");
  });

  it("只認自己的鍵，繼承屬性不算合法狀態", () => {
    expect(calibrationStatusLabel("constructor")).toBe("其他狀態（constructor）");
    expect(calibrationStatusLabel("__proto__")).toBe("其他狀態（__proto__）");
  });
});

describe("calibrationBadgeLabel", () => {
  it("徽章要帶「校驗」兩個字，單獨掛在卡片上才看得懂", () => {
    expect(calibrationBadgeLabel("due_soon")).toBe("校驗即將到期");
    expect(calibrationBadgeLabel("overdue")).toBe("校驗逾期");
  });

  it("沒有校驗紀錄時，卡片與左欄摘要用同一個說法", () => {
    // 以前卡片寫「未校驗」、左欄寫「未知」，同一台設備兩種說法
    expect(calibrationBadgeLabel("unknown")).toBe("未校驗");
    expect(calibrationStatusLabel("unknown")).toBe("未校驗");
  });
});
