import { IDLE_STATUS } from "../constants";
import { conditionDisplayName } from "./conditionName";

/**
 * 這台現在是不是停著等人確認：設備已經回到待機，而它身上那筆排程還沒結案。
 *
 * 三個地方要問同一件事（設備卡的確認鈕、頂部橫幅、SOP 頁的操作卡），而且一定要連
 * 設備狀態一起看。只看「有沒有排程掛著」的話，緊急停止中的機器也會冒出「開始第 N 條件」
 * ——那個畫面要講的是現場安全與怎麼降溫，不該出現任何開始測試的入口。
 */
export function isWaitingForConfirm(device, pendingSchedule) {
  return device?.status === IDLE_STATUS && !!pendingSchedule;
}

/**
 * 一筆進行中排程的條件進度，畫面上怎麼講由這裡決定。
 *
 * 後端那個索引在兩種情況下意思不一樣：測試自己跑完會加 1（代表「做完幾條」），
 * 被人按停則原地不動（代表「停在第幾條」）。排程資料分不出是哪一種，所以設備一旦
 * 停下來等人確認，畫面就不再宣稱誰完成了，只說接下來能做什麼——兩種情況都說得通。
 *
 * 以前五個畫面各自解讀，於是同一台機器在設備卡、控制面板、甘特圖與排程詳情上
 * 講出四種說法，還會算出「第 2/1 條件」這種不存在的進度。
 */
export function conditionProgress(schedule) {
  const conditions = schedule?.conditions || [];
  const total = conditions.length;
  const index = schedule?.current_condition_index ?? 0;
  // 索引已經走到條件清單外，代表沒有下一條可開始，接下來是確認整筆結案
  const isLast = index >= total;
  const nextNumber = index + 1;

  return {
    isLast,
    // 下一條要跑什麼。查不到名稱時寫成「未知條件（原碼）」，不裸露代碼也不留空白
    nextConditionName: isLast
      ? null
      : conditionDisplayName(schedule?.condition_names?.[index], conditions[index]),
    // 動作鈕的名稱，說得出按下去會發生什麼
    actionLabel: isLast ? "✅ 確認完成" : `▶ 開始第 ${nextNumber} 條件（共 ${total}）`,
    // 空間小的地方（設備卡、頂部橫幅）用的短版
    shortActionLabel: isLast ? "✅ 確認完成" : `▶ 第 ${nextNumber}/${total} 條件`,
    // 只放得下幾個字的地方（甘特圖區塊）：還在跑就報進度，停下來等確認就說等確認
    progressLabel: isLast ? "等待確認" : `${nextNumber}/${total}`,
  };
}
