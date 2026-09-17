/**
 * 治具的「狀態」其實是三個不同的問題，不能共用同一個答案：
 * 徽章只能顯示一個字，所以要排優先順序；但「有沒有東西借出在外」「能不能現場盤」是另外的事實，
 * 一支即將不足的治具照樣可能有借出。以前月盤點與「借出中」篩選都拿徽章那個字來判斷，
 * 即將不足又有借出的治具就被當成沒有借出，盤點會把還在外面的那件從總數裡扣掉。
 */

/** 徽章上顯示的那一個字，優先順序：缺貨 > 即將不足 > 借出中 > 預約中。 */
export function fixtureBadgeStatus(f) {
  if (f.available_quantity === 0 && f.total_quantity === 0) return "out_of_stock";
  if (f.shortage > 0) return "shortage";
  if (f.loaned_quantity > 0) return "loaned";
  if (f.reserved_quantity > 0) return "reserved";
  return "ok";
}

/** 現場數得到完整數量才能盤：只要有一件借出或預約在外就不行。 */
export const isStocktakeCountable = (f) =>
  !(f.loaned_quantity > 0 || f.reserved_quantity > 0);

/** 狀態篩選。「借出中」問的是有沒有借出，跟徽章上排第幾無關；其餘選項就是徽章那個字。 */
export const matchesStatusFilter = (f, status) =>
  status === "loaned" ? f.loaned_quantity > 0 : fixtureBadgeStatus(f) === status;
