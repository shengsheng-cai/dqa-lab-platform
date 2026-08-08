import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildExecutionPayload } from "../utils/executionPayload";

// 結束時間取的是「現在」，用假時鐘釘住，否則斷言只能重抄一次實作、等於沒測。
// 只假造 Date：全套假造的話，之後有人在這個檔加 async 測試，await setTimeout 會永遠不觸發。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-08T03:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const base = {
  sop: { sop_id: "IEC-60068-2-1", steps: [{ step_id: 1 }, { step_id: 2 }, { step_id: 3 }] },
  deviceId: "CH-01",
  operator: "王小明",
  startedAt: "2026-08-08T01:00:00Z",
  manualMode: false,
  completedSteps: { 1: true, 2: true, 3: true },
};

describe("buildExecutionPayload", () => {
  it("組出後端要的每一個欄位", () => {
    // 這條把整份資料釘住，少一個欄位就會紅。BUG-007 正是漏送 manual_mode 造成的：
    // 除錯用的手動測試被當成正式測試，發了 LINE 推播。
    expect(buildExecutionPayload(base)).toEqual({
      sop_id: "IEC-60068-2-1",
      device_id: "CH-01",
      operator: "王小明",
      test_started_at: "2026-08-08T01:00:00Z",
      test_ended_at: "2026-08-08T03:00:00.000Z",
      manual_mode: false,
      steps: [
        { step_id: 1, completed: true, parameters: null },
        { step_id: 2, completed: true, parameters: null },
        { step_id: 3, completed: true, parameters: null },
      ],
    });
  });

  it("手動除錯模式照實送出，後端據此不發推播", () => {
    expect(buildExecutionPayload({ ...base, manualMode: true }).manual_mode).toBe(true);
  });

  it("沒指定手動模式時當成一般測試", () => {
    const withoutFlag = { ...base };
    delete withoutFlag.manualMode;
    expect(buildExecutionPayload(withoutFlag).manual_mode).toBe(false);
  });

  it("步驟完成與否照 completedSteps，沒勾到的是未完成", () => {
    const payload = buildExecutionPayload({ ...base, completedSteps: { 1: true, 3: true } });
    expect(payload.steps).toEqual([
      { step_id: 1, completed: true, parameters: null },
      { step_id: 2, completed: false, parameters: null },
      { step_id: 3, completed: true, parameters: null },
    ]);
  });

  it("操作者去掉前後空白，只打空白等於沒填", () => {
    expect(buildExecutionPayload({ ...base, operator: "  王小明  " }).operator).toBe("王小明");
    expect(buildExecutionPayload({ ...base, operator: "   " }).operator).toBeNull();
    expect(buildExecutionPayload({ ...base, operator: undefined }).operator).toBeNull();
  });

  it("開始時間拿不到時送 null，不送空字串", () => {
    // 後端那個欄位收的是時間，空字串會被當成格式錯誤擋掉，整筆紀錄存不進去。
    expect(buildExecutionPayload({ ...base, startedAt: "" }).test_started_at).toBeNull();
    expect(buildExecutionPayload({ ...base, startedAt: undefined }).test_started_at).toBeNull();
  });

  it("SOP 沒有步驟時送空陣列", () => {
    expect(buildExecutionPayload({ ...base, sop: { sop_id: "X" } }).steps).toEqual([]);
  });
});
