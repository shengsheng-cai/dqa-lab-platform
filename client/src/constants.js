// 全域共享常數，避免各組件重複定義

export const DEVICE_IDS = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"];

export const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 小時（ms）

// 輪詢間隔
export const POLL_DEVICES_MS = 3000;    // 設備狀態
export const POLL_FIXTURE_MS = 30000;   // 治具摘要
export const POLL_GENERAL_MS = 60000;   // 其他清單（逾期借出、申請數）

export { parseUTC as parseUtcDate } from "./utils/timezone";

export const ACTIVE_STATUSES = ["RUNNING", "PAUSED"];
export const IDLE_STATUS = "IDLE";
export const FINISHING_STATUS = "FINISHING";
export const OFFLINE_STATUS = "OFFLINE";
export const EMERGENCY_STATUS = "EMERGENCY";

// 設備卡右下角那行相位名稱。少一項不會報錯，只會讓那行安靜地空白，
// 所以由 backend/tests/test_sim_phase_labels.py 擋著（那裡也寫了為什麼不收 idle）。
export const SIM_PHASE_LABEL = {
  ramp_to_low: "降至低溫",
  ramp_to_high: "升至高溫",
  dwell_high: "高溫保持",
  ramp_to_low2: "降至低溫",
  dwell_low: "低溫保持",
  ramp_to_ambient: "降回常溫",
  stabilize: "常溫穩定",
};

// 每個狀態一列：zh 是畫面上顯示的名稱，徽章與解釋句子（「為什麼現在不能操作」）共用同一份，
// 兩邊才不會一邊寫「收尾降溫中」一邊寫 FINISHING。原始狀態碼只留在 title 給除錯用。
export const STATUS_CONFIG = {
  OFFLINE:   { color: "#484f58", bg: "#21262d", zh: "離線" },
  IDLE:      { color: "#8b949e", bg: "#21262d", zh: "待機" },
  RUNNING:   { color: "#3fb950", bg: "#0f2318", zh: "執行中" },
  PAUSED:    { color: "#f0a500", bg: "#2d1f00", zh: "已暫停" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33", zh: "收尾降溫中" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f", zh: "緊急停止中" },
  BLOCKED:   { color: "#f85149", bg: "#2d0f0f", zh: "不可用" },
};

/** 狀態的中文名稱；沒收錄的狀態原樣回傳，不要讓畫面變空白。 */
export const deviceStatusZh = (status) => STATUS_CONFIG[status]?.zh || status;

/**
 * 狀態徽章要用的顏色與文字。「不可用」不是設備狀態機裡的狀態，是後端的 is_blocked（維護時段，
 * 或這台還有沒結案的排程掛著）疊在待機上面的顯示。所以另外給 code 寫出底下真正的狀態碼：
 * 畫面只寫「不可用」的話，除錯時查不到它其實停在哪一格。
 */
export const deviceStatusBadge = (status, isBlocked = false) =>
  isBlocked
    ? { ...STATUS_CONFIG.BLOCKED, code: `BLOCKED / ${status}` }
    : { ...(STATUS_CONFIG[status] || STATUS_CONFIG.OFFLINE), code: status || OFFLINE_STATUS };
