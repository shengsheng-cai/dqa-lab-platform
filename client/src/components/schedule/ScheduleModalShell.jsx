import ModalFrame from "../ModalFrame";
import { modalStyle, modalHeader, closeBtn } from "./scheduleUtils";

/**
 * 排程頁各視窗的外殼。行為（Esc、焦點、遮罩）都在 ModalFrame，這裡只給外觀。
 *
 * footer 放取消／送出那一排：放在這裡才會固定在底部，不跟著內容捲走。
 */
export default function ScheduleModalShell({ title, width = 540, maxHeight, onClose, footer, bodyStyle, children }) {
  return (
    <ModalFrame
      title={title}
      maxHeight={maxHeight}
      onClose={onClose}
      boxStyle={{ ...modalStyle, width }}
      bodyStyle={{ padding: "16px 20px 0", ...bodyStyle }}
      header={
        <div style={modalHeader}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>{title}</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
      }
      footer={footer}
    >
      {children}
    </ModalFrame>
  );
}
