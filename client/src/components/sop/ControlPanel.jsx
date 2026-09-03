import React from "react";
import {
  deviceStatusBadge,
  ACTIVE_STATUSES,
  FINISHING_STATUS,
  OFFLINE_STATUS,
  EMERGENCY_STATUS,
  IDLE_STATUS,
} from "../../constants";

const ControlPanel = ({
  selectedDevice,
  data,
  emergencyFlash,
  effectiveStatus,
  effectiveIsActive,
  onAction,
  isBlocked,
  scheduleNote,
}) => {
  const sc = deviceStatusBadge(data.status, isBlocked);
  const isOffline = data.status === OFFLINE_STATUS;
  const isEmergency = data.status === EMERGENCY_STATUS;
  const isFinishing = data.status === FINISHING_STATUS;
  const canStop = ACTIVE_STATUSES.includes(data.status) || isEmergency;
  // 有排程掛著時後端會擋掉手動啟動，所以不再引導使用者去選測試（scheduleNote 由 SOPPage 推導）。
  const showIdleGuide = data.status === IDLE_STATUS && !isBlocked && !scheduleNote && !isOffline && !isEmergency && !isFinishing;

  // 「現在是什麼情況」這句話有五種分支，串成巢狀三元運算子讀不出優先順序。
  const taskDesc = () => {
    if (isBlocked) return `🔒 設備在維護時段（${data.maintenance_reason || "未說明原因"}），無法啟動測試。`;
    if (isOffline) return "⚠️ 後端未連線，請確認伺服器是否正常啟動。";
    if (isEmergency) return "🚨 緊急停止已觸發，請確認設備安全後，點下方按鈕觸發自動降溫。";
    if (scheduleNote) return `這台${scheduleNote}，請到排程頁面操作。`;
    return data.description;
  };

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
          title={sc.code}
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
          {selectedDevice} — {sc.zh}
        </span>
      </div>

      <p className="task-desc">{taskDesc()}</p>
      {showIdleGuide && (
        <div
          style={{
            marginTop: 8,
            border: "1px solid #30363d",
            borderRadius: 6,
            padding: "8px 10px",
            background: "#0f1724",
          }}
        >
          <div style={{ fontSize: 11, color: "#58a6ff", fontWeight: 700, marginBottom: 4 }}>
            起始引導
          </div>
          <div style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.5 }}>
            1. 在下方選擇法規、版本與測試條件
            <br />
            2. 確認條件後，完成安全確認清單
            <br />
            3. 點擊「確認啟動」開始測試
          </div>
        </div>
      )}

      {isBlocked ? null : <div className="btn-group-row">
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
      </div>}
    </section>
  );
};

export default ControlPanel;
