import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildReportFilename } from "../utils/download";

// 檔名含「今天」，用假時鐘釘住，否則斷言只能重抄一次實作、等於沒測。
// 只假造 Date：全套假造的話，之後有人在這個檔加 async 測試，await setTimeout 會永遠不觸發。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-27T02:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildReportFilename", () => {
  it("組成 {prefix}_{YYYYMMDD}_{execId}.{ext}", () => {
    expect(buildReportFilename("CH-01", 42, "pdf")).toBe("CH-01_20260727_42.pdf");
  });

  it("prefix 裡不能當檔名的字元換成底線", () => {
    expect(buildReportFilename("IEC 60068-2", 7, "pdf")).toBe("IEC_60068-2_20260727_7.pdf");
    expect(buildReportFilename("溫濕度", 7, "pdf")).toBe("____20260727_7.pdf");
  });

  it("prefix 缺漏時用 unknown 補", () => {
    expect(buildReportFilename(null, 9, "csv")).toBe("unknown_20260727_9.csv");
    expect(buildReportFilename("", 9, "csv")).toBe("unknown_20260727_9.csv");
  });

  it("清晨下載時檔名日期取本地當天，不是 UTC 當天", () => {
    // 這條測的是時區敏感行為，所以先確認時區釘子還在（見 package.json 的 test script）；
    // 少了這行，在 UTC 機器上兩種寫法都會過，等於沒測。
    expect(new Date().getTimezoneOffset()).toBe(-480);

    // 台北 7/28 00:30 = UTC 7/27 16:30。取 UTC 會標成 20260727（前一天），
    // 使用者照日期找檔案會對不上。
    vi.setSystemTime(new Date("2026-07-27T16:30:00Z"));
    expect(buildReportFilename("CH-01", 5, "pdf")).toBe("CH-01_20260728_5.pdf");
  });

  it("選填的設備編號黏在最前面", () => {
    expect(buildReportFilename("IEC 60068-2", 7, "csv", { device: "CH-03" }))
      .toBe("CH-03_IEC_60068-2_20260727_7.csv");
  });

  it("設備編號也會做字元消毒", () => {
    // 現行設備編號都是 CH-0x，消毒對它們是空操作，所以要用會被換掉的字元才測得到。
    expect(buildReportFilename("sop", 1, "pdf", { device: "溫控箱 #2" }))
      .toBe("_____2_sop_20260727_1.pdf");
  });

  it("設備編號給空值時不會多出開頭的底線", () => {
    // 只傳 {} 跟完全不傳第四個參數走的是同一條路，測不到東西；
    // 真正沒被蓋到的是「有給但值是空的」。
    expect(buildReportFilename("CH-01", 42, "pdf", { device: "" })).toBe("CH-01_20260727_42.pdf");
    expect(buildReportFilename("CH-01", 42, "pdf", { device: null })).toBe("CH-01_20260727_42.pdf");
  });
});
