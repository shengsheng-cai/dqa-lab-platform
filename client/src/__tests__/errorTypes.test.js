import { describe, expect, it } from "vitest";

import { errorTypeLabel, EMERGENCY_ERROR_TYPE } from "../utils/errorTypes";

describe("error type labels", () => {
  it.each([
    [EMERGENCY_ERROR_TYPE, "緊急停止"],
    ["sensor_fault", "感測器故障"],
    ["humidity_out_of_range", "濕度超出範圍"],
  ])("maps %s", (type, label) => {
    expect(errorTypeLabel(type)).toBe(label);
  });

  // 沒收錄的類型不能變空白，也不能只丟原碼；原碼要留在括號裡才查得回後端寫了什麼。
  it.each(["kson_error_12", "constructor", "__proto__"])(
    "keeps the raw code for %s",
    (type) => {
      expect(errorTypeLabel(type)).toBe(`其他異常（${type}）`);
    },
  );
});
