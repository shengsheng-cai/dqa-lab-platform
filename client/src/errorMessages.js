// API 錯誤訊息轉譯層（技術訊息 → 使用者友善訊息 + 恢復建議）

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

// 錯誤對應恢復建議（以轉譯後中文訊息的關鍵字比對）
const RECOVERY_HINT_MAP = {
  "治具庫存不足": "可至治具管理申請採購",
  "時段衝突": "建議改用自動排程功能",
  "設備在該時段無法使用": "請查看甘特圖選擇其他時段",
  "設備正在使用中": "請等設備完成後再試，或選擇其他設備",
  "您沒有權限": "此功能僅限管理者使用",
  "治具正在借出中": "請等歸還後再操作",
  "資料重複": "請確認是否已存在相同資料",
  "連線逾時": "請確認後端服務是否正常運行",
  "網路連線失敗": "請確認後端服務是否正常運行",
  "無法取消": "只有待審核的排程可以取消",
  "無法確認": "請確認排程狀態是否正確",
  "必填欄位未填": "請填寫所有必填欄位後再送出",
};

// 預編譯所有 regex，避免每次呼叫都重新 new RegExp
const _COMPILED_TRANSLATIONS = Object.entries(ERROR_TRANSLATION_MAP).map(
  ([pattern, msg]) => [new RegExp(pattern, "i"), msg]
);

export function translateErrorMessage(technicalMessage, fallback = "操作失敗，請稍後重試") {
  if (!technicalMessage || typeof technicalMessage !== "string") {
    return fallback;
  }

  for (const [regex, friendlyMsg] of _COMPILED_TRANSLATIONS) {
    if (regex.test(technicalMessage)) {
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
 * 根據已翻譯的中文訊息，找出對應的恢復建議
 * @param {string} translatedMessage - 已翻譯的使用者訊息
 * @returns {string|null}
 */
export function getRecoveryHint(translatedMessage) {
  if (!translatedMessage) return null;
  for (const [keyword, hint] of Object.entries(RECOVERY_HINT_MAP)) {
    if (translatedMessage.includes(keyword)) return hint;
  }
  return null;
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
