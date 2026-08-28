import { overlayStyle, modalStyle, modalHeader, closeBtn } from "./scheduleUtils";

export default function ScheduleModalShell({ title, width = 540, maxHeight, onClose, children }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- 點背景關掉是滑鼠的便利，鍵盤路徑是視窗裡的 ✕
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={{
          ...modalStyle,
          width,
          display: "flex",
          flexDirection: "column",
          ...(maxHeight && { maxHeight }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={modalHeader}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>{title}</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
