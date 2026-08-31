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

// 表格列裡的動作按鈕。列動作是整個站最容易點錯的地方，所以最小點擊高度釘在這一份，
// 呼叫點只覆蓋顏色，不要再各自寫 padding 與字級——以前六個地方各寫一種尺寸，
// 最小的一種只有 10px 字、上下 1px 內距。
export const btnRowAction = {
  minHeight: 32,
  padding: "6px 10px",
  borderRadius: 4,
  background: "transparent",
  color: C.textMuted,
  border: `1px solid ${C.border}`,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
  transition: "opacity .15s",
};
// 列裡的刪除這一類。外框保持中性、只有文字是紅的：紅框配紅字在一排小按鈕裡會變成
// 最顯眼的一顆，等於把視線引到最不該誤觸的那個。呼叫點要再把它排到最後、加 marginLeft。
// 名字帶 Row 是因為 32px 下限與中性外框都只在「一排小按鈕之中」才成立，
// 頁面層級的危險按鈕不要拿這支去用。
export const btnRowDanger = {
  ...btnRowAction,
  color: C.error,
};
// 放列動作的容器。間距與「不換行」都在這裡，因為「刪除跟前一顆隔多遠」是容器的 gap
// 加上按鈕的 marginLeft，只釘按鈕那一半的話，同一條規則在不同頁會算出不同距離
// （以前是 16／14／8px 三種）。flexWrap 一定要 nowrap：欄位不夠寬時換行會把刪除
// 甩到第二行的最前面，正好落在「編輯」正下方，拉開的距離等於沒有。
// 放不下要改的是欄寬，不是讓它換行。
export const rowActions = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "nowrap",
};
