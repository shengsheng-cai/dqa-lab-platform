/**
 * 時區處理 Utility
 *
 * 規範：
 * - DB 儲存：naive UTC（無 Z 或 ±HH:MM）
 * - 應用層：aware UTC（補 Z 後轉為 aware）
 * - 顯示層：轉換為本地時間
 */

/**
 * 安全地將 naive UTC 字串轉換為 Date 物件
 * 如果字串已包含時區資訊（Z 或 +/-HH:MM），直接使用
 * 否則補 Z 告訴瀏覽器這是 UTC
 *
 * @param {string} dateStr - ISO format 日期字串（naive UTC）
 * @returns {Date} 正確解析為 UTC 的 Date 物件
 */
export function parseUTC(dateStr) {
  if (!dateStr) return null;
  try {
    // 檢查是否已有時區資訊
    const hasTimezone = /[Z+\-]\d{2}:?\d{2}$/.test(dateStr);
    const safeStr = hasTimezone ? dateStr : dateStr + "Z";
    return new Date(safeStr);
  } catch {
    return null;
  }
}

/**
 * 將 Date 物件或日期字串轉換為本地時間字串
 *
 * @param {Date|string} date - Date 物件或日期字串
 * @param {string} format - 格式選項：'date' | 'time' | 'datetime'（預設：'datetime'）
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

/**
 * 計算兩個日期之間相差的分鐘數
 *
 * @param {Date|string} startDate - 開始時間
 * @param {Date|string} endDate - 結束時間
 * @returns {number} 相差分鐘數（若解析失敗返回 null）
 */
export function diffMinutes(startDate, endDate) {
  const start = typeof startDate === "string" ? parseUTC(startDate) : startDate;
  const end = typeof endDate === "string" ? parseUTC(endDate) : endDate;

  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }

  return Math.round((end - start) / 60000);
}

/**
 * 判斷日期是否在範圍內
 *
 * @param {Date|string} date - 要檢查的日期
 * @param {Date|string} rangeStart - 範圍開始
 * @param {Date|string} rangeEnd - 範圍結束
 * @returns {boolean}
 */
export function isInRange(date, rangeStart, rangeEnd) {
  const d = typeof date === "string" ? parseUTC(date) : date;
  const start = typeof rangeStart === "string" ? parseUTC(rangeStart) : rangeStart;
  const end = typeof rangeEnd === "string" ? parseUTC(rangeEnd) : rangeEnd;

  return d >= start && d <= end;
}

/**
 * 檢查日期是否已過期
 *
 * @param {Date|string} date - 要檢查的日期
 * @returns {boolean}
 */
export function isExpired(date) {
  const d = typeof date === "string" ? parseUTC(date) : date;
  return d ? d < new Date() : true;
}
