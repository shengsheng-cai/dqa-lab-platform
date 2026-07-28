import { describe, it, expect, afterEach, vi } from "vitest";
import { parseUTC, parseDateOnlyLocal, formatLocal, localDateStamp } from "../utils/timezone";

// 這整組測試建立在「執行時時區是 Asia/Taipei」上（vite.config.js 的 test.env.TZ）。
// 先確認這件事，否則下面的期望值會以看不懂的字串差異形式失敗。
describe("測試環境時區", () => {
  it("固定在 UTC+8", () => {
    expect(new Date().getTimezoneOffset()).toBe(-480);
  });
});

describe("parseUTC", () => {
  it("空值回傳 null", () => {
    expect(parseUTC(null)).toBeNull();
    expect(parseUTC(undefined)).toBeNull();
    expect(parseUTC("")).toBeNull();
  });

  it("已經是 Date 就原樣回傳", () => {
    const d = new Date("2026-07-27T10:30:00Z");
    expect(parseUTC(d)).toBe(d);
  });

  it("沒帶時區的字串一律當 UTC（後端存的就是 naive UTC）", () => {
    expect(parseUTC("2026-07-27T10:30:00").toISOString()).toBe("2026-07-27T10:30:00.000Z");
  });

  it("已帶 Z 的字串不會被重複補 Z", () => {
    expect(parseUTC("2026-07-27T10:30:00Z").toISOString()).toBe("2026-07-27T10:30:00.000Z");
  });

  it("已帶 ±HH:MM 位移的字串維持原本的位移", () => {
    expect(parseUTC("2026-07-27T10:30:00+08:00").toISOString()).toBe("2026-07-27T02:30:00.000Z");
  });

  it("位移不帶冒號（+0800）也算有時區", () => {
    expect(parseUTC("2026-07-27T10:30:00+0800").toISOString()).toBe("2026-07-27T02:30:00.000Z");
  });

  it("無法解析的字串回傳 Invalid Date，不是 null", () => {
    // new Date() 不會 throw，所以函式裡的 try/catch 實際上接不到東西；
    // 呼叫端拿到的是 Invalid Date，要靠 formatLocal 這類的 isNaN 檢查擋。
    expect(Number.isNaN(parseUTC("不是日期").getTime())).toBe(true);
  });
});

describe("parseDateOnlyLocal", () => {
  it("YYYY-MM-DD 解析成「本地」午夜，不是 UTC 午夜", () => {
    // 這是差一天 bug 的來源：當成 UTC 午夜的話，+08 顯示會變成當天早上 8 點，
    // 而在負時區則會退回前一天。
    const d = parseDateOnlyLocal("2026-07-27");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // 0-based：7 月
    expect(d.getDate()).toBe(27);
    expect(d.getHours()).toBe(0);
    expect(d.toISOString()).toBe("2026-07-26T16:00:00.000Z");
  });

  it("帶時間的字串退回 parseUTC 的行為", () => {
    expect(parseDateOnlyLocal("2026-07-27T10:30:00").toISOString())
      .toBe("2026-07-27T10:30:00.000Z");
  });

  it("空值回傳 null、Date 原樣回傳", () => {
    expect(parseDateOnlyLocal(null)).toBeNull();
    const d = new Date("2026-07-27T00:00:00Z");
    expect(parseDateOnlyLocal(d)).toBe(d);
  });
});

// Intl 在日期與時間之間插的不是一般空格（目前這版 ICU 是 U+2009 thin space），
// 而且這個字元會隨 Node/ICU 版本改。把所有空白正規化成一般空格再比對，
// 這樣測的是「內容對不對」，不會因為升 Node 就冒出看不出差別的紅字。
const norm = (s) => s.replace(/\s/g, " ");

describe("formatLocal", () => {
  it("naive UTC 字串顯示成本地時間（02:30Z → 台北 10:30）", () => {
    expect(norm(formatLocal("2026-07-27T02:30:45", "time"))).toBe("上午10:30:45");
  });

  it("date 格式只有年月日", () => {
    expect(norm(formatLocal("2026-07-27T02:30:45", "date"))).toBe("2026/07/27");
  });

  it("datetime 有到分、沒有秒", () => {
    expect(norm(formatLocal("2026-07-27T02:30:45", "datetime"))).toBe("2026/07/27 上午10:30");
  });

  it("datetimeSec 有到秒", () => {
    expect(norm(formatLocal("2026-07-27T02:30:45", "datetimeSec"))).toBe("2026/07/27 上午10:30:45");
  });

  it("認不得的格式退回 datetime", () => {
    // 不用 formatLocal(..., "datetime") 當期望值：兩邊會一起變，等於沒測。
    expect(norm(formatLocal("2026-07-27T02:30:45", "亂寫的格式"))).toBe("2026/07/27 上午10:30");
  });

  it("不給格式時預設 datetime", () => {
    expect(norm(formatLocal("2026-07-27T02:30:45"))).toBe("2026/07/27 上午10:30");
  });

  it("空值與無效日期顯示 -，不會噴 Invalid Date 給使用者", () => {
    expect(formatLocal(null)).toBe("-");
    expect(formatLocal("")).toBe("-");
    expect(formatLocal("不是日期")).toBe("-");
    expect(formatLocal(new Date("不是日期"))).toBe("-");
  });

  it("直接吃 Date 物件", () => {
    expect(formatLocal(new Date("2026-07-27T02:30:45Z"), "date")).toBe("2026/07/27");
  });
});

describe("localDateStamp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeAt(iso) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }

  it("取本地當天，不是 UTC 當天", () => {
    // 台北 7/28 00:30 = UTC 7/27 16:30。用 toISOString() 會得到 20260727。
    freezeAt("2026-07-27T16:30:00Z");
    expect(localDateStamp()).toBe("20260728");
  });

  it("月與日補足兩位數", () => {
    freezeAt("2026-01-05T03:00:00Z"); // getMonth() 是 0 起算，這裡要的是 01
    expect(localDateStamp()).toBe("20260105");
  });

  it("跨年邊界", () => {
    freezeAt("2026-12-31T16:30:00Z"); // 台北已是 2027-01-01
    expect(localDateStamp()).toBe("20270101");
  });

  it("可指定分隔符", () => {
    freezeAt("2026-07-27T02:30:00Z");
    expect(localDateStamp("-")).toBe("2026-07-27");
    expect(localDateStamp("/")).toBe("2026/07/27");
  });

  it("可指定日期，一樣以本地時區為準", () => {
    // 台北 7/28 00:30。借出登記的預設到期日是本地 7 天後 = 8/4，不是 8/3。
    freezeAt("2026-07-27T16:30:00Z");
    const d = new Date();
    d.setDate(d.getDate() + 7);
    expect(localDateStamp("-", d)).toBe("2026-08-04");
  });
});
