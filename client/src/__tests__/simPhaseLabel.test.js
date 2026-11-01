import { describe, expect, it } from "vitest";

import { AMBIENT_TEMP, SIM_PHASE_LABEL, simPhaseLabel } from "../constants";

describe("simPhaseLabel", () => {
  // 這支測試的主要目的：只有低溫的測試，模擬器把保持階段也記成 dwell_high，
  // 以前設備卡在 -25°C 時寫「高溫保持」
  it("低溫單溫測試的保持階段顯示低溫保持", () => {
    expect(simPhaseLabel("dwell_high", -25)).toBe("低溫保持");
    expect(simPhaseLabel("dwell_high", -10)).toBe("低溫保持");
  });

  it("高溫保持照常顯示", () => {
    expect(simPhaseLabel("dwell_high", 85)).toBe("高溫保持");
    expect(simPhaseLabel("dwell_high", 40)).toBe("高溫保持");
  });

  it("雙溫測試的低溫段本來就是 dwell_low，不受影響", () => {
    expect(simPhaseLabel("dwell_low", -40)).toBe("低溫保持");
  });

  it("溫度還沒讀到時照相位名稱顯示，不要猜", () => {
    expect(simPhaseLabel("dwell_high", null)).toBe("高溫保持");
    expect(simPhaseLabel("dwell_high", undefined)).toBe("高溫保持");
  });

  it("其他相位不看溫度", () => {
    expect(simPhaseLabel("ramp_to_low", -25)).toBe(SIM_PHASE_LABEL.ramp_to_low);
    expect(simPhaseLabel("stabilize", AMBIENT_TEMP)).toBe(SIM_PHASE_LABEL.stabilize);
  });
});
