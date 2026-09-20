import { describe, it, expect } from "vitest";
import { conditionDisplayName, conditionNameFromSchedule } from "../utils/conditionName";

describe("conditionDisplayName", () => {
  it("查得到名稱就顯示名稱", () => {
    expect(conditionDisplayName("高溫作動 +85°C", "iec60068_b_85_16h")).toBe("高溫作動 +85°C");
  });

  it("查不到名稱時寫出原碼，不裸露代碼也不留空白", () => {
    expect(conditionDisplayName(null, "iec60068_ab_-25_16h")).toBe(
      "未知條件（iec60068_ab_-25_16h）",
    );
    expect(conditionDisplayName(undefined, "iec60068_ab_-25_16h")).toBe(
      "未知條件（iec60068_ab_-25_16h）",
    );
    expect(conditionDisplayName("", "iec60068_ab_-25_16h")).toBe(
      "未知條件（iec60068_ab_-25_16h）",
    );
  });

  it("後端查不到時也是回 sop_id，名稱跟代碼一樣就當成沒查到", () => {
    // _get_condition_names 查不到法規時回 sop_id，前端不能把它當成真名稱顯示
    expect(conditionDisplayName("iec60068_ab_-25_16h", "iec60068_ab_-25_16h")).toBe(
      "未知條件（iec60068_ab_-25_16h）",
    );
  });

  it("連代碼都沒有時仍要說得出這是未知條件", () => {
    expect(conditionDisplayName(null, null)).toBe("未知條件");
    expect(conditionDisplayName(null, undefined)).toBe("未知條件");
  });
});

describe("conditionNameFromSchedule", () => {
  const schedule = {
    conditions: ["iec60068_b_85_16h", "iec60068_ab_-25_16h"],
    condition_names: ["高溫作動 +85°C", "低溫作動 -25°C"],
  };

  it("照 sop_id 在排程裡的位置對出名稱", () => {
    expect(conditionNameFromSchedule(schedule, "iec60068_ab_-25_16h")).toBe("低溫作動 -25°C");
  });

  it("排程裡沒有那個條件時退回原碼", () => {
    expect(conditionNameFromSchedule(schedule, "unknown_sop")).toBe("未知條件（unknown_sop）");
  });

  it("沒有排程資料時也不裸露代碼", () => {
    // 條件銜接的 API 只回 sop_id，手上剛好沒有那筆排程時仍要說得出這是什麼
    expect(conditionNameFromSchedule(null, "iec60068_b_85_16h")).toBe(
      "未知條件（iec60068_b_85_16h）",
    );
    expect(conditionNameFromSchedule({}, "iec60068_b_85_16h")).toBe(
      "未知條件（iec60068_b_85_16h）",
    );
  });

  it("排程只有代碼、沒有名稱陣列時退回原碼", () => {
    expect(conditionNameFromSchedule({ conditions: ["a_sop"] }, "a_sop")).toBe("未知條件（a_sop）");
  });
});
