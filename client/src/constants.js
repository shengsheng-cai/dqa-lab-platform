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

export const SIM_PHASE_LABEL = {
  ramp_to_low: "降至低溫",
  ramp_to_high: "升至高溫",
  dwell_high: "高溫保持",
  ramp_to_low2: "降至低溫",
  dwell_low: "低溫保持",
  ramp_to_ambient: "降回常溫",
};

// 每個狀態一列：label 是狀態徽章上的字，zh 是講給人聽的名稱（用在「為什麼現在不能操作」
// 那種解釋句子）。兩個欄位放在同一列，加新狀態時不會只補到其中一半。
export const STATUS_CONFIG = {
  OFFLINE:   { color: "#484f58", bg: "#21262d", label: "OFFLINE",   zh: "離線" },
  IDLE:      { color: "#8b949e", bg: "#21262d", label: "IDLE",      zh: "待機" },
  RUNNING:   { color: "#3fb950", bg: "#0f2318", label: "RUNNING",   zh: "執行中" },
  PAUSED:    { color: "#f0a500", bg: "#2d1f00", label: "PAUSED",    zh: "已暫停" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33", label: "FINISHING", zh: "收尾降溫中" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f", label: "EMERGENCY", zh: "緊急停止中" },
  BLOCKED:   { color: "#f85149", bg: "#2d0f0f", label: "不可用",     zh: "不可用" },
};

/** 狀態的中文名稱；沒收錄的狀態原樣回傳，不要讓畫面變空白。 */
export const deviceStatusZh = (status) => STATUS_CONFIG[status]?.zh || status;
