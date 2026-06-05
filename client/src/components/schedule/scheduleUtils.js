import { parseUtcDate } from "../../constants";

export const HOUR_PX = 6;
export const DAY_PX = HOUR_PX * 24;
export const ROW_H = 52;
export const HEADER_H = 48;
export const LABEL_W = 68;

export const STATUS_COLOR = {
  待審核: { bg: "#30363d", text: "#8b949e", border: "#484f58" },
  已確認: { bg: "#1c3a5e", text: "#79c0ff", border: "#388bfd" },
  進行中: { bg: "#1a3828", text: "#7ee787", border: "#3fb950" },
  已完成: { bg: "#1e1a2e", text: "#bc8cff", border: "#6e40c9" },
  已取消: { bg: "#2d1a1a", text: "#ff7b72", border: "#f85149" },
};

export const STATUS_LIST = ["待審核", "已確認", "進行中", "已完成", "已取消"];

export const BUFFER_TIME_HOURS = 0.5;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const GANTT_PAST_DAYS = 3;
export const GANTT_FUTURE_DAYS = 30;

export function fmtDt(dt) {
  if (!dt) return "—";
  const d = parseUtcDate(dt);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function toLocalInput(isoStr) {
  if (!isoStr) return "";
  const d = parseUtcDate(isoStr);
  if (!d) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtHours(h) {
  if (!h) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
export const modalStyle = {
  background: "#161b22", border: "1px solid #30363d", borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
};
export const modalHeader = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 20px", borderBottom: "1px solid #30363d",
  background: "#0d1117",
};
export const closeBtn = {
  background: "none", border: "none", color: "#8b949e",
  cursor: "pointer", fontSize: 16, padding: "2px 6px",
};
export const inputStyle = {
  width: "100%", background: "#0d1117", border: "1px solid #30363d",
  borderRadius: 6, padding: "7px 10px", color: "#cdd9e5",
  fontSize: 13, boxSizing: "border-box", outline: "none",
  colorScheme: "dark",
};
export const labelStyle = { fontSize: 12, color: "#8b949e", marginBottom: 4, fontWeight: 600 };
export const primaryBtn = {
  background: "#238636", border: "1px solid #2ea043", color: "#fff",
  padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};
export const scheduleIconBtn = {
  background: "transparent", border: "1px solid #30363d", color: "#8b949e",
  padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 14, lineHeight: 1,
};
export const cancelBtn = {
  background: "transparent", border: "1px solid #30363d", color: "#8b949e",
  padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13,
};
