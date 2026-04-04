// 全域共享常數，避免各組件重複定義

export const DEVICE_IDS = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"];

export const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 小時（ms）

// 輪詢間隔
export const POLL_DEVICES_MS = 3000;    // 設備狀態
export const POLL_FIXTURE_MS = 30000;   // 治具摘要
export const POLL_GENERAL_MS = 60000;   // 其他清單（逾期借出、申請數）

// 後端回傳 naive UTC 字串（無 Z），補上 Z 讓瀏覽器正確解析為 UTC
export function parseUtcDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  return new Date(s.includes("Z") || s.includes("+") ? s : s + "Z");
}

export const ACTIVE_STATUSES = ["RUNNING", "PAUSED"];
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

export const STATUS_CONFIG = {
  OFFLINE:   { color: "#484f58", bg: "#21262d", label: "OFFLINE" },
  IDLE:      { color: "#8b949e", bg: "#21262d", label: "IDLE" },
  RUNNING:   { color: "#3fb950", bg: "#0f2318", label: "RUNNING" },
  PAUSED:    { color: "#f0a500", bg: "#2d1f00", label: "PAUSED" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33", label: "FINISHING" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f", label: "EMERGENCY" },
};
