/**
 * 測試條件的顯示名稱。
 *
 * 排程存的是 sop_id（像 `iec60068_ab_-25_16h`），名稱要去法規資料查。查不到的時候
 * 以前三個畫面都直接把 sop_id 丟出去，於是畫面上會冒出一串英數代碼，使用者分不出
 * 那是測試條件還是壞掉的資料。
 *
 * 查不到的情形：法規被移除或改名、Demo 種子與實際資料對不上、手動塞進資料庫的排程。
 * 正常流程不會發生。
 *
 * 後端 `_get_condition_names` 查不到時也是回 sop_id，所以前端收到的「名稱」有可能
 * 本來就是一個 sop_id——這支同時處理那種情況（名稱跟代碼一模一樣就當成沒查到）。
 *
 * @param {string|null} name - 查到的名稱，沒有就傳 null
 * @param {string} sopId - 條件代碼
 * @returns {string} 例如「高溫作動 +85°C」或「未知條件（iec60068_ab_-25_16h）」
 */
export function conditionDisplayName(name, sopId) {
  if (name && name !== sopId) return name;
  if (sopId) return `未知條件（${sopId}）`;
  return "未知條件";
}

/**
 * 從一筆排程裡把某個 sop_id 的名稱找出來。
 *
 * 條件銜接的 API 只回 sop_id、不回名稱（`POST /confirm-condition`），但發動的畫面手上
 * 本來就有整筆排程，名稱在 `condition_names` 裡，照 `conditions` 的位置對得到。
 * 沒有那筆排程、或找不到那個條件時，一樣退回「未知條件（原碼）」。
 *
 * @param {object|null} schedule - 排程物件，要有 conditions 與 condition_names
 * @param {string} sopId - 條件代碼
 * @returns {string} 顯示用的名稱
 */
export function conditionNameFromSchedule(schedule, sopId) {
  const index = (schedule?.conditions || []).indexOf(sopId);
  return conditionDisplayName(
    index >= 0 ? schedule?.condition_names?.[index] : null,
    sopId,
  );
}
