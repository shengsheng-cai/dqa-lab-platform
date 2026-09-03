import { describe, it, expect } from "vitest";
import { deviceScheduleNote } from "../constants";

// 「這台身上有排程」是說明，不是封鎖。這支釘住它只在待機時說話——正在跑的時候卡片本來
// 就寫著執行中，再講一次是多的；而且沒有排程時一定要是 null，空字串會讓呼叫點多渲染一個空行。
describe("deviceScheduleNote", () => {
  it("待機且有排程掛著 → 回傳那句說明", () => {
    expect(deviceScheduleNote({ status: "IDLE", running_schedule_note: "排程進行中（第 1/2 條件）" }))
      .toBe("排程進行中（第 1/2 條件）");
  });

  it("正在執行時不重複講一次", () => {
    expect(deviceScheduleNote({ status: "RUNNING", running_schedule_note: "排程進行中（第 1/2 條件）" }))
      .toBeNull();
  });

  it("沒有排程掛著就回 null，不回空字串", () => {
    expect(deviceScheduleNote({ status: "IDLE", running_schedule_note: null })).toBeNull();
    expect(deviceScheduleNote({ status: "IDLE", running_schedule_note: "" })).toBeNull();
  });

  it("設備資料還沒到也不炸", () => {
    expect(deviceScheduleNote(undefined)).toBeNull();
    expect(deviceScheduleNote({})).toBeNull();
  });
});
