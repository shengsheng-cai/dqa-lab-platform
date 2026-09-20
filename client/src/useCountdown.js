import { useState, useEffect } from "react";
import { parseUtcDate } from "./constants";

/**
 * 距離後端給的「設備何時空出來」還剩幾秒，每秒更新一次；沒有結束時間時回 null。
 *
 * 結束時間一律用設備清單送的 estimated_end_at，不要自己從測試條件重算——後端那份
 * 含常溫穩定與暫停累計的時間，自己算的版本兩樣都會少，於是同一台設備在設備卡與
 * SOP 面板會倒數出不同的數字（暫停時一邊停住一邊繼續減，跑完後一邊已經歸零、
 * 另一邊還剩半小時，而那半小時設備是真的還占用著）。
 *
 * @param {string|null} estimatedEndAt - 後端送的結束時間（ISO 字串）
 * @returns {number|null} 剩餘秒數，已經到期回 0
 */
export default function useCountdown(estimatedEndAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!estimatedEndAt) {
      // estimatedEndAt 清空時重置倒數；受 if 守衛、一次性同步 setState
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(null);
      return;
    }
    let timerId;
    const calc = () => {
      const endMs = parseUtcDate(estimatedEndAt);
      const diff = endMs - new Date();
      const next = Math.max(0, Math.floor(diff / 1000));
      setRemaining(prev => (prev === next ? prev : next));
      if (next === 0) clearInterval(timerId);
    };
    calc();
    timerId = setInterval(calc, 1000);
    return () => clearInterval(timerId);
  }, [estimatedEndAt]);
  return remaining;
}
