/**
 * SOP 左側資訊面板那幾格的算法（純邏輯，不碰 DOM）。
 *
 * 抽出來是為了測得到：這幾格以前各自在 JSX 裡算，錯了畫面上只是數字怪一點，
 * 沒有東西會紅。
 */

/**
 * 剩餘時間，格式 HHHH:MM。
 *
 * 秒數一律來自後端算好的結束時間（useCountdown 吃 estimated_end_at），不要自己從
 * 測試條件重算——後端那份含常溫穩定與暫停累計的時間，自己算會少，於是同一台設備
 * 在設備卡與這塊面板倒數出不同的數字。
 *
 * @param {number|null} remainingSec - 還剩幾秒；還沒拿到時傳 null
 * @returns {string} 例如 "0002:05"
 */
export function formatFreeTime(remainingSec) {
  const totalMin = Math.floor(Math.max(0, remainingSec ?? 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 循環數，格式「已完成/總數」。
 *
 * 後端的 sim_cycle 是「已經跑完幾圈」——最後一圈結束時就加到總圈數了。以前這裡加一
 * 當成「正在跑第幾圈」，於是三循環的測試跑完顯示 0004/0003，而且會一路掛到降溫與
 * 常溫穩定結束。講法跟上面那格 Step（做完幾步／共幾步）一致。
 *
 * @param {number|null} simCycle - 後端的 sim_cycle
 * @param {number|null} cycles - 測試設定的總循環數
 * @returns {string} 例如 "0003/0003"
 */
export function formatCycle(simCycle, cycles) {
  const done = Math.max(0, simCycle ?? 0);
  const total = cycles ?? 1;
  return `${String(done).padStart(4, "0")}/${String(total).padStart(4, "0")}`;
}

/**
 * 步驟數，格式「做完/總數」。
 *
 * @param {number|null} doneCnt - 已完成步驟數
 * @param {number|null} totalSteps - 總步驟數
 * @returns {string} 例如 "003/012"
 */
export function formatStep(doneCnt, totalSteps) {
  const done = Math.max(0, doneCnt ?? 0);
  const total = totalSteps ?? 0;
  return `${String(done).padStart(3, "0")}/${String(total).padStart(3, "0")}`;
}
