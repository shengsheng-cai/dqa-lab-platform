import React from "react";
import { STATUS_CONFIG, ACTIVE_STATUSES, FINISHING_STATUS, OFFLINE_STATUS, EMERGENCY_STATUS } from "../../constants";

const ControlPanel = ({
  selectedDevice,
  data,
  emergencyFlash,
  effectiveStatus,
  effectiveIsActive,
  onAction,
}) => {
  const sc = STATUS_CONFIG[data.status] || STATUS_CONFIG.OFFLINE;
  const isOffline = data.status === OFFLINE_STATUS;
  const isEmergency = data.status === EMERGENCY_STATUS;
  const isFinishing = data.status === FINISHING_STATUS;
  const canStop = ACTIVE_STATUSES.includes(data.status) || isEmergency;

  return (
    <section
      className="operation-box"
      style={
        isEmergency
          ? {
              borderColor: emergencyFlash ? "#f85149" : "#30363d",
              background: emergencyFlash ? "#1a0a0a" : "#161b22",
              transition: "all 0.3s",
            }
          : {}
      }
    >
      <div className="box-header">
        <span className="pulse-icon" />
        <h2>系統控制面板</h2>
        <span
          style={{
            marginLeft: "auto",
            padding: "2px 10px",
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 700,
            color: sc.color,
            background: sc.bg,
            border: `1px solid ${sc.color}44`,
          }}
        >
          {selectedDevice} — {data.status}
        </span>
      </div>

      <p className="task-desc">
        {isOffline
          ? "⚠️ 後端未連線，請確認伺服器是否正常啟動。"
          : isEmergency
            ? "🚨 緊急停止已觸發，請確認設備安全後，點下方按鈕觸發自動降溫。"
            : data.description}
      </p>

      <div className="btn-group-row">
        {!isFinishing && (
          <button
            className="ctrl-btn amber"
            onClick={() => onAction("pause")}
            disabled={!effectiveIsActive}
            style={{
              opacity: effectiveIsActive ? 1 : 0.35,
              cursor: effectiveIsActive ? "pointer" : "not-allowed",
            }}
          >
            {effectiveStatus === "PAUSED" ? "▶ 繼續執行" : "⏸ 暫停切換"}
          </button>
        )}

        {!isFinishing && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}
          >
            <button
              className="ctrl-btn grey"
              onClick={() => onAction("normal")}
              disabled={!canStop}
              style={{
                opacity: canStop ? 1 : 0.35,
                cursor: canStop ? "pointer" : "not-allowed",
                ...(isEmergency && {
                  background: "#1f4f8f",
                  border: "1px solid #58a6ff",
                  color: "#a5d6ff",
                  fontWeight: 700,
                }),
              }}
            >
              {isEmergency ? "🌡 確認安全，開始降溫" : "⏹ 正常停止"}
            </button>
            {isEmergency && (
              <div
                style={{
                  fontSize: 10,
                  color: "#58a6ff",
                  textAlign: "center",
                  lineHeight: 1.4,
                }}
              >
                設備將緩慢回到 25°C 後自動待機
              </div>
            )}
          </div>
        )}

        <button
          className="ctrl-btn red"
          onClick={() => onAction("emergency")}
          disabled={isOffline || isEmergency}
          style={{
            opacity: isOffline || isEmergency ? 0.35 : 1,
            cursor: isOffline || isEmergency ? "not-allowed" : "pointer",
          }}
        >
          🚨 緊急停止
        </button>
      </div>
    </section>
  );
};

export default ControlPanel;
