import React from "react";

/**
 * 統一的確認對話框元件
 * 支援三種類型：info（藍）/ warning（橙）/ danger（紅）
 *
 * @param {Object} props
 * @param {string} props.title - 標題
 * @param {string} props.message - 訊息內容（支持多行）
 * @param {string} props.type - 類型：'info' | 'warning' | 'danger'（預設：'info'）
 * @param {string} props.confirmText - 確認按鈕文字（預設："確認"）
 * @param {string} props.cancelText - 取消按鈕文字（預設："取消"）
 * @param {boolean} props.open - 是否顯示modal（預設：true）
 * @param {function} props.onConfirm - 確認回調
 * @param {function} props.onCancel - 取消回調
 * @param {React.ReactNode} props.children - 自訂內容（會取代message）
 */
export default function ConfirmModal({
  title,
  message,
  type = "info",
  confirmText = "確認",
  cancelText = "取消",
  open = true,
  onConfirm,
  onCancel,
  children,
}) {
  if (!open) return null;

  const typeConfig = {
    info: {
      bgColor: "#1f2f3a",
      borderColor: "#1f6feb",
      titleColor: "#58a6ff",
      btnColor: "#58a6ff",
      btnBg: "#1f6feb",
      icon: "ℹ️",
    },
    warning: {
      bgColor: "#2d2200",
      borderColor: "#f0a50044",
      titleColor: "#f0a500",
      btnColor: "#f0a500",
      btnBg: "#664d0055",
      icon: "⚠️",
    },
    danger: {
      bgColor: "#2d1a1a",
      borderColor: "#da363344",
      titleColor: "#f85149",
      btnColor: "#fff",
      btnBg: "#da3633",
      icon: "🔴",
    },
  };

  const config = typeConfig[type] || typeConfig.info;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: config.bgColor,
          border: `1px solid ${config.borderColor}`,
          borderRadius: 12,
          padding: 24,
          width: 420,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標題 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>{config.icon}</span>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: config.titleColor,
            }}
          >
            {title}
          </div>
        </div>

        {/* 內容 */}
        <div
          style={{
            fontSize: 13,
            color: "#cdd9e5",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {children || message}
        </div>

        {/* 按鈕組 */}
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 8,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid #30363d",
              color: "#8b949e",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 500,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#58a6ff";
              e.currentTarget.style.color = "#58a6ff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#30363d";
              e.currentTarget.style.color = "#8b949e";
            }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: config.btnBg,
              border: "none",
              color: config.btnColor,
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 600,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "0.8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
