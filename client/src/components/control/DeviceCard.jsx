import { useState, useMemo, useEffect } from "react";
import {
  parseUtcDate,
  STATUS_CONFIG,
  ACTIVE_STATUSES,
  IDLE_STATUS,
  FINISHING_STATUS,
  EMERGENCY_STATUS,
  SIM_PHASE_LABEL,
} from "../../constants";

function useCountdown(estimatedEndAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!estimatedEndAt) {
      setRemaining(null);
      return;
    }
    let timerId;
    const calc = () => {
      const endMs = parseUtcDate(estimatedEndAt);
      const diff = endMs - new Date();
      const next = Math.max(0, Math.floor(diff / 1000));
      setRemaining(prev => (prev === next ? prev : next));
      if (next === 0) clearInterval(timerId);
    };
    calc();
    timerId = setInterval(calc, 1000);
    return () => clearInterval(timerId);
  }, [estimatedEndAt]);
  return remaining;
}

function fmtRemaining(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function conditionLabel(schedule, prefix = "") {
  const idx = schedule.current_condition_index ?? 0;
  const total = (schedule.conditions || []).length;
  const isLast = idx >= total;
  return { idx, total, label: `${prefix}${isLast ? "✅ 確認完成" : `▶ 第 ${idx + 1}/${total} 條件`}` };
}

export default function DeviceCard({ device, isSelected, onClick, pendingSchedule, onConfirmCondition, onShowQc, calibrationStatus }) {
  const isBlocked = device.is_blocked && device.status === IDLE_STATUS;
  const cfg = isBlocked ? STATUS_CONFIG.BLOCKED : (STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE);
  const remaining = useCountdown(device.estimated_end_at);
  const isActive = ACTIVE_STATUSES.includes(device.status);
  const isEmergency = device.status === EMERGENCY_STATUS;
  const isFinishing = device.status === FINISHING_STATUS;
  const [confirming, setConfirming] = useState(false);

  const isWaiting = device.status === IDLE_STATUS && !!pendingSchedule && !!onConfirmCondition;
  const { idx: waitingIdx, total: waitingTotal, label: waitingLabel } = isWaiting
    ? conditionLabel(pendingSchedule)
    : { idx: 0, total: 0, label: "" };
  const handleConfirm = async (e) => {
    e.stopPropagation();
    setConfirming(true);
    try { await onConfirmCondition(pendingSchedule.id); } finally { setConfirming(false); }
  };

  const totalMs = useMemo(
    () => parseUtcDate(device.estimated_end_at) - parseUtcDate(device.started_at),
    [device.started_at, device.estimated_end_at]
  );
  const progressPct =
    isActive && totalMs > 0 && remaining !== null
      ? Math.min(100, Math.max(0, ((totalMs - remaining * 1000) / totalMs) * 100))
      : null;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${isSelected ? cfg.color : isEmergency ? "#f8514944" : "#30363d"}`,
        background: isEmergency
          ? "#2d0f0f"
          : isSelected
            ? "#161b22"
            : "transparent",
        cursor: "pointer",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cdd9e5", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {device.device_id}
          {calibrationStatus === "due_soon" && (
            <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, background: "#2d2200", color: "#e3b341", border: "1px solid #e3b34144", whiteSpace: "nowrap" }}>校驗即將到期</span>
          )}
          {calibrationStatus === "overdue" && (
            <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, background: "#2d0f0f", color: "#f85149", border: "1px solid #f8514944", whiteSpace: "nowrap" }}>校驗逾期</span>
          )}
          {calibrationStatus === "unknown" && (
            <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 4, background: "#21262d", color: "#8b949e", border: "1px solid #30363d", whiteSpace: "nowrap" }}>未校驗</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onShowQc && (
            <button
              onClick={(e) => { e.stopPropagation(); onShowQc(device.device_id); }}
              title="感測器 QC 控制圖"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 12, color: "#58a6ff", lineHeight: 1, opacity: 0.7 }}
            >
              📊
            </button>
          )}
          <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color, whiteSpace: "nowrap" }}>
            {cfg.label}
          </span>
        </span>
      </div>

      {(isActive || isFinishing) && (
        <div style={{ marginTop: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#8b949e" }}>
              {device.temperature != null ? `${device.temperature}°C` : "—"}
              {device.humidity != null && (
                <span style={{ marginLeft: 4 }}>{device.humidity}%</span>
              )}
            </span>
            {SIM_PHASE_LABEL[device.sim_phase] && (
              <span style={{ fontSize: 8, color: isFinishing ? "#6e7681" : "#484f58" }}>
                {SIM_PHASE_LABEL[device.sim_phase]}
              </span>
            )}
          </div>
          {device.running_sop_name && device.running_sop_name !== "STANDBY" && (
            <div style={{ fontSize: 9, color: "#484f58", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>
              {device.running_sop_name}
            </div>
          )}
          {progressPct !== null && (
            <div style={{ margin: "3px 0 1px", height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: device.status === "PAUSED" ? "#e3b341" : "#1f6feb", borderRadius: 2, transition: "width 1s linear" }} />
            </div>
          )}
          {remaining !== null && (
            <div style={{ fontSize: 9, color: "#58a6ff" }}>
              剩 {fmtRemaining(remaining)}
            </div>
          )}
        </div>
      )}

      {isBlocked && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>
          🔒 {device.blocked_reason || "排定不可用時段"}
        </div>
      )}

      {isEmergency && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>
          ⚠ 緊急停止
        </div>
      )}

      {isFinishing && (
        <div style={{ fontSize: 9, color: "#79c0ff", marginTop: 2 }}>
          {device.temperature != null && <div>目前溫度: {device.temperature}°C</div>}
          <div>⏳ 正在自動降溫到 25°C，請稍候...</div>
        </div>
      )}

      {isWaiting && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontSize: 9, color: "#f0a500", marginBottom: 3 }}>
            ⚠ 等待確認 ({waitingIdx}/{waitingTotal})
          </div>
          <button
            disabled={confirming}
            onClick={handleConfirm}
            style={{
              width: "100%", padding: "3px 0", fontSize: 9, fontWeight: 700,
              background: confirming ? "#2d2600" : "#f0a50022",
              border: "1px solid #f0a500", borderRadius: 4,
              color: "#f0a500", cursor: confirming ? "not-allowed" : "pointer",
            }}
          >
            {confirming ? "處理中..." : waitingLabel}
          </button>
        </div>
      )}
    </div>
  );
}
