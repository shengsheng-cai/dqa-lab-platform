import ModalFrame from "../ModalFrame";
import { C } from "../../styles/theme";

/**
 * 治具頁各視窗的外殼。行為（Esc、焦點、遮罩）都在 ModalFrame，這裡只給外觀。
 *
 * title 會變成標題列，同時是螢幕閱讀器唸出來的視窗名稱，所以是必填的——
 * 以前標題是各視窗自己寫在內容第一行的普通文字，輔助技術認不出這是一個視窗。
 * footer 放取消／送出那一排：放在這裡才會固定在底部，不跟著內容捲走。
 */
export default function ModalShell({ title, subtitle, children, width = 420, maxHeight, gap, onClose, footer }) {
  return (
    <ModalFrame
      title={title}
      maxHeight={maxHeight}
      zIndex={2000}
      onClose={onClose}
      boxStyle={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        width,
        // 三段之間一律要有間距。gap 是給內容子項用的，沒傳的視窗（自己用 margin 排版）
        // 也不能讓標題直接黏在內容上、按鈕直接黏在最後一列上
        gap: gap ?? 12,
      }}
      bodyStyle={{
        padding: "0 24px",
        ...(gap && { display: "flex", flexDirection: "column", gap }),
      }}
      header={
        <div style={{ padding: "24px 24px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
      }
      footer={footer && <div style={{ padding: "0 24px 24px" }}>{footer}</div>}
    >
      {children}
    </ModalFrame>
  );
}
