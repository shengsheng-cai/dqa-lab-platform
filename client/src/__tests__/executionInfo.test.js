import { describe, it, expect } from "vitest";
import { formatFreeTime, formatCycle, formatStep } from "../utils/executionInfo";

describe("formatCycle", () => {
  it("顯示已完成圈數，不是正在跑第幾圈", () => {
    // 後端的 sim_cycle 是「跑完幾圈」，一開始是 0
    expect(formatCycle(0, 3)).toBe("0000/0003");
    expect(formatCycle(1, 3)).toBe("0001/0003");
  });

  it("最後一圈跑完不會顯示不存在的第 4 圈", () => {
    // 這是這支測試的主要目的：以前這裡加一，三循環跑完顯示 0004/0003，
    // 而且會一路掛到降溫與常溫穩定結束
    expect(formatCycle(3, 3)).toBe("0003/0003");
  });

  it("單循環測試跑完顯示 0001/0001", () => {
    expect(formatCycle(1, 1)).toBe("0001/0001");
  });

  it("沒有值時當成還沒開始跑，總數預設 1", () => {
    expect(formatCycle(null, null)).toBe("0000/0001");
    expect(formatCycle(undefined, 3)).toBe("0000/0003");
  });
});

describe("formatFreeTime", () => {
  it("秒數換成 HHHH:MM", () => {
    expect(formatFreeTime(0)).toBe("0000:00");
    expect(formatFreeTime(59)).toBe("0000:00");
    expect(formatFreeTime(60)).toBe("0000:01");
    expect(formatFreeTime(3600)).toBe("0001:00");
    expect(formatFreeTime(3660)).toBe("0001:01");
  });

  it("超過 24 小時的測試不會被截斷", () => {
    expect(formatFreeTime(100 * 3600)).toBe("0100:00");
  });

  it("還沒拿到倒數時顯示歸零，不顯示 NaN", () => {
    expect(formatFreeTime(null)).toBe("0000:00");
    expect(formatFreeTime(undefined)).toBe("0000:00");
  });

  it("已經過期的負秒數壓成 0，不倒著長", () => {
    expect(formatFreeTime(-120)).toBe("0000:00");
  });
});

describe("formatStep", () => {
  it("顯示做完幾步／共幾步", () => {
    expect(formatStep(0, 12)).toBe("000/012");
    expect(formatStep(3, 12)).toBe("003/012");
    expect(formatStep(12, 12)).toBe("012/012");
  });

  it("沒有步驟資料時顯示歸零", () => {
    expect(formatStep(null, null)).toBe("000/000");
  });
});
