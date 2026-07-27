/**
 * 時區處理 Utility
 *
 * 規範：
 * - DB 儲存：naive UTC（無 Z 或 ±HH:MM）
 * - 應用層：aware UTC（補 Z 後轉為 aware）
 * - 顯示層：轉換為本地時間
 */

/**
 * 將 naive UTC 字串轉換為 Date 物件。
 * 字串已含時區資訊（Z 或 ±HH:MM）就直接用，否則補 Z 告訴瀏覽器這是 UTC。
 *
 * @param {string|Date} dateStr - ISO format 日期字串（naive UTC），或已是 Date
 * @returns {Date|null} 空值回傳 null；字串無法解析時回傳 Invalid Date
 *   （`new Date()` 不會丟例外，只會給 Invalid Date）。呼叫端要自己檢查，
 *   例如用 `isNaN(d?.getTime())`，或改用會擋掉的 formatLocal。
 */
export function parseUTC(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr);
  return new Date(hasTimezone ? dateStr : dateStr + "Z");
}

/**
 * 今天的日期（本地時區），給檔名或日期輸入框用。
 *
 * 不要用 `new Date().toISOString().slice(0, 10)` ——那是 UTC 日期，
 * 台北凌晨 8 點前會標成前一天。
 *
 * @param {string} sep - 年月日之間的分隔符，預設不加
 * @returns {string} 例如 "20260727"；sep 給 "-" 時是 "2026-07-27"
 */
export function localDateStamp(sep = "") {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join(sep);
}

/**
 * 將 YYYY-MM-DD 日期字串解析為「本地時區 00:00」Date。
 * 其他格式回退到 parseUTC。
 *
 * @param {string|Date} dateStr
 * @returns {Date|null}
 */
export function parseDateOnlyLocal(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return parseUTC(dateStr);
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  return new Date(y, mon - 1, d, 0, 0, 0, 0);
}

/**
 * 將 Date 物件或日期字串轉換為本地時間字串
 *
 * @param {Date|string} date - Date 物件或日期字串
 * @param {string} format - 'date' | 'time' | 'datetime' | 'datetimeSec'（預設：'datetime'，認不得的值也退回 datetime）
 * @param {string} locale - 地區碼（預設：'zh-TW'）
 * @returns {string} 格式化的本地時間字串
 */
export function formatLocal(date, format = "datetime", locale = "zh-TW") {
  const d = typeof date === "string" ? parseUTC(date) : date;
  if (!d || isNaN(d.getTime())) return "-";

  const options = {
    date: { year: "numeric", month: "2-digit", day: "2-digit" },
    time: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
    datetime: {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    },
    datetimeSec: {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    },
  };

  return new Intl.DateTimeFormat(locale, options[format] || options.datetime).format(d);
}
