import { describe, expect, it } from "vitest";

import {
  fixtureBadgeStatus,
  isStocktakeCountable,
  matchesStatusFilter,
} from "../utils/fixtureStatus";

const fixture = (overrides = {}) => ({
  total_quantity: 3,
  available_quantity: 3,
  loaned_quantity: 0,
  reserved_quantity: 0,
  shortage: 0,
  ...overrides,
});

// 種子資料的 USB-C / Gen2：手動標了缺 1 件，同時有 1 件借出在外
const shortageAndLoaned = fixture({ shortage: 1, loaned_quantity: 1, available_quantity: 2 });

describe("徽章只挑一個字", () => {
  it.each([
    ["缺貨", fixture({ total_quantity: 0, available_quantity: 0 }), "out_of_stock"],
    ["即將不足排在借出中前面", shortageAndLoaned, "shortage"],
    ["借出中", fixture({ loaned_quantity: 1, available_quantity: 2 }), "loaned"],
    ["預約中", fixture({ reserved_quantity: 1, available_quantity: 2 }), "reserved"],
    ["庫存足夠", fixture(), "ok"],
  ])("%s", (_, f, expected) => {
    expect(fixtureBadgeStatus(f)).toBe(expected);
  });
});

describe("月盤點只收現場數得到完整數量的治具", () => {
  it("徽章寫即將不足，但有借出在外，就不能盤", () => {
    expect(isStocktakeCountable(shortageAndLoaned)).toBe(false);
  });

  it("有預約在外也不能盤", () => {
    expect(isStocktakeCountable(fixture({ shortage: 1, reserved_quantity: 1 }))).toBe(false);
  });

  it.each([
    ["庫存足夠", fixture()],
    ["即將不足", fixture({ shortage: 1 })],
    ["缺貨", fixture({ total_quantity: 0, available_quantity: 0 })],
  ])("沒有東西在外的%s可以盤", (_, f) => {
    expect(isStocktakeCountable(f)).toBe(true);
  });
});

describe("狀態篩選", () => {
  it("「借出中」看的是有沒有借出，不是徽章上排第幾", () => {
    expect(matchesStatusFilter(shortageAndLoaned, "loaned")).toBe(true);
    expect(matchesStatusFilter(shortageAndLoaned, "shortage")).toBe(true);
  });

  it("沒有借出就不出現在「借出中」", () => {
    expect(matchesStatusFilter(fixture({ reserved_quantity: 1 }), "loaned")).toBe(false);
  });

  it("其餘選項照徽章那個字", () => {
    expect(matchesStatusFilter(fixture(), "ok")).toBe(true);
    expect(matchesStatusFilter(fixture({ loaned_quantity: 1 }), "ok")).toBe(false);
  });
});
