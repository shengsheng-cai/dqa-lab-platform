import { describe, expect, it } from "vitest";

import { deviceStatusBadge } from "../constants";

describe("device status badge", () => {
  it.each([
    ["OFFLINE", "離線"],
    ["IDLE", "待機"],
    ["RUNNING", "執行中"],
    ["PAUSED", "已暫停"],
    ["FINISHING", "收尾降溫中"],
    ["EMERGENCY", "緊急停止中"],
  ])("shows %s as %s and keeps the code for debugging", (status, zh) => {
    const badge = deviceStatusBadge(status);
    expect(badge.zh).toBe(zh);
    expect(badge.code).toBe(status);
  });

  // 「不可用」是 is_blocked 疊在待機上面的顯示，底下的狀態碼不能跟著消失。
  it("shows a blocked device as 不可用 but keeps the underlying status", () => {
    const badge = deviceStatusBadge("IDLE", true);
    expect(badge.zh).toBe("不可用");
    expect(badge.code).toBe("BLOCKED / IDLE");
  });

  // 設備清單還沒載進來時狀態是空的，這時當離線處理，不要讓徽章變空白。
  it("falls back to 離線 when the status is missing", () => {
    const badge = deviceStatusBadge(undefined);
    expect(badge.zh).toBe("離線");
    expect(badge.code).toBe("OFFLINE");
  });
});
