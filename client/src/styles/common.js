import { C } from "./theme";

// table
export const thStyle = {
  padding: "8px 12px",
  fontSize: 11,
  color: C.textMuted,
  fontWeight: 600,
  textAlign: "left",
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${C.surfaceHover}`,
};
export const tdStyle = {
  padding: "9px 12px",
  fontSize: 13,
  color: C.textPrimary,
  borderBottom: `1px solid ${C.surfaceHover}`,
};

// buttons (small, 12px — for page-level actions)
export const btnPrimary = {
  padding: "5px 12px",
  borderRadius: 6,
  background: C.successDark,
  color: C.white,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
export const btnOutline = {
  padding: "5px 12px",
  borderRadius: 6,
  background: "transparent",
  color: C.textMuted,
  border: `1px solid ${C.border}`,
  cursor: "pointer",
  fontSize: 12,
};
export const btnDanger = {
  padding: "3px 8px",
  borderRadius: 4,
  background: "transparent",
  color: C.error,
  border: `1px solid ${C.errorDark}`,
  cursor: "pointer",
  fontSize: 12,
};

// inputs
export const inputBase = {
  padding: "8px 10px",
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.textPrimary,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};
