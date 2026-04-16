export const inputStyle = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #30363d",
  background: "#0d1117",
  color: "#cdd9e5",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

export default function ModalShell({ children, width = 420, maxHeight, gap, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          width,
          ...(maxHeight && { maxHeight, overflowY: "auto" }),
          ...(gap && { display: "flex", flexDirection: "column", gap }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
