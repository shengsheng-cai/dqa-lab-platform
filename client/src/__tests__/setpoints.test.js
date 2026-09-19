import { describe, it, expect } from "vitest";
import { setpointsOf, setpointSummary } from "../utils/setpoints";

// 標準資料用三個欄位表達三種形狀，固定印高低溫兩列的話，冷測會多一列空的高溫、
// 熱測會多一列空的低溫，看起來像資料沒串進來。

describe("setpointsOf", () => {
  it("冷測只給低溫，不留一列空的高溫", () => {
    // Test Ab -40°C：只填 low_temperature，外加一個等值的 target_temperature
    const cold = { low_temperature: -40.0, target_temperature: -40.0 };

    expect(setpointsOf(cold)).toEqual([{ label: "低溫下限", short: "低溫", value: -40.0 }]);
  });

  it("熱測只給高溫，不留一列空的低溫", () => {
    const hot = { high_temperature: 85.0, target_temperature: 85.0 };

    expect(setpointsOf(hot)).toEqual([{ label: "高溫上限", short: "高溫", value: 85.0 }]);
  });

  it("雙溫循環兩端都給", () => {
    const dual = { high_temperature: 70.0, low_temperature: -25.0 };

    expect(setpointsOf(dual)).toEqual([
      { label: "高溫上限", short: "高溫", value: 70.0 },
      { label: "低溫下限", short: "低溫", value: -25.0 },
    ]);
  });

  it("兩端幾乎相同時算單溫，跟後端模擬器同一條判準", () => {
    // 差距不到 0.1 時模擬器只跑一段，畫面不該寫成兩個設定點
    const almostSame = { high_temperature: 70.0, low_temperature: 69.95 };

    expect(setpointsOf(almostSame)).toEqual([{ label: "高溫上限", short: "高溫", value: 70.0 }]);
  });

  it("冷熱看有沒有填高溫，不看溫度正負", () => {
    // 熱測也有正值不高的，拿正負去猜會把它判成冷測
    const mildHot = { high_temperature: 5.0, target_temperature: 5.0 };

    expect(setpointsOf(mildHot)).toEqual([{ label: "高溫上限", short: "高溫", value: 5.0 }]);
  });

  it("兩個溫度都沒有時回空陣列，呼叫端自己決定怎麼說", () => {
    expect(setpointsOf({})).toEqual([]);
    expect(setpointsOf(null)).toEqual([]);
  });
});

describe("setpointSummary", () => {
  it("冷測不留開頭那個多餘的斜線", () => {
    const cold = { low_temperature: -40.0 };

    expect(setpointSummary(cold)).toBe("低溫 -40°C");
  });

  it("雙溫用斜線隔開兩端", () => {
    const dual = { high_temperature: 70.0, low_temperature: -25.0 };

    expect(setpointSummary(dual)).toBe("高溫 70°C / 低溫 -25°C");
  });
});
