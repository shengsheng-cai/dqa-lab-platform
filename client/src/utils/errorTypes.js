// 異常類型的顯示名稱。後端寫進 error_logs 的是內部代碼，畫面不該要求現場人員自己翻譯。

/** 異常看板的「緊急停止次數」與下面的對照表共用同一個代碼，兩邊才不會各寫各的字串。 */
export const EMERGENCY_ERROR_TYPE = "EMERGENCY";

const ERROR_TYPE_LABEL = Object.freeze({
  [EMERGENCY_ERROR_TYPE]: "緊急停止",
  sensor_fault: "感測器故障",
  humidity_out_of_range: "濕度超出範圍",
});

/**
 * 沒收錄的類型仍要看得出是什麼：寫成「其他異常」並把原碼留在括號裡。
 * 只認物件自己的鍵，避免 constructor、toString、__proto__ 這類繼承屬性被誤判成合法類型。
 */
export const errorTypeLabel = (type) =>
  Object.prototype.hasOwnProperty.call(ERROR_TYPE_LABEL, type)
    ? ERROR_TYPE_LABEL[type]
    : `其他異常（${type}）`;
