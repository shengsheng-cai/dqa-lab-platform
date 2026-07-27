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

  it("【已知不對，暫時釘住現況】清晨下載時檔名日期會是前一天", () => {
    // 這條測的是時區敏感行為，所以先確認時區釘子還在（vite.config.js 的 test.env.TZ）；
    // 少了這行，在 UTC 機器上就算實作改成本地日期，這個測試照樣會綠。
    expect(new Date().getTimezoneOffset()).toBe(-480);

    // 台北 7/28 00:30 = UTC 7/27 16:30。實作用 toISOString() 取 UTC 日期，
    // 所以檔名寫 20260727。修成本地日期時這條會紅，那時把它改成 20260728。
    vi.setSystemTime(new Date("2026-07-27T16:30:00Z"));
    expect(buildReportFilename("CH-01", 5, "pdf")).toBe("CH-01_20260727_5.pdf");
  });
});
