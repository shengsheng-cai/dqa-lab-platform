import { describe, expect, it } from "vitest";

import { isNonnegativeInteger } from "../utils/validation";

describe("isNonnegativeInteger", () => {
  it.each([0, 3, "0", "12"])("accepts %p", (value) => {
    expect(isNonnegativeInteger(value)).toBe(true);
  });

  it.each([-1, "-1", 1.5, "1.5", "abc", undefined])("rejects %p", (value) => {
    expect(isNonnegativeInteger(value)).toBe(false);
  });
});
