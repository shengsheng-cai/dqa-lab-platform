import { overlayStyle, modalStyle, modalHeader, closeBtn } from "./scheduleUtils";

export default function ScheduleModalShell({ title, width = 540, maxHeight, flex = false, onClose, children }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={{
          ...modalStyle,
          width,
          ...(maxHeight && { maxHeight }),
          ...(flex && { display: "flex", flexDirection: "column" }),
          ...(maxHeight && !flex && { overflowY: "auto" }),
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
