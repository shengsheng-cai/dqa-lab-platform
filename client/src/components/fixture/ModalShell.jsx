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
