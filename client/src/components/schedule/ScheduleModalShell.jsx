import { overlayStyle, modalStyle, modalHeader, closeBtn } from "./scheduleUtils";

export default function ScheduleModalShell({ title, width = 540, maxHeight, onClose, children }) {
  return (
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
