import { describe, it, expect } from "vitest";
import {
  translateErrorMessage,
  getRecoveryHint,
  getErrorMessage,
} from "../errorMessages";

describe("translateErrorMessage", () => {
  it("returns fallback for empty input", () => {
    expect(translateErrorMessage("")).toBe("操作失敗，請稍後重試");
    expect(translateErrorMessage(null)).toBe("操作失敗，請稍後重試");
  });

  it("translates fixture-related errors", () => {
    expect(translateErrorMessage("fixture not found")).toBe("治具不存在");
    expect(translateErrorMessage("insufficient quantity available")).toBe("治具庫存不足");
    expect(translateErrorMessage("fixture in use")).toBe("治具正在借出中");
  });

  it("translates schedule-related errors", () => {
    expect(translateErrorMessage("schedule conflict detected")).toBe("時段衝突，無法申請");
    expect(translateErrorMessage("device unavailable")).toBe("設備在該時段無法使用");
    expect(translateErrorMessage("schedule not found")).toBe("排程不存在");
  });

  it("translates auth-related errors", () => {
    expect(translateErrorMessage("admin only")).toBe("需要管理者權限");
    expect(translateErrorMessage("unauthorized")).toBe("請重新登入");
  });

  it("passes through Chinese messages unchanged", () => {
    expect(translateErrorMessage("設備正忙碌中")).toBe("設備正忙碌中");
  });

  it("uses custom fallback when provided", () => {
    expect(translateErrorMessage("", "自訂錯誤")).toBe("自訂錯誤");
  });
});

describe("getRecoveryHint", () => {
  it("returns hint for known translated messages", () => {
    expect(getRecoveryHint("治具庫存不足")).toBe("可至治具管理申請採購");
    expect(getRecoveryHint("時段衝突，無法申請")).toBe("建議改用自動排程功能");
    expect(getRecoveryHint("您沒有權限進行此操作")).toBe("此功能僅限管理者使用");
  });

  it("returns null for unknown message", () => {
    expect(getRecoveryHint("未知錯誤")).toBeNull();
    expect(getRecoveryHint(null)).toBeNull();
  });
});

describe("getErrorMessage", () => {
  it("extracts and translates from axios error shape", () => {
    const err = { response: { data: { detail: "fixture not found" } } };
    expect(getErrorMessage(err)).toBe("治具不存在");
  });

  it("falls back to error.message if no response", () => {
    const err = { message: "schedule not found" };
    expect(getErrorMessage(err)).toBe("排程不存在");
  });

  it("returns fallback for empty error", () => {
    expect(getErrorMessage({})).toBe("操作失敗，請稍後重試");
  });
});
