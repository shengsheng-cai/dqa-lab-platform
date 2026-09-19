import { describe, it, expect } from "vitest";
import { conditionProgress, isWaitingForConfirm } from "../utils/scheduleProgress";

const schedule = (conditions, index, names) => ({
  conditions,
  current_condition_index: index,
  condition_names: names,
});

describe("isWaitingForConfirm", () => {
  const pending = schedule(["a"], 0);

  it("設備回到待機、排程還沒結案 → 在等人確認", () => {
    expect(isWaitingForConfirm({ status: "IDLE" }, pending)).toBe(true);
  });

  it("測試還在跑或正在降溫 → 不是在等人確認", () => {
    expect(isWaitingForConfirm({ status: "RUNNING" }, pending)).toBe(false);
    expect(isWaitingForConfirm({ status: "PAUSED" }, pending)).toBe(false);
    expect(isWaitingForConfirm({ status: "FINISHING" }, pending)).toBe(false);
  });

  it("緊急停止中絕不算在等人確認", () => {
    // 那個畫面要講的是現場安全與怎麼降溫，不該出現「開始第 N 條件」這種入口
    expect(isWaitingForConfirm({ status: "EMERGENCY" }, pending)).toBe(false);
  });

  it("沒有排程掛著，或設備資料還沒到 → false", () => {
    expect(isWaitingForConfirm({ status: "IDLE" }, null)).toBe(false);
    expect(isWaitingForConfirm(undefined, pending)).toBe(false);
  });
});

describe("conditionProgress", () => {
  it("測試跑的時候，索引指的是正在跑的那一條", () => {
    const p = conditionProgress(schedule(["a", "b", "c"], 0));
    expect(p.isLast).toBe(false);
    expect(p.progressLabel).toBe("1/3");
    expect(p.actionLabel).toBe("▶ 開始第 1 條件（共 3）");
  });

  it("條件之間等人確認時，講的是下一條要跑什麼", () => {
    const p = conditionProgress(schedule(["a", "b", "c"], 1, ["甲", "乙", "丙"]));
    expect(p.isLast).toBe(false);
    expect(p.nextConditionName).toBe("乙");
    expect(p.actionLabel).toBe("▶ 開始第 2 條件（共 3）");
    expect(p.shortActionLabel).toBe("▶ 第 2/3 條件");
  });

  it("最後一條跑完，索引超出條件數，這時只能確認結案", () => {
    // 以前各畫面直接把索引加 1 拿去顯示，單條件會寫成「第 2/1 條件」、三條件寫成「(4/3)」
    const single = conditionProgress(schedule(["a"], 1));
    expect(single.isLast).toBe(true);
    expect(single.actionLabel).toBe("✅ 確認完成");
    expect(single.progressLabel).toBe("等待確認");
    expect(single.nextConditionName).toBe(null);

    const triple = conditionProgress(schedule(["a", "b", "c"], 3));
    expect(triple.isLast).toBe(true);
    expect(triple.progressLabel).toBe("等待確認");
  });

  it("被人按停時索引不動，仍然指得出接下來要重跑哪一條", () => {
    // 這條和「第一條剛開始跑」的資料長得一模一樣——排程資料分不出來，
    // 所以說法只能講下一步，不能宣稱誰完成了
    const p = conditionProgress(schedule(["a"], 0, ["甲"]));
    expect(p.isLast).toBe(false);
    expect(p.nextConditionName).toBe("甲");
    expect(p.actionLabel).toBe("▶ 開始第 1 條件（共 1）");
  });

  it("沒有名稱對照就退回 sop_id，不留空白", () => {
    const p = conditionProgress(schedule(["iec60068_ab_-25_16h"], 0));
    expect(p.nextConditionName).toBe("iec60068_ab_-25_16h");
  });

  it("條件資料缺漏時當成沒有下一條，不算出「第 1/0 條件」", () => {
    expect(conditionProgress({}).isLast).toBe(true);
    expect(conditionProgress(null).actionLabel).toBe("✅ 確認完成");
    expect(conditionProgress(schedule([], 0)).progressLabel).toBe("等待確認");
  });
});
