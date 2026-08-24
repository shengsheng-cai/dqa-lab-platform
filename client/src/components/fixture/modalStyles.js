import { C } from "../../styles/theme";

/** 欄位標籤。display:block 是給 `<label>` 用的，用在 `<div>` 上也無害。 */
export const labelStyle = {
  display: "block",
  fontSize: 11,
  color: C.textMuted,
  marginBottom: 3,
};

export const inputStyle = {
  padding: "8px 10px",
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.textPrimary,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};
