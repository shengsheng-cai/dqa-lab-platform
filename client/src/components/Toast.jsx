import React, { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info", duration = 3000, hint = null) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type, hint }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

function ToastContainer({ toasts, onRemove }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }) {
  const typeStyles = {
    success: {
      background: "#0f2318",
      border: "1px solid #238636",
      color: "#3fb950",
      icon: "✅",
    },
    error: {
      background: "#3d1f1a",
      border: "1px solid #da3633",
      color: "#f85149",
      icon: "❌",
    },
    warning: {
      background: "#3d2817",
      border: "1px solid #d29922",
      color: "#d29922",
      icon: "⚠️",
    },
    info: {
      background: "#0d1f33",
      border: "1px solid #0969da",
      color: "#58a6ff",
      icon: "ℹ️",
    },
  };

  const style = typeStyles[toast.type] || typeStyles.info;

  return (
    <div
      style={{
        background: style.background,
        border: style.border,
        color: style.color,
        borderRadius: 8,
        padding: "12px 16px",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 300,
        wordWrap: "break-word",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        animation: "slideIn 0.3s ease-out",
        pointerEvents: "auto",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{style.icon}</span>
      <span style={{ flex: 1 }}>
        {toast.message}
        {toast.hint && (
          <span style={{ display: "block", fontSize: 11, color: "#8b949e", marginTop: 3 }}>
            {toast.hint}
          </span>
        )}
      </span>
      <button
        onClick={() => onRemove(toast.id)}
        style={{
          background: "transparent",
          border: "none",
          color: style.color,
          cursor: "pointer",
          fontSize: 16,
          padding: 0,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
