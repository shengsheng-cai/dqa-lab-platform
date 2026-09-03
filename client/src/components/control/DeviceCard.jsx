import { useState, useMemo, useEffect } from "react";
import {
  parseUtcDate,
  deviceStatusBadge,
  deviceScheduleNote,
  ACTIVE_STATUSES,
  IDLE_STATUS,
  FINISHING_STATUS,
  EMERGENCY_STATUS,
  SIM_PHASE_LABEL,
} from "../../constants";
import { conditionLabel } from "./deviceCardUtils";
import { C } from "../../styles/theme";
import { btnBare } from "../../styles/common";

const qcBtnStyle = {
  ...btnBare,
  padding: "2px 5px",
  fontSize: 9,
  fontWeight: 700,
  color: C.accent,
  lineHeight: 1.3,
  letterSpacing: 0.3,
  border: `1px solid ${C.border}`,
  borderRadius: 4,
  whiteSpace: "nowrap",
};

const CALIB_BADGE_CFG = {
  due_soon: { bg: C.warningBg,    color: C.warningAlt, borderColor: `${C.warningAlt}44`, label: "校驗即將到期" },
  overdue:  { bg: C.errorBg,      color: C.error,      borderColor: `${C.error}44`,      label: "校驗逾期"    },
  unknown:  { bg: C.surfaceHover,  color: C.textMuted,  borderColor: `${C.border}44`,     label: "未校驗"      },
};

/**
 * 校驗徽章，自己占一行。不跟設備編號擠在頭部那一列：它的字數會變（「校驗即將到期」
 * 比「校驗逾期」多兩個字）而且不能斷字，擠在同一列時會把右邊的 QC 圖與狀態推出卡片
 * 外框，或反過來壓在按鈕底下。
 *
 * 那一行連同間距由這裡出，呼叫點不要自己包一層：`status` 是 "ok" 時沒有徽章可畫，
 * 呼叫點包的話會留下一個看不見卻占 3px 的空行。
 */
function CalibBadge({ status }) {
  const cfg = CALIB_BADGE_CFG[status];
  if (!cfg) return null;
  return (
    <div style={{ marginTop: 3 }}>
      <span style={{ fontSize: 10, padding: "1px 4px", borderRadius: 4, whiteSpace: "nowrap", background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.borderColor}` }}>
        {cfg.label}
      </span>
    </div>
  );
}

function useCountdown(estimatedEndAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!estimatedEndAt) {
      // estimatedEndAt 清空時重置倒數；受 if 守衛、一次性同步 setState
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

export default function DeviceCard({ device, isSelected, onClick, pendingSchedule, onConfirmCondition, onShowQc, calibrationStatus }) {
  // 維護可能與執行狀態同時存在；設備仍在運轉時要顯示真實狀態，
  // 只有底層狀態為 IDLE 才改用不可用樣式。
  const isBlocked = device.maintenance_blocked && device.status === IDLE_STATUS;
  const scheduleNote = deviceScheduleNote(device);
  const cfg = deviceStatusBadge(device.status, isBlocked);
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
      // eslint-disable-next-line no-restricted-syntax -- 整張卡可點是滑鼠的便利，鍵盤入口是下面編號那顆按鈕
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
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cdd9e5", display: "flex", alignItems: "center", gap: 4 }}>
          {/* 整張卡不能直接當按鈕——裡面已經有 📊 與「確認」，按鈕不能包按鈕。
              所以把編號做成這張卡唯一的鍵盤入口，滑鼠點整張卡的行為維持不變。
              排程頁那欄是唯讀的（沒有 onClick），那裡就不要造出按了沒反應的焦點停留點。 */}
          {onClick ? (
            <button
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              aria-current={isSelected ? "true" : undefined}
              style={btnBare}
            >
              {device.device_id}
            </button>
          ) : device.device_id}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {onShowQc && (
            /* 只有一個 📊 的話，沒人知道那顆按下去會發生什麼。title 只有滑鼠 hover 看得到，
               鍵盤與讀螢幕都碰不到，所以名稱用 aria-label 給，圖示本身當裝飾。 */
            <button
              onClick={(e) => { e.stopPropagation(); onShowQc(device.device_id); }}
              aria-label={`開啟 ${device.device_id} 的感測器 QC 圖`}
              title="感測器 QC 控制圖"
              style={qcBtnStyle}
            >
              QC 圖
            </button>
          )}
          <span title={cfg.code} style={{ fontSize: 10, fontWeight: 600, color: cfg.color, whiteSpace: "nowrap" }}>
            {cfg.zh}
          </span>
        </span>
      </div>

      <CalibBadge status={calibrationStatus} />

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
              <span style={{ fontSize: 10, color: isFinishing ? "#6e7681" : "#484f58" }}>
                {SIM_PHASE_LABEL[device.sim_phase]}
              </span>
            )}
          </div>
          {device.running_sop_name && device.running_sop_name !== "STANDBY" && (
            <div style={{ fontSize: 10, color: "#484f58", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>
              {device.running_sop_name}
            </div>
          )}
          {progressPct !== null && (
            <div style={{ margin: "3px 0 1px", height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, background: device.status === "PAUSED" ? "#e3b341" : "#1f6feb", borderRadius: 2, transition: "width 1s linear" }} />
            </div>
          )}
          {remaining !== null && (
            <div style={{ fontSize: 10, color: "#58a6ff" }}>
              剩 {fmtRemaining(remaining)}
            </div>
          )}
        </div>
      )}

      {isBlocked && (
        <div style={{ fontSize: 10, color: "#f85149", marginTop: 2 }}>
          🔒 {device.maintenance_reason || "排定不可用時段"}
        </div>
      )}

      {!isBlocked && scheduleNote && (
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
          {scheduleNote}
        </div>
      )}

      {isEmergency && (
        <div style={{ fontSize: 10, color: "#f85149", marginTop: 2 }}>
          ⚠ 緊急停止
        </div>
      )}

      {isFinishing && (
        <div style={{ fontSize: 10, color: "#79c0ff", marginTop: 2 }}>
          {device.temperature != null && <div>目前溫度: {device.temperature}°C</div>}
          <div>⏳ 正在自動降溫到 25°C，請稍候...</div>
        </div>
      )}

      {isWaiting && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontSize: 10, color: "#f0a500", marginBottom: 3 }}>
            ⚠ 等待確認 ({waitingIdx}/{waitingTotal})
          </div>
          <button
            disabled={confirming}
            onClick={handleConfirm}
            style={{
              width: "100%", padding: "3px 0", fontSize: 10, fontWeight: 700,
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
