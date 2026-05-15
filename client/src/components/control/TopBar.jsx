import { IDLE_STATUS, EMERGENCY_STATUS } from "../../constants";

function Stat({ label, value, color }) {
  return (
    <span style={{ fontSize: 12, color: "#8b949e", whiteSpace: "nowrap" }}>
      {label}：
      <span style={{ color: color || "#cdd9e5", fontWeight: 600 }}>{value}</span>
    </span>
  );
}

export default function TopBar({ devices, fixtureSummary, displayName, role, onLogout }) {
  const running = devices.filter((d) => d.status === "RUNNING").length;
  const emergency = devices.filter((d) => d.status === EMERGENCY_STATUS).length;
  const idle = devices.filter((d) => d.status === IDLE_STATUS && !d.is_blocked).length;
  const blocked = devices.filter((d) => d.is_blocked).length;

  const roleName = role === "admin" ? "管理者" : "🔒 訪客模式";
  const roleColor = role === "admin" ? "#3fb950" : "#ff9f5c";
  const roleBg = role === "admin" ? "#1f3a1f" : "#2d1f00";

  return (
    <div style={{ height: 40, background: "#161b22", borderBottom: "1px solid #30363d", display: "flex", alignItems: "center", padding: "0 14px", gap: 14, flexShrink: 0 }}>
      <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 14, marginRight: 4 }}>DQA Lab</span>

      <div style={{ display: "flex", gap: 12, flex: 1 }}>
        <Stat label="執行中" value={running} color="#3fb950" />
        <Stat label="緊急" value={emergency} color={emergency > 0 ? "#f85149" : "#8b949e"} />
        <Stat label="待機" value={idle} />
        <Stat label="不可用" value={blocked} color={blocked > 0 ? "#f0a500" : "#8b949e"} />
        <span style={{ color: "#30363d" }}>│</span>
        <Stat label="治具借出" value={fixtureSummary.total_loaned ?? "—"} color="#f0a500" />
        <Stat label="今日到期" value={fixtureSummary.due_today ?? "—"} color={(fixtureSummary.due_today ?? 0) > 0 ? "#f0a500" : "#8b949e"} />
        <Stat label="逾期未還" value={fixtureSummary.overdue ?? "—"} color={(fixtureSummary.overdue ?? 0) > 0 ? "#f85149" : "#8b949e"} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {displayName && (
          <span style={{ color: "#8b949e", fontSize: 12 }}>
            {displayName}
            <span style={{ marginLeft: 5, fontSize: 10, padding: "1px 5px", borderRadius: 3, background: roleBg, color: roleColor }}>
              {roleName}
            </span>
          </span>
        )}
        <button
          onClick={onLogout}
          style={{ color: "#8b949e", background: "transparent", border: "1px solid #30363d", fontSize: 11, padding: "3px 10px", borderRadius: 5, cursor: "pointer" }}
        >
          登出
        </button>
      </div>
    </div>
  );
}
