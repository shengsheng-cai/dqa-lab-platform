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

// 看起來像純文字、但真的是按鈕。可點的入口一律用 <button>，這份負責把瀏覽器的
// 預設外觀清掉，版面與顏色由呼叫點自己覆蓋。
export const btnBare = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
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
  transition: "background .15s, opacity .15s",
};
export const btnDanger = {
  padding: "3px 8px",
  borderRadius: 4,
  background: "transparent",
  color: C.error,
  border: `1px solid ${C.errorDark}`,
  cursor: "pointer",
  fontSize: 12,
  transition: "opacity .15s",
};
