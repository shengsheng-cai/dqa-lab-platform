import { parseUTC } from "./timezone";

const MAINTENANCE_TYPE_LABEL = Object.freeze({
  preventive: "預防性",
  corrective: "矯正性",
  inspection: "例行點檢",
});

/**
 * 後端現在只收上面三個值，但舊資料庫可能還有其他字串。只認物件自己的鍵，避免
 * constructor、toString、__proto__ 這類繼承屬性被誤判成合法維護類型。
 */
export const isKnownMaintenanceType = (type) =>
  Object.prototype.hasOwnProperty.call(MAINTENANCE_TYPE_LABEL, type);

export const maintenanceTypeLabel = (type) =>
  isKnownMaintenanceType(type) ? MAINTENANCE_TYPE_LABEL[type] : `未知類型（${type}）`;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, "0");

/** 後端以 datetime 承載純日期；畫面只取日期部分，不賦予午夜時間業務意義。 */
export function toDateOnlyInput(value) {
  if (!value) return "";
  const date = String(value).slice(0, 10);
  return DATE_ONLY_RE.test(date) ? date : "";
}

/** 後端回傳 naive UTC；有時刻語意的維護事件要換回瀏覽器本地時間再編輯。 */
export function toLocalDateTimeInput(value) {
  const date = parseUTC(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}

/** 純日期固定以 UTC 午夜承載；列表不顯示該時間。 */
export function dateOnlyToApi(value) {
  return DATE_ONLY_RE.test(value || "") ? `${value}T00:00:00Z` : null;
}

/** DateTimePicker 的值是本地牆上時間，送出前轉成帶 Z 的 UTC。 */
export function localDateTimeToApi(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatDateOnly(value) {
  return toDateOnlyInput(value) || "—";
}

export function formatLocalDateTime(value) {
  const input = toLocalDateTimeInput(value);
  return input ? input.replace("T", " ") : "—";
}
