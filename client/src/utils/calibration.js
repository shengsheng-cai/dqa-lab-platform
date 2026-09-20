/**
 * 設備校驗狀態的對照表。後端回 ok / due_soon / overdue / unknown
 * （`devices_maintenance.py`，沒有任何校驗紀錄時是 unknown）。
 *
 * 同一份代碼不要在兩個地方各翻一次：設備卡以前寫「未校驗」、左欄摘要寫「未知」，
 * 同一台設備在兩個畫面得到兩種說法。
 */

const CALIBRATION_STATUS_LABEL = Object.freeze({
  ok: "正常",
  due_soon: "即將到期",
  overdue: "逾期",
  unknown: "未校驗",
});

/**
 * 沒收錄的值要看得出來，不能變空白、也不能只把原碼丟出去。
 * 只認物件自己的鍵，避免 constructor、toString、__proto__ 這類繼承屬性被誤判成合法狀態。
 */
export const calibrationStatusLabel = (status) =>
  Object.prototype.hasOwnProperty.call(CALIBRATION_STATUS_LABEL, status)
    ? CALIBRATION_STATUS_LABEL[status]
    : `其他狀態（${status}）`;

/**
 * 設備卡徽章用的文字。狀態正常不掛徽章，所以這裡不含 ok。
 * 徽章要把「校驗」兩個字帶上：它單獨掛在卡片上，只寫「逾期」看不出逾期的是什麼。
 *
 * `unknown` 要特判：它的表列文字「未校驗」自己就含了「校驗」，套上前綴會變成
 * 「校驗未校驗」。改表裡那一項的文字時要一起看這裡。
 */
export const calibrationBadgeLabel = (status) =>
  status === "unknown" ? "未校驗" : `校驗${calibrationStatusLabel(status)}`;
