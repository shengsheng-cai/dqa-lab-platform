import { describe, expect, it } from "vitest";

import {
  dateOnlyToApi,
  formatDateOnly,
  formatLocalDateTime,
  isKnownMaintenanceType,
  localDateTimeToApi,
  maintenanceTypeLabel,
  toDateOnlyInput,
  toLocalDateTimeInput,
} from "../utils/maintenance";

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

describe("maintenance date fields", () => {
  it("keeps calibration fields as dates without inventing a visible midnight", () => {
    expect(toDateOnlyInput("2026-08-24T00:00:00")).toBe("2026-08-24");
    expect(formatDateOnly("2026-08-24T00:00:00")).toBe("2026-08-24");
    expect(dateOnlyToApi("2026-08-24")).toBe("2026-08-24T00:00:00Z");
  });

  it("converts a maintenance event between naive UTC and local picker time", () => {
    expect(toLocalDateTimeInput("2026-08-24T02:35:00")).toBe("2026-08-24T10:35");
    expect(formatLocalDateTime("2026-08-24T02:35:00")).toBe("2026-08-24 10:35");
    expect(localDateTimeToApi("2026-08-24T10:35")).toBe("2026-08-24T02:35:00.000Z");
  });

  it("returns empty values for absent or invalid dates", () => {
    expect(toDateOnlyInput("not-a-date")).toBe("");
    expect(toLocalDateTimeInput("not-a-date")).toBe("");
    expect(dateOnlyToApi("")).toBeNull();
    expect(localDateTimeToApi("")).toBeNull();
    expect(formatDateOnly(null)).toBe("—");
    expect(formatLocalDateTime(null)).toBe("—");
  });
});
