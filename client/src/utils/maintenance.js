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
