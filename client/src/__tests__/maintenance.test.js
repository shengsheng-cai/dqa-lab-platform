import { describe, expect, it } from "vitest";

import { isKnownMaintenanceType, maintenanceTypeLabel } from "../utils/maintenance";

describe("maintenance type labels", () => {
  it.each([
    ["preventive", "預防性"],
    ["corrective", "矯正性"],
    ["inspection", "例行點檢"],
  ])("maps %s", (type, label) => {
    expect(isKnownMaintenanceType(type)).toBe(true);
    expect(maintenanceTypeLabel(type)).toBe(label);
  });

  it.each(["routine", "constructor", "toString", "__proto__"])(
    "treats %s as an unknown legacy value",
    (type) => {
      expect(isKnownMaintenanceType(type)).toBe(false);
      expect(maintenanceTypeLabel(type)).toBe(`未知類型（${type}）`);
    },
  );
});
