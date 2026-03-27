// API 錯誤訊息轉譯層（技術訊息 → 使用者友善訊息）

const ERROR_TRANSLATION_MAP = {
  // 治具相關
  "fixture.*not.*found": "治具不存在",
  "invalid fixture": "治具不存在",
  "insufficient.*quantity": "治具庫存不足",
  "no available.*quantity": "治具庫存不足",
  "fixture.*duplicate": "治具已存在",
  "fixture.*in use": "治具正在借出中",

  // 排程相關
  "schedule.*conflict": "時段衝突，無法申請",
  "device.*unavailable": "設備在該時段無法使用",
  "device.*busy": "設備正在使用中",
  "schedule.*not.*found": "排程不存在",
  "cannot cancel.*schedule": "無法取消此排程",
  "cannot confirm.*schedule": "無法確認此排程",

  // 用戶相關
  "user.*not.*found": "使用者不存在",
  "invalid.*user": "使用者資訊無效",
  "line.*binding.*failed": "LINE綁定失敗",
  "line.*user.*already.*bound": "此LINE帳號已綁定",
  "line.*request.*pending": "綁定申請審核中",

  // 權限相關
  "permission denied": "您沒有權限進行此操作",
  "unauthorized": "請重新登入",
  "access denied": "您沒有權限進行此操作",

  // SOP 相關
  "test.*running": "測試進行中，無法進行此操作",
  "invalid.*sop": "SOP不存在或無效",
  "cannot start.*test": "無法啟動測試",

  // 資料庫相關
  "duplicate.*entry": "資料重複",
  "foreign key.*constraint": "此資料被其他資料關聯，無法刪除",
  "integrity.*error": "資料完整性錯誤",

  // 驗證相關
  "required.*field": "必填欄位未填",
  "invalid.*format": "格式無效",
  "invalid.*date": "日期無效",
  "invalid.*number": "數字無效",

  // 檔案相關
  "file.*too.*large": "檔案過大",
  "invalid.*file.*format": "檔案格式不支援",
  "file.*upload.*failed": "檔案上傳失敗",

  // 網路相關
  "connection.*timeout": "連線逾時，請稍後重試",
  "network.*error": "網路連線失敗",

  // 後端英文訊息對應
  "execution not found": "找不到此執行紀錄",
  "invalid signature": "LINE 簽名驗證失敗",
  "admin only": "需要管理者權限",
};

/**
 * 將技術錯誤訊息轉換為使用者友善訊息
 * @param {string} technicalMessage - 來自後端的技術錯誤訊息
 * @param {string} fallback - 預設訊息（如果無法轉譯）
 * @returns {string} 使用者友善的訊息
 */
export function translateErrorMessage(technicalMessage, fallback = "操作失敗，請稍後重試") {
  if (!technicalMessage || typeof technicalMessage !== "string") {
    return fallback;
  }

  const lowerMessage = technicalMessage.toLowerCase();

  // 尋找匹配的轉譯規則
  for (const [pattern, friendlyMsg] of Object.entries(ERROR_TRANSLATION_MAP)) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(lowerMessage)) {
      return friendlyMsg;
    }
  }

  // 如果技術訊息本身看起來已經是使用者友善的（包含中文），直接返回
  if (/[\u4e00-\u9fff]/.test(technicalMessage)) {
    return technicalMessage;
  }

  // 無法轉譯，返回預設訊息
  return fallback;
}

/**
 * 從 axios error 物件中安全地提取並轉譯錯誤訊息
 * @param {Error} error - axios error 物件
 * @param {string} fallback - 預設訊息
 * @returns {string} 使用者友善的訊息
 */
export function getErrorMessage(error, fallback = "操作失敗，請稍後重試") {
  const technicalMessage =
    error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    "";

  return translateErrorMessage(technicalMessage, fallback);
}
